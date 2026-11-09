// Compass: goals and their subgoals. Add a goal (one line is enough), add a subgoal to it, complete, reorder, edit.
// Pages: client/areas/todos.tsx. This file is what their forms post to.
//
//   POST /projects/:id/tasks                        add a goal (the one-line "Add a goal…", or the fuller form)
//   POST /projects/:id/tasks/:tid/subtasks          add a subgoal under a goal
//   POST /projects/:id/tasks/reorder                drag to reorder
//   POST /projects/:id/tasks/:tid/complete          done ↔ not done
//   POST /projects/:id/tasks/:tid/undo-complete     the flash's "Undo"
//   POST /projects/:id/tasks/:tid/edit
//
// The rules, all in setDone:
//   - One level only: a goal has subgoals, a subgoal has none.
//   - Completing a goal completes its subgoals.
//   - A goal with subgoals is done exactly when all of them are: completing or reopening a subgoal settles its goal.
//
// Records are `todo` and URLs say `tasks` (old names); a subgoal's parent is its goal. The window's bar is the share of
// the work done (client/news.ts progressOf). To-dos and tasks people mean are Board cards (cards.ts), not these.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, back, invalid, str, ids, num, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, windowUrl, urlFor, notify, logEvent, subscribe,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Person } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

const DAY = 86400_000

// ─── Reading forms ─────────────────────────────────────────────────────────

/**
 * Read a goal's fields. Only the title is required: the quick-add line sends nothing else.
 * Assignees and people to notify must be on the project (`pool`); anyone else is dropped.
 */
const readTodo = (fd: FormData, pool: ReadonlyArray<number>) => {
  const title = str(fd, "title")
  const due   = str(fd, "due")   // "", "day" or "range"

  let due_on:    string | null = null
  let starts_on: string | null = null
  if (due === "day")   due_on = str(fd, "due_day") || null
  if (due === "range") { starts_on = str(fd, "range_start") || null; due_on = str(fd, "range_end") || null }

  // Dates are YYYY-MM-DD, so comparing the strings compares the days.
  const errors: string[] = []
  if (!title)                                              errors.push("Type the goal first.")
  if (due === "day" && !due_on)                            errors.push("Pick the day it's due.")
  if (due === "range" && (!starts_on || !due_on))          errors.push("Pick both the start and end day.")
  if (starts_on && due_on && due_on < starts_on)           errors.push("The end date has to come after the start date.")

  return {
    errors,
    title,
    body: str(fd, "body"),
    data: {
      assignee_ids: ids(fd, "assignee_ids").filter((id) => pool.includes(id)),
      notify_ids:   ids(fd, "notify_ids").filter((id) => pool.includes(id)),
      due_on,
      starts_on,
    },
  }
}

// ─── Doing things to goals ─────────────────────────────────────────────────

const tellAssignees = (c: Ctx, t: Recording, personIds: ReadonlyArray<number>) => Effect.gen(function* () {
  if (!personIds.length) return
  yield* subscribe(t.id, personIds)
  yield* notify(c, { personIds, recording: t, kind: "assigned", summary: `${c.me.name} assigned you a goal: ${t.title}` })
})

const done = (c: Ctx) => ({ completed_at: new Date().toISOString(), completer_id: c.me.id })
const OPEN = { completed_at: null, completer_id: null }

/** Mark a goal or subgoal done or not, and settle the other level (see the rules at the top). One transaction. */
const setDone = (c: Ctx, t: Recording, isDone: boolean) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const patch = JSON.stringify(isDone ? done(c) : OPEN)

  return yield* sql.withTransaction(Effect.gen(function* () {
    const [updated] = yield* sql<Recording>`update recordings set data = data || ${patch}::jsonb, updated_at = now() where id = ${t.id} returning *`

    if (!t.parent_id) {
      // A goal: its subgoals go with it.
      yield* sql`update recordings set data = data || ${patch}::jsonb, updated_at = now() where parent_id = ${t.id} and type = 'todo' and status = 'active'`
    } else {
      // A subgoal: its goal is done exactly when no subgoal is left open.
      const [left] = yield* sql<{ n: number }>`select count(*)::int as n from recordings
                                               where parent_id = ${t.parent_id} and type = 'todo' and status = 'active' and data->>'completed_at' is null`
      const goal = JSON.stringify(left!.n ? OPEN : done(c))
      yield* sql`update recordings set data = data || ${goal}::jsonb, updated_at = now() where id = ${t.parent_id}`
    }
    return updated!
  }))
})

const compassUrl = (p: Project, fd: FormData) => windowUrl(p, { id: str(fd, "tool") || "todos", type: "todos" })

// ─── Handlers ──────────────────────────────────────────────────────────────

const addGoal = post("/projects/:id/tasks", (c) => Effect.gen(function* () {
  const p = yield* findProject(c, c.params.id)
  if (p.status !== "active") return yield* new NotFound()

  const fd     = yield* c.form
  const people = yield* projectPeople(p)
  const t      = readTodo(fd, people.map((x) => x.id))
  if (t.errors.length) return invalid(t.errors)

  const goal = yield* createRecording(c, {
    project: p,
    type:    "todo",
    tool:    str(fd, "tool"),
    title:   t.title,
    body:    t.body,
    data:    { ...t.data, completed_at: null },
    verb:    "added a goal",
  })
  yield* subscribe(goal.id, t.data.notify_ids)
  yield* tellAssignees(c, goal, t.data.assignee_ids)
  return back(c, compassUrl(p, fd))
}))

// Seen by whoever sees the goal. A new open subgoal reopens a done goal.
const addSubgoal = post("/projects/:id/tasks/:tid/subtasks", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { r: goal, project: p } = yield* findRecording(c, c.params.tid, "todo")
  if (goal.status !== "active" || goal.parent_id) return yield* new NotFound()   // one level only

  const fd     = yield* c.form
  const people = yield* projectPeople(p)
  const t      = readTodo(fd, people.map((x) => x.id))
  if (t.errors.length) return invalid(t.errors)

  const sub = yield* createRecording(c, {
    project:            p,
    type:               "todo",
    parent_id:          goal.id,
    title:              t.title,
    body:               t.body,
    data:               { ...t.data, completed_at: null },
    visible_to_clients: goal.visible_to_clients,
    verb:               `added a subtask to ${goal.title}`,
  })
  if (goal.data.completed_at) yield* sql`update recordings set data = data || ${JSON.stringify(OPEN)}::jsonb, updated_at = now() where id = ${goal.id}`
  yield* subscribe(sub.id, t.data.notify_ids)
  yield* tellAssignees(c, sub, t.data.assignee_ids)
  return back(c, urlFor(goal))
}))

// Every `pos_<id>` field is that goal's new position.
const reorderGoals = post("/projects/:id/tasks/reorder", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProject(c, c.params.id)
  if (isClient(c.me)) return yield* new NoAccess()
  const fd  = yield* c.form

  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("pos_")) continue
    const id = num(key.slice("pos_".length))
    if (!id) continue
    yield* sql`update recordings set position = ${Number(value) || 0} where id = ${id} and project_id = ${p.id} and type = 'todo'`
  }
  return back(c, compassUrl(p, fd))
}))

const toggleComplete = post("/projects/:id/tasks/:tid/complete", (c) => Effect.gen(function* () {
  const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
  if (t.status !== "active") return yield* new NotFound()

  const isDone  = !t.data.completed_at
  const updated = yield* setDone(c, t, isDone)

  if (!isDone) {
    yield* logEvent(c, { project_id: p.id, recording_id: t.id, action: "uncompleted", summary: `un-completed ${t.title}` })
    return back(c, urlFor(t))
  }

  yield* logEvent(c, { project_id: p.id, recording_id: t.id, action: "completed", summary: `completed ${t.title}` })
  if (t.data.notify_ids?.length)
    yield* notify(c, { personIds: t.data.notify_ids, recording: updated, kind: "completed", summary: `${c.me.name} completed: ${t.title}` })
  return back(c, urlFor(t), { msg: `Completed “${t.title}”.`, href: `/projects/${p.id}/tasks/${t.id}/undo-complete`, label: "Undo" })
}))

// Was a GET (the flash's "Undo" link); the client page at the same path posts here.
const undoComplete = post("/projects/:id/tasks/:tid/undo-complete", (c) => Effect.gen(function* () {
  const { r: t } = yield* findRecording(c, c.params.tid, "todo")
  yield* setDone(c, t, false)
  return redirect(urlFor(t), "Marked as not done.")
}))

const editGoal = post("/projects/:id/tasks/:tid/edit", (c) => Effect.gen(function* () {
  const { r: t, project: p } = yield* findRecording(c, c.params.tid, "todo")
  if (t.status !== "active") return yield* new NotFound()

  const people = yield* projectPeople(p)
  const n      = readTodo(yield* c.form, people.map((x) => x.id))
  if (n.errors.length) return invalid(n.errors)

  const updated = yield* updateRecording(c, t, { title: n.title, body: n.body, data: n.data })
  yield* subscribe(updated.id, n.data.notify_ids)
  // Only the newly assigned hear about it.
  const newlyAssigned = n.data.assignee_ids.filter((id) => !(t.data.assignee_ids ?? []).includes(id))
  yield* tellAssignees(c, updated, newlyAssigned)
  return redirect(urlFor(updated), "Saved.")
}))

export const routes = [
  addGoal,
  addSubgoal,
  reorderGoals,
  toggleComplete,
  undoComplete,
  editGoal,
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann, bob, cara } = s.people
  const web       = s.projects.website
  const marketing = s.projects.marketing
  const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10)

  const todo = (as: Person, project: Project, title: string, data: Record<string, any> = {}, body = "", parent?: Recording, visible = true) => Effect.gen(function* () {
    const t = yield* createRecording(s.as(as), {
      project,
      type:               "todo",
      parent_id:          parent?.id ?? null,
      title,
      body,
      data:               { assignee_ids: [], notify_ids: [], completed_at: null, ...data },
      visible_to_clients: parent?.visible_to_clients ?? visible,
      verb:               "added a goal",
    })
    yield* subscribe(t.id, [...(data.assignee_ids ?? []), ...(data.notify_ids ?? [])])
    for (const id of data.assignee_ids ?? []) {
      if (id === as.id) continue
      yield* notify(s.as(as), { personIds: [id], recording: t, kind: "assigned", summary: `${as.name} assigned you a goal: ${title}`, email: false })
    }
    return t
  })

  const complete = (t: Recording, by: Person, daysAgo: number) =>
    sql`update recordings set data = data || ${JSON.stringify({ completed_at: new Date(Date.now() - daysAgo * DAY).toISOString(), completer_id: by.id })}::jsonb where id = ${t.id}`

  // Website Redesign: a few goals, two of them split into subgoals.
  const homepage = yield* todo(maya, web, "Homepage design", { assignee_ids: [ann.id], due_on: day(4) }, "Signed off by Northwind.")
  const sketches = yield* todo(maya, web, "Sketches", { assignee_ids: [ann.id], due_on: day(-3) }, "Three rough ideas. Quick sketches only.", homepage)
  yield* complete(sketches, ann, 2)
  yield* todo(maya, web, "Pick the type pairing", { assignee_ids: [ann.id], due_on: day(-2) }, "", homepage)
  yield* todo(maya, web, "Pricing page copy",     { assignee_ids: [ann.id, maya.id], starts_on: day(1), due_on: day(4) }, "", homepage)

  const site     = yield* todo(maya, web, "Build the site",         { assignee_ids: [bob.id], due_on: day(14) })
  const scaffold = yield* todo(maya, web, "Set up the static site", { assignee_ids: [bob.id], due_on: day(-6) }, "", site)
  yield* complete(scaffold, bob, 5)
  yield* todo(maya, web, "Contact form", { assignee_ids: [bob.id], notify_ids: [maya.id], due_on: day(6) }, "", site)

  yield* todo(ann,  web, "Get product photos",        { assignee_ids: [maya.id], due_on: day(3) }, "", undefined, false)
  yield* todo(ann,  web, "Collect testimonials",      {},                                          "", undefined, false)
  yield* todo(maya, web, "Point DNS at the new host", { assignee_ids: [bob.id], due_on: day(24) })

  // Marketing
  yield* todo(cara, marketing, "Draft the holiday email", { assignee_ids: [cara.id], due_on: day(10) })
  yield* todo(cara, marketing, "Book the podcast ads",    { assignee_ids: [bob.id],  due_on: day(-1) })
})
