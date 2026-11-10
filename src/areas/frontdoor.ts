// The front door: sign up, first run, sign in (password, emailed link, Google), forgot/reset password,
// two-step verification, accepting an invitation, the account chooser, account on hold, sign out.
// Pages: client/areas/frontdoor.tsx. This file is what their forms post to, plus lookups signed-out pages need.
//
//   GET  /auth/options               what the signed-out pages can offer (is Google on?)
//   GET  /auth/google                off to Google          GET /auth/google/callback   and back
//   POST /signup                     new account, and you as its owner
//   POST /welcome                    first run: your first project
//   GET  /signin?email=              does this email have an account? (the email-first sign-in page asks)
//   POST /signin                     email + password
//   POST /signin/link                email me a sign-in link     POST /signin/link/:token   use it
//   POST /forgot                     email me a reset link       GET|POST /reset/:token      use it
//   POST /signin/verify              the two-step code
//   GET|POST /join/:token            an invitation, or a team link
//   GET|POST /accounts               the account chooser
//   POST /signout
//
// Signing in starts a session (`sessions`, the `sid` cookie; see loadMe in lib/web.ts). Passwords and Google ids live
// in `logins`, one per email address, so one login opens every account that address is in. That's why every way of
// setting a password checks first whether the address already has a login: if it does, it has to be them.
//
// Jobs, every minute: trials that ran out go on hold; old sessions are cleared.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, pubGet, pubPost, redirect, invalid, json, withCookie, resync, navigate, hashToken, origin, str, num, DEV, SESSION_DAYS, type Ctx, type PubCtx, type Person, type Account, type Reply } from "../lib/web.ts"
import { logEvent, sendEmail, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const EMAIL          = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const LINK_MINUTES   = 15
const RESET_HOURS    = 2
const VERIFY_MINUTES = 10
const MIN_PASSWORD   = 8

const UNKNOWN_EMAIL     = "We don't know that email address. Check for typos, or sign up."
const GOOGLE_EXPIRED    = "Your Google sign-in timed out. Try the Google button again."
const SHORT_PASSWORD    = "Pick a longer password. At least 8 characters."
const EXISTING_LOGIN    = "You already have a ProjectTorch login with this email. Use that password, or join with Google."

type Login    = { email: string; password_hash: string | null; google_sub: string | null }
type GoogleId = { sub: string; email: string; name: string }

const randomToken = () => randomBytes(32).toString("base64url")

/** A page in this app to go back to after signing in (`next`), or null for anything else (//elsewhere.com included). */
const safeNext = (s: string | null | undefined) => (s && /^\/(?![/\\])/.test(s) ? s : null)

const validTz = (tz: string) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz || null } catch { return null }
}

// ─── Sessions ──────────────────────────────────────────────────────────────

/** A new session for this person: a random token in the `sid` cookie, its hash in `sessions`. Drops the dev `pid`. */
const startSession = (r: Reply, personId: number, verified = true) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const token = randomToken()
  yield* sql`insert into sessions ${sql.insert({ token_hash: hashToken(token), person_id: personId, verified })}`
  return withCookie(withCookie(r, "sid", token, { httpOnly: true, maxAge: SESSION_DAYS * 86400 }), "pid", null)
})

/** End this browser's session, if it has one. */
const endSession = (c: PubCtx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  if (c.req.cookies.sid) yield* sql`delete from sessions where token_hash = ${hashToken(c.req.cookies.sid)}`
})

/** Become this person: a fresh session, and the browser drops its copy and bootstraps as them. */
const signInAs = (c: PubCtx, to: string, personId: number, flash?: string) => Effect.gen(function* () {
  yield* endSession(c)
  return resync(yield* startSession(redirect(to, flash), personId))
})

/** After signing in: the two-step check if they use it, then `next`, or the account chooser if they're in several. */
const finishSignIn = (c: PubCtx, person: Person, accounts: number, next?: string | null) => Effect.gen(function* () {
  if (person.prefs.two_factor) {
    // An unverified session: loadMe ignores it until /signin/verify marks it verified.
    yield* endSession(c)
    const verify = `/signin/verify${next ? `?next=${encodeURIComponent(next)}` : ""}`
    return yield* startSession(redirect(verify), person.id, false)
  }
  return yield* signInAs(c, next ?? (accounts > 1 ? "/accounts" : "/"), person.id)
})

// ─── Logins (one per email address) ────────────────────────────────────────

export const loginFor = (email: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return (yield* sql<Login>`select * from logins where email = lower(${email})`)[0] ?? null
})

export const setPassword = (email: string, password: string) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const hash = yield* Effect.promise(() => Bun.password.hash(password))
  yield* sql`insert into logins (email, password_hash) values (lower(${email}), ${hash})
             on conflict (email) do update set password_hash = excluded.password_hash`
})

// ponytail: no attempt limit; argon2 is slow enough to start. Lock out after N misses if anyone hammers it.
export const checkPassword = (email: string, password: string) => Effect.gen(function* () {
  const login = yield* loginFor(email)
  if (!login?.password_hash || !password) return false
  return yield* Effect.promise(() => Bun.password.verify(password, login.password_hash!))
})

const setGoogle = (email: string, sub: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`insert into logins (email, google_sub) values (lower(${email}), ${sub})
             on conflict (email) do update set google_sub = coalesce(logins.google_sub, excluded.google_sub)`
})

/**
 * Give this address a way to sign in, for sign-up and joining: Google if they came with it, else a password.
 * If the address already has a password login (from another account), it has to be them: that password, not a new one.
 * Returns an error message, or null when it's done.
 */
const claimLogin = (email: string, password: string, google: GoogleId | null) => Effect.gen(function* () {
  if (google) {
    yield* setGoogle(email, google.sub)
    return null
  }
  if (yield* loginFor(email)) {
    if (!(yield* checkPassword(email, password))) return EXISTING_LOGIN
    return null
  }
  yield* setPassword(email, password)
  return null
})

// ─── Google ────────────────────────────────────────────────────────────────
// The authorization-code flow, by hand: send people to Google, swap the code for an ID token, read their verified email.
// Google is on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set; otherwise its buttons don't show.

const GOOGLE = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
  : null

const callbackUrl = (c: PubCtx) => `${origin(c.req)}/api/auth/google/callback`

const googleIdentity = async (code: string, redirectUri: string): Promise<GoogleId | null> => {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body:   new URLSearchParams({ code, client_id: GOOGLE!.id, client_secret: GOOGLE!.secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })
  if (!res.ok) return null

  // Straight from Google over TLS, so its signature needn't be checked (Google's own guidance for this flow).
  const { id_token } = (await res.json()) as { id_token?: string }
  const p = JSON.parse(Buffer.from(id_token?.split(".")[1] ?? "", "base64url").toString() || "null")
  if (p?.aud !== GOOGLE!.id || !p.email_verified || !p.sub || !p.email) return null
  return { sub: p.sub, email: String(p.email).toLowerCase(), name: p.name ?? "" }
}

// Who Google said you are, carried to the sign-up or join form in a signed cookie that lasts 15 minutes.
const sign = (d: string) => createHmac("sha256", GOOGLE!.secret).update(d).digest("base64url")

const sealGoogle = (g: GoogleId) => {
  const d = Buffer.from(JSON.stringify({ ...g, exp: Date.now() + 15 * 60_000 })).toString("base64url")
  return `${d}.${sign(d)}`
}

const openGoogle = (c: PubCtx): GoogleId | null => {
  const [d, sig] = (c.req.cookies.google ?? "").split(".")
  if (!GOOGLE || !d || !sig) return null
  const want = Buffer.from(sign(d)), got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const g = JSON.parse(Buffer.from(d, "base64url").toString())
  return g.exp > Date.now() ? { sub: g.sub, email: g.email, name: g.name } : null
}

const withGoogle = (r: Reply, g: GoogleId) => withCookie(r, "google", sealGoogle(g), { httpOnly: true, maxAge: 15 * 60 })

/** The form says it came with Google: who Google said, or "expired" when the cookie ran out. */
const googleFromForm = (c: PubCtx, fd: FormData): GoogleId | null | "expired" => {
  if (fd.get("google") !== "1") return null
  return openGoogle(c) ?? "expired"
}

// ─── Lookups ───────────────────────────────────────────────────────────────

/** Joined, active people with this email, one per account. */
const peopleByEmail = (email: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<Person & { account_name: string; logo_url: string | null }>`
    select p.*, a.name as account_name, a.logo_url from people p join accounts a on a.id = p.account_id
    where lower(p.email) = lower(${email}) and p.removed_at is null and p.joined_at is not null order by a.name`
})

const setPrefs = (personId: number, prefs: Record<string, unknown>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update people set prefs = prefs || ${JSON.stringify(prefs)}::jsonb where id = ${personId}`
})

/** The person a reset link is for, while it's fresh. */
const resetPerson = (token: string | undefined) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [p] = yield* sql<Person>`select * from people where prefs->>'reset_token' = ${token ?? ""} and removed_at is null`
  const at  = (p?.prefs as any)?.reset_token_at
  if (!p || !at || Date.now() - Date.parse(at) >= RESET_HOURS * 3600_000) return null
  return p
})

type Invitation =
  | { state: "open"; person: Person; account: Account; inviter: string | null }
  | { state: "used"; account: Account | null; email: string }
  | { state: "gone" }

const invitation = (token: string | undefined) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const t   = token ?? ""

  const [person] = yield* sql<Person & { inviter: string | null }>`
    select p.*, i.name as inviter from people p left join people i on i.id = p.invited_by where p.invite_token = ${t} and p.removed_at is null`
  if (person) {
    const [account] = yield* sql<Account>`select * from accounts where id = ${person.account_id}`
    return { state: "open", person, account: account!, inviter: person.inviter } as Invitation
  }

  const [used] = yield* sql<Person>`select * from people where prefs->>'used_invite_token' = ${t}`
  if (used) {
    const [account] = yield* sql<Account>`select * from accounts where id = ${used.account_id}`
    return { state: "used", account: account ?? null, email: used.email } as Invitation
  }

  return { state: "gone" } as Invitation
})

/** The account whose team link this is, while it's open for business. */
const teamAccount = (code: string | undefined) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return (yield* sql<Account>`select * from accounts where join_code = ${code ?? ""} and status in ('active', 'trial')`)[0] ?? null
})

// ─── Google sign-in ────────────────────────────────────────────────────────

const authOptions = pubGet("/auth/options", () => Effect.succeed(json({ google: !!GOOGLE })))

// `then` is where it leads on the way back: signin, signup, or join:<invitation token>.
// `next` is the page to land on after signing in. Both ride in the state cookie.
const toGoogle = pubGet("/auth/google", (c) => Effect.sync(() => {
  if (!GOOGLE) return navigate(redirect("/signin"))

  const then  = c.query.get("then") ?? ""
  const state = randomToken()
  const q = new URLSearchParams({
    client_id:     GOOGLE.id,
    redirect_uri:  callbackUrl(c),
    response_type: "code",
    scope:         "openid email profile",
    state,
    prompt:        "select_account",
  })
  const carry  = { then: /^(signup|join:.+)$/.test(then) ? then : "signin", next: safeNext(c.query.get("next")) }
  const cookie = `${state}.${Buffer.from(JSON.stringify(carry)).toString("base64url")}`
  return navigate(withCookie(redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`), "google_state", cookie, { httpOnly: true, maxAge: 600 }))
}))

// Google sends people back here: sign them in, or carry who they are to the sign-up or join form.
const fromGoogle = pubGet("/auth/google/callback", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [state, carried = ""] = (c.req.cookies.google_state ?? "").split(".")
  let carry: { then?: string; next?: string | null } = {}
  try { carry = JSON.parse(Buffer.from(carried, "base64url").toString()) } catch {}
  const then = carry.then ?? "signin"
  const next = carry.next ?? null
  const go   = (r: Reply) => navigate(withCookie(r, "google_state", null))

  // No code means they backed out on Google's side. A state that doesn't match isn't our request.
  const code = c.query.get("code")
  if (!GOOGLE || !state || c.query.get("state") !== state || !code) return go(redirect("/signin"))
  const g = yield* Effect.promise(() => googleIdentity(code, callbackUrl(c)).catch(() => null))
  if (!g) return go(redirect("/signin"))

  if (then.startsWith("join:")) return go(withGoogle(redirect(`/join/${encodeURIComponent(then.slice(5))}?google=1`), g))

  // A login that already uses this Google account, or failing that, one for its (verified) address.
  const [login] = yield* sql<Login>`select * from logins where google_sub = ${g.sub} or email = ${g.email}
                                    order by (google_sub = ${g.sub}) desc nulls last limit 1`
  if (login && !login.google_sub) yield* setGoogle(login.email, g.sub)

  const people = yield* peopleByEmail(login?.email ?? g.email)
  if (people.length) return go(yield* finishSignIn(c, people[0]!, people.length, safeNext(next)))

  // New here: the sign-up form, with name and email from Google.
  return go(withGoogle(redirect(`/signup?${new URLSearchParams({ google: "1", name: g.name, email: g.email })}`), g))
}))

// ─── Sign up and first run ─────────────────────────────────────────────────

const signUp = pubPost("/signup", (c) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const fd     = yield* c.form
  const google = googleFromForm(c, fd)
  if (google === "expired") return invalid([GOOGLE_EXPIRED])

  const name     = str(fd, "name")
  const email    = google?.email ?? str(fd, "email").toLowerCase()
  const company  = str(fd, "company")
  const password = str(fd, "password")

  const errors: string[] = []
  if (!name)                                     errors.push("Tell us your name.")
  if (!EMAIL.test(email))                        errors.push("That doesn't look like an email address.")
  if (!company)                                  errors.push("Give your company or team a name.")
  if (!google && password.length < MIN_PASSWORD) errors.push(SHORT_PASSWORD)
  if (!errors.length && (yield* peopleByEmail(email)).length) errors.push("That email is already on an account. Sign in instead?")
  if (errors.length) return invalid(errors)

  // One transaction: the account, its company, you, and your login, or none of them.
  const result = yield* sql.withTransaction(Effect.gen(function* () {
    const problem = yield* claimLogin(email, password, google)
    if (problem) return { problem }

    const [account] = yield* sql<Account>`insert into accounts ${sql.insert({
      // In beta, free: no trial to run out. (The on-hold job below still handles trials, for when there are prices.)
      name:          company,
      status:        "active",
      billing_email: email,
      settings:      JSON.stringify({ who_can_create_projects: "everyone", who_can_invite: "everyone", clients_can_ping: false }),
    })} returning *`
    const [team] = yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: account!.id, name: company })} returning id`
    const [me]   = yield* sql<Person>`insert into people ${sql.insert({
      account_id: account!.id,
      company_id: team!.id,
      name,
      email,
      role:       "owner",
      joined_at:  new Date(),
      prefs:      JSON.stringify({ notify_email: true, google: !!google }),
    })} returning *`
    return { account: account!, me: me! }
  }))
  if ("problem" in result) return invalid([result.problem!])

  // No sample project: a new account starts empty (a company-wide project is one people make), and ready-made projects come from Templates.
  const ctx: Ctx = { ...c, me: result.me, account: result.account }
  yield* logEvent(ctx, { project_id: null, action: "created", summary: `started the ${company} account` })
  return withCookie(yield* signInAs(c, "/welcome", result.me.id), "google", null)
}))

const firstProject = post("/welcome", (c) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const name = str(yield* c.form, "name")
  if (!name) return redirect("/welcome", "Your project needs a name.")

  const [p] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: c.me.account_id, name, created_by: c.me.id })} returning *`
  yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${c.me.id})`
  yield* logEvent(c, { project_id: p!.id, action: "created", summary: `started the project ${name}` })
  return redirect(`/projects/${p!.id}`)
}))

// ─── Sign in: email first, then a password, an emailed link, or Google ─────

// The sign-in page asks before showing the password step. (So this does say whether an address has an account.)
const isKnownEmail = pubGet("/signin", (c) => Effect.gen(function* () {
  const people = yield* peopleByEmail((c.query.get("email") ?? "").trim())
  return json({ known: people.length > 0 })
}))

const signIn = pubPost("/signin", (c) => Effect.gen(function* () {
  const fd     = yield* c.form
  const email  = str(fd, "email")
  const people = yield* peopleByEmail(email)
  if (!people.length) return invalid([UNKNOWN_EMAIL])
  if (!(yield* checkPassword(email, str(fd, "password")))) return invalid(["That email and password don't match. Try again, or we can email you a sign-in link."])

  return yield* finishSignIn(c, people[0]!, people.length, safeNext(str(fd, "next")))
}))

const sendSignInLink = pubPost("/signin/link", (c) => Effect.gen(function* () {
  const email    = str(yield* c.form, "email")
  const [person] = yield* peopleByEmail(email)

  if (person) {
    const token = crypto.randomUUID()
    yield* setPrefs(person.id, { signin_token: token, signin_token_at: new Date().toISOString() })
    yield* sendEmail(person, {
      subject: "Your sign-in link",
      kind:    "signin",
      link:    `/signin/link/${token}`,
      body:    `Here's your link to sign in. It works once and expires in ${LINK_MINUTES} minutes.\n\nIf you didn't ask for this, ignore it. Nobody can sign in without this link.`,
    }, true)
  }
  // Same answer either way.
  return redirect(`/signin/link-sent?email=${encodeURIComponent(email)}`)
}))

// Was a GET: opening the emailed link signs you in. The page posts here when it opens. Works once.
const useSignInLink = pubPost("/signin/link/:token", (c) => Effect.gen(function* () {
  const sql      = yield* SqlClient.SqlClient
  const [person] = yield* sql<Person>`select * from people where prefs->>'signin_token' = ${c.params.token ?? ""} and removed_at is null`
  const at       = (person?.prefs as any)?.signin_token_at
  if (!person || !at || Date.now() - Date.parse(at) > LINK_MINUTES * 60_000) return json({ expired: true })

  yield* setPrefs(person.id, { signin_token: null, signin_token_at: null })
  return yield* finishSignIn(c, person, (yield* peopleByEmail(person.email)).length)
}))

// ─── Forgot / reset password ───────────────────────────────────────────────

const forgotPassword = pubPost("/forgot", (c) => Effect.gen(function* () {
  const email    = str(yield* c.form, "email")
  const [person] = yield* peopleByEmail(email)

  if (person) {
    const token = crypto.randomUUID()
    yield* setPrefs(person.id, { reset_token: token, reset_token_at: new Date().toISOString() })
    yield* sendEmail(person, {
      subject: "Reset your password",
      kind:    "reset",
      link:    `/reset/${token}`,
      body:    `Someone (hopefully you) asked to reset your password. This link works for ${RESET_HOURS} hours.\n\nIf it wasn't you, ignore this email. Your password won't change.`,
    }, true)
  }
  return redirect(`/forgot?sent=1&email=${encodeURIComponent(email)}`)
}))

const checkResetLink = pubGet("/reset/:token", (c) => Effect.gen(function* () {
  return json({ ok: !!(yield* resetPerson(c.params.token)) })
}))

// A new password signs you out everywhere else: whoever had a session (and maybe the old password) is out.
const resetPassword = pubPost("/reset/:token", (c) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const person = yield* resetPerson(c.params.token)
  if (!person) return invalid(["This reset link has expired."])

  const password = str(yield* c.form, "password")
  if (password.length < MIN_PASSWORD) return invalid([SHORT_PASSWORD])

  yield* setPassword(person.email, password)
  yield* setPrefs(person.id, { reset_token: null, reset_token_at: null })
  // The login is the email's, so every account with this address loses its sessions.
  yield* sql`delete from sessions where person_id in (select id from people where lower(email) = lower(${person.email}))`

  const accounts = (yield* peopleByEmail(person.email)).length
  return yield* signInAs(c, accounts > 1 ? "/accounts" : "/", person.id, "Password saved. You're signed in.")
}))

// ─── Two-step verification ─────────────────────────────────────────────────

// Signing in left an unverified session; a good code verifies it.
const verifyTwoStep = pubPost("/signin/verify", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const sid = c.req.cookies.sid ?? ""
  const [pending] = yield* sql<{ person_id: number }>`select person_id from sessions
                                                      where token_hash = ${hashToken(sid)} and not verified
                                                        and created_at > now() - make_interval(mins => ${VERIFY_MINUTES})`
  if (!pending) return redirect("/signin", "That took too long. Sign in again.")

  const fd     = yield* c.form
  const backup = fd.get("backup") === "1"
  const code   = str(fd, "code").replace(/\s/g, "")
  // ponytail: any well-formed code passes. Real TOTP check goes here; the password already had to be right.
  if (backup  && !/^[a-z0-9-]{8,}$/i.test(code)) return invalid(["That backup code didn't work. Each one works once."])
  if (!backup && !/^\d{6}$/.test(code))          return invalid(["That code didn't work. Codes change every 30 seconds, so try the newest one."])

  const [person] = yield* sql<Person>`select * from people where id = ${pending.person_id} and removed_at is null`
  if (!person) return redirect("/signin")

  yield* sql`update sessions set verified = true, last_seen_at = now() where token_hash = ${hashToken(sid)}`
  const accounts = (yield* peopleByEmail(person.email)).length
  return resync(redirect(safeNext(str(fd, "next")) ?? (accounts > 1 ? "/accounts" : "/")))
}))

// ─── Invitations and the team link ─────────────────────────────────────────
// /join/:token is either a person's invitation or an account's team link (accounts.join_code).

const showJoin = pubGet("/join/:token", (c) => Effect.gen(function* () {
  const inv  = yield* invitation(c.params.token)
  const team = inv.state === "gone" ? yield* teamAccount(c.params.token) : null

  if (team) {
    const g = openGoogle(c)
    return json({ state: "team", account: team.name, already_in: c.me?.account_id === team.id, email: g?.email ?? c.me?.email ?? "", name: g?.name ?? "", google: g?.email ?? null })
  }
  if (inv.state === "open")
    return json({ state: "open", account: inv.account.name, inviter: inv.inviter, name: inv.person.name, email: inv.person.email, time_zone: inv.person.time_zone, google: openGoogle(c)?.email ?? null })
  if (inv.state === "used")
    return json({ state: "used", account: inv.account?.name ?? null, email: inv.email })
  return json({ state: "gone" })
}))

const join = pubPost("/join/:token", (c) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const inv  = yield* invitation(c.params.token)
  const team = inv.state === "gone" ? yield* teamAccount(c.params.token) : null
  if (team) return yield* joinTeam(c, team)
  if (inv.state === "used") return invalid(["This invitation was already used."])
  if (inv.state !== "open") return invalid(["This invitation was cancelled."])

  const fd     = yield* c.form
  const google = googleFromForm(c, fd)
  if (google === "expired") return invalid([GOOGLE_EXPIRED])

  const name     = str(fd, "name")
  const password = str(fd, "password")
  const errors: string[] = []
  if (!name)                                     errors.push("Tell us your name.")
  if (!google && password.length < MIN_PASSWORD) errors.push(SHORT_PASSWORD)
  if (errors.length) return invalid(errors)

  // The invitation is for one address; Google has to agree.
  const email = inv.person.email
  if (google && google.email !== email.toLowerCase())
    return invalid([`Google signed you in as ${google.email}, but this invitation is for ${email}. Use a password, or pick that Google account.`])
  const problem = yield* claimLogin(email, password, google)
  if (problem) return invalid([problem])

  const timeZone = validTz(str(fd, "time_zone")) ?? inv.person.time_zone
  yield* sql`update people set name = ${name}, time_zone = ${timeZone}, joined_at = now(), invite_token = null,
             prefs = prefs || ${JSON.stringify({ used_invite_token: c.params.token, google: !!google })}::jsonb
             where id = ${inv.person.id}`

  // Land on the first project they were invited to.
  const [first] = yield* sql<{ project_id: number }>`select pp.project_id from project_people pp join projects p on p.id = pp.project_id
                                                     where pp.person_id = ${inv.person.id} and p.status = 'active' order by pp.added_at limit 1`
  const landing = first ? `/projects/${first.project_id}` : "/"
  return withCookie(yield* signInAs(c, landing, inv.person.id, `Welcome to ${inv.account.name}!`), "google", null)
}))

/** Join through the team link: anyone with it becomes a member, after Campfire. Clients only come in by invitation. */
const joinTeam = (c: PubCtx, account: Account) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const fd     = yield* c.form
  const google = googleFromForm(c, fd)
  if (google === "expired") return invalid([GOOGLE_EXPIRED])

  const name     = str(fd, "name")
  const email    = google?.email ?? str(fd, "email").toLowerCase()
  const password = str(fd, "password")

  const errors: string[] = []
  if (!name)                                     errors.push("Tell us your name.")
  if (!EMAIL.test(email))                        errors.push("That doesn't look like an email address.")
  if (!google && password.length < MIN_PASSWORD) errors.push(SHORT_PASSWORD)
  if (errors.length) return invalid(errors)

  const [existing] = yield* sql<Person>`select * from people where account_id = ${account.id} and lower(email) = ${email}`
  // Someone who was removed stays out until a person invites them back.
  if (existing?.removed_at) return invalid([`${email} can't join ${account.name} with this link. Ask someone there to invite you.`])
  if (existing?.joined_at)  return invalid([`${email} is already in ${account.name}. Sign in instead.`])
  // The link proves nothing about the address, so a pending invitation (its role, its projects) is only taken up from its email.
  if (existing)             return invalid([`There's an invitation waiting for ${email}. Use the link in that email to join.`])

  const problem = yield* claimLogin(email, password, google)
  if (problem) return invalid([problem])

  const [team] = yield* sql<{ id: number }>`select id from companies where account_id = ${account.id} and name = ${account.name} limit 1`
  const [me]   = yield* sql<Person>`insert into people ${sql.insert({
    account_id: account.id,
    company_id: team?.id ?? null,
    name,
    email,
    role:       "member",
    time_zone:  validTz(str(fd, "time_zone")) ?? "UTC",
    joined_at:  new Date(),
    prefs:      JSON.stringify({ notify_email: true, google: !!google }),
  })} returning *`
  yield* logEvent({ ...c, me: me!, account }, { project_id: null, action: "joined", summary: "joined with the team link" })
  return withCookie(yield* signInAs(c, "/", me!.id, `Welcome to ${account.name}!`), "google", null)
})

// ─── Accounts and signing out ──────────────────────────────────────────────

// The account chooser: the other accounts aren't in the browser's copy.
const listAccounts = get("/accounts", (c) => Effect.gen(function* () {
  const people = yield* peopleByEmail(c.me.email)
  return json(people.map((p) => ({ id: p.id, account_name: p.account_name, logo_url: p.logo_url })))
}))

// Only to another account with your own address.
const switchAccount = pubPost("/accounts", (c) => Effect.gen(function* () {
  if (!c.me) return redirect("/signin")
  const id     = num(str(yield* c.form, "person_id"))
  const target = (yield* peopleByEmail(c.me.email)).find((p) => p.id === id)
  if (!target) return redirect("/accounts", "You're not in that account.")
  return yield* signInAs(c, "/", target.id, `Switched to ${target.account_name}.`)
}))

// In dev, pid=out also stops the switcher's cookie from signing you straight back in.
const signOut = pubPost("/signout", (c) => Effect.gen(function* () {
  yield* endSession(c)
  const r = withCookie(withCookie(redirect("/signin", "You're signed out."), "sid", null), "pid", DEV ? "out" : null)
  return resync(r)
}))

export const routes = [
  authOptions,
  toGoogle,
  fromGoogle,
  signUp,
  firstProject,
  isKnownEmail,
  signIn,
  sendSignInLink,
  useSignInLink,
  forgotPassword,
  checkResetLink,
  resetPassword,
  verifyTwoStep,
  showJoin,
  join,
  listAccounts,
  switchAccount,
  signOut,
]

// ─── Jobs ──────────────────────────────────────────────────────────────────

// Trials that ran out go on hold. Everything stays; Billing and Export keep working.
const holdExpiredTrials = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update accounts set status = 'on_hold' where status = 'trial' and trial_ends_on < current_date`
})

// Sessions unused for 30 days, and two-step checks nobody finished.
const clearOldSessions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from sessions where last_seen_at < now() - make_interval(days => ${SESSION_DAYS})
             or (not verified and created_at < now() - make_interval(mins => ${VERIFY_MINUTES}))`
})

export const jobs = [holdExpiredTrials, clearOldSessions]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // A pending invitation, so /join/welcome-frank and the invitation email have something to show.
  const [frank] = yield* sql<Person>`insert into people ${sql.insert({
    account_id:   s.account.id,
    name:         "Frank Mills",
    email:        "frank@acme.test",
    title:        "Copywriter",
    invited_by:   s.people.maya.id,
    invite_token: "welcome-frank",
    invited_at:   new Date(),
    prefs:        JSON.stringify({ notify_email: true }),
  })} returning *`
  yield* sql`insert into project_people (project_id, person_id) values (${s.projects.website.id}, ${frank!.id})`
  yield* sendEmail(frank!, {
    subject: `${s.people.maya.name} invited you to ${s.account.name}`,
    kind:    "invite",
    link:    "/join/welcome-frank",
    body:    `${s.people.maya.name} invited you to join ${s.account.name} on ProjectTorch, to work on ${s.projects.website.name}.\n\nWe'd love your help on the homepage copy.`,
  }, true)

  // Ann uses two-step verification, so signing in as ann@acme.test shows the code step.
  yield* sql`update people set prefs = prefs || '{"two_factor": true}'::jsonb where id = ${s.people.ann.id}`

  // Everyone in the sample data signs in with the password "projecttorch".
  const hash = yield* Effect.promise(() => Bun.password.hash("projecttorch"))
  yield* sql`insert into logins (email, password_hash) select distinct lower(email), ${hash} from people where joined_at is not null on conflict do nothing`
})
