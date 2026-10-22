// Timesheet: a project's timesheet, logging time (on a to-do or not), and the account-wide timesheet.
// Clients never see time. Posts and CSV exports: src/areas/timesheet.ts.
import * as stylex from "@stylexjs/stylex"
import { useParams, useSearchParams, Form as GetForm } from "react-router"
import { db } from "../store.ts"
import { me, findProject, findRecording, projectPeople, visibleProjects, recordings, NoAccess, NotFound } from "../data.ts"
import { isAdmin, isClient, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { fmtDate, today } from "../../shared/format.ts"
import { Form, submitOnChange } from "../ui/forms.tsx"
import { kit, PageHead, sx } from "../ui/kit.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, space, text } from "../ui/tokens.stylex.ts"
import { personName, projectName } from "./reports.tsx"

// Hours line up on the right. "Log time" (in the head) opens the form on its own page, which comes back here.
const tt = stylex.create({
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  total: { fontSize: text.base, color: color.ink },
})

/** Same as src/areas/timesheet.ts (the CSV uses that one). */
export const fmtHours = (minutes: number) => (minutes / 60).toFixed(2).replace(/\.?0+$/, "")

type Filters = { from: string; to: string; personId: number | null; projectId: number | null }

const num = (v: string | null) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

const readFilters = (q: URLSearchParams): Filters => ({
  from: /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? q.get("from")! : "",
  to: /^\d{4}-\d{2}-\d{2}$/.test(q.get("to") ?? "") ? q.get("to")! : "",
  personId: num(q.get("person")),
  projectId: num(q.get("project")),
})

/** Time logged in these projects, newest day first. */
const entries = (projectIds: ReadonlyArray<number>, f: Filters) => {
  const ids = new Set(projectIds)
  return [...db.time_entries.values()]
    .filter((e) => ids.has(e.project_id) && (!f.from || e.on_date >= f.from) && (!f.to || e.on_date <= f.to) && (!f.personId || e.person_id === f.personId))
    .sort((a, b) => b.on_date.localeCompare(a.on_date) || b.id - a.id)
}
type Entry = ReturnType<typeof entries>[number]

const total = (es: ReadonlyArray<Entry>) => es.reduce((n, e) => n + e.minutes, 0)

const qs = (f: Filters) => {
  const u = new URLSearchParams()
  if (f.from) u.set("from", f.from)
  if (f.to) u.set("to", f.to)
  if (f.personId) u.set("person", String(f.personId))
  if (f.projectId) u.set("project", String(f.projectId))
  const s = u.toString()
  return s ? `?${s}` : ""
}

const FilterForm = ({ action, f, people, projects }: { action: string; f: Filters; people: ReadonlyArray<{ id: number; name: string }>; projects?: ReadonlyArray<{ id: number; name: string }> }) => (
  <GetForm method="get" action={action} ref={submitOnChange} {...sx(kit.toolbar)}>
    <label>From <input type="date" name="from" defaultValue={f.from} /></label>
    <label>To <input type="date" name="to" defaultValue={f.to} /></label>
    <label>Person <select name="person" defaultValue={f.personId ?? ""}><option value="">Everyone</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {projects && <label>Project <select name="project" defaultValue={f.projectId ?? ""}><option value="">All projects</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    {(f.from || f.to || f.personId || f.projectId) && <a href={action}>Clear</a>}
  </GetForm>
)

const EntryTable = ({ es, project }: { es: ReadonlyArray<Entry>; project?: boolean }) => (
  <table>
    <thead><tr><th>Date</th><th>Person</th>{project && <th>Project</th>}<th {...sx(tt.num)}>Hours</th><th>Description</th><th>Task</th></tr></thead>
    <tbody>{es.map((e) => {
      const todo = e.recording_id ? db.recordings.get(String(e.recording_id)) : undefined
      return (
        <tr key={e.id}>
          <td>{fmtDate(e.on_date)}</td><td>{personName(e.person_id) ?? "(someone)"}</td>
          {project && <td><a href={`/projects/${e.project_id}/timesheet`}>{projectName(e.project_id)}</a></td>}
          <td {...sx(tt.num)}>{fmtHours(e.minutes)}</td><td>{e.description}</td>
          <td>{todo && <a href={urlFor(todo)}>{todo.title}</a>}</td>
        </tr>
      )
    })}
    </tbody>
    <tfoot><tr><th colSpan={project ? 3 : 2}>Total</th><th {...sx(tt.num, tt.total)}>{fmtHours(total(es))}</th><th colSpan={2}></th></tr></tfoot>
  </table>
)

/** The "Log time" form. `todo` pins it to one to-do; otherwise you can pick one. */
const EntryForm = ({ p, staff, todo, todos }: { p: Project; staff: ReadonlyArray<{ id: number; name: string }>; todo?: Recording; todos?: ReadonlyArray<Recording> }) => {
  const m = me()
  return (
    <Form action={`/projects/${p.id}/timesheet`}>
      {todo && <><input type="hidden" name="recording_id" value={todo.id} /><input type="hidden" name="return_to" value="todo" /></>}
      <p><label>Date<br /><input type="date" name="on_date" defaultValue={today()} required /></label></p>
      <p><label>Hours (1.5 or 1:30)<br /><input name="hours" size={6} required /></label></p>
      <p><label>What did you work on?<br /><input name="description" size={60} /></label></p>
      {isAdmin(m) && <p><label>Person<br /><select name="person_id" defaultValue={m.id}>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></p>}
      {!todo && todos?.length ? <p><label>Task (optional)<br /><select name="recording_id"><option value="">None</option>
        {todos.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label></p> : null}
      <p><button>Add this entry</button> <a href={todo ? urlFor(todo) : toolUrl(p, "timesheet")}>Cancel</a></p>
    </Form>
  )
}

const staffOf = (p: Project) => projectPeople(p).filter((x) => !isClient(x)).map((x) => ({ id: x.id, name: x.name }))

const openTodos = (projectId: number) =>
  recordings((r) => r.project_id === projectId && r.type === "todo" && r.status === "active" && !r.data.completed_at).sort((a, b) => a.title.localeCompare(b.title))

const projectTimesheet = (id: string | undefined) => {
  const p = findProject(id)
  if (isClient(me())) throw new NoAccess()
  return p
}

export const routes = [
  page("/projects/:id/timesheet", () => {
    const params = useParams()
    const [q] = useSearchParams()
    const p = projectTimesheet(params.id)
    const f = readFilters(q)
    const es = entries([p.id], f)
    const staff = staffOf(p)
    const filtered = !!(f.from || f.to || f.personId)
    return (
      <Page title="Timesheet" crumbs={projectCrumbs(p)}>
        <PageHead title="Timesheet" actions={[p.status === "active" && <a key="log" href={`/projects/${p.id}/timesheet/new`} data-button>Log time</a>]} />
        {/* Filters earn their row once there are enough entries to sift; until then, one quiet "Filter" that opens. */}
        {es.length > 15 || filtered
          ? <FilterForm action={`/projects/${p.id}/timesheet`} f={f} people={staff} />
          : <details><summary {...sx(kit.quietSummary)}>Filter</summary><FilterForm action={`/projects/${p.id}/timesheet`} f={f} people={staff} /></details>}
        {es.length
          ? <><EntryTable es={es} /><p><a href={`/api/projects/${p.id}/timesheet.csv${qs(f)}`}>Export as CSV</a></p></>
          : <p {...sx(kit.empty)}>{filtered ? "No time logged that matches these filters." : "Log time on any task and it adds up here."}</p>}
        <p {...sx(kit.links)}><a href="/timesheet">Timesheet for every project</a></p>
      </Page>
    )
  }),

  page("/projects/:id/timesheet/new", () => {
    const p = projectTimesheet(useParams().id)
    return <Page title="Log time" crumbs={projectCrumbs(p, "timesheet")}><h1>Log time</h1><EntryForm p={p} staff={staffOf(p)} todos={openTodos(p.id)} /></Page>
  }),

  page("/projects/:id/tasks/:tid/time", () => {
    const params = useParams()
    const p = projectTimesheet(params.id)
    const { r: todo } = findRecording(params.tid, "todo")
    if (todo.project_id !== p.id) throw new NotFound()
    return (
      <Page title="Log time" crumbs={[...projectCrumbs(p, "todos"), [todo.title, urlFor(todo)]]}>
        <h1>Log time on “{todo.title}”</h1>
        <EntryForm p={p} staff={staffOf(p)} todo={todo} />
      </Page>
    )
  }),

  // Account-wide timesheet
  page("/timesheet", () => {
    const [q] = useSearchParams()
    const m = me()
    if (isClient(m)) throw new NoAccess()
    const f = readFilters(q)
    const projects = [...visibleProjects(), ...visibleProjects({ status: "archived" })]
    const es = entries(projects.filter((p) => !f.projectId || p.id === f.projectId).map((p) => p.id), f)
    const people = [...db.people.values()]
      .filter((p) => p.account_id === m.account_id && !isClient(p) && !p.removed_at)
      .sort((a, b) => a.name.localeCompare(b.name))
    const byProject = new Map<string, number>()
    for (const e of es) byProject.set(projectName(e.project_id), (byProject.get(projectName(e.project_id)) ?? 0) + e.minutes)
    return (
      <Page title="Timesheet" crumbs={[["Reports", "/reports"]]}>
        <h1>Timesheet for every project</h1>
        <FilterForm action="/timesheet" f={f} people={people} projects={projects} />
        {es.length ? (
          <>
            <h2>Totals</h2>
            <ul>{[...byProject].map(([name, mins]) => <li key={name}>{name}: {fmtHours(mins)} hours</li>)}</ul>
            <p><b>All projects: {fmtHours(total(es))} hours</b></p>
            <EntryTable es={es} project />
            <p><a href={`/api/timesheet.csv${qs(f)}`}>Export as CSV</a></p>
          </>
        ) : <p>No time logged{f.from || f.to || f.personId || f.projectId ? " that matches these filters" : " yet. Log time on any task and it adds up here"}.</p>}
      </Page>
    )
  }),
]
