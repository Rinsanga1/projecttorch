// `bun run dev`: the API server on 3001 (restarts when src/ changes) and Vite on http://localhost:3000.
const run = (cmd: string[], env: Record<string, string> = {}) =>
  Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, ...env } })

const api = run(["bun", "--watch", "src/server.ts"], { PORT: "3001" })
const web = run(["bunx", "--bun", "vite"], { API_PORT: "3001" })
await Promise.race([api.exited, web.exited])
api.kill()
web.kill()
