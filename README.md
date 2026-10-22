# Saintsflow

Project software, built from a breadboard: every place, affordance and wire, as a working app.
Bun + TypeScript + Effect 4 + Postgres. Server-rendered HTML, plain forms, styled with StyleX (no bundler).

## Run it

Needs Bun and a local Postgres (user `postgres` / password `postgres`, database `saintsflow_dev`).

    bun install
    bun run db:reset     # drop everything, apply db/schema.sql, load sample data
    bun run dev          # http://localhost:3000

There's no sign-in yet. The footer's "Acting as" picker switches who you are. Every email the app would send lands in `/inbox`.

Env: `DATABASE_URL`, `PORT`, `AREAS_ONLY=dev,items,home,…` (load a subset of areas), `FEED_SECRET`.

## Checks

    bun run typecheck
    bun run smoke        # with the server running: crawls every link as every person, reports 4xx/5xx

## Layout

- `db/schema.sql`: the whole schema. Most things people post are rows in `recordings`.
- `src/lib/`: `html.ts` (escaping templates), `web.ts` (routing, layout, who's acting), `core.ts` (projects, recordings, access, notifications).
- Styling: `src/lib/tokens.stylex.ts` (colors, type, spacing), `src/lib/ui.ts` (themes, the `sx()` helper, base styles for plain HTML, `/app.css`). StyleX compiles at server start through `src/lib/stylex-plugin.ts`, preloaded by `bunfig.toml`. In a template, write `<div${sx(styles.box)}>`.
- `src/areas/`: one module per breadboard area, each exporting `routes`, plus optional `seed` and `jobs`.
- `scripts/`: `dev.ts` (restarts the server on changes; `bun --watch` can't see StyleX-compiled files), `reset.ts`, `smoke.ts`.
