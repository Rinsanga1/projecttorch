// The Inbox: private chats and updates (notifications, reminders) in one place, as a tray over any page and as its
// own page at /updates. Also notification settings, quiet hours, Out of office. Posts: src/areas/hey.ts.
import * as stylex from "@stylexjs/stylex"
import { observable, runInAction } from "mobx"
import { observer } from "mobx-react-lite"
import { useEffect, useRef, type MouseEvent } from "react"
import { useLocation, useNavigate, useParams } from "react-router"
import { db, submit } from "../store.ts"
import { me } from "../data.ts"
import { isOutOfOffice, isQuiet, type Notification, type Prefs } from "../../shared/domain.ts"
import { ago, excerpt, fmtDate, fmtDateTime, ms } from "../../shared/format.ts"
import { Form } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"
import { Face, kit, sx } from "../ui/kit.tsx"
import { Icon } from "../ui/icons.tsx"
import { InWindow } from "../ui/in-window.tsx"
import { privateChats, TrayChat, writerOf } from "./chat.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

/** Today's date (YYYY-MM-DD) in a time zone, `offset` days from now. */
const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: tz })

// The iOS-like drawer curve the project rail uses: the tray slides in on it, and out a little faster.
const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)"
const PHONE = "@media (max-width: 640px)"
const hs = stylex.create({
  // A white card floating over the right of the page; the page under it doesn't move. On a phone it's the whole screen.
  tray: {
    position: "fixed", zIndex: 60, top: { default: 72, [PHONE]: 0 }, right: { default: space.s2, [PHONE]: 0 }, bottom: { default: space.s2, [PHONE]: 0 },
    width: { default: "min(400px, calc(100vw - 16px))", [PHONE]: "100%" }, display: "flex", flexDirection: "column", overflow: "hidden",
    backgroundColor: color.sheet, borderRadius: { default: radius.xl, [PHONE]: 0 }, boxShadow: "0 16px 40px rgba(0,0,0,.18)",
    transform: { default: "translateX(calc(100% + 16px))", [PHONE]: "translateY(100%)" }, visibility: "hidden",
    transitionProperty: "transform, visibility", transitionDuration: { default: "180ms, 0s", [media.reduce]: "0s" },
    transitionDelay: { default: "0s, 180ms", [media.reduce]: "0s" }, transitionTimingFunction: `${EASE_DRAWER}, linear`,
  },
  open: { transform: "none", visibility: "visible", transitionDuration: { default: "240ms, 0s", [media.reduce]: "0s" }, transitionDelay: "0s" },
  head: { display: "flex", alignItems: "center", gap: space.s2, minHeight: 56, paddingBlock: space.s2, paddingInline: space.s4, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line },
  headTitle: { flexGrow: 1, minWidth: 0, margin: 0, fontSize: text.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  iconButton: { width: 34, padding: 0, flexShrink: 0, backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } } },
  body: { flexGrow: 1, overflowY: "auto", overscrollBehavior: "contain", paddingBlock: space.s4, paddingInline: space.s4 },
  // A section: its heading with an action at the end, then its rows.
  section: { marginBottom: space.s6 },
  sectionHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: space.s3, marginBottom: space.s2 },
  sectionTitle: { margin: 0, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  sectionAction: { fontSize: text.sm, fontWeight: 600, color: color.ink, textDecorationLine: "none", ":hover": { textDecorationLine: { default: null, [media.hover]: "underline" } } },
  list: { margin: 0 },
  // A row: faces, then who or what in Ink and a line under it, then how long ago (and a dot while it's unread).
  row: {
    position: "relative", display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto", columnGap: space.s3, alignItems: "start",
    paddingBlock: 10, paddingInline: space.s2, marginInline: `calc(-1 * ${space.s2})`, borderRadius: radius.md, borderTopWidth: 0,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } }, transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  rowLink: {
    display: "block", color: color.ink, fontWeight: 500, textDecorationLine: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    // The whole row is the link.
    "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" },
  },
  rowLinkWrap: { whiteSpace: "normal" },
  unread: { fontWeight: 650 },
  rowMeta: { display: "block", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowWhen: { display: "flex", alignItems: "center", gap: 6, fontSize: text.xs, color: color.muted, whiteSpace: "nowrap", paddingTop: 2 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.accent },
  // Two people or more: two smaller faces, the second at the bottom-right, ringed in white.
  faces: { position: "relative", display: "block", width: 32, height: 32 },
  faceA: { position: "absolute", top: 0, left: 0, display: "inline-flex" },
  faceB: { position: "absolute", right: 0, bottom: 0, display: "inline-flex", borderRadius: radius.pill, boxShadow: `0 0 0 2px ${color.sheet}` },
  // An update nobody made (a reminder): a quiet disc with the calendar icon where a face would be.
  noFace: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.tile, color: color.muted },
  // A chat in the tray fills it, so its composer sits at the bottom even when the talk is short.
  chat: { display: "flex", flexDirection: "column", minHeight: "100%" },
  empty: { margin: 0, color: color.muted, fontSize: text.sm },
  page: { maxWidth: 640 },
  more: { marginTop: space.s2, marginBottom: 0, fontSize: text.sm },
})

/** The Inbox tray: whether it's open (and ever was), and the private chat open in it (null: the list). */
export const tray = observable({ open: false, ever: false, chat: null as number | null })
export const openTray = (on = !tray.open) => {
  runInAction(() => { tray.open = on; if (on) { tray.ever = true; tray.chat = null } })
  // Closing, the chat stays on screen while the tray slides away, then it closes too (so it stops marking lines read).
  if (!on) setTimeout(() => runInAction(() => { if (!tray.open) tray.chat = null }), 200)
}
/** Unread in the Inbox: private chat lines and updates, one count. */
export const inboxCount = (personId: number) => [...db.notifications.values()].filter((n) => n.person_id === personId && !n.read_at).length

/** Mark these read in the copy right away (the server does the same). */
const markRead = (notes: ReadonlyArray<Notification>) => {
  const now = new Date().toISOString()
  for (const n of notes) if (!n.read_at) db.notifications.set(String(n.id), { ...n, read_at: now })
}

const NoteList = observer(({ notes }: { notes: ReadonlyArray<Notification> }) => {
  const m = me()
  return (
    <ul {...sx(hs.list)}>
      {notes.map((n) => {
        const project = n.project_id ? db.projects.get(String(n.project_id)) : undefined
        const actor = n.actor_id ? db.people.get(String(n.actor_id)) : undefined
        return (
          <li key={n.id} {...sx(hs.row)}>
            <span>{actor ? <Face p={actor} px={32} /> : <span {...sx(hs.noFace)}><Icon name="schedule" size={16} /></span>}</span>
            <span>
              <a href={`/updates/${n.id}/open`} {...sx(hs.rowLink, hs.rowLinkWrap, !n.read_at && hs.unread)}>{n.summary}</a>
              {project && <small {...sx(hs.rowMeta)}>{project.name}</small>}
            </span>
            <span {...sx(hs.rowWhen)}>{ago(n.created_at, m.time_zone)}{!n.read_at && <span {...sx(hs.dot)} aria-label="Unread" />}</span>
          </li>
        )
      })}
    </ul>
  )
})

/** Private chats, newest first: in the tray a chat opens right there; on the page it's a link to its own page. */
const ChatList = observer(({ inTray, limit }: { inTray: boolean; limit: number }) => {
  const m = me()
  const chats = privateChats()
  const open = (id: number) => (e: MouseEvent) => {
    if (!inTray || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    runInAction(() => { tray.chat = id })
  }
  return (
    <section aria-labelledby={inTray ? "tray-chats" : "page-chats"} {...sx(hs.section)}>
      <div {...sx(hs.sectionHead)}>
        <h2 id={inTray ? "tray-chats" : "page-chats"} {...sx(hs.sectionTitle)}>Private chats</h2>
        <a href="/chats/new" {...sx(hs.sectionAction)}>+ New</a>
      </div>
      {chats.length ? (
        <ul {...sx(hs.list)}>
          {chats.slice(0, limit).map((c) => (
            <li key={c.p.id} {...sx(hs.row)}>
              {c.people[1]
                ? <span {...sx(hs.faces)}><span {...sx(hs.faceA)}><Face p={c.people[0]} px={22} /></span><span {...sx(hs.faceB)}><Face p={c.people[1]} px={22} /></span></span>
                : <Face p={c.people[0] ?? m} px={32} />}
              <span>
                <a href={`/chats/${c.p.id}`} onClick={open(c.p.id)} {...sx(hs.rowLink, c.unread > 0 && hs.unread)}>{c.names ?? "Just you"}</a>
                {c.last && <small {...sx(hs.rowMeta)}>{c.people.length > 1 || c.last.creator_id === m.id ? `${c.last.creator_id === m.id ? "You" : writerOf(c.last).split(" ")[0]}: ` : ""}{excerpt(c.last.body, 90)}</small>}
              </span>
              <span {...sx(hs.rowWhen)}>{ago(c.at, m.time_zone)}{c.unread > 0 && <span {...sx(hs.dot)} aria-label={`${c.unread} unread`} />}</span>
            </li>
          ))}
        </ul>
      ) : <p {...sx(hs.empty)}><b>No private chats yet.</b> For a quick question that doesn't belong in a project.</p>}
      {chats.length > limit && <p {...sx(hs.more)}><a href="/chats">See all private chats ({chats.length})</a></p>}
    </section>
  )
})

/** The updates for me: unread first (reminders among them), newest first. */
const myNotes = () => {
  const m = me()
  return [...db.notifications.values()].filter((n) => n.person_id === m.id && n.kind !== "ping").sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** What's in the Inbox, in the tray or on its page: private chats, then what's new for you. */
const InboxList = observer(({ inTray }: { inTray: boolean }) => {
  const m = me()
  const notes = myNotes()
  const fresh = notes.filter((n) => !n.read_at)
  const cutoff = Date.now() - 30 * 86_400_000
  const seen = notes.filter((n) => n.read_at && ms(n.read_at) > cutoff).slice(0, inTray ? 10 : 50)
  return (
    <>
      {isQuiet(m) && <p {...sx(hs.empty)}>☾ Notifications are paused right now. <a href="/my/quiet-hours">Quiet hours</a></p>}
      <ChatList inTray={inTray} limit={inTray ? 5 : 10} />
      <section aria-labelledby={inTray ? "tray-new" : "page-new"} {...sx(hs.section)}>
        <div {...sx(hs.sectionHead)}>
          <h2 id={inTray ? "tray-new" : "page-new"} {...sx(hs.sectionTitle)}>New for you</h2>
          {fresh.length > 0 && (
            <Form action="/updates/read-all" style={{ display: "inline" }} optimistic={() => markRead(myNotes())}>
              <button data-quiet {...sx(kit.linkButton, hs.sectionAction)}>Mark all read</button>
            </Form>
          )}
        </div>
        {fresh.length ? <NoteList notes={fresh} /> : <p {...sx(hs.empty)}><b>You're all caught up.</b> New comments, mentions and assignments show up here.</p>}
      </section>
      {seen.length > 0 && (
        <section aria-labelledby={inTray ? "tray-seen" : "page-seen"} {...sx(hs.section)}>
          <div {...sx(hs.sectionHead)}><h2 id={inTray ? "tray-seen" : "page-seen"} {...sx(hs.sectionTitle)}>Seen</h2></div>
          <NoteList notes={seen} />
        </section>
      )}
      <p {...sx(kit.links)}><a href="/my/reminders">Your reminders</a><a href="/my/notifications">Notification settings</a><a href="/my/quiet-hours">Quiet hours</a>{inTray && <a href="/updates">Open the Inbox page</a>}</p>
    </>
  )
})

/** The Inbox tray, over whatever page you're on. Esc, ✕, a click outside it or going to another page closes it. */
export const InboxTray = observer(() => {
  const ref = useRef<HTMLElement>(null)
  const path = useLocation().pathname
  const chat = tray.chat ? db.projects.get(String(tray.chat)) : undefined
  const names = chat ? privateChats().find((c) => c.p.id === chat.id)?.names ?? "Just you" : ""
  const close = () => openTray(false)
  useEffect(close, [path])
  useEffect(() => {
    if (!tray.open) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      close()
      document.querySelector<HTMLElement>("[data-inbox-toggle]")?.focus()
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.("[data-inbox-toggle]")) close()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onDown)
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown) }
  }, [tray.open])
  return (
    <aside id="inbox-tray" ref={ref} role="dialog" aria-label="Inbox" aria-hidden={!tray.open} tabIndex={-1} data-tray {...sx(hs.tray, tray.open && hs.open)}>
      <div {...sx(hs.head)}>
        {chat && <button type="button" data-quiet aria-label="Back to the Inbox" onClick={() => runInAction(() => { tray.chat = null })} {...sx(hs.iconButton)}><Icon name="back" size={18} /></button>}
        <h2 {...sx(hs.headTitle)}>{chat ? names : "Inbox"}</h2>
        {chat && <a href={`/chats/${chat.id}`} {...sx(hs.sectionAction)}>Full page</a>}
        <button type="button" data-quiet aria-label="Close the Inbox" onClick={close} {...sx(hs.iconButton)}><Icon name="close" size={18} /></button>
      </div>
      {/* The conversation scrolls this body, as it scrolls a project window's, with its composer pinned at the bottom. */}
      <div data-window-body {...sx(hs.body)}>
        {tray.ever && (chat ? <InWindow.Provider value={true}><div data-window-root {...sx(hs.chat)}><TrayChat key={chat.id} p={chat} /></div></InWindow.Provider> : <InboxList inTray />)}
      </div>
    </aside>
  )
})

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MY = [["Me", "/my"]] as const

const WcwForm = ({ w, tz }: { w: NonNullable<Prefs["wcw"]>; tz: string }) => (
  <Form action="/my/quiet-hours">
    <p><label><input type="checkbox" name="on" defaultChecked={!!w.on} /> Only notify me during work hours</label></p>
    <fieldset><legend>Work days</legend>
      {DAYS.map((d, i) => <label key={d}><input type="checkbox" name="days" value={i} defaultChecked={(w.days ?? [1, 2, 3, 4, 5]).includes(i)} /> {d}</label>)}
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
  // The Inbox as a page: what the tray shows, for a link, a refresh, or a browser without JavaScript.
  page("/updates", () => (
    <Page title="Inbox">
      <h1>Inbox</h1>
      <div {...sx(hs.page)}><InboxList inTray={false} /></div>
    </Page>
  )),

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
        <p><small>Desktop and phone notifications are coming soon. Your choice is saved for when they arrive.</small></p>
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
        <p>Say you're away and when you're back. People see it on your profile, in private chats, and when they assign you something.</p>
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
