// Board: the board, new column, column ••• menu, new card, card (with steps), edit card.
// The pages are client/areas/cards.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, createRecording, updateRecording, toolUrl, urlFor, titleOf, notify, logEvent, type Project, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const KIND_ORDER: Record<string, number> = { triage: 0, custom: 1, not_now: 2, done: 3 }

/** Columns in display order: New, your columns, Later, Done. */
const sortColumns = (cols: ReadonlyArray<Recording>) =>
  [...cols].sort((a, b) => (KIND_ORDER[a.data.kind ?? "custom"]! - KIND_ORDER[b.data.kind ?? "custom"]!) || a.position - b.position || a.id - b.id)

/** Every board starts with New, Later and Done. Made on first visit (the board page posts to /board/setup). */
const ensureColumns = (c: Ctx, p: Project) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const existing = yield* sql<Recording>`select * from recordings where project_id = ${p.id} and type = 'column' and status = 'active'`
    for (const [kind, title] of [["triage", "New"], ["not_now", "Later"], ["done", "Done"]] as const)
      if (!existing.some((col) => col.data.kind === kind))
        yield* createRecording(c, { project: p, type: "column", title, data: { kind, color: "", watcher_ids: [], on_hold: false }, visible_to_clients: true, quiet: true })
    return sortColumns(yield* sql<Recording>`select * from recordings where project_id = ${p.id} and type = 'column' and status = 'active'`)
  })

const findColumn = (c: Ctx, p: Project, id: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [col] = yield* sql<Recording>`select * from recordings where id = ${Number(id) || 0} and project_id = ${p.id} and type = 'column' and status = 'active'`
    if (!col) return yield* new NotFound()
    return col
  })

/** Move a card to a column: Done stamps it completed, leaving Done clears that. Watchers hear about it. Mirrored in client/areas/cards.tsx. */
const moveCard = (c: Ctx, p: Project, card: Recording, col: Recording) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (card.parent_id === col.id) return
    const done = col.data.kind === "done"
    const data = { ...card.data, completed_at: done ? card.data.completed_at ?? new Date().toISOString() : null, on_hold: false }
    yield* sql`update recordings set parent_id = ${col.id}, data = ${JSON.stringify(data)}, updated_at = now() where id = ${card.id}`
    yield* logEvent(c, { project_id: p.id, recording_id: card.id, action: done ? "completed" : "moved", summary: `moved ${titleOf(card)} to ${col.title}` })
    const watchers = (col.data.watcher_ids ?? []) as number[]
    if (watchers.length) yield* notify(c, { personIds: watchers, recording: card, kind: "card_added", summary: `${c.me.name} moved ${titleOf(card)} to ${col.title}` })
  })

export const routes = [
  // Was part of GET /projects/:id/board: the page posts here when New, Later or Done is missing.
  post("/projects/:id/board/setup", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      yield* ensureColumns(c, p)
      return back(c, toolUrl(p, "cardtable"))
    })),

  // Columns
  post("/projects/:id/columns", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* ensureColumns(c, p)
      const fd = yield* c.form
      const title = str(fd, "name")
      const color = COLORS.includes(str(fd, "color")) ? str(fd, "color") : ""
      if (!title) return invalid(["Your column needs a name."])
      const [last] = yield* sql<{ n: number }>`select coalesce(max(position), 0)::int as n from recordings where project_id = ${p.id} and type = 'column' and data->>'kind' = 'custom'`
      const col = yield* createRecording(c, { project: p, type: "column", title, data: { kind: "custom", color, watcher_ids: [], on_hold: false }, visible_to_clients: true, position: last!.n + 1, verb: "added a column" })
      return redirect(`${toolUrl(p, "cardtable")}#column-${col.id}`, `Added the ${title} column.`)
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
      return redirect(toolUrl(p, "cardtable"), "Columns reordered.")
    })),

  post("/projects/:id/columns/:colid", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      const fd = yield* c.form
      if (!str(fd, "name")) return back(c, `/projects/${p.id}/columns/${col.id}`, "Your column needs a name.")
      yield* updateRecording(c, col, { title: str(fd, "name"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "" } }, { quiet: true })
      return redirect(`${toolUrl(p, "cardtable")}#column-${col.id}`, "Saved.")
    })),

  post("/projects/:id/columns/:colid/watch", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const col = yield* findColumn(c, p, c.params.colid)
      const w = (col.data.watcher_ids ?? []) as number[]
      const watching = w.includes(c.me.id)
      yield* updateRecording(c, col, { data: { watcher_ids: watching ? w.filter((id) => id !== c.me.id) : [...w, c.me.id] } }, { quiet: true })
      return back(c, toolUrl(p, "cardtable"), watching ? `You stopped watching ${col.title}.` : `You're watching ${col.title}.`)
    })),

  post("/projects/:id/columns/:colid/hold", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      yield* updateRecording(c, col, { data: { on_hold: !col.data.on_hold } }, { quiet: true })
      // Removing the section puts held cards back in the column.
      if (col.data.on_hold) yield* sql`update recordings set data = data || '{"on_hold": false}'::jsonb where parent_id = ${col.id} and type = 'card'`
      return redirect(`${toolUrl(p, "cardtable")}#column-${col.id}`, col.data.on_hold ? "On hold section removed." : "On hold section added.")
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
      return redirect(`${toolUrl(p, "cardtable")}#column-${to.id}`, `Moved ${cards.length} card${cards.length === 1 ? "" : "s"} to ${to.title}.`)
    })),

  post("/projects/:id/columns/:colid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const col = yield* findColumn(c, p, c.params.colid)
      if (col.data.kind !== "custom") return back(c, toolUrl(p, "cardtable"), `${col.title} comes with every board, so it can't be deleted.`)
      const [n] = yield* sql<{ n: number }>`select count(*)::int as n from recordings where parent_id = ${col.id} and type = 'card' and status = 'active'`
      if (n!.n) return back(c, `/projects/${p.id}/columns/${col.id}`, "Move the cards out first.")
      yield* sql`update recordings set status = 'trashed', trashed_at = now() where id = ${col.id}`
      yield* logEvent(c, { project_id: p.id, recording_id: col.id, action: "trashed", summary: `deleted the ${col.title} column` })
      return redirect(toolUrl(p, "cardtable"), { msg: `Deleted the ${col.title} column.`, href: `/r/${col.id}/undo-trash`, label: "Undo" })
    })),

  // Cards
  post("/projects/:id/cards", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const col = yield* findColumn(c, p, str(fd, "column_id"))
      const title = str(fd, "title")
      if (!title) return back(c, toolUrl(p, "cardtable"), "Your card needs a title.")
      const card = yield* createRecording(c, {
        project: p, type: "card", parent_id: col.id, title,
        data: { assignee_ids: [], due_on: null, on_hold: false, completed_at: col.data.kind === "done" ? new Date().toISOString() : null },
        notifyIds: col.data.watcher_ids ?? [], notifyKind: "card_added", verb: `added a card to ${col.title}`,
      })
      return redirect(`${toolUrl(p, "cardtable")}#column-${col.id}`, { msg: "Card added.", href: urlFor(card), label: "Open it" })
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

  post("/projects/:id/cards/:cid/move", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const col = yield* findColumn(c, project, str(yield* c.form, "column_id"))
      yield* moveCard(c, project, r, col)
      return back(c, urlFor(r), `Moved to ${col.title}.`)
    })),

  post("/projects/:id/cards/:cid/done", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const done = (yield* ensureColumns(c, project)).find((col) => col.data.kind === "done")!
      yield* moveCard(c, project, r, done)
      return redirect(urlFor(r), "Done! Moved to the Done column.")
    })),

  post("/projects/:id/cards/:cid/hold", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.cid, "card")
      yield* updateRecording(c, r, { data: { on_hold: !r.data.on_hold } }, { summary: `${r.data.on_hold ? "took" : "put"} ${r.title} ${r.data.on_hold ? "off" : "on"} hold` })
      return back(c, urlFor(r), r.data.on_hold ? "Taken off hold." : "Put on hold.")
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
    const progress = yield* createRecording(c, { project: p, type: "column", title: "In progress", data: { kind: "custom", color: "blue", watcher_ids: [ann.id], on_hold: true }, visible_to_clients: true, position: 1, verb: "added a column" })
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const card = (column: Recording, title: string, data: Record<string, any>, body = "", visible = true) =>
      createRecording(c, { project: p, type: "card", parent_id: column.id, title, body, visible_to_clients: visible,
        data: { assignee_ids: [], due_on: null, on_hold: false, completed_at: null, ...data }, verb: `added a card to ${column.title}` })
    yield* card(col("triage"), "Footer links go to the old site", {}, "Spotted by Dan. Every footer link 404s.")
    const hero = yield* card(progress, "Homepage hero copy", { assignee_ids: [ann.id], due_on: day(3) }, "One sentence. What they sell, who it's for.")
    for (const [i, t] of ["Draft three headlines", "Pick one with Maya", "Hand to Bob"].entries())
      yield* createRecording(c, { project: p, type: "step", parent_id: hero.id, title: t, visible_to_clients: true,
        data: { assignee_ids: [i === 2 ? bob.id : ann.id], due_on: day(i + 1), completed_at: i === 0 ? new Date().toISOString() : null }, quiet: true })
    yield* card(progress, "Contact form", { assignee_ids: [bob.id], on_hold: true }, "Waiting on Northwind's CRM credentials.", false)
    yield* card(col("not_now"), "Blog", {}, "Not this cycle.")
    yield* card(col("done"), "Pick a typeface", { completed_at: new Date(Date.now() - 2 * 86400_000).toISOString() })
  })
