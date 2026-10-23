// Tasks: add a task (one line is enough), add a subtask to it, complete, reorder, edit. A task with subtasks is done when
// they all are: completing it completes them, and completing or reopening a subtask settles the task. One level only.
// The window's bar is the share of the work done (client/news.ts progressOf). Records are `todo`, a subtask's parent
// is its task. The pages are client/areas/todos.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, num, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, windowUrl, urlFor, notify, logEvent, subscribe,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Person } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

/** Read the task fields. Only the title is required: the quick-add line sends nothing else. */
const readTodo = (fd: FormData, pool: ReadonlyArray<number>) => {
  const due = str(fd, "due")
  const due_on = due === "day" ? str(fd, "due_day") || null : due === "range" ? str(fd, "range_end") || null : null
  const starts_on = due === "range" ? str(fd, "range_start") || null : null
  const errs = [
    ...(str(fd, "title") ? [] : ["Type the task first."]),
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

const DONE = (c: Ctx) => ({ completed_at: new Date().toISOString(), completer_id: c.me.id })
const OPEN = { completed_at: null, completer_id: null }

/** Mark a task done or not. A task's subtasks go with it; a subtask's task is done exactly when all its subtasks are. */
const setDone = (c: Ctx, t: Recording, done: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const patch = JSON.stringify(done ? DONE(c) : OPEN)
    const [u] = yield* sql<Recording>`update recordings set data = data || ${patch}::jsonb, updated_at = now() where id = ${t.id} returning *`
    if (!t.parent_id) {
      yield* sql`update recordings set data = data || ${patch}::jsonb, updated_at = now() where parent_id = ${t.id} and type = 'todo' and status = 'active'`
    } else {
      const [left] = yield* sql<{ n: number }>`select count(*)::int as n from recordings where parent_id = ${t.parent_id} and type = 'todo' and status = 'active' and data->>'completed_at' is null`
      yield* sql`update recordings set data = data || ${JSON.stringify(left!.n ? OPEN : DONE(c))}::jsonb, updated_at = now() where id = ${t.parent_id}`
    }
    return u!
  })

export const routes = [
  // A task, from the window's one-line "Add a task…" (or a fuller form).
  post("/projects/:id/tasks", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (p.status !== "active") return yield* new NotFound()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const t = readTodo(fd, people.map((x) => x.id))
      if (t.errs.length) return invalid(t.errs)
      const todo = yield* createRecording(c, { project: p, type: "todo", tool: str(fd, "tool"), title: t.title, body: t.body, data: { ...t.data, completed_at: null }, verb: "added a task" })
      yield* subscribe(todo.id, t.data.notify_ids)
      yield* tellAssignees(c, todo, t.data.assignee_ids)
      return back(c, windowUrl(p, { id: str(fd, "tool") || "todos", type: "todos" }))
    })),

  // A subtask: under a task (one level), seen by whoever sees the task. A new open subtask reopens a done task.
  post("/projects/:id/tasks/:tid/subtasks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: task, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (task.status !== "active" || task.parent_id) return yield* new NotFound()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const t = readTodo(fd, people.map((x) => x.id))
      if (t.errs.length) return invalid(t.errs)
      const sub = yield* createRecording(c, { project: p, type: "todo", parent_id: task.id, title: t.title, body: t.body, data: { ...t.data, completed_at: null }, visible_to_clients: task.visible_to_clients, verb: `added a subtask to ${task.title}` })
      if (task.data.completed_at) yield* sql`update recordings set data = data || ${JSON.stringify(OPEN)}::jsonb, updated_at = now() where id = ${task.id}`
      yield* subscribe(sub.id, t.data.notify_ids)
      yield* tellAssignees(c, sub, t.data.assignee_ids)
      return back(c, urlFor(task))
    })),

  post("/projects/:id/tasks/reorder", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      for (const [k, v] of fd.entries()) {
        const id = num(k.replace(/^pos_/, ""))
        if (k.startsWith("pos_") && id) yield* sql`update recordings set position = ${Number(v) || 0} where id = ${id} and project_id = ${p.id} and type = 'todo'`
      }
      return back(c, windowUrl(p, { id: str(fd, "tool") || "todos", type: "todos" }))
    })),

  post("/projects/:id/tasks/:tid/complete", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      const done = !t.data.completed_at
      const u = yield* setDone(c, t, done)
      yield* logEvent(c, { project_id: p.id, recording_id: t.id, action: done ? "completed" : "uncompleted", summary: `${done ? "completed" : "un-completed"} ${t.title}` })
      if (done && t.data.notify_ids?.length)
        yield* notify(c, { personIds: t.data.notify_ids, recording: u, kind: "completed", summary: `${c.me.name} completed: ${t.title}` })
      return back(c, urlFor(t), done ? { msg: `Completed “${t.title}”.`, href: `/projects/${p.id}/tasks/${t.id}/undo-complete`, label: "Undo" } : undefined)
    })),

  // Was a GET (the flash's "Undo" link); the client page at the same path posts here.
  post("/projects/:id/tasks/:tid/undo-complete", (c) =>
    Effect.gen(function* () {
      const { r: t } = yield* findRecording(c, c.params.tid, "todo")
      yield* setDone(c, t, false)
      return redirect(urlFor(t), "Marked as not done.")
    })),

  post("/projects/:id/tasks/:tid/edit", (c) =>
    Effect.gen(function* () {
      const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
      if (t.status !== "active") return yield* new NotFound()
      const people = yield* projectPeople(p)
      const n = readTodo(yield* c.form, people.map((x) => x.id))
      if (n.errs.length) return invalid(n.errs)
      const u = yield* updateRecording(c, t, { title: n.title, body: n.body, data: n.data })
      yield* subscribe(u.id, n.data.notify_ids)
      yield* tellAssignees(c, u, n.data.assignee_ids.filter((id) => !(t.data.assignee_ids ?? []).includes(id)))
      return redirect(urlFor(u), "Saved.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob, cara } = s.people
    const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
    const web = s.projects.website
    const todo = (as: Person, project: Project, title: string, data: Record<string, any> = {}, body = "", parent?: Recording, visible = true) =>
      Effect.gen(function* () {
        const t = yield* createRecording(s.as(as), { project, type: "todo", parent_id: parent?.id ?? null, title, body, data: { assignee_ids: [], notify_ids: [], completed_at: null, ...data }, visible_to_clients: parent?.visible_to_clients ?? visible, verb: "added a task" })
        yield* subscribe(t.id, [...(data.assignee_ids ?? []), ...(data.notify_ids ?? [])])
        for (const id of data.assignee_ids ?? []) if (id !== as.id) yield* notify(s.as(as), { personIds: [id], recording: t, kind: "assigned", summary: `${as.name} assigned you a task: ${title}`, email: false })
        return t
      })
    const complete = (t: Recording, by: Person, daysAgo: number) =>
      sql`update recordings set data = data || ${JSON.stringify({ completed_at: new Date(Date.now() - daysAgo * 86400_000).toISOString(), completer_id: by.id })}::jsonb where id = ${t.id}`

    // Website Redesign: a few tasks, two of them split into subtasks.
    const homepage = yield* todo(maya, web, "Homepage design", { assignee_ids: [ann.id], due_on: day(4) }, "Signed off by Northwind.")
    const sketches = yield* todo(maya, web, "Sketches", { assignee_ids: [ann.id], due_on: day(-3) }, "Three rough ideas. Quick sketches only.", homepage)
    yield* complete(sketches, ann, 2)
    yield* todo(maya, web, "Pick the type pairing", { assignee_ids: [ann.id], due_on: day(-2) }, "", homepage)
    yield* todo(maya, web, "Pricing page copy", { assignee_ids: [ann.id, maya.id], starts_on: day(1), due_on: day(4) }, "", homepage)
    const site = yield* todo(maya, web, "Build the site", { assignee_ids: [bob.id], due_on: day(14) })
    const scaffold = yield* todo(maya, web, "Set up the static site", { assignee_ids: [bob.id], due_on: day(-6) }, "", site)
    yield* complete(scaffold, bob, 5)
    yield* todo(maya, web, "Contact form", { assignee_ids: [bob.id], notify_ids: [maya.id], due_on: day(6) }, "", site)
    yield* todo(ann, web, "Get product photos", { assignee_ids: [maya.id], due_on: day(3) }, "", undefined, false)
    yield* todo(ann, web, "Collect testimonials", {}, "", undefined, false)
    yield* todo(maya, web, "Point DNS at the new host", { assignee_ids: [bob.id], due_on: day(24) })

    yield* todo(cara, s.projects.marketing, "Draft the holiday email", { assignee_ids: [cara.id], due_on: day(10) })
    yield* todo(cara, s.projects.marketing, "Book the podcast ads", { assignee_ids: [bob.id], due_on: day(-1) })
  })
