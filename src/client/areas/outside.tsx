// Outside the app: the dev inbox, where every email we'd send lands (read it, follow its link, reply as the
// recipient), and what push would have sent. Posts: src/areas/outside.ts. Emails aren't synced: they come from useApi.
import { Form as GetForm, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, useApi } from "../data.ts"
import { isQuiet } from "../../shared/domain.ts"
import { fmtDateTime } from "../../shared/format.ts"
import { Fmt } from "../ui/kit.tsx"
import { Form } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"

const KIND_NAMES: Record<string, string> = {
  notification: "Notification email",
  invite: "Invitation email",
  signin: "Sign-in link email",
  reset: "Password reset email",
  receipt: "Receipt",
  export: "Export ready",
}

const CTA: Record<string, string> = {
  notification: "View it in ProjectTorch",
  invite: "Accept the invitation",
  signin: "Sign in to ProjectTorch",
  reset: "Choose a new password",
  export: "Download your export",
  receipt: "See your receipts",
}

type Inbox = { recipients: { to_email: string; n: number }[]; emails: { id: number; to_email: string; kind: string; subject: string; created_at: string }[] }
type Email = {
  email: { id: number; to_email: string; subject: string; body: string; kind: string; link: string | null; created_at: string } | null
  rec?: { href: string; title: string; active: boolean; replyable: boolean } | null
}

export const routes = [
  page("/inbox", () => {
    const [q] = useSearchParams()
    const to = (q.get("to") ?? "").trim()
    const { data, error } = useApi<Inbox>(`/inbox${to ? `?to=${encodeURIComponent(to)}` : ""}`)
    return (
      <Page title="Dev inbox">
        <h1>Dev inbox</h1>
        <p>Nothing actually gets sent yet. Every email the app would send lands here instead.</p>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <GetForm method="get" action="/inbox" key={to}><label>To <select name="to" defaultValue={data.recipients.find((r) => r.to_email.toLowerCase() === to.toLowerCase())?.to_email ?? ""}>
              <option value="">Everyone</option>
              {data.recipients.map((r) => <option key={r.to_email} value={r.to_email}>{r.to_email} ({r.n})</option>)}
            </select></label> <button>Filter</button></GetForm>
            {data.emails.length ? (
              <table><thead><tr><th>Sent</th><th>To</th><th>Kind</th><th>Subject</th></tr></thead><tbody>
                {data.emails.map((e) => <tr key={e.id}><td>{fmtDateTime(e.created_at)}</td><td>{e.to_email}</td><td>{KIND_NAMES[e.kind] ?? e.kind}</td><td><a href={`/inbox/${e.id}`}>{e.subject}</a></td></tr>)}
              </tbody></table>
            ) : <p>{to ? `No emails to ${to}.` : "No emails yet. When the app would send an email, it shows up here."}</p>}
          </>
        )}
        <p><a href="/push">What push notifications would have sent</a></p>
      </Page>
    )
  }, { pub: true }),

  page("/inbox/:id", () => {
    const { data, error } = useApi<Email>(`/inbox/${useParams().id}`)
    if (error) return <Page title="Dev inbox"><p role="alert">{error}</p></Page>
    if (!data) return <Page title="Dev inbox">{null}</Page>
    const { email: e, rec } = data
    if (!e) return <Page title="Email not found"><h1>That email isn't here</h1><p><a href="/inbox">Back to the inbox</a></p></Page>
    return (
      <Page title={e.subject}>
        <p><a href="/inbox">← Dev inbox</a></p>
        <p><small>{KIND_NAMES[e.kind] ?? e.kind}</small></p>
        <dl>
          <dt>To</dt><dd>{e.to_email}</dd>
          <dt>Subject</dt><dd>{e.subject}</dd>
          <dt>Sent</dt><dd>{fmtDateTime(e.created_at)}</dd>
        </dl>
        <hr />
        <Fmt text={e.body} />
        {e.link && <p><a href={e.link} data-button>{CTA[e.kind] ?? "Open it"}</a></p>}
        {e.kind === "signin" && <p><small>If you didn't ask for this, ignore it. Nobody can sign in without this link.</small></p>}
        {e.kind === "reset" && <p><small>If you didn't ask for this, ignore it. Your password won't change.</small></p>}
        <hr />
        {rec?.replyable && rec.active && (
          <Form action={`/inbox/${e.id}/reply`}>
            <p><label>Reply to this email to comment<br />
              <textarea name="body" rows={5} cols={70} required /></label></p>
            <button>Send reply</button>{" "}
            <small>(Your reply posts as the recipient, {e.to_email}.)</small>
          </Form>
        )}
        {rec?.replyable && <Form action={`/inbox/${e.id}/unsubscribe`}><button>Stop notifying me about this</button></Form>}
        {rec && <p><a href={rec.href}>View “{rec.title}” in ProjectTorch</a></p>}
      </Page>
    )
  }, { pub: true }),

  page("/push", () => {
    const m = me()
    const ns = [...db.notifications.values()].filter((n) => n.person_id === m.id).sort((a, b) => b.id - a.id).slice(0, 20)
    const on = m.prefs.notify_push !== false || m.prefs.notify_desktop !== false
    return (
      <Page title="Push notifications">
        <h1>Push notifications</h1>
        <p>Phone and desktop notifications are the same ones you see in <a href="/updates">Updates</a>. Outside your work hours, we hold them back. They wait in Updates instead.</p>
        <p>{on ? "Push is on." : "Push is off."} <a href="/my/notifications">Change notification settings</a> · <a href="/my/quiet-hours">Quiet hours</a></p>
        <h2>What push would have sent you</h2>
        {ns.length
          ? <ul>{ns.map((n) => (
            <li key={n.id}>{n.recording_id ? <a href={`/r/${n.recording_id}/go`}>{n.summary}</a> : n.summary}{" "}
              <small>{fmtDateTime(n.created_at, m.time_zone)}{isQuiet(m, new Date(n.created_at)) ? " · held back (quiet hours)" : ""}</small></li>
          ))}</ul>
          : <p>Nothing yet. When something needs you, it'll show up here and in Updates.</p>}
      </Page>
    )
  }),
]
