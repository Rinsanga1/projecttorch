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
  const res = await fetch(`${BASE}/api/signin`, { method: "POST", body: new URLSearchParams({ email, password: "projecttorch" }) })
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
ok(types.body.result?.content?.[0]?.text?.includes("declare const pt"), "describe returns the pt types")

// 4. A Code Mode script that does a morning's work in one go.
const work = await execute(key, `
  const made = await pt.projects.create({ name: "Agent check " + new Date().toISOString() })
  const id: number = made.created.find((x) => x.type === "project").id
  const ann = (await pt.people()).find((x) => x.name.startsWith("Ann"))
  await pt.projects.setPeople(id, [(await pt.me()).id, ann.id])
  await pt.projects.openWindow(id, "todos")
  await pt.projects.openWindow(id, "cardtable")
  const t = await pt.goals.create(id, { title: "Write the brief", due_on: "2026-11-01" })
  const taskId = t.created.find((x) => x.type === "todo").id
  await pt.goals.addSubgoal(taskId, { title: "Outline" })
  await pt.goals.complete(taskId)
  await pt.milestones.complete(taskId)   // the old name still works, and twice is still done (the helper looks first)
  const board = (await pt.projects.get(id)).boards[0]
  const col = (kind) => board.columns.find((c) => c.kind === kind)
  const a = await pt.cards.create(id, { title: "Ship it", column_id: col("triage").id, body: "## From the agent check\\n\\n- **one**" })
  const b = await pt.cards.create(id, { title: "Second", column_id: col("triage").id })
  const c = await pt.cards.create(id, { title: "Third", column_id: col("triage").id })
  const [ida, idb, idc] = [a, b, c].map((r) => r.created.find((x) => x.type === "card").id)
  await pt.cards.move(ida, col("triage").id, { after: idb })   // reorder in place: c, b, a
  const order = (await pt.projects.get(id)).boards[0].columns.find((x) => x.kind === "triage").cards.map((k) => k.title)
  for (const k of [ida, idb, idc]) await pt.cards.move(k, col("review").id)
  const post = await pt.posts.create(id, { title: "House rules", body: "Work only in Running." })
  const postId = post.created.find((x) => x.type === "message").id
  await pt.posts.pin(postId)
  await pt.posts.pin(postId)        // twice: still pinned
  await pt.call("POST", "/api/projects/" + id + "/posts", { title: "Told everyone", body: "x", notify: "everyone" })   // /api is forgiven
  await pt.comments.create(postId, "@Ann have a look")
  const line = await pt.chat.post(id, "Morning! All set.")
  await pt.chat.edit(line.created.find((x) => x.type === "line").id, "Morning! **All** set.")
  await pt.items.remind(postId, "2030-01-02")
  console.log("about to read back")
  const p = await pt.projects.get(id)
  let routeError = ""
  try { await pt.call("GET", "/projects/" + id + "/posts") } catch (e) { routeError = e.message }
  return {
    id, ids: [ida, idb, idc], postId, order, routeError, started: made.message,
    windows: p.windows.filter((w) => w.enabled).map((w) => w.type),
    routes: (await pt.routes()).includes("POST /projects/:id/posts"),
    goals: p.goals.map((x) => [x.title, x.done, x.subgoals.map((s) => s.done)]),
    columns: p.boards[0].columns.map((c) => [c.kind, c.cards.map((k) => k.title), c.title, c.color, c.note]),
    pinned: p.pinned.map((x) => x.title), chat: p.chat.map((x) => x.body),
  }
`)
const r = work.out?.result
ok(!work.isError, `the script ran${work.isError ? `: ${JSON.stringify(work.out)}` : ""}`)
ok(JSON.stringify(r?.goals) === JSON.stringify([["Write the brief", true, [true]]]), "goal and its subgoal done (pt.goals, and pt.milestones still works)")
ok(/Started from “Work with an agent”/.test(r?.started ?? ""), "an agent's new project starts from the agents' template")
ok(r?.columns?.map((c: any) => c[2]).join() === "Not now,Triage,Running,Mine,Review,Done", "its board: Not now, Triage, Running, Mine, Review, Done")
ok(r?.columns?.find((c: any) => c[2] === "Mine")?.[3] === "blue" && r?.columns?.find((c: any) => c[2] === "Review")?.[3] === "orange" && r?.columns?.find((c: any) => c[2] === "Running")?.[4] === "What your agent is working on.", "Mine blue, Review orange, Running says what it's for")
ok(r?.windows?.slice(0, 3).join() === "cardtable,message_board,vault", "its windows: Board, Posts, Files")
ok(JSON.stringify(r?.order) === JSON.stringify(["Third", "Second", "Ship it"]), "cards.move with after: reorders in place")
ok(r?.columns?.find((c: any) => c[0] === "review")?.[1]?.length === 3, "three cards in Review")
ok(JSON.stringify(r?.pinned) === JSON.stringify(["House rules", "House rules for agents"]), "posts.pin; projects.get puts pinned posts (the template's house rules too) first")
ok(r?.chat?.includes("Morning! **All** set."), "chat.edit")
ok(r?.routes && /no GET .*pt\.routes/.test(r?.routeError), "pt.routes() lists routes; a wrong route says so")
ok(work.out?.changes?.some((c: any) => c.type === "card" && c.change === "created"), "the run lists what it changed")
ok(work.out?.logs?.[0] === "about to read back", "console.log comes back")
const [via] = await db`select count(*)::int as n from events where project_id = ${r?.id} and via = 'Agent check'`
ok(via.n >= 5, `activity is marked via Agent check (${via.n} events)`)
const [things] = await db`select count(*)::int as n, count(*) filter (where via = 'Agent check')::int as v from recordings where project_id = ${r?.id}`
ok(things.n > 0 && things.n === things.v, `everything it made says via Agent check (${things.v} of ${things.n})`)
const notes = await db`select kind from notifications where project_id = ${r?.id}`
ok(notes.length === 1 && notes[0].kind === "mention", `agents don't ping: only the @mention got through (${notes.map((n: any) => n.kind).join() || "none"})`)
const [rem] = await db`select count(*)::int as n from bubble_ups where recording_id = ${r?.postId} and bubble_at > '2030-01-01'`
ok(rem.n === 1, "items.remind sets the reminder for that day")
const [rv] = await db`select data->'review' as review from recordings where id = ${r?.ids?.[0]}`
ok(rv.review?.via === "Agent check" && rv.review?.from, "moving into Review notes when, who, via and where from")

const blank = await execute(key, `
  const r = await pt.projects.create({ name: "Agent check blank", blank: true })
  const id = r.created.find((x) => x.type === "project").id
  const p = await pt.projects.get(id)
  await pt.projects.trash(id)
  return { windows: p.windows.length, made: r.created.length }
`)
ok(blank.out?.result?.windows === 0 && blank.out?.result?.made === 1, "blank: true gives an empty project")
const inApp = await api(maya, "/projects", { name: "Agent check, made in the app" })
ok(/people\/setup$/.test(inApp.body.redirect ?? ""), "a project made in the app still starts blank")
const appId = Number(/projects\/(\d+)/.exec(inApp.body.redirect)?.[1])
const [appCols] = await db`select count(*)::int as n from recordings where project_id = ${appId}`
ok(appCols.n === 0, "…with nothing in it")
await api(maya, `/projects/${appId}/trash-project`, {})
const [tpl] = await db`select count(*)::int as n from projects p join accounts a on a.id = p.account_id
  where p.kind = 'template' and p.name = 'Work with an agent' and a.id = (select account_id from people where email = 'maya@acme.test' limit 1)`
ok(tpl.n === 1, "the agents' template is made once, then reused")

// The sweep, as Maya in the browser: send one back, ship one, kill one.
const sweep = (cardId: number, fields: Record<string, string>) => api(maya, `/projects/${r.id}/cards/${cardId}/review`, fields)
ok((await sweep(r.ids[0], { verdict: "back" })).status === 422, "sending back needs a note")
const sent = await sweep(r.ids[0], { verdict: "back", body: "Make the heading shorter", then: "/" })
ok(sent.body.redirect === "/" && /back to Triage/.test(sent.body.flash?.msg), "Send it back: returns it where it came from, back to Home")
ok((await sweep(r.ids[0], { verdict: "ship" })).body.errors?.[0]?.includes("moved on"), "a card that left Review: someone got to it first")
ok(/Shipped/.test((await sweep(r.ids[1], { verdict: "ship" })).body.flash?.msg), "Ship it")
ok(/trash/.test((await sweep(r.ids[2], { verdict: "kill" })).body.flash?.msg), "Kill it")
const after = await db`select r.id, r.status, c.data->>'kind' as kind, (select count(*)::int from recordings x where x.parent_id = r.id and x.type = 'comment') as comments from recordings r join recordings c on c.id = r.parent_id where r.id in ${db(r.ids)} order by r.id`
ok(after.map((x: any) => `${x.kind}:${x.status}`).join() === "triage:active,done:active,review:trashed" && after[0].comments === 1, "the board shows the three answers")
ok(!(await execute(key, `await pt.projects.trash(${r.id}); return (await pt.projects.list({ status: "trashed" })).some((x) => x.id === ${r.id})`)).isError, "project trashed")

const bad = await execute(key, `await pt.items.get(999999999)`)
ok(bad.isError && /exist/.test(bad.out.error), "errors come back as errors")
const loop = await rpc(key, "tools/call", { name: "execute", arguments: { code: "while (true) {}" } })
ok(loop.body.result?.isError && /time/.test(loop.body.result.content[0].text), "a runaway script is stopped")
ok((await execute(key, `return await pt.call("POST", "/../mcp")`)).isError, "can't step outside /api")

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
const roWrite = await execute(roKey, `return await pt.projects.create({ name: "nope" })`)
ok(roWrite.isError && /only read/.test(roWrite.out.error), "Read only can't write")
ok(!(await execute(roKey, `return (await pt.projects.list()).length`)).isError, "Read only can read")

// 8. A client's agent sees what the client sees.
const [client] = await db`select email from people where role = 'client' and joined_at is not null and removed_at is null order by id limit 1`
const dan = await signIn(client.email)
const made = await api(dan, "/my/agents", { name: "Client's key", access: "read" })
const danKey = made.body.data?.token
ok(danKey?.startsWith("sfk_"), "a key made by hand on /my/agents")
const [internal] = await db`select p.id from projects p where p.kind = 'project' and p.status = 'active'
  and not exists (select 1 from project_people pp join people x on x.id = pp.person_id where pp.project_id = p.id and x.role = 'client') limit 1`
const peek = await execute(danKey, `return await pt.projects.get(${internal.id})`)
ok(peek.isError, "a client's agent can't open a project the client isn't on")

// 9. Disconnecting stops the key.
const [app] = await db`select id from connected_apps where name = 'Client''s key' order by id desc limit 1`
await api(dan, `/my/agents/${app.id}/disconnect`, {})
ok((await rpc(danKey, "ping")).status === 401, "disconnected: the key stops working")
await db`delete from oauth_clients where id = ${reg.client_id}`

console.log(failed ? `\n${failed} failed` : "\nAll good.")
process.exit(failed ? 1 : 0)
