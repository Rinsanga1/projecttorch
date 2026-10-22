// Every area of the breadboard is one module in src/areas/ exporting `routes`, and optionally `seed` and `jobs`.
// AREAS_ONLY=dev,items,home,... loads a subset (handy when areas are being built in parallel).
import type { Effect } from "effect"
import type { SqlClient } from "effect/sql"
import type { Seed } from "./seed.ts"

export type Area = {
  routes: ReadonlyArray<any>
  seed?: (s: Seed) => Effect.Effect<void, unknown, SqlClient.SqlClient>
  /** Runs every minute. */
  jobs?: ReadonlyArray<Effect.Effect<void, unknown, SqlClient.SqlClient>>
}

export const ALL = [
  "dev", "items", "marketing", "frontdoor", "outside", "home", "project", "messages", "todos", "timesheet", "vault", "chat",
  "schedule", "checkins", "cards", "forwards", "hey", "mystuff", "lineup", "reports", "find", "people", "admin",
]

const names = process.env.AREAS_ONLY ? process.env.AREAS_ONLY.split(",").map((s) => s.trim()) : ALL

export const AREAS: ReadonlyArray<Area> = await Promise.all(names.map((n) => import(`./areas/${n}.ts`) as Promise<Area>))
