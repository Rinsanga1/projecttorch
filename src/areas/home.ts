// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates.
// The pages are client/areas/home.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, bool, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, defaultTools, canCreateProjects, logEvent, sendEmail, type Project, type Recording } from "../lib/core.ts"

export const routes = [
  post("/projects/:id/pin", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const del = yield* sql`delete from pins where person_id = ${c.me.id} and project_id = ${p.id} returning 1`
      if (!del.length) yield* sql`insert into pins (person_id, project_id) values (${c.me.id}, ${p.id})`
      return back(c, "/", del.length ? `Unpinned ${p.name}.` : `Pinned ${p.name} to Home.`)
    })),

  post("/projects", (c) =>
    Effect.gen(function* () {
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const name = str(fd, "name")
      const templateId = Number(str(fd, "template_id")) || null
      if (!name) return invalid(["Your project needs a name."])
      if (templateId) return redirect(`/templates/${templateId}/use?name=${encodeURIComponent(name)}`)
      const [p] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: c.me.account_id, name, description: str(fd, "description") || null, all_access: str(fd, "access") === "all",
        tools: JSON.stringify(defaultTools()), email_token: crypto.randomUUID().slice(0, 12), created_by: c.me.id,
      })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${c.me.id})`
      yield* logEvent(c, { project_id: p!.id, action: "created", summary: `started the project ${name}` })
      return redirect(`/projects/${p!.id}/people/setup`)
    })),

  post("/projects/:id/people/setup", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const emails = str(fd, "emails").split(/[\s,]+/).filter(Boolean)
      const bad = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      if (bad.length) return redirect(`/projects/${p.id}/people/setup`, `“${bad[0]}” doesn't look like an email address.`)
      const added = [...ids(fd, "person_ids")]
      for (const email of emails) {
        const [existing] = yield* sql<{ id: number }>`select id from people where account_id = ${c.me.account_id} and lower(email) = lower(${email})`
        if (existing) { added.push(existing.id); continue }
        const token = crypto.randomUUID()
        const [np] = yield* sql<any>`insert into people ${sql.insert({ account_id: c.me.account_id, name: email.split("@")[0]!, email, invited_by: c.me.id, invite_token: token, invited_at: new Date(), prefs: JSON.stringify({ notify_email: true }) })} returning *`
        added.push(np.id)
        if (bool(fd, "send_email"))
          yield* sendEmail(np, { subject: `${c.me.name} invited you to ${c.account.name}`, body: `${c.me.name} invited you to join ${c.account.name} on Saintsflow, to work on ${p.name}.\n\n${str(fd, "note")}`, kind: "invite", link: `/join/${token}` }, true)
      }
      for (const id of added) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      return redirect(projectUrl(p), added.length ? `Added ${added.length} ${added.length === 1 ? "person" : "people"}.` : undefined)
    })),

  post("/templates", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const name = str(yield* c.form, "name")
      if (!name) return redirect("/templates", "Your template needs a name.")
      const [t] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: c.me.account_id, kind: "template", name, tools: JSON.stringify(defaultTools()), created_by: c.me.id })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${t!.id}, ${c.me.id})`
      return redirect(`/projects/${t!.id}`)
    })),

  post("/templates/:id/use", (c) =>
    Effect.gen(function* () {
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const t = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const name = str(fd, "name")
      if (!name) return invalid(["Your project needs a name."])
      const p = yield* copyProject(c, t, { name, description: str(fd, "description") || t.description, kind: "project" })
      for (const id of [c.me.id, ...ids(fd, "person_ids")]) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      yield* logEvent(c, { project_id: p.id, action: "created", summary: `started ${name} from the template ${t.name}` })
      return redirect(projectUrl(p), `Made ${name} from ${t.name}.`)
    })),
]

/** Copy a project and all its active recordings (not comments). Used for templates both ways. */
export const copyProject = (c: Ctx, src: Project, over: { name: string; description: string | null; kind: "project" | "template" }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Project>`insert into projects ${sql.insert({
      account_id: src.account_id, kind: over.kind, name: over.name, description: over.description, tools: JSON.stringify(src.tools),
      email_token: crypto.randomUUID().slice(0, 12), created_by: c.me.id,
    })} returning *`
    const rows = yield* sql<Recording>`select * from recordings where project_id = ${src.id} and status = 'active' and type not in ('comment','line','answer') order by id`
    const map = new Map<number, number>()
    for (const r of rows) {
      const [n] = yield* sql<{ id: number }>`insert into recordings ${sql.insert({
        account_id: r.account_id, project_id: p!.id, parent_id: r.parent_id ? map.get(r.parent_id) ?? null : null, type: r.type, title: r.title, body: r.body,
        data: JSON.stringify({ ...r.data, completed_at: null, completer_id: null }), visible_to_clients: r.visible_to_clients, creator_id: c.me.id, position: r.position,
      })} returning id`
      map.set(r.id, n!.id)
    }
    return p!
  })
