// Activity & reports: Latest activity, Reports, Someone's activity, Someone's assignments, What's overdue,
// Upcoming dates, Tasks added & completed, Overview, Everything.
// The pages are client/areas/reports.tsx and read the local copy; only the fixtures live here.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { isoDate } from "../shared/format.ts"
import { createRecording, logEvent } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

export const routes = []

// Report fixtures: other areas' seeds don't run in an isolated database, so give the reports something to show.
// Skipped when the Tasks seed already ran (the full app), so nothing is duplicated.
export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if ((yield* sql`select 1 from recordings where type = 'todo' limit 1`).length) return
    const { maya, ann, bob, dan } = s.people
    const day = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000))
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "todo", title: "Approve final homepage copy",
      data: { assignee_ids: [dan.id], due_on: day(-3) }, visible_to_clients: true, notifyIds: [dan.id], notifyKind: "assigned", verb: "assigned a goal" })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "todo", title: "Set up redirects from the old site",
      data: { assignee_ids: [bob.id], due_on: day(4) }, visible_to_clients: true })
    const done = yield* createRecording(s.as(ann), { project: s.projects.website, type: "todo", title: "Pick the typeface",
      data: { assignee_ids: [ann.id], due_on: day(-6), completed_at: new Date().toISOString(), completer_id: ann.id }, visible_to_clients: true })
    yield* logEvent(s.as(ann), { project_id: s.projects.website.id, recording_id: done.id, action: "completed", summary: `completed ${done.title}` })
    yield* createRecording(s.as(maya), { project: s.projects.marketing, type: "todo", title: "Draft the Q4 email calendar",
      data: { assignee_ids: [s.people.cara.id], due_on: day(-1) } })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "event", title: "Design review with Northwind",
      data: { starts_at: `${day(3)}T15:00`, ends_at: `${day(3)}T16:00`, participant_ids: [maya.id, ann.id, dan.id] }, visible_to_clients: true })
  })

