// Calendar: event posts and calendar feeds (.ics). The pages are client/areas/schedule.tsx.
// Events keep wall-clock times in data.starts_at / ends_at: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM",
// plus data.tz, the time zone of whoever saved it. Plain strings, so they sort and compare to today().
import { createHmac, timingSafeEqual } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { addDays, today } from "../shared/format.ts"
import { get, post, pubGet, redirect, invalid, json, str, ids, bool, isClient, NoAccess, NotFound, type Ctx, type Person, type Account } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, urlFor, titleOf, clientFilter, notify, visibleProjects,
  type Project, type Recording,
} from "../lib/core.ts"
import { seedCtx, type Seed } from "../seed.ts"

// ---------- dates ----------

const REPEATS = { never: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" } as const
type Repeat = keyof typeof REPEATS

const projectRows = (me: Person, projectId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const events = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type = 'event' and status = 'active' ${clientFilter(sql, me, "r")}`
    const dues = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type in ('todo','card') and status = 'active'
      and data->>'due_on' is not null and data->>'completed_at' is null ${clientFilter(sql, me, "r")}`
    return { events, dues }
  })

// ---------- the event form ----------
type EventInput = { title: string; body: string; starts_on: string; start_time: string; ends_on: string; end_time: string; all_day: boolean; repeat: Repeat; participant_ids: number[]; visible_to_clients?: boolean }

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

// ---------- calendar feeds ----------
// ponytail: dev fallback secret; set FEED_SECRET in production. Changing it changes every feed URL.
const FEED_SECRET = process.env.FEED_SECRET ?? "dev-secret"
const sign = (s: string) => createHmac("sha256", FEED_SECRET).update(s).digest("hex").slice(0, 32)
const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** A project feed is per person, so clients only ever get what they can see. */
export const projectFeedPath = (projectId: number, personId: number) => `/api/feeds/projects/${projectId}/${personId}-${sign(`project:${projectId}:${personId}`)}.ics`
export const personFeedPath = (personId: number) => `/api/feeds/people/${personId}/${sign(`person:${personId}`)}.ics`

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
  post("/projects/:id/events", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const people = yield* projectPeople(p)
      const fd = yield* c.form
      const input = readEvent(fd)
      input.participant_ids = input.participant_ids.filter((id) => people.some((x) => x.id === id))
      const { errs, data } = eventData(input, c.me.time_zone)
      if (errs.length) return invalid(errs)
      const r = yield* createRecording(c, {
        project: p, type: "event", tool: str(fd, "tool"), title: input.title, body: input.body, data, visible_to_clients: input.visible_to_clients,
        notifyIds: input.participant_ids, notifyKind: "event", verb: "added an event",
      })
      return redirect(urlFor(r), "Event posted.")
    })),

  post("/projects/:id/events/:eid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.eid, "event")
      if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      const input = readEvent(yield* c.form)
      input.participant_ids = input.participant_ids.filter((id) => people.some((x) => x.id === id))
      const { errs, data } = eventData(input, c.me.time_zone)
      if (errs.length) return invalid(errs)
      const u = yield* updateRecording(c, r, { title: input.title, body: input.body, data, visible_to_clients: people.some(isClient) ? input.visible_to_clients : r.visible_to_clients })
      const added = input.participant_ids.filter((id) => !(r.data.participant_ids ?? []).includes(id))
      if (added.length) yield* notify(c, { personIds: added, recording: u, kind: "event", summary: `${c.me.name} added you to ${u.title}` })
      return redirect(urlFor(u), "Saved.")
    })),

  // The feed pages need the signed feed path, and only the server knows the secret.
  get("/projects/:id/calendar/feed", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      return json({ path: projectFeedPath(p.id, c.me.id) })
    })),

  get("/my/calendar/feed", (c) => Effect.succeed(json({ path: personFeedPath(c.me.id) }))),

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
  })
