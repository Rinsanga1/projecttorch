// Updates & notifications: the Updates page, notification settings, quiet hours, Out of office, reminders surfacing.
// Pages: client/areas/hey.tsx. This file is what their forms post to.
//
//   POST /updates/:nid/open            mark one read, go to what it's about
//   POST /updates/read-all             mark everything read (except Pings)
//   POST /my/notifications             email / desktop / push on or off
//   POST /my/quiet-hours               work days and hours
//   POST /my/quiet-hours/snooze        hold notifications until a time
//   POST /my/quiet-hours/unsnooze
//   POST /my/out-of-office             turn on, with dates and a message
//   POST /my/out-of-office/off
//
// Job, every minute: reminders that are due become Updates notifications.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { fmtDate, fmtDateTime, isoDate } from "../shared/format.ts"
import { post, redirect, back, invalid, str, bool, type Ctx, type Prefs } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

const HOUR = 3600_000
const DAY  = 86_400_000

// ─── Plain helpers ─────────────────────────────────────────────────────────

/** Merge into the current person's prefs. A null value clears that key. */
export const savePrefs = (c: Ctx, patch: Partial<Record<keyof Prefs, unknown>>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update people set prefs = jsonb_strip_nulls(prefs || ${JSON.stringify(patch)}::jsonb) where id = ${c.me.id}`
})

/** "2025-10-22T09:00" as wall-clock time in `tz` → the real instant. */
export const zonedToUtc = (local: string, tz: string) => {
  const guess = new Date(local + "Z")
  if (Number.isNaN(guess.getTime())) return guess
  const inTz  = new Date(guess.toLocaleString("en-US", { timeZone: tz }))
  const inUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }))
  return new Date(guess.getTime() + (inUtc.getTime() - inTz.getTime()))
}

/** Today's date (YYYY-MM-DD) in a time zone, `offset` days from now. */
export const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * DAY).toLocaleDateString("en-CA", { timeZone: tz })

/** The snooze form's choice → when notifications come back. An hour unless it says otherwise. */
const snoozeUntil = (fd: FormData, tz: string): Date => {
  switch (str(fd, "for")) {
    case "2h":       return new Date(Date.now() + 2 * HOUR)
    case "tomorrow": return zonedToUtc(`${dayIn(tz, 1)}T09:00`, tz)
    case "custom":   return zonedToUtc(str(fd, "at"), tz)
    default:         return new Date(Date.now() + HOUR)
  }
}

// ─── Updates ───────────────────────────────────────────────────────────────

// Was a GET; the page at /updates/:nid/open posts here.
const openUpdate = post("/updates/:nid/open", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [n] = yield* sql<{ recording_id: number | null; project_id: number | null }>`
    update notifications set read_at = coalesce(read_at, now()) where id = ${Number(c.params.nid) || 0} and person_id = ${c.me.id}
    returning recording_id, project_id`

  if (!n)             return redirect("/updates")
  if (n.recording_id) return redirect(`/r/${n.recording_id}/go`)
  if (n.project_id)   return redirect(`/projects/${n.project_id}`)
  return redirect("/updates")
}))

const readAll = post("/updates/read-all", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and read_at is null and kind <> 'ping'`
  // From the tray or the Inbox page, stay where you are: the list empties, which says it.
  return back(c, "/updates")
}))

// ─── Notification settings ─────────────────────────────────────────────────

const saveNotifications = post("/my/notifications", (c) => Effect.gen(function* () {
  const fd = yield* c.form
  yield* savePrefs(c, {
    notify_email:   bool(fd, "notify_email"),
    notify_desktop: bool(fd, "notify_desktop"),
    notify_push:    bool(fd, "notify_push"),
  })
  return redirect("/my/notifications", "Saved.")
}))

const saveQuietHours = post("/my/quiet-hours", (c) => Effect.gen(function* () {
  const fd = yield* c.form
  const hours = {
    on:    bool(fd, "on"),
    days:  fd.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6),
    start: str(fd, "start") || "09:00",
    end:   str(fd, "end")   || "17:00",
  }

  const errors: string[] = []
  if (hours.on && !hours.days.length) errors.push("Pick at least one work day.")
  if (hours.start >= hours.end)       errors.push("Work hours have to end after they start.")
  if (errors.length) return invalid(errors)

  yield* savePrefs(c, { wcw: hours })
  if (!hours.on) return redirect("/my/quiet-hours", "Quiet hours are off.")
  return redirect("/my/quiet-hours", `Got it. We'll hold notifications outside ${hours.start}–${hours.end}.`)
}))

const snooze = post("/my/quiet-hours/snooze", (c) => Effect.gen(function* () {
  const tz    = c.me.time_zone
  const until = snoozeUntil(yield* c.form, tz)
  if (Number.isNaN(until.getTime()) || until <= new Date()) return redirect("/my/quiet-hours", "Pick a time in the future.")

  yield* savePrefs(c, { snooze_until: until.toISOString() })
  return redirect("/my/quiet-hours", `Snoozed until ${fmtDateTime(until, tz)}.`)
}))

const unsnooze = post("/my/quiet-hours/unsnooze", (c) => Effect.gen(function* () {
  yield* savePrefs(c, { snooze_until: null })
  return redirect("/my/quiet-hours", "Notifications are back on.")
}))

const outOfOffice = post("/my/out-of-office", (c) => Effect.gen(function* () {
  const fd    = yield* c.form
  const today = dayIn(c.me.time_zone)
  const ooo = {
    from:    str(fd, "from") || today,
    until:   str(fd, "until"),
    message: str(fd, "message"),
  }

  // Dates are YYYY-MM-DD, so comparing the strings compares the days.
  const errors: string[] = []
  if (!ooo.until)                        errors.push("Say when you'll be back.")
  if (ooo.until && ooo.until < ooo.from) errors.push("“Until” has to be on or after “From”.")
  if (ooo.until && ooo.until < today)    errors.push("That date's already passed.")
  if (errors.length) return invalid(errors)

  yield* savePrefs(c, { ooo })
  return redirect("/my/out-of-office", `You're out of office until ${fmtDate(ooo.until)}.`)
}))

const outOfOfficeOff = post("/my/out-of-office/off", (c) => Effect.gen(function* () {
  yield* savePrefs(c, { ooo: null })
  return redirect("/my/out-of-office", "Welcome back. Out of office is off.")
}))

export const routes = [
  openUpdate,
  readAll,
  saveNotifications,
  saveQuietHours,
  snooze,
  unsnooze,
  outOfOffice,
  outOfOfficeOff,
]

// ─── Job: reminders ────────────────────────────────────────────────────────

// One statement: mark due reminders surfaced and turn each into a notification.
const surfaceBubbleUps = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    with due as (
      update bubble_ups set surfaced_at = now()
      where bubble_at <= now() and surfaced_at is null and cancelled_at is null
      returning person_id, recording_id)
    insert into notifications (person_id, recording_id, project_id, kind, summary)
    select d.person_id, d.recording_id, r.project_id, 'bubble_up', 'Reminder: ' || coalesce(nullif(r.title, ''), left(r.body, 60))
    from due d join recordings r on r.id = d.recording_id`
})

export const jobs = [surfaceBubbleUps]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann } = s.people

  const messages = yield* sql<{ id: number; title: string; project_id: number }>`
    select id, title, project_id from recordings where account_id = ${s.account.id} and type = 'message' and status = 'active' order by id`
  const kickoff = messages.find((m) => m.title.startsWith("Kickoff"))
  const pitch   = messages.find((m) => m.title.startsWith("Idea"))

  // A reminder still to come, and one that already surfaced.
  if (pitch) yield* sql`insert into bubble_ups ${sql.insert({ person_id: maya.id, recording_id: pitch.id, bubble_at: new Date(Date.now() + DAY) })}`
  if (kickoff) {
    yield* sql`insert into bubble_ups ${sql.insert({ person_id: maya.id, recording_id: kickoff.id, bubble_at: new Date(Date.now() - HOUR), surfaced_at: new Date() })}`
    yield* sql`insert into notifications ${sql.insert({ person_id: maya.id, recording_id: kickoff.id, project_id: kickoff.project_id, kind: "bubble_up", summary: `Reminder: ${kickoff.title}` })}`
  }

  // Ann is out next week.
  const from  = isoDate(new Date(Date.now() + 7  * DAY))
  const until = isoDate(new Date(Date.now() + 11 * DAY))
  yield* sql`update people set prefs = prefs || ${JSON.stringify({ ooo: { from, until, message: "At a conference. Bob has the design files." } })}::jsonb where id = ${ann.id}`
})
