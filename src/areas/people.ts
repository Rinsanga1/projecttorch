// People & clients: invite people, pending invitations, client access for a project.
// The pages (the directory, profiles, the invite form, the client preview) are client/areas/people.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, invalid, str, ids, isAdmin, isClient, NoAccess, NotFound, type Ctx, type Person } from "../lib/web.ts"
import { findProject, visibleProjects, canInvite, sendEmail, projectUrl, logEvent } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

type Company = { id: number; name: string }

const companies = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Company>`select id, name from companies where account_id = ${c.me.account_id} order by name`
  })

/** Send (or resend) the invitation email. */
const sendInvite = (c: Ctx, p: Person, note: string, projectNames: ReadonlyArray<string>) =>
  sendEmail(p, {
    subject: `${c.me.name} invited you to ${c.account.name}'s Saintsflow`,
    body: `${c.me.name} invited you to join ${c.account.name} on Saintsflow${projectNames.length ? `, to work on ${projectNames.join(", ")}` : ""}.${note ? `\n\n“${note}”` : ""}\n\nAccept the invitation to set up your login.`,
    kind: "invite",
    link: `/join/${p.invite_token}`,
  }, true)

/** A never-joined person the current person may resend or cancel. */
const pendingInvite = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id} and joined_at is null and removed_at is null`
    if (!p) return yield* new NotFound()
    if (!canInvite(c) || !(isAdmin(c.me) || p.invited_by === c.me.id)) return yield* new NoAccess()
    return p
  })

export const routes = [
  post("/people/invite", (c) =>
    Effect.gen(function* () {
      if (!canInvite(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const cos = yield* companies(c)
      const projects = yield* visibleProjects(c)
      const v = {
        who: str(fd, "who") === "client" ? "client" : "staff", name: str(fd, "name"), email: str(fd, "email").toLowerCase(), title: str(fd, "title"),
        company_id: str(fd, "company_id"), new_company: str(fd, "new_company"), note: str(fd, "note"),
        project_ids: ids(fd, "project_ids").filter((id) => projects.some((p) => p.id === id)),
      }
      const errs: string[] = []
      if (!v.name) errs.push("Add their name.")
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.push("That doesn't look like an email address.")
      if (v.who === "client" && !v.company_id && !v.new_company) errs.push("Pick or name the client's company.")
      const [existing] = yield* sql<Person>`select * from people where account_id = ${c.me.account_id} and lower(email) = ${v.email}`
      // Errors are plain text now, so the old links ("See …'s profile", "Resend the invitation") are spelled out.
      if (existing && !existing.removed_at)
        errs.push(existing.joined_at
          ? `${v.email} is already in this account. See ${existing.name}'s profile in Everyone.`
          : `${v.email} was already invited. Resend the invitation from Pending invitations.`)
      if (errs.length) return invalid(errs)

      let companyId = Number(v.company_id) || null
      if (companyId && !cos.some((k) => k.id === companyId)) companyId = null
      if (v.new_company) {
        const same = cos.find((k) => k.name.toLowerCase() === v.new_company.toLowerCase())
        companyId = same?.id ?? (yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: c.me.account_id, name: v.new_company })} returning id`)[0]!.id
      }
      const fields = {
        name: v.name, title: v.title || null, company_id: companyId, role: v.who === "client" ? "client" : "member",
        invited_by: c.me.id, invite_token: crypto.randomUUID(), invited_at: new Date(), joined_at: null, removed_at: null,
      }
      // A removed person coming back gets their old row (email is unique per account).
      const [p] = existing
        ? yield* sql<Person>`update people set ${sql.update(fields)} where id = ${existing.id} returning *`
        : yield* sql<Person>`insert into people ${sql.insert({ ...fields, account_id: c.me.account_id, email: v.email, prefs: JSON.stringify({ notify_email: true }) })} returning *`
      for (const pid of v.project_ids) yield* sql`insert into project_people (project_id, person_id) values (${pid}, ${p!.id}) on conflict do nothing`
      yield* sendInvite(c, p!, v.note, projects.filter((x) => v.project_ids.includes(x.id)).map((x) => x.name))
      yield* logEvent(c, { project_id: v.project_ids[0] ?? null, action: "invited", summary: `invited ${v.name}${v.who === "client" ? " (client)" : ""}` })
      return redirect("/people/pending",
        { msg: `Invitation sent to ${v.email}.`, href: "/inbox", label: "See the email" })
    })),

  post("/people/pending/:pid/resend", (c) =>
    Effect.gen(function* () {
      const p = yield* pendingInvite(c)
      const sql = yield* SqlClient.SqlClient
      const [u] = yield* sql<Person>`update people set invited_at = now() where id = ${p.id} returning *`
      yield* sendInvite(c, u!, "", [])
      return redirect("/people/pending", { msg: `Invitation resent to ${p.email}.`, href: "/inbox", label: "See the email" })
    })),

  post("/people/pending/:pid/cancel", (c) =>
    Effect.gen(function* () {
      const p = yield* pendingInvite(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from people where id = ${p.id} and joined_at is null`
      return redirect("/people/pending", `Cancelled the invitation for ${p.email}.`)
    })),

  // Client access for a project
  post("/projects/:id/clients", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const visible = str(yield* c.form, "see_new") === "visible"
      yield* sql`update projects set clients_see_new = ${visible} where id = ${p.id}`
      return redirect(projectUrl(p), visible ? "New things will be visible to clients." : "New things start out hidden from clients.")
    })),

  post("/projects/:id/clients/:pid/remove", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const [x] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id} and role = 'client'`
      if (!x) return yield* new NotFound()
      yield* sql`delete from project_people where project_id = ${p.id} and person_id = ${x.id}`
      return redirect(`/projects/${p.id}/clients`, `${x.name} isn't on ${p.name} anymore.`)
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [eve] = yield* sql<Person>`insert into people ${sql.insert({
      account_id: s.account.id, name: "Eve Park", email: "eve@acme.test", title: "Writer", role: "member",
      invited_by: s.people.maya.id, invite_token: "demo-invite-token", invited_at: new Date(Date.now() - 2 * 86400_000),
      prefs: JSON.stringify({ notify_email: true }), company_id: s.people.maya.company_id,
    })} returning *`
    yield* sql`insert into project_people (project_id, person_id) values (${s.projects.marketing.id}, ${eve!.id})`
    yield* sql`insert into emails ${sql.insert({
      to_email: eve!.email, subject: `Maya Ortiz invited you to Acme's Saintsflow`, kind: "invite", link: "/join/demo-invite-token",
      body: "Maya Ortiz invited you to join Acme on Saintsflow, to work on Marketing Plan.\n\nAccept the invitation to set up your login.",
    })}`
  })
