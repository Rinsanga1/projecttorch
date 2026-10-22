// Drop everything, apply db/schema.sql, load sample data. `bun run db:reset`
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { DbLive, DATABASE_URL } from "../src/db.ts"
import { baseSeed } from "../src/seed.ts"
import { AREAS } from "../src/areas.ts"

const schema = await Bun.file(new URL("../db/schema.sql", import.meta.url)).text()

/** Statements split on `;`, except inside $$ … $$ bodies. */
const statements = (s: string) => {
  const out: string[] = []
  let cur = "", quoted = false
  for (const part of s.replace(/--.*$/gm, "").split(/(\$\$|;)/)) {
    if (part === "$$") quoted = !quoted
    if (part === ";" && !quoted) { out.push(cur.trim()); cur = "" } else cur += part
  }
  return [...out, cur.trim()].filter(Boolean)
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe("drop schema public cascade")
  yield* sql.unsafe("create schema public")
  // One statement at a time: the extended query protocol refuses multi-statement strings.
  for (const stmt of statements(schema)) yield* sql.unsafe(stmt)
  const s = yield* baseSeed
  for (const a of AREAS) if (a.seed) yield* a.seed(s)
  // Browsers bootstrap from the tables; the seed's own change log is noise.
  yield* sql`truncate sync_log restart identity`
})

await Effect.runPromise(program.pipe(Effect.provide(DbLive)))
console.log(`Reset ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`)
process.exit(0)
