// People & clients: invite people, pending invitations, the team link, client access for a project.
// Pages: client/areas/people.tsx (the directory, profiles, the invite form, the client preview).
// This file is what their forms post to.
//
//   POST /people/invite                       invite someone (staff or client)
//   POST /people/pending/:pid/resend          resend an invitation
//   POST /people/pending/:pid/cancel          cancel an invitation
//   POST /people/join-link                    new team link; the old one stops working   (admins)
//   POST /projects/:id/clients                do new things start visible to clients?
//   POST /projects/:id/clients/:pid/remove    take a client off a project

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, invalid, str, ids, isAdmin, isClient, NoAccess, NotFound, type Ctx, type Person } from "../lib/web.ts"
import { findProject, visibleProjects, canInvite, sendEmail, projectUrl, logEvent } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

type Company = { id: number; name: string }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ─── Helpers ───────────────────────────────────────────────────────────────

const readInvite = (fd: FormData, visibleProjectIds: ReadonlyArray<number>) => ({
  who:         str(fd, "who") === "client" ? "client" as const : "staff" as const,
  name:        str(fd, "name"),
  email:       str(fd, "email").toLowerCase(),
  title:       str(fd, "title"),
  company_id:  Number(str(fd, "company_id")) || null,
  new_company: str(fd, "new_company"),
  note:        str(fd, "note"),
  // Only projects the inviter can see. Anything else in the form is ignored.
  project_ids: ids(fd, "project_ids").filter((id) => visibleProjectIds.includes(id)),
})

/** Send (or resend) the invitation email. */
const sendInvite = (c: Ctx, p: Person, note: string, projectNames: ReadonlyArray<string>) => {
  const toWorkOn = projectNames.length ? `, to work on ${projectNames.join(", ")}` : ""
  const quoted   = note ? `\n\n“${note}”` : ""
  return sendEmail(p, {
    subject: `${c.me.name} invited you to ${c.account.name}'s ProjectTorch`,
    body:    `${c.me.name} invited you to join ${c.account.name} on ProjectTorch${toWorkOn}.${quoted}\n\nAccept the invitation to set up your login.`,
    kind:    "invite",
    link:    `/join/${p.invite_token}`,
  }, true)
}

/** A never-joined person the current person may resend or cancel: admins any, others only their own invites. */
const pendingInvite = (c: Ctx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [p] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id}
                                 and joined_at is null and removed_at is null`
  if (!p) return yield* new NotFound()
  if (!canInvite(c) || !(isAdmin(c.me) || p.invited_by === c.me.id)) return yield* new NoAccess()
  return p
})

// ─── Invitations ───────────────────────────────────────────────────────────

const invite = post("/people/invite", (c) => Effect.gen(function* () {
  if (!canInvite(c)) return yield* new NoAccess()
  const sql      = yield* SqlClient.SqlClient
  const projects = yield* visibleProjects(c)
  const v        = readInvite(yield* c.form, projects.map((p) => p.id))

  const errors: string[] = []
  if (!v.name)                                               errors.push("Add their name.")
  if (!EMAIL.test(v.email))                                  errors.push("That doesn't look like an email address.")
  if (v.who === "client" && !v.company_id && !v.new_company) errors.push("Pick or name the client's company.")

  // Errors are plain text, so the old links ("See …'s profile", "Resend the invitation") are spelled out.
  const [existing] = yield* sql<Person>`select * from people where account_id = ${c.me.account_id} and lower(email) = ${v.email}`
  if (existing && !existing.removed_at) {
    if (existing.joined_at) errors.push(`${v.email} is already in this account. See ${existing.name}'s profile in Everyone.`)
    else                    errors.push(`${v.email} was already invited. Resend the invitation from Pending invitations.`)
  }
  if (errors.length) return invalid(errors)

  // The company: one picked from this account, or a new name (reusing a company that already has it).
  const companies = yield* sql<Company>`select id, name from companies where account_id = ${c.me.account_id} order by name`
  let companyId = companies.some((k) => k.id === v.company_id) ? v.company_id : null
  if (v.new_company) {
    const same = companies.find((k) => k.name.toLowerCase() === v.new_company.toLowerCase())
    if (same) companyId = same.id
    else      companyId = (yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: c.me.account_id, name: v.new_company })} returning id`)[0]!.id
  }

  const fields = {
    name:         v.name,
    title:        v.title || null,
    company_id:   companyId,
    role:         v.who === "client" ? "client" : "member",
    invited_by:   c.me.id,
    invite_token: crypto.randomUUID(),
    invited_at:   new Date(),
    joined_at:    null,
    removed_at:   null,
  }
  // A removed person coming back gets their old row (email is unique per account).
  const [p] = existing
    ? yield* sql<Person>`update people set ${sql.update(fields)} where id = ${existing.id} returning *`
    : yield* sql<Person>`insert into people ${sql.insert({ ...fields, account_id: c.me.account_id, email: v.email, prefs: JSON.stringify({ notify_email: true }) })} returning *`

  for (const projectId of v.project_ids)
    yield* sql`insert into project_people (project_id, person_id) values (${projectId}, ${p!.id}) on conflict do nothing`

  const projectNames = projects.filter((x) => v.project_ids.includes(x.id)).map((x) => x.name)
  yield* sendInvite(c, p!, v.note, projectNames)
  yield* logEvent(c, { project_id: v.project_ids[0] ?? null, action: "invited", summary: `invited ${v.name}${v.who === "client" ? " (client)" : ""}` })
  return redirect("/people/pending", { msg: `Invitation sent to ${v.email}.`, href: "/inbox", label: "See the email" })
}))

const resendInvite = post("/people/pending/:pid/resend", (c) => Effect.gen(function* () {
  const p   = yield* pendingInvite(c)
  const sql = yield* SqlClient.SqlClient

  const [updated] = yield* sql<Person>`update people set invited_at = now() where id = ${p.id} returning *`
  yield* sendInvite(c, updated!, "", [])
  return redirect("/people/pending", { msg: `Invitation resent to ${p.email}.`, href: "/inbox", label: "See the email" })
}))

const cancelInvite = post("/people/pending/:pid/cancel", (c) => Effect.gen(function* () {
  const p   = yield* pendingInvite(c)
  const sql = yield* SqlClient.SqlClient

  yield* sql`delete from people where id = ${p.id} and joined_at is null`
  return redirect("/people/pending", `Cancelled the invitation for ${p.email}.`)
}))

const newJoinLink = post("/people/join-link", (c) => Effect.gen(function* () {
  if (!isAdmin(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient

  yield* sql`update accounts set join_code = default where id = ${c.me.account_id}`
  yield* logEvent(c, { project_id: null, action: "reset", summary: "made a new team link" })
  return redirect("/people", "Made a new team link. The old one no longer works.")
}))

// ─── Client access for a project ───────────────────────────────────────────

const setClientsSeeNew = post("/projects/:id/clients", (c) => Effect.gen(function* () {
  const project = yield* findProject(c, c.params.id)
  if (isClient(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient

  const visible = str(yield* c.form, "see_new") === "visible"
  yield* sql`update projects set clients_see_new = ${visible} where id = ${project.id}`
  if (visible) return redirect(projectUrl(project), "New things will be visible to clients.")
  return redirect(projectUrl(project), "New things start out hidden from clients.")
}))

const removeClient = post("/projects/:id/clients/:pid/remove", (c) => Effect.gen(function* () {
  const project = yield* findProject(c, c.params.id)
  if (isClient(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient

  const [client] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id} and role = 'client'`
  if (!client) return yield* new NotFound()

  yield* sql`delete from project_people where project_id = ${project.id} and person_id = ${client.id}`
  return redirect(`/projects/${project.id}/clients`, `${client.name} isn't on ${project.name} anymore.`)
}))

export const routes = [
  invite,
  resendInvite,
  cancelInvite,
  newJoinLink,
  setClientsSeeNew,
  removeClient,
]

// ─── Sample data ───────────────────────────────────────────────────────────

// Eve has a pending invitation (and the email that went with it).
export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const [eve] = yield* sql<Person>`insert into people ${sql.insert({
    account_id:   s.account.id,
    name:         "Eve Park",
    email:        "eve@acme.test",
    title:        "Writer",
    role:         "member",
    invited_by:   s.people.maya.id,
    invite_token: "demo-invite-token",
    invited_at:   new Date(Date.now() - 2 * 86400_000),
    prefs:        JSON.stringify({ notify_email: true }),
    company_id:   s.people.maya.company_id,
  })} returning *`
  yield* sql`insert into project_people (project_id, person_id) values (${s.projects.marketing.id}, ${eve!.id})`

  yield* sql`insert into emails ${sql.insert({
    to_email: eve!.email,
    subject:  `Maya Ortiz invited you to Acme's ProjectTorch`,
    kind:     "invite",
    link:     "/join/demo-invite-token",
    body:     "Maya Ortiz invited you to join Acme on ProjectTorch, to work on Marketing Plan.\n\nAccept the invitation to set up your login.",
  })}`
})
