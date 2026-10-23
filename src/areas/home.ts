// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates.
// The pages are client/areas/home.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, bool, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, canCreateProjects, logEvent, sendEmail, createRecording, defaultTools, type Project, type Recording } from "../lib/core.ts"

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
      // Agents get a project straight away: from the template they name, or the agents' template unless they asked for blank.
      if (c.app && fd.get("blank") !== "1") {
        const t = templateId ? yield* findProject(c, templateId) : yield* agentTemplate(c)
        if (t) {
          const p = yield* useTemplate(c, t, name, str(fd, "description") || null, [])
          return redirect(projectUrl(p), t.id === Number(c.account.settings.agent_template_id)
            ? `Started from “${t.name}”: a Board with Triage, Running, Mine and Review, and house rules pinned to the top of Posts. Read them first.`
            : `Started from “${t.name}”.`)
        }
      }
      if (templateId && !c.app) return redirect(`/templates/${templateId}/use?name=${encodeURIComponent(name)}`)
      const [p] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: c.me.account_id, name, description: str(fd, "description") || null, all_access: str(fd, "access") === "all",
        created_by: c.me.id,
      })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${c.me.id})`
      yield* logEvent(c, { project_id: p!.id, action: "created", summary: `started the project ${name}` })
      if (c.app && fd.get("blank") !== "1")
        return redirect(projectUrl(p!), "The agents' template was trashed, so this project started blank. Restore it from Templates to get it back.")
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
      const [t] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: c.me.account_id, kind: "template", name, created_by: c.me.id })} returning *`
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
      const p = yield* useTemplate(c, t, name, str(fd, "description") || t.description, ids(fd, "person_ids"))
      return redirect(projectUrl(p), `Made ${name} from ${t.name}.`)
    })),
]

/** A project from a template, with me (and these people) on it. */
const useTemplate = (c: Ctx, t: Project, name: string, description: string | null, personIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const p = yield* copyProject(c, t, { name, description: description ?? t.description, kind: "project" })
    for (const id of [c.me.id, ...personIds]) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
    yield* logEvent(c, { project_id: p.id, action: "created", summary: `started ${name} from the template ${t.name}` })
    return p
  })

// ---------- the agents' template ----------
// Projects an agent starts come ready to work in. It's an ordinary template (people change it like any other);
// accounts.settings.agent_template_id says which one, and it's made the first time an agent needs it.

const HOUSE_RULES = `Rules for any agent working in this project. Read them before you start.

- **Work only on cards in Running.** Leave Triage, Mine and Not now alone: those are for people to sort.
- **Every card is a brief:** what done looks like, what not to touch, and how to check it. The card's steps are the check.
- **When you finish:** tick the steps, leave one comment saying what you did, and move the card to **Review**.
- **Stuck?** Leave one comment saying what's missing, and move it to Review anyway.
- **Ask first** before you post to the Message Board, contact a client, or trash anything.
- **Drafts go on the card**, not in new posts.`

/** The template agents start projects from: the account's, made on first use. Null when it's been trashed or archived. */
const agentTemplate = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const id = Number(c.account.settings.agent_template_id) || 0
    const [t] = id ? yield* sql<Project>`select * from projects where id = ${id} and account_id = ${c.account.id} and kind = 'template'` : []
    if (t) return t.status === "active" ? t : null
    // Never made, or long gone from the trash: make it.
    const tools = ["cardtable", "message_board", "vault"].map((type) => ({ ...defaultTools().find((x) => x.type === type)!, enabled: true }))
    const [n] = yield* sql<Project>`insert into projects ${sql.insert({
      account_id: c.account.id, kind: "template", name: "Work with an agent", all_access: true, tools: JSON.stringify(tools), created_by: c.me.id,
      description: "Projects your agents start come ready: a Board with Triage, Running, Mine and Review, and house rules pinned to the top of Posts.",
    })} returning *`
    const columns: ReadonlyArray<[kind: string, title: string, color: string, note: string]> = [
      ["not_now", "Not now", "", ""], ["triage", "Triage", "", ""],
      ["custom", "Running", "", "What your agent is working on."], ["custom", "Mine", "blue", "Work only you can do."],
      ["review", "Review", "orange", ""], ["done", "Done", "", ""],
    ]
    for (const [i, [kind, title, color, note]] of columns.entries())
      yield* createRecording(c, { project: n!, type: "column", title, data: { kind, color, note, watcher_ids: [] }, visible_to_clients: true, position: i, quiet: true })
    yield* createRecording(c, { project: n!, type: "message", title: "House rules for agents", body: HOUSE_RULES, data: { category_id: null, pinned: true }, quiet: true })
    yield* sql`update accounts set settings = settings || ${JSON.stringify({ agent_template_id: n!.id })}::jsonb where id = ${c.account.id}`
    c.account.settings.agent_template_id = n!.id
    return n!
  })

/** Copy a project and all its active recordings (not comments). Used for templates both ways. */
export const copyProject = (c: Ctx, src: Project, over: { name: string; description: string | null; kind: "project" | "template" }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Project>`insert into projects ${sql.insert({
      account_id: src.account_id, kind: over.kind, name: over.name, description: over.description, tools: JSON.stringify(src.tools),
      created_by: c.me.id,
    })} returning *`
    const rows = yield* sql<Recording>`select * from recordings where project_id = ${src.id} and status = 'active' and type not in ('comment','line') order by id`
    const map = new Map<number, number>()
    for (const r of rows) {
      const [n] = yield* sql<{ id: number }>`insert into recordings ${sql.insert({
        account_id: r.account_id, project_id: p!.id, parent_id: r.parent_id ? map.get(r.parent_id) ?? null : null, type: r.type, title: r.title, body: r.body,
        data: JSON.stringify({ ...r.data, completed_at: null, completer_id: null }), visible_to_clients: r.visible_to_clients, creator_id: c.me.id, via: c.app?.name ?? null, position: r.position,
      })} returning id`
      map.set(r.id, n!.id)
    }
    return p!
  })
