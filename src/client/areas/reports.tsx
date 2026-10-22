// Activity & reports: Latest activity, Reports, Someone's activity, Someone's assignments, What's overdue,
// Upcoming dates, Tasks added & completed, Overview, Everything. Everything reads the local copy, which already
// holds only what this person may see (clients included), so "scope" is just the projects in it.
import type { ReactNode } from "react"
import { Form as GetForm, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, accountPeople, visibleProjects, recordings, NoAccess } from "../data.ts"
import { isClient, projectUrl, titleOf, urlFor, TYPE_NAMES, type Event, type Person, type Recording } from "../../shared/domain.ts"
import { daysFromToday, excerpt, fmtDate, isoDate, ms, plural, today } from "../../shared/format.ts"
import { ActivityList, type ActivityItem } from "../ui/activity.tsx"
import { Page, page, type Crumb } from "../ui/page.tsx"

// ---------- shared with find.tsx ----------

/** Projects (active + archived) and private chats the current person can see. */
export const scope = () => {
  const projects = [...visibleProjects(), ...visibleProjects({ status: "archived" })]
  return { projects, ids: projects.map((p) => p.id), pingIds: visibleProjects({ kind: "ping" }).map((p) => p.id) }
}

export const projectName = (id: number | null) => (id ? db.projects.get(String(id))?.name ?? "" : "")
export const personName = (id: number | null) => (id ? db.people.get(String(id))?.name ?? null : null)

/** `?page=` as a number, at least 1. */
export const pageNo = (q: URLSearchParams) => Math.max(1, Number(q.get("page")) || 1)

// ---------- pieces ----------

const PersonPicker = ({ action, people, selectedId, label = "Pick a person" }: { action: string; people: ReadonlyArray<Person>; selectedId: number | null; label?: string }) => (
  <GetForm method="get" action={action}>
    <label>{label} <select name="person" defaultValue={selectedId ?? ""}><option value="">Choose…</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {" "}<button>Show</button>
  </GetForm>
)

const pickedPerson = (q: URLSearchParams) => {
  const people = accountPeople()
  const id = Number(q.get("person")) || null
  return { people, person: people.find((p) => p.id === id) ?? null }
}

const firstName = (p: Person) => p.name.split(" ")[0]!

const PER = 50

/** Events in projects I can see, newest first, shaped for <ActivityList>. */
const events = (opts: { projectId?: number | null; personId?: number | null }) => {
  const ids = new Set(scope().ids)
  const m = me()
  return [...db.events.values()]
    .filter((e) => e.account_id === m.account_id && e.project_id !== null && ids.has(e.project_id)
      && (!opts.projectId || e.project_id === opts.projectId) && (!opts.personId || e.person_id === opts.personId))
    .sort((a, b) => ms(b.created_at) - ms(a.created_at) || b.id - a.id)
}

const toItem = (e: Event): ActivityItem => {
  const who = e.person_id ? db.people.get(String(e.person_id)) : undefined
  return { ...e, name: who?.name ?? null, avatar_url: who?.avatar_url ?? null, project_name: projectName(e.project_id) }
}

type Due = Recording & { project_name: string }

const DUE_TYPES = ["todo", "card", "step"]

const byDue = (a: Recording, b: Recording) => {
  const x = a.data.due_on as string | undefined, y = b.data.due_on as string | undefined
  return (x && y ? x.localeCompare(y) : x ? -1 : y ? 1 : 0) || a.id - b.id
}

/** Open (not completed) tasks, cards and steps in active projects I can see. */
const openWork = (where: (r: Recording) => boolean): Due[] => {
  const active = new Set(visibleProjects().map((p) => p.id))
  return recordings((r) => DUE_TYPES.includes(r.type) && r.status === "active" && active.has(r.project_id) && !r.data.completed_at && where(r))
    .sort(byDue)
    .map((r) => ({ ...r, project_name: projectName(r.project_id) }))
}

const assigneeIds = (r: Recording) => (r.data.assignee_ids ?? []) as number[]

const assigneeNames = (r: Recording, people: ReadonlyArray<Person>) =>
  assigneeIds(r).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const WorkItem = ({ r, extra }: { r: Due; extra?: ReactNode }) => (
  <li>{TYPE_NAMES[r.type]}: <a href={urlFor(r)}>{titleOf(r)}</a>{r.data.due_on && <> <small>(due {fmtDate(r.data.due_on)})</small></>} {extra}</li>
)

const lateBy = (due: string) => {
  const d = -daysFromToday(due)
  return d === 0 ? "due today" : `${plural(d, "day")} late`
}

const groupBy = <T,>(rows: ReadonlyArray<T>, key: (r: T) => string) => {
  const m = new Map<string, T[]>()
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r])
  return m
}

const reportCrumbs: Crumb[] = [["Activity", "/activity"], ["Reports", "/reports"]]

const DATE = /^\d{4}-\d{2}-\d{2}$/

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
  page("/activity", () => {
    const [q] = useSearchParams()
    const m = me()
    const { projects } = scope()
    const people = accountPeople()
    const projectId = Number(q.get("project")) || null
    const personId = Number(q.get("person")) || null
    const pg = pageNo(q)
    const evs = events({ projectId, personId }).slice((pg - 1) * PER, pg * PER + 1)
    const more = new URLSearchParams(q)
    more.set("page", String(pg + 1))
    return (
      <Page title="Latest activity">
        <h1>Latest activity</h1>
        <p><a href="/reports">Reports</a>{!isClient(m) && <> · <a href="/overview">Overview</a></>} · <a href="/everything">Everything</a></p>
        <GetForm method="get" action="/activity">
          <label>Project <select name="project" defaultValue={projectId ?? ""}><option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {" "}<label>Person <select name="person" defaultValue={personId ?? ""}><option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {" "}<button>Filter</button>
        </GetForm>
        {evs.length
          ? <ActivityList events={evs.slice(0, PER).map(toItem)} tz={m.time_zone} />
          : <p>{projectId || personId ? "Nothing matches those filters." : "Activity across every project shows up here."}</p>}
        {evs.length > PER && <p><a href={`/activity?${more.toString()}`}>Show more</a></p>}
      </Page>
    )
  }),

  page("/reports", () => {
    const people = accountPeople()
    return (
      <Page title="Reports" crumbs={[["Activity", "/activity"]]}>
        <h1>Reports</h1>
        <p>Ready-made questions about the account.</p>
        <h2>What's someone been up to?</h2>
        <PersonPicker action="/reports/activity" people={people} selectedId={null} />
        <h2>What's on someone's plate?</h2>
        <PersonPicker action="/reports/assignments" people={people} selectedId={null} />
        <ul>
          <li><a href="/reports/overdue">What's overdue?</a></li>
          <li><a href="/reports/upcoming">What's coming up?</a></li>
          <li><a href="/reports/tasks">Tasks added & completed</a></li>
          <li><a href="/timesheet">Timesheet</a></li>
        </ul>
      </Page>
    )
  }),

  page("/reports/activity", () => {
    const [q] = useSearchParams()
    const { people, person } = pickedPerson(q)
    const pg = pageNo(q)
    const evs = person ? events({ personId: person.id }).slice((pg - 1) * PER, pg * PER + 1) : []
    return (
      <Page title={person ? `What's ${firstName(person)} been up to?` : "Someone's activity"} crumbs={reportCrumbs}>
        <h1>{person ? `What's ${firstName(person)} been up to?` : "What's someone been up to?"}</h1>
        <PersonPicker action="/reports/activity" people={people} selectedId={person?.id ?? null} />
        {!person ? <p>Pick a person to see everything they did, by day.</p>
          : evs.length ? <ActivityList events={evs.slice(0, PER).map(toItem)} tz={me().time_zone} /> : <p>{firstName(person)} hasn't done anything here yet.</p>}
        {person && evs.length > PER && <p><a href={`/reports/activity?person=${person.id}&page=${pg + 1}`}>Show more</a></p>}
      </Page>
    )
  }),

  page("/reports/assignments", () => {
    const [q] = useSearchParams()
    const { people, person } = pickedPerson(q)
    const rows = person ? openWork((r) => assigneeIds(r).includes(person.id)) : []
    const byProject = groupBy(rows, (r) => r.project_name)
    return (
      <Page title={person ? `What's on ${firstName(person)}'s plate?` : "Someone's assignments"} crumbs={reportCrumbs}>
        <h1>{person ? `What's on ${firstName(person)}'s plate?` : "What's on someone's plate?"}</h1>
        <PersonPicker action="/reports/assignments" people={people} selectedId={person?.id ?? null} />
        {!person ? <p>Pick a person to see their tasks, cards and steps.</p>
          : rows.length
            ? [...byProject].map(([name, rs]) => (
              <div key={name}>
                <h2><a href={projectUrl(rs[0]!.project_id)}>{name}</a></h2>
                <ul>{rs.map((r) => <WorkItem key={r.id} r={r} extra={r.data.due_on && daysFromToday(r.data.due_on) < 0 ? <b>{lateBy(r.data.due_on)}</b> : null} />)}</ul>
              </div>
            ))
            : <p>Nothing's assigned to {firstName(person)} right now.</p>}
      </Page>
    )
  }),

  page("/reports/overdue", () => {
    const [q] = useSearchParams()
    const people = accountPeople()
    const by = q.get("by") === "person" ? "person" : "project"
    const now = today()
    const rows = openWork((r) => !!r.data.due_on && r.data.due_on < now)
    const groups = by === "project"
      ? groupBy(rows.map((r) => ({ ...r, who: "" })), (r) => r.project_name)
      : groupBy(rows.flatMap((r) => assigneeIds(r).length ? assigneeIds(r).map((id) => ({ ...r, who: people.find((p) => p.id === id)?.name ?? "Someone" })) : [{ ...r, who: "Unassigned" }]), (r) => r.who)
    return (
      <Page title="What's overdue?" crumbs={reportCrumbs}>
        <h1>What's overdue?</h1>
        <GetForm method="get"><label>Group by <select name="by" defaultValue={by}>
          <option value="project">Project</option><option value="person">Person</option></select></label> <button>Group</button></GetForm>
        {rows.length
          ? [...groups].map(([name, rs]) => (
            <div key={name}>
              <h2>{name}</h2>
              <ul>{rs.map((r, i) => (
                <WorkItem key={`${r.id}-${i}`} r={r} extra={<><b>{lateBy(r.data.due_on)}</b>{by === "project" && assigneeNames(r, people) ? <> · {assigneeNames(r, people)}</> : by === "person" ? <> · {r.project_name}</> : null}</>} />
              ))}</ul>
            </div>
          ))
          : <p>Nothing's overdue. Nice.</p>}
      </Page>
    )
  }),

  page("/reports/upcoming", () => {
    const [q] = useSearchParams()
    const range = q.get("range") === "30" ? 30 : 14
    const from = today()
    const until = isoDate(new Date(Date.now() + range * 86_400_000))
    const active = new Set(visibleProjects().map((p) => p.id))
    const within = (d: unknown) => typeof d === "string" && d.slice(0, 10) >= from && d.slice(0, 10) <= until
    const rows = recordings((r) => r.status === "active" && active.has(r.project_id)
      && ((r.type === "event" && within(r.data.starts_at)) || (DUE_TYPES.includes(r.type) && !r.data.completed_at && within(r.data.due_on))))
      .map((r) => ({ ...r, project_name: projectName(r.project_id), on_date: String(r.data.starts_at ?? r.data.due_on).slice(0, 10) }))
      .sort((a, b) => a.on_date.localeCompare(b.on_date) || a.id - b.id)
    const days = groupBy(rows, (r) => r.on_date)
    return (
      <Page title="What's coming up?" crumbs={reportCrumbs}>
        <h1>What's coming up?</h1>
        <p>{range === 14 ? <><b>Next 2 weeks</b> · <a href="/reports/upcoming?range=30">Next month</a></> : <><a href="/reports/upcoming?range=14">Next 2 weeks</a> · <b>Next month</b></>}</p>
        {rows.length
          ? [...days].map(([d, rs]) => (
            <div key={d}>
              <h2>{fmtDate(d)}</h2>
              <ul>{rs.map((r) => <li key={r.id}>{TYPE_NAMES[r.type]}: <a href={urlFor(r)}>{titleOf(r)}</a> <small>({r.project_name})</small></li>)}</ul>
            </div>
          ))
          : <p>Nothing's coming up in the next {range === 14 ? "2 weeks" : "month"}.</p>}
      </Page>
    )
  }),

  page("/reports/tasks", () => {
    const [q] = useSearchParams()
    const m = me()
    const { projects, ids } = scope()
    const people = accountPeople()
    const from = DATE.test(q.get("from") ?? "") ? q.get("from")! : isoDate(new Date(Date.now() - 30 * 86_400_000))
    const to = DATE.test(q.get("to") ?? "") ? q.get("to")! : today()
    const projectId = Number(q.get("project")) || null
    const personId = Number(q.get("person")) || null
    const bad = from > to
    const inScope = new Set(ids)
    const rows = bad ? [] : [...db.events.values()]
      .map((e) => ({ e, r: e.recording_id ? db.recordings.get(String(e.recording_id)) : undefined }))
      .filter(({ e, r }) => r?.type === "todo" && (e.action === "created" || e.action === "completed") && e.project_id !== null && inScope.has(e.project_id)
        && isoDate(e.created_at) >= from && isoDate(e.created_at) <= to
        && (!projectId || e.project_id === projectId) && (!personId || e.person_id === personId))
      .sort((a, b) => ms(b.e.created_at) - ms(a.e.created_at))
    const added = rows.filter(({ e }) => e.action === "created")
    const done = rows.filter(({ e }) => e.action === "completed")
    const list = (rs: typeof rows) => rs.length
      ? <ul>{rs.map(({ e, r }) => <li key={e.id}><a href={`/r/${e.recording_id}/go`}>{r!.title}</a> <small>{personName(e.person_id) ?? "Someone"} · {projectName(e.project_id)} · {fmtDate(e.created_at, m.time_zone)}</small></li>)}</ul>
      : <p>None.</p>
    return (
      <Page title="Tasks added & completed" crumbs={reportCrumbs}>
        <h1>Tasks added & completed</h1>
        <GetForm method="get">
          <label>From <input type="date" name="from" defaultValue={from} /></label> <label>To <input type="date" name="to" defaultValue={to} /></label>
          {" "}<label>Project <select name="project" defaultValue={projectId ?? ""}><option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {" "}<label>Person <select name="person" defaultValue={personId ?? ""}><option value="">Everyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {" "}<button>Show</button>
        </GetForm>
        {bad ? <p role="alert">The “From” date has to come before the “To” date.</p> : (
          <>
            <p><b>{plural(added.length, "task")} added, {done.length} completed</b> between {fmtDate(from)} and {fmtDate(to)}.</p>
            <h2>Added</h2>{list(added)}
            <h2>Completed</h2>{list(done)}
          </>
        )}
      </Page>
    )
  }),

  page("/overview", () => {
    const [q] = useSearchParams()
    // ponytail: staff only, since overdue counts would leak work clients can't see
    if (isClient(me())) throw new NoAccess()
    const ps = visibleProjects()
    const now = today()
    const recs = recordings((r) => r.status === "active")
    const latest = <T extends { project_id: number | null; created_at: string }>(rows: Iterable<T>, id: number) =>
      [...rows].filter((x) => x.project_id === id).reduce<string | null>((m, x) => (!m || ms(x.created_at) > ms(m) ? x.created_at : m), null)
    const weekAgo = Date.now() - 7 * 86_400_000
    const twoWeeksAgo = Date.now() - 14 * 86_400_000
    let rows = ps.map((p) => {
      const mine = recs.filter((r) => r.project_id === p.id)
      const g = [...db.gauge_updates.values()].filter((x) => x.project_id === p.id).sort((a, b) => b.id - a.id)[0]
      const s = {
        overdue: mine.filter((r) => DUE_TYPES.includes(r.type) && !r.data.completed_at && r.data.due_on && r.data.due_on < now).length,
        tracked: mine.filter((r) => r.type === "todolist" && String(r.data.tracked) === "true").length,
        last_hill: latest(db.hill_updates.values(), p.id),
        last_event: latest(db.events.values(), p.id),
        gauge: g?.value ?? null,
        gauge_note: g?.note ?? null,
      }
      const flags = [
        ...(s.overdue ? [`${plural(s.overdue, "overdue item")}`] : []),
        ...(s.tracked && (!s.last_hill || ms(s.last_hill) < twoWeeksAgo) ? ["progress hasn't moved in 2 weeks"] : []),
        ...(!s.last_event || ms(s.last_event) < weekAgo ? ["gone quiet: nothing in a week"] : []),
      ]
      return { p, s, flags }
    })
    const sort = q.get("sort") ?? "flags"
    const flaggedOnly = q.get("flagged") === "1"
    if (flaggedOnly) rows = rows.filter((r) => r.flags.length)
    rows.sort(sort === "name" ? (a, b) => a.p.name.localeCompare(b.p.name)
      : sort === "gauge" ? (a, b) => (b.s.gauge ?? -1) - (a.s.gauge ?? -1)
      : (a, b) => b.flags.length - a.flags.length || a.p.name.localeCompare(b.p.name))
    return (
      <Page title="Overview" crumbs={[["Activity", "/activity"]]}>
        <h1>Overview</h1>
        <p>Every project at a glance, with flags where something looks off.</p>
        <GetForm method="get">
          <label>Sort <select name="sort" defaultValue={sort}>
            <option value="flags">Most flags first</option>
            <option value="name">Name</option>
            <option value="gauge">Status</option></select></label>
          {" "}<label><input type="checkbox" name="flagged" value="1" defaultChecked={flaggedOnly} /> Only flagged projects</label>
          {" "}<button>Apply</button>
        </GetForm>
        {rows.length ? (
          <table>
            <thead><tr><th>Project</th><th>Status</th><th>Flags</th></tr></thead>
            <tbody>
              {rows.map(({ p, s, flags }) => (
                <tr key={p.id}>
                  <td><a href={projectUrl(p)}>{p.name}</a></td>
                  <td>{s.gauge !== null
                    ? <><a href={`/projects/${p.id}/status`}><meter min={0} max={100} value={s.gauge}>{s.gauge}%</meter></a> {s.gauge}%{s.gauge_note && <> <small>{s.gauge_note}</small></>}</>
                    : <a href={`/projects/${p.id}/status`}>Set the status</a>}</td>
                  <td>{flags.length ? <ul>{flags.map((f) => <li key={f}>⚑ {f}</li>)}</ul> : "All clear"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p>{flaggedOnly ? "No flagged projects. All clear." : "This fills in as your projects get going."}</p>}
      </Page>
    )
  }),

  page("/everything", () => {
    const [q] = useSearchParams()
    const m = me()
    const ids = new Set(scope().ids)
    const type = EVERYTHING[q.get("type") ?? ""] ? q.get("type")! : "messages"
    const pg = pageNo(q)
    const types = EVERYTHING[type]!.types
    const rows = recordings((r) => types.includes(r.type) && r.status === "active" && ids.has(r.project_id))
      .sort((a, b) => ms(b.created_at) - ms(a.created_at) || b.id - a.id)
      .slice((pg - 1) * PER, pg * PER + 1)
    return (
      <Page title="Everything" crumbs={[["Activity", "/activity"]]}>
        <h1>Everything</h1>
        <p>{Object.entries(EVERYTHING).map(([k, v], i) => <span key={k}>{i ? " · " : ""}{k === type ? <b>{v.label}</b> : <a href={`/everything?type=${k}`}>{v.label}</a>}</span>)}</p>
        {rows.length
          ? <ul>{rows.slice(0, PER).map((r) => (
            <li key={r.id}><a href={urlFor(r)}>{titleOf(r)}</a>
              <br /><small>{personName(r.creator_id) ?? "Someone"} · {projectName(r.project_id)} · {fmtDate(r.created_at, m.time_zone)}</small>
              {r.body && r.type !== "upload" && <><br />{excerpt(r.body)}</>}</li>
          ))}</ul>
          : <p>No {EVERYTHING[type]!.label.toLowerCase()} yet.</p>}
        {rows.length > PER && <p><a href={`/everything?type=${type}&page=${pg + 1}`}>Show more</a></p>}
      </Page>
    )
  }),
]
