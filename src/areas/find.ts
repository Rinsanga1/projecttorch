// Find: Search, Go to and the keyboard shortcuts sheet. The pages are client/areas/find.tsx and search the local copy;
// the one post remembers a search in Recent searches (the old GET /find did that as it searched).
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, json, str } from "../lib/web.ts"

export const routes = [
  post("/find/recent", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const q = str(yield* c.form, "q")
      if (!q) return json(c.me.prefs.recent_searches ?? [])
      const recent = [q, ...(c.me.prefs.recent_searches ?? []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)
      yield* sql`update people set prefs = prefs || ${JSON.stringify({ recent_searches: recent })}::jsonb where id = ${c.me.id}`
      return json(recent)
    })),
]
