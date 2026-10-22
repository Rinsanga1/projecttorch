// Timesheet: a project's timesheet, logging time (on a to-do or not), and the account-wide timesheet.
// Clients never see time. The pages are client/areas/timesheet.tsx; these are their post and the CSV exports.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { get, post, redirect, invalid, str, num, isAdmin, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import { findProject, projectPeople, toolUrl, urlFor, visibleProjects, logEvent, type Project, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

/** "1.5" or "1:30" → 90 minutes. Anything else (or zero) → null. */
export const parseMinutes = (s: string) => {
  const t = s.trim()
  const hm = t.match(/^(\d+):([0-5]\d)$/)
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]) || null
  if (!/^\d*\.?\d+$/.test(t)) return null
  const m = Math.round(Number(t) * 60)
  return m > 0 ? m : null
}

/** Mirrored in client/areas/timesheet.tsx. */
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

const csv = (es: ReadonlyArray<Entry>, filename: string) => {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
  const rows = [["Date", "Person", "Project", "Hours", "Description", "Task"], ...es.map((e) => [e.day, e.person_name, e.project_name, fmtHours(e.minutes), e.description, e.todo_title])]
  return HttpServerResponse.text(rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n", {
    contentType: "text/csv; charset=utf-8",
    headers: { "content-disposition": `attachment; filename="${filename}"` },
  })
}

const staffOf = (p: Project) => projectPeople(p).pipe(Effect.map((ps) => ps.filter((x) => !isClient(x)).map((x) => ({ id: x.id, name: x.name }))))

const projectTimesheet = (c: Ctx) =>
  Effect.gen(function* () {
    const p = yield* findProject(c, c.params.id)
    if (isClient(c.me)) return yield* new NoAccess()
    return p
  })

export const routes = [
  get("/projects/:id/timesheet.csv", (c) =>
    Effect.gen(function* () {
      const p = yield* projectTimesheet(c)
      return csv(yield* entries([p.id], readFilters(c.query)), `timesheet-${p.id}.csv`)
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
      if (errs.length) return invalid(errs)
      yield* sql`insert into time_entries ${sql.insert({ account_id: c.me.account_id, project_id: p.id, recording_id: todo?.id ?? null, person_id: personId, on_date: values.on_date!, minutes: minutes!, description: values.description! })}`
      yield* logEvent(c, { project_id: p.id, recording_id: todo?.id ?? null, action: "logged", summary: `logged ${fmtHours(minutes!)} hours${todo ? ` on ${todo.title}` : ""}` })
      const msg = `Logged ${fmtHours(minutes!)} ${minutes === 60 ? "hour" : "hours"}.`
      return redirect(str(fd, "return_to") === "todo" && todo ? urlFor(todo) : toolUrl(p, "timesheet"), msg)
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
