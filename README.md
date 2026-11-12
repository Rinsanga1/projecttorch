# ProjectTorch

Calm, opinionated project software for a team and its AI agents. Every project gets one home: Message Board, Compass
(goals and subgoals under one progress bar), Docs & Files, Campfire chat, Schedule and a Board, where to-dos are cards.
People bring the agent they already use (over MCP), hand it work on the Board, and ship, send back or kill what it puts
in Review. Who it's for and what it leaves out on purpose: `PRODUCT.md`. The look: `DESIGN.md`.

A React app (Vite on Rolldown, React Router, StyleX) on a Bun + TypeScript + Effect 4 + Postgres API, local-first
after Linear: the browser keeps a copy of everything you can see and renders from it.

## Run it

Needs Bun, Node (Vite runs on it in dev) and a local Postgres (user `postgres` / password `postgres`, database `projecttorch_dev`).

    bun install
    bun run db:reset     # drop everything, apply db/schema.sql, load sample data
    bun run dev          # http://localhost:3000 (Vite), API on :3001

Production: `bun run build`, then `bun run start` serves the built app and the API on `PORT` (default 3000).

Not deployed yet, so there are no migrations: change `db/schema.sql` and run `bun run db:reset`.

Sign in with a password or Google (sessions in `sessions`, passwords and Google ids in `logins`). Everyone in the sample data
has the password `projecttorch`. Signed out, `/` is the marketing page (`/marketing`; `/startups` too). Under `bun run dev` (it sets
`DEV=1`) a `pid` cookie acts as anyone (`scripts/smoke.ts` uses it), and every email the app would send lands in `/inbox`;
without `DEV=1` those are off.

Env: `DATABASE_URL`, `PORT`, `AREAS_ONLY=dev,items,home,…` (load a subset of areas), `FEED_SECRET`, `DEV=1`,
`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (Google sign-in; redirect URI `<app>/api/auth/google/callback`),
`APP_URL` (the public address, behind a proxy).

## Checks

    bun run typecheck
    bun test             # Markdown rendering, and that nothing in a body can run
    bun run smoke        # with `bun run dev` running: opens every page as every person in a headless browser
    bun run check:agents # with `bun run dev` running: connects an agent over OAuth and MCP, runs a script, checks limits
    bun run check:join   # with `bun run dev` running: the team link (/join/<code>) on the sample Acme account

The scripts take `BASE` (default `http://localhost:3000`); `smoke` also takes `LIMIT` (pages per person) and
`BROWSER` (a Chromium-based browser; Edge on Windows, else Playwright's Chromium).

## How it fits together

- **Pages** are React components in `src/client/areas/<area>.tsx`, one `page(path, Component)` per route. They read
  only the local copy (`src/client/data.ts`, `db` in `src/client/store.ts`), so they never wait on the network.
- **Writes** are forms. `<Form action="/x">` posts to `/api/x` (a handler in `src/areas/<area>.ts`), which answers
  with a JSON reply (redirect, flash, validation errors) plus the changes it made, applied before navigating.
- **Sync**: Postgres triggers record every change to a synced table in `sync_log` (`db/schema.sql`). `src/lib/sync.ts`
  serves the bootstrap, streams changes over a WebSocket, and decides per person which rows they may see.
- **The copy** lives in MobX maps, saved to IndexedDB, so a reload paints instantly and reading works offline.
  Quick changes (toggles, reactions) apply optimistically and queue in IndexedDB while offline.
- **Background work**: each area may export `jobs`, run every minute through one `runEvery` (`src/server.ts`).
- **Agents** (`src/areas/agents.ts`): someone's own AI agent works as them. `/mcp` is an MCP server in Code Mode: the
  agent gets the `pt` API (`src/lib/agent-api.ts`) from `describe` and runs scripts with `execute`, in a QuickJS
  sandbox (`src/lib/sandbox.ts`) whose every call is one of the app's own `/api` routes with the agent's key. Agents
  connect over OAuth (register, approve on `/oauth/authorize`, swap the code for keys) or with a key made on
  `/my/agents`. `loadMe` turns a key into the person; Read only keys can't post; what an agent makes and does is
  marked `via` (bylines read "Maya · via Claude Code"); agents never notify, except @mentions and Pings; finished
  cards wait in each board's Review column, listed on Home as "Waiting for you".
  Claude Code: `claude mcp add --transport http projecttorch http://localhost:3000/mcp`.

## Layout

- `db/schema.sql`: the whole schema. Most things people post are rows in `recordings`. Sync log and triggers at the end.
- `src/server.ts` (startup, background loops), `src/db.ts` (connection), `src/areas.ts` (the list of areas),
  `src/seed.ts` (sample accounts and people; each area seeds its own content).
- `src/shared/`: what both sides use. `domain.ts` (row types, URLs, titles, roles, access), `format.ts` (dates, text).
- `src/lib/`: the API. `web.ts` (routes under /api, replies, who's acting), `core.ts` (projects, recordings, access,
  notifications), `sync.ts` (bootstrap, WebSocket, visibility), `agent-api.ts` + `sandbox.ts` (agents).
- `src/areas/`: one module per breadboard area: its form posts and server-only routes (files, feeds, CSV), plus
  optional `seed` and `jobs`.
- `src/client/`: the React app. `main.tsx` (router), `app.tsx` (chrome, guards, shortcuts), `store.ts` (copy, sync,
  submit), `data.ts` (reads), `ui/` (tokens, base styles, kit, forms, page, icons, activity), `areas/` (pages).
- Styling: `src/client/ui/tokens.stylex.ts` (colors, type, spacing), `ui/kit.tsx` (themes, `sx()`, shared styles),
  `ui/base.ts` (styles for plain semantic HTML). Write `<div {...sx(styles.box)}>`.
- `scripts/`: `dev.ts` (API with --watch + Vite), `reset.ts`, `smoke.ts`, `agents.ts`, `join.ts`.

## Code style

Plain code that reads top to bottom, after Jonathan Blow, with Effect kept for I/O, errors that pass up the chain,
background loops and startup/shutdown.

- Each file opens with a comment listing what it serves; handlers are named functions gathered in a short `routes = [...]`.
- Early returns, no pipe chains where `Effect.gen` reads straighter, form parsing as plain functions.
- Comments say why. Don't run a query whose result is thrown away.
- React naming: PascalCase for components and types, camelCase for everything else.
