// The project: project home, edit, ••• menu, its windows, people, activity, archived & trashed items, webhooks.
// Pages: client/areas/project.tsx. This file is what their forms post to, plus webhook deliveries (not synced) as JSON.
//
//   POST /projects/:id/bookmark                  bookmark / unbookmark the project
//   POST /projects/:id/edit                      name, description, dates
//   POST /projects/:id/windows                   add a window (a copy, "Chat 2", when it already has one)
//   POST /projects/:id/windows/order             reorder the shown windows
//   POST /projects/:id/windows/:wid/rename
//   POST /projects/:id/windows/:wid/hide         hides it; deletes nothing
//   POST /projects/:id/windows/:wid/show
//   POST /projects/:id/people                    who's on it, and all-access
//   POST /projects/:id/archive | unarchive | restore | trash-project
//   POST /projects/:id/save-as-template
//   GET  /projects/:id/webhooks/deliveries       the last 20 deliveries
//   POST /projects/:id/webhooks                  add a webhook
//   POST /projects/:id/webhooks/:wid/delete
//   POST /projects/:id/webhooks/:wid/test
//
// Clients can see a project but change none of this: every handler except bookmarking checks isClient.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, redirect, back, invalid, json, str, ids, bool, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, windowUrl, defaultTools, logEvent, canCreateProjects, inMyAccount, type Project, type Tool } from "../lib/core.ts"
import { copyProject } from "./home.ts"

// ─── Helpers ───────────────────────────────────────────────────────────────

/** "vault-2", "vault-3"…: the first id no window of the project has. */
const copyId = (tools: ReadonlyArray<Tool>, type: string) => {
  let i = 2
  while (tools.some((t) => t.id === `${type}-${i}`)) i++
  return `${type}-${i}`
}

const saveTools = (p: Project, tools: ReadonlyArray<Tool>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update projects set tools = ${JSON.stringify(tools)} where id = ${p.id}`
})

/** The project, for someone who can change it (not a client). */
const findProjectToChange = (c: Ctx, opts: { allowTrashed?: boolean } = {}) => Effect.gen(function* () {
  const project = yield* findProject(c, c.params.id, opts)
  if (isClient(c.me)) return yield* new NoAccess()
  return project
})

/** The window named by :wid, for someone who can change it. */
const findWindow = (c: Ctx) => Effect.gen(function* () {
  const p    = yield* findProjectToChange(c)
  const tool = p.tools.find((t) => t.id === c.params.wid)
  if (!tool) return yield* new NotFound()
  return { p, tool }
})

// ─── The project ───────────────────────────────────────────────────────────

const toggleBookmark = post("/projects/:id/bookmark", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProject(c, c.params.id)

  const removed = yield* sql`delete from bookmarks where person_id = ${c.me.id} and project_id = ${p.id} and recording_id is null returning 1`
  if (removed.length) return redirect(projectUrl(p), "Bookmark removed.")

  yield* sql`insert into bookmarks ${sql.insert({ person_id: c.me.id, project_id: p.id })}`
  return redirect(projectUrl(p), { msg: "Bookmarked.", href: "/my/bookmarks", label: "See your bookmarks" })
}))

const editProject = post("/projects/:id/edit", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c)
  const fd  = yield* c.form
  const next = {
    name:        str(fd, "name"),
    description: str(fd, "description") || null,
    starts_on:   str(fd, "starts_on")   || null,
    ends_on:     str(fd, "ends_on")     || null,
  }

  // Dates are YYYY-MM-DD, so comparing the strings compares the days.
  const errors: string[] = []
  if (!next.name)                                                      errors.push("Your project needs a name.")
  if (next.starts_on && next.ends_on && next.ends_on < next.starts_on) errors.push("The end date has to come after the start date.")
  if (errors.length) return invalid(errors)

  yield* sql`update projects set name = ${next.name}, description = ${next.description}, starts_on = ${next.starts_on}, ends_on = ${next.ends_on} where id = ${p.id}`
  yield* logEvent(c, { project_id: p.id, action: "edited", summary: `updated the project details` })
  return redirect(projectUrl(p), "Saved.")
}))

// ─── Windows ───────────────────────────────────────────────────────────────
// Hiding deletes nothing: the window and everything in it come back with Show.

const addWindow = post("/projects/:id/windows", (c) => Effect.gen(function* () {
  const p    = yield* findProjectToChange(c)
  const type = str(yield* c.form, "type")
  const base = defaultTools().find((t) => t.type === type)
  if (!base) return invalid(["Pick a kind of window to add."])

  // The first of a kind keeps the plain id and name ("chat", "Chat"); later ones are copies ("chat-2", "Chat 2").
  const already = p.tools.filter((t) => t.type === base.type).length
  const tool: Tool = {
    ...base,
    id:      already ? copyId(p.tools, base.type)   : base.type,
    name:    already ? `${base.name} ${already + 1}` : base.name,
    enabled: true,
  }
  yield* saveTools(p, [...p.tools, tool])
  return redirect(windowUrl(p, tool))
}))

// The windows in the order of `ids` (the ones shown); hidden ones keep their order after them.
const orderWindows = post("/projects/:id/windows/order", (c) => Effect.gen(function* () {
  const p     = yield* findProjectToChange(c)
  const order = str(yield* c.form, "ids").split(",")

  const shown = order.flatMap((id) => p.tools.filter((t) => t.id === id))
  const rest  = p.tools.filter((t) => !order.includes(t.id))
  yield* saveTools(p, [...shown, ...rest])
  return back(c, projectUrl(p))
}))

const renameWindow = post("/projects/:id/windows/:wid/rename", (c) => Effect.gen(function* () {
  const { p, tool } = yield* findWindow(c)
  const name = str(yield* c.form, "name").slice(0, 40)
  if (!name) return invalid(["A window needs a name."])

  yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, name } : t)))
  return back(c, windowUrl(p, tool))
}))

const hideWindow = post("/projects/:id/windows/:wid/hide", (c) => Effect.gen(function* () {
  const { p, tool } = yield* findWindow(c)
  yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, enabled: false } : t)))
  return back(c, projectUrl(p), { msg: `${tool.name} is hidden. Everything in it is safe.`, href: `/projects/${p.id}/windows/${tool.id}/show`, label: "Undo" })
}))

const showWindow = post("/projects/:id/windows/:wid/show", (c) => Effect.gen(function* () {
  const { p, tool } = yield* findWindow(c)
  yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, enabled: true } : t)))
  return redirect(windowUrl(p, tool))
}))

// ─── People ────────────────────────────────────────────────────────────────

// The form lists everyone who should be on the project; whoever isn't checked comes off.
const setPeople = post("/projects/:id/people", (c) => Effect.gen(function* () {
  const sql       = yield* SqlClient.SqlClient
  const p         = yield* findProjectToChange(c)
  const fd        = yield* c.form
  const keep      = yield* inMyAccount(c, ids(fd, "person_ids"))
  const allAccess = str(fd, "access") === "all"

  // Same check as the page (client/areas/project.tsx): taking yourself off a project that isn't all-access needs a yes.
  const removingMe = !keep.includes(c.me.id)
  if (removingMe && !p.all_access && !bool(fd, "confirm_self"))
    return invalid(["If you remove yourself you'll lose access to this project. Tick “Yes, remove me” to do it anyway."])

  // One transaction: a failure halfway can't leave the project with nobody on it.
  yield* sql.withTransaction(Effect.gen(function* () {
    yield* sql`delete from project_people where project_id = ${p.id}`
    for (const personId of keep)
      yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${personId}) on conflict do nothing`
    yield* sql`update projects set all_access = ${allAccess} where id = ${p.id}`
  }))
  yield* logEvent(c, { project_id: p.id, action: "edited", summary: `changed who's on ${p.name}` })

  // Still on it (or everyone is)? Stay. Took yourself off? Home.
  if (!removingMe || allAccess) return redirect(projectUrl(p), "People updated.")
  return redirect("/", "People updated.")
}))

// ─── Lifecycle ─────────────────────────────────────────────────────────────

const setProjectStatus = (c: Ctx, status: "active" | "archived", msg: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c, { allowTrashed: true })

  yield* sql`update projects set status = ${status}, trashed_at = null where id = ${p.id}`
  if (status === "archived") yield* logEvent(c, { project_id: p.id, action: "archived", summary: `archived the project ${p.name}` })
  else                       yield* logEvent(c, { project_id: p.id, action: "restored", summary: `reactivated the project ${p.name}` })
  return redirect(projectUrl(p), msg)
})

const archive   = post("/projects/:id/archive",   (c) => setProjectStatus(c, "archived", "Archived. Find it under Archived projects."))
const unarchive = post("/projects/:id/unarchive", (c) => setProjectStatus(c, "active",   "Unarchived."))
const restore   = post("/projects/:id/restore",   (c) => setProjectStatus(c, "active",   "Put back."))

const trashProject = post("/projects/:id/trash-project", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c)

  yield* sql`update projects set status = 'trashed', trashed_at = now() where id = ${p.id}`
  yield* logEvent(c, { project_id: p.id, action: "trashed", summary: `put the project ${p.name} in the trash` })
  return redirect("/", "Project moved to the trash.")
}))

const saveAsTemplate = post("/projects/:id/save-as-template", (c) => Effect.gen(function* () {
  const p = yield* findProject(c, c.params.id)
  if (!canCreateProjects(c)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient

  const template = yield* copyProject(c, p, { name: `${p.name} (template)`, description: p.description, kind: "template" })
  yield* sql`insert into project_people (project_id, person_id) values (${template.id}, ${c.me.id})`
  return redirect(`/projects/${template.id}`, "Saved as a template.")
}))

// ─── Webhooks ──────────────────────────────────────────────────────────────
// The hooks are synced; their delivery log isn't, so the page asks for it here.

const webhookDeliveries = get("/projects/:id/webhooks/deliveries", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c)

  return json(yield* sql<{ webhook_id: number; event: string; status: number | null; error: string | null; created_at: Date }>`
    select d.* from webhook_deliveries d join webhooks w on w.id = d.webhook_id where w.project_id = ${p.id} order by d.id desc limit 20`)
}))

const addWebhook = post("/projects/:id/webhooks", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c)
  const fd  = yield* c.form
  const url = str(fd, "url")
  if (!/^https?:\/\//.test(url)) return redirect(`/projects/${p.id}/webhooks`, "That doesn't look like a link.")

  yield* sql`insert into webhooks (project_id, url, types) values (${p.id}, ${url}, ${fd.getAll("types").map(String)})`
  return redirect(`/projects/${p.id}/webhooks`, "Webhook added.")
}))

const deleteWebhook = post("/projects/:id/webhooks/:wid/delete", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProjectToChange(c)

  yield* sql`delete from webhooks where id = ${Number(c.params.wid)} and project_id = ${p.id}`
  return redirect(`/projects/${p.id}/webhooks`, "Webhook deleted.")
}))

// Logging an event is what fires the project's webhooks (core.ts logEvent), so a test is just an event.
const testWebhook = post("/projects/:id/webhooks/:wid/test", (c) => Effect.gen(function* () {
  const p = yield* findProjectToChange(c)
  yield* logEvent(c, { project_id: p.id, action: "test", summary: "sent a test webhook" })
  return redirect(`/projects/${p.id}/webhooks`, "Test sent. Refresh to see the delivery.")
}))

export const routes = [
  toggleBookmark,
  editProject,
  addWindow,
  orderWindows,
  renameWindow,
  hideWindow,
  showWindow,
  setPeople,
  archive,
  unarchive,
  restore,
  trashProject,
  saveAsTemplate,
  webhookDeliveries,
  addWebhook,
  deleteWebhook,
  testWebhook,
]
