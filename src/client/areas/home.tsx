// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates. Posts: src/areas/home.ts.
import * as stylex from "@stylexjs/stylex"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, account, findProject, visibleProjects, accountPeople, canCreateProjects, canInvite, recordings, NoAccess, type ProjectRow } from "../data.ts"
import { isClient, projectUrl, type Recording } from "../../shared/domain.ts"
import { fmtDate, excerpt, ms, today } from "../../shared/format.ts"
import { sx } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

const DESKTOP = "@media (min-width: 768px)"
const hs = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4, marginBottom: space.s6 },
  title: { margin: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2, margin: 0 },
  group: { fontSize: text.xs, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: color.muted, marginTop: space.s6, marginBottom: space.s3 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: space.s4, marginBottom: space.s2 },
  card: {
    position: "relative", display: "flex", flexDirection: "column", gap: 6, minHeight: 168, paddingBlock: space.s5, paddingInline: space.s5,
    borderRadius: radius.xl, borderTopWidth: 0, transitionProperty: "background-color", transitionDuration: motion.fast,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  // The name link covers the whole card, so the card is the click target; the Pin button sits above it.
  cardName: {
    fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none", color: color.ink, paddingRight: space.s6,
    "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" },
  },
  cardDesc: { fontSize: text.sm, color: color.muted, margin: 0, flexGrow: 1 },
  tag: {
    alignSelf: "flex-start", paddingBlock: 4, paddingInline: 9, borderRadius: radius.pill, backgroundColor: color.primary, color: color.onPrimary,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
  },
  pin: { position: "absolute", zIndex: 1, top: 14, right: 14, minHeight: 28, paddingBlock: 4, paddingInline: 10, fontSize: text.xs, backgroundColor: color.sheet },
  columns: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "1fr 1fr" }, gap: space.s4, marginTop: space.s6 },
  panel: { backgroundColor: color.tile, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s5 },
  panelTitle: { marginTop: 0, fontSize: text.md },
  row: { display: "flex", gap: space.s3, alignItems: "baseline", borderTopColor: color.line },
  when: { flexShrink: 0, width: "4.5em", fontSize: text.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  // Timeline: each dated project as a bar on one shared track, with today marked.
  lineup: { marginBottom: space.s6 },
  lineupHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: space.s3 },
  lineupTitle: { margin: 0, fontSize: text.md },
  track: { position: "relative", display: "grid", gap: space.s2, paddingTop: 26, paddingBottom: space.s2 },
  lane: { position: "relative", zIndex: 1, height: 34 },
  bar: (left: string, width: string) => ({ left, width }),
  barBox: {
    position: "absolute", top: 0, bottom: 0, minWidth: "fit-content", display: "flex", alignItems: "center", gap: space.s2,
    paddingInline: 14, borderRadius: radius.pill, fontSize: text.sm, fontWeight: 600,
    color: color.ink, textDecoration: "none", whiteSpace: "nowrap",
    transitionProperty: "background-color, transform", transitionDuration: motion.fast, transitionTimingFunction: motion.out,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
    transform: { default: null, ":active": { default: "scale(.98)", [media.reduce]: null } },
  },
  barDates: { fontWeight: 400, color: color.muted },
  today: (left: string) => ({ left }),
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, borderRadius: 2, backgroundColor: color.accent, pointerEvents: "none" },
  todayLabel: {
    position: "absolute", top: 0, transform: "translateX(-50%)", paddingBlock: 3, paddingInline: 8, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
  },
})

/** Pin or unpin a project for me, right away (the project menu uses it too). */
export const togglePin = (projectId: number) => () => {
  const k = `${me().id}:${projectId}`
  if (db.pins.has(k)) db.pins.delete(k)
  else db.pins.set(k, { person_id: me().id, project_id: projectId })
}

const DAY = 86_400_000
const Lineup = ({ ps }: { ps: ReadonlyArray<ProjectRow> }) => {
  const t = (d: string | null) => Date.parse(String(d).slice(0, 10))
  const from = Math.min(...ps.map((p) => t(p.starts_on)))
  const to = Math.max(...ps.map((p) => t(p.ends_on))) + DAY
  const pct = (ms: number) => `${(((ms - from) / (to - from)) * 100).toFixed(2)}%`
  const now = t(today())
  return (
    <div {...sx(hs.track)}>
      {ps.map((p) => (
        <div key={p.id} {...sx(hs.lane)}>
          <a href={projectUrl(p)} {...sx(hs.barBox, hs.bar(pct(t(p.starts_on)), pct(from + t(p.ends_on) + DAY - t(p.starts_on))))}>{p.name} <span {...sx(hs.barDates)}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</span></a>
        </div>
      ))}
      {now >= from && now <= to && <><span aria-hidden="true" {...sx(hs.todayLine, hs.today(pct(now)))} /><span {...sx(hs.todayLabel, hs.today(pct(now)))}>Today</span></>}
    </div>
  )
}

const PinButton = ({ p }: { p: ProjectRow }) => (
  <Form action={`/projects/${p.id}/pin`} style={{ display: "inline" }} optimistic={togglePin(p.id)}><button {...sx(hs.pin)}>{p.pinned ? "Unpin" : "Pin"}</button></Form>
)

const Cards = ({ ps, pin = true }: { ps: ReadonlyArray<ProjectRow>; pin?: boolean }) => (
  <ul {...sx(hs.cards)}>
    {ps.map((p) => (
      <li key={p.id} {...sx(hs.card)}>
        <a href={projectUrl(p)} {...sx(hs.cardName)}>{p.name}</a>
        {p.is_hq && <span {...sx(hs.tag)}>HQ</span>}{p.all_access && !p.is_hq && <span {...sx(hs.tag)}>All-access</span>}
        {p.description && <p {...sx(hs.cardDesc)}>{excerpt(p.description, 100)}</p>}
        {p.member_names && <small>{p.member_names}</small>}
        {pin && p.kind === "project" && <PinButton p={p} />}
      </li>
    ))}
  </ul>
)

type Upcoming = Recording & { project_name: string; on_date?: string }

/** What's on my plate / my next dates, for the Home cards. */
const myUpcoming = (limit = 5) => {
  const m = me()
  const live = (r: Recording) => r.status === "active" && db.projects.get(String(r.project_id))?.status === "active"
  const mine = (r: Recording) => ((r.data.assignee_ids ?? []) as number[]).includes(m.id) && !r.data.completed_at
  const named = (r: Recording, extra: Partial<Upcoming> = {}): Upcoming => ({ ...r, project_name: db.projects.get(String(r.project_id))?.name ?? "", ...extra })
  const assigned = recordings((r) => ["todo", "card", "step"].includes(r.type) && live(r) && mine(r))
    .sort((a, b) => (a.data.due_on ? (b.data.due_on ? a.data.due_on.localeCompare(b.data.due_on) : -1) : b.data.due_on ? 1 : 0) || a.id - b.id)
    .slice(0, limit)
    .map((r) => named(r))
  const t = today()
  const dates = recordings((r) => live(r) && (
    (r.type === "event" && (((r.data.participant_ids ?? []) as number[]).includes(m.id) || r.creator_id === m.id) && r.data.starts_at >= t)
    || (["todo", "card"].includes(r.type) && mine(r) && r.data.due_on >= t)))
    .map((r) => named(r, { on_date: r.data.starts_at ?? r.data.due_on }))
    .sort((a, b) => a.on_date!.localeCompare(b.on_date!))
    .slice(0, limit)
  return { assigned, dates }
}

const NewProjectForm = ({ templateId }: { templateId: string }) => {
  const templates = visibleProjects({ kind: "template" })
  return (
    <>
      <h1>Make a new project</h1>
      <Form action="/projects">
        <p><label>Name this project<br /><input name="name" required autoFocus /></label></p>
        <p><label>Add a description or a short note (optional)<br /><textarea name="description" rows={3} cols={60} /></label></p>
        {templates.length > 0 && (
          <p><label>Start from a template<br /><select name="template_id" defaultValue={templateId}><option value="">No template, start blank</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></p>
        )}
        <fieldset><legend>Who can see it?</legend>
          <label><input type="radio" name="access" value="invited" defaultChecked /> Just the people I invite</label><br />
          <label><input type="radio" name="access" value="all" /> Everyone at the company can see it (all-access)</label>
        </fieldset>
        <p><button>Create project</button> <a href="/">Cancel</a></p>
      </Form>
    </>
  )
}

export const routes = [
  page("/", () => {
    const m = me()
    const all = visibleProjects()
    const hq = all.filter((p) => p.is_hq)
    const pinned = all.filter((p) => p.pinned && !p.is_hq)
    const recentIds = (m.prefs.recent_projects ?? []).filter((id) => !pinned.some((p) => p.id === id) && !hq.some((p) => p.id === id))
    const recent = recentIds.map((id) => all.find((p) => p.id === id)).filter((p): p is ProjectRow => !!p).slice(0, 6)
    const others = pinned.length + recent.length ? [] : all.filter((p) => !p.is_hq).slice(0, 6)
    const dated = all.filter((p) => p.starts_on && p.ends_on)
    const { assigned, dates } = myUpcoming()
    return (
      <Page title="Home">
        <div {...sx(hs.head)}>
          <h1 {...sx(hs.title)}>Home</h1>
          <p {...sx(hs.actions)}>
            {canCreateProjects() && <a href="/projects/new" data-button>Make a new project</a>}
            {canInvite() && <a href="/people/invite" data-button>Invite people</a>}
          </p>
        </div>
        <section aria-label="Timeline" {...sx(hs.lineup)}>
          <div {...sx(hs.lineupHead)}><h2 {...sx(hs.lineupTitle)}><a href="/timeline">Timeline</a></h2>{dated.length > 0 && <a href="/timeline"><small>Open the Timeline</small></a>}</div>
          {dated.length
            ? <Lineup ps={dated} />
            : <p>Projects with start and end dates show up here. <a href="/timeline">Open the Timeline</a></p>}
        </section>
        {all.length === 0 ? (
          <><p>Welcome to Home. Projects you make or get added to show up here.</p>{canCreateProjects() && <p><a href="/projects/new">Make a new project</a></p>}</>
        ) : (
          <>
            {hq.length > 0 && <Cards ps={hq} pin={false} />}
            {pinned.length > 0 && <><h2 {...sx(hs.group)}>Pinned</h2><Cards ps={pinned} /></>}
            {recent.length > 0 && <><h2 {...sx(hs.group)}>Recently visited</h2><Cards ps={recent} /></>}
            {others.length > 0 && <><h2 {...sx(hs.group)}>Projects</h2><Cards ps={others} /></>}
          </>
        )}
        <p><small><a href="/projects">View all projects</a> · <a href="/templates">Templates</a></small></p>
        <div {...sx(hs.columns)}>
          <section aria-label="Your Calendar" {...sx(hs.panel)}>
            <h2 {...sx(hs.panelTitle)}><a href="/my/calendar">Your Calendar</a></h2>
            {dates.length
              ? <ul>{dates.map((r) => <li key={r.id} {...sx(hs.row)}><span {...sx(hs.when)}>{fmtDate(r.on_date)}</span><span><a href={`/r/${r.id}/go`}>{r.title}</a> <small>{r.project_name}</small></span></li>)}</ul>
              : <p>No upcoming dates for you.</p>}
          </section>
          <section aria-label="Your Assignments" {...sx(hs.panel)}>
            <h2 {...sx(hs.panelTitle)}><a href="/my/assignments">Your Assignments</a></h2>
            {assigned.length
              ? <ul>{assigned.map((r) => <li key={r.id} {...sx(hs.row)}><span><a href={`/r/${r.id}/go`}>{r.title}</a> <small>{r.project_name}{r.data.due_on ? `, due ${fmtDate(r.data.due_on)}` : ""}</small></span></li>)}</ul>
              : <p>Nothing's assigned to you right now.</p>}
          </section>
        </div>
      </Page>
    )
  }),

  page("/projects", () => {
    const [query] = useSearchParams()
    const m = me()
    const q = (query.get("q") ?? "").trim().toLowerCase()
    const view = query.get("view") === "list" ? "list" : "cards"
    const sort = query.get("sort") ?? "recent"
    let ps = visibleProjects()
    if (q) ps = ps.filter((p) => p.name.toLowerCase().includes(q))
    const recent = m.prefs.recent_projects ?? []
    if (sort === "recent") ps = [...ps].sort((a, b) => (recent.indexOf(a.id) + 1 || 999) - (recent.indexOf(b.id) + 1 || 999))
    if (sort === "newest") ps = [...ps].sort((a, b) => ms(b.created_at) - ms(a.created_at))
    return (
      <Page title="All projects">
        <h1>All projects</h1>
        <GetForm method="get" action="/projects">
          <label>Filter by name… <input type="search" name="q" defaultValue={query.get("q") ?? ""} /></label>
          <label>Sort <select name="sort" defaultValue={sort}>
            <option value="recent">Recently visited</option>
            <option value="alpha">Alphabetical</option>
            <option value="newest">Newest</option>
          </select></label>
          <label>View <select name="view" defaultValue={view}><option value="cards">Cards</option><option value="list">List</option></select></label>
          <button>Apply</button>
        </GetForm>
        {canCreateProjects() && <p><a href="/projects/new" data-button>Make a new project</a></p>}
        {ps.length === 0
          ? q ? <p>No projects match “{q}”.</p> : <p>No projects yet. Make one to get started.</p>
          : view === "list"
            ? (
              <table><thead><tr><th>Project</th><th>People</th><th>Dates</th><th></th></tr></thead><tbody>{ps.map((p) => (
                <tr key={p.id}>
                  <td><a href={projectUrl(p)}>{p.name}</a></td><td>{p.member_names ?? ""}</td>
                  <td>{p.starts_on && <>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</>}</td>
                  <td><Form action={`/projects/${p.id}/pin`} optimistic={togglePin(p.id)}><button>{p.pinned ? "Unpin" : "Pin"}</button></Form></td>
                </tr>
              ))}</tbody></table>
            )
            : <Cards ps={ps} />}
        <p><a href="/projects/archived">Archived projects</a> · <a href="/templates">Templates</a></p>
      </Page>
    )
  }),

  page("/projects/archived", () => {
    const [query] = useSearchParams()
    const q = (query.get("q") ?? "").trim().toLowerCase()
    const ps = visibleProjects({ status: "archived" }).filter((p) => !q || p.name.toLowerCase().includes(q))
    return (
      <Page title="Archived projects" crumbs={[["All projects", "/projects"]]}>
        <h1>Archived projects</h1>
        <GetForm method="get"><label>Filter by name <input type="search" name="q" defaultValue={query.get("q") ?? ""} /></label> <button>Filter</button></GetForm>
        {ps.length
          ? <ul>{ps.map((p) => <li key={p.id}><a href={projectUrl(p)}>{p.name}</a> {!isClient(me()) && <Form action={`/projects/${p.id}/unarchive`} style={{ display: "inline" }}><button>Unarchive</button></Form>}</li>)}</ul>
          : <p>Nothing's archived. When a project wraps up, archive it from its ••• menu. Everything in it is kept.</p>}
      </Page>
    )
  }),

  page("/projects/new", () => {
    const [q] = useSearchParams()
    if (!canCreateProjects()) throw new NoAccess()
    return <Page title="New project"><NewProjectForm templateId={q.get("template_id") ?? ""} /></Page>
  }),

  page("/projects/:id/people/setup", () => {
    const p = findProject(useParams().id)
    const m = me()
    const everyone = accountPeople().filter((x) => x.id !== m.id)
    return (
      <Page title="Who's on this project?" crumbs={projectCrumbs(p)}>
        <h1>Who's on {p.name}?</h1>
        <Form action={`/projects/${p.id}/people/setup`}>
          <p>Add people from {account().name}:</p>
          {everyone.length ? <PeopleCheckboxes name="person_ids" people={everyone} /> : <p>Nobody else is here yet.</p>}
          <p><label>Or invite new people by email (one per line)<br /><textarea name="emails" rows={3} cols={50} placeholder="name@example.com" /></label></p>
          <p><label><input type="checkbox" name="send_email" defaultChecked /> Send them an email invitation</label></p>
          <p><label>Add a personal note to the invitation (optional)<br /><textarea name="note" rows={2} cols={50} /></label></p>
          <button>Add these people</button> <a href={projectUrl(p)}>Skip for now</a>
        </Form>
      </Page>
    )
  }),

  page("/templates", () => {
    const ts = visibleProjects({ kind: "template" })
    return (
      <Page title="Templates" crumbs={[["Home", "/"]]}>
        <h1>Templates</h1>
        {ts.length
          ? <ul>{ts.map((t) => <li key={t.id}><a href={`/projects/${t.id}`}>{t.name}</a> {t.description && <>: {t.description}</>} <a href={`/templates/${t.id}/use`} data-button>Use this template</a></li>)}</ul>
          : <p>Templates are projects you copy over and over. Start one from scratch, or save any project as a template from its ••• menu.</p>}
        {!isClient(me()) && <Form action="/templates"><p><label>Name a new template <input name="name" required /></label> <button>Make a new template</button></p></Form>}
      </Page>
    )
  }),

  page("/templates/:id/use", () => {
    const [q] = useSearchParams()
    const t = findProject(useParams().id)
    if (t.kind !== "template") return <Navigate replace to={projectUrl(t)} />
    const everyone = accountPeople().filter((x) => x.id !== me().id)
    return (
      <Page title="New project from a template" crumbs={[["Templates", "/templates"], [t.name, `/projects/${t.id}`]]}>
        <h1>New project from “{t.name}”</h1>
        <p>We'll copy everything in the template into a brand-new project.</p>
        <Form action={`/templates/${t.id}/use`}>
          <p><label>Project name<br /><input name="name" defaultValue={q.get("name") ?? ""} required /></label></p>
          <p><label>Description<br /><textarea name="description" rows={3} cols={60} defaultValue={t.description ?? ""} /></label></p>
          <p>Who's on this project?</p>
          <PeopleCheckboxes name="person_ids" people={everyone} />
          <p><button>Create project</button> <a href="/templates">Cancel</a></p>
        </Form>
      </Page>
    )
  }),
]
