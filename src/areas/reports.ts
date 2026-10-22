// Activity & reports: Latest activity, Reports, Someone's activity, Someone's assignments, What's overdue,
// Upcoming dates, Tasks added & completed, Overview, Everything.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmtDate, excerpt, plural, today, isoDate, daysFromToday } from "../lib/html.ts"
import { get, render, isClient, NoAccess, type Ctx, type Person } from "../lib/web.ts"
import {
  visibleProjects, accountPeople, createRecording, logEvent, urlFor, titleOf, projectUrl, TYPE_NAMES,
  type Recording, type Project,
} from "../lib/core.ts"
import { activityList } from "./project.ts"
import type { Seed } from "../seed.ts"

// ---------- shared with find.ts ----------

/** Projects (active + archived) and private chats the current person can see. */
export const scope = (c: Ctx) =>
  Effect.gen(function* () {
    const projects = [...(yield* visibleProjects(c)), ...(yield* visibleProjects(c, { status: "archived" }))]
    const pings = yield* visibleProjects(c, { kind: "ping" })
    return { projects, ids: projects.map((p) => p.id), pingIds: pings.map((p) => p.id) }
  })

/** `in (...)` that survives an empty list. */
export const inIds = (sql: SqlClient.SqlClient, ids: ReadonlyArray<number>) => sql.in(ids.length ? [...ids] : [0])

/**
 * Hide recordings a client can't see: the recording and every ancestor must be client-visible
 * (comments, lines, steps, groups, answers and columns inherit). Mirrors clientVisible() in core.
 * `col` is the SQL expression holding the recording id; a null id passes.
 */
export const clientSees = (sql: SqlClient.SqlClient, me: Person, col: string) =>
  isClient(me)
    ? sql`and not exists (
        with recursive chain as (
          select id, parent_id, visible_to_clients, type from recordings where id = ${sql.literal(col)}
          union all select x.id, x.parent_id, x.visible_to_clients, x.type from recordings x join chain on x.id = chain.parent_id)
        select 1 from chain where not visible_to_clients and type not in ('comment','line','step','todogroup','answer','column'))`
    : sql``

const personPicker = (action: string, people: ReadonlyArray<Person>, selectedId: number | null, label = "Pick a person") => html`
<form method="get" action="${action}">
  <label>${label} <select name="person"><option value="">Choose…</option>
    ${people.map((p) => html`<option value="${p.id}"${p.id === selectedId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  <button>Show</button>
</form>`

const pickedPerson = (c: Ctx) =>
  Effect.gen(function* () {
    const people = yield* accountPeople(c.me.account_id)
    const id = Number(c.query.get("person")) || null
    return { people, person: people.find((p) => p.id === id) ?? null }
  })

const firstName = (p: Person) => p.name.split(" ")[0]!

type Ev = { id: number; summary: string; created_at: Date; name: string | null; person_id: number | null; recording_id: number | null; project_id: number | null; project_name: string }

const events = (c: Ctx, opts: { projectId?: number | null; personId?: number | null; page?: number; perPage?: number }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { ids } = yield* scope(c)
    const per = opts.perPage ?? 50
    return yield* sql<Ev>`
      select e.*, pe.name, pe.avatar_url, pr.name as project_name from events e
        join projects pr on pr.id = e.project_id left join people pe on pe.id = e.person_id
      where e.account_id = ${c.me.account_id} and e.project_id in ${inIds(sql, ids)}
        ${opts.projectId ? sql`and e.project_id = ${opts.projectId}` : sql``}
        ${opts.personId ? sql`and e.person_id = ${opts.personId}` : sql``}
        ${clientSees(sql, c.me, "e.recording_id")}
      order by e.created_at desc, e.id desc limit ${per + 1} offset ${((opts.page ?? 1) - 1) * per}`
  })

type Due = Recording & { project_name: string }

const DUE_TYPES = ["todo", "card", "step"]

/** Open (not completed) tasks, cards and steps in projects I can see. */
const openWork = (c: Ctx, where: (sql: SqlClient.SqlClient) => any) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { ids } = yield* scope(c)
    return yield* sql<Due>`
      select r.*, p.name as project_name from recordings r join projects p on p.id = r.project_id
      where r.type in ${sql.in(DUE_TYPES)} and r.status = 'active' and p.status = 'active' and p.kind = 'project'
        and r.project_id in ${inIds(sql, ids)} and r.data->>'completed_at' is null
        ${where(sql)} ${clientSees(sql, c.me, "r.id")}
      order by r.data->>'due_on' nulls last, r.id`
  })

const assigneeNames = (r: Recording, people: ReadonlyArray<Person>) =>
  ((r.data.assignee_ids ?? []) as number[]).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const workItem = (r: Due, extra: unknown = "") =>
  html`<li>${TYPE_NAMES[r.type]}: <a href="${urlFor(r)}">${titleOf(r)}</a>${r.data.due_on ? html` <small>(due ${fmtDate(r.data.due_on)})</small>` : ""} ${extra}</li>`

const lateBy = (due: string) => {
  const d = -daysFromToday(due)
  return d === 0 ? "due today" : `${plural(d, "day")} late`
}

const groupBy = <T>(rows: ReadonlyArray<T>, key: (r: T) => string) => {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
  return m
}

const reportCrumbs = [["Activity", "/activity"], ["Reports", "/reports"]] as const

// ---------- Everything ----------

const EVERYTHING: Record<string, { label: string; types: string[] }> = {
  messages: { label: "Posts", types: ["message"] },
  todos: { label: "Tasks", types: ["todolist", "todo"] },
  files: { label: "Files", types: ["folder", "doc", "upload", "cloudfile"] },
  cards: { label: "Cards", types: ["card"] },
  events: { label: "Events", types: ["event"] },
  answers: { label: "Answers", types: ["answer"] },
  forwards: { label: "Forwarded emails", types: ["forward"] },
}

export const routes = [
  get("/activity", (c) =>
    Effect.gen(function* () {
      const { projects } = yield* scope(c)
      const people = yield* accountPeople(c.me.account_id)
      const projectId = Number(c.query.get("project")) || null
      const personId = Number(c.query.get("person")) || null
      const page = Math.max(1, Number(c.query.get("page")) || 1)
      const evs = yield* events(c, { projectId, personId, page })
      const more = new URLSearchParams(c.query)
      more.set("page", String(page + 1))
      return yield* render(c, "Latest activity", html`
<h1>Latest activity</h1>
<p><a href="/reports">Reports</a>${!isClient(c.me) ? html` · <a href="/overview">Overview</a>` : ""} · <a href="/everything">Everything</a></p>
<form method="get" action="/activity">
  <label>Project <select name="project"><option value="">All projects</option>
    ${projects.map((p) => html`<option value="${p.id}"${p.id === projectId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  <label>Person <select name="person"><option value="">Everyone</option>
    ${people.map((p) => html`<option value="${p.id}"${p.id === personId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  <button>Filter</button>
</form>
${evs.length
  ? activityList(evs.slice(0, 50), c.me.time_zone)
  : html`<p>${projectId || personId ? "Nothing matches those filters." : "Activity across every project shows up here."}</p>`}
${evs.length > 50 ? html`<p><a href="/activity?${more.toString()}">Show more</a></p>` : ""}`)
    })),

  get("/reports", (c) =>
    Effect.gen(function* () {
      const people = yield* accountPeople(c.me.account_id)
      return yield* render(c, "Reports", html`
<h1>Reports</h1>
<p>Ready-made questions about the account.</p>
<h2>What's someone been up to?</h2>
${personPicker("/reports/activity", people, null)}
<h2>What's on someone's plate?</h2>
${personPicker("/reports/assignments", people, null)}
<ul>
  <li><a href="/reports/overdue">What's overdue?</a></li>
  <li><a href="/reports/upcoming">What's coming up?</a></li>
  <li><a href="/reports/tasks">Tasks added & completed</a></li>
  <li><a href="/timesheet">Timesheet</a></li>
</ul>`, [["Activity", "/activity"]])
    })),

  get("/reports/activity", (c) =>
    Effect.gen(function* () {
      const { people, person } = yield* pickedPerson(c)
      const page = Math.max(1, Number(c.query.get("page")) || 1)
      const evs = person ? yield* events(c, { personId: person.id, page }) : []
      return yield* render(c, person ? `What's ${firstName(person)} been up to?` : "Someone's activity", html`
<h1>${person ? `What's ${firstName(person)} been up to?` : "What's someone been up to?"}</h1>
${personPicker("/reports/activity", people, person?.id ?? null)}
${!person ? html`<p>Pick a person to see everything they did, by day.</p>`
  : evs.length ? activityList(evs.slice(0, 50), c.me.time_zone) : html`<p>${firstName(person)} hasn't done anything here yet.</p>`}
${person && evs.length > 50 ? html`<p><a href="/reports/activity?person=${person.id}&page=${page + 1}">Show more</a></p>` : ""}`, reportCrumbs)
    })),

  get("/reports/assignments", (c) =>
    Effect.gen(function* () {
      const { people, person } = yield* pickedPerson(c)
      const rows = person ? yield* openWork(c, (sql) => sql`and r.data->'assignee_ids' @> ${JSON.stringify([person.id])}::jsonb`) : []
      const byProject = groupBy(rows, (r) => r.project_name)
      return yield* render(c, person ? `What's on ${firstName(person)}'s plate?` : "Someone's assignments", html`
<h1>${person ? `What's on ${firstName(person)}'s plate?` : "What's on someone's plate?"}</h1>
${personPicker("/reports/assignments", people, person?.id ?? null)}
${!person ? html`<p>Pick a person to see their tasks, cards and steps.</p>`
  : rows.length
    ? html`${[...byProject].map(([name, rs]) => html`<h2><a href="${projectUrl(rs[0]!.project_id)}">${name}</a></h2>
        <ul>${rs.map((r) => workItem(r, r.data.due_on && daysFromToday(r.data.due_on) < 0 ? html`<b>${lateBy(r.data.due_on)}</b>` : ""))}</ul>`)}`
    : html`<p>Nothing's assigned to ${firstName(person)} right now.</p>`}`, reportCrumbs)
    })),

  get("/reports/overdue", (c) =>
    Effect.gen(function* () {
      const people = yield* accountPeople(c.me.account_id)
      const by = c.query.get("by") === "person" ? "person" : "project"
      const rows = yield* openWork(c, (sql) => sql`and r.data->>'due_on' < ${today()}`)
      const groups = by === "project"
        ? groupBy(rows, (r) => r.project_name)
        : groupBy(rows.flatMap((r) => ((r.data.assignee_ids ?? []) as number[]).length ? (r.data.assignee_ids as number[]).map((id) => ({ ...r, who: people.find((p) => p.id === id)?.name ?? "Someone" })) : [{ ...r, who: "Unassigned" }]), (r) => r.who)
      return yield* render(c, "What's overdue?", html`
<h1>What's overdue?</h1>
<form method="get"><label>Group by <select name="by">
  <option value="project">Project</option><option value="person"${by === "person" ? raw(" selected") : ""}>Person</option></select></label> <button>Group</button></form>
${rows.length
  ? html`${[...groups].map(([name, rs]) => html`<h2>${name}</h2><ul>${rs.map((r) => workItem(r, html`<b>${lateBy(r.data.due_on)}</b>${by === "project" && assigneeNames(r, people) ? html` · ${assigneeNames(r, people)}` : by === "person" ? html` · ${r.project_name}` : ""}`))}</ul>`)}`
  : html`<p>Nothing's overdue. Nice.</p>`}`, reportCrumbs)
    })),

  get("/reports/upcoming", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { ids } = yield* scope(c)
      const range = c.query.get("range") === "30" ? 30 : 14
      const until = isoDate(new Date(Date.now() + range * 86_400_000))
      const rows = yield* sql<Due & { on_date: string }>`
        select r.*, p.name as project_name, left(coalesce(r.data->>'starts_at', r.data->>'due_on'), 10) as on_date
        from recordings r join projects p on p.id = r.project_id
        where r.status = 'active' and p.status = 'active' and r.project_id in ${inIds(sql, ids)}
          and ((r.type = 'event' and left(r.data->>'starts_at', 10) between ${today()} and ${until})
            or (r.type in ${sql.in(DUE_TYPES)} and r.data->>'completed_at' is null and r.data->>'due_on' between ${today()} and ${until}))
          ${clientSees(sql, c.me, "r.id")}
        order by on_date, r.id`
      const days = groupBy(rows, (r) => r.on_date)
      return yield* render(c, "What's coming up?", html`
<h1>What's coming up?</h1>
<p>${range === 14 ? html`<b>Next 2 weeks</b> · <a href="/reports/upcoming?range=30">Next month</a>` : html`<a href="/reports/upcoming?range=14">Next 2 weeks</a> · <b>Next month</b>`}</p>
${rows.length
  ? html`${[...days].map(([d, rs]) => html`<h2>${fmtDate(d)}</h2><ul>${rs.map((r) => html`<li>${TYPE_NAMES[r.type]}: <a href="${urlFor(r)}">${titleOf(r)}</a> <small>(${r.project_name})</small></li>`)}</ul>`)}`
  : html`<p>Nothing's coming up in the next ${range === 14 ? "2 weeks" : "month"}.</p>`}`, reportCrumbs)
    })),

  get("/reports/tasks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projects, ids } = yield* scope(c)
      const people = yield* accountPeople(c.me.account_id)
      const from = /^\d{4}-\d{2}-\d{2}$/.test(c.query.get("from") ?? "") ? c.query.get("from")! : isoDate(new Date(Date.now() - 30 * 86_400_000))
      const to = /^\d{4}-\d{2}-\d{2}$/.test(c.query.get("to") ?? "") ? c.query.get("to")! : today()
      const projectId = Number(c.query.get("project")) || null
      const personId = Number(c.query.get("person")) || null
      const bad = from > to
      const rows = bad ? [] : yield* sql<Ev & { action: string; title: string }>`
        select e.*, pe.name, pr.name as project_name, r.title from events e
          join recordings r on r.id = e.recording_id join projects pr on pr.id = e.project_id left join people pe on pe.id = e.person_id
        where r.type = 'todo' and e.action in ('created','completed') and e.project_id in ${inIds(sql, ids)}
          and e.created_at::date between ${from} and ${to}
          ${projectId ? sql`and e.project_id = ${projectId}` : sql``} ${personId ? sql`and e.person_id = ${personId}` : sql``}
          ${clientSees(sql, c.me, "e.recording_id")}
        order by e.created_at desc`
      const added = rows.filter((r) => r.action === "created")
      const done = rows.filter((r) => r.action === "completed")
      const list = (rs: typeof rows) => rs.length
        ? html`<ul>${rs.map((r) => html`<li><a href="/r/${r.recording_id}/go">${r.title}</a> <small>${r.name ?? "Someone"} · ${r.project_name} · ${fmtDate(r.created_at, c.me.time_zone)}</small></li>`)}</ul>`
        : html`<p>None.</p>`
      return yield* render(c, "Tasks added & completed", html`
<h1>Tasks added & completed</h1>
<form method="get">
  <label>From <input type="date" name="from" value="${from}"></label> <label>To <input type="date" name="to" value="${to}"></label>
  <label>Project <select name="project"><option value="">All projects</option>
    ${projects.map((p) => html`<option value="${p.id}"${p.id === projectId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  <label>Person <select name="person"><option value="">Everyone</option>
    ${people.map((p) => html`<option value="${p.id}"${p.id === personId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
  <button>Show</button>
</form>
${bad ? html`<p role="alert">The “From” date has to come before the “To” date.</p>` : html`
<p><b>${plural(added.length, "task")} added, ${done.length} completed</b> between ${fmtDate(from)} and ${fmtDate(to)}.</p>
<h2>Added</h2>${list(added)}
<h2>Completed</h2>${list(done)}`}`, reportCrumbs)
    })),

  get("/overview", (c) =>
    Effect.gen(function* () {
      // ponytail: staff only, since overdue counts would leak work clients can't see
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const ps = (yield* visibleProjects(c)).filter((p) => p.kind === "project")
      const stats = ps.length ? yield* sql<{ id: number; overdue: number; tracked: number; last_hill: Date | null; last_event: Date | null; gauge: number | null; gauge_note: string | null }>`
        select p.id,
          (select count(*) from recordings r where r.project_id = p.id and r.type in ('todo','card','step') and r.status = 'active'
             and r.data->>'completed_at' is null and r.data->>'due_on' < ${today()})::int as overdue,
          (select count(*) from recordings r where r.project_id = p.id and r.type = 'todolist' and r.status = 'active' and (r.data->>'tracked')::boolean)::int as tracked,
          (select max(created_at) from hill_updates h where h.project_id = p.id) as last_hill,
          (select max(created_at) from events e where e.project_id = p.id) as last_event,
          (select value from gauge_updates g where g.project_id = p.id order by g.id desc limit 1) as gauge,
          (select note from gauge_updates g where g.project_id = p.id order by g.id desc limit 1) as gauge_note
        from projects p where p.id in ${inIds(sql, ps.map((p) => p.id))}` : []
      const weekAgo = Date.now() - 7 * 86_400_000
      const twoWeeksAgo = Date.now() - 14 * 86_400_000
      let rows = ps.map((p) => {
        const s = stats.find((x) => x.id === p.id)!
        const flags = [
          ...(s.overdue ? [`${plural(s.overdue, "overdue item")}`] : []),
          ...(s.tracked && (!s.last_hill || new Date(s.last_hill).getTime() < twoWeeksAgo) ? ["progress hasn't moved in 2 weeks"] : []),
          ...(!s.last_event || new Date(s.last_event).getTime() < weekAgo ? ["gone quiet: nothing in a week"] : []),
        ]
        return { p, s, flags }
      })
      const sort = c.query.get("sort") ?? "flags"
      const flaggedOnly = c.query.get("flagged") === "1"
      if (flaggedOnly) rows = rows.filter((r) => r.flags.length)
      rows.sort(sort === "name" ? (a, b) => a.p.name.localeCompare(b.p.name)
        : sort === "gauge" ? (a, b) => (b.s.gauge ?? -1) - (a.s.gauge ?? -1)
        : (a, b) => b.flags.length - a.flags.length || a.p.name.localeCompare(b.p.name))
      return yield* render(c, "Overview", html`
<h1>Overview</h1>
<p>Every project at a glance, with flags where something looks off.</p>
<form method="get">
  <label>Sort <select name="sort">
    <option value="flags">Most flags first</option>
    <option value="name"${sort === "name" ? raw(" selected") : ""}>Name</option>
    <option value="gauge"${sort === "gauge" ? raw(" selected") : ""}>Status</option></select></label>
  <label><input type="checkbox" name="flagged" value="1"${flaggedOnly ? raw(" checked") : ""}> Only flagged projects</label>
  <button>Apply</button>
</form>
${rows.length ? html`<table><thead><tr><th>Project</th><th>Status</th><th>Flags</th></tr></thead><tbody>
  ${rows.map(({ p, s, flags }) => html`<tr>
    <td><a href="${projectUrl(p)}">${p.name}</a></td>
    <td>${s.gauge !== null ? html`<a href="/projects/${p.id}/status"><meter min="0" max="100" value="${s.gauge}">${s.gauge}%</meter></a> ${s.gauge}%${s.gauge_note ? html` <small>${s.gauge_note}</small>` : ""}` : html`<a href="/projects/${p.id}/status">Set the status</a>`}</td>
    <td>${flags.length ? html`<ul>${flags.map((f) => html`<li>⚑ ${f}</li>`)}</ul>` : "All clear"}</td></tr>`)}
</tbody></table>` : html`<p>${flaggedOnly ? "No flagged projects. All clear." : "This fills in as your projects get going."}</p>`}`, [["Activity", "/activity"]])
    })),

  get("/everything", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { ids } = yield* scope(c)
      const type = EVERYTHING[c.query.get("type") ?? ""] ? c.query.get("type")! : "messages"
      const page = Math.max(1, Number(c.query.get("page")) || 1)
      const rows = yield* sql<Recording & { project_name: string; creator_name: string | null }>`
        select r.*, p.name as project_name, pe.name as creator_name from recordings r
          join projects p on p.id = r.project_id left join people pe on pe.id = r.creator_id
        where r.type in ${sql.in(EVERYTHING[type]!.types)} and r.status = 'active' and r.project_id in ${inIds(sql, ids)}
          ${clientSees(sql, c.me, "r.id")}
        order by r.created_at desc, r.id desc limit 51 offset ${(page - 1) * 50}`
      return yield* render(c, "Everything", html`
<h1>Everything</h1>
<p>${Object.entries(EVERYTHING).map(([k, v], i) => html`${i ? " · " : ""}${k === type ? html`<b>${v.label}</b>` : html`<a href="/everything?type=${k}">${v.label}</a>`}`)}</p>
${rows.length
  ? html`<ul>${rows.slice(0, 50).map((r) => html`<li><a href="${urlFor(r)}">${titleOf(r)}</a>
      <br><small>${r.creator_name ?? "Someone"} · ${r.project_name} · ${fmtDate(r.created_at, c.me.time_zone)}</small>
      ${r.body && r.type !== "upload" ? html`<br>${excerpt(r.body)}` : ""}</li>`)}</ul>`
  : html`<p>No ${EVERYTHING[type]!.label.toLowerCase()} yet.</p>`}
${rows.length > 50 ? html`<p><a href="/everything?type=${type}&page=${page + 1}">Show more</a></p>` : ""}`, [["Activity", "/activity"]])
    })),
]

// Report fixtures: other areas' seeds don't run in an isolated database, so give the reports something to show.
// Skipped when the Tasks seed already ran (the full app), so nothing is duplicated.
export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if ((yield* sql`select 1 from recordings where type = 'todolist' limit 1`).length) return
    const { maya, ann, bob, dan } = s.people
    const day = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000))
    const list = yield* createRecording(s.as(maya), {
      project: s.projects.website, type: "todolist", title: "Launch checklist", body: "Everything that has to happen before the site goes live.",
      data: { tracked: true }, visible_to_clients: true,
    })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "todo", parent_id: list.id, title: "Approve final homepage copy",
      data: { assignee_ids: [dan.id], due_on: day(-3) }, visible_to_clients: true, notifyIds: [dan.id], notifyKind: "assigned", verb: "assigned a task" })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "todo", parent_id: list.id, title: "Set up redirects from the old site",
      data: { assignee_ids: [bob.id], due_on: day(4) }, visible_to_clients: true })
    const done = yield* createRecording(s.as(ann), { project: s.projects.website, type: "todo", parent_id: list.id, title: "Pick the typeface",
      data: { assignee_ids: [ann.id], due_on: day(-6), completed_at: new Date().toISOString(), completer_id: ann.id }, visible_to_clients: true })
    yield* logEvent(s.as(ann), { project_id: s.projects.website.id, recording_id: done.id, action: "completed", summary: `completed ${done.title}` })
    const q4 = yield* createRecording(s.as(maya), { project: s.projects.marketing, type: "todolist", title: "Q4 campaigns" })
    yield* createRecording(s.as(maya), { project: s.projects.marketing, type: "todo", parent_id: q4.id, title: "Draft the Q4 email calendar",
      data: { assignee_ids: [s.people.cara.id], due_on: day(-1) } })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "event", title: "Design review with Northwind",
      data: { starts_at: `${day(3)}T15:00`, ends_at: `${day(3)}T16:00`, participant_ids: [maya.id, ann.id, dan.id] }, visible_to_clients: true })
  })

export type { Project }
