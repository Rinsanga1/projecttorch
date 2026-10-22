// To-dos: the lists index, new list, a list with its groups, add a to-do, a to-do, and the Hill Chart.
// The pages are client/areas/todos.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, num, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, toolUrl, urlFor, notify, logEvent, subscribe,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Person } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

/** The list a to-do or group belongs to. */
const listOf = (c: Ctx, r: Recording) =>
  Effect.gen(function* () {
    let parentId = r.parent_id
    const { r: parent } = yield* findRecording(c, parentId ?? 0, ["todolist", "todogroup"])
    if (parent.type === "todolist") return { list: parent, group: null as Recording | null }
    const { r: list } = yield* findRecording(c, parent.parent_id ?? 0, "todolist")
    return { list, group: parent }
  })

/** Read the to-do fields. */
const readTodo = (fd: FormData, pool: ReadonlyArray<number>) => {
  const due = str(fd, "due")
  const due_on = due === "day" ? str(fd, "due_day") || null : due === "range" ? str(fd, "range_end") || null : null
  const starts_on = due === "range" ? str(fd, "range_start") || null : null
  const errs = [
    ...(str(fd, "title") ? [] : ["Write something first."]),
    ...(due === "day" && !due_on ? ["Pick the day it's due."] : []),
    ...(due === "range" && (!starts_on || !due_on) ? ["Pick both the start and end day."] : []),
    ...(starts_on && due_on && due_on < starts_on ? ["The end date has to come after the start date."] : []),
  ]
  return {
    errs,
    title: str(fd, "title"),
    body: str(fd, "body"),
    data: {
      assignee_ids: ids(fd, "assignee_ids").filter((id) => pool.includes(id)),
      notify_ids: ids(fd, "notify_ids").filter((id) => pool.includes(id)),
      due_on,
      starts_on,
    },
  }
}

const tellAssignees = (c: Ctx, t: Recording, personIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    if (!personIds.length) return
    yield* subscribe(t.id, personIds)
    yield* notify(c, { personIds, recording: t, kind: "assigned", summary: `${c.me.name} assigned you a task: ${t.title}` })
  })

export const routes = [
  post("/projects/:id/lists/reorder", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = num(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${p.id} and type = 'todolist'`
      }
      return redirect(toolUrl(p, "todos"), "Order saved.")
    })),

  post("/projects/:id/lists", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const l = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!l.title) return invalid(["Your list needs a name."])
      const r = yield* createRecording(c, { project: p, type: "todolist", ...l, verb: "made a task list" })
      return redirect(urlFor(r))
    })),

  post("/projects/:id/lists/:lid/edit", (c) =>
    Effect.gen(function* () {
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      if (isClient(c.me) && list.creator_id !== c.me.id) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const ch = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: people.some(isClient) ? fd.get("visible_to_clients") === "on" : list.visible_to_clients }
      if (!ch.title) return invalid(["Your list needs a name."])
      const u = yield* updateRecording(c, list, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  post("/projects/:id/lists/:lid/track", (c) =>
    Effect.gen(function* () {
      const { r: list } = yield* findRecording(c, c.params.lid, "todolist")
      if (isClient(c.me)) return yield* new NoAccess()
      yield* updateRecording(c, list, { data: { tracked: !list.data.tracked } }, { quiet: true })
      return redirect(urlFor(list), list.data.tracked ? "This list is off the progress hill." : { msg: "This list is on the progress hill.", href: `/projects/${list.project_id}/progress`, label: "Update the hill" })
    })),

  post("/projects/:id/lists/:lid/reorder", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list } = yield* findRecording(c, c.params.lid, "todolist")
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = num(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${list.project_id} and type = 'todo'`
      }
      return redirect(urlFor(list), "Order saved.")
    })),

  post("/projects/:id/lists/:lid/groups", (c) =>
    Effect.gen(function* () {
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      const title = str(yield* c.form, "title")
      if (!title) return redirect(urlFor(list), "Your group needs a name.")
      const g = yield* createRecording(c, { project: p, type: "todogroup", parent_id: list.id, title, visible_to_clients: true, verb: `added a group to ${list.title}` })
      return redirect(`${urlFor(list)}#group-${g.id}`)
    })),

  post("/projects/:id/groups/:gid", (c) =>
    Effect.gen(function* () {
      const { r: g } = yield* findRecording(c, c.params.gid, "todogroup")
      const title = str(yield* c.form, "title")
      if (!title) return redirect(urlFor(g), "Your group needs a name.")
      yield* updateRecording(c, g, { title }, { quiet: true })
      return redirect(urlFor(g), "Group renamed.")
    })),

  post("/projects/:id/lists/:lid/tasks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: list, project: p } = yield* findRecording(c, c.params.lid, "todolist")
      if (list.status !== "active") return yield* new NotFound()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const t = readTodo(fd, people.map((x) => x.id))
      const groupId = num(str(fd, "group_id"))
      if (groupId) {
        const [g] = yield* sql`select 1 from recordings where id = ${groupId} and parent_id = ${list.id} and type = 'todogroup'`
        if (!g) return yield* new NotFound()
      }
      if (t.errs.length) return redirect(`${urlFor(list)}${groupId ? `#group-${groupId}` : ""}`, t.errs[0])
      // Clients follow the list's visibility, so every task is visible and the list decides.
      const todo = yield* createRecording(c, { project: p, type: "todo", parent_id: groupId ?? list.id, title: t.title, body: t.body, data: { ...t.data, completed_at: null }, visible_to_clients: true, verb: "added a task" })
      yield* subscribe(todo.id, t.data.notify_ids)
      yield* tellAssignees(c, todo, t.data.assignee_ids)
      return redirect(`${urlFor(list)}#todo-${todo.id}`, "Added. Type the next one.")
    })),

  post("/projects/:id/tasks/:tid/complete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      const done = !t.data.completed_at
      const patch = done ? { completed_at: new Date().toISOString(), completer_id: c.me.id } : { completed_at: null, completer_id: null }
      const [u] = yield* sql<Recording>`update recordings set data = data || ${JSON.stringify(patch)}::jsonb, updated_at = now() where id = ${t.id} returning *`
      yield* logEvent(c, { project_id: p.id, recording_id: t.id, action: done ? "completed" : "uncompleted", summary: `${done ? "completed" : "un-completed"} ${t.title}` })
      if (done && t.data.notify_ids?.length)
        yield* notify(c, { personIds: t.data.notify_ids, recording: u!, kind: "completed", summary: `${c.me.name} completed: ${t.title}` })
      return back(c, urlFor(t), done ? { msg: `Completed “${t.title}”.`, href: `/projects/${p.id}/tasks/${t.id}/undo-complete`, label: "Undo" } : undefined)
    })),

  // Was a GET (the flash's "Undo" link); the client page at the same path posts here.
  post("/projects/:id/tasks/:tid/undo-complete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t } = yield* findRecording(c, c.params.tid, "todo")
      yield* sql`update recordings set data = data || '{"completed_at":null,"completer_id":null}'::jsonb where id = ${t.id}`
      return redirect(urlFor(t), "Marked as not done.")
    })),

  post("/projects/:id/tasks/:tid/move-group", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: t } = yield* findRecording(c, c.params.tid, "todo")
      const { list } = yield* listOf(c, t)
      const target = num(str(yield* c.form, "parent_id"))
      const [ok] = target ? yield* sql`select 1 from recordings where id = ${target} and (id = ${list.id} or (parent_id = ${list.id} and type = 'todogroup'))` : []
      if (!ok) return yield* new NotFound()
      yield* sql`update recordings set parent_id = ${target}, updated_at = now() where id = ${t.id}`
      return redirect(`${urlFor(list)}#todo-${t.id}`, "Moved.")
    })),

  post("/projects/:id/tasks/:tid/edit", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      yield* listOf(c, t)
      const people = yield* projectPeople(p)
      const n = readTodo(yield* c.form, people.map((x) => x.id))
      if (n.errs.length) return invalid(n.errs)
      const u = yield* updateRecording(c, t, { title: n.title, body: n.body, data: n.data })
      yield* subscribe(u.id, n.data.notify_ids)
      yield* tellAssignees(c, u, n.data.assignee_ids.filter((id) => !(t.data.assignee_ids ?? []).includes(id)))
      return redirect(urlFor(u), "Saved.")
    })),

  // Hill Chart
  post("/projects/:id/progress", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const tracked = (yield* sql<{ id: number }>`select id from recordings where project_id = ${p.id} and type = 'todolist' and status = 'active' and (data->>'tracked')::boolean is true`).map((r) => r.id)
      const positions: Record<string, number> = {}
      for (const id of tracked) {
        const v = fd.get(`pos_${id}`)
        if (v !== null) positions[id] = Math.min(100, Math.max(0, Math.round(Number(v) || 0)))
      }
      if (!Object.keys(positions).length) return redirect(`/projects/${p.id}/progress`, "There's nothing on the hill to update.")
      yield* sql`insert into hill_updates ${sql.insert({ project_id: p.id, person_id: c.me.id, positions: JSON.stringify(positions), note: str(fd, "note") || null })}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: "updated the progress hill" })
      return redirect(`/projects/${p.id}/progress`, "Progress updated.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob, cara } = s.people
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const web = s.projects.website
    const todo = (as: Person, project: Project, parent: Recording, title: string, data: Record<string, any> = {}, body = "") =>
      Effect.gen(function* () {
        const t = yield* createRecording(s.as(as), { project, type: "todo", parent_id: parent.id, title, body, data: { assignee_ids: [], notify_ids: [], completed_at: null, ...data }, visible_to_clients: true, verb: "added a task" })
        yield* subscribe(t.id, [...(data.assignee_ids ?? []), ...(data.notify_ids ?? [])])
        for (const id of data.assignee_ids ?? []) if (id !== as.id) yield* notify(s.as(as), { personIds: [id], recording: t, kind: "assigned", summary: `${as.name} assigned you a task: ${title}`, email: false })
        return t
      })
    const complete = (t: Recording, by: Person, daysAgo: number) =>
      sql`update recordings set data = data || ${JSON.stringify({ completed_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(), completer_id: by.id })}::jsonb where id = ${t.id}`

    const launch = yield* createRecording(s.as(maya), { project: web, type: "todolist", title: "Launch checklist", body: "Everything that has to be true before we flip DNS.", data: { tracked: true }, visible_to_clients: true, verb: "made a task list" })
    const design = yield* createRecording(s.as(maya), { project: web, type: "todogroup", parent_id: launch.id, title: "Design", visible_to_clients: true })
    const build = yield* createRecording(s.as(maya), { project: web, type: "todogroup", parent_id: launch.id, title: "Build", visible_to_clients: true })
    const sketches = yield* todo(maya, web, design, "Homepage sketches", { assignee_ids: [ann.id], notify_ids: [maya.id], due_on: day(-3) }, "Three rough ideas. Quick sketches only.")
    yield* complete(sketches, ann, 2)
    yield* todo(maya, web, design, "Pick the type pairing", { assignee_ids: [ann.id], due_on: day(-2) })
    yield* todo(maya, web, design, "Pricing page copy", { assignee_ids: [ann.id, maya.id], starts_on: day(1), due_on: day(4) })
    const scaffold = yield* todo(maya, web, build, "Set up the static site", { assignee_ids: [bob.id], due_on: day(-6) })
    yield* complete(scaffold, bob, 5)
    yield* todo(maya, web, build, "Contact form", { assignee_ids: [bob.id], notify_ids: [maya.id], due_on: day(6) })
    yield* todo(maya, web, launch, "Point DNS at the new host", { assignee_ids: [bob.id], due_on: day(24) })

    const content = yield* createRecording(s.as(ann), { project: web, type: "todolist", title: "Content from Northwind", data: { tracked: true }, visible_to_clients: false, verb: "made a task list" })
    yield* todo(ann, web, content, "Get product photos", { assignee_ids: [maya.id], due_on: day(3) })
    yield* todo(ann, web, content, "Collect testimonials")

    const q4 = yield* createRecording(s.as(cara), { project: s.projects.marketing, type: "todolist", title: "Q4 campaigns", verb: "made a task list" })
    yield* todo(cara, s.projects.marketing, q4, "Draft the holiday email", { assignee_ids: [cara.id], due_on: day(10) })
    yield* todo(cara, s.projects.marketing, q4, "Book the podcast ads", { assignee_ids: [bob.id], due_on: day(-1) })

    yield* sql`insert into hill_updates ${sql.insert({ project_id: web.id, person_id: maya.id, positions: JSON.stringify({ [launch.id]: 20, [content.id]: 10 }), note: "Still working on the homepage.", created_at: new Date(Date.now() - 6 * 86400_000) })}`
    yield* sql`insert into hill_updates ${sql.insert({ project_id: web.id, person_id: ann.id, positions: JSON.stringify({ [launch.id]: 55, [content.id]: 30 }), note: "Over the hill on design." })}`
  })
