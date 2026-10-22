// Dev-only helpers while there's no sign-in: switch who you're acting as.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { pubGet, pubPost, back, json, num, str, withCookie, resync } from "../lib/web.ts"

export const routes = [
  pubPost("/dev/act-as", (c) =>
    Effect.gen(function* () {
      const id = num(str(yield* c.form, "person_id"))
      return resync(withCookie(back(c, "/"), "pid", String(id ?? "")))
    })),

  /** Everyone you can act as. Used by scripts/smoke.ts to crawl as everyone. */
  pubGet("/dev/people", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return json(yield* sql<{ id: number; name: string }>`select id, name from people where removed_at is null and joined_at is not null order by id`)
    })),
]
