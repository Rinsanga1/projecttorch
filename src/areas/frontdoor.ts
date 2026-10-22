// The front door: sign up, first run, sign in (password, emailed link, Google), forgot/reset password,
// two-step verification, accepting an invitation, the account chooser, account on hold, sign out.
// The pages are client/areas/frontdoor.tsx; these are their posts, plus lookups signed-out pages need.
//
// ponytail: no real auth. Passwords are checked for shape only and never stored; "signing in" just sets the
// `pid` cookie for the person with that email. Swap in hashed passwords + sessions when this goes live.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, pubGet, pubPost, redirect, invalid, json, withCookie, resync, str, num, type Ctx, type Person, type Account } from "../lib/web.ts"
import { defaultTools, createRecording, logEvent, sendEmail, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const LINK_MINUTES = 15
const RESET_HOURS = 2

/** Become this person: the browser drops its copy and bootstraps as them. */
const signInAs = (to: string, personId: number, flash?: string) => resync(withCookie(redirect(to, flash), "pid", String(personId)))

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

/** Where to land after signing in: two-step check, then the account chooser if there's more than one account. */
const finishSignIn = (person: Person, accounts: number) =>
  person.prefs.two_factor
    ? withCookie(redirect("/signin/verify"), "pending_pid", String(person.id))
    : signInAs(accounts > 1 ? "/accounts" : "/", person.id)

const UNKNOWN_EMAIL = "We don't know that email address. Check for typos, or sign up."

// ---------- routes ----------
export const routes = [
  // Sign up
  pubPost("/signup", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const v = { name: str(fd, "name"), email: str(fd, "email").toLowerCase(), company: str(fd, "company") }
      const google = fd.get("google") === "1"
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
        prefs: JSON.stringify({ notify_email: true, google }),
      })} returning *`
      const ctx: Ctx = { ...c, me: me!, account: account! }
      const project = (p: { name: string; description: string; is_hq?: boolean }) =>
        sql<Project>`insert into projects ${sql.insert({
          account_id: account!.id, name: p.name, description: p.description, is_hq: p.is_hq ?? false, all_access: p.is_hq ?? false,
          tools: JSON.stringify(defaultTools()), email_token: crypto.randomUUID().slice(0, 12), created_by: me!.id,
        })} returning *`.pipe(Effect.map((r) => r[0]!))
      yield* project({ name: `${v.company} HQ`, description: "Company-wide announcements and stuff everyone needs.", is_hq: true })
      // A sample project to poke around in. Theirs to trash.
      const sample = yield* project({ name: "Sample project (yours to trash)", description: "Poke around. Post, check things off, then trash it from the ••• menu." })
      yield* sql`insert into project_people (project_id, person_id) values (${sample.id}, ${me!.id})`
      yield* createRecording(ctx, { project: sample, type: "message", title: "Welcome! Start here", body: "This is a post. Everyone on the project can read it and comment below.\n\nAdd a comment, then check off the tasks.", quiet: true })
      const list = yield* createRecording(ctx, { project: sample, type: "todolist", title: "Things to try", quiet: true })
      for (const t of ["Add a comment to the welcome post", "Make your first real project", "Invite someone"])
        yield* createRecording(ctx, { project: sample, type: "todo", parent_id: list.id, title: t, data: { assignee_ids: [me!.id] }, quiet: true })
      yield* logEvent(ctx, { project_id: null, action: "created", summary: `started the ${v.company} account` })
      return signInAs("/welcome", me!.id)
    })),

  // First run
  post("/welcome", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const name = str(yield* c.form, "name")
      if (!name) return redirect("/welcome", "Your project needs a name.")
      const [p] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: c.me.account_id, name, tools: JSON.stringify(defaultTools()), email_token: crypto.randomUUID().slice(0, 12), created_by: c.me.id,
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
      // ponytail: any non-empty password works; nothing is stored to compare against.
      if (fd.get("google") !== "1" && !str(fd, "password"))
        return invalid(["That email and password don't match. Try again, or we can email you a sign-in link."])
      return finishSignIn(people[0]!, people.length)
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
      return finishSignIn(person, (yield* peopleByEmail(person.email)).length)
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
      if (str(yield* c.form, "password").length < 8) return invalid(["Pick a longer password. At least 8 characters."])
      // ponytail: the new password isn't stored (no auth yet). The token is spent either way.
      yield* setPrefs(person.id, { reset_token: null, reset_token_at: null })
      return signInAs((yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/", person.id, "Password saved. You're signed in.")
    })),

  // Two-step verification
  pubPost("/signin/verify", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const pid = num(c.req.cookies.pending_pid)
      if (!pid) return redirect("/signin")
      const fd = yield* c.form
      const backup = fd.get("backup") === "1"
      const code = str(fd, "code").replace(/\s/g, "")
      // ponytail: any well-formed code passes. Real TOTP check goes here with auth.
      if (backup ? !/^[a-z0-9-]{8,}$/i.test(code) : !/^\d{6}$/.test(code))
        return invalid([backup ? "That backup code didn't work. Each one works once." : "That code didn't work. Codes change every 30 seconds, so try the newest one."])
      const [person] = yield* sql<Person>`select * from people where id = ${pid} and removed_at is null`
      if (!person) return redirect("/signin")
      return withCookie(signInAs((yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/", person.id), "pending_pid", null)
    })),

  // Accept an invitation
  /** The invitation behind a token, as the join page shows it. */
  pubGet("/join/:token", (c) =>
    Effect.gen(function* () {
      const inv = yield* invitation(c.params.token)
      return json(inv.state === "open"
        ? { state: "open", account: inv.account.name, inviter: inv.inviter, name: inv.person.name, email: inv.person.email, time_zone: inv.person.time_zone }
        : inv.state === "used" ? { state: "used", account: inv.account?.name ?? null, email: inv.email } : { state: "gone" })
    })),

  pubPost("/join/:token", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const inv = yield* invitation(c.params.token)
      if (inv.state !== "open") return invalid([inv.state === "used" ? "This invitation was already used." : "This invitation was cancelled."])
      const fd = yield* c.form
      const name = str(fd, "name")
      const google = fd.get("google") === "1"
      const errs = [...(name ? [] : ["Tell us your name."]), ...(google || str(fd, "password").length >= 8 ? [] : ["Pick a longer password. At least 8 characters."])]
      if (errs.length) return invalid(errs)
      const tz = str(fd, "time_zone")
      const validTz = (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz } catch { return false } })()
      yield* sql`update people set name = ${name}, time_zone = ${validTz ? tz : inv.person.time_zone}, joined_at = now(), invite_token = null,
        prefs = prefs || ${JSON.stringify({ used_invite_token: c.params.token, google })}::jsonb where id = ${inv.person.id}`
      const [first] = yield* sql<{ project_id: number }>`select pp.project_id from project_people pp join projects p on p.id = pp.project_id
        where pp.person_id = ${inv.person.id} and p.status = 'active' order by pp.added_at limit 1`
      return signInAs(first ? `/projects/${first.project_id}` : "/", inv.person.id, `Welcome to ${inv.account.name}!`)
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
      return signInAs("/", target.id, `Switched to ${target.account_name}.`)
    })),

  // Signing out sets pid=out, which web.ts loadMe treats as nobody.
  pubPost("/signout", () => Effect.succeed(resync(withCookie(redirect("/signin", "You're signed out."), "pid", "out")))),
]

// Trials that ran out go on hold. Everything stays; Billing and Export keep working.
export const jobs = [
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update accounts set status = 'on_hold' where status = 'trial' and trial_ends_on < current_date`
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
  })
