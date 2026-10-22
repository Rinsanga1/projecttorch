// Timeline: every dated project on one timeline, plus markers (holidays, launches).
// The pages are client/areas/lineup.tsx; these are their posts. This is the reference area: others follow its shape.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { isoDate } from "../shared/format.ts"
import { post, redirect, invalid, str, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

type Marker = { id: number; name: string; on_date: string }

const DAY = 86_400_000

const readMarker = (fd: FormData) => {
  const m = { name: str(fd, "name"), on_date: str(fd, "on_date") }
  const errs = [...(m.name ? [] : ["Your marker needs a name."]), ...(/^\d{4}-\d{2}-\d{2}$/.test(m.on_date) ? [] : ["Pick a date."])]
  return { m, errs }
}

const findMarker = (c: Ctx) =>
  Effect.gen(function* () {
    if (isClient(c.me)) return yield* new NoAccess()
    const sql = yield* SqlClient.SqlClient
    const [m] = yield* sql<Marker>`select id, name, to_char(on_date, 'YYYY-MM-DD') as on_date from markers
      where id = ${Number(c.params.mid) || 0} and account_id = ${c.me.account_id}`
    if (!m) return yield* new NotFound()
    return m
  })

export const routes = [
  post("/timeline/markers", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const { m, errs } = readMarker(yield* c.form)
      if (errs.length) return invalid(errs)
      yield* sql`insert into markers ${sql.insert({ account_id: c.me.account_id, name: m.name, on_date: m.on_date })}`
      return redirect(`/timeline?from=${m.on_date}`, `Added the marker “${m.name}”.`)
    })),

  post("/timeline/markers/:mid/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const old = yield* findMarker(c)
      const { m, errs } = readMarker(yield* c.form)
      if (errs.length) return invalid(errs)
      yield* sql`update markers set name = ${m.name}, on_date = ${m.on_date} where id = ${old.id}`
      return redirect(`/timeline?from=${m.on_date}`, "Saved.")
    })),

  post("/timeline/markers/:mid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const m = yield* findMarker(c)
      yield* sql`delete from markers where id = ${m.id}`
      return redirect("/timeline", `Deleted the marker “${m.name}”.`)
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const day = (n: number) => isoDate(new Date(Date.now() + n * DAY))
    yield* sql`insert into markers ${sql.insert([
      { account_id: s.account.id, name: "Northwind site launch", on_date: day(24) },
      { account_id: s.account.id, name: "Company holiday", on_date: day(37) },
    ])}`
  })
