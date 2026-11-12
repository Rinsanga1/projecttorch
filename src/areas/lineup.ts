// Timeline: every dated project on one timeline, plus markers (holidays, launches).
// Pages: client/areas/lineup.tsx. This file is what their forms post to.
//
//   POST /timeline/markers              add a marker
//   POST /timeline/markers/:mid/edit    change a marker
//   POST /timeline/markers/:mid/delete  delete a marker
//
// Markers are account-wide and clients can't touch them.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { isoDate } from "../shared/format.ts"
import { post, redirect, invalid, str, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import type { Seed } from "../seed.ts"

type Marker = { id: number; name: string; on_date: string }

const DAY = 86_400_000

// ─── Reading forms ─────────────────────────────────────────────────────────

const readMarker = (fd: FormData) => {
  const marker = {
    name:    str(fd, "name"),
    on_date: str(fd, "on_date"),
  }
  const errors: string[] = []
  if (!marker.name)                                 errors.push("Your marker needs a name.")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marker.on_date)) errors.push("Pick a date.")
  return { marker, errors }
}

// A marker in your account, or NotFound. Clients get NoAccess before we even look.
const findMarker = (c: Ctx) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient
  const [m] = yield* sql<Marker>`select id, name, to_char(on_date, 'YYYY-MM-DD') as on_date from markers
                                 where id = ${Number(c.params.mid) || 0} and account_id = ${c.me.account_id}`
  if (!m) return yield* new NotFound()
  return m
})

// ─── Handlers ──────────────────────────────────────────────────────────────

const addMarker = post("/timeline/markers", (c) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient
  const { marker, errors } = readMarker(yield* c.form)
  if (errors.length) return invalid(errors)

  yield* sql`insert into markers ${sql.insert({ account_id: c.me.account_id, ...marker })}`
  return redirect(`/timeline?from=${marker.on_date}`, `Added the marker “${marker.name}”.`)
}))

const editMarker = post("/timeline/markers/:mid/edit", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const old = yield* findMarker(c)
  const { marker, errors } = readMarker(yield* c.form)
  if (errors.length) return invalid(errors)

  yield* sql`update markers set name = ${marker.name}, on_date = ${marker.on_date} where id = ${old.id}`
  return redirect(`/timeline?from=${marker.on_date}`, "Saved.")
}))

const deleteMarker = post("/timeline/markers/:mid/delete", (c) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const marker = yield* findMarker(c)

  yield* sql`delete from markers where id = ${marker.id}`
  return redirect("/timeline", `Deleted the marker “${marker.name}”.`)
}))

export const routes = [
  addMarker,
  editMarker,
  deleteMarker,
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const day = (n: number) => isoDate(new Date(Date.now() + n * DAY))

  yield* sql`insert into markers ${sql.insert([
    { account_id: s.account.id, name: "Northwind site launch", on_date: day(24) },
    { account_id: s.account.id, name: "Company holiday",       on_date: day(37) },
  ])}`
})
