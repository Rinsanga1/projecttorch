// Board: the board, new column, column ••• menu, new card, card (with steps), edit card.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDate, isoDate, type Raw } from "../lib/html.ts"
import { get, post, redirect, back, render, str, ids, errors, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor, titleOf,
  peopleCheckboxes, clientSwitch, textField, textArea, byLine, clientFilter, trackVisit, personById, notify, logEvent,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Person } from "../lib/web.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import type { Seed } from "../seed.ts"
import { kit, pageHead, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// The table: columns side by side (scrolling sideways when they don't fit), cards as white cards in each column.
const DOT: Record<string, string> = { red: "#e5484d", orange: "#f99c00", yellow: "#f5c518", green: "#30a46c", blue: "#3e7bfa", purple: "#8e4ec6", gray: "#8b8d98" }
const ks = stylex.create({
  board: {
    display: "grid", gridAutoFlow: "column", gridAutoColumns: "min(256px, 82vw)", gap: space.s3, alignItems: "start",
    overflowX: "auto", overscrollBehaviorX: "contain", scrollSnapType: "x proximity", paddingBottom: space.s3, marginBottom: space.s5,
  },
  column: { scrollSnapAlign: "start", backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s3, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: space.s2 },
  colHead: { display: "flex", alignItems: "center", gap: space.s2, paddingInline: 6, paddingTop: 4, margin: 0, fontSize: text.base },
  dot: (bg: string) => ({ backgroundColor: bg }),
  dotBox: { width: 9, height: 9, borderRadius: radius.pill, flexShrink: 0 },
  count: {
    marginLeft: "auto", minWidth: 22, paddingBlock: 3, paddingInline: 7, borderRadius: radius.pill, backgroundColor: color.sheet,
    fontSize: text.xs, fontWeight: 700, textAlign: "center", fontVariantNumeric: "tabular-nums",
  },
  colMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s3, paddingInline: 6, margin: 0, fontSize: text.xs, color: color.muted },
  cards: { margin: 0, display: "grid", gap: space.s2 },
  card: { borderTopWidth: 0, padding: space.s3, borderRadius: radius.lg, backgroundColor: color.sheet, display: "grid", gap: 6 },
  cardTitle: { fontWeight: 600, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  cardMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s2, fontSize: text.xs, color: color.muted },
  cardActions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  small: { minHeight: 28, paddingBlock: 2, fontSize: text.xs, whiteSpace: "nowrap" },
  smallSelect: { minHeight: 28, paddingBlock: 2, paddingLeft: 8, fontSize: text.xs, maxWidth: "9.5rem", margin: 0 },
  none: { margin: 0, paddingInline: 6, paddingBlock: space.s2, fontSize: text.sm, color: color.muted },
  held: { margin: 0, marginTop: space.s2, paddingInline: 6, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  add: { display: "flex", gap: 6, margin: 0 },
  addInput: { flexGrow: 1, minWidth: 0, width: "auto", minHeight: 32, paddingBlock: 3, fontSize: text.sm, margin: 0, backgroundColor: color.sheet },
})

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const KIND_ORDER: Record<string, number> = { triage: 0, custom: 1, not_now: 2, done: 3 }

/** Columns in display order: New, your columns, Later, Done. */
const sortColumns = (cols: ReadonlyArray<Recording>) =>
  [...cols].sort((a, b) => (KIND_ORDER[a.data.kind ?? "custom"]! - KIND_ORDER[b.data.kind ?? "custom"]!) || a.position - b.position || a.id - b.id)

/** Every board starts with New, Later and Done. Made on first visit. */
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

const names = (people: ReadonlyArray<Person>, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const columnSelect = (cols: ReadonlyArray<Recording>, current: number | null, name = "column_id", small = false) =>
  html`<select name="${name}"${small ? sx(ks.smallSelect) : ""}>${cols.map((col) => html`<option value="${col.id}"${col.id === current ? raw(" selected") : ""}>${col.title}</option>`)}</select>`

/** Move a card to a column: Done stamps it completed, leaving Done clears that. Watchers hear about it. */
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

const crumbs = (p: Project) => projectCrumbs(p, "cardtable")

export const routes = [
  get("/projects/:id/board", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const cols = yield* ensureColumns(c, p)
      const people = yield* projectPeople(p)
      const cards = yield* sql<Recording & { steps_total: number; steps_done: number }>`
        select r.*,
          (select count(*) from recordings s where s.parent_id = r.id and s.type = 'step' and s.status = 'active')::int as steps_total,
          (select count(*) from recordings s where s.parent_id = r.id and s.type = 'step' and s.status = 'active' and s.data->>'completed_at' is not null)::int as steps_done
        from recordings r where r.project_id = ${p.id} and r.type = 'card' and r.status = 'active' ${clientFilter(sql, c.me, "r")}
        order by r.position, r.id`
      const collapsed = (c.query.get("collapsed") ?? "").split(",").map(Number).filter(Boolean)
      const toggle = (id: number) => {
        const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
        return next.length ? `?collapsed=${next.join(",")}` : "?"
      }
      const active = p.status === "active"
      const cardItem = (k: Recording & { steps_total: number; steps_done: number }, col: Recording) => html`<li${sx(ks.card)}>
        <a href="${urlFor(k)}"${sx(ks.cardTitle)}>${k.title}</a>
        ${k.data.assignee_ids?.length || k.data.due_on || k.steps_total ? html`<span${sx(ks.cardMeta)}>
          ${k.data.assignee_ids?.length ? html`<span>${names(people, k.data.assignee_ids)}</span>` : ""}
          ${k.data.due_on ? html`<span>due ${fmtDate(k.data.due_on)}</span>` : ""}
          ${k.steps_total ? html`<span>steps ${k.steps_done}/${k.steps_total}</span>` : ""}
        </span>` : ""}
        ${active ? html`<span${sx(ks.cardActions)}><form method="post" action="/projects/${p.id}/cards/${k.id}/move" style="display:inline"><label><span${sx(kit.srOnly)}>Move to…</span>${columnSelect(cols, col.id, "column_id", true)}</label> <button${sx(ks.small)}>Move</button></form>
        ${col.data.on_hold ? html`<form method="post" action="/projects/${p.id}/cards/${k.id}/hold" style="display:inline"><button${sx(ks.small)}>${k.data.on_hold ? "Take off hold" : "Put on hold"}</button></form>` : ""}</span>` : ""}
      </li>`
      yield* trackVisit(c, toolUrl(p, "cardtable"), `${p.name}: Board`, p.id)
      return yield* render(c, "Board", html`
${pageHead("Board", active && !isClient(c.me) ? html`<a href="/projects/${p.id}/columns/new" data-button>Add a column</a>` : "")}
${cards.length === 0 ? html`<p>Move cards from column to column as work gets done. Add your first card to New, or set up your columns first.</p>` : ""}
<div${sx(ks.board)}>
${cols.map((col) => {
  const inCol = cards.filter((k) => k.parent_id === col.id)
  const held = col.data.on_hold ? inCol.filter((k) => k.data.on_hold) : []
  const moving = inCol.filter((k) => !held.includes(k))
  return html`
<section id="column-${col.id}" aria-label="${col.title}"${sx(ks.column)}>
  <h2${sx(ks.colHead)}>${col.data.color ? html`<span title="${col.data.color}"${sx(ks.dotBox, ks.dot(DOT[col.data.color] ?? DOT.gray!))}></span>` : ""}${col.title}<span${sx(ks.count)}>${inCol.length}</span></h2>
  <p${sx(ks.colMeta)}>
    ${col.data.watcher_ids?.length ? html`<span>Watching: ${names(people, col.data.watcher_ids)}</span>` : ""}
    <a href="${toggle(col.id)}#column-${col.id}">${collapsed.includes(col.id) ? "Expand" : "Collapse"}</a>
    ${!isClient(c.me) ? html`<a href="/projects/${p.id}/columns/${col.id}" aria-label="${col.title} column options">•••</a>` : ""}
  </p>
  ${collapsed.includes(col.id) ? "" : html`
  ${moving.length ? html`<ul${sx(ks.cards)}>${moving.map((k) => cardItem(k, col))}</ul>` : html`<p${sx(ks.none)}>No cards here.</p>`}
  ${col.data.on_hold ? html`<h3${sx(ks.held)}>On hold</h3>${held.length ? html`<ul${sx(ks.cards)}>${held.map((k) => cardItem(k, col))}</ul>` : html`<p${sx(ks.none)}>Nothing on hold.</p>`}` : ""}
  ${active && col.data.kind !== "done" ? html`<form method="post" action="/projects/${p.id}/cards"${sx(ks.add)}>
    <input type="hidden" name="column_id" value="${col.id}">
    <input name="title" required placeholder="Card title" aria-label="Card title"${sx(ks.addInput)}> <button${sx(ks.small)}>Add a card</button>
  </form>` : ""}`}
</section>`
})}
</div>
${active && !isClient(c.me) && cols.some((col) => col.data.kind === "custom") ? html`
<h2>Reorder your columns</h2>
<form method="post" action="/projects/${p.id}/columns/order">
  ${cols.filter((col) => col.data.kind === "custom").map((col, i) => html`<label>${col.title} <input type="number" name="pos_${col.id}" value="${i + 1}" min="1" size="3"></label><br>`)}
  <button>Save order</button>
</form>` : ""}`, projectCrumbs(p))
    })),

  // Columns
  get("/projects/:id/columns/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "New column", columnForm(p, "", "", []), crumbs(p))
    })),

  post("/projects/:id/columns", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* ensureColumns(c, p)
      const fd = yield* c.form
      const title = str(fd, "name")
      const color = COLORS.includes(str(fd, "color")) ? str(fd, "color") : ""
      if (!title) return yield* render(c, "New column", columnForm(p, title, color, ["Your column needs a name."]), crumbs(p), 422)
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

  get("/projects/:id/columns/:colid", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const cols = yield* ensureColumns(c, p)
      const col = yield* findColumn(c, p, c.params.colid)
      const watching = (col.data.watcher_ids ?? []).includes(c.me.id)
      const others = cols.filter((x) => x.id !== col.id)
      return yield* render(c, `${col.title} column`, html`
<h1>${col.title} column</h1>
<form method="post" action="/projects/${p.id}/columns/${col.id}">
  <p><label>Rename <input name="name" value="${col.title}" required></label></p>
  <p><label>Color ${colorSelect(col.data.color ?? "")}</label></p>
  <button>Save changes</button>
</form>
<form method="post" action="/projects/${p.id}/columns/${col.id}/watch">
  <p>${watching ? "You're watching this column. You get notified when cards land in it." : "Watch this column to get notified when cards land in it."}</p>
  <button>${watching ? "Stop watching this column" : "Watch this column"}</button>
</form>
<form method="post" action="/projects/${p.id}/columns/${col.id}/hold">
  <p><button>${col.data.on_hold ? "Remove the On hold section" : "Add an On hold section to the column"}</button></p>
</form>
<form method="post" action="/projects/${p.id}/columns/${col.id}/move-all">
  <p><label>Move all cards to… ${columnSelect(others, null)}</label> <button>Move all cards</button></p>
</form>
${col.data.kind === "custom" ? html`<form method="post" action="/projects/${p.id}/columns/${col.id}/delete"><p><button>Delete this column</button></p></form>` : html`<p><small>${col.title} comes with every board, so it can't be deleted.</small></p>`}
<p><a href="${toolUrl(p, "cardtable")}#column-${col.id}">Back to the board</a></p>`, crumbs(p))
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

  get("/projects/:id/cards/:cid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const cols = yield* ensureColumns(c, project)
      const col = cols.find((x) => x.id === r.parent_id)
      const people = yield* projectPeople(project)
      const steps = yield* sql<Recording>`select * from recordings where parent_id = ${r.id} and type = 'step' and status = 'active' order by position, id`
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      const live = r.status === "active" && project.status === "active"
      yield* trackVisit(c, urlFor(r), r.title, project.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  ${live ? html`<form method="post" action="/projects/${project.id}/cards/${r.id}/move"><label>In column ${columnSelect(cols, r.parent_id)}</label> <button>Move</button></form>` : html`<p>In column: ${col?.title ?? "?"}</p>`}
  ${r.data.on_hold ? html`<p>⏸ On hold</p>` : ""}
  ${r.data.completed_at ? html`<p>✓ Done ${fmtDate(r.data.completed_at, c.me.time_zone)}</p>` : ""}
  <h1>${r.title}</h1>
  ${byLine(author, r.created_at, c.me.time_zone)}
  <p>Assigned to: ${names(people, r.data.assignee_ids) || "Nobody"}</p>
  <p>Due on: ${r.data.due_on ? fmtDate(r.data.due_on) : "No due date"}</p>
  ${r.body ? html`<div>${fmt(r.body)}</div>` : html`<p><small>No notes.</small></p>`}
  ${live ? html`<p><a href="/projects/${project.id}/cards/${r.id}/edit">Edit</a></p>
  ${col?.data.kind !== "done" ? html`<form method="post" action="/projects/${project.id}/cards/${r.id}/done"><button>Mark as done</button></form>` : ""}
  ${col?.data.on_hold ? html`<form method="post" action="/projects/${project.id}/cards/${r.id}/hold"><button>${r.data.on_hold ? "Take off hold" : "Put on hold"}</button></form>` : ""}` : ""}
</article>
<section aria-label="Steps">
  <h2>Steps</h2>
  ${steps.length ? html`<ul>${steps.map((s) => html`<li id="step-${s.id}">
    <form method="post" action="/projects/${project.id}/steps/${s.id}/toggle" style="display:inline"><button aria-label="${s.data.completed_at ? "Uncheck" : "Check off"} ${s.title}">${s.data.completed_at ? "☑" : "☐"}</button></form>
    ${s.data.completed_at ? html`<s>${s.title}</s>` : s.title}
    ${s.data.assignee_ids?.length ? html` · ${names(people, s.data.assignee_ids)}` : ""}
    ${s.data.due_on ? html` · due ${fmtDate(s.data.due_on)}` : ""}
    ${live ? html` <small><a href="/r/${s.id}/trash">Remove</a></small>` : ""}</li>`)}</ul>` : html`<p><small>No steps yet. Break the card into steps, each with its own assignee and due date.</small></p>`}
  ${live ? html`<form method="post" action="/projects/${project.id}/cards/${r.id}/steps">
    <label>Step <input name="title" required></label>
    <label>Assign to <select name="assignee_id"><option value="">Nobody</option>${people.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</select></label>
    <label>Due on <input type="date" name="due_on"></label>
    <button>Add a step</button>
  </form>` : ""}
</section>
${yield* itemFooter(c, r, project)}`, crumbs(project))
    })),

  get("/projects/:id/cards/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const people = yield* projectPeople(project)
      return yield* render(c, "Edit card", cardForm(project, people, r, []), crumbs(project))
    })),

  post("/projects/:id/cards/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.cid, "card")
      const people = yield* projectPeople(project)
      const fd = yield* c.form
      const pool = people.map((p) => p.id)
      const assignees = ids(fd, "assignee_ids").filter((id) => pool.includes(id))
      const ch = { title: str(fd, "title"), body: str(fd, "body"), data: { assignee_ids: assignees, due_on: str(fd, "due_on") || null }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!ch.title) return yield* render(c, "Edit card", cardForm(project, people, { ...r, ...ch, data: { ...r.data, ...ch.data } }, ["Your card needs a title."]), crumbs(project), 422)
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

const colorSelect = (current: string) =>
  html`<select name="color">${COLORS.map((col) => html`<option value="${col}"${col === current ? raw(" selected") : ""}>${col || "No color"}</option>`)}</select>`

const columnForm = (p: Project, name: string, color: string, errs: string[]): Raw => html`
<h1>New column</h1>
${errors(errs)}
<form method="post" action="/projects/${p.id}/columns">
  ${textField("Name this column", "name", name, { required: true })}
  <p><label>Color ${colorSelect(color)}</label></p>
  <p><button>Add column</button> <a href="${toolUrl(p, "cardtable")}">Cancel</a></p>
</form>`

const cardForm = (p: Project, people: ReadonlyArray<Person & { company_name?: string | null }>, r: Recording, errs: string[]) => html`
<h1>Edit card</h1>
${errors(errs)}
<form method="post" action="/projects/${p.id}/cards/${r.id}/edit">
  ${textField("Card title", "title", r.title, { required: true })}
  <p>Assigned to</p>
  ${peopleCheckboxes("assignee_ids", people, r.data.assignee_ids ?? [])}
  <p><label>Due on <input type="date" name="due_on" value="${isoDate(r.data.due_on)}"></label></p>
  ${textArea("Notes", "body", r.body)}
  ${clientSwitch(p, people, r.visible_to_clients)}
  <p><button>Save changes</button> <a href="${urlFor(r)}">Cancel</a></p>
</form>`

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
