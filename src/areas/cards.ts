// Board, after Fizzy: cards move across columns, Not now · Triage · your columns · Review · Done. New cards land in Triage; a
// Golden Ticket pins a card to the top of its column; a card nobody touches for 30 days moves to Not now on its own
// (the job below). Review is where finished work waits for a person: Home lists it ("Waiting for you"), and a card
// there gets Ship it / Send it back / Kill it (the sweep). The board, new column, column ••• menu, new card, card (with
// steps), edit card.
// The pages are client/areas/cards.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { addComment } from "./items.ts"
import { findProject, findRecording, projectPeople, createRecording, updateRecording, windowUrl, urlFor, titleOf, notify, logEvent, type Project, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const KIND_ORDER: Record<string, number> = { not_now: 0, triage: 1, custom: 2, review: 3, done: 4 }
/** Cards nobody touches for this long move to Not now. */
const AUTO_CLOSE_DAYS = 30

/** Columns in display order: Not now, Triage, your columns, Review, Done. */
const sortColumns = (cols: ReadonlyArray<Recording>) =>
  [...cols].sort((a, b) => (KIND_ORDER[a.data.kind ?? "custom"]! - KIND_ORDER[b.data.kind ?? "custom"]!) || a.position - b.position || a.id - b.id)

/** Which board (window) a form or column means: a copy's id while the project has it, else the first board. */
const boardId = (p: Project, tool?: string) => (tool && p.tools.some((t) => t.id === tool && t.type === "cardtable") ? tool : "cardtable")
/** That board's address. */
const board = (p: Project, tool?: string) => windowUrl(p, { id: boardId(p, tool), type: "cardtable" })

/** Every board has Not now, Triage, Review and Done. Made on first visit (the board page posts to /board/setup). */
const ensureColumns = (c: Ctx, p: Project, tool?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const id = boardId(p, tool)
    const columns = sql<Recording>`select * from recordings where project_id = ${p.id} and type = 'column' and status = 'active' and coalesce(data->>'tool', 'cardtable') = ${id}`
    const existing = yield* columns
    for (const [kind, title] of [["not_now", "Not now"], ["triage", "Triage"], ["review", "Review"], ["done", "Done"]] as const)
      if (!existing.some((col) => col.data.kind === kind))
        yield* createRecording(c, { project: p, type: "column", tool: id, title, data: { kind, color: "", watcher_ids: [] }, visible_to_clients: true, quiet: true })
    return sortColumns(yield* columns)
  })

const findColumn = (c: Ctx, p: Project, id: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [col] = yield* sql<Recording>`select * from recordings where id = ${Number(id) || 0} and project_id = ${p.id} and type = 'column' and status = 'active'`
    if (!col) return yield* new NotFound()
    return col
  })

/** Move a card to a column, on top of it (after any Golden Tickets): Done stamps it completed, leaving Done clears that.
 * Into Review, it notes when, by whom and from where (Send it back returns it there). Watchers hear about it.
 * Mirrored in client/areas/cards.tsx. */
const moveCard = (c: Ctx, p: Project, card: Recording, col: Recording) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (card.parent_id === col.id) return
    const done = col.data.kind === "done"
    const data = {
      ...card.data, completed_at: done ? card.data.completed_at ?? new Date().toISOString() : null,
      ...(col.data.kind === "review" ? { review: { at: new Date().toISOString(), by: c.me.id, via: c.app?.name ?? null, from: card.parent_id } } : {}),
    }
    yield* sql`update recordings set parent_id = ${col.id}, data = ${JSON.stringify(data)}, updated_at = now(),
      position = (select coalesce(max(position), 0) + 1 from recordings where parent_id = ${col.id} and type = 'card') where id = ${card.id}`
    yield* logEvent(c, { project_id: p.id, recording_id: card.id, action: done ? "completed" : "moved", summary: `moved ${titleOf(card)} to ${col.title}` })
    const watchers = (col.data.watcher_ids ?? []) as number[]
    if (watchers.length) yield* notify(c, { personIds: watchers, recording: card, kind: "card_added", summary: `${c.me.name} moved ${titleOf(card)} to ${col.title}` })
  })

export const routes = [
  // Was part of GET /projects/:id/board: the page posts here when New, Later or Done is missing.
  post("/projects/:id/board/setup", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const tool = str(yield* c.form, "tool")
      yield* ensureColumns(c, p, tool)
      return back(c, board(p, tool))
    })),

  // Columns
  post("/projects/:id/columns", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      yield* ensureColumns(c, p, str(fd, "tool"))
      const title = str(fd, "name")
      const color = COLORS.includes(str(fd, "color")) ? str(fd, "color") : ""
      if (!title) return invalid(["Your column needs a name."])
      const [last] = yield* sql<{ n: number }>`select coalesce(max(position), 0)::int as n from recordings where project_id = ${p.id} and type = 'column' and data->>'kind' = 'custom'`
      const col = yield* createRecording(c, { project: p, type: "column", tool: str(fd, "tool"), title, data: { kind: "custom", color, note: str(fd, "note").slice(0, 140), watcher_ids: [] }, visible_to_clients: true, position: last!.n + 1, verb: "added a column" })
      // Stay on the board: the column shows at once and the add line is ready for the next.
      return back(c, `${board(p, col.data.tool)}#column-${col.id}`)
    })),

  post("/projects/:id/columns/order", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = Number(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${p.id} and type = 'column'`
      }
      return back(c, board(p, str(fd, "tool")))
    })),

  post("/projects/:id/columns/:colid", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      const fd = yield* c.form
      if (!str(fd, "name")) return back(c, `/projects/${p.id}/columns/${col.id}`, "Your column needs a name.")
      yield* updateRecording(c, col, { title: str(fd, "name"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "", note: str(fd, "note").slice(0, 140) } }, { quiet: true })
      return redirect(`${board(p, col.data.tool)}#column-${col.id}`, "Saved.")
    })),

  post("/projects/:id/columns/:colid/watch", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const col = yield* findColumn(c, p, c.params.colid)
      const w = (col.data.watcher_ids ?? []) as number[]
      const watching = w.includes(c.me.id)
      yield* updateRecording(c, col, { data: { watcher_ids: watching ? w.filter((id) => id !== c.me.id) : [...w, c.me.id] } }, { quiet: true })
      return back(c, board(p, col.data.tool), watching ? `You stopped watching ${col.title}.` : `You're watching ${col.title}.`)
    })),

  post("/projects/:id/columns/:colid/move-all", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      const to = yield* findColumn(c, p, str(yield* c.form, "column_id"))
      const cards = yield* sql<Recording>`select * from recordings where parent_id = ${col.id} and type = 'card' and status = 'active'`
      for (const k of cards) yield* moveCard(c, p, k, to)
      return redirect(`${board(p, col.data.tool)}#column-${to.id}`, `Moved ${cards.length} card${cards.length === 1 ? "" : "s"} to ${to.title}.`)
    })),

  post("/projects/:id/columns/:colid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      if (col.data.kind !== "custom") return back(c, board(p, col.data.tool), `${col.title} comes with every board, so it can't be deleted.`)
      const [n] = yield* sql<{ n: number }>`select count(*)::int as n from recordings where parent_id = ${col.id} and type = 'card' and status = 'active'`
      if (n!.n) return back(c, `/projects/${p.id}/columns/${col.id}`, "Move the cards out first.")
      yield* sql`update recordings set status = 'trashed', trashed_at = now() where id = ${col.id}`
      yield* logEvent(c, { project_id: p.id, recording_id: col.id, action: "trashed", summary: `deleted the ${col.title} column` })
      return redirect(board(p, col.data.tool), { msg: `Deleted the ${col.title} column.`, href: `/r/${col.id}/undo-trash`, label: "Undo" })
    })),

  // Cards
  post("/projects/:id/cards", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const col = yield* findColumn(c, p, str(fd, "column_id"))
      const title = str(fd, "title")
      if (!title) return invalid(["Give the card a title."])
      yield* createRecording(c, {
        project: p, type: "card", parent_id: col.id, title,
        data: {
          assignee_ids: [], due_on: null, golden: false, completed_at: col.data.kind === "done" ? new Date().toISOString() : null,
          ...(col.data.kind === "review" ? { review: { at: new Date().toISOString(), by: c.me.id, via: c.app?.name ?? null, from: null } } : {}),
        },
        notifyIds: col.data.watcher_ids ?? [], notifyKind: "card_added", verb: `added a card to ${col.title}`,
      })
      // Stay on the board: the card shows at once and the add line is ready for the next.
      return back(c, `${board(p, col.data.tool)}#column-${col.id}`)
    })),

  post("/projects/:id/cards/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const people = yield* projectPeople(project)
      const fd = yield* c.form
      const pool = people.map((p) => p.id)
      const assignees = ids(fd, "assignee_ids").filter((id) => pool.includes(id))
      const ch = { title: str(fd, "title"), body: str(fd, "body"), data: { assignee_ids: assignees, due_on: str(fd, "due_on") || null }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!ch.title) return invalid(["Your card needs a title."])
      const u = yield* updateRecording(c, r, ch)
      const added = assignees.filter((id) => !(r.data.assignee_ids ?? []).includes(id))
      if (added.length) yield* notify(c, { personIds: added, recording: u, kind: "assigned", summary: `${c.me.name} assigned you a card: ${u.title}` })
      return redirect(urlFor(u), "Saved.")
    })),

  // Move a card to a column, or within its own: `order` (the column's card ids, top first) puts it exactly where it was
  // dropped. Without one (the dropdown on a card's page) it lands on top.
  post("/projects/:id/cards/:cid/move", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const fd = yield* c.form
      const col = yield* findColumn(c, project, str(fd, "column_id"))
      yield* moveCard(c, project, r, col)
      const order = str(fd, "order").split(",").map(Number).filter(Boolean)
      for (const [i, id] of order.entries())
        yield* sql`update recordings set position = ${order.length - i} where id = ${id} and parent_id = ${col.id} and type = 'card'`
      return back(c, urlFor(r))
    })),

  post("/projects/:id/cards/:cid/done", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      // The Done column of the card's own board.
      const sql = yield* SqlClient.SqlClient
      const [from] = yield* sql<Recording>`select * from recordings where id = ${r.parent_id}`
      const done = (yield* ensureColumns(c, project, from?.data.tool)).find((col) => col.data.kind === "done")!
      yield* moveCard(c, project, r, done)
      return redirect(urlFor(r), "Done! Moved to the Done column.")
    })),

  // The sweep: a card in Review gets one of three answers. `then` is where to go after (Home, when that's where it started).
  post("/projects/:id/cards/:cid/review", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const fd = yield* c.form
      const [col] = yield* sql<Recording>`select * from recordings where id = ${r.parent_id ?? 0}`
      if (r.status !== "active" || col?.data.kind !== "review") return invalid(["That card moved on. Someone got to it first."])
      const then = /^\/(?![/\\])/.test(str(fd, "then")) ? str(fd, "then") : board(project, col.data.tool)
      const cols = yield* ensureColumns(c, project, col.data.tool)
      switch (str(fd, "verdict")) {
        case "ship": {
          yield* moveCard(c, project, r, cols.find((x) => x.data.kind === "done")!)
          return redirect(then, `Shipped “${r.title}”.`)
        }
        case "back": {
          const note = str(fd, "body")
          if (!note) return invalid(["Say what should change, so whoever picks it up knows what to do."])
          yield* addComment(c, r, project, note)
          const to = cols.find((x) => x.id === r.data.review?.from && x.data.kind !== "review" && x.data.kind !== "done") ?? cols.find((x) => x.data.kind === "triage")!
          yield* moveCard(c, project, r, to)
          return redirect(then, `Sent “${r.title}” back to ${to.title}.`)
        }
        case "kill": {
          yield* sql`update recordings set status = 'trashed', trashed_at = now() where id = ${r.id}`
          yield* logEvent(c, { project_id: project.id, recording_id: r.id, action: "trashed", summary: `trashed ${titleOf(r)}` })
          return redirect(then, { msg: `Moved “${r.title}” to the trash.`, href: `/r/${r.id}/undo-trash`, label: "Undo" })
        }
        default: return invalid(["Ship it, send it back, or kill it."])
      }
    })),

  // The Golden Ticket: pins a card to the top of its column (the only way to reorder within one).
  post("/projects/:id/cards/:cid/golden", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.cid, "card")
      yield* updateRecording(c, r, { data: { golden: !r.data.golden } }, { summary: `${r.data.golden ? "took the Golden Ticket off" : "gave a Golden Ticket to"} ${r.title}` })
      return back(c, urlFor(r), r.data.golden ? "No longer a Golden Ticket." : "It's a Golden Ticket: it stays at the top of its column.")
    })),

  // Steps
  post("/projects/:id/cards/:cid/steps", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const fd = yield* c.form
      const title = str(fd, "title")
      if (!title) return back(c, urlFor(r), "Your step needs a title.")
      const assignee = Number(str(fd, "assignee_id")) || null
      const pool = (yield* projectPeople(project)).map((p) => p.id)
      const assignees = assignee && pool.includes(assignee) ? [assignee] : []
      const step = yield* createRecording(c, {
        project, type: "step", parent_id: r.id, title, data: { assignee_ids: assignees, due_on: str(fd, "due_on") || null, completed_at: null },
        visible_to_clients: true, notifyIds: assignees, notifyKind: "assigned", verb: `added a step to ${r.title}`,
      })
      return redirect(`${urlFor(r)}#step-${step.id}`)
    })),

  post("/projects/:id/steps/:sid/toggle", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.sid, "step")
      const done = !r.data.completed_at
      yield* updateRecording(c, r, { data: { completed_at: done ? new Date().toISOString() : null } }, { summary: `${done ? "completed" : "reopened"} the step ${r.title}` })
      return redirect(urlFor(r))
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const { maya, ann, bob } = s.people
    const p = s.projects.website
    const c = s.as(maya)
    const cols = yield* ensureColumns(c, p)
    const col = (kind: string) => cols.find((x) => x.data.kind === kind)!
    const progress = yield* createRecording(c, { project: p, type: "column", title: "In progress", data: { kind: "custom", color: "blue", watcher_ids: [ann.id] }, visible_to_clients: true, position: 1, verb: "added a column" })
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const card = (column: Recording, title: string, data: Record<string, any>, body = "", visible = true) =>
      createRecording(c, { project: p, type: "card", parent_id: column.id, title, body, visible_to_clients: visible,
        data: { assignee_ids: [], due_on: null, golden: false, completed_at: null, ...data }, verb: `added a card to ${column.title}` })
    yield* card(col("triage"), "Footer links go to the old site", {}, "Spotted by Dan. Every footer link 404s.")
    const hero = yield* card(progress, "Homepage hero copy", { assignee_ids: [ann.id], due_on: day(3), golden: true }, "One sentence. What they sell, who it's for.")
    for (const [i, t] of ["Draft three headlines", "Pick one with Maya", "Hand to Bob"].entries())
      yield* createRecording(c, { project: p, type: "step", parent_id: hero.id, title: t, visible_to_clients: true,
        data: { assignee_ids: [i === 2 ? bob.id : ann.id], due_on: day(i + 1), completed_at: i === 0 ? new Date().toISOString() : null }, quiet: true })
    yield* card(progress, "Contact form", { assignee_ids: [bob.id] }, "Waiting on Northwind's CRM credentials.", false)
    yield* card(col("triage"), "Dark mode for the site?", {}, "Dan asked. Worth a look after launch.")
    yield* card(col("not_now"), "Blog", {}, "Not this cycle.")
    yield* card(col("done"), "Pick a typeface", { completed_at: new Date(Date.now() - 2 * 86400_000).toISOString() })
  })

/** Auto close, after Fizzy: a card in Triage or one of your columns that nobody has touched (the card, its steps or its
 * comments) for 30 days moves to its board's Not now, so a board tidies itself. Golden Tickets stay put. Runs every
 * minute; most minutes there's nothing to move. */
const autoClose = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const stale = yield* sql<{ id: number; account_id: number; project_id: number; title: string; not_now: number }>`
    select k.id, k.account_id, k.project_id, k.title, nn.id as not_now
    from recordings k
    join recordings col on col.id = k.parent_id and col.type = 'column'
    join recordings nn on nn.project_id = k.project_id and nn.type = 'column' and nn.status = 'active' and nn.data->>'kind' = 'not_now'
      and coalesce(nn.data->>'tool', 'cardtable') = coalesce(col.data->>'tool', 'cardtable')
    where k.type = 'card' and k.status = 'active' and col.data->>'kind' in ('triage', 'custom')
      and coalesce((k.data->>'golden')::boolean, false) = false
      and k.updated_at < now() - make_interval(days => ${AUTO_CLOSE_DAYS})
      and not exists (select 1 from recordings x where x.parent_id = k.id and x.updated_at >= now() - make_interval(days => ${AUTO_CLOSE_DAYS}))`
  for (const k of stale) {
    yield* sql`update recordings set parent_id = ${k.not_now}, updated_at = now(),
      position = (select coalesce(max(position), 0) + 1 from recordings where parent_id = ${k.not_now} and type = 'card') where id = ${k.id}`
    yield* sql`insert into events ${sql.insert({ account_id: k.account_id, project_id: k.project_id, recording_id: k.id, person_id: null, action: "moved", summary: `moved ${k.title} to Not now: nobody touched it for ${AUTO_CLOSE_DAYS} days` })}`
  }
})

export const jobs = [autoClose]
