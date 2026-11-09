// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates.
// Pages: client/areas/home.tsx. This file is what their forms post to.
//
//   POST /projects/:id/pin              pin or unpin a project on Home
//   POST /pins/reorder                  Home's pins, dragged into a new order
//   POST /projects                      new project (agents get one from a template straight away)
//   POST /projects/:id/people/setup     "Who's on this project?" right after making it
//   POST /templates                     new, empty template
//   POST /templates/:id/use             new project from a template
//
// Also here: the agents' template (made the first time an agent starts a project) and copyProject,
// which templates use both ways.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, num, ids, bool, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, canCreateProjects, canInvite, inMyAccount, logEvent, sendEmail, createRecording, defaultTools, type Project, type Recording } from "../lib/core.ts"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ─── Pins ──────────────────────────────────────────────────────────────────

const togglePin = post("/projects/:id/pin", (c) => Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const project = yield* findProject(c, c.params.id)

  const unpinned = yield* sql`delete from pins where person_id = ${c.me.id} and project_id = ${project.id} returning 1`
  if (unpinned.length) return back(c, "/", `Unpinned ${project.name}.`)

  // A new pin goes after the ones already pinned.
  yield* sql`insert into pins (person_id, project_id, position)
             select ${c.me.id}, ${project.id}, coalesce(max(position), 0) + 1 from pins where person_id = ${c.me.id}`
  return back(c, "/", `Pinned ${project.name} to Home.`)
}))

// Every `pos_<project id>` field is that pin's new position.
const reorderPins = post("/pins/reorder", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const fd  = yield* c.form

  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("pos_")) continue
    const projectId = num(key.slice("pos_".length))
    if (!projectId) continue
    yield* sql`update pins set position = ${Number(value) || 0} where person_id = ${c.me.id} and project_id = ${projectId}`
  }
  return back(c, "/")
}))

// ─── Projects ──────────────────────────────────────────────────────────────

const newProject = post("/projects", (c) => Effect.gen(function* () {
  if (!canCreateProjects(c)) return yield* new NoAccess()
  const sql         = yield* SqlClient.SqlClient
  const fd          = yield* c.form
  const name        = str(fd, "name")
  const description = str(fd, "description") || null
  const templateId  = Number(str(fd, "template_id")) || null
  if (!name) return invalid(["Your project needs a name."])

  // Agents get a project straight away: from the template they name, or the agents' template unless they asked for blank.
  const agentWantsTemplate = !!c.app && fd.get("blank") !== "1"
  if (agentWantsTemplate) {
    const template = templateId ? yield* findProject(c, templateId) : yield* agentTemplate(c)
    if (template) {
      const project = yield* useTemplate(c, template, name, description, [])
      if (template.id === Number(c.account.settings.agent_template_id))
        return redirect(projectUrl(project), `Started from “${template.name}”: a Board with Triage, Running, Mine and Review, and house rules pinned to the top of Posts. Read them first.`)
      return redirect(projectUrl(project), `Started from “${template.name}”.`)
    }
  }

  // People pick their template on its own page, which asks who to add.
  if (templateId && !c.app) return redirect(`/templates/${templateId}/use?name=${encodeURIComponent(name)}`)

  const [project] = yield* sql<Project>`insert into projects ${sql.insert({
    account_id:  c.me.account_id,
    name,
    description,
    all_access:  str(fd, "access") === "all",
    created_by:  c.me.id,
  })} returning *`
  yield* sql`insert into project_people (project_id, person_id) values (${project!.id}, ${c.me.id})`
  yield* logEvent(c, { project_id: project!.id, action: "created", summary: `started the project ${name}` })

  // Only reached by an agent when the agents' template is gone.
  if (agentWantsTemplate)
    return redirect(projectUrl(project!), "The agents' template was trashed, so this project started blank. Restore it from Templates to get it back.")
  return redirect(`/projects/${project!.id}/people/setup`)
}))

// Add people already in the account, and invite new ones by email.
// Clients can't add anyone, and inviting new people follows the account's invite rule.
const setUpPeople = post("/projects/:id/people/setup", (c) => Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const project = yield* findProject(c, c.params.id)
  if (isClient(c.me)) return yield* new NoAccess()

  const fd     = yield* c.form
  const emails = str(fd, "emails").split(/[\s,]+/).filter(Boolean)
  const bad    = emails.find((e) => !EMAIL.test(e))
  if (bad) return redirect(`/projects/${project.id}/people/setup`, `“${bad}” doesn't look like an email address.`)

  const added = yield* inMyAccount(c, ids(fd, "person_ids"))
  for (const email of emails) {
    const [existing] = yield* sql<{ id: number }>`select id from people where account_id = ${c.me.account_id} and lower(email) = lower(${email})`
    if (existing) { added.push(existing.id); continue }

    if (!canInvite(c)) return yield* new NoAccess()
    const token = crypto.randomUUID()
    const [invited] = yield* sql<any>`insert into people ${sql.insert({
      account_id:   c.me.account_id,
      name:         email.split("@")[0]!,
      email,
      invited_by:   c.me.id,
      invite_token: token,
      invited_at:   new Date(),
      prefs:        JSON.stringify({ notify_email: true }),
    })} returning *`
    added.push(invited.id)

    if (bool(fd, "send_email")) yield* sendEmail(invited, {
      subject: `${c.me.name} invited you to ${c.account.name}`,
      body:    `${c.me.name} invited you to join ${c.account.name} on ProjectTorch, to work on ${project.name}.\n\n${str(fd, "note")}`,
      kind:    "invite",
      link:    `/join/${token}`,
    }, true)
  }

  for (const personId of added)
    yield* sql`insert into project_people (project_id, person_id) values (${project.id}, ${personId}) on conflict do nothing`

  if (!added.length) return redirect(projectUrl(project))
  return redirect(projectUrl(project), `Added ${added.length} ${added.length === 1 ? "person" : "people"}.`)
}))

// ─── Templates ─────────────────────────────────────────────────────────────

const newTemplate = post("/templates", (c) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql  = yield* SqlClient.SqlClient
  const name = str(yield* c.form, "name")
  if (!name) return redirect("/templates", "Your template needs a name.")

  const [template] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: c.me.account_id, kind: "template", name, created_by: c.me.id })} returning *`
  yield* sql`insert into project_people (project_id, person_id) values (${template!.id}, ${c.me.id})`
  return redirect(`/projects/${template!.id}`)
}))

const useTemplateRoute = post("/templates/:id/use", (c) => Effect.gen(function* () {
  if (!canCreateProjects(c)) return yield* new NoAccess()
  const template = yield* findProject(c, c.params.id)
  const fd       = yield* c.form
  const name     = str(fd, "name")
  if (!name) return invalid(["Your project needs a name."])

  const people  = yield* inMyAccount(c, ids(fd, "person_ids"))
  const project = yield* useTemplate(c, template, name, str(fd, "description") || template.description, people)
  return redirect(projectUrl(project), `Made ${name} from ${template.name}.`)
}))

export const routes = [
  togglePin,
  reorderPins,
  newProject,
  setUpPeople,
  newTemplate,
  useTemplateRoute,
]

/** A project from a template, with me (and these people) on it. */
const useTemplate = (c: Ctx, template: Project, name: string, description: string | null, personIds: ReadonlyArray<number>) => Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const project = yield* copyProject(c, template, { name, description: description ?? template.description, kind: "project" })

  for (const personId of [c.me.id, ...personIds])
    yield* sql`insert into project_people (project_id, person_id) values (${project.id}, ${personId}) on conflict do nothing`
  yield* logEvent(c, { project_id: project.id, action: "created", summary: `started ${name} from the template ${template.name}` })
  return project
})

// ─── The agents' template ──────────────────────────────────────────────────
// Projects an agent starts come ready to work in. It's an ordinary template (people change it like any other);
// accounts.settings.agent_template_id says which one, and it's made the first time an agent needs it.

const HOUSE_RULES = `Rules for any agent working in this project. Read them before you start.

- **Work only on cards in Running.** Leave Triage, Mine and Not now alone: those are for people to sort.
- **Every card is a brief:** what done looks like, what not to touch, and how to check it. The card's steps are the check.
- **When you finish:** tick the steps, leave one comment saying what you did, and move the card to **Review**.
- **Stuck?** Leave one comment saying what's missing, and move it to Review anyway.
- **Sent back?** Read the newest comment on the card and fix exactly that.
- **Ask first** before you write a post, contact a client, or trash anything.
- **Drafts go on the card**, not in new posts.`

const AGENT_COLUMNS: ReadonlyArray<{ kind: string; title: string; color: string; note: string }> = [
  { kind: "not_now", title: "Not now", color: "",       note: "" },
  { kind: "triage",  title: "Triage",  color: "",       note: "" },
  { kind: "custom",  title: "Running", color: "",       note: "What your agent is working on." },
  { kind: "custom",  title: "Mine",    color: "blue",   note: "Work only you can do." },
  { kind: "review",  title: "Review",  color: "orange", note: "" },
  { kind: "done",    title: "Done",    color: "",       note: "" },
]

/** The template agents start projects from: the account's, made on first use. Null when it's been trashed or archived. */
const agentTemplate = (c: Ctx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const id  = Number(c.account.settings.agent_template_id) || 0

  if (id) {
    const [existing] = yield* sql<Project>`select * from projects where id = ${id} and account_id = ${c.account.id} and kind = 'template'`
    if (existing) return existing.status === "active" ? existing : null
  }

  // Never made, or long gone from the trash: make it.
  const tools = ["cardtable", "message_board", "vault"].map((type) => ({ ...defaultTools().find((x) => x.type === type)!, enabled: true }))
  const [template] = yield* sql<Project>`insert into projects ${sql.insert({
    account_id:  c.account.id,
    kind:        "template",
    name:        "Work with an agent",
    all_access:  true,
    tools:       JSON.stringify(tools),
    created_by:  c.me.id,
    description: "Projects your agents start come ready: a Board with Triage, Running, Mine and Review, and house rules pinned to the top of Posts.",
  })} returning *`

  for (const [position, column] of AGENT_COLUMNS.entries())
    yield* createRecording(c, {
      project:            template!,
      type:               "column",
      title:              column.title,
      data:               { kind: column.kind, color: column.color, note: column.note, watcher_ids: [] },
      visible_to_clients: true,
      position,
      quiet:              true,
    })
  yield* createRecording(c, {
    project: template!,
    type:    "message",
    title:   "House rules for agents",
    body:    HOUSE_RULES,
    data:    { category_id: null, pinned: true },
    quiet:   true,
  })

  yield* sql`update accounts set settings = settings || ${JSON.stringify({ agent_template_id: template!.id })}::jsonb where id = ${c.account.id}`
  c.account.settings.agent_template_id = template!.id
  return template!
})

/**
 * Copy a project and all its active recordings (not comments or chat). Used for templates both ways.
 * One transaction: a copy that fails halfway leaves nothing behind.
 */
export const copyProject = (c: Ctx, src: Project, over: { name: string; description: string | null; kind: "project" | "template" }) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql.withTransaction(Effect.gen(function* () {
    const [copy] = yield* sql<Project>`insert into projects ${sql.insert({
      account_id:  src.account_id,
      kind:        over.kind,
      name:        over.name,
      description: over.description,
      tools:       JSON.stringify(src.tools),
      created_by:  c.me.id,
    })} returning *`

    // Ordered by id, so a parent is always copied before its children and newIds already has it.
    const rows   = yield* sql<Recording>`select * from recordings where project_id = ${src.id} and status = 'active' and type not in ('comment','line') order by id`
    const newIds = new Map<number, number>()
    for (const r of rows) {
      const [n] = yield* sql<{ id: number }>`insert into recordings ${sql.insert({
        account_id:         r.account_id,
        project_id:         copy!.id,
        parent_id:          r.parent_id ? newIds.get(r.parent_id) ?? null : null,
        type:               r.type,
        title:              r.title,
        body:               r.body,
        data:               JSON.stringify({ ...r.data, completed_at: null, completer_id: null }),
        visible_to_clients: r.visible_to_clients,
        creator_id:         c.me.id,
        via:                c.app?.name ?? null,
        position:           r.position,
      })} returning id`
      newIds.set(r.id, n!.id)
    }
    return copy!
  }))
})
