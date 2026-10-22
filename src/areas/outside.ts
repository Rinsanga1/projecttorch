// Outside the app: every email we'd send lands in the dev inbox, where you can read it, follow its link,
// and reply to it (replying comments or answers as the recipient). Plus what push would have sent.
// The pages are client/areas/outside.tsx; `emails` aren't synced, so the inbox reads them from here.
// ponytail: no real email or push yet. The `emails` table is the outbox; wire SMTP/APNs to it when it matters.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { pubGet, pubPost, redirect, json, str, type Ctx, type PubCtx, type Person, type Account } from "../lib/web.ts"
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

const findEmail = (id: string | undefined) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [e] = yield* sql<Email>`select * from emails where id = ${Number(id) || 0}`
    return e ?? null
  })

/** Act as the email's recipient: replying to an email is them talking, whoever's browsing the inbox. */
const recipientCtx = (c: PubCtx, personId: number | null) =>
  Effect.gen(function* () {
    if (!personId) return null
    const sql = yield* SqlClient.SqlClient
    const [me] = yield* sql<Person>`select * from people where id = ${personId} and removed_at is null`
    if (!me) return null
    const [account] = yield* sql<Account>`select * from accounts where id = ${me.account_id}`
    return { ...c, me, account: account! } as Ctx
  })

// A missing email: the page for it says "That email isn't here".
const notFound = (c: PubCtx) => redirect(`/inbox/${c.params.id}`)

export const routes = [
  pubGet("/inbox", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const to = (c.query.get("to") ?? "").trim()
      // Signed in: only mail to people in this account (the same address can be in several accounts).
      const mine = c.account ? sql`and (reply_person_id is null or reply_person_id in (select id from people where account_id = ${c.account.id}))` : sql``
      const recipients = yield* sql<{ to_email: string; n: number }>`select to_email, count(*)::int as n from emails where true ${mine} group by to_email order by to_email`
      const emails = yield* sql<Email>`select * from emails where true ${mine} ${to ? sql`and lower(to_email) = lower(${to})` : sql``} order by id desc limit 200`
      return json({ recipients, emails: emails.map(({ id, to_email, kind, subject, created_at }) => ({ id, to_email, kind, subject, created_at })) })
    })),

  /** One email, plus what its reply form needs to know about the thing it's about. */
  pubGet("/inbox/:id", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const e = yield* findEmail(c.params.id)
      if (!e) return json({ email: null })
      const [rec] = e.reply_to_recording_id ? yield* sql<Recording>`select * from recordings where id = ${e.reply_to_recording_id}` : []
      return json({
        email: { id: e.id, to_email: e.to_email, subject: e.subject, body: e.body, kind: e.kind, link: e.link, created_at: e.created_at },
        rec: rec ? { href: urlFor(rec), title: titleOf(rec), question: rec.type === "question", active: rec.status === "active", replyable: !!e.reply_person_id } : null,
      })
    })),

  pubPost("/inbox/:id/reply", (c) =>
    Effect.gen(function* () {
      const e = yield* findEmail(c.params.id)
      if (!e) return notFound(c)
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
      if (!e) return notFound(c)
      if (e.reply_to_recording_id && e.reply_person_id)
        yield* sql`delete from subscriptions where recording_id = ${e.reply_to_recording_id} and person_id = ${e.reply_person_id}`
      return redirect(`/inbox/${e.id}`, "You won't get notifications about this anymore.")
    })),
]
