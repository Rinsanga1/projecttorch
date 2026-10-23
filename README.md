# Saintsflow

Project software, built from a breadboard: every place, affordance and wire, as a working app.
A React app (Vite on Rolldown, React Router, StyleX) on a Bun + TypeScript + Effect 4 + Postgres API, local-first
after Linear: the browser keeps a copy of everything you can see and renders from it. See `docs/tech_stack/stack.md`.

## Run it

Needs Bun, Node (Vite runs on it in dev) and a local Postgres (user `postgres` / password `postgres`, database `saintsflow_dev`).

    bun install
    bun run db:reset     # drop everything, apply db/schema.sql, load sample data
    bun run dev          # http://localhost:3000 (Vite), API on :3001

Production: `bun run build`, then `bun run start` serves the built app and the API on `PORT` (default 3000).

There's no sign-in yet. The footer's "Acting as" picker switches who you are. Every email the app would send lands in `/inbox`.

Env: `DATABASE_URL`, `PORT`, `AREAS_ONLY=dev,items,home,…` (load a subset of areas), `FEED_SECRET`.

## Checks

    bun run typecheck
    bun run smoke        # with `bun run dev` running: opens every page as every person in a headless browser

## How it fits together

- **Pages** are React components in `src/client/areas/<area>.tsx`, one `page(path, Component)` per route. They read
  only the local copy (`src/client/data.ts`, `db` in `src/client/store.ts`), so they never wait on the network.
- **Writes** are forms. `<Form action="/x">` posts to `/api/x` (a handler in `src/areas/<area>.ts`), which answers
  with a JSON reply (redirect, flash, validation errors) plus the changes it made, applied before navigating.
- **Sync**: Postgres triggers record every change to a synced table in `sync_log` (`db/schema.sql`). `src/lib/sync.ts`
  serves the bootstrap, streams changes over a WebSocket, and decides per person which rows they may see.
- **The copy** lives in MobX maps, saved to IndexedDB, so a reload paints instantly and reading works offline.
  Quick changes (toggles, reactions) apply optimistically and queue in IndexedDB while offline.

## Layout

- `db/schema.sql`: the whole schema. Most things people post are rows in `recordings`. Sync log and triggers at the end.
- `src/shared/`: what both sides use. `domain.ts` (row types, URLs, titles, roles, access), `format.ts` (dates, text).
- `src/lib/`: the API. `web.ts` (routes under /api, replies, who's acting), `core.ts` (projects, recordings, access,
  notifications), `sync.ts` (bootstrap, WebSocket, visibility).
- `src/areas/`: one module per breadboard area: its form posts and server-only routes (files, feeds, CSV), plus
  optional `seed` and `jobs`.
- `src/client/`: the React app. `main.tsx` (router), `app.tsx` (chrome, guards, shortcuts), `store.ts` (copy, sync,
  submit), `data.ts` (reads), `ui/` (tokens, base styles, kit, forms, page), `areas/` (pages).
- Styling: `src/client/ui/tokens.stylex.ts` (colors, type, spacing), `ui/kit.tsx` (themes, `sx()`, shared styles),
  `ui/base.ts` (styles for plain semantic HTML). Write `<div {...sx(styles.box)}>`.
- `scripts/`: `dev.ts` (API with --watch + Vite), `reset.ts`, `smoke.ts`.
# Saintsflow
