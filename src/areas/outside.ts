// Outside the app: every email we'd send lands in the dev inbox, where you can read it, follow its link,
// and reply to it (replying comments or answers as the recipient). Plus what push would have sent.
// ponytail: no real email or push yet. The `emails` table is the outbox; wire SMTP/APNs to it when it matters.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDateTime } from "../lib/html.ts"
import { get, pubGet, pubPost, redirect, render, str, isQuiet, type Ctx, type Person, type Account } from "../lib/web.ts"
import { findRecording, createRecording, urlFor, titleOf, type Recording } from "../lib/core.ts"
import { addComment } from "./items.ts"

type Email = {
  id: number
  to_email: string
  subject: string
  body: string
  kind: string
  link: string | null
  reply_to_recording_id: number | null
  reply_person_id: number | null
  created_at: Date
}

const KIND_NAMES: Record<string, string> = {
  notification: "Notification email",
  invite: "Invitation email",
  checkin: "Team question email",
  signin: "Sign-in link email",
  reset: "Password reset email",
  receipt: "Receipt",
  export: "Export ready",
}

const findEmail = (id: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [e] = yield* sql<Email>`select * from emails where id = ${Number(id) || 0}`
    return e ?? null
  })

/** Act as the email's recipient: replying to an email is them talking, whoever's browsing the inbox. */
const recipientCtx = (c: { form: any } & Record<string, any>, personId: number | null) =>
  Effect.gen(function* () {
    if (!personId) return null
    const sql = yield* SqlClient.SqlClient
    const [me] = yield* sql<Person>`select * from people where id = ${personId} and removed_at is null`
    if (!me) return null
    const [account] = yield* sql<Account>`select * from accounts where id = ${me.account_id}`
    return { ...c, me, account: account! } as Ctx
  })

const notFound = (c: any) => render(c, "Email not found", html`<h1>That email isn't here</h1><p><a href="/inbox">Back to the inbox</a></p>`, undefined, 404)

export const routes = [
  pubGet("/inbox", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const to = (c.query.get("to") ?? "").trim()
      // Signed in: only mail to people in this account (the same address can be in several accounts).
      const mine = c.account ? sql`and (reply_person_id is null or reply_person_id in (select id from people where account_id = ${c.account.id}))` : sql``
      const recipients = yield* sql<{ to_email: string; n: number }>`select to_email, count(*)::int as n from emails where true ${mine} group by to_email order by to_email`
      const emails = yield* sql<Email>`select * from emails where true ${mine} ${to ? sql`and lower(to_email) = lower(${to})` : sql``} order by id desc limit 200`
      return yield* render(c, "Dev inbox", html`
<h1>Dev inbox</h1>
<p>Nothing actually gets sent yet. Every email the app would send lands here instead.</p>
<form method="get" action="/inbox"><label>To <select name="to"><option value="">Everyone</option>
  ${recipients.map((r) => html`<option value="${r.to_email}"${r.to_email.toLowerCase() === to.toLowerCase() ? raw(" selected") : ""}>${r.to_email} (${r.n})</option>`)}
</select></label> <button>Filter</button></form>
${emails.length
  ? html`<table><thead><tr><th>Sent</th><th>To</th><th>Kind</th><th>Subject</th></tr></thead><tbody>
    ${emails.map((e) => html`<tr><td>${fmtDateTime(e.created_at)}</td><td>${e.to_email}</td><td>${KIND_NAMES[e.kind] ?? e.kind}</td><td><a href="/inbox/${e.id}">${e.subject}</a></td></tr>`)}
    </tbody></table>`
  : html`<p>${to ? `No emails to ${to}.` : "No emails yet. When the app would send an email, it shows up here."}</p>`}
<p><a href="/push">What push notifications would have sent</a></p>`)
    })),

  pubGet("/inbox/:id", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const e = yield* findEmail(c.params.id)
      if (!e) return yield* notFound(c)
      const [rec] = e.reply_to_recording_id ? yield* sql<Recording>`select * from recordings where id = ${e.reply_to_recording_id}` : []
      const canReply = !!(rec && e.reply_person_id && rec.status === "active")
      const isQuestion = rec?.type === "question"
      return yield* render(c, e.subject, html`
<p><a href="/inbox">← Dev inbox</a></p>
<p><small>${KIND_NAMES[e.kind] ?? e.kind}</small></p>
<dl>
  <dt>To</dt><dd>${e.to_email}</dd>
  <dt>Subject</dt><dd>${e.subject}</dd>
  <dt>Sent</dt><dd>${fmtDateTime(e.created_at)}</dd>
</dl>
<hr>
<div>${fmt(e.body)}</div>
${e.link ? html`<p><a href="${e.link}" data-button>${CTA[e.kind] ?? "Open it"}</a></p>` : ""}
${e.kind === "signin" ? html`<p><small>If you didn't ask for this, ignore it. Nobody can sign in without this link.</small></p>` : ""}
${e.kind === "reset" ? html`<p><small>If you didn't ask for this, ignore it. Your password won't change.</small></p>` : ""}
<hr>
${canReply ? html`
<form method="post" action="/inbox/${e.id}/reply">
  <p><label>${isQuestion ? "Just reply to this email with your answer." : "Reply to this email to comment"}<br>
  <textarea name="body" rows="5" cols="70" required></textarea></label></p>
  <button>Send reply</button>
  <small>(Your reply posts as the recipient, ${e.to_email}.)</small>
</form>` : ""}
${rec && e.reply_person_id && !isQuestion ? html`<form method="post" action="/inbox/${e.id}/unsubscribe"><button>Stop notifying me about this</button></form>` : ""}
${rec ? html`<p><a href="${urlFor(rec)}">View “${titleOf(rec)}” in Saintsflow</a></p>` : ""}`)
    })),

  pubPost("/inbox/:id/reply", (c) =>
    Effect.gen(function* () {
      const e = yield* findEmail(c.params.id)
      if (!e) return yield* notFound(c)
      const body = str(yield* c.form, "body")
      if (!body) return redirect(`/inbox/${e.id}`, "Your reply was empty, so nothing was posted.")
      const ctx = yield* recipientCtx(c, e.reply_person_id)
      if (!ctx || !e.reply_to_recording_id) return redirect(`/inbox/${e.id}`, "This email can't be replied to.")
      // Same access rules as the app: if they can't see it anymore, the reply bounces.
      const { r, project } = yield* findRecording(ctx, e.reply_to_recording_id)
      if (r.status !== "active") return redirect(`/inbox/${e.id}`, "That's been archived or trashed, so your reply wasn't posted.")
      const posted = r.type === "question"
        ? yield* createRecording(ctx, { project, type: "answer", parent_id: r.id, body, visible_to_clients: r.visible_to_clients, verb: `answered ${titleOf(r)}` })
        : yield* addComment(ctx, r, project, body)
      return redirect(`/inbox/${e.id}`, { msg: `Posted as ${ctx.me.name}.`, href: urlFor(posted), label: "See it" })
    })),

  pubPost("/inbox/:id/unsubscribe", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const e = yield* findEmail(c.params.id)
      if (!e) return yield* notFound(c)
      if (e.reply_to_recording_id && e.reply_person_id)
        yield* sql`delete from subscriptions where recording_id = ${e.reply_to_recording_id} and person_id = ${e.reply_person_id}`
      return redirect(`/inbox/${e.id}`, "You won't get notifications about this anymore.")
    })),

  get("/push", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ns = yield* sql<{ id: number; summary: string; recording_id: number | null; created_at: Date }>`
        select id, summary, recording_id, created_at from notifications where person_id = ${c.me.id} order by id desc limit 20`
      const on = c.me.prefs.notify_push !== false || c.me.prefs.notify_desktop !== false
      return yield* render(c, "Push notifications", html`
<h1>Push notifications</h1>
<p>Phone and desktop notifications are the same ones you see in <a href="/updates">Updates</a>. Outside your work hours, we hold them back. They wait in Updates instead.</p>
<p>${on ? "Push is on." : "Push is off."} <a href="/my/notifications">Change notification settings</a> · <a href="/my/quiet-hours">Quiet hours</a></p>
<h2>What push would have sent you</h2>
${ns.length
  ? html`<ul>${ns.map((n) => html`<li>${n.recording_id ? html`<a href="/r/${n.recording_id}/go">${n.summary}</a>` : n.summary}
    <small>${fmtDateTime(n.created_at, c.me.time_zone)}${isQuiet(c.me, new Date(n.created_at)) ? " · held back (quiet hours)" : ""}</small></li>`)}</ul>`
  : html`<p>Nothing yet. When something needs you, it'll show up here and in Updates.</p>`}`)
    })),
]

const CTA: Record<string, string> = {
  notification: "View it in Saintsflow",
  invite: "Accept the invitation",
  checkin: "Answer in Saintsflow",
  signin: "Sign in to Saintsflow",
  reset: "Choose a new password",
  export: "Download your export",
  receipt: "See your receipts",
}
