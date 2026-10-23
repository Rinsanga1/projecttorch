// `bun run check:agents`, with the app running (`bun run dev`): connects an agent the way Claude or Cursor does
// (discover, register, approve, swap the code for keys), runs a Code Mode script over MCP, and checks the limits:
// Read only, a client's agent, agents making keys, refresh keys, disconnecting. Leaves a trashed "Agent check" project.
import { createHash, randomBytes } from "node:crypto"
import { DATABASE_URL } from "../src/db.ts"

const BASE = process.env.BASE ?? "http://localhost:3000"
const db = new Bun.SQL(DATABASE_URL)
let failed = 0
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failed++ }

/** Sign in with a password; the session cookie. */
const signIn = async (email: string) => {
  const res = await fetch(`${BASE}/api/signin`, { method: "POST", body: new URLSearchParams({ email, password: "saintsflow" }) })
  const sid = res.headers.getSetCookie().find((c) => c.startsWith("sid="))?.split(";")[0]
  if (!sid) throw new Error(`Couldn't sign in as ${email}: ${await res.text()}`)
  return sid
}
const api = async (sid: string, path: string, fields?: Record<string, string>) => {
  const res = await fetch(`${BASE}/api${path}`, { method: fields ? "POST" : "GET", headers: { cookie: sid }, body: fields ? new URLSearchParams(fields) : undefined })
  return { status: res.status, body: (await res.json()) as any }
}
const rpc = async (token: string, method: string, params?: unknown) => {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  return { status: res.status, body: (await res.json()) as any }
}
const execute = async (token: string, code: string) => {
  const r = await rpc(token, "tools/call", { name: "execute", arguments: { code } })
  return { isError: !!r.body.result?.isError, out: JSON.parse(r.body.result?.content?.[0]?.text ?? "null") }
}

// 1. Discovery, as an MCP client does it: knock, get pointed at the metadata.
const knock = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" })
const pointer = /resource_metadata="([^"]+)"/.exec(knock.headers.get("www-authenticate") ?? "")?.[1]
ok(knock.status === 401 && pointer, "/mcp without a key answers 401 with resource metadata")
const resource = await (await fetch(pointer!)).json() as any
const as = await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json() as any
ok(as.registration_endpoint && as.code_challenge_methods_supported?.includes("S256"), "authorization server metadata (registration, PKCE)")

// 2. Register, then approve as Maya.
const reg = await (await fetch(as.registration_endpoint, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "Agent check", redirect_uris: ["http://127.0.0.1:9/callback"] }),
})).json() as any
ok(reg.client_id, "registered a client")
ok((await fetch(as.registration_endpoint, { method: "POST", body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) })).status === 400, "refuses a javascript: redirect")

const maya = await signIn("maya@acme.test")
const connect = async (sid: string, access: "full" | "read") => {
  const verifier = randomBytes(32).toString("base64url")
  const q = {
    response_type: "code", client_id: reg.client_id, redirect_uri: "http://127.0.0.1:9/callback", state: "xyz",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }
  const shown = await api(sid, `/oauth/authorize?${new URLSearchParams(q)}`)
  const personId = String(shown.body.data.accounts[0].person_id)
  const approved = await api(sid, "/oauth/authorize", { ...q, person_id: personId, access })
  const back = new URL(approved.body.redirect)
  const code = back.searchParams.get("code")!
  const token = async (fields: Record<string, string>) => {
    const res = await fetch(as.token_endpoint, { method: "POST", body: new URLSearchParams(fields) })
    return { status: res.status, body: (await res.json()) as any }
  }
  const t = await token({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: q.redirect_uri, code_verifier: verifier })
  const again = await token({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: q.redirect_uri, code_verifier: verifier })
  return { shown, back, t, again, token }
}
const full = await connect(maya, "full")
ok(full.shown.body.data.client === "Agent check", "the approval page names the app")
ok(full.back.searchParams.get("state") === "xyz", "approval sends the code back with the state")
ok(full.t.body.access_token?.startsWith("sfa_") && full.t.body.refresh_token, "code swapped for an access and a refresh key")
ok(full.again.status === 400, "a code works once")
const key = full.t.body.access_token as string

// 3. MCP over the key.
const init = await rpc(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } })
ok(init.body.result?.protocolVersion === "2025-06-18" && init.body.result.capabilities.tools, "initialize")
const tools = await rpc(key, "tools/list")
ok(tools.body.result?.tools?.map((t: any) => t.name).join() === "describe,execute", "two tools: describe, execute")
const types = await rpc(key, "tools/call", { name: "describe", arguments: {} })
ok(types.body.result?.content?.[0]?.text?.includes("declare const sf"), "describe returns the sf types")

// 4. A Code Mode script that does a morning's work in one go.
const work = await execute(key, `
  const made = await sf.projects.create({ name: "Agent check " + new Date().toISOString() })
  const id: number = made.created.find((x) => x.type === "project").id
  await sf.projects.openWindow(id, "todos")
  await sf.projects.openWindow(id, "cardtable")
  const t = await sf.tasks.create(id, { title: "Write the brief", due_on: "2026-11-01" })
  const taskId = t.created.find((x) => x.type === "todo").id
  await sf.tasks.addSubtask(taskId, { title: "Outline" })
  await sf.tasks.complete(taskId)
  await sf.tasks.complete(taskId)   // twice: still done (the route toggles; the helper looks first)
  const board = (await sf.projects.get(id)).boards[0]
  const todo = board.columns.find((c) => c.kind === "triage"), done = board.columns.find((c) => c.kind === "done")
  const card = await sf.cards.create(id, { title: "Ship it", column_id: todo.id, body: "From the agent check" })
  await sf.cards.move(card.created.find((x) => x.type === "card").id, done.id)
  await sf.posts.create(id, { title: "Where we are", body: "Brief done, shipped." })
  await sf.chat.post(id, "Morning! All set.")
  console.log("about to read back")
  const p = await sf.projects.get(id)
  await sf.projects.trash(id)
  return {
    id,
    task: p.tasks.map((x) => [x.title, x.done, x.subtasks.map((s) => s.done)]),
    columns: p.boards[0].columns.map((c) => [c.kind, c.cards.map((k) => k.title)]),
    posts: p.posts.map((x) => x.title), chat: p.chat.map((x) => x.body),
    trashed: (await sf.projects.list({ status: "trashed" })).some((x) => x.id === id),
  }
`)
const r = work.out?.result
ok(!work.isError, `the script ran${work.isError ? `: ${JSON.stringify(work.out)}` : ""}`)
ok(JSON.stringify(r?.task) === JSON.stringify([["Write the brief", true, [true]]]), "task and subtask done")
ok(r?.columns?.find((c: any) => c[0] === "done")?.[1]?.includes("Ship it"), "card moved to Done")
ok(r?.posts?.includes("Where we are") && r?.chat?.includes("Morning! All set."), "post and chat line")
ok(r?.trashed, "project trashed")
ok(work.out?.changes?.some((c: any) => c.type === "card" && c.change === "created"), "the run lists what it changed")
ok(work.out?.logs?.[0] === "about to read back", "console.log comes back")
const [via] = await db`select count(*)::int as n from events where project_id = ${r?.id} and summary like '%(via Agent check)'`
ok(via.n >= 3, `activity says "(via Agent check)" (${via.n} events)`)

const bad = await execute(key, `await sf.items.get(999999999)`)
ok(bad.isError && /exist/.test(bad.out.error), "errors come back as errors")
const loop = await rpc(key, "tools/call", { name: "execute", arguments: { code: "while (true) {}" } })
ok(loop.body.result?.isError && /time/.test(loop.body.result.content[0].text), "a runaway script is stopped")
ok((await execute(key, `return await sf.call("POST", "/../mcp")`)).isError, "can't step outside /api")

// 5. What agents can't do.
ok((await fetch(`${BASE}/api/my/agents`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: new URLSearchParams({ name: "x" }) })).status === 403, "an agent can't make keys")

// 6. Refresh keys rotate.
const fresh = await full.token({ grant_type: "refresh_token", refresh_token: full.t.body.refresh_token, client_id: reg.client_id })
ok(fresh.body.access_token && (await rpc(fresh.body.access_token, "ping")).body.result, "refresh gives a working key")
ok((await full.token({ grant_type: "refresh_token", refresh_token: full.t.body.refresh_token, client_id: reg.client_id })).status === 400, "a refresh key works once")

// 7. Read only: approving again replaces the connection.
const ro = await connect(maya, "read")
const roKey = ro.t.body.access_token
ok((await rpc(key, "ping")).status === 401, "re-approving drops the old connection's keys")
const roWrite = await execute(roKey, `return await sf.projects.create({ name: "nope" })`)
ok(roWrite.isError && /only read/.test(roWrite.out.error), "Read only can't write")
ok(!(await execute(roKey, `return (await sf.projects.list()).length`)).isError, "Read only can read")

// 8. A client's agent sees what the client sees.
const [client] = await db`select email from people where role = 'client' and joined_at is not null and removed_at is null order by id limit 1`
const dan = await signIn(client.email)
const made = await api(dan, "/my/agents", { name: "Client's key", access: "read" })
const danKey = made.body.data?.token
ok(danKey?.startsWith("sfk_"), "a key made by hand on /my/agents")
const [internal] = await db`select p.id from projects p where p.kind = 'project' and p.status = 'active'
  and not exists (select 1 from project_people pp join people x on x.id = pp.person_id where pp.project_id = p.id and x.role = 'client') limit 1`
const peek = await execute(danKey, `return await sf.projects.get(${internal.id})`)
ok(peek.isError, "a client's agent can't open a project the client isn't on")

// 9. Disconnecting stops the key.
const [app] = await db`select id from connected_apps where name = 'Client''s key' order by id desc limit 1`
await api(dan, `/my/agents/${app.id}/disconnect`, {})
ok((await rpc(danKey, "ping")).status === 401, "disconnected: the key stops working")
await db`delete from oauth_clients where id = ${reg.client_id}`

console.log(failed ? `\n${failed} failed` : "\nAll good.")
process.exit(failed ? 1 : 0)
