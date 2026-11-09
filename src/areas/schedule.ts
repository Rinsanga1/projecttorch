// Calendar: events, and calendar feeds (.ics) people subscribe to from their calendar app.
// Pages: client/areas/schedule.tsx. This file is what their forms post to, plus the feeds.
//
//   POST /projects/:id/events                   new event
//   POST /projects/:id/events/:eid/edit
//   GET  /projects/:id/calendar/feed            the signed feed path for this project (for the page)
//   GET  /my/calendar/feed                      the signed feed path for my own calendar
//   GET  /projects/:id/calendar.ics             the project's calendar, signed in
//   GET  /feeds/projects/:id/:file              a project feed, signed URL, no cookie   (public)
//   GET  /feeds/people/:id/:file                someone's own feed, signed URL, no cookie (public)
//
// Events keep wall-clock times in data.starts_at / ends_at: "YYYY-MM-DD" (all day) or "YYYY-MM-DDTHH:MM",
// plus data.tz, the time zone of whoever saved it. Plain strings, so they sort and compare to today().

import { createHmac, timingSafeEqual } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { addDays, today } from "../shared/format.ts"
import { get, post, pubGet, redirect, invalid, json, str, ids, bool, origin, isClient, NoAccess, NotFound, type Ctx, type Person, type Account } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, urlFor, titleOf, clientFilter, notify, visibleProjects,
  type Project, type Recording,
} from "../lib/core.ts"
import { seedCtx, type Seed } from "../seed.ts"

const REPEATS = { never: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" } as const
type Repeat = keyof typeof REPEATS

// ─── The event form ────────────────────────────────────────────────────────

type EventInput = {
  title:              string
  body:               string
  starts_on:          string
  start_time:         string
  ends_on:            string
  end_time:           string
  all_day:            boolean
  repeat:             Repeat
  participant_ids:    number[]
  visible_to_clients: boolean
}

/** Read the form. Participants must be on the project (`people`); anyone else is dropped. */
const readEvent = (fd: FormData, people: ReadonlyArray<Person>): EventInput => {
  const repeat = str(fd, "repeat")
  return {
    title:              str(fd, "title"),
    body:               str(fd, "body"),
    starts_on:          str(fd, "starts_on"),
    start_time:         str(fd, "start_time"),
    ends_on:            str(fd, "ends_on"),
    end_time:           str(fd, "end_time"),
    all_day:            bool(fd, "all_day") || !str(fd, "start_time"),   // no start time means all day
    repeat:             repeat in REPEATS ? repeat as Repeat : "never",
    participant_ids:    ids(fd, "participant_ids").filter((id) => people.some((p) => p.id === id)),
    visible_to_clients: bool(fd, "visible_to_clients"),
  }
}

/** Validate, and turn form input into the event's data. An end left blank means the same day (and time) as the start. */
const eventData = (e: EventInput, tz: string) => {
  const endDay    = e.ends_on || e.starts_on
  const starts_at = e.all_day ? e.starts_on : `${e.starts_on}T${e.start_time}`
  const ends_at   = e.all_day ? endDay      : `${endDay}T${e.end_time || e.start_time}`

  const errors: string[] = []
  if (!e.title)                                errors.push("Your event needs a name.")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.starts_on)) errors.push("Pick the day it starts.")
  if (!errors.length && ends_at < starts_at)    errors.push("The event has to end after it starts.")

  return {
    errors,
    data: { starts_at, ends_at, all_day: e.all_day, repeat: e.repeat, participant_ids: e.participant_ids, tz },
  }
}

// ─── What goes in a calendar ───────────────────────────────────────────────

/** A project's events, and its open to-dos and cards with a due date. Clients only get what they can see. */
const projectRows = (me: Person, projectId: number) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const events = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type = 'event' and status = 'active'
                                       ${clientFilter(sql, me, "r")}`
  const dues   = yield* sql<Recording>`select * from recordings r where project_id = ${projectId} and type in ('todo','card') and status = 'active'
                                       and data->>'due_on' is not null and data->>'completed_at' is null ${clientFilter(sql, me, "r")}`
  return { events, dues }
})

/** Someone's own schedule: events they're in or made, and what's assigned to them, across projects they can see. */
const personRows = (c: Ctx) => Effect.gen(function* () {
  const sql        = yield* SqlClient.SqlClient
  const projectIds = (yield* visibleProjects(c)).map((p) => p.id)
  if (!projectIds.length) return { events: [] as Recording[], dues: [] as Recording[] }

  const me     = JSON.stringify([c.me.id])
  const events = yield* sql<Recording>`select * from recordings r where project_id in ${sql.in(projectIds)} and type = 'event' and status = 'active'
                                       and (data->'participant_ids' @> ${me}::jsonb or creator_id = ${c.me.id}) ${clientFilter(sql, c.me, "r")}`
  const dues   = yield* sql<Recording>`select * from recordings r where project_id in ${sql.in(projectIds)} and type in ('todo','card') and status = 'active'
                                       and data->>'due_on' is not null and data->>'completed_at' is null
                                       and data->'assignee_ids' @> ${me}::jsonb ${clientFilter(sql, c.me, "r")}`
  return { events, dues }
})

// ─── Feeds: signed URLs ────────────────────────────────────────────────────
// A calendar app can't sign in, so a feed URL carries a signature instead. Feeds are per person,
// so clients only ever get what they can see.
// ponytail: dev fallback secret; set FEED_SECRET in production. Changing it changes every feed URL.

const FEED_SECRET = process.env.FEED_SECRET ?? "dev-secret"
const sign        = (s: string) => createHmac("sha256", FEED_SECRET).update(s).digest("hex").slice(0, 32)
const sameToken   = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export const projectFeedPath = (projectId: number, personId: number) => `/api/feeds/projects/${projectId}/${personId}-${sign(`project:${projectId}:${personId}`)}.ics`
export const personFeedPath  = (personId: number)                    => `/api/feeds/people/${personId}/${sign(`person:${personId}`)}.ics`

const feedTokenFrom = (file: string | undefined) => (file ?? "").replace(/\.ics$/, "")

/** Ctx for a feed request: the feed's owner, looked up without a cookie. */
const feedOwner = (personId: number) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [p] = yield* sql<Person>`select * from people where id = ${personId} and removed_at is null and joined_at is not null`
  if (!p) return yield* new NotFound()
  const [a] = yield* sql<Account>`select * from accounts where id = ${p.account_id}`
  return seedCtx(p, a!)
})

// ─── Feeds: the .ics format ────────────────────────────────────────────────

const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n")

// ponytail: folds at 74 characters, not octets; long multibyte lines may exceed 75 bytes, which calendar apps tolerate
const fold = (line: string) => {
  const out: string[] = []
  let s = line
  while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74) }
  out.push(s)
  return out.join("\r\n")
}

const stamp       = (d: Date)   => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z"
const icsDate     = (d: string) => d.replace(/-/g, "")
const icsDateTime = (d: string) => d.slice(0, 16).replace(/[-:]/g, "") + "00"

// ponytail: TZID without a VTIMEZONE block; Google, Apple and Outlook all resolve IANA names
const vevent = (e: Recording, origin: string) => {
  const start  = String(e.data.starts_at)
  const end    = String(e.data.ends_at ?? start)
  const allDay = e.data.all_day || start.length === 10
  const tz     = e.data.tz ?? "UTC"

  const lines = ["BEGIN:VEVENT", `UID:event-${e.id}@projecttorch`, `DTSTAMP:${stamp(new Date(e.updated_at))}`]
  if (allDay) {
    // DTEND is exclusive for all-day events: the day after the last day.
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start.slice(0, 10))}`)
    lines.push(`DTEND;VALUE=DATE:${icsDate(addDays(end.slice(0, 10), 1))}`)
  } else {
    lines.push(`DTSTART;TZID=${tz}:${icsDateTime(start)}`)
    lines.push(`DTEND;TZID=${tz}:${icsDateTime(end)}`)
  }
  if (e.data.repeat && e.data.repeat !== "never") lines.push(`RRULE:FREQ=${String(e.data.repeat).toUpperCase()}`)
  lines.push(`SUMMARY:${icsEsc(e.title)}`)
  if (e.body) lines.push(`DESCRIPTION:${icsEsc(e.body)}`)
  lines.push(`URL:${origin}${urlFor(e)}`, "END:VEVENT")
  return lines
}

// A due date shows as an all-day event.
const vdue = (t: Recording, origin: string) => [
  "BEGIN:VEVENT",
  `UID:due-${t.id}@projecttorch`,
  `DTSTAMP:${stamp(new Date(t.updated_at))}`,
  `DTSTART;VALUE=DATE:${icsDate(t.data.due_on)}`,
  `DTEND;VALUE=DATE:${icsDate(addDays(t.data.due_on, 1))}`,
  `SUMMARY:${icsEsc(`Due: ${titleOf(t)}`)}`,
  `URL:${origin}${urlFor(t)}`,
  "END:VEVENT",
]

const calendar = (name: string, events: ReadonlyArray<Recording>, dues: ReadonlyArray<Recording>, origin: string) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ProjectTorch//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEsc(name)}`,
    ...events.flatMap((e) => vevent(e, origin)),
    ...dues.flatMap((t) => vdue(t, origin)),
    "END:VCALENDAR",
  ]
  return HttpServerResponse.text(lines.map(fold).join("\r\n") + "\r\n", { contentType: "text/calendar; charset=utf-8" })
}

// ─── Handlers ──────────────────────────────────────────────────────────────

const newEvent = post("/projects/:id/events", (c) => Effect.gen(function* () {
  const p      = yield* findProject(c, c.params.id)
  const people = yield* projectPeople(p)
  const fd     = yield* c.form
  const input  = readEvent(fd, people)
  const { errors, data } = eventData(input, c.me.time_zone)
  if (errors.length) return invalid(errors)

  const r = yield* createRecording(c, {
    project:            p,
    type:               "event",
    tool:               str(fd, "tool"),
    title:              input.title,
    body:               input.body,
    data,
    visible_to_clients: input.visible_to_clients,
    notifyIds:          input.participant_ids,
    notifyKind:         "event",
    verb:               "added an event",
  })
  return redirect(urlFor(r), "Event posted.")
}))

// Anyone on the project can edit an event, except that clients can only edit their own.
const editEvent = post("/projects/:id/events/:eid/edit", (c) => Effect.gen(function* () {
  const { r, project } = yield* findRecording(c, c.params.eid, "event")
  if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NoAccess()

  const people = yield* projectPeople(project)
  const input  = readEvent(yield* c.form, people)
  const { errors, data } = eventData(input, c.me.time_zone)
  if (errors.length) return invalid(errors)

  // The "Clients see this" box is only on the form when the project has clients; without it, keep what it was.
  const visible = people.some(isClient) ? input.visible_to_clients : r.visible_to_clients
  const updated = yield* updateRecording(c, r, { title: input.title, body: input.body, data, visible_to_clients: visible })

  // Only the newly added hear about it.
  const added = input.participant_ids.filter((id) => !(r.data.participant_ids ?? []).includes(id))
  if (added.length) yield* notify(c, { personIds: added, recording: updated, kind: "event", summary: `${c.me.name} added you to ${updated.title}` })
  return redirect(urlFor(updated), "Saved.")
}))

// The feed pages need the signed feed path, and only the server knows the secret.
const projectFeed = get("/projects/:id/calendar/feed", (c) => Effect.gen(function* () {
  const p = yield* findProject(c, c.params.id)
  return json({ path: projectFeedPath(p.id, c.me.id) })
}))

const myFeed = get("/my/calendar/feed", (c) => Effect.succeed(json({ path: personFeedPath(c.me.id) })))

const projectIcs = get("/projects/:id/calendar.ics", (c) => Effect.gen(function* () {
  const p    = yield* findProject(c, c.params.id)
  const rows = yield* projectRows(c.me, p.id)
  return calendar(p.name, rows.events, rows.dues, origin(c.req))
}))

// <person id>-<signature>.ics. The signature covers both ids, so a link can't be pointed at another project or person.
const projectFeedIcs = pubGet("/feeds/projects/:id/:file", (c) => Effect.gen(function* () {
  const projectId          = Number(c.params.id)
  const [personId, token] = feedTokenFrom(c.params.file).split("-")
  if (!personId || !token || !sameToken(token, sign(`project:${projectId}:${Number(personId)}`))) return yield* new NotFound()

  const ctx  = yield* feedOwner(Number(personId))
  const p    = yield* findProject(ctx, projectId)   // still on the project?
  const rows = yield* projectRows(ctx.me, p.id)
  return calendar(p.name, rows.events, rows.dues, origin(c.req))
}))

const personFeedIcs = pubGet("/feeds/people/:id/:file", (c) => Effect.gen(function* () {
  const personId = Number(c.params.id)
  if (!sameToken(feedTokenFrom(c.params.file), sign(`person:${personId}`))) return yield* new NotFound()

  const ctx  = yield* feedOwner(personId)
  const rows = yield* personRows(ctx)
  return calendar(`${ctx.me.name}'s calendar`, rows.events, rows.dues, origin(c.req))
}))

export const routes = [
  newEvent,
  editEvent,
  projectFeed,
  myFeed,
  projectIcs,
  projectFeedIcs,
  personFeedIcs,
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const { maya, ann, bob, cara, dan } = s.people
  const { website, marketing }        = s.projects
  const day         = (n: number)   => addDays(today(), n)
  const nextWeekday = (dow: number) => day(((dow - new Date().getUTCDay() + 7) % 7) + 7)

  const event = (p: Project, who: Person, title: string, data: Record<string, any>, participants: number[], body = "", visible = false) =>
    createRecording(s.as(who), {
      project:            p,
      type:               "event",
      title,
      body,
      data:               { tz: who.time_zone, repeat: "never", ...data, participant_ids: participants },
      visible_to_clients: visible,
      notifyIds:          participants,
      verb:               "added an event",
    })

  const tuesday = nextWeekday(2)
  const monday  = addDays(nextWeekday(1), -7)

  yield* event(website,   maya, "Design review",               { starts_at: `${tuesday}T14:00`, ends_at: `${tuesday}T15:00` },                    [maya.id, ann.id], "Walk through the homepage and pricing page sketches.")
  yield* event(website,   ann,  "Weekly sync",                 { starts_at: `${monday}T10:00`,  ends_at: `${monday}T10:30`, repeat: "weekly" },  [maya.id, ann.id, bob.id])
  yield* event(website,   maya, "Kickoff call with Northwind", { starts_at: `${day(-18)}T09:00`, ends_at: `${day(-18)}T10:00` },                  [maya.id, dan.id], "", true)
  yield* event(website,   maya, "Launch day",                  { starts_at: day(24), ends_at: day(24), all_day: true },                           [maya.id, ann.id, bob.id, dan.id], "Go live. Champagne optional.", true)
  yield* event(marketing, cara, "Campaign planning offsite",   { starts_at: day(10), ends_at: day(11), all_day: true },                           [cara.id, maya.id])
})
