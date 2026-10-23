// Dev-only helpers (`bun run dev`). Acting as someone else is the `pid` cookie (see loadMe), which scripts/smoke.ts sets.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { pubGet, json } from "../lib/web.ts"

export const routes = [
  /** Everyone you can act as. Used by scripts/smoke.ts to crawl as everyone. */
  pubGet("/dev/people", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return json(yield* sql<{ id: number; name: string }>`select id, name from people where removed_at is null and joined_at is not null order by id`)
    })),
]
