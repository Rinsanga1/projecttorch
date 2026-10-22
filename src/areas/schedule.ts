// Calendar: the calendar, new event, event, edit, calendar feeds (.ics).
// Events keep wall-clock times in data.starts_at / ends_at: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM",
// plus data.tz, the time zone of whoever saved it. Plain strings, so they sort and compare to today().
import * as stylex from "@stylexjs/stylex"
import { createHmac, timingSafeEqual } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { html, raw, fmt, fmtDate, today, type Raw } from "../lib/html.ts"
import { get, post, pubGet, redirect, render, str, ids, bool, errors, isAdmin, isClient, NoAccess, NotFound, type Ctx, type Person, type Account } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor, titleOf,
  clientSwitch, textField, textArea, byLine, clientFilter, trackVisit, personById, peopleCheckboxes, peopleByIds, personLink,
  notify, visibleProjects,
  type Project, type Recording,
} from "../lib/core.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import { seedCtx, type Seed } from "../seed.ts"
import { kit, pageHead, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// ---------- dates ----------
const DAY = 86_400_000
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY)
const addMonths = (d: string, n: number) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1 + n, day))
  return dt.getUTCDate() === day ? dt.toISOString().slice(0, 10) : null // Jan 31 doesn't happen in February
}

const REPEATS = { never: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" } as const
type Repeat = keyof typeof REPEATS

/** Dates an event happens on between `from` and `to` (inclusive). */
export const occurrences = (e: Recording, from: string, to: string) => {
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

/** "All day", "2pm – 3:30pm", "Oct 4 → Oct 6". */
export const fmtWhen = (e: Recording) => {
  const s = String(e.data.starts_at ?? "")
  const en = String(e.data.ends_at ?? s)
  const multiDay = en.slice(0, 10) !== s.slice(0, 10)
  if (e.data.all_day || s.length === 10)
    return multiDay ? `${fmtDate(s)} → ${fmtDate(en)}, all day` : `${fmtDate(s)}, all day`
  return multiDay ? `${fmtDate(s)} ${fmtClock(s)} → ${fmtDate(en)} ${fmtClock(en)}` : `${fmtDate(s)}, ${fmtClock(s)} – ${fmtClock(en)}`
}

// ---------- what's on a schedule ----------
type Item = { date: string; title: string; href: string; kind: "event" | "due"; time: string; r: Recording }

const projectRows = (me: Person, projectId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const events = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type = 'event' and status = 'active' ${clientFilter(sql, me, "r")}`
    const dues = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type in ('todo','card') and status = 'active'
      and data->>'due_on' is not null and data->>'completed_at' is null ${clientFilter(sql, me, "r")}`
    return { events, dues }
  })

// ponytail: expands every event in JS per request; fine for hundreds of events, add a date index when a project has thousands
const itemsBetween = (rows: { events: ReadonlyArray<Recording>; dues: ReadonlyArray<Recording> }, from: string, to: string): Item[] => [
  ...rows.events.flatMap((e) => occurrences(e, from, to).map((date) => ({
    date, title: e.title, href: urlFor(e), kind: "event" as const, r: e,
    time: e.data.all_day || String(e.data.starts_at).length === 10 ? "" : fmtClock(String(e.data.starts_at)),
  }))),
  ...rows.dues.filter((t) => t.data.due_on >= from && t.data.due_on <= to)
    .map((t) => ({ date: String(t.data.due_on), title: `Due: ${titleOf(t)}`, href: urlFor(t), kind: "due" as const, time: "", r: t })),
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

const itemList = (items: ReadonlyArray<Item>) => {
  const days = new Map<string, Item[]>()
  for (const i of items) days.set(i.date, [...(days.get(i.date) ?? []), i])
  return html`${[...days].map(([d, is]) => html`<h3${sx(ss.dayHead)}>${new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</h3>
<ul>${is.map((i) => html`<li${sx(ss.row)}><span${sx(ss.time)}>${i.time || (i.kind === "due" ? "Due" : "All day")}</span><span><a href="${i.href}">${i.title}</a>${i.r.data.repeat && i.r.data.repeat !== "never" ? html` <small>(${REPEATS[i.r.data.repeat as Repeat]?.toLowerCase()})</small>` : ""}</span></li>`)}</ul>`)}`
}

const monthCalendar = (month: string, items: ReadonlyArray<Item>, base: string) => {
  const first = month + "-01"
  const next = addMonths(first, 1)!
  const prev = addMonths(first, -1)!
  const lead = new Date(first + "T12:00:00Z").getUTCDay()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysBetween(first, next) }, (_, i) => addDays(first, i))]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7))
  const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
  return html`
<div${sx(ss.scroll)}>
<table${sx(ss.cal)}>
  <caption${sx(ss.caption)}>${label(first)}</caption>
  <thead><tr>${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => html`<th scope="col"${sx(ss.th, i === 0 && ss.first)}>${d}</th>`)}</tr></thead>
  <tbody>${weeks.map((w) => html`<tr>${w.map((d, i) => {
    if (!d) return html`<td${sx(ss.cell, ss.blank, i === 0 && ss.first)}></td>`
    const day = items.filter((it) => it.date === d)
    const n = Number(d.slice(8))
    return html`<td${sx(ss.cell, i === 0 && ss.first)}><span${sx(ss.num, d === today() && ss.today)}>${n}</span>${d === today() ? html`<span${sx(kit.srOnly)}>(today)</span>` : ""}${day.length ? html`<ul${sx(ss.items)}>${day.map((it) => html`<li${sx(ss.item)}><a href="${it.href}" title="${it.title}"${sx(ss.pill, it.kind === "due" && ss.due)}>${it.title}</a></li>`)}</ul>` : ""}</td>`
  })}</tr>`)}</tbody>
</table>
</div>
<nav aria-label="Months"${sx(ss.nav)}>${prev >= addMonths(today().slice(0, 8) + "01", -12)! ? html`<a href="${base}?month=${prev.slice(0, 7)}" data-button>← ${label(prev)}</a>` : ""}<a href="${base}" data-button>This month</a>${next <= addMonths(today().slice(0, 8) + "01", 12)! ? html`<a href="${base}?month=${next.slice(0, 7)}" data-button>${label(next)} →</a>` : ""}</nav>`
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

const readEvent = (fd: FormData): EventInput => ({
  title: str(fd, "title"), body: str(fd, "body"),
  starts_on: str(fd, "starts_on"), start_time: str(fd, "start_time"), ends_on: str(fd, "ends_on"), end_time: str(fd, "end_time"),
  all_day: bool(fd, "all_day") || !str(fd, "start_time"),
  repeat: (str(fd, "repeat") in REPEATS ? str(fd, "repeat") : "never") as Repeat,
  participant_ids: ids(fd, "participant_ids"), visible_to_clients: bool(fd, "visible_to_clients"),
})

/** Validate and turn form input into event data. */
const eventData = (e: EventInput, tz: string) => {
  const errs: string[] = []
  if (!e.title) errs.push("Your event needs a name.")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.starts_on)) errs.push("Pick the day it starts.")
  const starts_at = e.all_day ? e.starts_on : `${e.starts_on}T${e.start_time}`
  const ends_at = e.all_day ? e.ends_on || e.starts_on : `${e.ends_on || e.starts_on}T${e.end_time || e.start_time}`
  if (!errs.length && ends_at < starts_at) errs.push("The event has to end after it starts.")
  return { errs, data: { starts_at, ends_at, all_day: e.all_day, repeat: e.repeat, participant_ids: e.participant_ids, tz } }
}

const eventForm = (p: Project, people: ReadonlyArray<Person & { company_name?: string | null }>, e: EventInput, action: string, cancel: string, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${action}">
  ${textField("Name this event", "title", e.title, { required: true })}
  <p><label>Starts <input type="date" name="starts_on" value="${e.starts_on}" required></label>
     <label>at <input type="time" name="start_time" value="${e.start_time}"></label></p>
  <p><label>Ends <input type="date" name="ends_on" value="${e.ends_on}"></label>
     <label>at <input type="time" name="end_time" value="${e.end_time}"></label></p>
  <p><label><input type="checkbox" name="all_day"${e.all_day ? raw(" checked") : ""}> All day</label> <small>(leave the start time blank for an all-day event too)</small></p>
  <p><label>Repeat <select name="repeat">${Object.entries(REPEATS).map(([k, v]) => html`<option value="${k}"${e.repeat === k ? raw(" selected") : ""}>${v}</option>`)}</select></label></p>
  ${textArea("Notes", "body", e.body, "Add notes, an agenda, a link…")}
  <p>Who's involved? They'll be notified.</p>
  ${peopleCheckboxes("participant_ids", people, e.participant_ids)}
  ${clientSwitch(p, people, e.visible_to_clients)}
  <p><button>${action.endsWith("/edit") ? "Save changes" : "Post this event"}</button> <a href="${cancel}">Cancel</a></p>
</form>`

// ---------- calendar feeds ----------
// ponytail: dev fallback secret; set FEED_SECRET in production. Changing it changes every feed URL.
const FEED_SECRET = process.env.FEED_SECRET ?? "dev-secret"
const sign = (s: string) => createHmac("sha256", FEED_SECRET).update(s).digest("hex").slice(0, 32)
const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** A project feed is per person, so clients only ever get what they can see. */
export const projectFeedPath = (projectId: number, personId: number) => `/feeds/projects/${projectId}/${personId}-${sign(`project:${projectId}:${personId}`)}.ics`
export const personFeedPath = (personId: number) => `/feeds/people/${personId}/${sign(`person:${personId}`)}.ics`

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")
// ponytail: folds at 74 characters, not octets; long multibyte lines may exceed 75 bytes, which calendar apps tolerate
const fold = (line: string) => {
  const out: string[] = []
  let s = line
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74) }
  out.push(s)
  return out.join("\r\n")
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"
const icsDate = (d: string) => d.replace(/-/g, "")
const icsDateTime = (d: string) => d.slice(0, 16).replace(/[-:]/g, "") + "00"

// ponytail: TZID without a VTIMEZONE block; Google, Apple and Outlook all resolve IANA names
const vevent = (e: Recording, origin: string) => {
  const s = String(e.data.starts_at)
  const en = String(e.data.ends_at ?? s)
  const allDay = e.data.all_day || s.length === 10
  const tz = e.data.tz ?? "UTC"
  return [
    "BEGIN:VEVENT",
    `UID:event-${e.id}@saintsflow`,
    `DTSTAMP:${stamp(new Date(e.updated_at))}`,
    ...(allDay
      ? [`DTSTART;VALUE=DATE:${icsDate(s.slice(0, 10))}`, `DTEND;VALUE=DATE:${icsDate(addDays(en.slice(0, 10), 1))}`]
      : [`DTSTART;TZID=${tz}:${icsDateTime(s)}`, `DTEND;TZID=${tz}:${icsDateTime(en)}`]),
    ...(e.data.repeat && e.data.repeat !== "never" ? [`RRULE:FREQ=${String(e.data.repeat).toUpperCase()}`] : []),
    `SUMMARY:${icsEsc(e.title)}`,
    ...(e.body ? [`DESCRIPTION:${icsEsc(e.body)}`] : []),
    `URL:${origin}${urlFor(e)}`,
    "END:VEVENT",
  ]
}
const vdue = (t: Recording, origin: string) => [
  "BEGIN:VEVENT",
  `UID:due-${t.id}@saintsflow`,
  `DTSTAMP:${stamp(new Date(t.updated_at))}`,
  `DTSTART;VALUE=DATE:${icsDate(t.data.due_on)}`,
  `DTEND;VALUE=DATE:${icsDate(addDays(t.data.due_on, 1))}`,
  `SUMMARY:${icsEsc(`Due: ${titleOf(t)}`)}`,
  `URL:${origin}${urlFor(t)}`,
  "END:VEVENT",
]
const calendar = (name: string, events: ReadonlyArray<Recording>, dues: ReadonlyArray<Recording>, origin: string) =>
  HttpServerResponse.text(
    ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Saintsflow//Calendar//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsEsc(name)}`,
      ...events.flatMap((e) => vevent(e, origin)), ...dues.flatMap((t) => vdue(t, origin)), "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n",
    { contentType: "text/calendar; charset=utf-8" },
  )

const originOf = (c: { req: { headers: Record<string, string | undefined> } }) => `http://${c.req.headers["host"] ?? "localhost:3000"}`

/** Someone's own schedule: events they're in or made, and what's assigned to them, across projects they can see. */
const personRows = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projectIds = (yield* visibleProjects(c)).map((p) => p.id)
    if (!projectIds.length) return { events: [] as Recording[], dues: [] as Recording[] }
    const me = JSON.stringify([c.me.id])
    const events = yield* sql<Recording>`select * from recordings r where project_id in ${sql.in(projectIds)} and type = 'event' and status = 'active'
      and (data->'participant_ids' @> ${me}::jsonb or creator_id = ${c.me.id}) ${clientFilter(sql, c.me, "r")}`
    const dues = yield* sql<Recording>`select * from recordings r where project_id in ${sql.in(projectIds)} and type in ('todo','card') and status = 'active'
      and data->>'due_on' is not null and data->>'completed_at' is null and data->'assignee_ids' @> ${me}::jsonb ${clientFilter(sql, c.me, "r")}`
    return { events, dues }
  })

/** Ctx for a feed request: the feed's owner, looked up without a cookie. */
const feedOwner = (personId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where id = ${personId} and removed_at is null and joined_at is not null`
    if (!p) return yield* new NotFound()
    const [a] = yield* sql<Account>`select * from accounts where id = ${p.account_id}`
    return seedCtx(p, a!)
  })

const feedTokenFrom = (file: string | undefined) => (file ?? "").replace(/\.ics$/, "")

// ---------- routes ----------
export const routes = [
  get("/projects/:id/calendar", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const rows = yield* projectRows(c.me, p.id)
      const base = toolUrl(p, "schedule")
      yield* trackVisit(c, base, `${p.name}: Calendar`, p.id)
      const actions = html`${p.status === "active" ? html`<a href="/projects/${p.id}/events/new" data-button>New event</a>` : ""}<a href="/projects/${p.id}/calendar/feed" data-button>Add to your calendar app</a>`
      if (c.query.get("past")) {
        const past = itemsBetween({ events: rows.events, dues: [] }, addDays(today(), -365), addDays(today(), -1)).reverse().slice(0, 60)
        return yield* render(c, "Past events", html`
<h1>Past events</h1>
${past.length ? itemList(past) : html`<p>No past events in the last year.</p>`}
<p><a href="${base}">Back to the calendar</a></p>`, projectCrumbs(p, "schedule"))
      }
      const month = /^\d{4}-\d{2}$/.test(c.query.get("month") ?? "") ? c.query.get("month")! : today().slice(0, 7)
      const monthItems = itemsBetween(rows, month + "-01", addDays(addMonths(month + "-01", 1)!, -1))
          const upcoming = itemsBetween(rows, today(), addDays(today(), 60)).slice(0, 30)
      return yield* render(c, "Calendar", html`
${pageHead("Calendar", actions)}
${!rows.events.length && !rows.dues.length
  ? html`<p${sx(kit.empty)}>Add events and big dates. Tasks and cards with due dates show up here on their own.</p>`
  : html`
${monthCalendar(month, monthItems, base)}
<h2>Coming up</h2>
${upcoming.length ? itemList(upcoming) : html`<p>Nothing in the next 60 days.</p>`}`}
<p${sx(kit.links)}><a href="${base}?past=1">See past events</a></p>`, projectCrumbs(p))
    })),

  get("/projects/:id/events/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const people = yield* projectPeople(p)
      const day = /^\d{4}-\d{2}-\d{2}$/.test(c.query.get("on") ?? "") ? c.query.get("on")! : today()
      const blank: EventInput = { title: "", body: "", starts_on: day, start_time: "", ends_on: "", end_time: "", all_day: false, repeat: "never", participant_ids: [] }
      return yield* render(c, "New event", html`<h1>New event</h1>${eventForm(p, people, blank, `/projects/${p.id}/events`, toolUrl(p, "schedule"), [])}`, projectCrumbs(p, "schedule"))
    })),

  post("/projects/:id/events", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const people = yield* projectPeople(p)
      const input = readEvent(yield* c.form)
      input.participant_ids = input.participant_ids.filter((id) => people.some((x) => x.id === id))
      const { errs, data } = eventData(input, c.me.time_zone)
      if (errs.length)
        return yield* render(c, "New event", html`<h1>New event</h1>${eventForm(p, people, input, `/projects/${p.id}/events`, toolUrl(p, "schedule"), errs)}`, projectCrumbs(p, "schedule"), 422)
      const r = yield* createRecording(c, {
        project: p, type: "event", title: input.title, body: input.body, data, visible_to_clients: input.visible_to_clients,
        notifyIds: input.participant_ids, notifyKind: "event", verb: "added an event",
      })
      return redirect(urlFor(r), "Event posted.")
    })),

  get("/projects/:id/events/:eid", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.eid, "event")
      const people = yield* projectPeople(project)
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      const involved = yield* peopleByIds(r.data.participant_ids ?? [])
      yield* trackVisit(c, urlFor(r), r.title, project.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  <h1>${r.title}</h1>
  <p><b>${fmtWhen(r)}</b>${r.data.tz && !r.data.all_day && String(r.data.starts_at).length > 10 ? html` <small>(${r.data.tz} time)</small>` : ""}</p>
  ${r.data.repeat && r.data.repeat !== "never" ? html`<p>Repeats: ${REPEATS[r.data.repeat as Repeat]}</p>` : ""}
  <p>Who's involved: ${involved.length ? involved.map((x, i) => html`${i ? ", " : ""}${personLink(x)}`) : "nobody in particular"}</p>
  ${r.body ? html`<div>${fmt(r.body)}</div>` : ""}
  ${byLine(author, r.created_at, c.me.time_zone)}
  ${r.status === "active" && (r.creator_id === c.me.id || !isClient(c.me)) ? html`<p><a href="/projects/${project.id}/events/${r.id}/edit">Edit</a></p>` : ""}
</article>
${yield* itemFooter(c, r, project)}`, projectCrumbs(project, "schedule"))
    })),

  get("/projects/:id/events/:eid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.eid, "event")
      if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      return yield* render(c, "Edit event", html`<h1>Edit event</h1>${eventForm(project, people, fromEvent(r), `/projects/${project.id}/events/${r.id}/edit`, urlFor(r), [])}`, projectCrumbs(project, "schedule"))
    })),

  post("/projects/:id/events/:eid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.eid, "event")
      if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      const input = readEvent(yield* c.form)
      input.participant_ids = input.participant_ids.filter((id) => people.some((x) => x.id === id))
      const { errs, data } = eventData(input, c.me.time_zone)
      if (errs.length)
        return yield* render(c, "Edit event", html`<h1>Edit event</h1>${eventForm(project, people, input, `/projects/${project.id}/events/${r.id}/edit`, urlFor(r), errs)}`, projectCrumbs(project, "schedule"), 422)
      const u = yield* updateRecording(c, r, { title: input.title, body: input.body, data, visible_to_clients: people.some(isClient) ? input.visible_to_clients : r.visible_to_clients })
      const added = input.participant_ids.filter((id) => !(r.data.participant_ids ?? []).includes(id))
      if (added.length) yield* notify(c, { personIds: added, recording: u, kind: "event", summary: `${c.me.name} added you to ${u.title}` })
      return redirect(urlFor(u), "Saved.")
    })),

  get("/projects/:id/calendar/feed", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const url = originOf(c) + projectFeedPath(p.id, c.me.id)
      return yield* render(c, "Calendar feed", html`
<h1>Add ${p.name}'s calendar to your calendar app</h1>
<p>Follow this calendar in Google Calendar, Apple Calendar or Outlook. Changes here show up there, most often within a few hours. You can't make changes from there.</p>
<p><label>Feed URL<br><input readonly size="80" value="${url}" onclick="this.select()"></label>
  <button type="button" onclick="navigator.clipboard?.writeText(this.previousElementSibling.querySelector('input').value).then(() => this.textContent = 'Copied')">Copy</button></p>
<p><small>This link is just for you. Anyone with it can see this calendar, so keep it to yourself.</small></p>
${feedHowTo}
<p><a href="/my/calendar/feed">Follow just your own calendar instead</a> · <a href="/projects/${p.id}/calendar.ics">Download a one-time .ics file</a></p>`, projectCrumbs(p, "schedule"))
    })),

  get("/my/calendar/feed", (c) =>
    Effect.gen(function* () {
      const url = originOf(c) + personFeedPath(c.me.id)
      return yield* render(c, "Your calendar feed", html`
<h1>Add your calendar to your calendar app</h1>
<p>Events you're involved in and everything assigned to you with a due date, across every project.</p>
<p><label>Feed URL<br><input readonly size="80" value="${url}" onclick="this.select()"></label>
  <button type="button" onclick="navigator.clipboard?.writeText(this.previousElementSibling.querySelector('input').value).then(() => this.textContent = 'Copied')">Copy</button></p>
<p><small>This link is just for you. Anyone with it can see your calendar, so keep it to yourself.</small></p>
${feedHowTo}
<p><a href="/my/calendar">Back to your calendar</a></p>`, [["Me", "/my"], ["My Calendar", "/my/calendar"]])
    })),

  get("/projects/:id/calendar.ics", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const rows = yield* projectRows(c.me, p.id)
      return calendar(p.name, rows.events, rows.dues, originOf(c))
    })),

  pubGet("/feeds/projects/:id/:file", (c) =>
    Effect.gen(function* () {
      const [pid, token] = feedTokenFrom(c.params.file).split("-")
      const projectId = Number(c.params.id)
      if (!pid || !token || !sameToken(token, sign(`project:${projectId}:${Number(pid)}`))) return yield* new NotFound()
      const ctx = yield* feedOwner(Number(pid))
      const p = yield* findProject(ctx, projectId)
      const rows = yield* projectRows(ctx.me, p.id)
      return calendar(p.name, rows.events, rows.dues, originOf(c))
    })),

  pubGet("/feeds/people/:id/:file", (c) =>
    Effect.gen(function* () {
      const personId = Number(c.params.id)
      if (!sameToken(feedTokenFrom(c.params.file), sign(`person:${personId}`))) return yield* new NotFound()
      const ctx = yield* feedOwner(personId)
      const rows = yield* personRows(ctx)
      return calendar(`${ctx.me.name}'s calendar`, rows.events, rows.dues, originOf(c))
    })),
]

const feedHowTo: Raw = html`
<h2>How to add it</h2>
<dl>
  <dt>Google Calendar</dt><dd>Other calendars → “+” → From URL. Paste the link.</dd>
  <dt>Apple Calendar</dt><dd>File → New Calendar Subscription. Paste the link.</dd>
  <dt>Outlook</dt><dd>Add calendar → Subscribe from web. Paste the link.</dd>
</dl>`

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const { maya, ann, bob, dan } = s.people
    const day = (n: number) => addDays(today(), n)
    const nextWeekday = (dow: number) => day(((dow - new Date().getUTCDay() + 7) % 7) + 7)
    const ev = (p: Project, who: Person, title: string, data: Record<string, any>, participants: number[], body = "", visible = false) =>
      createRecording(s.as(who), { project: p, type: "event", title, body, data: { tz: who.time_zone, repeat: "never", ...data, participant_ids: participants }, visible_to_clients: visible, notifyIds: participants, verb: "added an event" })
    yield* ev(s.projects.website, maya, "Design review", { starts_at: `${nextWeekday(2)}T14:00`, ends_at: `${nextWeekday(2)}T15:00` }, [maya.id, ann.id], "Walk through the homepage and pricing page sketches.")
    const monday = addDays(nextWeekday(1), -7)
    yield* ev(s.projects.website, ann, "Weekly sync", { starts_at: `${monday}T10:00`, ends_at: `${monday}T10:30`, repeat: "weekly" }, [maya.id, ann.id, bob.id])
    yield* ev(s.projects.website, maya, "Kickoff call with Northwind", { starts_at: `${day(-18)}T09:00`, ends_at: `${day(-18)}T10:00` }, [maya.id, dan.id], "", true)
    yield* ev(s.projects.website, maya, "Launch day", { starts_at: day(24), ends_at: day(24), all_day: true }, [maya.id, ann.id, bob.id, dan.id], "Go live. Champagne optional.", true)
    yield* ev(s.projects.marketing, s.people.cara, "Campaign planning offsite", { starts_at: day(10), ends_at: day(11), all_day: true }, [s.people.cara.id, maya.id])
    yield* ev(s.projects.hq, maya, "Company all-hands", { starts_at: `${day(3)}T11:00`, ends_at: `${day(3)}T12:00`, repeat: "monthly" }, [maya.id, ann.id, bob.id, s.people.cara.id])
  })
