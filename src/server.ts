// The server.
//
// Three things run at once in this process:
//   1. HTTP: answer requests as they come in.               (routes below)
//   2. Sync: every 250ms, push new changes to browsers.     (lib/sync.ts, SyncLive)
//   3. Jobs: every minute, purge trash and run area jobs.   (below)
//
// Effect is used for the parts that need it: starting things up in the right
// order, running loops that survive their own failures, and shutting down
// cleanly. Everything else is plain functions. Start reading at the bottom.

import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { DbLive } from "./db.ts"
import { AREAS } from "./areas.ts"
import { SyncLive, syncRoutes } from "./lib/sync.ts"
import { post, pubGet, json, str, num, runEvery } from "./lib/web.ts"
import { trackVisit } from "./lib/core.ts"

const PORT   = Number(process.env.PORT ?? 3000)
const DIST   = new URL("../dist/", import.meta.url)
const MINUTE = 60 * 1000

// ─── The built React app (`bun run build`) ─────────────────────────────────
// In dev, Vite serves the app and proxies /api here, so this only runs in production.

async function serveBuiltApp(url: string): Promise<HttpServerResponse.HttpServerResponse> {
  const path = new URL(url, "http://localhost").pathname

  if (path !== "/" && !path.includes("..")) {
    const file = Bun.file(new URL("." + decodeURIComponent(path), DIST))
    if (await file.exists()) {
      // Files in /assets/ have a hash in their name, so they never change. Cache forever.
      const headers = path.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : {}
      return HttpServerResponse.uint8Array(await file.bytes(), { contentType: file.type, headers })
    }
  }

  // Every other path is a page. React Router in the browser decides which one.
  const index = Bun.file(new URL("index.html", DIST))
  if (await index.exists()) return HttpServerResponse.text(await index.text(), { contentType: "text/html; charset=utf-8" })

  return HttpServerResponse.text("No build yet. Run `bun run dev` (app on :3000) or `bun run build`.", { status: 404 })
}

// ─── Routes ────────────────────────────────────────────────────────────────

// Pages post here when they open (Jump menu, Home's "recently visited").
const trackVisitRoute = post("/visits", (c) => Effect.gen(function* () {
  const fd = yield* c.form
  yield* trackVisit(c,
    str(fd, "href"),
    str(fd, "title"),
    num(str(fd, "project_id")) ?? undefined,
    str(fd, "windows").split(",").filter(Boolean),
    str(fd, "window"))
  return json(null)
}))

const apiNotFound = pubGet("/*", () => Effect.succeed({ ...json({ error: "NotFound" }), status: 404 }))
const builtApp    = HttpRouter.route("GET", "/*", (req) => Effect.promise(() => serveBuiltApp(req.url)))

// Order matters: the first match wins, so the two catch-alls go last.
const ROUTES = [
  ...syncRoutes,
  ...AREAS.flatMap((a) => a.routes),
  trackVisitRoute,
  apiNotFound,   // /api/* that nothing matched
  builtApp,      // everything else
] as ReadonlyArray<HttpRouter.Route<never, SqlClient.SqlClient>>

// ─── Background jobs ───────────────────────────────────────────────────────

const purgeTrash = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from recordings where status = 'trashed' and trashed_at < now() - interval '30 days'`
  yield* sql`delete from projects   where status = 'trashed' and trashed_at < now() - interval '30 days'`
})

const JOBS = [purgeTrash, ...AREAS.flatMap((a) => a.jobs ?? [])]

const runJobs = Effect.gen(function* () {
  for (const job of JOBS) {
    // One broken job must not stop the others.
    yield* job.pipe(Effect.catchCause((cause) => Effect.logError("job failed", cause)))
  }
})

// ─── Main ──────────────────────────────────────────────────────────────────

const Jobs = Layer.effectDiscard(runEvery(MINUTE, "jobs", runJobs))

const Server = HttpRouter.serve(HttpRouter.addAll(ROUTES)).pipe(
  Layer.merge(Jobs),                                    // 3. jobs
  Layer.merge(SyncLive),                                // 2. sync
  Layer.provide(DbLive),                                //    everything above gets Postgres
  Layer.provide(BunHttpServer.layer({ port: PORT })),   // 1. HTTP on PORT
)

// Start it all, run until Ctrl-C, then shut down in reverse order.
BunRuntime.runMain(Layer.launch(Server))
