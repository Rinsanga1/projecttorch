// The app chrome, after kargul.studio: wordmark and pill nav on the gray ground, the page on a white sheet,
// the dev "acting as" bar as a dark slab at the bottom. Also: who may see which route (signed in, lockout),
// in-app navigation for plain <a href> links, scrolling to #hashes, the flash lifecycle, keyboard shortcuts.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { runInAction } from "mobx"
import { useEffect, useLayoutEffect, type MouseEvent as ReactMouseEvent } from "react"
import { Navigate, Outlet, useLocation, useMatches, useNavigate } from "react-router"
import { db, state } from "./store.ts"
import { meOrNull } from "./data.ts"
import { isQuiet } from "../shared/domain.ts"
import { Face, sx, theme } from "./ui/kit.tsx"
import { Icon } from "./ui/icons.tsx"
import { InboxTray, inboxCount, openTray, tray } from "./areas/hey.tsx"
import type { Handle } from "./ui/page.tsx"
import { color, media, motion, radius, space, text } from "./ui/tokens.stylex.ts"

const DESKTOP = "@media (min-width: 768px)"
const s = stylex.create({
  body: { display: "flex", flexDirection: "column", minHeight: "100dvh" },
  strip: {
    margin: 0, maxWidth: "none", paddingBlock: 10, paddingInline: space.s4, textAlign: "center",
    backgroundColor: color.slab, color: color.slabInk, fontSize: text.sm, fontWeight: 600,
  },
  header: {
    width: "100%", maxWidth: 1200, marginInline: "auto", paddingInline: { default: space.s4, [DESKTOP]: space.s6 },
    paddingBlock: space.s4, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s5, rowGap: space.s2,
  },
  // On a wide page the bar spans the screen too, its ends in line with the page's own padding, and slims down: it's
  // chrome over a place to work.
  headerWide: { maxWidth: "none", paddingInline: { default: 20, [DESKTOP]: 28 }, paddingBlock: 6 },
  wordmark: {
    fontSize: text.md, fontWeight: 750, letterSpacing: "-0.035em", color: color.ink, textDecoration: "none", whiteSpace: "nowrap",
  },
  navEnd: { display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" },
  link: {
    display: "inline-flex", alignItems: "center", gap: 6, paddingBlock: 7, paddingInline: 12, borderRadius: radius.pill,
    fontSize: text.sm, fontWeight: 500, textDecoration: "none", whiteSpace: "nowrap",
    transitionProperty: "color, background-color", transitionDuration: motion.fast,
    color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } },
    backgroundColor: { default: null, ":hover": { default: null, [media.hover]: `color-mix(in srgb, ${color.sheet} 60%, transparent)` } },
  },
  current: { color: color.ink, fontWeight: 600, backgroundColor: color.sheet },
  icon: { paddingInline: 8 },
  // You, as a face: Me (your assignments, schedule, settings). On your own pages it carries a ring.
  me: { display: "inline-flex", marginLeft: space.s2, borderRadius: radius.pill, textDecoration: "none" },
  meCurrent: { boxShadow: `0 0 0 2px ${color.ground}, 0 0 0 4px ${color.ink}` },
  count: {
    minWidth: 18, height: 18, paddingInline: 5, borderRadius: radius.pill, backgroundColor: color.accent, color: color.onAccent,
    fontSize: 11, fontWeight: 700, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontVariantNumeric: "tabular-nums",
  },
  quiet: {
    display: "inline-flex", alignItems: "center", gap: 6, paddingBlock: 4, paddingInline: 10, borderRadius: radius.pill,
    backgroundColor: color.sheet, fontSize: text.xs, fontWeight: 600, color: color.muted, textDecoration: "none", whiteSpace: "nowrap",
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.success, flexShrink: 0 },
  quietDot: { backgroundColor: color.muted },
  frame: {
    width: "100%", maxWidth: 1200, marginInline: "auto", paddingInline: { default: space.s2, [DESKTOP]: space.s6 },
    paddingBottom: space.s8, flexGrow: 1,
  },
  // A wide page (the project) runs edge to edge and down to the bottom of the screen.
  frameWide: { maxWidth: "none", paddingInline: 0, paddingBottom: 0 },
})

// Less than half a bar, on purpose: the wordmark is Home, then at the end Find, the Inbox (private chats and updates,
// one count; it opens as a tray over the page) and your face, which is Me. Go to lives on its shortcut (Ctrl/⌘ + K).
const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"))

/** Paths that keep working while an account is on hold or cancelled. Matches ON_HOLD_OK in src/lib/web.ts. */
const ON_HOLD_OK = /^\/(lockout|admin\/billing|admin\/export|inbox|dev|accounts|signin|signup|help|exports)/

const Header = observer(({ wide }: { wide: boolean }) => {
  const me = meOrNull()
  const path = useLocation().pathname
  const account = me ? db.accounts.get(String(me.account_id)) : undefined
  if (!me || !account) return <header {...sx(s.header, wide && s.headerWide)}><a href="/marketing" {...sx(s.wordmark)}>Saintsflow</a></header>
  const n = inboxCount(me.id)
  const inInbox = tray.open || isCurrent(path, "/updates") || isCurrent(path, "/chats")
  // The Inbox is a link to its page; a plain click opens it as a tray instead (a new tab still gets the page).
  const toggle = (e: ReactMouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    openTray()
  }
  return (
    <header {...sx(s.header, wide && s.headerWide)}>
      <a href="/" {...sx(s.wordmark)}>{account.name}</a>
      <nav aria-label="Main" {...sx(s.navEnd)}>
        {isQuiet(me) && <a href="/my/quiet-hours" {...sx(s.quiet)}><span {...sx(s.dot, s.quietDot)} />Notifications paused</a>}
        <a href="/find" aria-label="Find" title="Find, or go to anything with Ctrl/⌘ + K" aria-current={isCurrent(path, "/find") ? "page" : undefined}
          {...sx(s.link, s.icon, isCurrent(path, "/find") && s.current)}><Icon name="search" size={18} /></a>
        <a href="/updates" onClick={toggle} data-inbox-toggle aria-controls="inbox-tray" aria-expanded={tray.open} aria-label={n ? `Inbox, ${n} unread` : "Inbox"}
          {...sx(s.link, inInbox && s.current)}>Inbox{n > 0 && <span {...sx(s.count)} aria-hidden="true">{n}</span>}</a>
        <a href="/my" aria-label={`Me: ${me.name}`} title="Your assignments, schedule and settings" aria-current={isCurrent(path, "/my") ? "page" : undefined} {...sx(s.me, isCurrent(path, "/my") && s.meCurrent)}><Face p={me} px={30} /></a>
      </nav>
    </header>
  )
})

/** The root route: guards, chrome, and the behaviors every page shares. */
export const App = observer(() => {
  const loc = useLocation()
  const navigate = useNavigate()
  const matches = useMatches()
  const handle = (matches.at(-1)?.handle ?? {}) as Handle
  // A window's pages sit inside the project page, whose route is the wide one.
  const wide = matches.some((m) => (m.handle as Handle | undefined)?.wide)
  const me = meOrNull()
  const account = me ? db.accounts.get(String(me.account_id)) : undefined

  // The person's appearance pins a theme on <html>.
  useLayoutEffect(() => {
    const p = theme(me?.appearance)
    document.documentElement.className = p.className ?? ""
  }, [me?.appearance])

  // Plain <a href> links navigate inside the app (no reload), except downloads, new tabs and /api files.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a")
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || !a.href) return
      const url = new URL(a.href, location.href)
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return  // same-page anchor
      e.preventDefault()
      navigate(url.pathname + url.search + url.hash)
    }
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); navigate("/goto") }
      else if (!typing && e.key === "?") navigate("/shortcuts")
    }
    document.addEventListener("click", onClick)
    document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey) }
  }, [navigate])

  // New page: scroll to its #hash (once it has rendered) or the top. A flash lives for the page it arrives on.
  useEffect(() => {
    const id = decodeURIComponent(loc.hash.slice(1))
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView())
    else window.scrollTo(0, 0)
    runInAction(() => {
      const f = state.flash
      if (f && f.at === undefined) state.flash = { ...f, at: loc.key }
      else if (f && f.at !== loc.key) state.flash = null
    })
  }, [loc.key])

  if (!state.ready) return null
  // Signed out, Home is the marketing page; anywhere else asks you to sign in and brings you back.
  if (!me && !handle.pub) return <Navigate to={loc.pathname === "/" ? "/marketing" : `/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  if (account && (account.status === "on_hold" || account.status === "cancelled") && !handle.pub && !ON_HOLD_OK.test(loc.pathname))
    return <Navigate to="/lockout" replace />
  if (handle.bare) return <Outlet />

  return (
    <div {...sx(s.body)}>
      <p id="offline" role="alert" hidden={state.online} {...sx(s.strip)}><b>You're offline.</b> You can keep reading. Quick changes wait here and sync when you reconnect.</p>
      <Header wide={wide} />
      <div {...sx(s.frame, wide && s.frameWide)}><Outlet /></div>
      {me && <InboxTray />}
    </div>
  )
})
