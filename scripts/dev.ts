// `bun run dev`: the API server on 3001 (restarts when src/ changes) and Vite on http://localhost:3000.
const run = (cmd: string[], env: Record<string, string> = {}) =>
  Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, ...env } })

const api = run(["bun", "--watch", "src/server.ts"], { PORT: "3001", DEV: "1" })
// Vite runs on Node, not Bun: under Bun, StyleX's media-query parser fails the second time a file compiles
// ("Invalid media query syntax" after any edit). Recheck when upgrading Bun or StyleX.
const web = run(["node", "node_modules/vite/bin/vite.js"], { API_PORT: "3001" })
await Promise.race([api.exited, web.exited])
api.kill()
web.kill()
