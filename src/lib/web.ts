// Request plumbing for the JSON API: who's acting, routing helpers, replies, errors.
// Every server route lives under /api. Pages are React (src/client); the server answers form posts with a Reply
// ({ redirect, flash, errors }) and carries the sync changes the post made, so the browser's copy is current
// before it navigates.
import { Cause, Data, Effect } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import type { Prefs } from "../shared/domain.ts"
import { changesFor } from "./sync.ts"

export { isAdmin, isClient, isQuiet, isOutOfOffice } from "../shared/domain.ts"
export type { Prefs }

export class NotFound extends Data.TaggedError("NotFound")<{}> {}
export class NoAccess extends Data.TaggedError("NoAccess")<{}> {}
export class Deleted extends Data.TaggedError("Deleted")<{}> {}

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
    /** The template agents start new projects from (areas/home.ts). */
    agent_template_id?: number
  }
  created_at: Date
}

export type Flash = { msg: string; href?: string; label?: string }

export interface PubCtx {
  readonly req: HttpServerRequest.HttpServerRequest
  readonly url: URL
  readonly params: Readonly<Record<string, string | undefined>>
  readonly query: URLSearchParams
  readonly me: Person | null
  readonly account: Account | null
  /** The agent acting as `me`, when the request came with its key (Authorization: Bearer). */
  readonly app?: AgentApp | null
  /** The parsed request body (urlencoded or multipart). Cached. */
  readonly form: Effect.Effect<FormData>
}
export type AgentApp = { id: number; name: string; scope: "full" | "read" }
export interface Ctx extends PubCtx {
  readonly me: Person
  readonly account: Account
}

// ---------- form helpers ----------
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim()
export const optStr = (fd: FormData, k: string) => str(fd, k) || null
export const ids = (fd: FormData, k: string) => fd.getAll(k).map(Number).filter((n) => Number.isInteger(n) && n > 0)
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true" || fd.get(k) === "1"
export const num = (v: string | null | undefined) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

// ---------- replies ----------
/**
 * What a form post answers. The browser applies `sync`, shows `flash`, then goes to `redirect`, or stays put when
 * `back` is set. `errors` (status 422) are shown above the form, which keeps what was typed.
 * `resync` makes the browser drop its copy and bootstrap again (switching who you are, signing in or out).
 */
export type Reply = {
  readonly _reply: true
  redirect?: string
  back?: boolean
  flash?: Flash
  errors?: string[]
  data?: unknown
  resync?: boolean
  status?: number
  cookies?: ReadonlyArray<readonly [name: string, value: string | null, opts?: CookieOpts]>
}
/** `maxAge` in seconds. Without it, the cookie lasts until the browser closes. */
export type CookieOpts = { httpOnly?: boolean; maxAge?: number }
const reply = (r: Omit<Reply, "_reply">): Reply => ({ _reply: true, ...r })
const toFlash = (f?: Flash | string) => (f === undefined ? undefined : typeof f === "string" ? { msg: f } : f)

/** Go to `to`, with an optional flash message. */
export const redirect = (to: string, flash?: Flash | string) => reply({ redirect: to, flash: toFlash(flash) })
/** Stay on the page the form was posted from (or go to `fallback` when there isn't one). */
export const back = (_c: PubCtx, fallback: string, flash?: Flash | string) => reply({ redirect: fallback, back: true, flash: toFlash(flash) })
/** Validation failed: show these above the form. */
export const invalid = (errors: ReadonlyArray<string>) => reply({ errors: [...errors], status: 422 })
/** Data for a page that isn't in the synced copy (history, the dev inbox, a public link…). */
export const json = (data: unknown) => reply({ data })
/** Set (or with null, expire) a cookie on a reply. */
export const withCookie = (r: Reply, name: string, value: string | null, opts?: CookieOpts): Reply => ({ ...r, cookies: [...(r.cookies ?? []), [name, value, opts]] })
/** Make the browser start over from a fresh bootstrap. */
export const resync = (r: Reply): Reply => ({ ...r, resync: true })

// ---------- who's acting ----------
/** `bun run dev` sets DEV=1: the `pid` cookie (act as anyone), the dev inbox and /dev routes. */
export const DEV = process.env.DEV === "1"

export const SESSION_DAYS = 30
export const hashToken = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex")

/** This app's address as the browser sees it. APP_URL wins (set it behind a proxy). */
export const origin = (req: HttpServerRequest.HttpServerRequest) =>
  process.env.APP_URL ?? `${req.headers["x-forwarded-proto"] ?? "http"}://${req.headers["x-forwarded-host"] ?? req.headers.host}`

/** An agent's key: who it works as, and the connection it came from. Unknown or expired keys are nobody. */
const loadAgent = (authorization: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<Person & { app_id: number; app_name: string; app_scope: "full" | "read"; app_used: Date | null }>`
      select p.*, a.id as app_id, a.name as app_name, a.scope as app_scope, a.last_used_at as app_used
      from agent_tokens t join connected_apps a on a.id = t.app_id join people p on p.id = a.person_id
      where t.token_hash = ${hashToken(authorization.replace(/^Bearer\s+/i, "").trim())} and t.kind = 'access'
        and (t.expires_at is null or t.expires_at > now()) and p.removed_at is null and p.joined_at is not null`
    if (!row) return { me: null, app: null }
    const { app_id, app_name, app_scope, app_used, ...me } = row
    // Once an hour is plenty for "last used", and spares the sync log a row per request.
    if (!app_used || Date.now() - new Date(app_used).getTime() > 3600_000) yield* sql`update connected_apps set last_used_at = now() where id = ${app_id}`
    return { me: me as Person, app: { id: app_id, name: app_name, scope: app_scope } as AgentApp }
  })

/**
 * Who's acting: an agent's key (Authorization: Bearer), else the `sid` session cookie. In dev, a `pid` cookie wins
 * over the session (scripts/smoke.ts acts as everyone that way). With neither, nobody: sign in, in dev too.
 */
export const loadMe = (cookies: Readonly<Record<string, string>>, authorization?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    let rows: ReadonlyArray<Person> = []
    let app: AgentApp | null = null
    if (authorization) {
      const a = yield* loadAgent(authorization)
      if (a.me) rows = [a.me]
      app = a.app
    } else if (DEV && cookies.pid) {
      if (cookies.pid === "out") return { me: null, account: null, app: null }  // signed out (POST /signout)
      rows = yield* sql<Person>`select * from people where id = ${num(cookies.pid) ?? 0} and removed_at is null and joined_at is not null`
    } else if (cookies.sid) {
      rows = yield* sql<Person>`
        update sessions s set last_seen_at = now() from people p
        where s.token_hash = ${hashToken(cookies.sid)} and s.verified and s.last_seen_at > now() - make_interval(days => ${SESSION_DAYS})
          and p.id = s.person_id and p.removed_at is null and p.joined_at is not null
        returning p.*`
    }
    const me = rows[0] ?? null
    if (!me) return { me: null, account: null, app: null }
    const [account] = yield* sql<Account>`select * from accounts where id = ${me.account_id}`
    return { me, account: account ?? null, app }
  })

/** Paths that keep working while an account is on hold or cancelled. Matches client/app.tsx. */
export const ON_HOLD_OK = /^\/(lockout|admin\/billing|admin\/export|inbox|dev|accounts|signin|signup|help|exports|bootstrap|sync)/

const ERRORS: Record<string, [status: number, msg: string]> = {
  NotFound: [404, "That doesn't exist, or it moved."],
  NoAccess: [403, "You don't have access to this."],
  Deleted: [410, "This was deleted."],
}

type Handler<C> = (c: C) => Effect.Effect<HttpServerResponse.HttpServerResponse | Reply, unknown, SqlClient.SqlClient>

const setCookies = (res: HttpServerResponse.HttpServerResponse, cookies: Reply["cookies"]) => {
  for (const [name, value, o] of cookies ?? [])
    res = value === null
      ? res.pipe(HttpServerResponse.expireCookieUnsafe(name, { path: "/" }))
      : res.pipe(HttpServerResponse.setCookieUnsafe(name, value, {
          path: "/", sameSite: "lax", secure: !DEV, httpOnly: o?.httpOnly, maxAge: o?.maxAge === undefined ? undefined : `${o.maxAge} seconds`,
        }))
  return res
}

const respond = (r: Reply, sync: unknown) => {
  const { _reply, cookies, status, ...body } = r
  return setCookies(HttpServerResponse.jsonUnsafe({ ...body, sync }, { status: status ?? 200 }), cookies)
}

/** A reply as a real 302, for GET routes the browser opens itself (Google sends people back to one). */
export const navigate = (r: Reply) => setCookies(HttpServerResponse.redirect(r.redirect ?? "/"), r.cookies)

/** The dev inbox (it shows sign-in links) and /dev routes exist only under `bun run dev`. */
const DEV_ONLY = /^\/(dev|inbox)(\/|$)/
/** What an agent can't do even as you: hand out keys, approve apps, or sign in and out. */
const NOT_FOR_AGENTS = /^\/(my\/agents|oauth|signin|signup|signout|accounts|auth)(\/|$)/

const wrap = <C extends PubCtx>(needsPerson: boolean, h: Handler<C>) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const params = yield* HttpRouter.params
    const url = new URL(req.url, "http://localhost")
    const { me, account, app } = yield* loadMe(req.cookies, req.headers.authorization)
    let body: Promise<FormData> | null = null
    const form = Effect.promise(() => (body ??= ((req.source as Request).formData() as unknown as Promise<FormData>).catch(() => new FormData())))
    const c: PubCtx = { req, url, params, query: url.searchParams, me, account, app, form }
    const path = url.pathname.replace(/^\/api/, "")

    if (!DEV && DEV_ONLY.test(path)) return respond(reply({ status: 404, data: { error: "NotFound" } }), null)
    if (req.headers.authorization && !me) return respond(reply({ status: 401, errors: ["That key doesn't work. It may have expired, or been disconnected."] }), null)
    if (app && NOT_FOR_AGENTS.test(path)) return respond(reply({ status: 403, errors: ["Agents can't do this. It needs you, signed in."] }), null)
    if (app?.scope === "read" && req.method !== "GET")
      return respond(reply({ status: 403, errors: ["This agent can only read. Reconnect it with full access to make changes."] }), null)
    if (needsPerson && !me) return respond(reply({ redirect: "/signin", status: 401 }), null)
    if (needsPerson && account && (account.status === "on_hold" || account.status === "cancelled") && !ON_HOLD_OK.test(path))
      return respond(reply({ redirect: "/lockout", status: 403 }), null)

    const out = yield* h(c as C).pipe(
      Effect.catchCause((cause) => {
        const e = Cause.squash(cause) as { _tag?: string; message?: string }
        const known = e?._tag ? ERRORS[e._tag] : undefined
        if (known) return Effect.succeed(reply({ status: known[0], errors: [known[1]], data: { error: e._tag } }))
        return Effect.logError(Cause.pretty(cause)).pipe(Effect.as(reply({ status: 500, errors: [`Something went wrong: ${String(e?.message ?? e)}`] })))
      }),
    )
    if (!("_reply" in out)) return out
    // Changes since the browser's copy, so a redirect to something just made finds it there.
    const cursor = req.headers["x-sync-cursor"]
    const sync = me && cursor !== undefined && !out.resync ? yield* changesFor(me, Number(cursor), req.headers["x-sync-epoch"] ?? "") : null
    return respond(out, sync)
  })

/** Routes for signed-in people, under /api. Handlers get `c.me` and `c.account`. */
export const get = (path: `/${string}`, h: Handler<Ctx>) => HttpRouter.route("GET", `/api${path}`, wrap(true, h))
export const post = (path: `/${string}`, h: Handler<Ctx>) => HttpRouter.route("POST", `/api${path}`, wrap(true, h))
/** Routes that work signed out (front door, emails, public links), under /api. */
export const pubGet = (path: `/${string}`, h: Handler<PubCtx>) => HttpRouter.route("GET", `/api${path}`, wrap(false, h))
export const pubPost = (path: `/${string}`, h: Handler<PubCtx>) => HttpRouter.route("POST", `/api${path}`, wrap(false, h))
