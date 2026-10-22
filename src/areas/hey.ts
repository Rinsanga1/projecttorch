// Updates & notifications: the Updates page, notification settings, quiet hours, Out of office, reminders surfacing.
// The pages are client/areas/hey.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { fmtDate, fmtDateTime, isoDate } from "../shared/format.ts"
import { post, redirect, invalid, str, bool, type Ctx, type Prefs } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

/** Merge into the current person's prefs. A null value clears that key. */
export const savePrefs = (c: Ctx, patch: Partial<Record<keyof Prefs, unknown>>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update people set prefs = jsonb_strip_nulls(prefs || ${JSON.stringify(patch)}::jsonb) where id = ${c.me.id}`
  })

/** "2025-10-22T09:00" as wall-clock time in `tz` → the real instant. */
export const zonedToUtc = (local: string, tz: string) => {
  const guess = new Date(local + "Z")
  if (Number.isNaN(guess.getTime())) return guess
  const inTz = new Date(guess.toLocaleString("en-US", { timeZone: tz }))
  const inUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }))
  return new Date(guess.getTime() + (inUtc.getTime() - inTz.getTime()))
}

/** Today's date (YYYY-MM-DD) in a time zone, `offset` days from now. */
const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: tz })

export const routes = [
  /** Mark one read and go to what it's about. Was a GET; the page at /updates/:nid/open posts here. */
  post("/updates/:nid/open", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [n] = yield* sql<{ recording_id: number | null; project_id: number | null }>`
        update notifications set read_at = coalesce(read_at, now()) where id = ${Number(c.params.nid) || 0} and person_id = ${c.me.id}
        returning recording_id, project_id`
      if (!n) return redirect("/updates")
      return redirect(n.recording_id ? `/r/${n.recording_id}/go` : n.project_id ? `/projects/${n.project_id}` : "/updates")
    })),

  post("/updates/read-all", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and read_at is null and kind <> 'ping'`
      return redirect("/updates", "All caught up.")
    })),

  post("/my/notifications", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      yield* savePrefs(c, { notify_email: bool(fd, "notify_email"), notify_desktop: bool(fd, "notify_desktop"), notify_push: bool(fd, "notify_push") })
      return redirect("/my/notifications", "Saved.")
    })),

  post("/my/quiet-hours", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const w = { on: bool(fd, "on"), days: fd.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6), start: str(fd, "start") || "09:00", end: str(fd, "end") || "17:00" }
      const errs = [
        ...(w.on && !w.days.length ? ["Pick at least one work day."] : []),
        ...(w.start >= w.end ? ["Work hours have to end after they start."] : []),
      ]
      if (errs.length) return invalid(errs)
      yield* savePrefs(c, { wcw: w })
      return redirect("/my/quiet-hours", w.on ? `Got it. We'll hold notifications outside ${w.start}–${w.end}.` : "Quiet hours are off.")
    })),

  post("/my/quiet-hours/snooze", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const tz = c.me.time_zone
      const choice = str(fd, "for")
      const until =
        choice === "2h" ? new Date(Date.now() + 2 * 3600_000)
        : choice === "tomorrow" ? zonedToUtc(`${dayIn(tz, 1)}T09:00`, tz)
        : choice === "custom" ? zonedToUtc(str(fd, "at"), tz)
        : new Date(Date.now() + 3600_000)
      if (Number.isNaN(until.getTime()) || until <= new Date()) return redirect("/my/quiet-hours", "Pick a time in the future.")
      yield* savePrefs(c, { snooze_until: until.toISOString() })
      return redirect("/my/quiet-hours", `Snoozed until ${fmtDateTime(until, tz)}.`)
    })),

  post("/my/quiet-hours/unsnooze", (c) =>
    Effect.gen(function* () {
      yield* savePrefs(c, { snooze_until: null })
      return redirect("/my/quiet-hours", "Notifications are back on.")
    })),

  post("/my/out-of-office", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const o = { from: str(fd, "from") || dayIn(c.me.time_zone), until: str(fd, "until"), message: str(fd, "message") }
      const errs = [
        ...(o.until ? [] : ["Say when you'll be back."]),
        ...(o.until && o.until < o.from ? ["“Until” has to be on or after “From”."] : []),
        ...(o.until && o.until < dayIn(c.me.time_zone) ? ["That date's already passed."] : []),
      ]
      if (errs.length) return invalid(errs)
      yield* savePrefs(c, { ooo: o })
      return redirect("/my/out-of-office", `You're out of office until ${fmtDate(o.until)}.`)
    })),

  post("/my/out-of-office/off", (c) =>
    Effect.gen(function* () {
      yield* savePrefs(c, { ooo: null })
      return redirect("/my/out-of-office", "Welcome back. Out of office is off.")
    })),
]

/** Every minute: reminders that are due become Updates notifications. */
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

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann } = s.people
    const msgs = yield* sql<{ id: number; title: string; project_id: number }>`
      select id, title, project_id from recordings where account_id = ${s.account.id} and type = 'message' and status = 'active' order by id`
    const [kickoff, pitch] = [msgs.find((m) => m.title.startsWith("Kickoff")), msgs.find((m) => m.title.startsWith("Idea"))]
    if (pitch) yield* sql`insert into bubble_ups ${sql.insert({ person_id: maya.id, recording_id: pitch.id, bubble_at: new Date(Date.now() + 86_400_000) })}`
    if (kickoff) {
      yield* sql`insert into bubble_ups ${sql.insert({ person_id: maya.id, recording_id: kickoff.id, bubble_at: new Date(Date.now() - 3600_000), surfaced_at: new Date() })}`
      yield* sql`insert into notifications ${sql.insert({ person_id: maya.id, recording_id: kickoff.id, project_id: kickoff.project_id, kind: "bubble_up", summary: `Reminder: ${kickoff.title}` })}`
    }
    const from = isoDate(new Date(Date.now() + 7 * 86_400_000))
    const until = isoDate(new Date(Date.now() + 11 * 86_400_000))
    yield* sql`update people set prefs = prefs || ${JSON.stringify({ ooo: { from, until, message: "At a conference. Bob has the design files." } })}::jsonb where id = ${ann.id}`
  })
