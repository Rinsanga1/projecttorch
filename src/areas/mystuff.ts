// Me: assignments, bookmarks, drafts, reminders, profile, appearance, login & security, help.
// Pages: client/areas/mystuff.tsx. This file is what their forms post to.
//
//   POST /my/assignments/:rid/complete     mark something assigned to you done
//   POST /my/bookmarks/:bid/delete
//   POST /my/drafts/:rid/discard
//   POST /my/reminders/:bid/cancel
//   POST /my/profile                       name, title, bio, location, time zone, avatar
//   POST /my/appearance                    light / dark / system
//   POST /my/security/email                change your email (keeps your password and Google sign-in)
//   POST /my/security/password
//   POST /my/security/two-factor           on/off; turning it on answers with backup codes
//   POST /my/security/sign-out-others      end every other session
//   POST /help/support                     send a support request
//
// Everything here only touches the signed-in person's own rows: every query filters on c.me.id.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, json, str, hashToken } from "../lib/web.ts"
import { findRecording, updateRecording, logEvent, notify, titleOf, urlFor } from "../lib/core.ts"
import { savePrefs } from "./hey.ts"
import { checkPassword, loginFor, setPassword } from "./frontdoor.ts"
import type { Seed } from "../seed.ts"

/** Mirrored in client/areas/mystuff.tsx (the profile's time zone list). */
const TIME_ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")]

const EMAIL  = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const AVATAR = /^https?:\/\/\S+\.(jpe?g|png|gif)(\?\S*)?$/i

// ─── Reading forms ─────────────────────────────────────────────────────────

const readProfile = (fd: FormData) => ({
  name:       str(fd, "name"),
  title:      str(fd, "title"),
  bio:        str(fd, "bio"),
  location:   str(fd, "location"),
  time_zone:  str(fd, "time_zone"),
  avatar_url: str(fd, "avatar_url"),
})

// ─── My stuff ──────────────────────────────────────────────────────────────

const completeAssignment = post("/my/assignments/:rid/complete", (c) => Effect.gen(function* () {
  const { r } = yield* findRecording(c, c.params.rid, ["todo", "card", "step"])
  if (!(r.data.assignee_ids ?? []).includes(c.me.id)) return redirect("/my/assignments", "That isn't assigned to you.")
  if (r.data.completed_at)                            return redirect("/my/assignments", "That's already done.")

  const done = yield* updateRecording(c, r, { data: { completed_at: new Date().toISOString(), completer_id: c.me.id } }, { quiet: true })
  yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "completed", summary: `completed ${titleOf(r)}` })
  yield* notify(c, { personIds: r.data.notify_ids ?? [], recording: done, kind: "completed", summary: `${c.me.name} completed ${titleOf(r)}` })
  return redirect("/my/assignments", { msg: `Done: ${titleOf(r)}`, href: urlFor(r), label: "See it" })
}))

const deleteBookmark = post("/my/bookmarks/:bid/delete", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from bookmarks where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id}`
  return redirect("/my/bookmarks", "Bookmark removed.")
}))

const discardDraft = post("/my/drafts/:rid/discard", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from recordings where id = ${Number(c.params.rid) || 0} and creator_id = ${c.me.id} and status = 'drafted'`
  return redirect("/my/drafts", "Draft discarded.")
}))

const cancelReminder = post("/my/reminders/:bid/cancel", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update bubble_ups set cancelled_at = now() where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id} and surfaced_at is null`
  return redirect("/my/reminders", "Canceled. We won't remind you.")
}))

// ─── Profile & appearance ──────────────────────────────────────────────────

const saveProfile = post("/my/profile", (c) => Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const profile = readProfile(yield* c.form)

  const errors: string[] = []
  if (!profile.name)                                          errors.push("Your name can't be blank.")
  if (profile.avatar_url && !AVATAR.test(profile.avatar_url)) errors.push("That image didn't work. Use a JPG, PNG or GIF.")
  if (!TIME_ZONES.includes(profile.time_zone))                errors.push("Pick a time zone from the list.")
  if (errors.length) return invalid(errors)

  yield* sql`update people set
    name       = ${profile.name},
    title      = ${profile.title || null},
    bio        = ${profile.bio || null},
    location   = ${profile.location || null},
    time_zone  = ${profile.time_zone},
    avatar_url = ${profile.avatar_url || null}
    where id = ${c.me.id}`
  return redirect("/my/profile", "Saved.")
}))

const saveAppearance = post("/my/appearance", (c) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const picked = str(yield* c.form, "appearance")
  const theme  = picked === "light" || picked === "dark" ? picked : "system"

  yield* sql`update people set appearance = ${theme} where id = ${c.me.id}`
  // Picked on Me, where the page re-themes at once: nothing to say.
  return back(c, "/my")
}))

// ─── Login & security ──────────────────────────────────────────────────────

const changeEmail = post("/my/security/email", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const email = str(yield* c.form, "email")
  if (!EMAIL.test(email)) return invalid(["That doesn't look like an email address."])

  const [taken] = yield* sql`select 1 from people where account_id = ${c.me.account_id} and lower(email) = lower(${email}) and id <> ${c.me.id}`
  if (taken) return invalid(["Someone else here already uses that email."])

  yield* sql`update people set email = ${email} where id = ${c.me.id}`
  // Logins are by email: the new address keeps the old one's password and Google sign-in (other accounts may still use the old).
  yield* sql`insert into logins (email, password_hash, google_sub)
             select lower(${email}), password_hash, google_sub from logins where email = lower(${c.me.email})
             on conflict (email) do nothing`
  return redirect("/my/security", "Email changed.")
}))

const changePassword = post("/my/security/password", (c) => Effect.gen(function* () {
  const fd       = yield* c.form
  const current  = str(fd, "current")
  const password = str(fd, "new")
  const confirm  = str(fd, "confirm")

  // Someone with no password yet (they signed up with Google) sets one without a current password.
  const hasPassword = !!(yield* loginFor(c.me.email))?.password_hash

  const errors: string[] = []
  if (hasPassword && !(yield* checkPassword(c.me.email, current))) errors.push("Your current password isn't right.")
  if (password.length < 8)                                         errors.push("Pick a longer password: at least 8 characters.")
  if (password !== confirm)                                        errors.push("The new passwords don't match.")
  if (errors.length) return invalid(errors)

  yield* setPassword(c.me.email, password)
  return redirect("/my/security", "Password changed.")
}))

const toggleTwoFactor = post("/my/security/two-factor", (c) => Effect.gen(function* () {
  const on = !c.me.prefs.two_factor
  yield* savePrefs(c, { two_factor: on })
  if (!on) return redirect("/my/security", "Two-step verification is off.")
  // ponytail: fake backup codes shown once; real TOTP secrets and codes come with auth.
  return json({ codes: Array.from({ length: 8 }, () => crypto.randomUUID().slice(0, 8)) })
}))

// Every session of yours except the one making this request. (Under `bun run dev` with the pid cookie there's no
// session here, so it ends all of them, which is still "everywhere else".)
const signOutOthers = post("/my/security/sign-out-others", (c) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const mine = c.req.cookies.sid ? hashToken(c.req.cookies.sid) : ""

  yield* sql`delete from sessions where person_id = ${c.me.id} and token_hash <> ${mine}`
  return redirect("/my/security", "Signed out everywhere else.")
}))

// ─── Help ──────────────────────────────────────────────────────────────────

const askSupport = post("/help/support", (c) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const body = str(yield* c.form, "body")
  if (!body) return redirect("/help", "Tell us what's going on first.")

  yield* sql`insert into support_requests ${sql.insert({ person_id: c.me.id, body })}`
  return redirect("/help", `Sent. We'll reply to ${c.me.email}.`)
}))

export const routes = [
  completeAssignment,
  deleteBookmark,
  discardDraft,
  cancelReminder,
  saveProfile,
  saveAppearance,
  changeEmail,
  changePassword,
  toggleTwoFactor,
  signOutOthers,
  askSupport,
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann } = s.people

  const messages = yield* sql<{ id: number; title: string; creator_id: number }>`
    select id, title, creator_id from recordings where account_id = ${s.account.id} and type = 'message' and status = 'active' order by id`
  const kickoff = messages.find((m) => m.title.startsWith("Kickoff"))
  const pitch   = messages.find((m) => m.title.startsWith("Idea"))

  yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, project_id: s.projects.marketing.id })}`
  if (kickoff) {
    yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, recording_id: kickoff.id })}`
    yield* sql`insert into boosts ${sql.insert({ recording_id: kickoff.id, person_id: ann.id, content: "🔥 let's go" })}`
  }
  if (pitch) yield* sql`insert into boosts ${sql.insert([
    { recording_id: pitch.id, person_id: maya.id, content: "+1" },
    { recording_id: pitch.id, person_id: ann.id,  content: "yes please" },
  ])}`
})
