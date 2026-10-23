// Project chat, bots and private chats. A private chat is a project of kind 'ping' whose people are its participants,
// so project chat and private chats share one conversation page and one line composer.
// The pages are client/areas/chat.tsx; these are their posts, the line attachments and the bots' posting URL.
// New lines reach open pages through sync, so there's no live stream of our own.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { excerpt } from "../shared/format.ts"
import { get, post, pubPost, redirect, back, invalid, json, str, ids, isAdmin, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, accountPeople, createRecording, updateRecording, notify, mentionedIds, type Project, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

type Chatbot = { id: number; account_id: number; name: string; command_url: string | null; token: string; created_at: Date }

/** Where a conversation lives: a project's Campfire or a Ping. */
const convUrl = (p: Project) => (p.kind === "ping" ? `/chats/${p.id}` : `/projects/${p.id}/chat`)

// ---------- posting ----------

/** Post a line: notify mentions (via createRecording), Campfire "everything" people or Ping participants, run chatbot commands. */
export const postLine = (c: Ctx, p: Project, body: string, file?: File | null, tool?: string) =>
  Effect.gen(function* () {
    let line = yield* createRecording(c, { project: p, type: "line", tool, body, visible_to_clients: true, quiet: true })
    if (file && file.size > 0) {
      const name = file.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file"
      const path = `storage/lines/${line.id}-${name}`
      yield* Effect.promise(async () => { await mkdir("storage/lines", { recursive: true }); await Bun.write(path, file) })
      line = yield* updateRecording(c, line, { data: { file: { path, name: file.name, size: file.size, type: file.type } } }, { quiet: true })
    }
    const pool = yield* projectPeople(p)
    const mentioned = mentionedIds(body, pool)
    const summary = `${c.me.name}: ${excerpt(body || (file ? `shared ${file.name}` : ""), 80)}`
    if (p.kind === "ping") {
      yield* notify(c, { personIds: pool.map((x) => x.id), recording: line, kind: "ping", summary, email: false })
    } else {
      const everything = pool.filter((x) => x.prefs.campfire_notify?.[String(p.id)] === "everything" && !mentioned.includes(x.id))
      yield* notify(c, { personIds: everything.map((x) => x.id), recording: line, kind: "line", summary, email: false })
    }
    yield* runCommand(c, p, body)
    return line
  })

/** A line written by a chatbot (no person behind it). */
const postBotLine = (bot: Chatbot, p: Project, body: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [line] = yield* sql<Recording>`insert into recordings ${sql.insert({
      account_id: p.account_id, project_id: p.id, type: "line", body, visible_to_clients: true, creator_id: null,
      data: JSON.stringify({ chatbot_id: bot.id, chatbot_name: bot.name }),
    })} returning *`
    return line!
  })

/** "!botname do something" sends the command to that chatbot's command URL; a text reply is posted back as the bot. */
const runCommand = (c: Ctx, p: Project, body: string) =>
  Effect.gen(function* () {
    const m = body.match(/^!(\w+)\s*([\s\S]*)$/)
    if (!m) return
    const sql = yield* SqlClient.SqlClient
    const [bot] = yield* sql<Chatbot>`select * from chatbots where account_id = ${p.account_id} and lower(name) = lower(${m[1]!}) and command_url is not null`
    if (!bot) return
    yield* Effect.forkDetach(
      Effect.gen(function* () {
        const reply = yield* Effect.tryPromise(() =>
          fetch(bot.command_url!, {
            method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
            body: JSON.stringify({ command: m[2], creator: c.me.name, project_id: p.id }),
          }).then((r) => (r.ok ? r.text() : "")))
        if (reply.trim()) yield* postBotLine(bot, p, reply.trim().slice(0, 4000))
      }).pipe(Effect.ignore),
    )
  })

// ---------- route handlers shared by Campfire and Pings ----------

const postLineHandler = (c: Ctx) =>
  Effect.gen(function* () {
    const p = yield* findProject(c, c.params.id)
    if (p.status !== "active") return yield* new NoAccess()
    const fd = yield* c.form
    const f = fd.get("file")
    const file = f && typeof f === "object" && "size" in f && (f as File).size > 0 ? (f as File) : null
    const body = str(fd, "body")
    if (!body && !file) return back(c, convUrl(p), "Type a message first.")
    const line = yield* postLine(c, p, body, file, str(fd, "tool"))
    // Stay put: the conversation scrolls the new line into view itself (a redirect to its #line would scroll the page).
    return back(c, `${convUrl(p)}${line.data.tool ? `?w=${line.data.tool}` : ""}#line-${line.id}`)
  })

const saveLine = (c: Ctx) =>
  Effect.gen(function* () {
    const { r, project } = yield* findRecording(c, c.params.lid, "line")
    if (r.creator_id !== c.me.id) return yield* new NotFound()
    const body = str(yield* c.form, "body")
    if (!body && !r.data.file) return back(c, `${convUrl(project)}/lines/${r.id}/edit`, "A message can't be empty. Delete it instead?")
    yield* updateRecording(c, r, { body }, { quiet: true })
    return redirect(`${convUrl(project)}#line-${r.id}`, "Saved.")
  })

const lineFile = (c: Ctx) =>
  Effect.gen(function* () {
    const { r } = yield* findRecording(c, c.params.lid, "line")
    const f = r.data.file as { path: string; name: string; type: string } | undefined
    if (!f || !(yield* Effect.promise(() => Bun.file(f.path).exists()))) return yield* new NotFound()
    return HttpServerResponse.fromWeb(new Response(Bun.file(f.path), {
      headers: { "content-type": f.type || "application/octet-stream", "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"` },
    }))
  })

/** Opening a conversation marks its notifications read (the old page did this when it loaded; the new one posts here). */
const markRead = (kind: "line" | "ping") => (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const p = yield* findProject(c, c.params.id)
    yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and project_id = ${p.id} and kind = ${kind} and read_at is null`
    return json(null)
  })

// ---------- Pings ----------

/** A Ping with exactly these people, reusing an existing one. */
const findOrCreatePing = (accountId: number, creatorId: number, personIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const everyone = [...new Set([creatorId, ...personIds])].sort((a, b) => a - b)
    const [existing] = yield* sql<Project>`
      select p.* from projects p where p.kind = 'ping' and p.account_id = ${accountId}
        and (select string_agg(person_id::text, ',' order by person_id) from project_people where project_id = p.id) = ${everyone.join(",")}`
    if (existing) return existing
    const [p] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: accountId, kind: "ping", name: "", tools: "[]", created_by: creatorId })} returning *`
    for (const id of everyone) yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${id})`
    return p!
  })

// ---------- routes ----------
export const routes = [
  // Campfire
  post("/projects/:id/chat/lines", postLineHandler),
  post("/projects/:id/chat/lines/:lid", saveLine),
  get("/projects/:id/chat/lines/:lid/file", lineFile),
  post("/projects/:id/chat/read", markRead("line")),

  post("/projects/:id/chat/notify", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const v = str(yield* c.form, "notify") === "everything" ? "everything" : "mentions"
      yield* sql`update people set prefs = jsonb_set(prefs, '{campfire_notify}', coalesce(prefs->'campfire_notify', '{}'::jsonb) || ${JSON.stringify({ [p.id]: v })}::jsonb) where id = ${c.me.id}`
      return redirect(convUrl(p), v === "everything" ? "You'll be notified about every message." : "You'll only be notified when someone @mentions you.")
    })),

  // Chatbots
  post("/bots", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (!isAdmin(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const name = str(fd, "name")
      const commandUrl = str(fd, "command_url")
      if (!/^\w+$/.test(name)) return redirect("/bots", "A bot needs a one-word name, like “weather”.")
      if (commandUrl && !/^https?:\/\//.test(commandUrl)) return redirect("/bots", "That doesn't look like a link.")
      yield* sql`insert into chatbots ${sql.insert({ account_id: c.me.account_id, name, command_url: commandUrl || null, token: crypto.randomUUID().replace(/-/g, "") })}`
      return redirect("/bots", `Added ${name}. Its posting URL is below.`)
    })),

  post("/bots/:bid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (!isAdmin(c.me)) return yield* new NoAccess()
      yield* sql`delete from chatbots where id = ${Number(c.params.bid) || 0} and account_id = ${c.me.account_id}`
      return redirect("/bots", "Bot deleted.")
    })),

  /** Apps post here as the chatbot. No session: the token in the URL is the credential. */
  pubPost("/bots/:token/lines", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [bot] = yield* sql<Chatbot>`select * from chatbots where token = ${c.params.token ?? ""}`
      if (!bot) return HttpServerResponse.text("No bot with that URL.", { status: 404 })
      const json = String(c.req.headers["content-type"] ?? "").includes("application/json")
      const fd = json ? null : yield* c.form
      const input = (json
        ? yield* Effect.promise(() => (c.req.source as Request).json().catch(() => ({})))
        : { content: fd!.get("content"), project_id: fd!.get("project_id") }) as { content?: unknown; project_id?: unknown }
      const content = String(input.content ?? "").trim()
      const [p] = yield* sql<Project>`select * from projects where id = ${Number(input.project_id) || 0} and account_id = ${bot.account_id} and kind = 'project' and status = 'active'`
      if (!p) return HttpServerResponse.text("Send a project_id for an active project in this account.", { status: 422 })
      if (!content) return HttpServerResponse.text("Send some content.", { status: 422 })
      const line = yield* postBotLine(bot, p, content.slice(0, 4000))
      return HttpServerResponse.text(`Posted message ${line.id}`, { status: 201 })
    })),

  // Pings
  post("/chats", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      const people = (yield* accountPeople(c.me.account_id)).filter((p) => p.id !== c.me.id)
      const chosen = ids(fd, "person_ids").filter((id) => people.some((p) => p.id === id))
      const body = str(fd, "body")
      const picked = people.filter((p) => chosen.includes(p.id))
      const clientsOk = !!c.account.settings.clients_can_ping
      const blocked = clientsOk ? [] : isClient(c.me) ? picked.filter((p) => !isClient(p)) : picked.filter(isClient)
      const errs = !chosen.length
        ? ["Pick at least one person to chat with."]
        : blocked.length ? [`You can't message people at ${blocked[0]!.company_name ?? c.account.name}. Ask an admin if you need to.`] : []
      if (errs.length) return invalid(errs)
      const p = yield* findOrCreatePing(c.me.account_id, c.me.id, chosen)
      if (body) yield* postLine(c, p, body)
      return redirect(`/chats/${p.id}`)
    })),

  post("/chats/:id/lines", postLineHandler),
  post("/chats/:id/lines/:lid", saveLine),
  get("/chats/:id/lines/:lid/file", lineFile),
  post("/chats/:id/read", markRead("ping")),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob, cara, dan } = s.people
    const web = s.projects.website
    yield* sql`update people set prefs = prefs || jsonb_build_object('campfire_notify', jsonb_build_object(${String(web.id)}::text, 'everything')) where id = ${bob.id}`
    for (const [who, body] of [
      [ann, "Morning! Homepage sketches are in Files."],
      [bob, "Nice. The hero is way calmer than the old one."],
      [maya, "Agreed. @Ann can we try it without the carousel?"],
      [ann, "Already gone 😄"],
      [dan, "Looks great from our side too."],
    ] as const)
      yield* postLine(s.as(who), web, body)
    yield* postLine(s.as(cara), s.projects.hq, "Who's in for lunch at noon?")

    const [bot] = yield* sql<Chatbot>`insert into chatbots ${sql.insert({ account_id: s.account.id, name: "deploybot", command_url: null, token: crypto.randomUUID().replace(/-/g, "") })} returning *`
    yield* postBotLine(bot!, web, "Deployed staging build #42 ✅")

    const pair = yield* findOrCreatePing(s.account.id, maya.id, [ann.id])
    yield* postLine(s.as(maya), pair, "Got a minute to look at the pricing page?")
    yield* postLine(s.as(ann), pair, "Sure, after lunch.")
    const group = yield* findOrCreatePing(s.account.id, maya.id, [bob.id, cara.id])
    yield* postLine(s.as(bob), group, "Support queue spiked after the release. Looking into it.")
    yield* postLine(s.as(cara), group, "Thanks Bob, I'll keep folks posted.")
  })
