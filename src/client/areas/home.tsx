// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates. Posts: src/areas/home.ts.
import * as stylex from "@stylexjs/stylex"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { observer } from "mobx-react-lite"
import { me, account, findProject, visibleProjects, accountPeople, canCreateProjects, canInvite, projectPeople, recordings, NoAccess, type ProjectRow } from "../data.ts"
import { isClient, projectUrl, urlFor, type Recording } from "../../shared/domain.ts"
import { addDays, ago, fmtDate, excerpt, ms, plural, today } from "../../shared/format.ts"
import { Face, kit, ProgressBar, sx } from "../ui/kit.tsx"
import { lateTasks, progressOf, seenOf, windowNews } from "../news.ts"
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
  // Home: the projects first, each card saying what moved since you last looked.
  homeHead: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4, marginBottom: space.s4 },
  homeTitle: { margin: 0, fontSize: text.lg },
  homeCards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: space.s3, margin: 0 },
  hcard: {
    position: "relative", display: "flex", flexDirection: "column", gap: 6, minHeight: 176, padding: space.s5, borderRadius: radius.xl, borderTopWidth: 0,
    transitionProperty: "background-color", transitionDuration: motion.fast,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  hdesc: { margin: 0, fontSize: text.sm, color: color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  hdates: { fontSize: text.xs, color: color.muted, fontVariantNumeric: "tabular-nums" },
  // How far along: a thin bar and the share of the tasks done.
  hprogress: { display: "flex", alignItems: "center", gap: space.s2, margin: 0, fontSize: text.xs, color: color.muted, fontVariantNumeric: "tabular-nums" },
  hprogressName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.ink, fontWeight: 600 },
  // The card's news, the same as the project's window row: "Chat 5 · Files 2", and what's late, outlined.
  hnews: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: 0, marginTop: "auto", paddingTop: space.s2, fontSize: text.sm, fontWeight: 600 },
  hnewsItem: { display: "inline-flex", alignItems: "center", gap: 5 },
  hnum: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, paddingInline: 5, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  },
  hlate: { paddingBlock: 1, paddingInline: 8, borderRadius: radius.pill, color: color.accentText, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.accent} 55%, transparent)` },
  hcalm: { fontWeight: 400, color: color.muted },
  hfaces: { display: "flex", paddingLeft: 4, marginTop: space.s2 },
  hface: { marginLeft: -4, borderRadius: radius.pill, boxShadow: `0 0 0 2px ${color.tile}`, display: "inline-flex" },
  hmore: { display: "flex", flexWrap: "wrap", columnGap: space.s4, rowGap: space.s1, marginTop: space.s3, marginBottom: 0, fontSize: text.sm },
  // Two short lists under the projects: what's due for you, what's coming up.
  waiting: { marginTop: space.s7 },
  waitingCount: { color: color.muted, fontWeight: 400 },
  lists: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "1fr 1fr" }, gap: space.s3, marginTop: space.s7 },
  listTitle: { marginTop: 0, marginBottom: space.s2, fontSize: text.md },
  late: { color: color.accentText, fontWeight: 650 },
  quiet: { margin: 0, color: color.muted },
  timeline: { marginTop: space.s7 },
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
  <Form action={`/projects/${p.id}/pin`} style={{ display: "inline" }} optimistic={togglePin(p.id)}><button data-row-action {...sx(hs.pin)}>{p.pinned ? "Unpin" : "Pin"}</button></Form>
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

/** A project on Home: its name, a line of description, its dates, what moved since you last looked, and its people. */
const HomeCard = observer(({ p }: { p: ProjectRow }) => {
  const m = me()
  const since = m.prefs.project_seen?.[String(p.id)] ?? null
  // The same counts as the project's window row: per window, since you last opened that window.
  const shown = p.tools.filter((t) => t.enabled)
  const nameOf = new Map(shown.map((t) => [t.id, t.name]))
  const news = [...windowNews(p.id, m.id, seenOf(m.prefs, p.id)).counts].filter(([id]) => nameOf.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const late = shown.some((t) => t.type === "todos") ? lateTasks(p.id) : 0
  const pr = progressOf(p)
  const people = projectPeople(p)
  return (
    <li {...sx(hs.hcard)}>
      <a href={projectUrl(p)} {...sx(hs.cardName)}>{p.name}</a>
      {p.is_hq && <span {...sx(hs.tag)}>HQ</span>}
      {p.description && <p {...sx(hs.hdesc)}>{excerpt(p.description, 120)}</p>}
      {(p.starts_on || p.ends_on) && <small {...sx(hs.hdates)}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</small>}
      {pr.total > 0 && (
        <p {...sx(hs.hprogress)} title={`${pr.done} of ${pr.total} done`}>
          <ProgressBar pct={pr.pct} width={56} /><span {...sx(hs.hprogressName)}>{pr.pct}% done</span>
        </p>
      )}
      <p {...sx(hs.hnews)}>
        {news.map(([id, n]) => <span key={id} {...sx(hs.hnewsItem)}>{nameOf.get(id)}<span {...sx(hs.hnum)} aria-label={`${n} new`}>{n}</span></span>)}
        {late > 0 && <span {...sx(hs.hlate)}>{late} late</span>}
        {!news.length && !late && since && <span {...sx(hs.hcalm)}>All caught up.</span>}
      </p>
      {people.length > 0 && <span aria-label={`People: ${people.map((x) => x.name).join(", ")}`} {...sx(hs.hfaces)}>{people.slice(0, 6).map((x) => <span key={x.id} {...sx(hs.hface)}><Face p={x} px={24} /></span>)}</span>}
      {p.kind === "project" && !p.is_hq && <PinButton p={p} />}
    </li>
  )
})

type Upcoming = Recording & { project_name: string; on_date?: string }

/** What's on my plate (soonest due first, so late leads) and my events in the next two weeks, for Home's two lists. */
const myUpcoming = (limit = 5) => {
  const m = me()
  const live = (r: Recording) => r.status === "active" && db.projects.get(String(r.project_id))?.status === "active"
  const mine = (r: Recording) => ((r.data.assignee_ids ?? []) as number[]).includes(m.id) && !r.data.completed_at
  const named = (r: Recording, extra: Partial<Upcoming> = {}): Upcoming => ({ ...r, project_name: db.projects.get(String(r.project_id))?.name ?? "", ...extra })
  const allAssigned = recordings((r) => ["todo", "card", "step"].includes(r.type) && live(r) && mine(r))
    .sort((a, b) => (a.data.due_on ? (b.data.due_on ? a.data.due_on.localeCompare(b.data.due_on) : -1) : b.data.due_on ? 1 : 0) || a.id - b.id)
  const assigned = allAssigned.slice(0, limit).map((r) => named(r))
  const t = today()
  const until = addDays(t, 14)
  const dates = recordings((r) => live(r) && r.type === "event" && (((r.data.participant_ids ?? []) as number[]).includes(m.id) || r.creator_id === m.id)
    && r.data.starts_at >= t && r.data.starts_at.slice(0, 10) <= until)
    .map((r) => named(r, { on_date: r.data.starts_at ?? r.data.due_on }))
    .sort((a, b) => a.on_date!.localeCompare(b.on_date!))
    .slice(0, limit)
  return { assigned, dates, assignedTotal: allAssigned.length }
}

/** Cards waiting in Review on projects I'm on, oldest first: what a sweep works through. */
const waitingForMe = () => {
  const m = me()
  const onIt = new Set([...db.project_people.values()].filter((x) => x.person_id === m.id).map((x) => x.project_id))
  const review = new Set(recordings((r) => r.type === "column" && r.status === "active" && r.data.kind === "review" && onIt.has(r.project_id)).map((r) => r.id))
  const at = (r: Recording) => r.data.review?.at ?? r.updated_at
  return recordings((r) => r.type === "card" && r.status === "active" && r.parent_id !== null && review.has(r.parent_id)
    && db.projects.get(String(r.project_id))?.status === "active")
    .sort((a, b) => ms(at(a)) - ms(at(b)) || a.id - b.id)
}

/** Waiting for you: shown while something's waiting, or once you've connected an agent ("All caught up"). */
const WaitingForYou = observer(() => {
  const m = me()
  const cards = waitingForMe()
  const hasAgents = [...db.connected_apps.values()].some((a) => a.person_id === m.id)
  if (!cards.length && !hasAgents) return null
  return (
    <section aria-labelledby="waiting" {...sx(hs.panel, hs.waiting)}>
      <h2 id="waiting" {...sx(hs.listTitle)}>Waiting for you{cards.length > 0 && <span {...sx(hs.waitingCount)}> ({cards.length})</span>}</h2>
      {cards.length ? (
        <ul>{cards.slice(0, 10).map((r) => {
          const rv = r.data.review as { at?: string; by?: number; via?: string | null } | undefined
          const who = rv?.via ? `via ${rv.via}` : rv?.by && rv.by !== m.id ? `from ${db.people.get(String(rv.by))?.name ?? "someone"}` : ""
          return (
            <li key={r.id} {...sx(hs.row)}><span>
              <a href={`${urlFor(r)}?from=home`}>{r.title}</a>{" "}
              <small>{[db.projects.get(String(r.project_id))?.name, who, ago(rv?.at ?? r.updated_at, m.time_zone)].filter(Boolean).join(" · ")}</small>
            </span></li>
          )
        })}</ul>
      ) : <p {...sx(hs.quiet)}>All caught up. Nothing new from your agents.</p>}
      {cards.length > 10 && <p {...sx(hs.hmore)}>And {cards.length - 10} more. Open them from each project's Board.</p>}
    </section>
  )
})

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
    const recent = recentIds.map((id) => all.find((p) => p.id === id)).filter((p): p is ProjectRow => !!p)
    // HQ, then pinned, then recent, up to 8; with none pinned or visited yet, the first projects there are.
    const rest = all.filter((p) => !p.is_hq && !pinned.includes(p) && !recent.includes(p))
    const shown = [...hq, ...pinned, ...recent, ...(pinned.length + recent.length ? [] : rest)].slice(0, 8)
    const dated = all.filter((p) => p.starts_on && p.ends_on)
    const { assigned, dates, assignedTotal } = myUpcoming()
    const t = today()
    return (
      <Page title="Home">
        <h1 {...sx(kit.srOnly)}>Home</h1>
        {all.length === 0 ? (
          <div {...sx(kit.empty)}>
            <p>Welcome. Make your first project, then invite the people working on it.</p>
            {canCreateProjects() && <p><a href="/projects/new" data-button>Make a new project</a></p>}
          </div>
        ) : (
          <section aria-labelledby="projects">
            <div {...sx(hs.homeHead)}>
              <h2 id="projects" {...sx(hs.homeTitle)}>Projects</h2>
              {canCreateProjects() && <a href="/projects/new" data-button>Make a new project</a>}
            </div>
            <ul {...sx(hs.homeCards)}>{shown.map((p) => <HomeCard key={p.id} p={p} />)}</ul>
            <p {...sx(hs.hmore)}><a href="/projects">All projects ({all.length})</a><a href="/templates">Templates</a></p>
          </section>
        )}
        <WaitingForYou />
        <div {...sx(hs.lists)}>
          <section aria-labelledby="due" {...sx(hs.panel)}>
            <h2 id="due" {...sx(hs.listTitle)}><a href="/my/assignments">Due for you</a></h2>
            {assigned.length ? (
              <ul>{assigned.map((r) => {
                const late = r.data.due_on && r.data.due_on < t
                return <li key={r.id} {...sx(hs.row)}><span><a href={`/r/${r.id}/go`}>{r.title}</a> <small>{r.project_name}{r.data.due_on && <>, <span {...sx(late && hs.late)}>{late ? `was due ${fmtDate(r.data.due_on)}` : `due ${fmtDate(r.data.due_on)}`}</span></>}</small></span></li>
              })}</ul>
            ) : <p {...sx(hs.quiet)}>Nothing's due for you. Enjoy it.</p>}
            {assignedTotal > assigned.length && <p {...sx(hs.hmore)}><a href="/my/assignments">See all {assignedTotal}</a></p>}
          </section>
          <section aria-labelledby="coming" {...sx(hs.panel)}>
            <h2 id="coming" {...sx(hs.listTitle)}><a href="/my/calendar">Coming up</a></h2>
            {dates.length
              ? <ul>{dates.map((r) => <li key={r.id} {...sx(hs.row)}><span {...sx(hs.when)}>{fmtDate(r.on_date)}</span><span><a href={`/r/${r.id}/go`}>{r.title}</a> <small>{r.project_name}</small></span></li>)}</ul>
              : <p {...sx(hs.quiet)}>Nothing on your calendar in the next two weeks.</p>}
          </section>
        </div>
        {dated.length > 0 && (
          <section aria-label="Timeline" {...sx(hs.lineup, hs.timeline)}>
            <div {...sx(hs.lineupHead)}><h2 {...sx(hs.lineupTitle)}><a href="/timeline">Timeline</a></h2><a href="/timeline"><small>Open the Timeline</small></a></div>
            <Lineup ps={dated} />
          </section>
        )}
        <p {...sx(hs.hmore)}><a href="/activity">See all activity</a>{canInvite() && <a href="/people/invite">Invite people</a>}</p>
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
          ? <ul>{ts.map((t) => <li key={t.id}><a href={`/projects/${t.id}`}>{t.name}</a> {t.description && <>: {t.description}</>} <a href={`/templates/${t.id}/use`} data-button>Use this template</a>
              {t.id === account().settings.agent_template_id && <><br /><small>Agents start new projects from this template.</small></>}</li>)}</ul>
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
