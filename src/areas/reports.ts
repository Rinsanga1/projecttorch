// Activity & reports: Latest activity, Reports, Someone's activity, Someone's assignments, What's overdue,
// Upcoming dates, Tasks added & completed, Overview, Everything.
// Pages: client/areas/reports.tsx. They read the local copy, so there are no routes; only sample data lives here.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { isoDate } from "../shared/format.ts"
import { createRecording, logEvent } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

export const routes = []

// ─── Sample data ───────────────────────────────────────────────────────────
// Other areas' seeds don't run in an isolated database (AREAS_ONLY=reports), so give the reports something to show.
// Skipped when the Tasks seed already ran (the full app), so nothing is duplicated.

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  if ((yield* sql`select 1 from recordings where type = 'todo' limit 1`).length) return

  const { maya, ann, bob, cara, dan } = s.people
  const { website, marketing }        = s.projects
  const day = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000))

  yield* createRecording(s.as(maya), {
    project:            website,
    type:               "todo",
    title:              "Approve final homepage copy",
    data:               { assignee_ids: [dan.id], due_on: day(-3) },
    visible_to_clients: true,
    notifyIds:          [dan.id],
    notifyKind:         "assigned",
    verb:               "assigned a goal",
  })

  yield* createRecording(s.as(maya), {
    project:            website,
    type:               "todo",
    title:              "Set up redirects from the old site",
    data:               { assignee_ids: [bob.id], due_on: day(4) },
    visible_to_clients: true,
  })

  const done = yield* createRecording(s.as(ann), {
    project:            website,
    type:               "todo",
    title:              "Pick the typeface",
    data:               { assignee_ids: [ann.id], due_on: day(-6), completed_at: new Date().toISOString(), completer_id: ann.id },
    visible_to_clients: true,
  })
  yield* logEvent(s.as(ann), { project_id: website.id, recording_id: done.id, action: "completed", summary: `completed ${done.title}` })

  yield* createRecording(s.as(maya), {
    project: marketing,
    type:    "todo",
    title:   "Draft the Q4 email calendar",
    data:    { assignee_ids: [cara.id], due_on: day(-1) },
  })

  yield* createRecording(s.as(maya), {
    project:            website,
    type:               "event",
    title:              "Design review with Northwind",
    data:               { starts_at: `${day(3)}T15:00`, ends_at: `${day(3)}T16:00`, participant_ids: [maya.id, ann.id, dan.id] },
    visible_to_clients: true,
  })
})
