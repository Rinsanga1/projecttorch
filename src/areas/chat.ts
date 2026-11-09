// Project chat, bots and private chats (Pings).
// Pages: client/areas/chat.tsx. This file is what their forms post to, plus line attachments and the bots' posting URL.
//
// A Ping is a project of kind 'ping' whose people are its participants, so project chat and Pings share one
// conversation page, one composer and the same handlers below.
//
//   POST /projects/:id/chat/lines         post a line        (same for /chats/:id/…)
//   POST /projects/:id/chat/lines/:lid    edit your line
//   GET  /projects/:id/chat/lines/:lid/file   a line's attachment
//   POST /projects/:id/chat/read          opening the conversation marks its notifications read
//   POST /projects/:id/chat/notify        "everything" or "only @mentions" for this chat
//   POST /bots                            add a chatbot                         (admins)
//   POST /bots/:bid/delete                                                      (admins)
//   POST /bots/:token/lines               apps post as the bot; the token is the credential   (public)
//   POST /chats                           start a Ping (or reuse one with exactly these people)
//
// New lines reach open pages through sync, so there's no live stream of our own.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { excerpt } from "../shared/format.ts"
import { get, post, pubPost, redirect, back, invalid, json, str, ids, isAdmin, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, accountPeople, createRecording, updateRecording, notify, mentionedIds, type Project, type Recording } from "../lib/core.ts"
import { sendFile } from "./vault.ts"
import type { Seed } from "../seed.ts"

type Chatbot = { id: number; account_id: number; name: string; command_url: string | null; token: string; created_at: Date }

const MAX_LINE = 4000

/** Where a conversation lives: a project's chat or a Ping. */
const convUrl = (p: Project) => (p.kind === "ping" ? `/chats/${p.id}` : `/projects/${p.id}/chat`)

// ─── Posting ───────────────────────────────────────────────────────────────

/**
 * Post a line, with an optional file. Who hears about it:
 *   - @mentions, always (createRecording does that)
 *   - in a Ping, everyone in it
 *   - in project chat, whoever set this chat to "everything"
 * Then, if the line is "!botname …", run that bot's command.
 */
export const postLine = (c: Ctx, p: Project, body: string, file?: File | null, tool?: string) => Effect.gen(function* () {
  let line = yield* createRecording(c, { project: p, type: "line", tool, body, visible_to_clients: true, quiet: true })

  if (file && file.size > 0) {
    // Under storage/ (vault.ts STORAGE), so the vault's sendFile can serve it.
    const name = file.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file"
    const path = `storage/lines/${line.id}-${name}`
    yield* Effect.promise(async () => { await mkdir("storage/lines", { recursive: true }); await Bun.write(path, file) })
    line = yield* updateRecording(c, line, { data: { file: { path, name: file.name, size: file.size, type: file.type } } }, { quiet: true })
  }

  const pool      = yield* projectPeople(p)
  const mentioned = mentionedIds(body, pool)
  const summary   = `${c.me.name}: ${excerpt(body || (file ? `shared ${file.name}` : ""), 80)}`

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
const postBotLine = (bot: Chatbot, p: Project, body: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [line] = yield* sql<Recording>`insert into recordings ${sql.insert({
    account_id:         p.account_id,
    project_id:         p.id,
    type:               "line",
    body,
    visible_to_clients: true,
    creator_id:         null,
    data:               JSON.stringify({ chatbot_id: bot.id, chatbot_name: bot.name }),
  })} returning *`
  return line!
})

/** "!botname do something" sends the command to that bot's command URL; a text reply is posted back as the bot. */
const runCommand = (c: Ctx, p: Project, body: string) => Effect.gen(function* () {
  const m = body.match(/^!(\w+)\s*([\s\S]*)$/)
  if (!m) return
  const [, botName, command] = m

  const sql   = yield* SqlClient.SqlClient
  const [bot] = yield* sql<Chatbot>`select * from chatbots where account_id = ${p.account_id} and lower(name) = lower(${botName!}) and command_url is not null`
  if (!bot) return

  // In the background, so the person's line posts at once. A bot that's slow, down or silent just doesn't answer.
  yield* Effect.forkDetach(Effect.gen(function* () {
    const reply = yield* Effect.tryPromise(() =>
      fetch(bot.command_url!, {
        method:  "POST",
        headers: { "content-type": "application/json" },
        signal:  AbortSignal.timeout(5000),
        body:    JSON.stringify({ command, creator: c.me.name, project_id: p.id }),
      }).then((r) => (r.ok ? r.text() : "")))
    if (reply.trim()) yield* postBotLine(bot, p, reply.trim().slice(0, MAX_LINE))
  }).pipe(Effect.ignore))
})

// ─── Handlers shared by project chat and Pings ─────────────────────────────

const postLineHandler = (c: Ctx) => Effect.gen(function* () {
  const p = yield* findProject(c, c.params.id)
  if (p.status !== "active") return yield* new NoAccess()

  const fd   = yield* c.form
  const f    = fd.get("file")
  const file = f && typeof f === "object" && "size" in f && (f as File).size > 0 ? (f as File) : null
  const body = str(fd, "body")
  if (!body && !file) return back(c, convUrl(p), "Type a message first.")

  const line = yield* postLine(c, p, body, file, str(fd, "tool"))
  // Stay put: the conversation scrolls the new line into view itself (a redirect to its #line would scroll the page).
  const window = line.data.tool ? `?w=${line.data.tool}` : ""
  return back(c, `${convUrl(p)}${window}#line-${line.id}`)
})

// Only your own lines. A line with a file can lose its text; one without can't be emptied (delete it instead).
const saveLine = (c: Ctx) => Effect.gen(function* () {
  const { r, project } = yield* findRecording(c, c.params.lid, "line")
  if (r.creator_id !== c.me.id) return yield* new NotFound()

  const body = str(yield* c.form, "body")
  if (!body && !r.data.file) return back(c, `${convUrl(project)}/lines/${r.id}/edit`, "A message can't be empty. Delete it instead?")

  yield* updateRecording(c, r, { body }, { quiet: true })
  return redirect(`${convUrl(project)}#line-${r.id}`, "Saved.")
})

// Served the vault's way: inline only for images, video, audio and PDFs (sandboxed); anything else downloads.
// An uploaded .html can never run on our origin.
const lineFile = (c: Ctx) => Effect.gen(function* () {
  const { r } = yield* findRecording(c, c.params.lid, "line")
  const f = r.data.file as { path: string; name: string; type: string } | undefined
  if (!f) return yield* new NotFound()
  return yield* sendFile(f.path.replace(/^storage\//, ""), f.name, f.type, true)
})

/** Opening a conversation marks its notifications read (the old page did this when it loaded; the new one posts here). */
const markRead = (kind: "line" | "ping") => (c: Ctx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const p   = yield* findProject(c, c.params.id)
  yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and project_id = ${p.id} and kind = ${kind} and read_at is null`
  return json(null)
})

// ─── Project chat ──────────────────────────────────────────────────────────

const setChatNotify = post("/projects/:id/chat/notify", (c) => Effect.gen(function* () {
  const sql  = yield* SqlClient.SqlClient
  const p    = yield* findProject(c, c.params.id)
  const mode = str(yield* c.form, "notify") === "everything" ? "everything" : "mentions"

  // prefs.campfire_notify is { "<project id>": "everything" | "mentions" }.
  yield* sql`update people set prefs = jsonb_set(prefs, '{campfire_notify}', coalesce(prefs->'campfire_notify', '{}'::jsonb) || ${JSON.stringify({ [p.id]: mode })}::jsonb)
             where id = ${c.me.id}`
  if (mode === "everything") return redirect(convUrl(p), "You'll be notified about every message.")
  return redirect(convUrl(p), "You'll only be notified when someone @mentions you.")
}))

// ─── Chatbots ──────────────────────────────────────────────────────────────

const addBot = post("/bots", (c) => Effect.gen(function* () {
  if (!isAdmin(c.me)) return yield* new NoAccess()
  const sql        = yield* SqlClient.SqlClient
  const fd         = yield* c.form
  const name       = str(fd, "name")
  const commandUrl = str(fd, "command_url")
  if (!/^\w+$/.test(name))                            return redirect("/bots", "A bot needs a one-word name, like “weather”.")
  if (commandUrl && !/^https?:\/\//.test(commandUrl)) return redirect("/bots", "That doesn't look like a link.")

  yield* sql`insert into chatbots ${sql.insert({ account_id: c.me.account_id, name, command_url: commandUrl || null, token: crypto.randomUUID().replace(/-/g, "") })}`
  return redirect("/bots", `Added ${name}. Its posting URL is below.`)
}))

const deleteBot = post("/bots/:bid/delete", (c) => Effect.gen(function* () {
  if (!isAdmin(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from chatbots where id = ${Number(c.params.bid) || 0} and account_id = ${c.me.account_id}`
  return redirect("/bots", "Bot deleted.")
}))

// No session: the token in the URL is the credential. Takes JSON or a form: { content, project_id }.
const botPostsLine = pubPost("/bots/:token/lines", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const [bot] = yield* sql<Chatbot>`select * from chatbots where token = ${c.params.token ?? ""}`
  if (!bot) return HttpServerResponse.text("No bot with that URL.", { status: 404 })

  let input: { content?: unknown; project_id?: unknown }
  if (String(c.req.headers["content-type"] ?? "").includes("application/json")) {
    input = yield* Effect.promise(() => (c.req.source as Request).json().catch(() => ({})))
  } else {
    const fd = yield* c.form
    input = { content: fd.get("content"), project_id: fd.get("project_id") }
  }

  // Only an active, ordinary project in the bot's own account (not a Ping).
  const content = String(input.content ?? "").trim()
  const [p] = yield* sql<Project>`select * from projects where id = ${Number(input.project_id) || 0} and account_id = ${bot.account_id} and kind = 'project' and status = 'active'`
  if (!p)       return HttpServerResponse.text("Send a project_id for an active project in this account.", { status: 422 })
  if (!content) return HttpServerResponse.text("Send some content.", { status: 422 })

  const line = yield* postBotLine(bot, p, content.slice(0, MAX_LINE))
  return HttpServerResponse.text(`Posted message ${line.id}`, { status: 201 })
}))

// ─── Pings ─────────────────────────────────────────────────────────────────

/** The Ping with exactly these people (creator included), or a new one. */
const findOrCreatePing = (accountId: number, creatorId: number, personIds: ReadonlyArray<number>) => Effect.gen(function* () {
  const sql      = yield* SqlClient.SqlClient
  const everyone = [...new Set([creatorId, ...personIds])].sort((a, b) => a - b)

  const [existing] = yield* sql<Project>`
    select p.* from projects p where p.kind = 'ping' and p.account_id = ${accountId}
      and (select string_agg(person_id::text, ',' order by person_id) from project_people where project_id = p.id) = ${everyone.join(",")}`
  if (existing) return existing

  const [p] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: accountId, kind: "ping", name: "", tools: "[]", created_by: creatorId })} returning *`
  for (const personId of everyone) yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${personId})`
  return p!
})

// Unless the account allows it (settings.clients_can_ping), clients and staff can't Ping each other.
const startPing = post("/chats", (c) => Effect.gen(function* () {
  const fd     = yield* c.form
  const people = (yield* accountPeople(c.me.account_id)).filter((p) => p.id !== c.me.id)
  const chosen = ids(fd, "person_ids").filter((id) => people.some((p) => p.id === id))
  const picked = people.filter((p) => chosen.includes(p.id))
  const body   = str(fd, "body")
  if (!chosen.length) return invalid(["Pick at least one person to chat with."])

  if (!c.account.settings.clients_can_ping) {
    const otherSide = isClient(c.me) ? picked.filter((p) => !isClient(p)) : picked.filter(isClient)
    if (otherSide.length) return invalid([`You can't message people at ${otherSide[0]!.company_name ?? c.account.name}. Ask an admin if you need to.`])
  }

  const ping = yield* findOrCreatePing(c.me.account_id, c.me.id, chosen)
  if (body) yield* postLine(c, ping, body)
  return redirect(`/chats/${ping.id}`)
}))

export const routes = [
  // Project chat
  post("/projects/:id/chat/lines",          postLineHandler),
  post("/projects/:id/chat/lines/:lid",     saveLine),
  get( "/projects/:id/chat/lines/:lid/file", lineFile),
  post("/projects/:id/chat/read",           markRead("line")),
  setChatNotify,

  // Chatbots
  addBot,
  deleteBot,
  botPostsLine,

  // Pings
  startPing,
  post("/chats/:id/lines",          postLineHandler),
  post("/chats/:id/lines/:lid",     saveLine),
  get( "/chats/:id/lines/:lid/file", lineFile),
  post("/chats/:id/read",           markRead("ping")),
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann, bob, cara, dan } = s.people
  const web = s.projects.website

  // Bob hears about every message in the website chat.
  yield* sql`update people set prefs = prefs || jsonb_build_object('campfire_notify', jsonb_build_object(${String(web.id)}::text, 'everything')) where id = ${bob.id}`

  const chat = [
    [ann,  "Morning! Homepage sketches are in Files."],
    [bob,  "Nice. The hero is way calmer than the old one."],
    [maya, "Agreed. @Ann can we try it without the carousel?"],
    [ann,  "Already gone 😄"],
    [dan,  "Looks great from our side too."],
  ] as const
  for (const [who, body] of chat) yield* postLine(s.as(who), web, body)

  const [bot] = yield* sql<Chatbot>`insert into chatbots ${sql.insert({ account_id: s.account.id, name: "deploybot", command_url: null, token: crypto.randomUUID().replace(/-/g, "") })} returning *`
  yield* postBotLine(bot!, web, "Deployed staging build #42 ✅")

  const pair = yield* findOrCreatePing(s.account.id, maya.id, [ann.id])
  yield* postLine(s.as(maya), pair, "Got a minute to look at the pricing page?")
  yield* postLine(s.as(ann),  pair, "Sure, after lunch.")

  const group = yield* findOrCreatePing(s.account.id, maya.id, [bob.id, cara.id])
  yield* postLine(s.as(bob),  group, "Support queue spiked after the release. Looking into it.")
  yield* postLine(s.as(cara), group, "Thanks Bob, I'll keep folks posted.")
})
