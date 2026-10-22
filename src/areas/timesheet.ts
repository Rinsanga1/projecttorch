// Timesheet: a project's timesheet, logging time (on a to-do or not), and the account-wide timesheet.
// Clients never see time.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { html, raw, today, fmtDate } from "../lib/html.ts"
import { get, post, redirect, render, str, num, errors, isAdmin, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, projectCrumbs, toolUrl, urlFor, visibleProjects, logEvent, type Project, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"
import { kit, pageHead, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// Hours line up on the right; the "Add time" form sits in a tile.
const tt = stylex.create({
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  total: { fontSize: text.base, color: color.ink },
  add: { marginTop: space.s6, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  addTitle: { marginTop: 0 },
})


/** "1.5" or "1:30" → 90 minutes. Anything else (or zero) → null. */
export const parseMinutes = (s: string) => {
  const t = s.trim()
  const hm = t.match(/^(\d+):([0-5]\d)$/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]) || null
  if (!/^\d*\.?\d+$/.test(t)) return null
  const m = Math.round(Number(t) * 60)
  return m > 0 ? m : null
}

export const fmtHours = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.?0+$/, "")

type Entry = {
  id: number
  day: string
  minutes: number
  description: string
  person_id: number | null
  person_name: string | null
  project_id: number
  project_name: string
  recording_id: number | null
  todo_title: string | null
  todo_type: string | null
}

type Filters = { from: string; to: string; personId: number | null; projectId: number | null }

const readFilters = (q: URLSearchParams): Filters => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? q.get("from")! : "",
  to: /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") ?? "") ? q.get("to")! : "",
  personId: num(q.get("person")),
  projectId: num(q.get("project")),
})

const entries = (projectIds: ReadonlyArray<number>, f: Filters) =>
  Effect.gen(function* () {
    if (!projectIds.length) return [] as Entry[]
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Entry>`
      select e.id, to_char(e.on_date, 'YYYY-MM-DD') as day, e.minutes, e.description, e.person_id, pe.name as person_name,
        e.project_id, p.name as project_name, e.recording_id, r.title as todo_title, r.type as todo_type
      from time_entries e join projects p on p.id = e.project_id
        left join people pe on pe.id = e.person_id left join recordings r on r.id = e.recording_id
      where e.project_id in ${sql.in([...projectIds])}
        ${f.from ? sql`and e.on_date >= ${f.from}` : sql``} ${f.to ? sql`and e.on_date <= ${f.to}` : sql``}
        ${f.personId ? sql`and e.person_id = ${f.personId}` : sql``}
      order by e.on_date desc, e.id desc`
  })

const total = (es: ReadonlyArray<Entry>) => es.reduce((n, e) => n + e.minutes, 0)

const csv = (es: ReadonlyArray<Entry>, filename: string) => {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const rows = [["Date", "Person", "Project", "Hours", "Description", "Task"], ...es.map((e) => [e.day, e.person_name, e.project_name, fmtHours(e.minutes), e.description, e.todo_title])]
  return HttpServerResponse.text(rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", {
    contentType: "text/csv; charset=utf-8",
    headers: { "content-disposition": `attachment; filename="${filename}"` },
  })
}

const qs = (f: Filters) => {
  const u = new URLSearchParams()
  if (f.from) u.set("from", f.from)
  if (f.to) u.set("to", f.to)
  if (f.personId) u.set("person", String(f.personId))
  if (f.projectId) u.set("project", String(f.projectId))
  const s = u.toString()
  return s ? `?${s}` : ""
}

const filterForm = (action: string, f: Filters, people: ReadonlyArray<{ id: number; name: string }>, projects?: ReadonlyArray<{ id: number; name: string }>) => html`
<form method="get" action="${action}"${sx(kit.toolbar)}>
  <label>From <input type="date" name="from" value="${f.from}"></label>
  <label>To <input type="date" name="to" value="${f.to}"></label>
  <label>Person <select name="person"><option value="">Everyone</option>
    ${people.map((p) => html`<option value="${p.id}"${p.id === f.personId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  ${projects ? html`<label>Project <select name="project"><option value="">All projects</option>
    ${projects.map((p) => html`<option value="${p.id}"${p.id === f.projectId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>` : ""}
  <button${sx(kit.toolbarControl)}>Filter</button> <a href="${action}">Clear</a>
</form>`

const entryTable = (es: ReadonlyArray<Entry>, opts: { project?: boolean } = {}) => html`
<table>
  <thead><tr><th>Date</th><th>Person</th>${opts.project ? html`<th>Project</th>` : ""}<th${sx(tt.num)}>Hours</th><th>Description</th><th>Task</th></tr></thead>
  <tbody>${es.map((e) => html`<tr>
    <td>${fmtDate(e.day)}</td><td>${e.person_name ?? "(someone)"}</td>
    ${opts.project ? html`<td><a href="/projects/${e.project_id}/timesheet">${e.project_name}</a></td>` : ""}
    <td${sx(tt.num)}>${fmtHours(e.minutes)}</td><td>${e.description}</td>
    <td>${e.recording_id && e.todo_type ? html`<a href="${urlFor({ id: e.recording_id, type: e.todo_type, project_id: e.project_id, parent_id: null, data: {} })}">${e.todo_title}</a>` : ""}</td></tr>`)}
  </tbody>
  <tfoot><tr><th colspan="${opts.project ? 3 : 2}">Total</th><th${sx(tt.num, tt.total)}>${fmtHours(total(es))}</th><th colspan="2"></th></tr></tfoot>
</table>`

/** The "Log time" form. `todo` pins it to one to-do; otherwise you can pick one. */
const entryForm = (c: Ctx, p: Project, staff: ReadonlyArray<{ id: number; name: string }>, opts: { todo?: Recording; todos?: ReadonlyArray<Recording>; values?: Record<string, string>; errs?: string[] }) => {
  const v = opts.values ?? {}
  return html`
${errors(opts.errs ?? [])}
<form method="post" action="/projects/${p.id}/timesheet">
  ${opts.todo ? html`<input type="hidden" name="recording_id" value="${opts.todo.id}"><input type="hidden" name="return_to" value="todo">` : ""}
  <p><label>Date<br><input type="date" name="on_date" value="${v.on_date ?? today()}" required></label></p>
  <p><label>Hours (1.5 or 1:30)<br><input name="hours" value="${v.hours ?? ""}" size="6" required></label></p>
  <p><label>What did you work on?<br><input name="description" value="${v.description ?? ""}" size="60"></label></p>
  ${isAdmin(c.me) ? html`<p><label>Person<br><select name="person_id">${staff.map((s) => html`<option value="${s.id}"${String(s.id) === (v.person_id ?? String(c.me.id)) ? raw(" selected") : ""}>${s.name}</option>`)}</select></label></p>` : ""}
  ${!opts.todo && opts.todos?.length ? html`<p><label>Task (optional)<br><select name="recording_id"><option value="">None</option>
    ${opts.todos.map((t) => html`<option value="${t.id}"${String(t.id) === v.recording_id ? raw(" selected") : ""}>${t.title}</option>`)}</select></label></p>` : ""}
  <p><button>Add this entry</button> <a href="${opts.todo ? urlFor(opts.todo) : toolUrl(p, "timesheet")}">Cancel</a></p>
</form>`
}

const staffOf = (p: Project) => projectPeople(p).pipe(Effect.map((ps) => ps.filter((x) => !isClient(x)).map((x) => ({ id: x.id, name: x.name }))))

const openTodos = (projectId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Recording>`select * from recordings where project_id = ${projectId} and type = 'todo' and status = 'active' and data->>'completed_at' is null order by title`
  })

const projectTimesheet = (c: Ctx) =>
  Effect.gen(function* () {
    const p = yield* findProject(c, c.params.id)
    if (isClient(c.me)) return yield* new NoAccess()
    return p
  })

export const routes = [
  get("/projects/:id/timesheet", (c) =>
    Effect.gen(function* () {
      const p = yield* projectTimesheet(c)
      const f = readFilters(c.query)
      const es = yield* entries([p.id], f)
      const staff = yield* staffOf(p)
      const filtered = !!(f.from || f.to || f.personId)
      return yield* render(c, "Timesheet", html`
${pageHead("Timesheet")}
${filterForm(`/projects/${p.id}/timesheet`, f, staff)}
${es.length
  ? html`${entryTable(es)}<p><a href="/projects/${p.id}/timesheet.csv${qs(f)}">Export as CSV</a></p>`
  : html`<p${sx(kit.empty)}>${filtered ? "No time logged that matches these filters." : "Log time on any task and it adds up here."}</p>`}
${p.status === "active" ? html`<section aria-label="Add time"${sx(tt.add)}><h2${sx(tt.addTitle)}>Add time</h2>${entryForm(c, p, staff, { todos: yield* openTodos(p.id) })}</section>` : ""}
<p${sx(kit.links)}><a href="/timesheet">Timesheet for every project</a></p>`, projectCrumbs(p))
    })),

  get("/projects/:id/timesheet.csv", (c) =>
    Effect.gen(function* () {
      const p = yield* projectTimesheet(c)
      return csv(yield* entries([p.id], readFilters(c.query)), `timesheet-${p.id}.csv`)
    })),

  get("/projects/:id/timesheet/new", (c) =>
    Effect.gen(function* () {
      const p = yield* projectTimesheet(c)
      return yield* render(c, "Log time", html`<h1>Log time</h1>${entryForm(c, p, yield* staffOf(p), { todos: yield* openTodos(p.id) })}`, projectCrumbs(p, "timesheet"))
    })),

  get("/projects/:id/tasks/:tid/time", (c) =>
    Effect.gen(function* () {
      const p = yield* projectTimesheet(c)
      const { r: todo } = yield* findRecording(c, c.params.tid, "todo")
      if (todo.project_id !== p.id) return yield* new NotFound()
      return yield* render(c, "Log time", html`<h1>Log time on “${todo.title}”</h1>${entryForm(c, p, yield* staffOf(p), { todo })}`, [...projectCrumbs(p, "todos"), [todo.title, urlFor(todo)]])
    })),

  post("/projects/:id/timesheet", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* projectTimesheet(c)
      const fd = yield* c.form
      const values = Object.fromEntries(["on_date", "hours", "description", "person_id", "recording_id"].map((k) => [k, str(fd, k)]))
      const staff = yield* staffOf(p)
      const minutes = parseMinutes(values.hours!)
      const todoId = num(values.recording_id)
      const [todo] = todoId ? yield* sql<Recording>`select * from recordings where id = ${todoId} and project_id = ${p.id} and type = 'todo'` : []
      const personId = isAdmin(c.me) && staff.some((s) => s.id === Number(values.person_id)) ? Number(values.person_id) : c.me.id
      const errs = [
        ...(minutes ? [] : ["Type the time like 1.5 or 1:30."]),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(values.on_date!) ? [] : ["Pick a date."]),
        ...(todoId && !todo ? ["That task isn't in this project."] : []),
      ]
      if (errs.length) {
        const pinned = str(fd, "return_to") === "todo" ? todo : undefined
        return yield* render(c, "Log time", html`<h1>Log time</h1>${entryForm(c, p, staff, { todo: pinned, todos: yield* openTodos(p.id), values, errs })}`, projectCrumbs(p, "timesheet"), 422)
      }
      yield* sql`insert into time_entries ${sql.insert({ account_id: c.me.account_id, project_id: p.id, recording_id: todo?.id ?? null, person_id: personId, on_date: values.on_date!, minutes: minutes!, description: values.description! })}`
      yield* logEvent(c, { project_id: p.id, recording_id: todo?.id ?? null, action: "logged", summary: `logged ${fmtHours(minutes!)} hours${todo ? ` on ${todo.title}` : ""}` })
      const msg = `Logged ${fmtHours(minutes!)} ${minutes === 60 ? "hour" : "hours"}.`
      return redirect(str(fd, "return_to") === "todo" && todo ? urlFor(todo) : toolUrl(p, "timesheet"), msg)
    })),

  // Account-wide timesheet
  get("/timesheet", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const f = readFilters(c.query)
      const projects = [...(yield* visibleProjects(c)), ...(yield* visibleProjects(c, { status: "archived" }))]
      const es = yield* entries(f.projectId ? projects.filter((p) => p.id === f.projectId).map((p) => p.id) : projects.map((p) => p.id), f)
      const people = yield* sql<{ id: number; name: string }>`select id, name from people where account_id = ${c.me.account_id} and role <> 'client' and removed_at is null order by name`
      const byProject = new Map<string, number>()
      for (const e of es) byProject.set(e.project_name, (byProject.get(e.project_name) ?? 0) + e.minutes)
      return yield* render(c, "Timesheet", html`
<h1>Timesheet for every project</h1>
${filterForm("/timesheet", f, people, projects)}
${es.length ? html`
<h2>Totals</h2>
<ul>${[...byProject].map(([name, m]) => html`<li>${name}: ${fmtHours(m)} hours</li>`)}</ul>
<p><b>All projects: ${fmtHours(total(es))} hours</b></p>
${entryTable(es, { project: true })}
<p><a href="/timesheet.csv${qs(f)}">Export as CSV</a></p>` : html`<p>No time logged${f.from || f.to || f.personId || f.projectId ? " that matches these filters" : " yet. Log time on any task and it adds up here"}.</p>`}`, [["Reports", "/reports"]])
    })),

  get("/timesheet.csv", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const f = readFilters(c.query)
      const projects = [...(yield* visibleProjects(c)), ...(yield* visibleProjects(c, { status: "archived" }))]
      return csv(yield* entries(f.projectId ? projects.filter((p) => p.id === f.projectId).map((p) => p.id) : projects.map((p) => p.id), f), "timesheet.csv")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const web = s.projects.website
    const todoId = (title: string) => sql<{ id: number }>`select id from recordings where project_id = ${web.id} and type = 'todo' and title = ${title}`.pipe(Effect.map((r) => r[0]?.id ?? null))
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const { ann, bob, maya } = s.people
    const rows = [
      { person: ann, todo: "Homepage sketches", d: -4, minutes: 180, description: "Three directions" },
      { person: ann, todo: "Pick the type pairing", d: -2, minutes: 90, description: "Narrowed to two" },
      { person: bob, todo: "Set up the static site", d: -6, minutes: 240, description: "Build pipeline and hosting" },
      { person: bob, todo: "Contact form", d: -1, minutes: 75, description: "" },
      { person: maya, todo: null, d: -3, minutes: 60, description: "Kickoff call with Northwind" },
    ]
    for (const r of rows)
      yield* sql`insert into time_entries ${sql.insert({ account_id: s.account.id, project_id: web.id, recording_id: r.todo ? yield* todoId(r.todo) : null, person_id: r.person.id, on_date: day(r.d), minutes: r.minutes, description: r.description })}`
  })

if (import.meta.main) {
  const eq = (a: unknown, b: unknown) => { if (a !== b) throw new Error(`expected ${b}, got ${a}`) }
  eq(parseMinutes("1.5"), 90); eq(parseMinutes("1:30"), 90); eq(parseMinutes(" 2 "), 120); eq(parseMinutes(".25"), 15)
  eq(parseMinutes("0"), null); eq(parseMinutes("0:00"), null); eq(parseMinutes("1:75"), null); eq(parseMinutes("-1"), null); eq(parseMinutes("abc"), null)
  eq(fmtHours(90), "1.5"); eq(fmtHours(60), "1"); eq(fmtHours(600), "10"); eq(fmtHours(15), "0.25")
  console.log("timesheet: ok")
}
