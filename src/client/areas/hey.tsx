// Updates & notifications: the Updates page, notification settings, quiet hours, Out of office. Posts: src/areas/hey.ts.
import { useEffect, useRef } from "react"
import { useNavigate, useParams } from "react-router"
import { db, submit } from "../store.ts"
import { me } from "../data.ts"
import { isOutOfOffice, isQuiet, type Notification, type Prefs } from "../../shared/domain.ts"
import { fmtDate, fmtDateTime, ms } from "../../shared/format.ts"
import { Form } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"

/** Today's date (YYYY-MM-DD) in a time zone, `offset` days from now. */
const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: tz })

const NoteList = ({ notes, tz }: { notes: ReadonlyArray<Notification>; tz: string }) => (
  <ul>
    {notes.map((n) => {
      const project = n.project_id ? db.projects.get(String(n.project_id)) : undefined
      return (
        <li key={n.id}>
          <a href={`/updates/${n.id}/open`}>{n.summary}</a>
          <br /><small>{project ? `${project.name} · ` : ""}{fmtDateTime(n.created_at, tz)}</small>
        </li>
      )
    })}
  </ul>
)

/** Mark these read in the copy right away (the server does the same). */
const markRead = (notes: ReadonlyArray<Notification>) => {
  const now = new Date().toISOString()
  for (const n of notes) if (!n.read_at) db.notifications.set(String(n.id), { ...n, read_at: now })
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MY = [["Me", "/my"]] as const

const WcwForm = ({ w, tz }: { w: NonNullable<Prefs["wcw"]>; tz: string }) => (
  <Form action="/my/quiet-hours">
    <p><label><input type="checkbox" name="on" defaultChecked={!!w.on} /> Only notify me during work hours</label></p>
    <fieldset><legend>Work days</legend>
      {DAYS.map((d, i) => <span key={d}><label><input type="checkbox" name="days" value={i} defaultChecked={(w.days ?? [1, 2, 3, 4, 5]).includes(i)} /> {d}</label> </span>)}
    </fieldset>
    <p><label>From <input type="time" name="start" defaultValue={w.start ?? "09:00"} /></label>{" "}
       <label>until <input type="time" name="end" defaultValue={w.end ?? "17:00"} /></label>{" "}
       <small>in your time zone ({tz}). <a href="/my/profile">Change it</a></small></p>
    <button>Save changes</button>
  </Form>
)

const OooForm = ({ o, tz }: { o: NonNullable<Prefs["ooo"]>; tz: string }) => (
  <Form action="/my/out-of-office">
    <p><label>From <input type="date" name="from" defaultValue={o.from ?? dayIn(tz)} /></label>{" "}
       <label>Until <input type="date" name="until" defaultValue={o.until ?? ""} required /></label></p>
    <p><label>Message (optional)<br /><textarea name="message" rows={3} cols={60} placeholder="Back on the 30th. Ask Ann about anything urgent." defaultValue={o.message ?? ""} /></label></p>
    <button>Turn on</button>
  </Form>
)

export const routes = [
  page("/updates", () => {
    const m = me()
    const cutoff = Date.now() - 30 * 86_400_000
    const notes = [...db.notifications.values()]
      .filter((n) => n.person_id === m.id && n.kind !== "ping" && (!n.read_at || ms(n.read_at) > cutoff))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 200)
    const unread = notes.filter((n) => !n.read_at)
    const bubbled = unread.filter((n) => n.kind === "bubble_up")
    const fresh = unread.filter((n) => n.kind !== "bubble_up")
    const seen = notes.filter((n) => n.read_at).slice(0, 50)
    return (
      <Page title="Updates">
        <h1>Updates</h1>
        {isQuiet(m) && <p>☾ Notifications are paused right now. <a href="/my/quiet-hours">Quiet hours settings</a></p>}
        {unread.length > 0 && (
          <Form action="/updates/read-all" optimistic={() => markRead([...db.notifications.values()].filter((n) => n.person_id === m.id && n.kind !== "ping"))}>
            <button>Mark all as read</button>
          </Form>
        )}
        {bubbled.length > 0 && <><h2>Reminders</h2><NoteList notes={bubbled} tz={m.time_zone} /><p><a href="/my/reminders">Your reminders</a></p></>}
        <h2>New for you</h2>
        {fresh.length ? <NoteList notes={fresh} tz={m.time_zone} /> : <p>You're all caught up. When something needs you, it'll show up here.</p>}
        {seen.length > 0 && <><h2>Previously seen</h2><NoteList notes={seen} tz={m.time_zone} /></>}
        <p><a href="/my/notifications">Notification settings</a> · <a href="/my/quiet-hours">Snooze notifications</a></p>
      </Page>
    )
  }),

  // Open a notification: mark it read (optimistic) and go straight to what it's about, replacing this page in history.
  page("/updates/:nid/open", () => {
    const nid = String(Number(useParams().nid) || 0)
    const navigate = useNavigate()
    const done = useRef(false)
    useEffect(() => {
      if (done.current) return
      done.current = true
      const n = db.notifications.get(nid)
      submit(`/updates/${nid}/open`, new FormData(), () => n && markRead([n])).catch(() => {})
      navigate(n?.recording_id ? `/r/${n.recording_id}/go` : n?.project_id ? `/projects/${n.project_id}` : "/updates", { replace: true })
    }, [nid])
    return <Page title="Updates"><p>Opening…</p></Page>
  }),

  page("/my/notifications", () => {
    const m = me()
    const p = m.prefs
    return (
      <Page title="Notification settings" crumbs={MY}>
        <h1>Notification settings</h1>
        <p>You'll always see everything in Updates.</p>
        <Form action="/my/notifications">
          <p><label><input type="checkbox" name="notify_email" defaultChecked={p.notify_email !== false} /> Send notifications by email</label></p>
          <p><label><input type="checkbox" name="notify_desktop" defaultChecked={!!p.notify_desktop} /> Desktop notifications in this browser</label></p>
          <p><label><input type="checkbox" name="notify_push" defaultChecked={p.notify_push !== false} /> Phone notifications from the app</label></p>
          <button>Save changes</button>
        </Form>
        <p><small>ponytail: desktop and phone notifications are recorded but not sent yet; email goes to the <a href="/inbox">dev inbox</a>.</small></p>
        <ul>
          <li><a href="/my/quiet-hours">Quiet hours</a>{p.wcw?.on ? ` (on: ${p.wcw.start ?? "09:00"}–${p.wcw.end ?? "17:00"})` : ""}</li>
          <li><a href="/my/out-of-office">Out of office</a>{isOutOfOffice(m) ? ` (on until ${fmtDate(p.ooo!.until)})` : ""}</li>
        </ul>
      </Page>
    )
  }),

  page("/my/quiet-hours", () => {
    const m = me()
    const snooze = m.prefs.snooze_until && new Date(m.prefs.snooze_until) > new Date() ? m.prefs.snooze_until : null
    return (
      <Page title="Quiet hours" crumbs={[...MY, ["Notification settings", "/my/notifications"]]}>
        <h1>Quiet hours</h1>
        <p>Pick your work hours. After hours, we hold your notifications. They wait for you in Updates.</p>
        <p>While you're off, others see a ☾ next to your name.</p>
        <WcwForm w={m.prefs.wcw ?? {}} tz={m.time_zone} />
        <h2>Snooze</h2>
        {snooze ? (
          <>
            <p>Notifications are snoozed until {fmtDateTime(snooze, m.time_zone)}.</p>
            <Form action="/my/quiet-hours/unsnooze"><button>Stop snoozing</button></Form>
          </>
        ) : (
          <Form action="/my/quiet-hours/snooze">
            <p>Snooze for…</p>
            <p>
              <label><input type="radio" name="for" value="1h" defaultChecked /> 1 hour</label><br />
              <label><input type="radio" name="for" value="2h" /> 2 hours</label><br />
              <label><input type="radio" name="for" value="tomorrow" /> Until tomorrow (9am)</label><br />
              <label><input type="radio" name="for" value="custom" /> Pick a time:</label> <input type="datetime-local" name="at" />
            </p>
            <button>Snooze notifications</button>
          </Form>
        )}
      </Page>
    )
  }),

  page("/my/out-of-office", () => {
    const m = me()
    const o = m.prefs.ooo
    const today = dayIn(m.time_zone)
    const on = !!o?.until && o.until >= today
    return (
      <Page title="Out of office" crumbs={MY}>
        <h1>Out of office</h1>
        <p>Say you're away and when you're back. People see it on your profile, in private chats, and when they give you a task.</p>
        {on && (
          <>
            <p><b>You're out of office {o!.from && o!.from > today ? `from ${fmtDate(o!.from)} ` : ""}until {fmtDate(o!.until)}.</b>{o!.message && <> “{o!.message}”</>}</p>
            <Form action="/my/out-of-office/off"><button>I'm back, turn it off</button></Form>
            <h2>Change the dates</h2>
          </>
        )}
        <OooForm key={JSON.stringify(o ?? {})} o={o ?? {}} tz={m.time_zone} />
      </Page>
    )
  }),
]
