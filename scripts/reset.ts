// Drop everything, apply db/schema.sql, load sample data. `bun run db:reset`
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { DbLive, DATABASE_URL } from "../src/db.ts"
import { baseSeed } from "../src/seed.ts"
import { AREAS } from "../src/areas.ts"

const schema = await Bun.file(new URL("../db/schema.sql", import.meta.url)).text()

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.unsafe("drop schema public cascade")
  yield* sql.unsafe("create schema public")
  // One statement at a time: the extended query protocol refuses multi-statement strings.
  for (const stmt of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) yield* sql.unsafe(stmt)
  const s = yield* baseSeed
  for (const a of AREAS) if (a.seed) yield* a.seed(s)
})

await Effect.runPromise(program.pipe(Effect.provide(DbLive)))
console.log(`Reset ${DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`)
process.exit(0)
