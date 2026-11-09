// The front door: sign up, first run, sign in (password, emailed link, Google), forgot/reset password,
// two-step verification, accepting an invitation, the account chooser, account on hold. Posts: src/areas/frontdoor.ts.
// Most of these work signed out, so what they need from the server (an invite, a reset link) comes from useApi.
import { useEffect, useRef, useState } from "react"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, meOrNull, account, useApi } from "../data.ts"
import { isAdmin } from "../../shared/domain.ts"
import { fmtDate, ms, today } from "../../shared/format.ts"
import { Errors, Form, usePost } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"

const LINK_MINUTES = 15
const UNKNOWN_EMAIL = "We don't know that email address. Check for typos, or sign up."

/** On Sign in or Sign up while already signed in: say so, and offer the way in (or out). */
const AlreadyIn = ({ title }: { title: string }) => {
  const m = meOrNull()!
  return (
    <Page title={title}>
      <h1>You're already signed in</h1>
      <p>You're signed in as <b>{m.name}</b> ({m.email}).</p>
      <p><a href="/" data-button>Go to ProjectTorch</a></p>
      <Form action="/signout"><button>Sign out, then {title === "Sign up" ? "sign up" : "sign in"} as someone else</button></Form>
    </Page>
  )
}

/** The page to go back to after signing in (?next=, set when a signed-out page sent you here). */
const useNext = () => useSearchParams()[0].get("next") ?? ""
const NextField = () => {
  const next = useNext()
  return next ? <input type="hidden" name="next" value={next} /> : null
}

/** Off to Google and back (a full page load, not a route), when the server has Google set up. */
const GoogleLink = ({ then, children }: { then: string; children: React.ReactNode }) => {
  const { data } = useApi<{ google: boolean }>("/auth/options")
  const next = useNext()
  return data?.google ? <p><a href={`/api/auth/google?then=${encodeURIComponent(then)}${next ? `&next=${encodeURIComponent(next)}` : ""}`}>{children}</a></p> : null
}

const EmailStep = ({ email, errs = [] }: { email: string; errs?: string[] }) => (
  <>
    <h1>Sign in</h1>
    <Errors list={errs} />
    <GetForm method="get" action="/signin">
      <NextField />
      <p><label>Email address<br /><input type="email" name="email" defaultValue={email} required autoFocus /></label></p>
      <button>Next</button>
    </GetForm>
    <GoogleLink then="signin">Sign in with Google</GoogleLink>
    <p><a href="/signup">New here? Try it free</a></p>
  </>
)

const PasswordStep = ({ email }: { email: string }) => (
  <>
    <h1>Sign in</h1>
    <Form action="/signin">
      <NextField />
      <input type="hidden" name="email" value={email} />
      <p>Signing in as <b>{email}</b> <a href="/signin">(not you?)</a></p>
      <p><label>Password<br /><input type="password" name="password" autoFocus /></label></p>
      <p><button>Sign in</button></p>
    </Form>
    <GoogleLink then="signin">Sign in with Google</GoogleLink>
    <Form action="/signin/link"><input type="hidden" name="email" value={email} /><button>Email me a link to sign in instead</button></Form>
    <p><a href={`/forgot?email=${encodeURIComponent(email)}`}>Forgot your password?</a> · <a href="/signup">New here? Try it free</a></p>
  </>
)

/** Posts once when the page opens (an emailed link that does something); shows `gone` if the reply says so. */
const OpenLink = ({ action, gone }: { action: string; gone: React.ReactNode }) => {
  const post = usePost()
  const [expired, setExpired] = useState(false)
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    post(action).then((r) => r.data?.expired && setExpired(true))
  }, [action])
  return expired ? <>{gone}</> : <p>Signing you in…</p>
}

const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } }

type Invite =
  | { state: "open"; account: string; inviter: string | null; name: string; email: string; time_zone: string; google: string | null }
  | { state: "used"; account: string | null; email: string }
  | { state: "gone" }
  | { state: "team"; account: string; already_in: boolean; email: string; name: string; google: string | null }

/** The team link's sign-up: a name tag, after Campfire. */
const JoinTeam = ({ code, t }: { code: string; t: Extract<Invite, { state: "team" }> }) => {
  if (t.already_in) return <Page title={`Join ${t.account}`}><h1>You're already in {t.account}</h1><p><a href="/" data-button>Go to {t.account}</a></p></Page>
  return (
    <Page title={`Join ${t.account}`}>
      <h1>Join {t.account}</h1>
      <p>Someone at {t.account} shared this link so you can join them on ProjectTorch.</p>
      <Form action={`/join/${code}`}>
        <p><label>Your name<br /><input name="name" defaultValue={t.name} required autoFocus /></label></p>
        {t.google
          ? <p><input type="hidden" name="google" value="1" />Joining with Google as <b>{t.google}</b></p>
          : <>
            <p><label>Email address<br /><input type="email" name="email" defaultValue={t.email} required /></label></p>
            <p><label>Password (8 characters or more, or your ProjectTorch password if you have one)<br /><input type="password" name="password" required minLength={8} /></label></p>
          </>}
        <input type="hidden" name="time_zone" value={browserTz() ?? ""} />
        <p><button>Join {t.account}</button></p>
      </Form>
      {!t.google && <GoogleLink then={`join:${code}`}>Join with Google</GoogleLink>}
    </Page>
  )
}

export const routes = [
  // Sign up
  // Back from Google with no account yet: ?google=1&name=&email=, and who they are rides in a signed cookie.
  page("/signup", () => {
    const [q] = useSearchParams()
    if (meOrNull()) return <AlreadyIn title="Sign up" />
    const google = q.get("google") === "1"
    return (
      <Page title="Sign up">
        <h1>Sign up</h1>
        <p>Start a new account. One short form, then you're inside.</p>
        <Form action="/signup">
          <p><label>Your name<br /><input name="name" defaultValue={q.get("name") ?? ""} required autoFocus /></label></p>
          {google
            ? <p><input type="hidden" name="google" value="1" />Signing up with Google as <b>{q.get("email")}</b> <a href="/signup">(use a password instead)</a></p>
            : <p><label>Email address<br /><input type="email" name="email" required /></label></p>}
          <p><label>Company or team name<br /><input name="company" required /></label></p>
          {!google && <p><label>Password (8 characters or more)<br /><input type="password" name="password" required minLength={8} /></label></p>}
          <p><button>Make my account</button></p>
        </Form>
        {!google && <GoogleLink then="signup">Sign up with Google</GoogleLink>}
        <p><a href="/signin">Already have an account? Sign in</a></p>
      </Page>
    )
  }, { pub: true }),

  // First run
  page("/welcome", () => {
    return (
      <Page title="Welcome">
        <h1>Welcome! Let's get your first project going.</h1>
        <Form action="/welcome">
          <p><label>What are you working on?<br /><input name="name" required autoFocus placeholder="e.g. Website redesign" /></label></p>
          <button>Make this project</button>
        </Form>
        <p>Or start from <a href="/templates">a template</a>, a project that comes ready.</p>
        <p><a href="/">Skip, take me Home</a></p>
      </Page>
    )
  }),

  // Sign in: email first, then a password, an emailed link, or Google.
  page("/signin", () => {
    const [q] = useSearchParams()
    const email = (q.get("email") ?? "").trim()
    const { data } = useApi<{ known: boolean }>(email ? `/signin?email=${encodeURIComponent(email)}` : null)
    if (meOrNull()) return <AlreadyIn title="Sign in" />
    return (
      <Page title="Sign in">
        {!email ? <EmailStep email="" />
          : !data ? null
          : data.known ? <PasswordStep key={email} email={email} />
          : <EmailStep key={email} email={email} errs={[UNKNOWN_EMAIL]} />}
      </Page>
    )
  }, { pub: true }),

  page("/signin/link-sent", () => {
    const email = useSearchParams()[0].get("email") ?? ""
    return (
      <Page title="Check your email">
        <h1>Check your email</h1>
        <p>We sent a sign-in link to <b>{email}</b>. It works once and expires in {LINK_MINUTES} minutes.</p>
        <Form action="/signin/link"><input type="hidden" name="email" value={email} /><button>Didn't get it? Send it again</button></Form>
        <p><a href={`/signin?email=${encodeURIComponent(email)}`}>Sign in with a password instead</a></p>
        <p><small>Nothing really gets emailed yet. Open it in the <a href={`/inbox?to=${encodeURIComponent(email)}`}>dev inbox</a>.</small></p>
      </Page>
    )
  }, { pub: true }),

  page("/signin/link/:token", () => (
    <Page title="Sign in">
      <OpenLink action={`/signin/link/${useParams().token}`} gone={
        <><h1>This link has expired</h1><p>Sign-in links work once and expire after {LINK_MINUTES} minutes.</p><p><a href="/signin">Ask for a new one</a></p></>
      } />
    </Page>
  ), { pub: true }),

  // Forgot / reset password
  page("/forgot", () => {
    const [q] = useSearchParams()
    return (
      <Page title="Forgot password">
        {q.get("sent") ? (
          <>
            <h1>Check your email</h1><p>If there's an account for <b>{q.get("email") ?? ""}</b>, we sent reset instructions to it.</p>
            <p><a href="/signin">Back to sign in</a> · <small><a href="/inbox">Dev inbox</a></small></p>
          </>
        ) : (
          <>
            <h1>Forgot your password?</h1>
            <Form action="/forgot">
              <p><label>Email address<br /><input type="email" name="email" defaultValue={q.get("email") ?? ""} required autoFocus /></label></p>
              <button>Send me reset instructions</button>
            </Form>
            <p><a href="/signin">Never mind, back to sign in</a></p>
          </>
        )}
      </Page>
    )
  }, { pub: true }),

  page("/reset/:token", () => {
    const token = useParams().token!
    const { data } = useApi<{ ok: boolean }>(`/reset/${token}`)
    if (!data) return <Page title="Choose a new password">{null}</Page>
    if (!data.ok) return <Page title="Link expired"><h1>This reset link has expired</h1><p><a href="/forgot">Ask for a new one</a></p></Page>
    return (
      <Page title="Choose a new password">
        <h1>Choose a new password</h1>
        <Form action={`/reset/${token}`}>
          <p><label>New password<br /><input type="password" name="password" required autoFocus /></label></p>
          <button>Save and sign in</button>
        </Form>
      </Page>
    )
  }, { pub: true }),

  // Two-step verification
  page("/signin/verify", () => {
    const backup = useSearchParams()[0].get("backup") === "1"
    return (
      <Page title="Two-step verification">
        <h1>Two-step verification</h1>
        <Form action="/signin/verify" key={String(backup)}>
          <NextField />
          {backup
            ? <><input type="hidden" name="backup" value="1" /><p><label>Enter one of your backup codes<br /><input name="code" required autoFocus autoComplete="off" /></label></p></>
            : <p><label>Enter the 6-digit code from your authenticator app<br /><input name="code" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} required autoFocus autoComplete="one-time-code" /></label></p>}
          <button>Verify</button>
        </Form>
        <p>{backup ? <a href="/signin/verify">Use your authenticator app instead</a> : <a href="/signin/verify?backup=1">Use a backup code instead</a>} · <a href="/help">Lost your device? Get help</a></p>
      </Page>
    )
  }, { pub: true }),

  // Accept an invitation
  page("/join/:token", () => {
    const token = useParams().token!
    const { data: inv } = useApi<Invite>(`/join/${token}`)
    if (!inv) return <Page title="Invitation">{null}</Page>
    if (inv.state === "team") return <JoinTeam code={token} t={inv} />
    if (inv.state === "used")
      return <Page title="Invitation"><h1>This invitation was already used</h1><p><a href={`/signin?email=${encodeURIComponent(inv.email)}`}>Sign in to get to {inv.account ?? "your account"}</a></p></Page>
    if (inv.state === "gone")
      return <Page title="Invitation"><h1>This invitation was cancelled</h1><p>Ask whoever invited you to send a new one.</p></Page>
    return (
      <Page title={`Join ${inv.account}`}>
        <h1>Join {inv.account}</h1>
        <p>{inv.inviter ?? "Someone"} invited you to join {inv.account} on ProjectTorch.</p>
        <Form action={`/join/${token}`}>
          <p><label>Your name<br /><input name="name" defaultValue={inv.name} required autoFocus /></label></p>
          <p>Email: {inv.email}</p>
          {inv.google
            ? <p><input type="hidden" name="google" value="1" />Joining with Google as <b>{inv.google}</b></p>
            : <p><label>Password (8 characters or more)<br /><input type="password" name="password" required minLength={8} /></label></p>}
          <p><label>Time zone (guessed from your browser)<br /><input name="time_zone" id="tz" defaultValue={browserTz() ?? inv.time_zone} /></label></p>
          <p><button>Join {inv.account}</button></p>
        </Form>
        {!inv.google && <GoogleLink then={`join:${token}`}>Join with Google</GoogleLink>}
        <p><a href="/signin">Already have a ProjectTorch login? Sign in to accept</a></p>
      </Page>
    )
  }, { pub: true }),

  // Account chooser
  page("/accounts", () => {
    const m = me()
    const { data: mine, error } = useApi<Array<{ id: number; account_name: string; logo_url: string | null }>>("/accounts")
    return (
      <Page title="Your accounts">
        <h1>Your accounts</h1>
        <p>Signed in as {m.email}.</p>
        {error && <p role="alert">{error}</p>}
        <ul>{mine?.map((p) => (
          <li key={p.id}>
            <Form action="/accounts" style={{ display: "inline" }}>
              <input type="hidden" name="person_id" value={p.id} />
              {p.logo_url && <><img src={p.logo_url} alt="" width={24} height={24} /> </>}<button>{p.account_name}</button>{p.id === m.id ? " (you're here now)" : ""}
            </Form>
          </li>
        ))}</ul>
        <p><a href="/my/security">Your login & security</a></p>
        <Form action="/signout"><button>Sign out</button></Form>
      </Page>
    )
  }),

  // Account on hold
  page("/lockout", () => {
    const m = me()
    const a = account()
    if (a.status === "active" || a.status === "trial") return <Navigate to="/" replace />
    const owners = [...db.people.values()].filter((p) => p.account_id === a.id && p.role === "owner" && !p.removed_at).map((p) => p.name).sort((x, y) => x.localeCompare(y))
    const owner = m.role === "owner"
    if (a.status === "cancelled") {
      const gone = a.cancelled_at ? fmtDate(new Date(ms(a.cancelled_at) + 30 * 86400_000)) : "in 30 days"
      return (
        <Page title="Account cancelled">
          <h1>{a.name} was cancelled</h1>
          <p>Everything in it will be deleted for good on {gone}.</p>
          {owner
            ? <><p><a href="/admin/cancel">Changed your mind? Reactivate the account</a></p><p><a href="/admin/export">Export your data</a></p></>
            : <p>Ask an account owner ({owners.join(", ")}) if you think this is a mistake.</p>}
          <p><a href="/accounts">Switch accounts</a></p>
        </Page>
      )
    }
    const trialOver = !!a.trial_ends_on && a.trial_ends_on <= today()
    return (
      <Page title="Account on hold">
        <h1>{a.name} is on hold</h1>
        {owner
          ? <><p>{trialOver ? "Your trial is over. Add payment info to keep going." : "Your last payment didn't go through. Update your card to keep going."} Everything is right where you left it.</p>
            <p><a href="/admin/billing" data-button>Add payment info</a></p></>
          : <p>This account is on hold. Ask an account owner ({owners.join(", ")}) to update billing. Everything is right where you left it.</p>}
        {(owner || isAdmin(m)) && <p><a href="/admin/export">Export your data</a></p>}
        <p><a href="/accounts">Switch accounts</a></p>
      </Page>
    )
  }),
]
