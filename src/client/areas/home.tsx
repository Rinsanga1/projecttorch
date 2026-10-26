// Home: Home, Archived projects, New project, Who's on this project?, Templates. Posts: src/areas/home.ts.
import * as stylex from "@stylexjs/stylex"
import { useState, type DragEvent, type KeyboardEvent } from "react"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { observer } from "mobx-react-lite"
import { me, account, findProject, visibleProjects, accountPeople, canCreateProjects, canInvite, projectPeople, recordings, NoAccess, type ProjectRow } from "../data.ts"
import { isClient, projectUrl, urlFor, type Recording } from "../../shared/domain.ts"
import { addDays, ago, fmtDate, excerpt, ms, today } from "../../shared/format.ts"
import { Face, kit, ProgressBar, sx } from "../ui/kit.tsx"
import { Icon } from "../ui/icons.tsx"
import { lateTasks, progressOf, seenOf, windowNews } from "../news.ts"
import { Form, PeopleCheckboxes, usePost } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { TeamLink } from "./people.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

const DESKTOP = "@media (min-width: 768px)"
// Past this many projects Home offers a filter, and past DENSE its cards get shorter.
const FILTER_AT = 9
const DENSE_AT = 12
const hs = stylex.create({
  // The day in one line: what needs you, each number a jump to its list.
  today: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, margin: 0, marginBottom: space.s5, maxWidth: "none", fontSize: text.md, color: color.muted },
  todayDate: { color: color.ink, fontWeight: 650, letterSpacing: "-0.01em" },
  todayLink: { color: color.ink, textDecorationLine: "none", ":hover": { textDecorationLine: { default: null, [media.hover]: "underline" } } },
  todayLate: { color: color.accentText, fontWeight: 650 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4, marginTop: space.s7, marginBottom: space.s4 },
  title: { margin: 0, fontSize: text.lg },
  count: { color: color.muted, fontWeight: 400 },
  filter: { marginTop: 0, marginBottom: space.s4 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: space.s3, margin: 0 },
  // The name link covers the whole card, so the card is the click target; the pin sits above it.
  card: {
    position: "relative", display: "flex", flexDirection: "column", gap: 6, minHeight: 176, padding: space.s5, borderRadius: radius.xl, borderTopWidth: 0,
    transitionProperty: "background-color, opacity", transitionDuration: motion.fast,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  cardDense: { minHeight: 0, paddingBlock: space.s4 },
  // Dragging a pinned card: it fades, and an orange edge shows where it lands.
  dragging: { opacity: 0.45 },
  dropBefore: { boxShadow: `inset 3px 0 0 ${color.accent}` },
  dropAfter: { boxShadow: `inset -3px 0 0 ${color.accent}` },
  cardName: {
    fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none", color: color.ink, paddingRight: space.s6,
    "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" },
  },
  tag: {
    alignSelf: "flex-start", paddingBlock: 4, paddingInline: 9, borderRadius: radius.pill, backgroundColor: color.primary, color: color.onPrimary,
    fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
  },
  desc: { margin: 0, fontSize: text.sm, color: color.muted, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 },
  descDense: { WebkitLineClamp: 1 },
  dates: { fontSize: text.xs, color: color.muted, fontVariantNumeric: "tabular-nums" },
  progress: { display: "flex", alignItems: "center", gap: space.s2, margin: 0, fontSize: text.xs, color: color.ink, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  // What needs you here (Review, late), then what people added since you last looked: the same counts as the project's rail.
  news: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: 0, marginTop: "auto", paddingTop: space.s2, fontSize: text.sm, fontWeight: 600 },
  newsItem: { display: "inline-flex", alignItems: "center", gap: 5 },
  num: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, paddingInline: 5, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
  },
  review: { paddingBlock: 2, paddingInline: 9, borderRadius: radius.pill, backgroundColor: color.accent, color: color.onAccent },
  late: { paddingBlock: 1, paddingInline: 8, borderRadius: radius.pill, color: color.accentText, boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color.accent} 55%, transparent)` },
  calm: { fontWeight: 400, color: color.muted },
  faces: { display: "flex", alignItems: "center", gap: 3, marginTop: space.s1 },
  face: { display: "inline-flex" },
  more: { marginLeft: space.s2, fontSize: text.xs, fontWeight: 600, color: color.muted },
  // Pinned cards show their pin; the rest show it on hover (always on touch).
  pin: {
    position: "absolute", zIndex: 1, top: 12, right: 12, width: 32, minHeight: 32, padding: 0, color: color.muted,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.sheet } },
  },
  pinned: { color: color.ink },
  links: { display: "flex", flexWrap: "wrap", columnGap: space.s4, rowGap: space.s1, marginTop: space.s3, marginBottom: 0, fontSize: text.sm, maxWidth: "none" },
  // A tile holding a list: Waiting for you, Mine, Coming up.
  panel: { backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s5 },
  panelTitle: { marginTop: 0, marginBottom: space.s3, fontSize: text.md },
  list: { marginBottom: 0 },
  // Mine and Coming up, side by side, each as tall as what it holds.
  lists: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "1fr 1fr" }, alignItems: "start", gap: space.s3, marginTop: space.s7 },
  // A list row: the title, then where it's from on a second line; a date or time beside it.
  item: { display: "grid", gridTemplateColumns: "1fr auto", columnGap: space.s4, alignItems: "baseline", borderTopColor: color.line },
  dated: { gridTemplateColumns: "4.5em 1fr" },
  itemTitle: {
    display: "block", fontWeight: 550, color: color.ink, textDecorationLine: "none",
    ":hover": { textDecorationLine: { default: null, [media.hover]: "underline" } },
  },
  itemMeta: { display: "block", marginTop: 2 },
  when: { fontSize: text.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  whenLate: { color: color.accentText },
  quiet: { margin: 0, color: color.muted },
  foot: { marginTop: space.s6 },
  // A template: its name and what it is, and the button to use it at the end of the row.
  trow: { display: "flex", alignItems: "center", gap: space.s4, justifyContent: "space-between" },
  tuse: { flexShrink: 0 },
})

const pinOf = (projectId: number) => db.pins.get(`${me().id}:${projectId}`)

/** Pin or unpin a project for me, right away (the project menu uses it too). A new pin goes after the pinned ones. */
export const togglePin = (projectId: number) => () => {
  const m = me()
  const k = `${m.id}:${projectId}`
  if (db.pins.has(k)) return void db.pins.delete(k)
  const last = Math.max(0, ...[...db.pins.values()].filter((x) => x.person_id === m.id).map((x) => x.position ?? 0))
  db.pins.set(k, { person_id: m.id, project_id: projectId, position: last + 1 })
}

/** Every `pos_<project id>` field becomes that pin's position, right away. */
const reorderPins = (fd: FormData) => {
  for (const [k, v] of fd.entries()) {
    const pin = k.startsWith("pos_") ? pinOf(Number(k.slice(4))) : undefined
    if (pin) db.pins.set(`${pin.person_id}:${pin.project_id}`, { ...pin, position: Number(v) || 0 })
  }
}

const PinButton = ({ p }: { p: ProjectRow }) => (
  <Form action={`/projects/${p.id}/pin`} style={{ display: "inline" }} optimistic={togglePin(p.id)}>
    <button data-quiet data-row-action={p.pinned ? undefined : true} aria-label={p.pinned ? `Unpin ${p.name}` : `Pin ${p.name} to the top`}
      title={p.pinned ? "Unpin" : "Pin to the top"} {...sx(hs.pin, p.pinned && hs.pinned)}><Icon name="pin" size={18} /></button>
  </Form>
)

/** A project on Home: its name, a line or two of description, its dates and progress, what needs you there, what's new, and its people. */
const HomeCard = observer(({ p, review, dense }: { p: ProjectRow; review: number; dense: boolean }) => {
  const m = me()
  const since = m.prefs.project_seen?.[String(p.id)] ?? null
  // The same counts as the project's rail: per window, since you last opened that window.
  const shown = p.tools.filter((t) => t.enabled)
  const nameOf = new Map(shown.map((t) => [t.id, t.name]))
  const news = [...windowNews(p.id, m.id, seenOf(m.prefs, p.id)).counts].filter(([id]) => nameOf.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 3)
  const late = shown.some((t) => t.type === "todos") ? lateTasks(p.id) : 0
  const pr = progressOf(p)
  const people = projectPeople(p)
  return (
    <>
      <a href={projectUrl(p)} draggable={false} {...sx(hs.cardName)}>{p.name}</a>
      {p.all_access && <span {...sx(hs.tag)}>All-access</span>}
      {p.description && <p {...sx(hs.desc, dense && hs.descDense)}>{excerpt(p.description, 160)}</p>}
      {(p.starts_on || p.ends_on) && <small {...sx(hs.dates)}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</small>}
      {pr.done > 0 && <p {...sx(hs.progress)} title={`${pr.done} of ${pr.total} done`}><ProgressBar pct={pr.pct} width={56} />{pr.pct}% done</p>}
      <p {...sx(hs.news)}>
        {review > 0 && <span {...sx(hs.review)}>Review {review}</span>}
        {late > 0 && <span {...sx(hs.late)}>{late} late</span>}
        {news.map(([id, n]) => <span key={id} {...sx(hs.newsItem)}>{nameOf.get(id)}<span {...sx(hs.num)} aria-label={`${n} new`}>{n}</span></span>)}
        {!review && !late && !news.length && since && <span {...sx(hs.calm)}>All caught up.</span>}
      </p>
      {!dense && people.length > 0 && (
        <span {...sx(hs.faces)} title={people.map((x) => x.name).join(", ")}>
          {people.slice(0, 4).map((x) => <span key={x.id} {...sx(hs.face)}><Face p={x} px={24} /></span>)}
          {people.length > 4 && <span {...sx(hs.more)}>+{people.length - 4}</span>}
        </span>
      )}
      {p.kind === "project" && <PinButton p={p} />}
    </>
  )
})

/** Every project: pinned ones first, in the order you dragged them into, then the rest by name. Nothing moves
 * on its own, so your hand learns where each project is; what needs you shows on the card instead. */
const Projects = observer(({ all, reviewBy }: { all: ProjectRow[]; reviewBy: Map<number, number> }) => {
  const [q, setQ] = useState("")
  const pinned = all.filter((p) => p.pinned).sort((a, b) => (pinOf(a.id)?.position ?? 0) - (pinOf(b.id)?.position ?? 0) || a.name.localeCompare(b.name))
  const rest = all.filter((p) => !p.pinned)
  const needle = q.trim().toLowerCase()
  const shown = [...pinned, ...rest].filter((p) => !needle || p.name.toLowerCase().includes(needle))
  const dense = all.length > DENSE_AT

  // Pinned cards reorder by dragging (or Alt+←/→ on a card). The order saves at once.
  const post = usePost()
  const ids = pinned.map((p) => p.id)
  const [dragId, setDragId] = useState<number | null>(null)
  const [drop, setDrop] = useState<number | null>(null)
  const moveTo = (id: number, to: number) => {
    const next = ids.filter((x) => x !== id)
    next.splice(to, 0, id)
    if (next.join() === ids.join()) return
    const fd = new FormData()
    next.forEach((x, i) => fd.set(`pos_${x}`, String(i + 1)))
    post("/pins/reorder", fd, () => reorderPins(fd))
  }
  const dragProps = (id: number) => {
    const i = ids.indexOf(id)
    if (i < 0 || ids.length < 2 || needle) return {}
    return {
      draggable: true,
      "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight",
      onDragStart: (e: DragEvent) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)) },
      onDragOver: (e: DragEvent<HTMLLIElement>) => {
        if (dragId === null) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        setDrop(e.clientX < r.left + r.width / 2 ? i : i + 1)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (dragId !== null && drop !== null) moveTo(dragId, drop > ids.indexOf(dragId) ? drop - 1 : drop)
        setDragId(null); setDrop(null)
      },
      onDragEnd: () => { setDragId(null); setDrop(null) },
      onKeyDown: (e: KeyboardEvent) => {
        if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
        e.preventDefault()
        const to = i + (e.key === "ArrowLeft" ? -1 : 1)
        if (to >= 0 && to < ids.length) moveTo(id, to)
      },
    }
  }

  return (
    <section aria-labelledby="projects">
      <div {...sx(hs.head)}>
        <h2 id="projects" {...sx(hs.title)}>Projects</h2>
        {canCreateProjects() && <a href="/projects/new" data-button>Make a new project</a>}
      </div>
      {all.length > FILTER_AT && (
        <p {...sx(hs.filter)}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects…" aria-label="Filter projects" /></p>
      )}
      {shown.length ? (
        <ul {...sx(hs.cards)}>
          {shown.map((p) => {
            const i = ids.indexOf(p.id)
            return (
              <li key={p.id} {...dragProps(p.id)}
                {...sx(hs.card, dense && hs.cardDense, dragId === p.id && hs.dragging, dragId !== null && drop === i && hs.dropBefore,
                  dragId !== null && i === ids.length - 1 && drop === i + 1 && hs.dropAfter)}>
                <HomeCard p={p} review={reviewBy.get(p.id) ?? 0} dense={dense} />
              </li>
            )
          })}
        </ul>
      ) : <p {...sx(hs.quiet)}>No projects match “{q.trim()}”.</p>}
      <p {...sx(hs.links)}><a href="/projects/archived">Archived projects</a>{!isClient(me()) && <a href="/templates">Templates</a>}</p>
    </section>
  )
})

/** The column a card sits in (a step's card's column), if it's on a board. */
const columnOf = (r: Recording) => {
  const card = r.type === "step" ? db.recordings.get(String(r.parent_id)) : r
  return card?.type === "card" ? db.recordings.get(String(card.parent_id)) : undefined
}
/** Waiting in Review, parked in Not now, or finished: not yours to work on today. */
const PARKED = new Set(["review", "not_now", "done"])

type Upcoming = Recording & { project_name: string; on_date?: string }

/** Mine (open goals, cards and steps assigned to me, soonest due first, so late leads; not what's in Review, which is
 * Waiting for you, or parked in Not now), and my events in the next two weeks. */
const myUpcoming = (limit = 5) => {
  const m = me()
  const live = (r: Recording) => r.status === "active" && db.projects.get(String(r.project_id))?.status === "active"
  const mine = (r: Recording) => ((r.data.assignee_ids ?? []) as number[]).includes(m.id) && !r.data.completed_at && !PARKED.has(columnOf(r)?.data.kind)
  const named = (r: Recording, extra: Partial<Upcoming> = {}): Upcoming => ({ ...r, project_name: db.projects.get(String(r.project_id))?.name ?? "", ...extra })
  const allAssigned = recordings((r) => ["todo", "card", "step"].includes(r.type) && live(r) && mine(r))
    .sort((a, b) => (a.data.due_on ? (b.data.due_on ? a.data.due_on.localeCompare(b.data.due_on) : -1) : b.data.due_on ? 1 : 0) || a.id - b.id)
  const t = today()
  const until = addDays(t, 14)
  const dates = recordings((r) => live(r) && r.type === "event" && (((r.data.participant_ids ?? []) as number[]).includes(m.id) || r.creator_id === m.id)
    && r.data.starts_at >= t && r.data.starts_at.slice(0, 10) <= until)
    .map((r) => named(r, { on_date: r.data.starts_at ?? r.data.due_on }))
    .sort((a, b) => a.on_date!.localeCompare(b.on_date!))
    .slice(0, limit)
  return {
    assigned: allAssigned.slice(0, limit).map((r) => named(r)), dates, assignedTotal: allAssigned.length,
    dueToday: allAssigned.filter((r) => r.data.due_on === t).length, late: allAssigned.filter((r) => r.data.due_on && r.data.due_on < t).length,
  }
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

/** Waiting for you: the review queue, at the top of Home, where a sweep starts. Agents never ping, so this is their inbox. */
const WaitingForYou = observer(({ cards }: { cards: Recording[] }) => {
  const m = me()
  return (
    <section id="waiting" aria-labelledby="waiting-title" {...sx(hs.panel)}>
      <h2 id="waiting-title" {...sx(hs.panelTitle)}>Waiting for you{cards.length > 0 && <span {...sx(hs.count)}> ({cards.length})</span>}</h2>
      {cards.length ? (
        <ul {...sx(hs.list)}>{cards.slice(0, 10).map((r) => {
          const rv = r.data.review as { at?: string; by?: number; via?: string | null } | undefined
          const who = rv?.via ? `via ${rv.via}` : rv?.by && rv.by !== m.id ? `from ${db.people.get(String(rv.by))?.name ?? "someone"}` : ""
          return (
            <li key={r.id} {...sx(hs.item)}>
              <span><a href={`${urlFor(r)}?from=home`} {...sx(hs.itemTitle)}>{r.title}</a>
                <small {...sx(hs.itemMeta)}>{[db.projects.get(String(r.project_id))?.name, who].filter(Boolean).join(" · ")}</small></span>
              <small>{ago(rv?.at ?? r.updated_at, m.time_zone)}</small>
            </li>
          )
        })}</ul>
      ) : <p {...sx(hs.quiet)}>Nothing to review. Back to Mine.</p>}
      {cards.length > 10 && <p {...sx(hs.links)}>And {cards.length - 10} more. Open them from each project's Board.</p>}
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
  // Home answers "where do I need to be today?": the day in a line, what's waiting for your verdict, every project, then
  // your own work and what's coming up.
  page("/", () => {
    const all = visibleProjects()
    const waiting = waitingForMe()
    const reviewBy = new Map<number, number>()
    for (const r of waiting) reviewBy.set(r.project_id, (reviewBy.get(r.project_id) ?? 0) + 1)
    const { assigned, dates, assignedTotal, dueToday, late } = myUpcoming()
    const t = today()
    const day = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    return (
      <Page title="Home">
        <h1 {...sx(kit.srOnly)}>Home</h1>
        <p {...sx(hs.today)}>
          <span {...sx(hs.todayDate)}>{day}</span>
          {waiting.length > 0 && <>· <a href="#waiting" {...sx(hs.todayLink)}>{waiting.length} to review</a></>}
          {dueToday > 0 && <>· <a href="#mine" {...sx(hs.todayLink)}>{dueToday} due today</a></>}
          {late > 0 && <>· <a href="#mine" {...sx(hs.todayLink, hs.todayLate)}>{late} late</a></>}
          {!waiting.length && !dueToday && !late && <>· Nothing due today.</>}
        </p>
        <WaitingForYou cards={waiting} />
        {all.length === 0 ? (
          <div {...sx(kit.empty, hs.foot)}>
            <p>Welcome. Make your first project, then invite the people working on it.</p>
            {canCreateProjects() && <p><a href="/projects/new" data-button>Make a new project</a></p>}
            <TeamLink />
          </div>
        ) : <Projects all={all} reviewBy={reviewBy} />}
        <div {...sx(hs.lists)}>
          <section id="mine" aria-labelledby="mine-title" {...sx(hs.panel)}>
            <h2 id="mine-title" {...sx(hs.panelTitle)}>Mine</h2>
            {assigned.length ? (
              <ul {...sx(hs.list)}>{assigned.map((r) => {
                const isLate = r.data.due_on && r.data.due_on < t
                return (
                  <li key={r.id} {...sx(hs.item, hs.dated)}>
                    <span {...sx(hs.when, isLate && hs.whenLate)} title={isLate ? `Was due ${fmtDate(r.data.due_on)}` : undefined}>{r.data.due_on ? fmtDate(r.data.due_on) : ""}</span>
                    <span><a href={`/r/${r.id}/go`} {...sx(hs.itemTitle)}>{r.title}</a><small {...sx(hs.itemMeta)}>{r.project_name}</small></span>
                  </li>
                )
              })}</ul>
            ) : <p {...sx(hs.quiet)}>Nothing's yours right now. Enjoy it.</p>}
            {assignedTotal > assigned.length && <p {...sx(hs.links)}><a href="/my/assignments">See all {assignedTotal}</a></p>}
          </section>
          <section aria-labelledby="coming" {...sx(hs.panel)}>
            <h2 id="coming" {...sx(hs.panelTitle)}>Coming up</h2>
            {dates.length
              ? <ul {...sx(hs.list)}>{dates.map((r) => (
                  <li key={r.id} {...sx(hs.item, hs.dated)}>
                    <span {...sx(hs.when)}>{fmtDate(r.on_date)}</span>
                    <span><a href={`/r/${r.id}/go`} {...sx(hs.itemTitle)}>{r.title}</a><small {...sx(hs.itemMeta)}>{r.project_name}</small></span>
                  </li>
                ))}</ul>
              : <p {...sx(hs.quiet)}>Nothing on your calendar in the next two weeks.</p>}
            <p {...sx(hs.links)}><a href="/my/calendar">Your calendar</a></p>
          </section>
        </div>
        <p {...sx(hs.links, hs.foot)}><a href="/timeline">Timeline</a><a href="/activity">See all activity</a>{canInvite() && <a href="/people/invite">Invite people</a>}</p>
      </Page>
    )
  }),

  // Every project is on Home now.
  page("/projects", () => <Navigate to="/" replace />),

  page("/projects/archived", () => {
    const [query] = useSearchParams()
    const q = (query.get("q") ?? "").trim().toLowerCase()
    const ps = visibleProjects({ status: "archived" }).filter((p) => !q || p.name.toLowerCase().includes(q))
    return (
      <Page title="Archived projects" crumbs={[["Home", "/"]]}>
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
          ? <ul>{ts.map((t) => <li key={t.id} {...sx(hs.trow)}><span><a href={`/projects/${t.id}`}>{t.name}</a>{t.description && <>: {t.description}</>}
              {t.id === account().settings.agent_template_id && <><br /><small>Agents start new projects from this template.</small></>}</span>
              <a href={`/templates/${t.id}/use`} data-button {...sx(hs.tuse)}>Use this template</a></li>)}</ul>
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
