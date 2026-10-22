// Project chat, bots and private chats. A private chat is a project of kind 'ping' whose people are its participants,
// so project chat and private chats share one conversation page, one line composer and one live stream.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { html, raw, fmt, fmtDate, fmtTime, excerpt, plural, type Raw } from "../lib/html.ts"
import {
  get, post, pubPost, redirect, back, render, str, ids, errors, isAdmin, isClient, isOutOfOffice,
  NoAccess, NotFound, type Ctx, type Person,
} from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, accountPeople, createRecording, updateRecording, notify, mentionedIds,
  peopleCheckboxes, projectCrumbs, toolName, trackVisit, type Project, type Recording,
} from "../lib/core.ts"
import type { Seed } from "../seed.ts"
import { face, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// A conversation: each line as avatar + name/time + text, days split by a centered date, the composer in a tile.
const cs = stylex.create({
  lines: { margin: 0, marginBottom: space.s4 },
  line: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, alignItems: "start", paddingBlock: 6, borderTopWidth: 0 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2 },
  body: { overflowWrap: "anywhere" },
  extras: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, marginTop: 2, fontSize: text.sm },
  quiet: { color: color.muted, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  file: {
    display: "inline-flex", alignItems: "center", gap: 6, marginTop: space.s1, paddingBlock: 6, paddingInline: 12, borderRadius: radius.md,
    backgroundColor: color.tile, fontSize: text.sm, fontWeight: 600, textDecoration: "none",
  },
  day: { display: "flex", alignItems: "center", gap: space.s3, paddingBlock: space.s4, borderTopWidth: 0, color: color.muted },
  dayRule: { flexGrow: 1, height: 1, backgroundColor: color.line },
  dayLabel: { margin: 0, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  composer: { padding: space.s4, borderRadius: radius.xl, backgroundColor: color.tile, display: "grid", gap: space.s2 },
  field: { width: "100%", maxWidth: "none", minHeight: "3.5em", backgroundColor: color.sheet, margin: 0 },
  composerRow: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s3, margin: 0, maxWidth: "none" },
  composerHint: { margin: 0 },
  attach: { margin: 0, fontSize: text.sm },
})

type Line = Recording & { creator_name: string | null; creator_avatar?: string | null; boosts: string | null }
type Chatbot = { id: number; account_id: number; name: string; command_url: string | null; token: string; created_at: Date }

/** Where a conversation lives: a project's Campfire or a Ping. */
const convUrl = (p: Project) => (p.kind === "ping" ? `/chats/${p.id}` : `/projects/${p.id}/chat`)

// ---------- live updates ----------
// ponytail: in-process listeners, so live updates only reach people on the same server process. Use Postgres LISTEN/NOTIFY when there's more than one.
const listeners = new Map<number, Set<(data: string) => void>>()

const broadcast = (projectId: number, line: Line) => {
  // ponytail: live lines show UTC times until reload; pass each listener its time zone if that bugs anyone
  const data = JSON.stringify({ id: line.id, html: lineHtml(line, "UTC", null).s })
  for (const send of listeners.get(projectId) ?? []) send(data)
}

const stream = (projectId: number) => {
  const enc = new TextEncoder()
  let cleanup = () => {}
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (data: string) => ctrl.enqueue(enc.encode(`data: ${data}\n\n`))
      const set = listeners.get(projectId) ?? new Set()
      listeners.set(projectId, set.add(send))
      const ping = setInterval(() => ctrl.enqueue(enc.encode(": keepalive\n\n")), 25_000)
      ctrl.enqueue(enc.encode(": connected\n\n"))
      cleanup = () => { clearInterval(ping); set.delete(send) }
    },
    cancel() { cleanup() },
  })
  return HttpServerResponse.fromWeb(new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }))
}

// ---------- rendering ----------

/** One chat line. `me` null = rendered for everyone (live push); the page's script strips actions that aren't yours. */
const lineHtml = (l: Line, tz: string, me: Person | null): Raw => {
  const who = l.creator_name ?? (l.data.chatbot_name ? `${l.data.chatbot_name} (bot)` : "Someone")
  const own = l.creator_id !== null && (me === null || l.creator_id === me.id)
  const base = l.data.conv_url ?? ""
  return html`<li id="line-${l.id}"${sx(cs.line)}>
  ${face({ name: who, avatar_url: l.creator_avatar })}
  <div>
    <p${sx(cs.head)}><b>${who}</b> <small>${fmtTime(l.created_at, tz)}${l.updated_at.getTime() - l.created_at.getTime() > 1000 ? " (edited)" : ""}</small></p>
    <div${sx(cs.body)}>${fmt(l.body)}</div>
    ${l.data.file ? html`<a href="${base}/lines/${l.id}/file"${sx(cs.file)}>📎 ${l.data.file.name} <small>(${Math.ceil(l.data.file.size / 1024)} KB)</small></a>` : ""}
    <p${sx(cs.extras)}>
      ${l.boosts ? html`<small>Reactions: ${l.boosts}</small>` : ""}
      <a href="/r/${l.id}/reactions"${sx(cs.quiet)}>React</a>${own ? html`<span data-own="${l.creator_id}"><a href="${base}/lines/${l.id}/edit"${sx(cs.quiet)}>Edit</a> · <a href="/r/${l.id}/trash"${sx(cs.quiet)}>Delete</a></span>` : ""}
    </p>
  </div>
</li>`
}

const loadLines = (p: Project, opts: { before?: number | null; id?: number } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<Line>`
      select r.*, pe.name as creator_name, pe.avatar_url as creator_avatar,
        (select string_agg(b.content || ' ' || bp.name, ', ' order by b.id) from boosts b join people bp on bp.id = b.person_id where b.recording_id = r.id) as boosts
      from recordings r left join people pe on pe.id = r.creator_id
      where r.project_id = ${p.id} and r.type = 'line' and r.status = 'active'
        ${opts.id ? sql`and r.id = ${opts.id}` : sql``} ${opts.before ? sql`and r.id < ${opts.before}` : sql``}
      order by r.id desc limit 151`
    return rows.map((r) => ({ ...r, data: { ...r.data, conv_url: convUrl(p) } }))
  })

/** The conversation: lines grouped by day, the composer, and the live-update script. Shared by Campfire and Pings. */
const conversation = (c: Ctx, p: Project, blank: string) =>
  Effect.gen(function* () {
    const before = Number(c.query.get("before")) || null
    const rows = yield* loadLines(p, { before })
    const more = rows.length > 150
    const lines = rows.slice(0, 150).reverse()
    const days = new Map<string, Line[]>()
    for (const l of lines) {
      const d = fmtDate(l.created_at, c.me.time_zone)
      days.set(d, [...(days.get(d) ?? []), l])
    }
    const pool = (yield* projectPeople(p)).filter((x) => x.id !== c.me.id)
    const base = convUrl(p)
    return html`
${more ? html`<p><a href="${base}?before=${lines[0]!.id}">Show earlier messages</a></p>` : ""}
${before ? html`<p><a href="${base}">Back to the latest messages</a></p>` : ""}
${lines.length ? "" : html`<p>${blank}</p>`}
<ul id="lines"${sx(cs.lines)}>
${[...days].map(([d, ls]) => html`<li${sx(cs.day)}><span${sx(cs.dayRule)}></span><h2${sx(cs.dayLabel)}>${d}</h2><span${sx(cs.dayRule)}></span></li>${ls.map((l) => lineHtml(l, c.me.time_zone, c.me))}`)}
</ul>
${p.status === "active" ? html`
<form id="say" method="post" action="${base}/lines" enctype="multipart/form-data"${sx(cs.composer)}>
  <textarea name="body" rows="2" cols="70" placeholder="Type a message…" aria-label="Message"${sx(cs.field)}></textarea>
  <p id="send-status" role="alert" hidden><b>Not sent.</b> <button>Retry?</button></p>
  <p${sx(cs.composerRow)}>
    <label${sx(cs.attach)}>Attach a file <input type="file" name="file"></label>
    <button>Send</button>
  </p>
  <p${sx(cs.composerHint)}><small>Enter sends, Shift+Enter for a new line.${pool.length ? html` Mention someone with @: ${pool.map((x, i) => html`${i ? ", " : ""}@${x.name.split(" ")[0]}`)}` : ""}</small></p>
</form>
<script>
(() => {
  const list = document.getElementById("lines"), form = document.getElementById("say"), status = document.getElementById("send-status"), me = ${raw(String(c.me.id))}
  new EventSource(${raw(JSON.stringify(base + "/stream"))}).onmessage = (e) => {
    const { id, html } = JSON.parse(e.data)
    if (document.getElementById("line-" + id)) return
    list.insertAdjacentHTML("beforeend", html)
    list.lastElementChild.querySelectorAll("[data-own]").forEach((x) => x.dataset.own != me && x.remove())
    list.lastElementChild.scrollIntoView({ block: "nearest" })
  }
  form.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit() } })
  form.addEventListener("submit", async (e) => {
    if (form.file.files.length) return // uploads take the plain form post
    e.preventDefault()
    if (!form.body.value.trim()) return
    try {
      const r = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { "x-live": "1" } })
      if (!r.ok) throw new Error()
      form.body.value = ""; status.hidden = true
    } catch { status.hidden = false }
  })
})()
</script>` : html`<p><i>This ${p.kind === "ping" ? "conversation" : "project"} is read-only.</i></p>`}`
  })

// ---------- posting ----------

/** Post a line: notify mentions (via createRecording), Campfire "everything" people or Ping participants, push it live, run chatbot commands. */
export const postLine = (c: Ctx, p: Project, body: string, file?: File | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    let line = yield* createRecording(c, { project: p, type: "line", body, visible_to_clients: true, quiet: true })
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
    broadcast(p.id, { ...line, creator_name: c.me.name, boosts: null, data: { ...line.data, conv_url: convUrl(p) } })
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
    broadcast(p.id, { ...line!, creator_name: null, boosts: null, data: { ...line!.data, conv_url: convUrl(p) } })
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
    const live = c.req.headers["x-live"] === "1"
    if (!body && !file) return live ? HttpServerResponse.text("Type something first.", { status: 422 }) : back(c, convUrl(p), "Type a message first.")
    const line = yield* postLine(c, p, body, file)
    return live ? HttpServerResponse.text("Sent", { status: 201 }) : redirect(`${convUrl(p)}#line-${line.id}`)
  })

const editLineForm = (c: Ctx) =>
  Effect.gen(function* () {
    const { r, project } = yield* findRecording(c, c.params.lid, "line")
    if (r.creator_id !== c.me.id) return yield* new NotFound()
    return yield* render(c, "Edit message", html`
<h1>Edit your message</h1>
<form method="post" action="${convUrl(project)}/lines/${r.id}">
  <p><textarea name="body" rows="3" cols="70" required>${r.body}</textarea></p>
  <button>Save changes</button> <a href="${convUrl(project)}#line-${r.id}">Cancel</a>
</form>`, convCrumbs(project))
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

const streamHandler = (c: Ctx) =>
  Effect.gen(function* () {
    const p = yield* findProject(c, c.params.id)
    return stream(p.id)
  })

const convCrumbs = (p: Project) => (p.kind === "ping" ? [["Private chats", "/chats"] as const] : projectCrumbs(p, "campfire"))

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

const startPingForm = (c: Ctx, people: ReadonlyArray<Person & { company_name: string | null }>, chosen: number[], body: string, errs: string[]) => html`
<h1>Start a private chat</h1>
<p>Chat with one person or a few.</p>
${errors(errs)}
<form method="post" action="/chats">
  <p>Who do you want to chat with?</p>
  ${people.length ? peopleCheckboxes("person_ids", people, chosen) : html`<p>Nobody else is here yet. <a href="/people/invite">Invite someone</a></p>`}
  <p><label>Say something (optional)<br><textarea name="body" rows="2" cols="60" placeholder="Type a message…">${body}</textarea></label></p>
  <button>Start chatting</button> <a href="/chats">Cancel</a>
</form>`

// ---------- routes ----------
export const routes = [
  // Campfire
  get("/projects/:id/chat", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (p.kind === "ping") return redirect(`/chats/${p.id}${c.url.hash}`)
      yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and project_id = ${p.id} and kind = 'line' and read_at is null`
      yield* trackVisit(c, convUrl(p), `${p.name}: ${toolName(p, "campfire")}`, p.id)
      const setting = c.me.prefs.campfire_notify?.[String(p.id)] ?? "mentions"
      return yield* render(c, toolName(p, "campfire"), html`
<h1>${toolName(p, "campfire")}</h1>
${yield* conversation(c, p, "Chat with the group. Ask quick questions and share stuff.")}
<form method="post" action="/projects/${p.id}/chat/notify">
  <fieldset><legend>Notify me about</legend>
    <label><input type="radio" name="notify" value="everything"${setting === "everything" ? raw(" checked") : ""}> Everything</label>
    <label><input type="radio" name="notify" value="mentions"${setting === "mentions" ? raw(" checked") : ""}> Only @mentions</label>
    <button>Save</button>
  </fieldset>
</form>
${!isClient(c.me) ? html`<p><a href="/bots">Set up bots</a></p>` : ""}`, projectCrumbs(p))
    })),

  post("/projects/:id/chat/lines", postLineHandler),
  get("/projects/:id/chat/stream", streamHandler),
  get("/projects/:id/chat/lines/:lid/edit", editLineForm),
  post("/projects/:id/chat/lines/:lid", saveLine),
  get("/projects/:id/chat/lines/:lid/file", lineFile),

  post("/projects/:id/chat/notify", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const v = str(yield* c.form, "notify") === "everything" ? "everything" : "mentions"
      yield* sql`update people set prefs = jsonb_set(prefs, '{campfire_notify}', coalesce(prefs->'campfire_notify', '{}'::jsonb) || ${JSON.stringify({ [p.id]: v })}::jsonb) where id = ${c.me.id}`
      return redirect(convUrl(p), v === "everything" ? "You'll be notified about every message." : "You'll only be notified when someone @mentions you.")
    })),

  // Chatbots
  get("/bots", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      if (isClient(c.me)) return yield* new NoAccess()
      const bots = yield* sql<Chatbot>`select * from chatbots where account_id = ${c.me.account_id} order by name`
      const origin = `http://${c.req.headers.host ?? "localhost"}`
      return yield* render(c, "Bots", html`
<h1>Bots</h1>
<p>Bots are small programs that post in project chats and answer commands. To send a bot a command, type <code>!botname something</code> in a chat.</p>
${bots.length ? html`<ul>${bots.map((b) => html`<li>
  <b>${b.name}</b>${b.command_url ? html` · commands go to ${b.command_url}` : ""}
  <br>Posting URL: <input readonly size="70" value="${origin}/bots/${b.token}/lines" onclick="this.select()">
  <br><small>POST <code>content</code> and <code>project_id</code> (form or JSON) to post a message as ${b.name}.</small>
  ${isAdmin(c.me) ? html`<form method="post" action="/bots/${b.id}/delete"><button>Delete</button></form>` : ""}</li>`)}</ul>`
  : html`<p>Bots let other apps post in your project chats. Add one to get its posting URL.</p>`}
${isAdmin(c.me) ? html`<h2>Add a bot</h2>
<form method="post" action="/bots">
  <p><label>Name (one word, used for !commands)<br><input name="name" required pattern="\\w+"></label></p>
  <p><label>Command URL (optional)<br><input type="url" name="command_url" size="60" placeholder="https://example.com/bot"></label></p>
  <button>Add a bot</button>
</form>` : html`<p><small>Only admins can add or remove bots.</small></p>`}`, [["Admin", "/admin"], ["Integrations", "/admin/integrations"]])
    })),

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
  get("/chats", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const pings = yield* sql<{ id: number; names: string | null; unread: number; last_body: string | null; last_name: string | null; last_at: Date | null; created_at: Date }>`
        select * from (
          select p.id, p.created_at,
            (select string_agg(pe.name, ', ' order by pe.name) from project_people pp join people pe on pe.id = pp.person_id where pp.project_id = p.id and pe.id <> ${c.me.id}) as names,
            (select count(*) from notifications n where n.project_id = p.id and n.person_id = ${c.me.id} and n.kind = 'ping' and n.read_at is null)::int as unread,
            l.body as last_body, l.created_at as last_at, coalesce(lp.name, l.data->>'chatbot_name') as last_name
          from projects p join project_people mine on mine.project_id = p.id and mine.person_id = ${c.me.id}
          left join lateral (select * from recordings r where r.project_id = p.id and r.type = 'line' and r.status = 'active' order by r.id desc limit 1) l on true
          left join people lp on lp.id = l.creator_id
          where p.kind = 'ping' and p.account_id = ${c.me.account_id}) x
        order by unread > 0 desc, coalesce(last_at, created_at) desc`
      return yield* render(c, "Private chats", html`
<h1>Private chats</h1>
<p><a href="/chats/new" data-button>Start a private chat</a></p>
${pings.length
  ? html`<ul>${pings.map((g) => html`<li>
    <a href="/chats/${g.id}">${g.unread ? html`<b>${g.names ?? "Just you"}</b>` : g.names ?? "Just you"}</a>${g.unread ? ` (${plural(g.unread, "new message")})` : ""}
    ${g.last_body !== null ? html`<br><small>${g.last_name ?? "Someone"}: ${excerpt(g.last_body, 80)} · ${fmtDate(g.last_at, c.me.time_zone)}</small>` : ""}</li>`)}</ul>`
  : html`<p>A private chat is just you and one or a few people. Start one with anyone at ${c.account.name}.</p>`}`)
    })),

  get("/chats/new", (c) =>
    Effect.gen(function* () {
      const preset = c.query.getAll("person_id").map(Number).filter((n) => n > 0)
      const people = (yield* accountPeople(c.me.account_id)).filter((p) => p.id !== c.me.id)
      return yield* render(c, "Start a private chat", startPingForm(c, people, preset, "", []), [["Private chats", "/chats"]])
    })),

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
      if (errs.length) return yield* render(c, "Start a private chat", startPingForm(c, people, chosen, body, errs), [["Private chats", "/chats"]], 422)
      const p = yield* findOrCreatePing(c.me.account_id, c.me.id, chosen)
      if (body) yield* postLine(c, p, body)
      return redirect(`/chats/${p.id}`)
    })),

  get("/chats/:id", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (p.kind !== "ping") return redirect(`/projects/${p.id}`)
      const [member] = yield* sql`select 1 from project_people where project_id = ${p.id} and person_id = ${c.me.id}`
      if (!member) return yield* new NoAccess()
      yield* sql`update notifications set read_at = now() where person_id = ${c.me.id} and project_id = ${p.id} and kind = 'ping' and read_at is null`
      const others = (yield* projectPeople(p)).filter((x) => x.id !== c.me.id)
      const names = others.map((x) => x.name).join(", ") || "Just you"
      yield* trackVisit(c, `/chats/${p.id}`, `Private chat: ${names}`)
      const away = others.filter((x) => isOutOfOffice(x))
      return yield* render(c, `Private chat: ${names}`, html`
<h1>Chat with ${others.length ? others.map((x, i) => html`${i ? ", " : ""}<a href="/people/${x.id}">${x.name}</a>`) : "just you"}</h1>
${away.map((x) => html`<p role="note"><b>${x.name} is out of office until ${fmtDate(x.prefs.ooo!.until)}.</b>${x.prefs.ooo?.message ? html` ${x.prefs.ooo.message}` : ""}</p>`)}
${yield* conversation(c, p, `This is the start of your private chat${others.length ? ` with ${names}` : ""}. Only the people here can see it.`)}`, [["Private chats", "/chats"]])
    })),

  post("/chats/:id/lines", postLineHandler),
  get("/chats/:id/stream", streamHandler),
  get("/chats/:id/lines/:lid/edit", editLineForm),
  post("/chats/:id/lines/:lid", saveLine),
  get("/chats/:id/lines/:lid/file", lineFile),
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
