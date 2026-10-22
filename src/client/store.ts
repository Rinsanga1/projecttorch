// The browser's copy of the workspace, local-first after Linear. Pages read only from `db`, so they never wait on
// the network: the copy loads from IndexedDB at startup (instant), catches up over a WebSocket, and stays live.
// Writes are form posts (`submit`); each reply carries the changes it made, so the copy is current before we
// navigate. Optimistic posts change the copy first and, when offline, wait in a durable queue in IndexedDB.
import { observable, runInAction, type ObservableMap } from "mobx"
import { openDB } from "idb"
import { TABLES, keyOf, type Table, type Tables } from "../shared/domain.ts"

type Row = Record<string, any>
type Change = { id: number; tbl: Table; op: "upsert" | "delete"; row: Row; force?: boolean }
type Changes = { cursor: number; changes: Change[] } | { resync: true }
type Copy = { epoch: string; cursor: number; meId: number; tables: Partial<Record<Table, Row[]>> }

/** Every synced table as an observable map, keyed by `keyOf`. Rows are replaced whole, never mutated. */
export const db = Object.fromEntries(TABLES.map((t) => [t, observable.map<string, Row>({}, { deep: false })])) as unknown as {
  [T in Table]: ObservableMap<string, Tables[T]>
}
/** The same maps, untyped, for code that works on any table. */
const anyDb = db as unknown as Record<Table, ObservableMap<string, Row>>

export type Flash = { msg: string; href?: string; label?: string; at?: string }

export const state = observable({
  /** The copy is loaded (from disk or the network); until then the app shows nothing. */
  ready: false,
  meId: null as number | null,
  epoch: "",
  cursor: 0,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  /** Live connection to the server is open. */
  live: false,
  flash: null as Flash | null,
})

// ---------- disk ----------
const idb = openDB("saintsflow", 1, {
  upgrade(d) {
    d.createObjectStore("kv")
    d.createObjectStore("queue", { autoIncrement: true })
  },
})

let saveTimer: ReturnType<typeof setTimeout> | undefined
/** ponytail: writes the whole copy, throttled; per-row writes if the copy gets big. */
const save = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (state.meId === null) return
    const copy: Copy = { epoch: state.epoch, cursor: state.cursor, meId: state.meId, tables: {} }
    for (const t of TABLES) copy.tables[t] = [...anyDb[t].values()]
    await (await idb).put("kv", copy, "copy")
  }, 1000)
}

const fill = (copy: Copy) =>
  runInAction(() => {
    for (const t of TABLES) anyDb[t].replace((copy.tables[t] ?? []).map((r): [string, Row] => [keyOf(t, r), r]))
    state.epoch = copy.epoch
    state.cursor = copy.cursor
    state.meId = copy.meId
  })

const clear = () =>
  runInAction(() => {
    for (const t of TABLES) anyDb[t].clear()
    state.meId = null
    state.cursor = 0
  })

// ---------- sync ----------
const apply = (c: Changes) => {
  if ("resync" in c) return void resync()
  runInAction(() => {
    for (const ch of c.changes) {
      // Upserts older than the copy are already in it; synthetic deletes (`force`) always apply.
      if (ch.id <= state.cursor && !ch.force) continue
      const k = keyOf(ch.tbl, ch.row)
      if (ch.op === "delete") anyDb[ch.tbl].delete(k)
      else anyDb[ch.tbl].set(k, ch.row)
    }
    state.cursor = Math.max(state.cursor, c.cursor)
  })
  save()
}

/** Fetch a whole new copy (first visit, another person, a copy too old to patch). */
const bootstrap = async () => {
  const b = (await (await fetch("/api/bootstrap")).json()) as Copy | { meId: null }
  if (b.meId === null) {
    clear()
    await (await idb).delete("kv", "copy")
  } else {
    fill(b as Copy)
    save()
  }
  runInAction(() => (state.ready = true))
}

let ws: WebSocket | null = null
let retry = 0
const connect = () => {
  if (state.meId === null || ws) return
  const proto = location.protocol === "https:" ? "wss" : "ws"
  const sock = new WebSocket(`${proto}://${location.host}/api/sync/ws?me=${state.meId}&after=${state.cursor}&epoch=${state.epoch}`)
  ws = sock
  sock.onopen = () => { retry = 0; runInAction(() => (state.live = true)) }
  sock.onmessage = (e) => apply(JSON.parse(e.data))
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    runInAction(() => (state.live = false))
    setTimeout(connect, Math.min(30_000, 500 * 2 ** retry++))
  }
}
const disconnect = () => {
  const sock = ws
  ws = null
  sock?.close()
  runInAction(() => (state.live = false))
}

let resyncing: Promise<void> | null = null
/** Drop the copy and start over, e.g. after switching who you are. */
export const resync = () =>
  (resyncing ??= (async () => {
    disconnect()
    try { await bootstrap() } finally { resyncing = null }
    connect()
  })())

/** Load the copy from disk (or the network), then go live. Called once from main.tsx. */
export const start = async () => {
  addEventListener("online", () => { runInAction(() => (state.online = true)); replay() })
  addEventListener("offline", () => runInAction(() => (state.online = false)))
  const copy = (await (await idb).get("kv", "copy")) as Copy | undefined
  if (copy) {
    fill(copy)
    runInAction(() => (state.ready = true))
  } else {
    try { await bootstrap() } catch { runInAction(() => (state.ready = true)) }
  }
  connect()
  replay()
}

// ---------- writes ----------

/** What the server answers a form post with (see src/lib/web.ts Reply). */
export type Reply = {
  redirect?: string
  back?: boolean
  flash?: Flash
  errors?: string[]
  data?: any
  resync?: boolean
  sync?: Changes | null
  /** Set when the post was queued offline. */
  queued?: boolean
}

let temps: Array<[Table, string]> = []
/** Inside an optimistic update: add a stand-in row with a negative id. It's removed when the real one arrives. */
export const temp = <T extends Table>(tbl: T, row: Omit<Tables[T], "id"> & Partial<Pick<Tables[T], "id" & keyof Tables[T]>>) => {
  const r = { id: -Date.now() - Math.random(), ...row } as Row
  const k = keyOf(tbl, r)
  anyDb[tbl].set(k, r)
  temps.push([tbl, k])
}

const post = (action: string, body: FormData) =>
  fetch(`/api${action}`, {
    method: "POST",
    body,
    headers: { "x-sync-cursor": String(state.cursor), "x-sync-epoch": state.epoch },
  })

/**
 * Post a form to the server. `optimistic` changes the copy right away (use `db` and `temp`); if the server says no,
 * the copy is rebuilt. Only optimistic posts are queued when offline: they're the ones safe to replay later.
 */
export const submit = async (action: string, body: FormData, optimistic?: () => void): Promise<Reply> => {
  temps = []
  if (optimistic) runInAction(optimistic)
  const mine = temps
  temps = []
  const dropTemps = () => runInAction(() => mine.forEach(([t, k]) => anyDb[t].delete(k)))
  let res: Response
  try {
    res = await post(action, body)
  } catch {
    if (!optimistic) return { errors: ["You're offline, so that wasn't saved. Try again when you're back online."] }
    await (await idb).add("queue", { action, entries: [...body.entries()] })
    return { queued: true, back: true, flash: { msg: "Saved here. It'll sync when you're back online." } }
  }
  const reply = (await res.json().catch(() => ({ errors: [`Something went wrong (${res.status}).`] }))) as Reply
  dropTemps()
  if (reply.resync) await resync()
  else if (reply.sync) apply(reply.sync)
  if (!res.ok && optimistic) await resync()
  return reply
}

/** Send posts queued while offline, oldest first. Stops at the first one that still can't reach the server. */
let replaying = false
const replay = async () => {
  if (replaying || state.meId === null) return
  replaying = true
  try {
    const d = await idb
    for (const key of await d.getAllKeys("queue")) {
      const job = (await d.get("queue", key)) as { action: string; entries: [string, FormDataEntryValue][] }
      const fd = new FormData()
      for (const [k, v] of job.entries) fd.append(k, v)
      try { await post(job.action, fd) } catch { return }
      await d.delete("queue", key)
    }
  } finally {
    replaying = false
  }
}

/** Show a flash message on the next page (or this one, if we stay). */
export const flash = (f: Flash | string | undefined) => runInAction(() => (state.flash = f === undefined ? null : typeof f === "string" ? { msg: f } : f))
