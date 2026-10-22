import { Effect, Layer, Schedule } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { DbLive } from "./db.ts"
import { AREAS } from "./areas.ts"
import { SyncLive, syncRoutes } from "./lib/sync.ts"
import { post, pubGet, json, str, num } from "./lib/web.ts"
import { trackVisit } from "./lib/core.ts"

const PORT = Number(process.env.PORT ?? 3000)
const DIST = new URL("../dist/", import.meta.url)

// The built React app (`bun run build`). In dev, Vite serves it and proxies /api here.
// Hashed assets are cached forever; every other path is a client route, so it gets index.html.
const app = HttpRouter.route("GET", "/*", (req) =>
  Effect.promise(async () => {
    const path = new URL(req.url, "http://localhost").pathname
    const file = Bun.file(new URL("." + decodeURIComponent(path), DIST))
    if (path !== "/" && !path.includes("..") && (await file.exists()))
      return HttpServerResponse.uint8Array(await file.bytes(), {
        contentType: file.type,
        headers: path.startsWith("/assets/") ? { "cache-control": "public, max-age=31536000, immutable" } : {},
      })
    const index = Bun.file(new URL("index.html", DIST))
    return (await index.exists())
      ? HttpServerResponse.text(await index.text(), { contentType: "text/html; charset=utf-8" })
      : HttpServerResponse.text("No build yet. Run `bun run dev` (app on :3000) or `bun run build`.", { status: 404 })
  }),
)

const builtIn = [
  /** Remember the last pages someone visited (Jump menu, Home's "recently visited"). Pages post this when they open. */
  post("/visits", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      yield* trackVisit(c, str(fd, "href"), str(fd, "title"), num(str(fd, "project_id")) ?? undefined, str(fd, "windows").split(",").filter(Boolean))
      return json(null)
    })),
  pubGet("/*", () => Effect.succeed({ ...json({ error: "NotFound" }), status: 404 })),
]

// Registered earlier wins, so the catch-alls go last.
const Routes = HttpRouter.addAll([...syncRoutes, ...AREAS.flatMap((a) => a.routes), ...builtIn, app] as ReadonlyArray<HttpRouter.Route<never, SqlClient.SqlClient>>)

// Background jobs: purge the 30-day trash, plus whatever each area schedules (bubble ups, check-ins, exports…).
const purgeTrash = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from recordings where status = 'trashed' and trashed_at < now() - interval '30 days'`
  yield* sql`delete from projects where status = 'trashed' and trashed_at < now() - interval '30 days'`
})
const jobs = [purgeTrash, ...AREAS.flatMap((a) => a.jobs ?? [])]
const Jobs = Layer.effectDiscard(
  Effect.forkDetach(
    Effect.forEach(jobs, (j) => j.pipe(Effect.catchCause((cause) => Effect.logError("job failed", cause))), { discard: true }).pipe(
      Effect.repeat(Schedule.spaced("1 minute")),
    ),
  ),
)

HttpRouter.serve(Routes).pipe(
  Layer.merge(Jobs),
  Layer.merge(SyncLive),
  Layer.provide(DbLive),
  Layer.provide(BunHttpServer.layer({ port: PORT })),
  Layer.launch,
  BunRuntime.runMain,
)
