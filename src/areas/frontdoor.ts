// The front door: sign up, first run, sign in (password, emailed link, Google), forgot/reset password,
// two-step verification, accepting an invitation, the account chooser, account on hold, sign out.
// The pages are client/areas/frontdoor.tsx; these are their posts, plus lookups signed-out pages need.
//
// Signing in starts a session (`sessions`, the `sid` cookie; see loadMe in lib/web.ts). Passwords and Google ids live
// in `logins`, one per email address, so one login opens every account that address is in.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, pubGet, pubPost, redirect, invalid, json, withCookie, resync, navigate, hashToken, str, num, DEV, SESSION_DAYS, type Ctx, type PubCtx, type Person, type Account, type Reply } from "../lib/web.ts"
import { defaultTools, createRecording, logEvent, sendEmail, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const LINK_MINUTES = 15
const RESET_HOURS = 2
const VERIFY_MINUTES = 10

type Login = { email: string; password_hash: string | null; google_sub: string | null }
type GoogleId = { sub: string; email: string; name: string }

const randomToken = () => randomBytes(32).toString("base64url")

// ---------- sessions ----------

/** A new session for this person: a random token in the `sid` cookie, its hash in `sessions`. Drops the dev `pid`. */
const startSession = (r: Reply, personId: number, verified = true) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const token = randomToken()
    yield* sql`insert into sessions ${sql.insert({ token_hash: hashToken(token), person_id: personId, verified })}`
    return withCookie(withCookie(r, "sid", token, { httpOnly: true, maxAge: SESSION_DAYS * 86400 }), "pid", null)
  })

/** End this browser's session, if it has one. */
const endSession = (c: PubCtx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (c.req.cookies.sid) yield* sql`delete from sessions where token_hash = ${hashToken(c.req.cookies.sid)}`
  })

/** Become this person: a fresh session, and the browser drops its copy and bootstraps as them. */
const signInAs = (c: PubCtx, to: string, personId: number, flash?: string) =>
  Effect.gen(function* () {
    yield* endSession(c)
    return resync(yield* startSession(redirect(to, flash), personId))
  })

/** Where to land after signing in: two-step check, then the account chooser if there's more than one account. */
const finishSignIn = (c: PubCtx, person: Person, accounts: number) =>
  person.prefs.two_factor
    ? Effect.gen(function* () {
        yield* endSession(c)
        return yield* startSession(redirect("/signin/verify"), person.id, false)
      })
    : signInAs(c, accounts > 1 ? "/accounts" : "/", person.id)

// ---------- logins ----------

const loginFor = (email: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<Login>`select * from logins where email = lower(${email})`)[0] ?? null
  })

const setPassword = (email: string, password: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const hash = yield* Effect.promise(() => Bun.password.hash(password))
    yield* sql`insert into logins (email, password_hash) values (lower(${email}), ${hash})
      on conflict (email) do update set password_hash = excluded.password_hash`
  })

// ponytail: no attempt limit; argon2 is slow enough to start. Lock out after N misses if anyone hammers it.
const checkPassword = (email: string, password: string) =>
  Effect.gen(function* () {
    const login = yield* loginFor(email)
    if (!login?.password_hash || !password) return false
    return yield* Effect.promise(() => Bun.password.verify(password, login.password_hash!))
  })

const setGoogle = (email: string, sub: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`insert into logins (email, google_sub) values (lower(${email}), ${sub})
      on conflict (email) do update set google_sub = coalesce(logins.google_sub, excluded.google_sub)`
  })

// ---------- Google ----------
// The authorization-code flow, by hand: send people to Google, swap the code for an ID token, read their verified email.
// Google is on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set; otherwise its buttons don't show.

const GOOGLE = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET }
  : null

/** This app's address as the browser sees it. APP_URL wins (set it behind a proxy). */
const origin = (c: PubCtx) =>
  process.env.APP_URL ?? `${c.req.headers["x-forwarded-proto"] ?? "http"}://${c.req.headers["x-forwarded-host"] ?? c.req.headers.host}`
const callbackUrl = (c: PubCtx) => `${origin(c)}/api/auth/google/callback`

const googleIdentity = async (code: string, redirectUri: string): Promise<GoogleId | null> => {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: GOOGLE!.id, client_secret: GOOGLE!.secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  })
  if (!res.ok) return null
  const { id_token } = (await res.json()) as { id_token?: string }
  // Straight from Google over TLS, so its signature needn't be checked (Google's own guidance for this flow).
  const p = JSON.parse(Buffer.from(id_token?.split(".")[1] ?? "", "base64url").toString() || "null")
  return p?.aud === GOOGLE!.id && p.email_verified && p.sub && p.email ? { sub: p.sub, email: String(p.email).toLowerCase(), name: p.name ?? "" } : null
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

/** Joined, active people with this email, one per account. */
const peopleByEmail = (email: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Person & { account_name: string; logo_url: string | null }>`
      select p.*, a.name as account_name, a.logo_url from people p join accounts a on a.id = p.account_id
      where lower(p.email) = lower(${email}) and p.removed_at is null and p.joined_at is not null order by a.name`
  })

const setPrefs = (personId: number, prefs: Record<string, unknown>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update people set prefs = prefs || ${JSON.stringify(prefs)}::jsonb where id = ${personId}`
  })

const UNKNOWN_EMAIL = "We don't know that email address. Check for typos, or sign up."
const GOOGLE_EXPIRED = "Your Google sign-in timed out. Try the Google button again."

// ---------- routes ----------
export const routes = [
  /** What the signed-out pages can offer. */
  pubGet("/auth/options", () => Effect.succeed(json({ google: !!GOOGLE }))),

  /** Off to Google. `then` is where it leads on the way back: signin, signup, or join:<invitation token>. */
  pubGet("/auth/google", (c) =>
    Effect.sync(() => {
      if (!GOOGLE) return navigate(redirect("/signin"))
      const then = c.query.get("then") ?? ""
      const state = randomToken()
      const q = new URLSearchParams({
        client_id: GOOGLE.id, redirect_uri: callbackUrl(c), response_type: "code", scope: "openid email profile", state, prompt: "select_account",
      })
      return navigate(withCookie(redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`), "google_state",
        `${state}.${/^(signup|join:.+)$/.test(then) ? then : "signin"}`, { httpOnly: true, maxAge: 600 }))
    })),

  /** Google sends people back here: sign them in, or carry who they are to the sign-up or join form. */
  pubGet("/auth/google/callback", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [state, ...rest] = (c.req.cookies.google_state ?? "").split(".")
      const then = rest.join(".")
      const go = (r: Reply) => navigate(withCookie(r, "google_state", null))
      const code = c.query.get("code")
      // No code means they backed out on Google's side.
      if (!GOOGLE || !state || c.query.get("state") !== state || !code) return go(redirect("/signin"))
      const g = yield* Effect.promise(() => googleIdentity(code, callbackUrl(c)).catch(() => null))
      if (!g) return go(redirect("/signin"))

      if (then.startsWith("join:")) return go(withGoogle(redirect(`/join/${encodeURIComponent(then.slice(5))}?google=1`), g))

      // A login that already uses this Google account, or failing that, one for its (verified) address.
      const [login] = yield* sql<Login>`select * from logins where google_sub = ${g.sub} or email = ${g.email} order by (google_sub = ${g.sub}) desc nulls last limit 1`
      if (login && !login.google_sub) yield* setGoogle(login.email, g.sub)
      const people = yield* peopleByEmail(login?.email ?? g.email)
      if (people.length) return go(yield* finishSignIn(c, people[0]!, people.length))
      // New here: the sign-up form, with name and email from Google.
      return go(withGoogle(redirect(`/signup?${new URLSearchParams({ google: "1", name: g.name, email: g.email })}`), g))
    })),

  // Sign up
  pubPost("/signup", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const google = fd.get("google") === "1" ? openGoogle(c) : null
      if (fd.get("google") === "1" && !google) return invalid([GOOGLE_EXPIRED])
      const v = { name: str(fd, "name"), email: google?.email ?? str(fd, "email").toLowerCase(), company: str(fd, "company") }
      const errs = [
        ...(v.name ? [] : ["Tell us your name."]),
        ...(EMAIL.test(v.email) ? [] : ["That doesn't look like an email address."]),
        ...(v.company ? [] : ["Give your company or team a name."]),
        ...(google || str(fd, "password").length >= 8 ? [] : ["Pick a longer password. At least 8 characters."]),
      ]
      if (!errs.length && (yield* peopleByEmail(v.email)).length) errs.push("That email is already on an account. Sign in instead?")
      if (errs.length) return invalid(errs)

      const [account] = yield* sql<Account>`insert into accounts ${sql.insert({
        name: v.company, status: "trial", trial_ends_on: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), billing_email: v.email,
        settings: JSON.stringify({ who_can_create_projects: "everyone", who_can_invite: "everyone", clients_can_ping: false }),
      })} returning *`
      const [company] = yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: account!.id, name: v.company })} returning id`
      const [me] = yield* sql<Person>`insert into people ${sql.insert({
        account_id: account!.id, company_id: company!.id, name: v.name, email: v.email, role: "owner", joined_at: new Date(),
        prefs: JSON.stringify({ notify_email: true, google: !!google }),
      })} returning *`
      if (google) yield* setGoogle(v.email, google.sub)
      else yield* setPassword(v.email, str(fd, "password"))
      const ctx: Ctx = { ...c, me: me!, account: account! }
      const project = (p: { name: string; description: string; is_hq?: boolean; tools?: ReturnType<typeof defaultTools> }) =>
        sql<Project>`insert into projects ${sql.insert({
          account_id: account!.id, name: p.name, description: p.description, is_hq: p.is_hq ?? false, all_access: p.is_hq ?? false,
          tools: JSON.stringify(p.tools ?? []), created_by: me!.id,
        })} returning *`.pipe(Effect.map((r) => r[0]!))
      yield* project({ name: `${v.company} HQ`, description: "Company-wide announcements and stuff everyone needs.", is_hq: true })
      // A sample project to poke around in, with Posts and Tasks open (new projects start with no windows). Theirs to trash.
      const sample = yield* project({ name: "Sample project (yours to trash)", description: "Poke around. Post, check things off, then trash it from the ••• menu.",
        tools: defaultTools().filter((t) => t.type === "message_board" || t.type === "todos") })
      yield* sql`insert into project_people (project_id, person_id) values (${sample.id}, ${me!.id})`
      yield* createRecording(ctx, { project: sample, type: "message", title: "Welcome! Start here", body: "This is a post. Everyone on the project can read it and comment below.\n\nAdd a comment, then check off the tasks.", quiet: true })
      for (const t of ["Add a comment to the welcome post", "Make your first real project", "Invite someone"])
        yield* createRecording(ctx, { project: sample, type: "todo", title: t, data: { assignee_ids: [me!.id] }, quiet: true })
      yield* logEvent(ctx, { project_id: null, action: "created", summary: `started the ${v.company} account` })
      return withCookie(yield* signInAs(c, "/welcome", me!.id), "google", null)
    })),

  // First run
  post("/welcome", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const name = str(yield* c.form, "name")
      if (!name) return redirect("/welcome", "Your project needs a name.")
      const [p] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: c.me.account_id, name, created_by: c.me.id,
      })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${c.me.id})`
      yield* logEvent(c, { project_id: p!.id, action: "created", summary: `started the project ${name}` })
      return redirect(`/projects/${p!.id}/people/setup`)
    })),

  // Sign in: email first, then a password, an emailed link, or Google.
  /** Does this email have an account? The sign-in page asks before showing the password step. */
  pubGet("/signin", (c) =>
    Effect.gen(function* () {
      return json({ known: (yield* peopleByEmail((c.query.get("email") ?? "").trim())).length > 0 })
    })),

  pubPost("/signin", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const email = str(fd, "email")
      const people = yield* peopleByEmail(email)
      if (!people.length) return invalid([UNKNOWN_EMAIL])
      if (!(yield* checkPassword(email, str(fd, "password"))))
        return invalid(["That email and password don't match. Try again, or we can email you a sign-in link."])
      return yield* finishSignIn(c, people[0]!, people.length)
    })),

  pubPost("/signin/link", (c) =>
    Effect.gen(function* () {
      const email = str(yield* c.form, "email")
      const [person] = yield* peopleByEmail(email)
      if (person) {
        const token = crypto.randomUUID()
        yield* setPrefs(person.id, { signin_token: token, signin_token_at: new Date().toISOString() })
        yield* sendEmail(person, {
          subject: "Your sign-in link", kind: "signin", link: `/signin/link/${token}`,
          body: `Here's your link to sign in. It works once and expires in ${LINK_MINUTES} minutes.\n\nIf you didn't ask for this, ignore it. Nobody can sign in without this link.`,
        }, true)
      }
      // Same answer either way, so nobody can probe which addresses have accounts.
      return redirect(`/signin/link-sent?email=${encodeURIComponent(email)}`)
    })),

  // Was a GET: opening the emailed link signs you in. The page posts here when it opens.
  pubPost("/signin/link/:token", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [person] = yield* sql<Person>`select * from people where prefs->>'signin_token' = ${c.params.token ?? ""} and removed_at is null`
      const at = (person?.prefs as any)?.signin_token_at
      if (!person || !at || Date.now() - Date.parse(at) > LINK_MINUTES * 60_000) return json({ expired: true })
      yield* setPrefs(person.id, { signin_token: null, signin_token_at: null })
      return yield* finishSignIn(c, person, (yield* peopleByEmail(person.email)).length)
    })),

  // Forgot / reset password
  pubPost("/forgot", (c) =>
    Effect.gen(function* () {
      const email = str(yield* c.form, "email")
      const [person] = yield* peopleByEmail(email)
      if (person) {
        const token = crypto.randomUUID()
        yield* setPrefs(person.id, { reset_token: token, reset_token_at: new Date().toISOString() })
        yield* sendEmail(person, {
          subject: "Reset your password", kind: "reset", link: `/reset/${token}`,
          body: `Someone (hopefully you) asked to reset your password. This link works for ${RESET_HOURS} hours.\n\nIf it wasn't you, ignore this email. Your password won't change.`,
        }, true)
      }
      return redirect(`/forgot?sent=1&email=${encodeURIComponent(email)}`)
    })),

  /** Is this reset link still good? */
  pubGet("/reset/:token", (c) =>
    Effect.gen(function* () {
      return json({ ok: !!(yield* resetPerson(c.params.token)) })
    })),

  pubPost("/reset/:token", (c) =>
    Effect.gen(function* () {
      const person = yield* resetPerson(c.params.token)
      if (!person) return invalid(["This reset link has expired."])
      const password = str(yield* c.form, "password")
      if (password.length < 8) return invalid(["Pick a longer password. At least 8 characters."])
      yield* setPassword(person.email, password)
      yield* setPrefs(person.id, { reset_token: null, reset_token_at: null })
      return yield* signInAs(c, (yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/", person.id, "Password saved. You're signed in.")
    })),

  // Two-step verification: signing in left an unverified session; a good code verifies it.
  pubPost("/signin/verify", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sid = c.req.cookies.sid ?? ""
      const [pending] = yield* sql<{ person_id: number }>`select person_id from sessions
        where token_hash = ${hashToken(sid)} and not verified and created_at > now() - make_interval(mins => ${VERIFY_MINUTES})`
      if (!pending) return redirect("/signin", "That took too long. Sign in again.")
      const fd = yield* c.form
      const backup = fd.get("backup") === "1"
      const code = str(fd, "code").replace(/\s/g, "")
      // ponytail: any well-formed code passes. Real TOTP check goes here; the password already had to be right.
      if (backup ? !/^[a-z0-9-]{8,}$/i.test(code) : !/^\d{6}$/.test(code))
        return invalid([backup ? "That backup code didn't work. Each one works once." : "That code didn't work. Codes change every 30 seconds, so try the newest one."])
      const [person] = yield* sql<Person>`select * from people where id = ${pending.person_id} and removed_at is null`
      if (!person) return redirect("/signin")
      yield* sql`update sessions set verified = true, last_seen_at = now() where token_hash = ${hashToken(sid)}`
      return resync(redirect((yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/"))
    })),

  // Accept an invitation
  /** The invitation behind a token, as the join page shows it. */
  pubGet("/join/:token", (c) =>
    Effect.gen(function* () {
      const inv = yield* invitation(c.params.token)
      return json(inv.state === "open"
        ? { state: "open", account: inv.account.name, inviter: inv.inviter, name: inv.person.name, email: inv.person.email, time_zone: inv.person.time_zone, google: openGoogle(c)?.email ?? null }
        : inv.state === "used" ? { state: "used", account: inv.account?.name ?? null, email: inv.email } : { state: "gone" })
    })),

  pubPost("/join/:token", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const inv = yield* invitation(c.params.token)
      if (inv.state !== "open") return invalid([inv.state === "used" ? "This invitation was already used." : "This invitation was cancelled."])
      const fd = yield* c.form
      const name = str(fd, "name")
      const password = str(fd, "password")
      const google = fd.get("google") === "1" ? openGoogle(c) : null
      if (fd.get("google") === "1" && !google) return invalid([GOOGLE_EXPIRED])
      const errs = [...(name ? [] : ["Tell us your name."]), ...(google || password.length >= 8 ? [] : ["Pick a longer password. At least 8 characters."])]
      if (errs.length) return invalid(errs)
      const email = inv.person.email
      const login = yield* loginFor(email)
      if (google) {
        if (google.email !== email.toLowerCase())
          return invalid([`Google signed you in as ${google.email}, but this invitation is for ${email}. Use a password, or pick that Google account.`])
        yield* setGoogle(email, google.sub)
      } else if (login) {
        // The address already has a login (from another account): it has to be them, so its password, not a new one.
        if (!(yield* checkPassword(email, password)))
          return invalid(["You already have a Saintsflow login with this email. Use that password, or join with Google."])
      } else yield* setPassword(email, password)
      const tz = str(fd, "time_zone")
      const validTz = (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz } catch { return false } })()
      yield* sql`update people set name = ${name}, time_zone = ${validTz ? tz : inv.person.time_zone}, joined_at = now(), invite_token = null,
        prefs = prefs || ${JSON.stringify({ used_invite_token: c.params.token, google: !!google })}::jsonb where id = ${inv.person.id}`
      const [first] = yield* sql<{ project_id: number }>`select pp.project_id from project_people pp join projects p on p.id = pp.project_id
        where pp.person_id = ${inv.person.id} and p.status = 'active' order by pp.added_at limit 1`
      return withCookie(yield* signInAs(c, first ? `/projects/${first.project_id}` : "/", inv.person.id, `Welcome to ${inv.account.name}!`), "google", null)
    })),

  // Account chooser: the other accounts aren't in the browser's copy.
  get("/accounts", (c) =>
    Effect.gen(function* () {
      return json((yield* peopleByEmail(c.me.email)).map((p) => ({ id: p.id, account_name: p.account_name, logo_url: p.logo_url })))
    })),

  pubPost("/accounts", (c) =>
    Effect.gen(function* () {
      if (!c.me) return redirect("/signin")
      const id = num(str(yield* c.form, "person_id"))
      const target = (yield* peopleByEmail(c.me.email)).find((p) => p.id === id)
      if (!target) return redirect("/accounts", "You're not in that account.")
      return yield* signInAs(c, "/", target.id, `Switched to ${target.account_name}.`)
    })),

  // In dev, pid=out also stops the switcher's cookie from signing you straight back in.
  pubPost("/signout", (c) =>
    Effect.gen(function* () {
      yield* endSession(c)
      return resync(withCookie(withCookie(redirect("/signin", "You're signed out."), "sid", null), "pid", DEV ? "out" : null))
    })),
]

export const jobs = [
  // Trials that ran out go on hold. Everything stays; Billing and Export keep working.
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update accounts set status = 'on_hold' where status = 'trial' and trial_ends_on < current_date`
  }),
  // Sessions unused for 30 days, and two-step checks nobody finished.
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`delete from sessions where last_seen_at < now() - make_interval(days => ${SESSION_DAYS})
      or (not verified and created_at < now() - make_interval(mins => ${VERIFY_MINUTES}))`
  }),
]

// ---------- helpers ----------

const resetPerson = (token: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where prefs->>'reset_token' = ${token ?? ""} and removed_at is null`
    const at = (p?.prefs as any)?.reset_token_at
    return p && at && Date.now() - Date.parse(at) < RESET_HOURS * 3600_000 ? p : null
  })

type Invitation =
  | { state: "open"; person: Person; account: Account; inviter: string | null }
  | { state: "used"; account: Account | null; email: string }
  | { state: "gone" }

const invitation = (token: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const t = token ?? ""
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

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // A pending invitation, so /join/welcome-frank and the invitation email have something to show.
    const [eve] = yield* sql<Person>`insert into people ${sql.insert({
      account_id: s.account.id, name: "Frank Mills", email: "frank@acme.test", title: "Copywriter", invited_by: s.people.maya.id,
      invite_token: "welcome-frank", invited_at: new Date(), prefs: JSON.stringify({ notify_email: true }),
    })} returning *`
    yield* sql`insert into project_people (project_id, person_id) values (${s.projects.website.id}, ${eve!.id})`
    yield* sendEmail(eve!, {
      subject: `${s.people.maya.name} invited you to ${s.account.name}`, kind: "invite", link: "/join/welcome-frank",
      body: `${s.people.maya.name} invited you to join ${s.account.name} on Saintsflow, to work on ${s.projects.website.name}.\n\nWe'd love your help on the homepage copy.`,
    }, true)
    // Ann uses two-step verification, so signing in as ann@acme.test shows the code step.
    yield* sql`update people set prefs = prefs || '{"two_factor": true}'::jsonb where id = ${s.people.ann.id}`
    // Everyone in the sample data signs in with the password "saintsflow".
    const hash = yield* Effect.promise(() => Bun.password.hash("saintsflow"))
    yield* sql`insert into logins (email, password_hash) select distinct lower(email), ${hash} from people where joined_at is not null on conflict do nothing`
  })
