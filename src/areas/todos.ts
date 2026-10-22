// To-dos: the lists index, new list, a list with its groups, add a to-do, a to-do, and the Hill Chart.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, excerpt, fmtDate, fmtDateTime, daysFromToday, plural, today, isoDate } from "../lib/html.ts"
import { get, post, redirect, back, render, str, ids, num, errors, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor, titleOf,
  notify, logEvent, subscribe, peopleCheckboxes, clientSwitch, textField, textArea, byLine, clientFilter, trackVisit, personById,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Person } from "../lib/web.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import type { Seed } from "../seed.ts"
import { hill, kit, pageHead, sx } from "../lib/ui.ts"
import { color, media, motion, radius, space, text } from "../lib/tokens.stylex.ts"

const ts = stylex.create({
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, paddingBlock: 10 },
  title: { fontWeight: 500, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  meta: { display: "inline-flex", flexWrap: "wrap", columnGap: space.s3 },
  move: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: space.s2 },
  moveSelect: { minHeight: 30, paddingBlock: 3, fontSize: text.sm },
  moveButton: { minHeight: 30, paddingBlock: 4 },
  check: {
    width: 22, height: 22, minHeight: 22, padding: 0, flexShrink: 0, borderRadius: 7, backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.accentSoft } },
    borderWidth: 1.5, borderStyle: "solid", borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.focus } }, color: color.onAccent,
    transitionProperty: "background-color, border-color", transitionDuration: motion.fast,
  },
  checkDone: { backgroundColor: color.accent, borderColor: { default: color.accent, ":hover": { default: null, [media.hover]: color.focus } } },
  checkLarge: { width: 28, height: 28, minHeight: 28, borderRadius: 9, verticalAlign: "-3px", marginRight: space.s2 },
  done: { color: color.muted },
  static: { display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" },
})

const tick = (size: number) => raw(`<svg width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`)
/** The same box, not clickable, for read-only lists. */
const checkMark = (t: Recording) => html`<span role="img" aria-label="${t.data.completed_at ? "Done" : "Not done"}"${sx(ts.check, ts.static, !!t.data.completed_at && ts.checkDone)}>${t.data.completed_at ? tick(12) : ""}</span>`
// The lists as cards with a progress bar; the Hill Chart drawn as the hill, one orange dot per tracked list.
const ls = stylex.create({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  card: {
    position: "relative", borderTopWidth: 0, padding: space.s5, borderRadius: radius.xl, display: "grid", gap: space.s2, alignContent: "start", minHeight: 140,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  cardTitle: { fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit" } },
  cardText: { margin: 0, fontSize: text.sm, color: color.muted },
  bar: { height: 6, borderRadius: radius.pill, backgroundColor: color.sheet, overflow: "hidden", marginTop: "auto" },
  fill: (w: string) => ({ width: w }),
  fillBox: { height: "100%", borderRadius: radius.pill, backgroundColor: color.accent },
  count: { fontSize: text.xs, fontWeight: 600, color: color.muted, fontVariantNumeric: "tabular-nums" },
  hillCard: { padding: { default: space.s3, "@media (min-width: 768px)": space.s5 }, borderRadius: radius.xl, backgroundColor: color.tile, marginBottom: space.s5 },
  hillHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: space.s2 },
  hillTitle: { margin: 0, fontSize: text.md },
  svg: { display: "block", width: "100%", height: "auto", overflow: "visible" },
  line: { fill: "none", stroke: color.ink, strokeWidth: 2 },
  base: { stroke: color.line, strokeWidth: 1 },
  divide: { stroke: color.control, strokeWidth: 1, strokeDasharray: "3 5" },
  side: { fill: color.muted, fontSize: { default: 13, "@media (max-width: 640px)": 22 } },
  dot: { fill: color.accent, stroke: color.tile, strokeWidth: 3 },
  label: { fill: color.ink, fontSize: { default: 13, "@media (max-width: 640px)": 22 }, fontWeight: 600 },
  history: { margin: 0 },
})

/** The Hill Chart: each list's dot at its position, labelled on the side away from the top. */
// ponytail: labels stack by order to avoid overlap; dots at the same spot still sit on top of each other
const hillChart = (items: ReadonlyArray<{ label: string; value: number }>) => html`<svg viewBox="-150 0 900 262" role="img" aria-label="Progress hill: ${items.map((i) => `${i.label} at ${i.value}, ${hillLabel(i.value).toLowerCase()}`).join("; ")}"${sx(ls.svg)}>
  <line x1="0" y1="210" x2="600" y2="210"${sx(ls.base)}/>
  <line x1="300" y1="30" x2="300" y2="210"${sx(ls.divide)}/>
  <path d="${hill.curve([hill.UP, hill.DOWN])}"${sx(ls.line)}/>
  <text x="150" y="246" text-anchor="middle"${sx(ls.side)}>Working it out</text>
  <text x="450" y="246" text-anchor="middle"${sx(ls.side)}>Getting it done</text>
  ${items.map((i, n) => {
    const [x, y] = hill.at(i.value)
    const right = i.value > 50
    return html`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="8"${sx(ls.dot)}/><text x="${right ? 14 : -14}" y="${-8 - (n % 3) * 16}" text-anchor="${right ? "start" : "end"}"${sx(ls.label)}>${i.label}</text></g>`
  })}
</svg>`

/** The round-trip "done" toggle: a box that fills orange with a check. */
const checkButton = (p: Project, t: Recording, large = false) => html`<form method="post" action="/projects/${p.id}/tasks/${t.id}/complete" style="display:inline"><button aria-label="${t.data.completed_at ? "Mark as not done" : "Mark as done"}" title="${t.data.completed_at ? "Mark as not done" : "Mark as done"}"${sx(ts.check, !!t.data.completed_at && ts.checkDone, large && ts.checkLarge)}>${t.data.completed_at ? tick(large ? 16 : 12) : ""}</button></form>`

type People = ReadonlyArray<Person & { company_name?: string | null }>

/** done/total to-dos per list, counting to-dos inside the list's groups too. */
const listStats = (listIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (!listIds.length) return new Map<number, { done: number; total: number }>()
    const rows = yield* sql<{ id: number; done: number; total: number }>`
      select l.id,
        count(t.id) filter (where t.data->>'completed_at' is not null)::int as done,
        count(t.id)::int as total
      from recordings l
      left join recordings t on t.type = 'todo' and t.status = 'active'
        and (t.parent_id = l.id or t.parent_id in (select g.id from recordings g where g.parent_id = l.id and g.type = 'todogroup' and g.status = 'active'))
      where l.id in ${sql.in([...listIds])} group by l.id`
    return new Map(rows.map((r) => [r.id, { done: r.done, total: r.total }]))
  })

/** The list a to-do or group belongs to. */
const listOf = (c: Ctx, r: Recording) =>
  Effect.gen(function* () {
    let parentId = r.parent_id
    const { r: parent } = yield* findRecording(c, parentId ?? 0, ["todolist", "todogroup"])
    if (parent.type === "todolist") return { list: parent, group: null as Recording | null }
    const { r: list } = yield* findRecording(c, parent.parent_id ?? 0, "todolist")
    return { list, group: parent }
  })

const names = (people: People, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const dueText = (t: Recording) => {
  const d = t.data
  if (!d.due_on) return ""
  const when = d.starts_on ? `${fmtDate(d.starts_on)} – ${fmtDate(d.due_on)}` : fmtDate(d.due_on)
  const late = !d.completed_at ? -daysFromToday(d.due_on) : 0
  return late > 0 ? `${when} (${plural(late, "day")} late)` : when
}

/** One to-do row on a list: checkbox, title, who, when, comments, "Move to…". */
const todoRow = (p: Project, t: Recording & { comments?: number }, people: People, moveTargets: ReadonlyArray<{ id: number; label: string }>, readOnly: boolean) => html`
<li id="todo-${t.id}"${sx(ts.row)}>
  ${readOnly ? checkMark(t) : checkButton(p, t)}
  <a href="${urlFor(t)}"${sx(ts.title, !!t.data.completed_at && ts.done)}>${t.data.completed_at ? html`<s>${t.title}</s>` : t.title}</a>
  <span${sx(ts.meta)}>
  ${t.data.assignee_ids?.length ? html`<small>${names(people, t.data.assignee_ids)}</small>` : ""}
  ${t.data.due_on ? html`<small>${dueText(t)}</small>` : ""}
  ${t.comments ? html`<small>${plural(t.comments, "comment")}</small>` : ""}
  ${t.body ? html`<small>📝 notes</small>` : ""}
  </span>
  ${!readOnly && !t.data.completed_at && moveTargets.length > 1 ? html`
  <form method="post" action="/projects/${p.id}/tasks/${t.id}/move-group" style="display:inline"${sx(ts.move)}>
    <label><small>Move to…</small> <select name="parent_id"${sx(ts.moveSelect)}>${moveTargets.map((m) => html`<option value="${m.id}"${m.id === t.parent_id ? raw(" selected") : ""}>${m.label}</option>`)}</select></label>
    <button${sx(ts.moveButton)}>Move</button>
  </form>` : ""}
</li>`

/** Fields for adding or editing a to-do. */
const todoFields = (people: People, t: Partial<Recording> & { data?: any }, groups: ReadonlyArray<Recording> = [], groupId?: number | null) => {
  const d = t.data ?? {}
  const mode = d.starts_on ? "range" : d.due_on ? "day" : "none"
  return html`
  ${textField("Task", "title", t.title ?? "", { placeholder: "What needs to be done?" })}
  ${groups.length ? html`<p><label>In group<br><select name="group_id"><option value="">No group</option>
    ${groups.map((g) => html`<option value="${g.id}"${g.id === groupId ? raw(" selected") : ""}>${g.title}</option>`)}</select></label></p>` : ""}
  <fieldset><legend>Assigned to</legend>${peopleCheckboxes("assignee_ids", people, d.assignee_ids ?? [])}</fieldset>
  <fieldset><legend>When done, notify</legend>${peopleCheckboxes("notify_ids", people, d.notify_ids ?? [])}</fieldset>
  <fieldset><legend>Due on</legend>
    <label><input type="radio" name="due" value="none"${mode === "none" ? raw(" checked") : ""}> No due date</label><br>
    <label><input type="radio" name="due" value="day"${mode === "day" ? raw(" checked") : ""}> A specific day:</label>
      <input type="date" name="due_day" value="${mode === "day" ? isoDate(d.due_on) : ""}" aria-label="Due day"><br>
    <label><input type="radio" name="due" value="range"${mode === "range" ? raw(" checked") : ""}> Runs over multiple days:</label>
      <input type="date" name="range_start" value="${isoDate(d.starts_on)}" aria-label="Starts"> to
      <input type="date" name="range_end" value="${mode === "range" ? isoDate(d.due_on) : ""}" aria-label="Ends">
  </fieldset>
  ${textArea("Notes", "body", t.body ?? "", "Add extra details or attach a file…")}`
}

/** Read the to-do fields. */
const readTodo = (fd: FormData, pool: ReadonlyArray<number>) => {
  const due = str(fd, "due")
  const due_on = due === "day" ? str(fd, "due_day") || null : due === "range" ? str(fd, "range_end") || null : null
  const starts_on = due === "range" ? str(fd, "range_start") || null : null
  const errs = [
    ...(str(fd, "title") ? [] : ["Write something first."]),
    ...(due === "day" && !due_on ? ["Pick the day it's due."] : []),
    ...(due === "range" && (!starts_on || !due_on) ? ["Pick both the start and end day."] : []),
    ...(starts_on && due_on && due_on < starts_on ? ["The end date has to come after the start date."] : []),
  ]
  return {
    errs,
    title: str(fd, "title"),
    body: str(fd, "body"),
    data: {
      assignee_ids: ids(fd, "assignee_ids").filter((id) => pool.includes(id)),
      notify_ids: ids(fd, "notify_ids").filter((id) => pool.includes(id)),
      due_on,
      starts_on,
    },
  }
}

const tellAssignees = (c: Ctx, t: Recording, personIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    if (!personIds.length) return
    yield* subscribe(t.id, personIds)
    yield* notify(c, { personIds, recording: t, kind: "assigned", summary: `${c.me.name} assigned you a task: ${t.title}` })
  })

const listCrumbs = (p: Project, list: Recording) => [...projectCrumbs(p, "todos"), [list.title, urlFor(list)] as const]

const listForm = (p: Project, people: People, l: Partial<Recording>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${l.id ? `/projects/${p.id}/lists/${l.id}/edit` : `/projects/${p.id}/lists`}">
  ${textField("Name this list…", "title", l.title ?? "", { required: true })}
  ${textArea("Notes", "body", l.body ?? "", "Add extra details or attach a file…")}
  ${clientSwitch(p, people, l.visible_to_clients)}
  <p><button>${l.id ? "Save changes" : "Add this list"}</button> <a href="${l.id ? urlFor(l as Recording) : toolUrl(p, "todos")}">Cancel</a></p>
</form>`

/** Latest hill position for each list, from the newest update that mentions it. */
const hillPositions = (projectId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const ups = yield* sql<{ positions: Record<string, number> }>`select positions from hill_updates where project_id = ${projectId} order by id`
    const pos = new Map<number, number>()
    for (const u of ups) for (const [k, v] of Object.entries(u.positions)) pos.set(Number(k), v)
    return pos
  })

const hillLabel = (v: number) => (v < 50 ? "Working it out" : v < 100 ? "Getting it done" : "Done")

export const routes = [
  get("/projects/:id/tasks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const lists = yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'todolist' and status = 'active' ${clientFilter(sql, c.me, "r")} order by position, id`
      const stats = yield* listStats(lists.map((l) => l.id))
      const tracked = lists.filter((l) => l.data.tracked)
      const pos = yield* hillPositions(p.id)
      const reorder = c.query.get("reorder") === "1" && !isClient(c.me)
      yield* trackVisit(c, toolUrl(p, "todos"), `${p.name}: Tasks`, p.id)
      return yield* render(c, "Tasks", html`
${pageHead("Tasks", p.status === "active" ? html`<a href="/projects/${p.id}/lists/new" data-button>New list</a>` : "")}
${lists.length === 0
  ? html`<p${sx(kit.empty)}>Make lists of work. Give each task to someone and set a due date.</p>`
  : reorder
    ? html`<form method="post" action="/projects/${p.id}/lists/reorder"><ol>${lists.map((l, i) => html`<li><label>${l.title} <input type="number" name="pos_${l.id}" value="${i + 1}" min="1" size="3" aria-label="Position"></label></li>`)}</ol>
        <button>Save order</button> <a href="${toolUrl(p, "todos")}">Cancel</a></form>`
    : html`<ul${sx(ls.grid)}>${lists.map((l) => {
        const s = stats.get(l.id) ?? { done: 0, total: 0 }
        return html`<li${sx(ls.card)}><a href="${urlFor(l)}"${sx(ls.cardTitle)}>${l.title}</a>${l.body ? html`<p${sx(ls.cardText)}>${excerpt(l.body)}</p>` : ""}
          <span${sx(ls.count)}>${s.done}/${s.total} completed</span>
          <span${sx(ls.bar)} aria-hidden="true"><span${sx(ls.fillBox, ls.fill(`${s.total ? Math.round((s.done / s.total) * 100) : 0}%`))}></span></span></li>`
      })}</ul>`}
${tracked.length ? html`<section aria-label="Progress"${sx(ls.hillCard)}><div${sx(ls.hillHead)}><h2${sx(ls.hillTitle)}><a href="/projects/${p.id}/progress">Progress</a></h2></div>
  ${hillChart(tracked.map((l) => ({ label: l.title, value: pos.get(l.id) ?? 0 })))}</section>` : ""}
<p${sx(kit.links)}>${lists.length > 1 && !isClient(c.me) && !reorder ? html`<a href="?reorder=1">Reorder lists</a>` : ""}<a href="/projects/${p.id}/progress">Progress</a><a href="/projects/${p.id}/trash">Archived lists</a></p>`, projectCrumbs(p))
    })),

  post("/projects/:id/lists/reorder", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = num(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${p.id} and type = 'todolist'`
      }
      return redirect(toolUrl(p, "todos"), "Order saved.")
    })),

  get("/projects/:id/lists/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const people = yield* projectPeople(p)
      return yield* render(c, "New list", html`<h1>New list</h1>${listForm(p, people, {}, [])}`, projectCrumbs(p, "todos"))
    })),

  post("/projects/:id/lists", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const l = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!l.title) return yield* render(c, "New list", html`<h1>New list</h1>${listForm(p, people, l, ["Your list needs a name."])}`, projectCrumbs(p, "todos"), 422)
      const r = yield* createRecording(c, { project: p, type: "todolist", ...l, verb: "made a task list" })
      return redirect(urlFor(r))
    })),

  get("/projects/:id/lists/:lid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      const people = yield* projectPeople(p)
      const groups = yield* sql<Recording>`select * from recordings where parent_id = ${list.id} and type = 'todogroup' and status = 'active' order by position, id`
      const todos = yield* sql<Recording & { comments: number }>`
        select t.*, (select count(*) from recordings x where x.parent_id = t.id and x.type = 'comment' and x.status = 'active')::int as comments
        from recordings t where t.type = 'todo' and t.status = 'active'
          and (t.parent_id = ${list.id} or t.parent_id in (select id from recordings where parent_id = ${list.id} and type = 'todogroup' and status = 'active'))
        order by t.position, t.id`
      const open = todos.filter((t) => !t.data.completed_at)
      const done = todos.filter((t) => t.data.completed_at).sort((a, b) => String(b.data.completed_at).localeCompare(String(a.data.completed_at)))
      const showDone = c.query.get("completed") === "1"
      const reorder = c.query.get("reorder") === "1"
      const readOnly = list.status !== "active"
      const targets = [{ id: list.id, label: "No group" }, ...groups.map((g) => ({ id: g.id, label: g.title }))]
      const hasClients = people.some(isClient)
      yield* trackVisit(c, urlFor(list), list.title, p.id)
      const composer = (groupId: number | null) => html`
<details${open.length === 0 && groups.length === 0 ? raw(" open") : ""}><summary>Add a task</summary>
  <form method="post" action="/projects/${p.id}/lists/${list.id}/tasks">
    ${groupId ? html`<input type="hidden" name="group_id" value="${groupId}">` : ""}
    ${todoFields(people, {}, groupId ? [] : groups)}
    <p><button>Add this task</button></p>
  </form>
</details>`
      return yield* render(c, list.title, html`
${statusBanner(list)}
${clientBanner(c, list, hasClients)}
<h1>${list.title}</h1>
${list.body ? html`<div>${fmt(list.body)}</div>` : ""}
<p>${done.length}/${todos.length} completed${list.data.tracked ? " · On the progress hill" : ""}
  ${!readOnly && !isClient(c.me) ? html` · <a href="/projects/${p.id}/lists/${list.id}/edit">Edit</a>` : ""}</p>
${!readOnly && !isClient(c.me) ? html`<form method="post" action="/projects/${p.id}/lists/${list.id}/track"><button>${list.data.tracked ? "Take this list off the progress hill" : "Show this list on the progress hill"}</button>${list.data.tracked ? html` <a href="/projects/${p.id}/progress">See the hill</a>` : ""}</form>` : ""}
${reorder && !readOnly
  ? html`<form method="post" action="/projects/${p.id}/lists/${list.id}/reorder"><ol>${open.map((t, i) => html`<li><label>${t.title} <input type="number" name="pos_${t.id}" value="${i + 1}" min="1" size="3" aria-label="Position"></label></li>`)}</ol>
      <button>Save order</button> <a href="${urlFor(list)}">Cancel</a></form>`
  : html`
<ul>${open.filter((t) => t.parent_id === list.id).map((t) => todoRow(p, t, people, targets, readOnly))}</ul>
${!readOnly ? composer(null) : ""}
${groups.map((g) => html`
<section id="group-${g.id}" aria-label="${g.title}">
  <h2>${g.title}</h2>
  ${!readOnly ? html`<details><summary><small>Rename or remove this group</small></summary>
    <form method="post" action="/projects/${p.id}/groups/${g.id}"><input name="title" value="${g.title}" aria-label="Group name" required> <button>Rename</button></form>
    <p><a href="/r/${g.id}/trash">Put this group in the trash</a></p></details>` : ""}
  <ul>${open.filter((t) => t.parent_id === g.id).map((t) => todoRow(p, t, people, targets, readOnly))}</ul>
  ${!readOnly ? composer(g.id) : ""}
</section>`)}
${open.length === 0 && todos.length > 0 ? html`<p>Everything on this list is done.</p>` : ""}
${!readOnly ? html`<form method="post" action="/projects/${p.id}/lists/${list.id}/groups"><p><label>Add a group <input name="title" placeholder="Name this group" required></label> <button>Add this group</button></p></form>` : ""}
${open.length > 1 && !readOnly ? html`<p><a href="?reorder=1">Reorder tasks</a></p>` : ""}`}
${done.length ? showDone
  ? html`<h2>Completed</h2><ul>${done.map((t) => todoRow(p, t, people, targets, readOnly))}</ul><p><a href="${urlFor(list)}">Hide done tasks</a></p>`
  : html`<p><a href="?completed=1">Show ${plural(done.length, "done task")}</a></p>` : ""}
${yield* itemFooter(c, list, p)}`, projectCrumbs(p, "todos"))
    })),

  get("/projects/:id/lists/:lid/edit", (c) =>
    Effect.gen(function* () {
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      if (isClient(c.me) && list.creator_id !== c.me.id) return yield* new NoAccess()
      const people = yield* projectPeople(p)
      return yield* render(c, "Edit list", html`<h1>Edit list</h1>${listForm(p, people, list, [])}`, listCrumbs(p, list))
    })),

  post("/projects/:id/lists/:lid/edit", (c) =>
    Effect.gen(function* () {
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      if (isClient(c.me) && list.creator_id !== c.me.id) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const ch = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: people.some(isClient) ? fd.get("visible_to_clients") === "on" : list.visible_to_clients }
      if (!ch.title) return yield* render(c, "Edit list", html`<h1>Edit list</h1>${listForm(p, people, { ...list, ...ch }, ["Your list needs a name."])}`, listCrumbs(p, list), 422)
      const u = yield* updateRecording(c, list, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  post("/projects/:id/lists/:lid/track", (c) =>
    Effect.gen(function* () {
      const { r: list } = yield* findRecording(c, c.params.lid, "todolist")
      if (isClient(c.me)) return yield* new NoAccess()
      yield* updateRecording(c, list, { data: { tracked: !list.data.tracked } }, { quiet: true })
      return redirect(urlFor(list), list.data.tracked ? "This list is off the progress hill." : { msg: "This list is on the progress hill.", href: `/projects/${list.project_id}/progress`, label: "Update the hill" })
    })),

  post("/projects/:id/lists/:lid/reorder", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list } = yield* findRecording(c, c.params.lid, "todolist")
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = num(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${list.project_id} and type = 'todo'`
      }
      return redirect(urlFor(list), "Order saved.")
    })),

  post("/projects/:id/lists/:lid/groups", (c) =>
    Effect.gen(function* () {
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      const title = str(yield* c.form, "title")
      if (!title) return redirect(urlFor(list), "Your group needs a name.")
      const g = yield* createRecording(c, { project: p, type: "todogroup", parent_id: list.id, title, visible_to_clients: true, verb: `added a group to ${list.title}` })
      return redirect(`${urlFor(list)}#group-${g.id}`)
    })),

  post("/projects/:id/groups/:gid", (c) =>
    Effect.gen(function* () {
      const { r: g } = yield* findRecording(c, c.params.gid, "todogroup")
      const title = str(yield* c.form, "title")
      if (!title) return redirect(urlFor(g), "Your group needs a name.")
      yield* updateRecording(c, g, { title }, { quiet: true })
      return redirect(urlFor(g), "Group renamed.")
    })),

  get("/projects/:id/lists/:lid/tasks/new", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      const people = yield* projectPeople(p)
      const groups = yield* sql<Recording>`select * from recordings where parent_id = ${list.id} and type = 'todogroup' and status = 'active' order by position`
      return yield* render(c, "Add a task", html`
<h1>Add a task to ${list.title}</h1>
<form method="post" action="/projects/${p.id}/lists/${list.id}/tasks">
  ${todoFields(people, {}, groups, num(c.query.get("group_id")))}
  <p><button>Add this task</button> <a href="${urlFor(list)}">Cancel</a></p>
</form>`, listCrumbs(p, list))
    })),

  post("/projects/:id/lists/:lid/tasks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      if (list.status !== "active") return yield* new NotFound()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const t = readTodo(fd, people.map((x) => x.id))
      const groupId = num(str(fd, "group_id"))
      if (groupId) {
        const [g] = yield* sql`select 1 from recordings where id = ${groupId} and parent_id = ${list.id} and type = 'todogroup'`
        if (!g) return yield* new NotFound()
      }
      if (t.errs.length) return redirect(`${urlFor(list)}${groupId ? `#group-${groupId}` : ""}`, t.errs[0])
      // Clients follow the list's visibility, so every task is visible and the list decides.
      const todo = yield* createRecording(c, { project: p, type: "todo", parent_id: groupId ?? list.id, title: t.title, body: t.body, data: { ...t.data, completed_at: null }, visible_to_clients: true, verb: "added a task" })
      yield* subscribe(todo.id, t.data.notify_ids)
      yield* tellAssignees(c, todo, t.data.assignee_ids)
      return redirect(`${urlFor(list)}#todo-${todo.id}`, "Added. Type the next one.")
    })),

  get("/projects/:id/tasks/:tid", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      const { list, group } = yield* listOf(c, t)
      const people = yield* projectPeople(p)
      const author = t.creator_id ? yield* personById(t.creator_id) : null
      const completer = t.data.completer_id ? yield* personById(t.data.completer_id) : null
      const readOnly = t.status !== "active"
      yield* trackVisit(c, urlFor(t), t.title, p.id)
      return yield* render(c, t.title, html`
${statusBanner(t)}
${clientBanner(c, list, people.some(isClient))}
<article>
  <p>In <a href="${urlFor(list)}">${list.title}</a>${group ? html` › <a href="${urlFor(group)}">${group.title}</a>` : ""}</p>
  <h1>
    ${readOnly ? "" : checkButton(p, t, true)}
    ${t.data.completed_at ? html`<s>${t.title}</s>` : t.title}
  </h1>
  ${t.data.completed_at ? html`<p>Completed by ${completer?.name ?? "someone"} on ${fmtDate(t.data.completed_at, c.me.time_zone)}</p>` : ""}
  <dl>
    <dt>Assigned to</dt><dd>${names(people, t.data.assignee_ids) || "Unassigned"}</dd>
    <dt>When done, notify</dt><dd>${names(people, t.data.notify_ids) || "Nobody"}</dd>
    <dt>Due on</dt><dd>${dueText(t) || "No due date"}</dd>
    <dt>Notes</dt><dd>${t.body ? fmt(t.body) : "None"}</dd>
    <dt>Added by</dt><dd>${author?.name ?? "Someone"} on ${fmtDateTime(t.created_at, c.me.time_zone)}</dd>
  </dl>
  <p>${!readOnly ? html`<a href="/projects/${p.id}/tasks/${t.id}/edit">Edit</a>` : ""}${!isClient(c.me) ? html` · <a href="/projects/${p.id}/tasks/${t.id}/time">Log time</a>` : ""}</p>
</article>
${yield* itemFooter(c, t, p)}`, listCrumbs(p, list))
    })),

  post("/projects/:id/tasks/:tid/complete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      const done = !t.data.completed_at
      const patch = done ? { completed_at: new Date().toISOString(), completer_id: c.me.id } : { completed_at: null, completer_id: null }
      const [u] = yield* sql<Recording>`update recordings set data = data || ${JSON.stringify(patch)}::jsonb, updated_at = now() where id = ${t.id} returning *`
      yield* logEvent(c, { project_id: p.id, recording_id: t.id, action: done ? "completed" : "uncompleted", summary: `${done ? "completed" : "un-completed"} ${t.title}` })
      if (done && t.data.notify_ids?.length)
        yield* notify(c, { personIds: t.data.notify_ids, recording: u!, kind: "completed", summary: `${c.me.name} completed: ${t.title}` })
      return back(c, urlFor(t), done ? { msg: `Completed “${t.title}”.`, href: `/projects/${p.id}/tasks/${t.id}/undo-complete`, label: "Undo" } : undefined)
    })),

  get("/projects/:id/tasks/:tid/undo-complete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t } = yield* findRecording(c, c.params.tid, "todo")
      yield* sql`update recordings set data = data || '{"completed_at":null,"completer_id":null}'::jsonb where id = ${t.id}`
      return redirect(urlFor(t), "Marked as not done.")
    })),

  post("/projects/:id/tasks/:tid/move-group", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t } = yield* findRecording(c, c.params.tid, "todo")
      const { list } = yield* listOf(c, t)
      const target = num(str(yield* c.form, "parent_id"))
      const [ok] = target ? yield* sql`select 1 from recordings where id = ${target} and (id = ${list.id} or (parent_id = ${list.id} and type = 'todogroup'))` : []
      if (!ok) return yield* new NotFound()
      yield* sql`update recordings set parent_id = ${target}, updated_at = now() where id = ${t.id}`
      return redirect(`${urlFor(list)}#todo-${t.id}`, "Moved.")
    })),

  get("/projects/:id/tasks/:tid/edit", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      const { list } = yield* listOf(c, t)
      const people = yield* projectPeople(p)
      return yield* render(c, "Edit task", html`
<h1>Edit task</h1>
<form method="post" action="/projects/${p.id}/tasks/${t.id}/edit">
  ${todoFields(people, t)}
  <p><button>Save changes</button> <a href="${urlFor(t)}">Cancel</a></p>
</form>`, listCrumbs(p, list))
    })),

  post("/projects/:id/tasks/:tid/edit", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      const { list } = yield* listOf(c, t)
      const people = yield* projectPeople(p)
      const n = readTodo(yield* c.form, people.map((x) => x.id))
      if (n.errs.length)
        return yield* render(c, "Edit task", html`
<h1>Edit task</h1>${errors(n.errs)}
<form method="post" action="/projects/${p.id}/tasks/${t.id}/edit">${todoFields(people, { ...t, title: n.title, body: n.body, data: { ...t.data, ...n.data } })}<p><button>Save changes</button> <a href="${urlFor(t)}">Cancel</a></p></form>`, listCrumbs(p, list), 422)
      const u = yield* updateRecording(c, t, { title: n.title, body: n.body, data: n.data })
      yield* subscribe(u.id, n.data.notify_ids)
      yield* tellAssignees(c, u, n.data.assignee_ids.filter((id) => !(t.data.assignee_ids ?? []).includes(id)))
      return redirect(urlFor(u), "Saved.")
    })),

  // Hill Chart
  get("/projects/:id/progress", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const lists = yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'todolist' and status = 'active' and (data->>'tracked')::boolean is true ${clientFilter(sql, c.me, "r")} order by position`
      const pos = yield* hillPositions(p.id)
      const ups = yield* sql<{ id: number; positions: Record<string, number>; note: string | null; created_at: Date; name: string | null }>`
        select h.*, pe.name from hill_updates h left join people pe on pe.id = h.person_id where project_id = ${p.id} order by h.id desc limit 50`
      const listName = (id: string) => lists.find((l) => l.id === Number(id))?.title
      const editing = c.query.get("update") === "1" && !isClient(c.me)
      return yield* render(c, "Progress", html`
${pageHead("Progress", lists.length && !editing && !isClient(c.me) ? html`<a href="?update=1" data-button>Update the hill</a>` : "")}
<p>Uphill (0–49): working it out. Downhill (50–100): getting it done.</p>
${lists.length === 0
  ? html`<p>No lists on the hill yet. Open a list and pick “Show this list on the progress hill.”</p><p><a href="${toolUrl(p, "todos")}">Go to the lists</a></p>`
  : editing
    ? html`<form method="post" action="/projects/${p.id}/progress">
        ${lists.map((l) => html`<p><label>${l.title}<br><input type="range" name="pos_${l.id}" min="0" max="100" step="5" value="${pos.get(l.id) ?? 0}" oninput="this.nextElementSibling.value=this.value"> <output>${pos.get(l.id) ?? 0}</output></label></p>`)}
        <p><label>Add a note to this update (optional)<br><input name="note" size="60"></label></p>
        <button>Save positions</button> <a href="/projects/${p.id}/progress">Cancel</a>
      </form>`
    : html`<div${sx(ls.hillCard)}>${hillChart(lists.map((l) => ({ label: l.title, value: pos.get(l.id) ?? 0 })))}</div>
      <ul>${lists.map((l) => html`<li><a href="${urlFor(l)}">${l.title}</a> <small>${pos.get(l.id) ?? 0} · ${hillLabel(pos.get(l.id) ?? 0)}</small></li>`)}</ul>`}
<section id="history" aria-label="Previous updates">
  <h2>See previous updates</h2>
  ${ups.length ? html`<ul>${ups.map((u) => html`<li>${fmtDateTime(u.created_at, c.me.time_zone)} · ${u.name ?? "Someone"}:
    ${Object.entries(u.positions).filter(([id]) => listName(id)).map(([id, v], i) => html`${i ? "; " : ""}${listName(id)} at ${v}`)}${u.note ? html` · “${u.note}”` : ""}</li>`)}</ul>` : html`<p>No updates yet.</p>`}
</section>`, projectCrumbs(p, "todos"))
    })),

  post("/projects/:id/progress", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const tracked = (yield* sql<{ id: number }>`select id from recordings where project_id = ${p.id} and type = 'todolist' and status = 'active' and (data->>'tracked')::boolean is true`).map((r) => r.id)
      const positions: Record<string, number> = {}
      for (const id of tracked) {
        const v = fd.get(`pos_${id}`)
        if (v !== null) positions[id] = Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
      }
      if (!Object.keys(positions).length) return redirect(`/projects/${p.id}/progress`, "There's nothing on the hill to update.")
      yield* sql`insert into hill_updates ${sql.insert({ project_id: p.id, person_id: c.me.id, positions: JSON.stringify(positions), note: str(fd, "note") || null })}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: "updated the progress hill" })
      return redirect(`/projects/${p.id}/progress`, "Progress updated.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob, cara } = s.people
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const web = s.projects.website
    const todo = (as: Person, project: Project, parent: Recording, title: string, data: Record<string, any> = {}, body = "") =>
      Effect.gen(function* () {
        const t = yield* createRecording(s.as(as), { project, type: "todo", parent_id: parent.id, title, body, data: { assignee_ids: [], notify_ids: [], completed_at: null, ...data }, visible_to_clients: true, verb: "added a task" })
        yield* subscribe(t.id, [...(data.assignee_ids ?? []), ...(data.notify_ids ?? [])])
        for (const id of data.assignee_ids ?? []) if (id !== as.id) yield* notify(s.as(as), { personIds: [id], recording: t, kind: "assigned", summary: `${as.name} assigned you a task: ${title}`, email: false })
        return t
      })
    const complete = (t: Recording, by: Person, daysAgo: number) =>
      sql`update recordings set data = data || ${JSON.stringify({ completed_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(), completer_id: by.id })}::jsonb where id = ${t.id}`

    const launch = yield* createRecording(s.as(maya), { project: web, type: "todolist", title: "Launch checklist", body: "Everything that has to be true before we flip DNS.", data: { tracked: true }, visible_to_clients: true, verb: "made a task list" })
    const design = yield* createRecording(s.as(maya), { project: web, type: "todogroup", parent_id: launch.id, title: "Design", visible_to_clients: true })
    const build = yield* createRecording(s.as(maya), { project: web, type: "todogroup", parent_id: launch.id, title: "Build", visible_to_clients: true })
    const sketches = yield* todo(maya, web, design, "Homepage sketches", { assignee_ids: [ann.id], notify_ids: [maya.id], due_on: day(-3) }, "Three rough ideas. Quick sketches only.")
    yield* complete(sketches, ann, 2)
    yield* todo(maya, web, design, "Pick the type pairing", { assignee_ids: [ann.id], due_on: day(-2) })
    yield* todo(maya, web, design, "Pricing page copy", { assignee_ids: [ann.id, maya.id], starts_on: day(1), due_on: day(4) })
    const scaffold = yield* todo(maya, web, build, "Set up the static site", { assignee_ids: [bob.id], due_on: day(-6) })
    yield* complete(scaffold, bob, 5)
    yield* todo(maya, web, build, "Contact form", { assignee_ids: [bob.id], notify_ids: [maya.id], due_on: day(6) })
    yield* todo(maya, web, launch, "Point DNS at the new host", { assignee_ids: [bob.id], due_on: day(24) })

    const content = yield* createRecording(s.as(ann), { project: web, type: "todolist", title: "Content from Northwind", data: { tracked: true }, visible_to_clients: false, verb: "made a task list" })
    yield* todo(ann, web, content, "Get product photos", { assignee_ids: [maya.id], due_on: day(3) })
    yield* todo(ann, web, content, "Collect testimonials")

    const q4 = yield* createRecording(s.as(cara), { project: s.projects.marketing, type: "todolist", title: "Q4 campaigns", verb: "made a task list" })
    yield* todo(cara, s.projects.marketing, q4, "Draft the holiday email", { assignee_ids: [cara.id], due_on: day(10) })
    yield* todo(cara, s.projects.marketing, q4, "Book the podcast ads", { assignee_ids: [bob.id], due_on: day(-1) })

    yield* sql`insert into hill_updates ${sql.insert({ project_id: web.id, person_id: maya.id, positions: JSON.stringify({ [launch.id]: 20, [content.id]: 10 }), note: "Still working on the homepage.", created_at: new Date(Date.now() - 6 * 86400_000) })}`
    yield* sql`insert into hill_updates ${sql.insert({ project_id: web.id, person_id: ann.id, positions: JSON.stringify({ [launch.id]: 55, [content.id]: 30 }), note: "Over the hill on design." })}`
  })
