// The project: project home, edit, ••• menu, its windows, people, activity, archived & trashed items, webhooks.
// The pages are client/areas/project.tsx; these are their posts, plus webhook deliveries (not synced) as JSON.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, redirect, back, invalid, json, str, ids, bool, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, windowUrl, defaultTools, logEvent, canCreateProjects, type Project, type Tool } from "../lib/core.ts"
import { copyProject } from "./home.ts"

/** "vault-2", "vault-3"…: the first id no window of the project has. */
const copyId = (tools: ReadonlyArray<Tool>, type: string) => {
  let i = 2
  while (tools.some((t) => t.id === `${type}-${i}`)) i++
  return `${type}-${i}`
}

const saveTools = (p: Project, tools: ReadonlyArray<Tool>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update projects set tools = ${JSON.stringify(tools)} where id = ${p.id}`
  })

/** The window named by :wid, for someone who can change it. */
const findWindow = (c: Ctx) =>
  Effect.gen(function* () {
    const p = yield* findProject(c, c.params.id)
    if (isClient(c.me)) return yield* new NoAccess()
    const tool = p.tools.find((t) => t.id === c.params.wid)
    if (!tool) return yield* new NotFound()
    return { p, tool }
  })

export const routes = [
  post("/projects/:id/bookmark", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const del = yield* sql`delete from bookmarks where person_id = ${c.me.id} and project_id = ${p.id} and recording_id is null returning 1`
      if (!del.length) yield* sql`insert into bookmarks ${sql.insert({ person_id: c.me.id, project_id: p.id })}`
      return redirect(projectUrl(p), del.length ? "Bookmark removed." : { msg: "Bookmarked.", href: "/my/bookmarks", label: "See your bookmarks" })
    })),

  post("/projects/:id/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const next = { ...p, name: str(fd, "name"), description: str(fd, "description") || null, starts_on: str(fd, "starts_on") || null, ends_on: str(fd, "ends_on") || null }
      const errs = [
        ...(next.name ? [] : ["Your project needs a name."]),
        ...(next.starts_on && next.ends_on && next.ends_on < next.starts_on ? ["The end date has to come after the start date."] : []),
      ]
      if (errs.length) return invalid(errs)
      yield* sql`update projects set name = ${next.name}, description = ${next.description}, starts_on = ${next.starts_on}, ends_on = ${next.ends_on} where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `updated the project details` })
      return redirect(projectUrl(p), "Saved.")
    })),

  // Windows: add one (a copy, "Chat 2", when the project already has that kind), rename one, hide one, show it again.
  // Hiding deletes nothing: the window and everything in it come back with Show.
  post("/projects/:id/windows", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const type = str(yield* c.form, "type")
      const base = defaultTools().find((t) => t.type === type)
      if (!base) return invalid(["Pick a kind of window to add."])
      const n = p.tools.filter((t) => t.type === base.type).length
      const tool: Tool = { ...base, id: n ? copyId(p.tools, base.type) : base.type, name: n ? `${base.name} ${n + 1}` : base.name, enabled: true }
      yield* saveTools(p, [...p.tools, tool])
      return redirect(windowUrl(p, tool))
    })),

  // The windows in the order of `ids` (the ones shown); hidden ones keep their order after them.
  post("/projects/:id/windows/order", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const ids = str(yield* c.form, "ids").split(",")
      const first = ids.flatMap((id) => p.tools.filter((t) => t.id === id))
      yield* saveTools(p, [...first, ...p.tools.filter((t) => !ids.includes(t.id))])
      return back(c, projectUrl(p))
    })),

  post("/projects/:id/windows/:wid/rename", (c) =>
    Effect.gen(function* () {
      const { p, tool } = yield* findWindow(c)
      const name = str(yield* c.form, "name").slice(0, 40)
      if (!name) return invalid(["A window needs a name."])
      yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, name } : t)))
      return back(c, windowUrl(p, tool))
    })),

  post("/projects/:id/windows/:wid/hide", (c) =>
    Effect.gen(function* () {
      const { p, tool } = yield* findWindow(c)
      yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, enabled: false } : t)))
      return back(c, projectUrl(p), { msg: `${tool.name} is hidden. Everything in it is safe.`, href: `/projects/${p.id}/windows/${tool.id}/show`, label: "Undo" })
    })),

  post("/projects/:id/windows/:wid/show", (c) =>
    Effect.gen(function* () {
      const { p, tool } = yield* findWindow(c)
      yield* saveTools(p, p.tools.map((t) => (t.id === tool.id ? { ...t, enabled: true } : t)))
      return redirect(windowUrl(p, tool))
    })),

  post("/projects/:id/people", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const keep = ids(fd, "person_ids")
      if (!keep.includes(c.me.id) && !(p.all_access && !isClient(c.me)) && !bool(fd, "confirm_self"))
        return invalid(["If you remove yourself you'll lose access to this project. Tick “Yes, remove me” to do it anyway."])
      yield* sql`delete from project_people where project_id = ${p.id}`
      for (const id of keep) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      yield* sql`update projects set all_access = ${str(fd, "access") === "all"} where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `changed who's on ${p.name}` })
      return redirect(keep.includes(c.me.id) || str(fd, "access") === "all" ? projectUrl(p) : "/", "People updated.")
    })),

  // Whole-project lifecycle
  post("/projects/:id/archive", (c) => setProjectStatus(c, "archived", "Archived. Find it under Archived projects.")),
  post("/projects/:id/unarchive", (c) => setProjectStatus(c, "active", "Unarchived.")),
  post("/projects/:id/restore", (c) => setProjectStatus(c, "active", "Put back.")),
  post("/projects/:id/trash-project", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* sql`update projects set status = 'trashed', trashed_at = now() where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "trashed", summary: `put the project ${p.name} in the trash` })
      return redirect("/", "Project moved to the trash.")
    })),

  post("/projects/:id/save-as-template", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const t = yield* copyProject(c, p, { name: `${p.name} (template)`, description: p.description, kind: "template" })
      yield* sql`insert into project_people (project_id, person_id) values (${t.id}, ${c.me.id})`
      return redirect(`/projects/${t.id}`, "Saved as a template.")
    })),

  // Webhooks (the hooks are synced; their delivery log isn't)
  get("/projects/:id/webhooks/deliveries", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      return json(yield* sql<{ webhook_id: number; event: string; status: number | null; error: string | null; created_at: Date }>`
        select d.* from webhook_deliveries d join webhooks w on w.id = d.webhook_id where w.project_id = ${p.id} order by d.id desc limit 20`)
    })),

  post("/projects/:id/webhooks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const url = str(fd, "url")
      if (!/^https?:\/\//.test(url)) return redirect(`/projects/${p.id}/webhooks`, "That doesn't look like a link.")
      yield* sql`insert into webhooks (project_id, url, types) values (${p.id}, ${url}, ${fd.getAll("types").map(String)})`
      return redirect(`/projects/${p.id}/webhooks`, "Webhook added.")
    })),

  post("/projects/:id/webhooks/:wid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* sql`delete from webhooks where id = ${Number(c.params.wid)} and project_id = ${p.id}`
      return redirect(`/projects/${p.id}/webhooks`, "Webhook deleted.")
    })),

  post("/projects/:id/webhooks/:wid/test", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* logEvent(c, { project_id: p.id, action: "test", summary: "sent a test webhook" })
      return redirect(`/projects/${p.id}/webhooks`, "Test sent. Refresh to see the delivery.")
    })),
]

const setProjectStatus = (c: Ctx, status: "active" | "archived", msg: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const p = yield* findProject(c, c.params.id, { allowTrashed: true })
    if (isClient(c.me)) return yield* new NoAccess()
    yield* sql`update projects set status = ${status}, trashed_at = null where id = ${p.id}`
    yield* logEvent(c, { project_id: p.id, action: status === "archived" ? "archived" : "restored", summary: `${status === "archived" ? "archived" : "reactivated"} the project ${p.name}` })
    return redirect(projectUrl(p), msg)
  })
