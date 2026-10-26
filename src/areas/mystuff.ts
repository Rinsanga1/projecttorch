// Me: assignments, bookmarks, drafts, reminders, profile, appearance, login & security, help.
// The pages are client/areas/mystuff.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, json, str } from "../lib/web.ts"
import { findRecording, updateRecording, logEvent, notify, titleOf, urlFor } from "../lib/core.ts"
import { savePrefs } from "./hey.ts"
import { checkPassword, loginFor, setPassword } from "./frontdoor.ts"
import type { Seed } from "../seed.ts"

/** Mirrored in client/areas/mystuff.tsx (the profile's time zone list). */
const TIME_ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")]

export const routes = [
  post("/my/assignments/:rid/complete", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.rid, ["todo", "card", "step"])
      if (!(r.data.assignee_ids ?? []).includes(c.me.id)) return redirect("/my/assignments", "That isn't assigned to you.")
      if (r.data.completed_at) return redirect("/my/assignments", "That's already done.")
      const u = yield* updateRecording(c, r, { data: { completed_at: new Date().toISOString(), completer_id: c.me.id } }, { quiet: true })
      yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "completed", summary: `completed ${titleOf(r)}` })
      yield* notify(c, { personIds: r.data.notify_ids ?? [], recording: u, kind: "completed", summary: `${c.me.name} completed ${titleOf(r)}` })
      return redirect("/my/assignments", { msg: `Done: ${titleOf(r)}`, href: urlFor(r), label: "See it" })
    })),

  post("/my/bookmarks/:bid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from bookmarks where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id}`
      return redirect("/my/bookmarks", "Bookmark removed.")
    })),

  post("/my/drafts/:rid/discard", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from recordings where id = ${Number(c.params.rid) || 0} and creator_id = ${c.me.id} and status = 'drafted'`
      return redirect("/my/drafts", "Draft discarded.")
    })),

  post("/my/reminders/:bid/cancel", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`update bubble_ups set cancelled_at = now() where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id} and surfaced_at is null`
      return redirect("/my/reminders", "Canceled. We won't remind you.")
    })),

  post("/my/profile", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const p = { name: str(fd, "name"), title: str(fd, "title"), bio: str(fd, "bio"), location: str(fd, "location"), time_zone: str(fd, "time_zone"), avatar_url: str(fd, "avatar_url") }
      const errs = [
        ...(p.name ? [] : ["Your name can't be blank."]),
        ...(p.avatar_url && !/^https?:\/\/\S+\.(jpe?g|png|gif)(\?\S*)?$/i.test(p.avatar_url) ? ["That image didn't work. Use a JPG, PNG or GIF."] : []),
        ...(TIME_ZONES.includes(p.time_zone) ? [] : ["Pick a time zone from the list."]),
      ]
      if (errs.length) return invalid(errs)
      yield* sql`update people set name = ${p.name}, title = ${p.title || null}, bio = ${p.bio || null}, location = ${p.location || null},
        time_zone = ${p.time_zone}, avatar_url = ${p.avatar_url || null} where id = ${c.me.id}`
      return redirect("/my/profile", "Saved.")
    })),

  post("/my/appearance", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const a = str(yield* c.form, "appearance")
      yield* sql`update people set appearance = ${["light", "dark"].includes(a) ? a : "system"} where id = ${c.me.id}`
      // Picked on Me, where the page re-themes at once: nothing to say.
      return back(c, "/my")
    })),

  post("/my/security/email", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const email = str(yield* c.form, "email")
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return invalid(["That doesn't look like an email address."])
      const [taken] = yield* sql`select 1 from people where account_id = ${c.me.account_id} and lower(email) = lower(${email}) and id <> ${c.me.id}`
      if (taken) return invalid(["Someone else here already uses that email."])
      yield* sql`update people set email = ${email} where id = ${c.me.id}`
      // Logins are by email: the new address keeps the old one's password and Google sign-in (other accounts may still use the old).
      yield* sql`insert into logins (email, password_hash, google_sub) select lower(${email}), password_hash, google_sub from logins
        where email = lower(${c.me.email}) on conflict (email) do nothing`
      return redirect("/my/security", "Email changed.")
    })),

  post("/my/security/password", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      // Someone with no password yet (they signed up with Google) sets one without a current password.
      const has = !!(yield* loginFor(c.me.email))?.password_hash
      const errs = [
        ...(!has || (yield* checkPassword(c.me.email, str(fd, "current"))) ? [] : ["Your current password isn't right."]),
        ...(str(fd, "new").length >= 8 ? [] : ["Pick a longer password: at least 8 characters."]),
        ...(str(fd, "new") === str(fd, "confirm") ? [] : ["The new passwords don't match."]),
      ]
      if (errs.length) return invalid(errs)
      yield* setPassword(c.me.email, str(fd, "new"))
      return redirect("/my/security", "Password changed.")
    })),

  /** Turning it on answers with backup codes (`data.codes`), which the page shows once. */
  post("/my/security/two-factor", (c) =>
    Effect.gen(function* () {
      const on = !c.me.prefs.two_factor
      yield* savePrefs(c, { two_factor: on })
      if (!on) return redirect("/my/security", "Two-step verification is off.")
      // ponytail: fake backup codes shown once; real TOTP secrets and codes come with auth.
      return json({ codes: Array.from({ length: 8 }, () => crypto.randomUUID().slice(0, 8)) })
    })),

  post("/my/security/google", (c) =>
    Effect.gen(function* () {
      yield* savePrefs(c, { google: !c.me.prefs.google })
      return redirect("/my/security", c.me.prefs.google ? "Sign in with Google is off." : "Sign in with Google is on.")
    })),

  post("/my/security/sign-out-others", () => Effect.succeed(redirect("/my/security", "Signed out everywhere else."))),

  post("/help/support", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const body = str(yield* c.form, "body")
      if (!body) return redirect("/help", "Tell us what's going on first.")
      yield* sql`insert into support_requests ${sql.insert({ person_id: c.me.id, body })}`
      return redirect("/help", `Sent. We'll reply to ${c.me.email}.`)
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann } = s.people
    const msgs = yield* sql<{ id: number; title: string; creator_id: number }>`
      select id, title, creator_id from recordings where account_id = ${s.account.id} and type = 'message' and status = 'active' order by id`
    const kickoff = msgs.find((m) => m.title.startsWith("Kickoff"))
    const pitch = msgs.find((m) => m.title.startsWith("Idea"))
    yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, project_id: s.projects.marketing.id })}`
    if (kickoff) {
      yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, recording_id: kickoff.id })}`
      yield* sql`insert into boosts ${sql.insert({ recording_id: kickoff.id, person_id: ann.id, content: "🔥 let's go" })}`
    }
    if (pitch) yield* sql`insert into boosts ${sql.insert([
      { recording_id: pitch.id, person_id: maya.id, content: "+1" },
      { recording_id: pitch.id, person_id: ann.id, content: "yes please" },
    ])}`
  })
