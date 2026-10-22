// The project: project home, edit, ••• menu, change tools, people, activity, archived & trashed items, gauge, webhooks.
// The pages are client/areas/project.tsx; these are their posts, plus webhook deliveries (not synced) as JSON.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { get, post, redirect, invalid, json, str, ids, bool, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import { findProject, projectUrl, defaultTools, logEvent, canCreateProjects, type Tool } from "../lib/core.ts"
import { copyProject } from "./home.ts"

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

  post("/projects/:id/tools", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const tools: Tool[] = defaultTools()
        .map((d) => ({ type: d.type, name: str(fd, `name_${d.type}`) || d.name, enabled: bool(fd, `on_${d.type}`), pos: Number(str(fd, `pos_${d.type}`)) || 99 }))
        .sort((a, b) => a.pos - b.pos)
        .map(({ pos, ...t }) => t)
      yield* sql`update projects set tools = ${JSON.stringify(tools)} where id = ${p.id}`
      return redirect(projectUrl(p), "Tools updated.")
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
      if (!p.is_hq) yield* sql`update projects set all_access = ${str(fd, "access") === "all"} where id = ${p.id}`
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
      if (isClient(c.me) || p.is_hq) return yield* new NoAccess()
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

  // Gauge
  post("/projects/:id/status", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const value = Math.min(100, Math.max(0, Math.round(Number(str(fd, "value")) || 0)))
      yield* sql`insert into gauge_updates ${sql.insert({ project_id: p.id, person_id: c.me.id, value, note: str(fd, "note") || null })}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `set the status to ${value}%` })
      return redirect(projectUrl(p), "Status updated.")
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
    if (isClient(c.me) || (p.is_hq && status !== "active")) return yield* new NoAccess()
    yield* sql`update projects set status = ${status}, trashed_at = null where id = ${p.id}`
    yield* logEvent(c, { project_id: p.id, action: status === "archived" ? "archived" : "restored", summary: `${status === "archived" ? "archived" : "reactivated"} the project ${p.name}` })
    return redirect(projectUrl(p), msg)
  })
