// Request plumbing: who's acting, routing helpers, the page layout, flash messages, errors.
import { Cause, Data, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import * as stylex from "@stylexjs/stylex"
import { html, raw, Raw, esc } from "./html.ts"
import { headTags, sx, theme } from "./ui.ts"
import { color, media, motion, radius, space, text } from "./tokens.stylex.ts"

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class NoAccess extends Data.TaggedError("NoAccess")<{}> {}
export class Deleted extends Data.TaggedError("Deleted")<{}> {}

export type Prefs = {
  notify_email?: boolean
  notify_desktop?: boolean
  notify_push?: boolean
  wcw?: { on?: boolean; days?: number[]; start?: string; end?: string }
  snooze_until?: string
  ooo?: { from?: string; until?: string; message?: string }
  recent_searches?: string[]
  two_factor?: boolean
  google?: boolean
  campfire_notify?: Record<string, "everything" | "mentions">
  recent_pages?: { href: string; title: string }[]
  recent_projects?: number[]
}

export type Person = {
  id: number
  account_id: number
  company_id: number | null
  name: string
  email: string
  title: string | null
  bio: string | null
  location: string | null
  time_zone: string
  avatar_url: string | null
  role: "owner" | "admin" | "member" | "client"
  appearance: string
  prefs: Prefs
  invited_by: number | null
  invite_token: string | null
  invited_at: Date | null
  joined_at: Date | null
  removed_at: Date | null
  created_at: Date
}

export type Account = {
  id: number
  name: string
  logo_url: string | null
  plan: string
  status: "trial" | "active" | "on_hold" | "cancelled"
  trial_ends_on: string | null
  cancelled_at: Date | null
  billing_email: string | null
  card_last4: string | null
  settings: {
    who_can_create_projects?: "everyone" | "admins"
    who_can_invite?: "everyone" | "admins"
    clients_can_ping?: boolean
    require_2fa?: boolean
  }
  created_at: Date
}

export type Flash = { msg: string; href?: string; label?: string }

export interface PubCtx {
  readonly req: HttpServerRequest.HttpServerRequest
  readonly url: URL
  readonly params: Readonly<Record<string, string | undefined>>
  readonly query: URLSearchParams
  readonly flash: Flash | null
  readonly me: Person | null
  readonly account: Account | null
  /** The parsed request body (urlencoded or multipart). Cached. */
  readonly form: Effect.Effect<FormData>
}
export interface Ctx extends PubCtx {
  readonly me: Person
  readonly account: Account
}

export const isAdmin = (p: Person) => p.role === "owner" || p.role === "admin"
export const isClient = (p: Person) => p.role === "client"

/** Quiet hours: true when notifications should be held for this person right now. */
export const isQuiet = (p: Person, now = new Date()) => {
  if (p.prefs.snooze_until && new Date(p.prefs.snooze_until) > now) return true
  const w = p.prefs.wcw
  if (!w?.on) return false
  const local = new Date(now.toLocaleString("en-US", { timeZone: p.time_zone }))
  const hhmm = local.toTimeString().slice(0, 5)
  const workDay = (w.days ?? [1, 2, 3, 4, 5]).includes(local.getDay())
  return !(workDay && hhmm >= (w.start ?? "09:00") && hhmm < (w.end ?? "17:00"))
}

export const isOutOfOffice = (p: Person, day = new Date().toISOString().slice(0, 10)) =>
  !!p.prefs.ooo?.until && (p.prefs.ooo.from ?? "") <= day && day <= p.prefs.ooo.until

// ---------- form helpers ----------
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim()
export const optStr = (fd: FormData, k: string) => str(fd, k) || null
export const ids = (fd: FormData, k: string) => fd.getAll(k).map(Number).filter((n) => Number.isInteger(n) && n > 0)
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1"
export const num = (v: string | null | undefined) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ---------- responses ----------
const FLASH = "flash"
export const redirect = (to: string, flash?: Flash | string) => {
  const r = HttpServerResponse.redirect(to, { status: 303 })
  if (!flash) return r
  const f = typeof flash === "string" ? { msg: flash } : flash
  return r.pipe(HttpServerResponse.setCookieUnsafe(FLASH, encodeURIComponent(JSON.stringify(f)), { path: "/" }))
}

/** Redirect back to where the form was posted from, or `fallback`. */
export const back = (c: PubCtx, fallback: string, flash?: Flash | string) => {
  const ref = c.req.headers["referer"]
  let to = fallback
  if (ref) {
    try { const u = new URL(ref); to = u.pathname + u.search + u.hash } catch {}
  }
  return redirect(to, flash)
}

export type Crumb = readonly [label: string, href: string]
export type PageOpts = { title: string; crumbs?: ReadonlyArray<Crumb>; status?: number }

// The app chrome, after kargul.studio: wordmark and pill nav on the gray ground, the page on a white sheet,
// the dev "acting as" bar as a dark slab at the bottom.
const DESKTOP = "@media (min-width: 768px)"
const chromeStyles = stylex.create({
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
  crumbs: {
    display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: 2, fontSize: text.sm,
    color: color.muted, paddingInline: { default: space.s2, [DESKTOP]: space.s1 }, paddingBottom: space.s3,
  },
  crumb: { color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } }, textDecoration: "none" },
  crumbSep: { color: color.control },
  flash: {
    display: "flex", alignItems: "center", gap: space.s2, width: "fit-content", maxWidth: "100%", marginInline: "auto",
    marginBottom: space.s3, paddingBlock: 8, paddingInline: space.s4, borderRadius: radius.pill, backgroundColor: color.sheet,
    fontSize: text.sm,
  },
  sheet: {
    backgroundColor: color.sheet, borderRadius: { default: radius.lg, [DESKTOP]: radius.xl },
    paddingBlock: { default: space.s5, [DESKTOP]: 40 }, paddingInline: { default: 20, [DESKTOP]: space.s7 }, minHeight: 280,
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

/** Wrap a body in the app chrome: top nav, breadcrumb, flash, acting-as switcher. */
export const page = (c: PubCtx, opts: PageOpts, body: Raw) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const s = chromeStyles
    let chrome = raw("")
    let footer = raw("")
    if (c.me && c.account) {
      const me = c.me
      const [counts] = yield* sql<{ hey: number; pings: number }>`
        select count(*) filter (where kind <> 'ping')::int as hey, count(*) filter (where kind = 'ping')::int as pings
        from notifications where person_id = ${me.id} and read_at is null`
      const people = yield* sql<{ id: number; name: string; role: string }>`
        select id, name, role from people where account_id = ${me.account_id} and removed_at is null and joined_at is not null order by name`
      const unread: Record<string, number> = { "/chats": counts!.pings, "/updates": counts!.hey }
      const path = c.url.pathname
      const link = (href: string, label: string, extra?: Raw | string) => {
        const cur = isCurrent(path, href)
        const n = unread[href] ?? 0
        return html`<a href="${href}"${cur ? raw(' aria-current="page"') : ""}${n ? raw(` aria-label="${esc(label)}, ${n} unread"`) : ""}${sx(s.link, cur && s.current)}>${label}${n ? html`<span${sx(s.count)} aria-hidden="true">${n}</span>` : ""}${extra ?? ""}</a>`
      }
      chrome = html`
<header${sx(s.header)}>
  <a href="/"${sx(s.wordmark)}>${c.account.name}</a>
  <nav aria-label="Main"${sx(s.nav)}>
    ${NAV.map(([h, l]) => link(h, l))}
  </nav>
  <div${sx(s.navEnd)}>
    ${isQuiet(me) ? html`<a href="/my/quiet-hours"${sx(s.quiet)}><span${sx(s.dot, s.quietDot)}></span>Notifications paused</a>` : ""}
    ${link("/find", "Find")}
    <a href="/goto" title="Ctrl/⌘ + K"${path === "/goto" ? raw(' aria-current="page"') : ""}${sx(s.link, path === "/goto" && s.current)}>Go to</a>
  </div>
</header>`
      footer = html`
<footer${sx(s.footer)}>
  <div${sx(s.footerInner)}>
    <form method="post" action="/dev/act-as"${sx(s.footerForm)}>
      <label for="act-as">Acting as (no sign-in yet)</label>
      <select id="act-as" name="person_id" onchange="this.form.submit()"${sx(s.footerControl)}>
        ${people.map((p) => html`<option value="${p.id}"${p.id === me.id ? raw(" selected") : ""}>${p.name} (${p.role})</option>`)}
      </select>
      <button${sx(s.footerControl)}>Switch</button>
    </form>
    <p${sx(s.footerLinks)}>
      <a href="/accounts"${sx(s.footerLink)}>Switch accounts</a>
      <a href="/inbox"${sx(s.footerLink)}>Dev inbox (emails we'd send)</a>
      <a href="/shortcuts"${sx(s.footerLink)}>Keyboard shortcuts</a>
      <a href="/help"${sx(s.footerLink)}>Help</a>
    </p>
  </div>
</footer>`
    } else chrome = html`<header${sx(s.header)}><a href="/marketing"${sx(s.wordmark)}>Saintsflow</a></header>`
    const flash = c.flash
      ? html`<p role="status" data-flash${sx(s.flash)}><span${sx(s.dot)}></span><b>${c.flash.msg}</b>${c.flash.href ? html` <a href="${c.flash.href}">${c.flash.label ?? "Go there"}</a>` : ""}</p>`
      : ""
    const crumbs = opts.crumbs?.length
      ? html`<nav aria-label="Breadcrumb"${sx(s.crumbs)}>${opts.crumbs.map(([l, h], i) => html`${i ? html`<span aria-hidden="true"${sx(s.crumbSep)}>/</span>` : ""}<a href="${h}"${sx(s.crumb)}>${l}</a>`)}</nav>`
      : ""
    const doc = html`<!doctype html>
<html lang="en"${theme(c.me?.appearance)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title} · Saintsflow</title>
${headTags()}
</head>
<body${sx(s.body)}>
<p id="offline" role="alert" hidden${sx(s.strip)}><b>You're offline.</b> We'll reconnect as soon as we can. Anything you've typed stays put.</p>
${chrome}
<div${sx(s.frame)}>
${crumbs}
${flash}
<main${sx(s.sheet)}>
${body}
</main>
</div>
${footer}
<script>
addEventListener("offline", () => document.getElementById("offline").hidden = false)
addEventListener("online", () => document.getElementById("offline").hidden = true)
document.addEventListener("keydown", e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? "")
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); location.href = "/goto" }
  else if (!typing && e.key === "?") location.href = "/shortcuts"
})
</script>
</body>
</html>`
    return HttpServerResponse.text(doc.s, { status: opts.status ?? 200, contentType: "text/html; charset=utf-8" })
  })

// ---------- who's acting ----------
// ponytail: no auth. The `pid` cookie says who you are; the footer switcher sets it. Real sessions go here later.
const loadMe = (cookies: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (cookies.pid === "out") return { me: null, account: null }  // signed out (POST /signout)
    const pid = Number(cookies.pid)
    const rows = yield* sql<Person>`
      select * from people
      where removed_at is null and joined_at is not null ${Number.isInteger(pid) && pid > 0 ? sql`and id = ${pid}` : sql``}
      order by id limit 1`
    const me = rows[0] ?? null
    if (!me) return { me: null, account: null }
    const [account] = yield* sql<Account>`select * from accounts where id = ${me.account_id}`
    return { me, account: account ?? null }
  })

const ON_HOLD_OK = /^\/(lockout|admin\/billing|admin\/export|inbox|dev|accounts|signin|signup|help|exports)/

// Errors render as their breadboard "Edges" pages.
const errorPage = (c: PubCtx, cause: Cause.Cause<unknown>) => {
  const e = Cause.squash(cause) as { _tag?: string }
  const home = html`<p><a href="/">Go to Home</a></p>`
  if (e?._tag === "NotFound")
    return page(c, { title: "Page not found", status: 404 }, html`<h1>Page not found</h1><p>That page doesn't exist, or it moved.</p>${home}`)
  if (e?._tag === "NoAccess")
    return page(c, { title: "No access", status: 403 }, html`<h1>No access</h1><p>You don't have access to this. Ask someone on the project to add you.</p>${home}`)
  if (e?._tag === "Deleted")
    return page(c, { title: "Deleted", status: 410 }, html`<h1>Deleted forever</h1><p>This was deleted. It was in the trash for 30 days and is gone for good.</p>${home}`)
  return Effect.gen(function* () {
    yield* Effect.logError(Cause.pretty(cause))
    return yield* page(c, { title: "Something went wrong", status: 500 }, html`<h1>Something went wrong</h1><pre>${String((e as any)?.message ?? e)}</pre>${home}`)
  })
}

type Handler<C> = (c: C) => Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, SqlClient.SqlClient>

const wrap = <C extends PubCtx>(needsPerson: boolean, h: Handler<C>) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const url = new URL(req.url, "http://localhost")
    const { me, account } = yield* loadMe(req.cookies)
    let flash: Flash | null = null
    try { if (req.cookies[FLASH]) flash = JSON.parse(decodeURIComponent(req.cookies[FLASH])) } catch {}
    let body: Promise<FormData> | null = null
    const form = Effect.promise(() => (body ??= ((req.source as Request).formData() as unknown as Promise<FormData>).catch(() => new FormData())))
    const c: PubCtx = { req, url, params, query: url.searchParams, flash, me, account, form }

    if (needsPerson && !me) return redirect("/signin")
    if (needsPerson && account && (account.status === "on_hold" || account.status === "cancelled") && !ON_HOLD_OK.test(url.pathname))
      return redirect("/lockout")

    let res = yield* h(c as C).pipe(Effect.catchCause((cause) => errorPage(c, cause)))
    if (flash && res.status < 300) res = res.pipe(HttpServerResponse.expireCookieUnsafe(FLASH, { path: "/" }))
    return res
  })

/** Routes for signed-in people. Handlers get `c.me` and `c.account`. */
export const get = (path: `/${string}`, h: Handler<Ctx>) => HttpRouter.route("GET", path, wrap(true, h))
export const post = (path: `/${string}`, h: Handler<Ctx>) => HttpRouter.route("POST", path, wrap(true, h))
/** Routes that work signed out (front door, emails, public links). */
export const pubGet = (path: `/${string}`, h: Handler<PubCtx>) => HttpRouter.route("GET", path, wrap(false, h))
export const pubPost = (path: `/${string}`, h: Handler<PubCtx>) => HttpRouter.route("POST", path, wrap(false, h))

/** Shorthand: render a page. */
export const render = (c: PubCtx, title: string, body: Raw, crumbs?: ReadonlyArray<Crumb>, status?: number) =>
  page(c, { title, crumbs, status }, body)

/** Validation errors shown at the top of a re-rendered form. */
export const errors = (list: ReadonlyArray<string>) =>
  list.length ? html`<div role="alert"><p><b>Please fix:</b></p><ul>${list.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""

export { esc }
