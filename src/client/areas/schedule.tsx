// Calendar: the calendar, new event, event, edit, calendar feed pages. Posts and the .ics feeds: src/areas/schedule.ts.
// Events keep wall-clock times in data.starts_at / ends_at: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM",
// plus data.tz, the time zone of whoever saved it. Plain strings, so they sort and compare to today().
import * as stylex from "@stylexjs/stylex"
import { Fragment, useContext, useState } from "react"
import { observer } from "mobx-react-lite"
import { useParams, useSearchParams } from "react-router"
import { InWindow } from "../ui/window-router.tsx"
import { me, findProject, findRecording, projectPeople, personById, peopleByIds, recordings, useApi, useVisit, NoAccess } from "../data.ts"
import { isClient, titleOf, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { addDays, fmtDate, today } from "../../shared/format.ts"
import { ByLine, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, PeopleCheckboxes, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, radius, space, text } from "../ui/tokens.stylex.ts"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"

// ---------- dates ----------
const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY)
const addMonths = (d: string, n: number) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1 + n, day))
  return dt.getUTCDate() === day ? dt.toISOString().slice(0, 10) : null // Jan 31 doesn't happen in February
}

const REPEATS = { never: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" } as const
type Repeat = keyof typeof REPEATS

/** Dates an event happens on between `from` and `to` (inclusive). */
const occurrences = (e: Recording, from: string, to: string) => {
  const start = String(e.data.starts_at ?? "").slice(0, 10)
  if (!start) return []
  const repeat = (e.data.repeat ?? "never") as Repeat
  if (repeat === "never") return start >= from && start <= to ? [start] : []
  const step = (k: number) =>
    repeat === "daily" ? addDays(start, k) : repeat === "weekly" ? addDays(start, 7 * k) : addMonths(start, repeat === "monthly" ? k : 12 * k)
  // Jump close to `from` instead of walking from the first occurrence.
  const gap = Math.max(0, daysBetween(start, from))
  const k0 = repeat === "daily" ? gap : repeat === "weekly" ? Math.floor(gap / 7) : repeat === "monthly" ? Math.max(0, Math.floor(gap / 31) - 1) : Math.max(0, Math.floor(gap / 366) - 1)
  const out: string[] = []
  for (let k = k0; k < k0 + 800; k++) {
    const d = step(k)
    if (!d) continue
    if (d > to) break
    if (d >= from) out.push(d)
  }
  return out
}

const fmtClock = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`
}

/** "All day", "2pm – 3:30pm", "Oct 4 → Oct 6". Dates are the wall-clock day (a bare "…T14:00" would parse as browser-local time). */
const fmtWhen = (e: Recording) => {
  const s = String(e.data.starts_at ?? "")
  const en = String(e.data.ends_at ?? s)
  const multiDay = en.slice(0, 10) !== s.slice(0, 10)
  const day = (x: string) => fmtDate(x.slice(0, 10))
  if (e.data.all_day || s.length === 10)
    return multiDay ? `${day(s)} → ${day(en)}, all day` : `${day(s)}, all day`
  return multiDay ? `${day(s)} ${fmtClock(s)} → ${day(en)} ${fmtClock(en)}` : `${day(s)}, ${fmtClock(s)} – ${fmtClock(en)}`
}

// ---------- what's on a schedule ----------
type Item = { date: string; title: string; href: string; kind: "event" | "due"; time: string; r: Recording }
type Rows = { events: ReadonlyArray<Recording>; dues: ReadonlyArray<Recording> }

const projectRows = (projectId: number): Rows => ({
  events: recordings((r) => r.project_id === projectId && r.type === "event" && r.status === "active"),
  dues: recordings((r) => r.project_id === projectId && (r.type === "todo" || r.type === "card") && r.status === "active" && r.data.due_on != null && r.data.completed_at == null),
})

// ponytail: expands every event in JS per render; fine for hundreds of events, add a date index when a project has thousands
const itemsBetween = (rows: Rows, from: string, to: string): Item[] => [
  ...rows.events.flatMap((e) => occurrences(e, from, to).map((date) => ({
    date, title: e.title, href: urlFor(e), kind: "event" as const, r: e,
    time: e.data.all_day || String(e.data.starts_at).length === 10 ? "" : fmtClock(String(e.data.starts_at)),
  }))),
  ...rows.dues.filter((t) => t.data.due_on >= from && t.data.due_on <= to)
    .map((t) => ({ date: String(t.data.due_on), title: titleOf(t), href: urlFor(t), kind: "due" as const, time: "", r: t })),
].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))

// The month as a ruled grid (still a real table), today on an orange disc, items as small pills in their day.
const ss = stylex.create({
  cal: { tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0, marginBottom: space.s3, borderRadius: radius.lg, overflow: "hidden",
    borderWidth: 1, borderStyle: "solid", borderColor: color.line },
  caption: { fontSize: text.lg, fontWeight: 700, letterSpacing: "-0.02em", paddingBottom: space.s3 },
  th: { paddingBlock: space.s2, paddingInline: space.s2, backgroundColor: color.tile, borderBottomWidth: 1, borderBottomColor: color.line, textAlign: "left" },
  cell: { height: 104, paddingBlock: 6, paddingInline: 6, verticalAlign: "top", borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line,
    borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: color.line },
  first: { borderLeftWidth: 0, paddingLeft: 6 },
  blank: { backgroundColor: color.tile },
  num: { display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 24, height: 24, paddingInline: 4, borderRadius: radius.pill,
    fontSize: text.xs, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: color.muted },
  today: { backgroundColor: color.accent, color: color.onAccent, fontWeight: 700 },
  items: { margin: 0, marginTop: 4, display: "grid", gap: 3 },
  item: { borderTopWidth: 0, padding: 0 },
  pill: { display: "block", paddingBlock: 3, paddingInline: 7, borderRadius: 6, backgroundColor: color.tile, fontSize: text.xs, fontWeight: 500, lineHeight: 1.3,
    textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ":hover": { textDecoration: "underline" } },
  due: { backgroundColor: color.accentSoft },
  nav: { display: "flex", flexWrap: "wrap", gap: space.s2, marginBottom: space.s6, maxWidth: "none" },
  scroll: { overflowX: "auto", marginBottom: 0 },
  dayHead: { fontSize: text.sm, fontWeight: 600, color: color.muted, marginTop: space.s5, marginBottom: 0 },
  row: { display: "grid", gridTemplateColumns: "5.5rem 1fr", columnGap: space.s3, alignItems: "baseline" },
  time: { fontSize: text.sm, color: color.muted, fontVariantNumeric: "tabular-nums" },
})

const ItemList = ({ items }: { items: ReadonlyArray<Item> }) => {
  const days = new Map<string, Item[]>()
  for (const i of items) days.set(i.date, [...(days.get(i.date) ?? []), i])
  return (
    <>
      {[...days].map(([d, is]) => (
        <Fragment key={d}>
          <h3 {...sx(ss.dayHead)}>{new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</h3>
          <ul>{is.map((i) => (
            <li key={`${i.kind}-${i.r.id}`} {...sx(ss.row)}>
              <span {...sx(ss.time)}>{i.time || (i.kind === "due" ? "Due" : "All day")}</span>
              <span><a href={i.href}>{i.title}</a>{i.r.data.repeat && i.r.data.repeat !== "never" && <> <small>({REPEATS[i.r.data.repeat as Repeat]?.toLowerCase()})</small></>}</span>
            </li>
          ))}</ul>
        </Fragment>
      ))}
    </>
  )
}

const MonthCalendar = ({ month, items, base }: { month: string; items: ReadonlyArray<Item>; base: string }) => {
  const first = month + "-01"
  const next = addMonths(first, 1)!
  const prev = addMonths(first, -1)!
  const lead = new Date(first + "T12:00:00Z").getUTCDay()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysBetween(first, next) }, (_, i) => addDays(first, i))]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
  const now = today()
  const thisMonth = now.slice(0, 8) + "01"
  return (
    <>
      <div {...sx(ss.scroll)}>
        <table {...sx(ss.cal)}>
          <caption {...sx(ss.caption)}>{label(first)}</caption>
          <thead><tr>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => <th key={d} scope="col" {...sx(ss.th, i === 0 && ss.first)}>{d}</th>)}</tr></thead>
          <tbody>{weeks.map((w, wi) => (
            <tr key={wi}>{w.map((d, i) => {
              if (!d) return <td key={i} {...sx(ss.cell, ss.blank, i === 0 && ss.first)} />
              const day = items.filter((it) => it.date === d)
              return (
                <td key={i} {...sx(ss.cell, i === 0 && ss.first)}>
                  <span {...sx(ss.num, d === now && ss.today)}>{Number(d.slice(8))}</span>{d === now && <span {...sx(kit.srOnly)}>(today)</span>}
                  {day.length > 0 && (
                    <ul {...sx(ss.items)}>{day.map((it) => (
                      <li key={`${it.kind}-${it.r.id}`} {...sx(ss.item)}><a href={it.href} title={it.title} {...sx(ss.pill, it.kind === "due" && ss.due)}>{it.kind === "due" ? `Due: ${it.title}` : it.title}</a></li>
                    ))}</ul>
                  )}
                </td>
              )
            })}</tr>
          ))}</tbody>
        </table>
      </div>
      <nav aria-label="Months" {...sx(ss.nav)}>
        {prev >= addMonths(thisMonth, -12)! && <a href={`${base}?month=${prev.slice(0, 7)}`} data-button>← {label(prev)}</a>}
        <a href={base} data-button>This month</a>
        {next <= addMonths(thisMonth, 12)! && <a href={`${base}?month=${next.slice(0, 7)}`} data-button>{label(next)} →</a>}
      </nav>
    </>
  )
}

// ---------- the event form ----------
type EventInput = { title: string; body: string; starts_on: string; start_time: string; ends_on: string; end_time: string; all_day: boolean; repeat: Repeat; participant_ids: number[]; visible_to_clients?: boolean }

const fromEvent = (e: Recording): EventInput => {
  const s = String(e.data.starts_at ?? "")
  const en = String(e.data.ends_at ?? s)
  return {
    title: e.title, body: e.body, starts_on: s.slice(0, 10), start_time: s.slice(11, 16), ends_on: en.slice(0, 10), end_time: en.slice(11, 16),
    all_day: !!e.data.all_day || s.length === 10, repeat: (e.data.repeat ?? "never") as Repeat, participant_ids: e.data.participant_ids ?? [],
    visible_to_clients: e.visible_to_clients,
  }
}

const EventForm = observer(({ p, e, action, cancel }: { p: Project; e: EventInput; action: string; cancel: string }) => {
  const people = projectPeople(p)
  return (
    <Form action={action}>
      <TextField label="Name this event" name="title" value={e.title} required />
      <p><label>Starts <input type="date" name="starts_on" defaultValue={e.starts_on} required /></label>{" "}
        <label>at <input type="time" name="start_time" defaultValue={e.start_time} /></label></p>
      <p><label>Ends <input type="date" name="ends_on" defaultValue={e.ends_on} /></label>{" "}
        <label>at <input type="time" name="end_time" defaultValue={e.end_time} /></label></p>
      <p><label><input type="checkbox" name="all_day" defaultChecked={e.all_day} /> All day</label> <small>(leave the start time blank for an all-day event too)</small></p>
      <p><label>Repeat <select name="repeat" defaultValue={e.repeat}>{Object.entries(REPEATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></p>
      <TextArea label="Notes" name="body" value={e.body} placeholder="Add notes, an agenda, a link…" />
      <p>Who's involved? They'll be notified.</p>
      <PeopleCheckboxes name="participant_ids" people={people} checked={e.participant_ids} />
      <ClientSwitch project={p} people={people} current={e.visible_to_clients} />
      <p><button>{action.endsWith("/edit") ? "Save changes" : "Post this event"}</button> <a href={cancel}>Cancel</a></p>
    </Form>
  )
})

// ---------- calendar feeds ----------
const FeedHowTo = () => (
  <>
    <h2>How to add it</h2>
    <dl>
      <dt>Google Calendar</dt><dd>Other calendars → “+” → From URL. Paste the link.</dd>
      <dt>Apple Calendar</dt><dd>File → New Calendar Subscription. Paste the link.</dd>
      <dt>Outlook</dt><dd>Add calendar → Subscribe from web. Paste the link.</dd>
    </dl>
  </>
)

/** The feed URL (signed by the server) with its Copy button. */
const FeedUrl = ({ api }: { api: string }) => {
  const { data, error } = useApi<{ path: string }>(api)
  const [copied, setCopied] = useState(false)
  const url = data ? location.origin + data.path : ""
  if (error) return <p role="alert">{error}</p>
  return (
    <p><label>Feed URL<br /><input readOnly size={80} value={url} onClick={(e) => e.currentTarget.select()} /></label>{" "}
      <button type="button" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button></p>
  )
}

// ---------- pages ----------
export const routes = [
  page("/projects/:id/calendar", () => {
    const p = findProject(useParams().id)
    const [q] = useSearchParams()
    const rows = projectRows(p.id)
    const base = toolUrl(p, "schedule")
    useVisit(base, `${p.name}: Calendar`, p.id)
    const inWindow = useContext(InWindow)
    if (q.get("past")) {
      const past = itemsBetween({ events: rows.events, dues: [] }, addDays(today(), -365), addDays(today(), -1)).reverse().slice(0, 60)
      return (
        <Page title="Past events" crumbs={projectCrumbs(p, "schedule")}>
          <h1>Past events</h1>
          {past.length ? <ItemList items={past} /> : <p>No past events in the last year.</p>}
          <p><a href={base}>Back to the calendar</a></p>
        </Page>
      )
    }
    const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : today().slice(0, 7)
    const monthItems = itemsBetween(rows, month + "-01", addDays(addMonths(month + "-01", 1)!, -1))
    const upcoming = itemsBetween(rows, today(), addDays(today(), 60)).slice(0, 30)
    return (
      <Page title="Calendar" crumbs={projectCrumbs(p)}>
        <PageHead title="Calendar" actions={[
          p.status === "active" && <a key="new" href={`/projects/${p.id}/events/new`} data-button>New event</a>,
          <a key="feed" href={`/projects/${p.id}/calendar/feed`} data-button>Add to your calendar app</a>,
        ]} />
        {!rows.events.length && !rows.dues.length
          ? <p {...sx(kit.empty)}>Add events and big dates. Tasks and cards with due dates show up here on their own.</p>
          : (
            // In a project window, what's coming up comes first; the month fills a window, so it follows.
            inWindow ? (
              <>
                <h2>Coming up</h2>
                {upcoming.length ? <ItemList items={upcoming.slice(0, 8)} /> : <p>Nothing in the next 60 days.</p>}
                <MonthCalendar month={month} items={monthItems} base={base} />
              </>
            ) : (
              <>
                <MonthCalendar month={month} items={monthItems} base={base} />
                <h2>Coming up</h2>
                {upcoming.length ? <ItemList items={upcoming} /> : <p>Nothing in the next 60 days.</p>}
              </>
            )
          )}
        <p {...sx(kit.links)}><a href={`${base}?past=1`}>See past events</a></p>
      </Page>
    )
  }),

  page("/projects/:id/events/new", () => {
    const p = findProject(useParams().id)
    const [q] = useSearchParams()
    const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("on") ?? "") ? q.get("on")! : today()
    const blank: EventInput = { title: "", body: "", starts_on: day, start_time: "", ends_on: "", end_time: "", all_day: false, repeat: "never", participant_ids: [] }
    return (
      <Page title="New event" crumbs={projectCrumbs(p, "schedule")}>
        <h1>New event</h1><EventForm p={p} e={blank} action={`/projects/${p.id}/events`} cancel={toolUrl(p, "schedule")} />
      </Page>
    )
  }),

  page("/projects/:id/events/:eid", () => {
    const { r, project } = findRecording(useParams().eid, "event")
    const m = me()
    const involved = peopleByIds(r.data.participant_ids ?? [])
    useVisit(urlFor(r), r.title, project.id)
    return (
      <Page title={r.title} crumbs={projectCrumbs(project, "schedule")}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(project).some(isClient)} />
        <article>
          <h1>{r.title}</h1>
          <p><b>{fmtWhen(r)}</b>{r.data.tz && !r.data.all_day && String(r.data.starts_at).length > 10 && <> <small>({r.data.tz} time)</small></>}</p>
          {r.data.repeat && r.data.repeat !== "never" && <p>Repeats: {REPEATS[r.data.repeat as Repeat]}</p>}
          <p>Who's involved: {involved.length ? involved.map((x, i) => <span key={x.id}>{i ? ", " : ""}<a href={`/people/${x.id}`}>{x.name}</a></span>) : "nobody in particular"}</p>
          {r.body && <Fmt text={r.body} />}
          <ByLine who={personById(r.creator_id)} when={r.created_at} tz={m.time_zone} />
          {r.status === "active" && (r.creator_id === m.id || !isClient(m)) && <p><a href={`/projects/${project.id}/events/${r.id}/edit`}>Edit</a></p>}
        </article>
        <ItemFooter r={r} project={project} />
      </Page>
    )
  }),

  page("/projects/:id/events/:eid/edit", () => {
    const { r, project } = findRecording(useParams().eid, "event")
    if (r.creator_id !== me().id && isClient(me())) throw new NoAccess()
    return (
      <Page title="Edit event" crumbs={projectCrumbs(project, "schedule")}>
        <h1>Edit event</h1><EventForm p={project} e={fromEvent(r)} action={`/projects/${project.id}/events/${r.id}/edit`} cancel={urlFor(r)} />
      </Page>
    )
  }),

  page("/projects/:id/calendar/feed", () => {
    const p = findProject(useParams().id)
    return (
      <Page title="Calendar feed" crumbs={projectCrumbs(p, "schedule")}>
        <h1>Add {p.name}'s calendar to your calendar app</h1>
        <p>Follow this calendar in Google Calendar, Apple Calendar or Outlook. Changes here show up there, most often within a few hours. You can't make changes from there.</p>
        <FeedUrl api={`/projects/${p.id}/calendar/feed`} />
        <p><small>This link is just for you. Anyone with it can see this calendar, so keep it to yourself.</small></p>
        <FeedHowTo />
        <p><a href="/my/calendar/feed">Follow just your own calendar instead</a> · <a href={`/api/projects/${p.id}/calendar.ics`}>Download a one-time .ics file</a></p>
      </Page>
    )
  }),

  page("/my/calendar/feed", () => (
    <Page title="Your calendar feed" crumbs={[["Me", "/my"], ["My Calendar", "/my/calendar"]]}>
      <h1>Add your calendar to your calendar app</h1>
      <p>Events you're involved in and everything assigned to you with a due date, across every project.</p>
      <FeedUrl api="/my/calendar/feed" />
      <p><small>This link is just for you. Anyone with it can see your calendar, so keep it to yourself.</small></p>
      <FeedHowTo />
      <p><a href="/my/calendar">Back to your calendar</a></p>
    </Page>
  )),
]
