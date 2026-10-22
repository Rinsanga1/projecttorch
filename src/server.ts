import { Effect, Layer, Schedule } from "effect"
import { HttpRouter } from "effect/http"
import { SqlClient } from "effect/sql"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { DbLive } from "./db.ts"
import { AREAS } from "./areas.ts"
import { notFound } from "./areas/dev.ts"
import { assetRoutes } from "./lib/ui.ts"

const PORT = Number(process.env.PORT ?? 3000)

const Routes = HttpRouter.addAll([...assetRoutes, ...AREAS.flatMap((a) => a.routes), notFound] as ReadonlyArray<HttpRouter.Route<never, SqlClient.SqlClient>>)

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
  Layer.provide(DbLive),
  Layer.provide(BunHttpServer.layer({ port: PORT })),
  Layer.launch,
  BunRuntime.runMain,
)
