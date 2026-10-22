// The sync engine, server side. Browsers keep a copy of everything they're allowed to see (local-first, after Linear):
//   GET  /api/bootstrap   the whole copy, plus the epoch and cursor it was taken at
//   WS   /api/sync/ws     every change after a cursor, then live; {resync} when the copy can't be patched
//   (and every /api form post carries the changes it made; see web.ts)
// Changes come from sync_log, which Postgres triggers fill (db/schema.sql), so any write anywhere (a post, a job,
// a seed) reaches every browser that may see it. `shape` is the one place that decides who sees which row.
import { Effect, Layer, Schedule } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { CLIENT_INHERITS, KEYS, TABLES, canSeeProject, isAdmin, isClient, type Table } from "../shared/domain.ts"
import { loadMe, type Person } from "./web.ts"

type Me = Pick<Person, "id" | "account_id" | "role">
type Row = Record<string, any>
export type Change = { id: number; tbl: Table; op: "upsert" | "delete"; row: Row }
export type Scope = { projectIds: Set<number>; recordingIds: Set<number> }

// ---------- who sees what ----------

/** Projects and recordings `me` can see. Clients see a recording only if it and every ancestor is client-visible. */
export const scopeFor = (me: Me) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const projects = yield* sql<{ id: number; account_id: number; all_access: boolean; kind: "project" | "template" | "ping"; members: number[] }>`
      select p.id, p.account_id, p.all_access, p.kind, coalesce(array_agg(pp.person_id) filter (where pp.person_id is not null), '{}') as members
      from projects p left join project_people pp on pp.project_id = p.id
      where p.account_id = ${me.account_id} group by p.id`
    const projectIds = new Set(projects.filter((p) => canSeeProject(me, p, p.members)).map((p) => p.id))
    // ponytail: loads the account's recording skeleton per scope check; cache per account if accounts get big.
    const recs = yield* sql<{ id: number; parent_id: number | null; project_id: number; type: string; visible_to_clients: boolean; status: string; creator_id: number | null }>`
      select id, parent_id, project_id, type, visible_to_clients, status, creator_id from recordings where account_id = ${me.account_id}`
    const byId = new Map(recs.map((r) => [r.id, r]))
    const memo = new Map<number, boolean>()
    const sees = (id: number): boolean => {
      if (memo.has(id)) return memo.get(id)!
      const r = byId.get(id)
      let ok = !!r && projectIds.has(r.project_id) && (r.status !== "drafted" || r.creator_id === me.id)
      if (ok && isClient(me)) ok = (r!.visible_to_clients || CLIENT_INHERITS.includes(r!.type)) && (r!.parent_id === null || sees(r!.parent_id))
      memo.set(id, ok)
      return ok
    }
    return { projectIds, recordingIds: new Set(recs.filter((r) => sees(r.id)).map((r) => r.id)) } satisfies Scope
  })

const PUBLIC_PREFS = ["ooo", "wcw", "snooze_until"]
const PERSONAL: Partial<Record<Table, true>> = { pins: true, bookmarks: true, bubble_ups: true, notifications: true, connected_apps: true }

/** The row as `me` may see it, or null when they may not. */
export const shape = (tbl: Table, row: Row, me: Me, s: Scope): Row | null => {
  const inAccount = row.account_id === me.account_id
  if (PERSONAL[tbl]) return row.person_id === me.id ? row : null
  switch (tbl) {
    case "accounts": return row.id === me.account_id ? row : null
    case "companies": case "categories": case "markers": return inAccount ? row : null
    case "chatbots": return inAccount ? (isClient(me) ? { ...row, token: null } : row) : null
    case "people": {
      if (!inAccount) return null
      const { invite_token, ...rest } = row
      return row.id === me.id ? rest : { ...rest, prefs: Object.fromEntries(Object.entries(row.prefs ?? {}).filter(([k]) => PUBLIC_PREFS.includes(k))) }
    }
    case "projects": return s.projectIds.has(row.id) ? row : null
    case "project_people": case "hill_updates": case "gauge_updates": case "time_entries": return s.projectIds.has(row.project_id) ? row : null
    case "webhooks": return s.projectIds.has(row.project_id) && !isClient(me) ? row : null
    case "recordings": return s.recordingIds.has(row.id) ? row : null
    case "subscriptions": case "boosts": return s.recordingIds.has(row.recording_id) ? row : null
    case "public_links": return s.recordingIds.has(row.recording_id) && !isClient(me) ? row : null
    case "exports": return inAccount && isAdmin(me) ? row : null
    case "events":
      return inAccount && (row.project_id === null || s.projectIds.has(row.project_id)) && (row.recording_id === null || s.recordingIds.has(row.recording_id)) ? row : null
    default: return null
  }
}

// ---------- bootstrap ----------

const sync = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [m] = yield* sql<{ epoch: string; pruned_to: string; head: string }>`
    select epoch, pruned_to::text, (select coalesce(max(id), 0) from sync_log)::text as head from sync_meta`
  return { epoch: m!.epoch, prunedTo: Number(m!.pruned_to), head: Number(m!.head) }
})

/** Rows of `tbl` worth checking for `me`, before `shape` decides. */
const candidates = (sql: SqlClient.SqlClient, tbl: Table, me: Me) => {
  const t = sql(tbl)
  if (PERSONAL[tbl]) return sql<{ r: Row }>`select to_jsonb(x) as r from ${t} x where person_id = ${me.id}`
  switch (tbl) {
    case "accounts": return sql<{ r: Row }>`select to_jsonb(x) as r from accounts x where id = ${me.account_id}`
    case "project_people": case "hill_updates": case "gauge_updates": case "webhooks":
      return sql<{ r: Row }>`select to_jsonb(x) as r from ${t} x join projects p on p.id = x.project_id where p.account_id = ${me.account_id}`
    case "subscriptions": case "boosts": case "public_links":
      return sql<{ r: Row }>`select to_jsonb(x) as r from ${t} x join recordings rr on rr.id = x.recording_id where rr.account_id = ${me.account_id}`
    default: return sql<{ r: Row }>`select to_jsonb(x) as r from ${t} x where account_id = ${me.account_id}`
  }
}

export const bootstrap = (me: Me) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // The cursor is read before the tables: anything written in between is replayed later, and replays are idempotent.
    const { epoch, head } = yield* sync
    const s = yield* scopeFor(me)
    const tables: Partial<Record<Table, Row[]>> = {}
    for (const tbl of TABLES)
      tables[tbl] = (yield* candidates(sql, tbl, me)).map(({ r }) => shape(tbl, r, me, s)).filter((r): r is Row => r !== null)
    return { epoch, cursor: head, meId: me.id, tables }
  })

// ---------- changes ----------

export type Changes = { cursor: number; changes: Change[] } | { resync: true }

const logAfter = (cursor: number, limit = 5000) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ id: string; tbl: Table; op: "upsert" | "delete"; row: Row }>`
      select id::text, tbl, op, row from sync_log where id > ${cursor} order by id limit ${limit}`).map((c) => ({ ...c, id: Number(c.id) }))
  })

/** Everything `me` may see that changed after `cursor`, or {resync} when the copy is from another epoch or too old. */
export const changesFor = (me: Me, cursor: number, epoch: string) =>
  Effect.gen(function* () {
    const m = yield* sync
    if (epoch !== m.epoch || !Number.isFinite(cursor) || cursor < m.prunedTo || cursor > m.head) return { resync: true } as Changes
    const rows = yield* logAfter(cursor)
    if (rows.length === 5000) return { resync: true } as Changes
    const s = yield* scopeFor(me)
    return { cursor: rows.at(-1)?.id ?? cursor, changes: filterFor(rows, me, s) } as Changes
  })

const keyOnly = (tbl: Table, row: Row) => Object.fromEntries(KEYS[tbl].map((k) => [k, row[k]]))

const filterFor = (rows: ReadonlyArray<Change>, me: Me, s: Scope) =>
  rows.flatMap((c) => {
    // Deletes carry only the key: deleting a key the browser never had is harmless, and the old row stays private.
    if (c.op === "delete") return c.row.account_id === undefined || c.row.account_id === me.account_id ? [{ ...c, row: keyOnly(c.tbl, c.row) }] : []
    const row = shape(c.tbl, c.row, me, s)
    return row ? [{ ...c, row }] : []
  })

// ---------- live: WebSocket connections ----------

type Conn = { me: Me; scope: Scope; send: (msg: string) => void }
const conns = new Set<Conn>()

/** After a batch, re-check a connection's scope; if access changed in ways a patch can't express, ask for a resync. */
const refresh = (conn: Conn, batch: ReadonlyArray<Change>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const touchesAccess = batch.some((c) =>
      c.tbl === "projects" || c.tbl === "project_people" || c.tbl === "recordings" || (c.tbl === "people" && c.row.id === conn.me.id))
    if (!touchesAccess) return { resync: false, gone: [] as number[] }
    const [me] = yield* sql<Me & { removed_at: Date | null }>`select id, account_id, role, removed_at from people where id = ${conn.me.id}`
    if (!me || me.removed_at) return { resync: true, gone: [] }
    const next = yield* scopeFor(me)
    const old = conn.scope
    const inBatch = new Set(batch.filter((c) => c.tbl === "recordings").map((c) => c.row.id as number))
    const projectsChanged = next.projectIds.size !== old.projectIds.size || [...next.projectIds].some((id) => !old.projectIds.has(id))
    const revealed = [...next.recordingIds].some((id) => !old.recordingIds.has(id) && !inBatch.has(id))
    const roleChanged = me.role !== conn.me.role
    conn.me = me
    conn.scope = next
    return { resync: projectsChanged || revealed || roleChanged, gone: [...old.recordingIds].filter((id) => !next.recordingIds.has(id)) }
  })

let head = -1
/** Poll the log and fan new rows out to every open connection. */
const broadcast = Effect.gen(function* () {
  if (head < 0) head = (yield* sync).head
  const rows = yield* logAfter(head, 2000)
  if (!rows.length) return
  head = rows.at(-1)!.id
  for (const conn of conns) {
    const r = yield* refresh(conn, rows)
    if (r.resync) { conn.send(JSON.stringify({ resync: true })); continue }
    const changes = [
      ...filterFor(rows, conn.me, conn.scope),
      // Recordings that dropped out of view: the browser removes them even though their ids are old.
      ...r.gone.map((id) => ({ id: head, tbl: "recordings" as const, op: "delete" as const, row: { id }, force: true })),
    ]
    conn.send(JSON.stringify({ cursor: head, changes }))
  }
})

/** Forget changes older than a week; a browser offline longer than that bootstraps again. */
const prune = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [r] = yield* sql<{ id: string | null }>`select max(id)::text as id from sync_log where created_at < now() - interval '7 days'`
  if (!r?.id) return
  yield* sql`delete from sync_log where id <= ${r.id}`
  yield* sql`update sync_meta set pruned_to = ${r.id}`
})

/** Runs the broadcaster (every 250ms) and the pruner (hourly). */
export const SyncLive = Layer.effectDiscard(
  Effect.all([
    Effect.forkDetach(broadcast.pipe(Effect.catchCause((c) => Effect.logError("sync broadcast failed", c)), Effect.repeat(Schedule.spaced("250 millis")))),
    Effect.forkDetach(prune.pipe(Effect.catchCause((c) => Effect.logError("sync prune failed", c)), Effect.repeat(Schedule.spaced("1 hour")))),
  ]),
)

// ---------- routes ----------

const loadMeFrom = (req: HttpServerRequest.HttpServerRequest) => loadMe(req.cookies)

export const syncRoutes = [
  HttpRouter.route("GET", "/api/bootstrap", Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const { me } = yield* loadMeFrom(req)
    if (!me) return HttpServerResponse.jsonUnsafe({ meId: null })
    return HttpServerResponse.jsonUnsafe(yield* bootstrap(me))
  })),

  HttpRouter.route("GET", "/api/sync/ws", Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const { me } = yield* loadMeFrom(req)
    if (!me) return HttpServerResponse.empty({ status: 401 })
    const url = new URL(req.url, "http://localhost")
    const socket = yield* req.upgrade
    yield* Effect.scoped(Effect.gen(function* () {
      const writer = yield* socket.writer
      const reader = yield* socket.reader
      const send = (msg: string) => { Effect.runFork(writer.write(msg).pipe(Effect.ignore)) }
      // The browser's copy must belong to this person; catch it up, then go live.
      const first = Number(url.searchParams.get("me")) === me.id
        ? yield* changesFor(me, Number(url.searchParams.get("after")), url.searchParams.get("epoch") ?? "")
        : ({ resync: true } as const)
      send(JSON.stringify(first))
      if ("resync" in first) return
      const conn: Conn = { me, scope: yield* scopeFor(me), send }
      conns.add(conn)
      yield* Effect.forever(reader.pull).pipe(Effect.ignore, Effect.ensuring(Effect.sync(() => conns.delete(conn))))
    }))
    return HttpServerResponse.empty()
  })),
]
