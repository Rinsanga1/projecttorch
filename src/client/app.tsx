// The app chrome, after kargul.studio: wordmark and pill nav on the gray ground, the page on a white sheet,
// the dev "acting as" bar as a dark slab at the bottom. Also: who may see which route (signed in, lockout),
// in-app navigation for plain <a href> links, scrolling to #hashes, the flash lifecycle, keyboard shortcuts.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { runInAction } from "mobx"
import { useEffect, useLayoutEffect } from "react"
import { Navigate, Outlet, useLocation, useMatches, useNavigate } from "react-router"
import { db, state } from "./store.ts"
import { meOrNull } from "./data.ts"
import { isQuiet } from "../shared/domain.ts"
import { sx, theme } from "./ui/kit.tsx"
import { Form, submitOwnForm } from "./ui/forms.tsx"
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
  wordmark: {
    fontSize: text.md, fontWeight: 750, letterSpacing: "-0.035em", color: color.ink, textDecoration: "none", whiteSpace: "nowrap",
  },
  // On a phone: wordmark and Find/Go to on one row, the main nav below as one row that scrolls sideways.
  nav: {
    display: "flex", alignItems: "center", gap: 2, marginInline: -6, flexGrow: 1,
    flexWrap: { default: "nowrap", [DESKTOP]: "wrap" }, overflowX: { default: "auto", [DESKTOP]: "visible" },
    order: { default: 3, [DESKTOP]: 0 }, flexBasis: { default: "100%", [DESKTOP]: "auto" }, scrollbarWidth: "none",
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
  footer: {
    backgroundColor: color.slab, color: color.slabMuted, fontSize: text.sm,
    borderTopLeftRadius: { default: radius.xl, [DESKTOP]: radius.slab }, borderTopRightRadius: { default: radius.xl, [DESKTOP]: radius.slab },
  },
  footerInner: {
    maxWidth: 1200, marginInline: "auto", paddingInline: { default: 20, [DESKTOP]: space.s6 }, paddingBlock: space.s6,
    display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4,
  },
  footerForm: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  footerLinks: { display: "flex", flexWrap: "wrap", columnGap: space.s4, rowGap: space.s1, margin: 0, maxWidth: "none" },
  footerLink: { color: color.slabInk, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  footerControl: {
    color: color.slabInk, borderColor: "transparent",
    backgroundColor: { default: color.slabTile, ":hover": { default: null, [media.hover]: `color-mix(in srgb, ${color.slabTile} 80%, white)` } },
  },
})

const NAV: ReadonlyArray<readonly [href: string, label: string]> = [
  ["/", "Home"], ["/timeline", "Timeline"], ["/chats", "Private chats"], ["/updates", "Updates"], ["/activity", "Activity"], ["/my", "Me"],
]
const isCurrent = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"))

/** Paths that keep working while an account is on hold or cancelled. Matches ON_HOLD_OK in src/lib/web.ts. */
const ON_HOLD_OK = /^\/(lockout|admin\/billing|admin\/export|inbox|dev|accounts|signin|signup|help|exports)/

const Header = observer(() => {
  const me = meOrNull()
  const path = useLocation().pathname
  const account = me ? db.accounts.get(String(me.account_id)) : undefined
  if (!me || !account) return <header {...sx(s.header)}><a href="/marketing" {...sx(s.wordmark)}>Saintsflow</a></header>
  const unread = { pings: 0, hey: 0 }
  for (const n of db.notifications.values()) if (n.person_id === me.id && !n.read_at) n.kind === "ping" ? unread.pings++ : unread.hey++
  const counts: Record<string, number> = { "/chats": unread.pings, "/updates": unread.hey }
  const link = (href: string, label: string, title?: string) => {
    const cur = isCurrent(path, href)
    const n = counts[href] ?? 0
    return (
      <a key={href} href={href} title={title} aria-current={cur ? "page" : undefined} aria-label={n ? `${label}, ${n} unread` : undefined} {...sx(s.link, cur && s.current)}>
        {label}{n > 0 && <span {...sx(s.count)} aria-hidden="true">{n}</span>}
      </a>
    )
  }
  return (
    <header {...sx(s.header)}>
      <a href="/" {...sx(s.wordmark)}>{account.name}</a>
      <nav aria-label="Main" {...sx(s.nav)}>{NAV.map(([h, l]) => link(h, l))}</nav>
      <div {...sx(s.navEnd)}>
        {isQuiet(me) && <a href="/my/quiet-hours" {...sx(s.quiet)}><span {...sx(s.dot, s.quietDot)} />Notifications paused</a>}
        {link("/find", "Find")}
        {link("/goto", "Go to", "Ctrl/⌘ + K")}
      </div>
    </header>
  )
})

const Footer = observer(() => {
  const me = meOrNull()
  if (!me) return null
  const people = [...db.people.values()].filter((p) => p.account_id === me.account_id && !p.removed_at && p.joined_at).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <footer {...sx(s.footer)}>
      <div {...sx(s.footerInner)}>
        <Form action="/dev/act-as" {...sx(s.footerForm)}>
          <label htmlFor="act-as">Acting as (no sign-in yet)</label>
          <select id="act-as" name="person_id" key={me.id} defaultValue={me.id} onChange={submitOwnForm} {...sx(s.footerControl)}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
          </select>
          <button {...sx(s.footerControl)}>Switch</button>
        </Form>
        <p {...sx(s.footerLinks)}>
          <a href="/accounts" {...sx(s.footerLink)}>Switch accounts</a>
          <a href="/inbox" {...sx(s.footerLink)}>Dev inbox (emails we'd send)</a>
          <a href="/shortcuts" {...sx(s.footerLink)}>Keyboard shortcuts</a>
          <a href="/help" {...sx(s.footerLink)}>Help</a>
        </p>
      </div>
    </footer>
  )
})

/** The root route: guards, chrome, and the behaviors every page shares. */
export const App = observer(() => {
  const loc = useLocation()
  const navigate = useNavigate()
  const handle = (useMatches().at(-1)?.handle ?? {}) as Handle
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
  if (!me && !handle.pub) return <Navigate to="/signin" replace />
  if (account && (account.status === "on_hold" || account.status === "cancelled") && !handle.pub && !ON_HOLD_OK.test(loc.pathname))
    return <Navigate to="/lockout" replace />
  if (handle.bare) return <Outlet />

  return (
    <div {...sx(s.body)}>
      <p id="offline" role="alert" hidden={state.online} {...sx(s.strip)}><b>You're offline.</b> You can keep reading. Quick changes wait here and sync when you reconnect.</p>
      <Header />
      <div {...sx(s.frame)}><Outlet /></div>
      <Footer />
    </div>
  )
})
