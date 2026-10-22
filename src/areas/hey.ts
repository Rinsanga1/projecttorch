// Updates & notifications: the Updates page, notification settings, quiet hours, Out of office, reminders surfacing.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, checked, fmtDate, fmtDateTime, isoDate } from "../lib/html.ts"
import { get, post, redirect, render, str, bool, errors, isQuiet, isOutOfOffice, type Ctx, type Prefs } from "../lib/web.ts"
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

type Note = { id: number; kind: string; summary: string; created_at: Date; read_at: Date | null; recording_id: number | null; project_id: number | null; actor_name: string | null; project_name: string | null }

const noteList = (c: Ctx, notes: ReadonlyArray<Note>) =>
  html`<ul>${notes.map((n) => html`<li>
    <a href="/updates/${n.id}/open">${n.summary}</a>
    <br><small>${n.project_name ? `${n.project_name} · ` : ""}${fmtDateTime(n.created_at, c.me.time_zone)}</small></li>`)}</ul>`

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const wcwForm = (c: Ctx, w: NonNullable<Prefs["wcw"]>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="/my/quiet-hours">
  <p><label><input type="checkbox" name="on"${checked(w.on)}> Only notify me during work hours</label></p>
  <fieldset><legend>Work days</legend>
    ${DAYS.map((d, i) => html`<label><input type="checkbox" name="days" value="${i}"${checked((w.days ?? [1, 2, 3, 4, 5]).includes(i))}> ${d}</label> `)}
  </fieldset>
  <p><label>From <input type="time" name="start" value="${w.start ?? "09:00"}"></label>
     <label>until <input type="time" name="end" value="${w.end ?? "17:00"}"></label>
     <small>in your time zone (${c.me.time_zone}). <a href="/my/profile">Change it</a></small></p>
  <button>Save changes</button>
</form>`

const oooForm = (c: Ctx, o: NonNullable<Prefs["ooo"]>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="/my/out-of-office">
  <p><label>From <input type="date" name="from" value="${o.from ?? dayIn(c.me.time_zone)}"></label>
     <label>Until <input type="date" name="until" value="${o.until ?? ""}" required></label></p>
  <p><label>Message (optional)<br><textarea name="message" rows="3" cols="60" placeholder="Back on the 30th. Ask Ann about anything urgent.">${o.message ?? ""}</textarea></label></p>
  <button>Turn on</button>
</form>`

export const routes = [
  get("/updates", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const notes = yield* sql<Note>`
        select n.*, a.name as actor_name, p.name as project_name from notifications n
        left join people a on a.id = n.actor_id left join projects p on p.id = n.project_id
        where n.person_id = ${c.me.id} and n.kind <> 'ping' and (n.read_at is null or n.read_at > now() - interval '30 days')
        order by n.created_at desc limit 200`
      const unread = notes.filter((n) => !n.read_at)
      const bubbled = unread.filter((n) => n.kind === "bubble_up")
      const fresh = unread.filter((n) => n.kind !== "bubble_up")
      const seen = notes.filter((n) => n.read_at).slice(0, 50)
      return yield* render(c, "Updates", html`
<h1>Updates</h1>
${isQuiet(c.me) ? html`<p>☾ Notifications are paused right now. <a href="/my/quiet-hours">Quiet hours settings</a></p>` : ""}
${unread.length ? html`<form method="post" action="/updates/read-all"><button>Mark all as read</button></form>` : ""}
${bubbled.length ? html`<h2>Reminders</h2>${noteList(c, bubbled)}<p><a href="/my/reminders">Your reminders</a></p>` : ""}
<h2>New for you</h2>
${fresh.length ? noteList(c, fresh) : html`<p>You're all caught up. When something needs you, it'll show up here.</p>`}
${seen.length ? html`<h2>Previously seen</h2>${noteList(c, seen)}` : ""}
<p><a href="/my/notifications">Notification settings</a> · <a href="/my/quiet-hours">Snooze notifications</a></p>`)
    })),

  get("/updates/:nid/open", (c) =>
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

  get("/my/notifications", (c) =>
    Effect.gen(function* () {
      const p = c.me.prefs
      return yield* render(c, "Notification settings", html`
<h1>Notification settings</h1>
<p>You'll always see everything in Updates.</p>
<form method="post" action="/my/notifications">
  <p><label><input type="checkbox" name="notify_email"${checked(p.notify_email !== false)}> Send notifications by email</label></p>
  <p><label><input type="checkbox" name="notify_desktop"${checked(p.notify_desktop)}> Desktop notifications in this browser</label></p>
  <p><label><input type="checkbox" name="notify_push"${checked(p.notify_push !== false)}> Phone notifications from the app</label></p>
  <button>Save changes</button>
</form>
<p><small>ponytail: desktop and phone notifications are recorded but not sent yet; email goes to the <a href="/inbox">dev inbox</a>.</small></p>
<ul>
  <li><a href="/my/quiet-hours">Quiet hours</a>${p.wcw?.on ? ` (on: ${p.wcw.start ?? "09:00"}–${p.wcw.end ?? "17:00"})` : ""}</li>
  <li><a href="/my/out-of-office">Out of office</a>${isOutOfOffice(c.me) ? ` (on until ${fmtDate(p.ooo!.until)})` : ""}</li>
</ul>`, [["Me", "/my"]])
    })),

  post("/my/notifications", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      yield* savePrefs(c, { notify_email: bool(fd, "notify_email"), notify_desktop: bool(fd, "notify_desktop"), notify_push: bool(fd, "notify_push") })
      return redirect("/my/notifications", "Saved.")
    })),

  get("/my/quiet-hours", (c) =>
    Effect.gen(function* () {
      const snooze = c.me.prefs.snooze_until && new Date(c.me.prefs.snooze_until) > new Date() ? c.me.prefs.snooze_until : null
      return yield* render(c, "Quiet hours", html`
<h1>Quiet hours</h1>
<p>Pick your work hours. After hours, we hold your notifications. They wait for you in Updates.</p>
<p>While you're off, others see a ☾ next to your name.</p>
${wcwForm(c, c.me.prefs.wcw ?? {}, [])}
<h2>Snooze</h2>
${snooze
  ? html`<p>Notifications are snoozed until ${fmtDateTime(snooze, c.me.time_zone)}.</p><form method="post" action="/my/quiet-hours/unsnooze"><button>Stop snoozing</button></form>`
  : html`<form method="post" action="/my/quiet-hours/snooze">
  <p>Snooze for…</p>
  <p><label><input type="radio" name="for" value="1h" checked> 1 hour</label><br>
  <label><input type="radio" name="for" value="2h"> 2 hours</label><br>
  <label><input type="radio" name="for" value="tomorrow"> Until tomorrow (9am)</label><br>
  <label><input type="radio" name="for" value="custom"> Pick a time:</label> <input type="datetime-local" name="at"></p>
  <button>Snooze notifications</button>
</form>`}`, [["Me", "/my"], ["Notification settings", "/my/notifications"]])
    })),

  post("/my/quiet-hours", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const w = { on: bool(fd, "on"), days: fd.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6), start: str(fd, "start") || "09:00", end: str(fd, "end") || "17:00" }
      const errs = [
        ...(w.on && !w.days.length ? ["Pick at least one work day."] : []),
        ...(w.start >= w.end ? ["Work hours have to end after they start."] : []),
      ]
      if (errs.length) return yield* render(c, "Quiet hours", html`<h1>Quiet hours</h1>${wcwForm(c, w, errs)}`, [["Me", "/my"]], 422)
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

  get("/my/out-of-office", (c) =>
    Effect.gen(function* () {
      const o = c.me.prefs.ooo
      const on = !!o?.until && o.until >= dayIn(c.me.time_zone)
      return yield* render(c, "Out of office", html`
<h1>Out of office</h1>
<p>Say you're away and when you're back. People see it on your profile, in private chats, and when they give you a task.</p>
${on
  ? html`<p><b>You're out of office ${o!.from && o!.from > dayIn(c.me.time_zone) ? `from ${fmtDate(o!.from)} ` : ""}until ${fmtDate(o!.until)}.</b>${o!.message ? html` “${o!.message}”` : ""}</p>
<form method="post" action="/my/out-of-office/off"><button>I'm back, turn it off</button></form>
<h2>Change the dates</h2>`
  : ""}
${oooForm(c, o ?? {}, [])}`, [["Me", "/my"]])
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
      if (errs.length) return yield* render(c, "Out of office", html`<h1>Out of office</h1>${oooForm(c, o, errs)}`, [["Me", "/my"]], 422)
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

