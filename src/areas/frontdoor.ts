// The front door: sign up, first run, sign in (password, emailed link, Google), forgot/reset password,
// two-step verification, accepting an invitation, the account chooser, account on hold, sign out.
//
// ponytail: no real auth. Passwords are checked for shape only and never stored; "signing in" just sets the
// `pid` cookie for the person with that email. Swap in hashed passwords + sessions when this goes live.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { html, raw, fmtDate, today, type Raw } from "../lib/html.ts"
import { get, post, pubGet, pubPost, redirect, render, str, num, errors, isAdmin, type Ctx, type PubCtx, type Person, type Account } from "../lib/web.ts"
import { defaultTools, createRecording, logEvent, sendEmail, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const LINK_MINUTES = 15
const RESET_HOURS = 2

const signInAs = (to: string, personId: number, flash?: string) =>
  redirect(to, flash).pipe(HttpServerResponse.setCookieUnsafe("pid", String(personId), { path: "/" }))

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
    ? redirect("/signin/verify").pipe(HttpServerResponse.setCookieUnsafe("pending_pid", String(person.id), { path: "/" }))
    : signInAs(accounts > 1 ? "/accounts" : "/", person.id)

// ---------- forms ----------

const signupForm = (v: Record<string, string>, errs: string[]) => html`
<h1>Sign up</h1>
<p>Start a new account. One short form, then you're inside.</p>
${errors(errs)}
<form method="post" action="/signup">
  <p><label>Your name<br><input name="name" value="${v.name ?? ""}" required autofocus></label></p>
  <p><label>Email address<br><input type="email" name="email" value="${v.email ?? ""}" required></label></p>
  <p><label>Company or team name<br><input name="company" value="${v.company ?? ""}" required></label></p>
  <p><label>Password<br><input type="password" name="password"></label></p>
  <p><button>Start my free trial</button> <button name="google" value="1">Sign up with Google</button></p>
</form>
<p><a href="/signin">Already have an account? Sign in</a></p>`

const signinEmailStep = (email: string, errs: Raw | string = "") => html`
<h1>Sign in</h1>
${errs}
<form method="get" action="/signin">
  <p><label>Email address<br><input type="email" name="email" value="${email}" required autofocus></label></p>
  <button>Next</button>
</form>
<p><a href="/signup">New here? Try it free</a></p>`

const signinPasswordStep = (email: string, errs: string[] = []) => html`
<h1>Sign in</h1>
${errors(errs)}
<form method="post" action="/signin">
  <input type="hidden" name="email" value="${email}">
  <p>Signing in as <b>${email}</b> <a href="/signin">(not you?)</a></p>
  <p><label>Password<br><input type="password" name="password" autofocus></label></p>
  <p><button>Sign in</button> <button name="google" value="1">Sign in with Google</button></p>
</form>
<form method="post" action="/signin/link"><input type="hidden" name="email" value="${email}"><button>Email me a link to sign in instead</button></form>
<p><a href="/forgot?email=${encodeURIComponent(email)}">Forgot your password?</a> · <a href="/signup">New here? Try it free</a></p>`

// ---------- routes ----------
export const routes = [
  // Sign up
  pubGet("/signup", (c) => render(c, "Sign up", signupForm({}, []))),

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
      if (errs.length) return yield* render(c, "Sign up", html`${signupForm(v, errs)}${errs.some((e) => e.includes("Sign in instead")) ? html`<p><a href="/signin?email=${encodeURIComponent(v.email)}">Sign in</a></p>` : ""}`, undefined, 422)

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
  get("/welcome", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [sample] = yield* sql<{ id: number }>`select p.id from projects p join project_people pp on pp.project_id = p.id
        where pp.person_id = ${c.me.id} and p.name like 'Sample project%' and p.status = 'active' limit 1`
      return yield* render(c, "Welcome", html`
<h1>Welcome! Let's get your first project going.</h1>
<form method="post" action="/welcome">
  <p><label>What are you working on?<br><input name="name" required autofocus placeholder="e.g. Website redesign"></label></p>
  <button>Make this project</button>
</form>
${sample ? html`<p>Or look around <a href="/projects/${sample.id}">a sample project</a> first. It's yours to trash.</p>` : ""}
<p><a href="/">Skip, take me Home</a></p>`)
    })),

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
  pubGet("/signin", (c) =>
    Effect.gen(function* () {
      const email = (c.query.get("email") ?? "").trim()
      if (!email) return yield* render(c, "Sign in", signinEmailStep(""))
      if (!(yield* peopleByEmail(email)).length)
        return yield* render(c, "Sign in", signinEmailStep(email, errors(["We don't know that email address. Check for typos, or sign up."])), undefined, 422)
      return yield* render(c, "Sign in", signinPasswordStep(email))
    })),

  pubPost("/signin", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const email = str(fd, "email")
      const people = yield* peopleByEmail(email)
      if (!people.length) return yield* render(c, "Sign in", signinEmailStep(email, errors(["We don't know that email address. Check for typos, or sign up."])), undefined, 422)
      // ponytail: any non-empty password works; nothing is stored to compare against.
      if (fd.get("google") !== "1" && !str(fd, "password"))
        return yield* render(c, "Sign in", signinPasswordStep(email, ["That email and password don't match. Try again, or we can email you a sign-in link."]), undefined, 422)
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

  pubGet("/signin/link-sent", (c) =>
    Effect.gen(function* () {
      const email = c.query.get("email") ?? ""
      return yield* render(c, "Check your email", html`
<h1>Check your email</h1>
<p>We sent a sign-in link to <b>${email}</b>. It works once and expires in ${LINK_MINUTES} minutes.</p>
<form method="post" action="/signin/link"><input type="hidden" name="email" value="${email}"><button>Didn't get it? Send it again</button></form>
<p><a href="/signin?email=${encodeURIComponent(email)}">Sign in with a password instead</a></p>
<p><small>Nothing really gets emailed yet. Open it in the <a href="/inbox?to=${encodeURIComponent(email)}">dev inbox</a>.</small></p>`)
    })),

  pubGet("/signin/link/:token", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [person] = yield* sql<Person>`select * from people where prefs->>'signin_token' = ${c.params.token ?? ""} and removed_at is null`
      const at = (person?.prefs as any)?.signin_token_at
      if (!person || !at || Date.now() - Date.parse(at) > LINK_MINUTES * 60_000)
        return yield* render(c, "Link expired", html`<h1>This link has expired</h1><p>Sign-in links work once and expire after ${LINK_MINUTES} minutes.</p><p><a href="/signin">Ask for a new one</a></p>`, undefined, 410)
      yield* setPrefs(person.id, { signin_token: null, signin_token_at: null })
      return finishSignIn(person, (yield* peopleByEmail(person.email)).length)
    })),

  // Forgot / reset password
  pubGet("/forgot", (c) =>
    render(c, "Forgot password", c.query.get("sent")
      ? html`<h1>Check your email</h1><p>If there's an account for <b>${c.query.get("email") ?? ""}</b>, we sent reset instructions to it.</p>
        <p><a href="/signin">Back to sign in</a> · <small><a href="/inbox">Dev inbox</a></small></p>`
      : html`<h1>Forgot your password?</h1>
<form method="post" action="/forgot">
  <p><label>Email address<br><input type="email" name="email" value="${c.query.get("email") ?? ""}" required autofocus></label></p>
  <button>Send me reset instructions</button>
</form>
<p><a href="/signin">Never mind, back to sign in</a></p>`)),

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

  pubGet("/reset/:token", (c) =>
    Effect.gen(function* () {
      const person = yield* resetPerson(c.params.token)
      if (!person) return yield* render(c, "Link expired", html`<h1>This reset link has expired</h1><p><a href="/forgot">Ask for a new one</a></p>`, undefined, 410)
      return yield* render(c, "Choose a new password", resetForm(c.params.token!, []))
    })),

  pubPost("/reset/:token", (c) =>
    Effect.gen(function* () {
      const person = yield* resetPerson(c.params.token)
      if (!person) return yield* render(c, "Link expired", html`<h1>This reset link has expired</h1><p><a href="/forgot">Ask for a new one</a></p>`, undefined, 410)
      if (str(yield* c.form, "password").length < 8) return yield* render(c, "Choose a new password", resetForm(c.params.token!, ["Pick a longer password. At least 8 characters."]), undefined, 422)
      // ponytail: the new password isn't stored (no auth yet). The token is spent either way.
      yield* setPrefs(person.id, { reset_token: null, reset_token_at: null })
      return signInAs((yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/", person.id, "Password saved. You're signed in.")
    })),

  // Two-step verification
  pubGet("/signin/verify", (c) =>
    Effect.gen(function* () {
      if (!num(c.req.cookies.pending_pid)) return redirect("/signin")
      return yield* render(c, "Two-step verification", verifyForm(c.query.get("backup") === "1", []))
    })),

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
        return yield* render(c, "Two-step verification", verifyForm(backup, [backup ? "That backup code didn't work. Each one works once." : "That code didn't work. Codes change every 30 seconds, so try the newest one."]), undefined, 422)
      const [person] = yield* sql<Person>`select * from people where id = ${pid} and removed_at is null`
      if (!person) return redirect("/signin")
      return signInAs((yield* peopleByEmail(person.email)).length > 1 ? "/accounts" : "/", person.id)
        .pipe(HttpServerResponse.expireCookieUnsafe("pending_pid", { path: "/" }))
    })),

  // Accept an invitation
  pubGet("/join/:token", (c) =>
    Effect.gen(function* () {
      const inv = yield* invitation(c.params.token)
      if (inv.state !== "open") return yield* render(c, "Invitation", invitationGone(inv), undefined, 410)
      return yield* render(c, `Join ${inv.account.name}`, joinForm(c.params.token!, inv, inv.person.name, []))
    })),

  pubPost("/join/:token", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const inv = yield* invitation(c.params.token)
      if (inv.state !== "open") return yield* render(c, "Invitation", invitationGone(inv), undefined, 410)
      const fd = yield* c.form
      const name = str(fd, "name")
      const google = fd.get("google") === "1"
      const errs = [...(name ? [] : ["Tell us your name."]), ...(google || str(fd, "password").length >= 8 ? [] : ["Pick a longer password. At least 8 characters."])]
      if (errs.length) return yield* render(c, `Join ${inv.account.name}`, joinForm(c.params.token!, inv, name, errs), undefined, 422)
      const tz = str(fd, "time_zone")
      const validTz = (() => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return !!tz } catch { return false } })()
      yield* sql`update people set name = ${name}, time_zone = ${validTz ? tz : inv.person.time_zone}, joined_at = now(), invite_token = null,
        prefs = prefs || ${JSON.stringify({ used_invite_token: c.params.token, google })}::jsonb where id = ${inv.person.id}`
      const [first] = yield* sql<{ project_id: number }>`select pp.project_id from project_people pp join projects p on p.id = pp.project_id
        where pp.person_id = ${inv.person.id} and p.status = 'active' order by pp.added_at limit 1`
      return signInAs(first ? `/projects/${first.project_id}` : "/", inv.person.id, `Welcome to ${inv.account.name}!`)
    })),

  // Account chooser
  pubGet("/accounts", (c) =>
    Effect.gen(function* () {
      if (!c.me) return redirect("/signin")
      const mine = yield* peopleByEmail(c.me.email)
      return yield* render(c, "Your accounts", html`
<h1>Your accounts</h1>
<p>Signed in as ${c.me.email}.</p>
<ul>${mine.map((p) => html`<li>
  <form method="post" action="/accounts" style="display:inline">
    <input type="hidden" name="person_id" value="${p.id}">
    ${p.logo_url ? html`<img src="${p.logo_url}" alt="" width="24" height="24"> ` : ""}<button>${p.account_name}</button>${p.id === c.me!.id ? " (you're here now)" : ""}
  </form></li>`)}</ul>
<p><a href="/my/security">Your login & security</a></p>
<form method="post" action="/signout"><button>Sign out</button></form>`)
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
  pubPost("/signout", () =>
    Effect.succeed(redirect("/signin", "You're signed out.").pipe(HttpServerResponse.setCookieUnsafe("pid", "out", { path: "/" })))),

  // Account on hold
  get("/lockout", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const a = c.account
      if (a.status === "active" || a.status === "trial") return redirect("/")
      const owners = yield* sql<{ name: string }>`select name from people where account_id = ${a.id} and role = 'owner' and removed_at is null order by name`
      const owner = c.me.role === "owner"
      if (a.status === "cancelled") {
        const gone = a.cancelled_at ? fmtDate(new Date(new Date(a.cancelled_at).getTime() + 30 * 86400_000)) : "in 30 days"
        return yield* render(c, "Account cancelled", html`
<h1>${a.name} was cancelled</h1>
<p>Everything in it will be deleted for good on ${gone}.</p>
${owner ? html`<p><a href="/admin/cancel">Changed your mind? Reactivate the account</a></p><p><a href="/admin/export">Export your data</a></p>`
  : html`<p>Ask an account owner (${owners.map((o) => o.name).join(", ")}) if you think this is a mistake.</p>`}
<p><a href="/accounts">Switch accounts</a></p>`)
      }
      const trialOver = !!a.trial_ends_on && a.trial_ends_on <= today()
      return yield* render(c, "Account on hold", html`
<h1>${a.name} is on hold</h1>
${owner
  ? html`<p>${trialOver ? "Your trial is over. Add payment info to keep going." : "Your last payment didn't go through. Update your card to keep going."} Everything is right where you left it.</p>
    <p><a href="/admin/billing" data-button>Add payment info</a></p>`
  : html`<p>This account is on hold. Ask an account owner (${owners.map((o) => o.name).join(", ")}) to update billing. Everything is right where you left it.</p>`}
${owner || isAdmin(c.me) ? html`<p><a href="/admin/export">Export your data</a></p>` : ""}
<p><a href="/accounts">Switch accounts</a></p>`)
    })),
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

const resetForm = (token: string, errs: string[]) => html`
<h1>Choose a new password</h1>
${errors(errs)}
<form method="post" action="/reset/${token}">
  <p><label>New password<br><input type="password" name="password" required autofocus></label></p>
  <button>Save and sign in</button>
</form>`

const verifyForm = (backup: boolean, errs: string[]) => html`
<h1>Two-step verification</h1>
${errors(errs)}
<form method="post" action="/signin/verify">
  ${backup
    ? html`<input type="hidden" name="backup" value="1"><p><label>Enter one of your backup codes<br><input name="code" required autofocus autocomplete="off"></label></p>`
    : html`<p><label>Enter the 6-digit code from your authenticator app<br><input name="code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" required autofocus autocomplete="one-time-code"></label></p>`}
  <button>Verify</button>
</form>
<p>${backup ? html`<a href="/signin/verify">Use your authenticator app instead</a>` : html`<a href="/signin/verify?backup=1">Use a backup code instead</a>`} · <a href="/help">Lost your device? Get help</a></p>`

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

const invitationGone = (inv: Invitation) =>
  inv.state === "used"
    ? html`<h1>This invitation was already used</h1><p><a href="/signin?email=${encodeURIComponent(inv.email)}">Sign in to get to ${inv.account?.name ?? "your account"}</a></p>`
    : html`<h1>This invitation was cancelled</h1><p>Ask whoever invited you to send a new one.</p>`

const joinForm = (token: string, inv: Extract<Invitation, { state: "open" }>, name: string, errs: string[]) => html`
<h1>Join ${inv.account.name}</h1>
<p>${inv.inviter ?? "Someone"} invited you to join ${inv.account.name} on Saintsflow.</p>
${errors(errs)}
<form method="post" action="/join/${token}">
  <p><label>Your name<br><input name="name" value="${name}" required autofocus></label></p>
  <p>Email: ${inv.person.email}</p>
  <p><label>Password<br><input type="password" name="password"></label></p>
  <p><label>Time zone (guessed from your browser)<br><input name="time_zone" id="tz" value="${inv.person.time_zone}"></label></p>
  <p><button>Join ${inv.account.name}</button> <button name="google" value="1">Join with Google</button></p>
</form>
<p><a href="/signin">Already have a Saintsflow login? Sign in to accept</a></p>
<script>try { document.getElementById("tz").value = Intl.DateTimeFormat().resolvedOptions().timeZone } catch {}</script>`

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
