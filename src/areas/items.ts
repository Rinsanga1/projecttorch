// "Every item works the same": comments, boosts, subscribers, the ••• menu, move/copy, history,
// bookmarks, bubble ups, trash, archive and client visibility, for any recording.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDateTime, plural, type Raw } from "../lib/html.ts"
import { get, post, redirect, back, render, str, ids, bool, num, isAdmin, isClient, NotFound, type Ctx } from "../lib/web.ts"
import {
  findRecording, findProject, projectPeople, urlFor, titleOf, TYPE_NAMES, TYPE_TOOL, projectCrumbs, toolUrl, personLink,
  subscribe, subscriberIds, notify, createRecording, logEvent, peopleCheckboxes, peopleByIds, clientVisible,
  type Recording, type Project,
} from "../lib/core.ts"
import { face, kit, menu, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// ---------- pieces other areas render ----------

/** Banner at the top of a trashed / archived / drafted item. */
export const statusBanner = (r: Recording, trashedBy?: string | null) => {
  if (r.status === "trashed") {
    const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(r.trashed_at ?? Date.now()).getTime()) / 86_400_000))
    return html`<div role="note"><p><b>This ${TYPE_NAMES[r.type] ?? "item"} is in the trash.</b> ${trashedBy ?? "Someone"} put it there on ${fmtDateTime(r.trashed_at)}. It'll be deleted forever in ${plural(left, "day")}.</p>
      <form method="post" action="/r/${r.id}/restore"><button>Put it back</button></form></div>`
  }
  if (r.status === "archived")
    return html`<div role="note"><p><b>This is archived.</b> It's read-only until you unarchive it.</p>
      <form method="post" action="/r/${r.id}/unarchive"><button>Unarchive</button></form></div>`
  if (r.status === "drafted") return html`<div role="note"><p><b>This is a draft.</b> Only you can see it.</p></div>`
  return ""
}

// Drawn at the file icons' stroke, in currentColor.
const svg = (d: string) => raw(`<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`)
const EYE = svg(`<path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>`)
const LOCK = svg(`<rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`)

/** Visible-to-clients banner, only for projects with clients. */
export const clientBanner = (c: Ctx, r: Recording, hasClients: boolean) =>
  hasClients && !isClient(c.me)
    ? html`<p${sx(fs.vis)}>${r.visible_to_clients ? EYE : LOCK}<span>${r.visible_to_clients ? "This is visible to clients." : "Clients can't see this."}</span> <a href="/r/${r.id}/clients">Change</a></p>`
    : ""

// The bottom of every item page: boost pills, the comment thread, the comment box, who gets notified.
const fs = stylex.create({
  vis: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: text.sm, color: color.muted },
  menuFor: { color: color.muted, marginBottom: space.s6 },
  boosts: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, marginBlock: space.s5 },
  boost: {
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, paddingBlock: 4, paddingInline: 12,
    borderRadius: radius.pill, backgroundColor: color.tile, fontSize: text.sm,
  },
  boostMine: { paddingRight: 4 },
  boostWho: { color: color.muted, fontSize: text.xs },
  unboost: { minHeight: 24, width: 24, padding: 0, fontSize: text.base, lineHeight: 1, backgroundColor: color.sheet },
  boostForm: { display: "inline-flex", alignItems: "center", gap: 6, margin: 0 },
  boostInput: { width: "13rem", minHeight: 32, paddingBlock: 3, borderRadius: radius.pill, fontSize: text.sm },
  boostButton: { minHeight: 32 },
  section: { marginTop: space.s7, paddingTop: space.s6, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.line },
  heading: { marginTop: 0, marginBottom: space.s4 },
  comment: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, paddingBlock: space.s4 },
  commentHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, marginBottom: 2 },
  commentBody: { maxWidth: "70ch" },
  commentMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s3, marginTop: space.s2, marginBottom: 0, fontSize: text.sm },
  quiet: { color: color.muted, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  box: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, marginTop: space.s3, padding: space.s4, borderRadius: radius.xl, backgroundColor: color.tile },
  boxField: { width: "100%", maxWidth: "none", minHeight: "6.5em", backgroundColor: color.sheet },
  hints: { display: "grid", gap: 2, marginBlock: space.s2 },
  hint: { margin: 0 },
  subs: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4 },
  people: { display: "flex", alignItems: "center", gap: space.s3, margin: 0 },
  stack: { display: "flex", flexShrink: 0, paddingLeft: 8 },
  stacked: { marginLeft: -8, borderRadius: radius.pill, borderWidth: 2, borderStyle: "solid", borderColor: color.sheet, display: "inline-flex" },
  subActions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3, margin: 0 },
  more: { marginTop: space.s6, marginBottom: 0 },
})

/** Boosts, comments, subscribers and the ••• link. Goes at the bottom of every item page. */
export const itemFooter = (c: Ctx, r: Recording, project: Project, opts: { comments?: boolean } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const boosts = yield* boostList(c, r.id)
    const comments = opts.comments === false ? [] : yield* sql<Recording & { creator_name: string; creator_avatar: string | null; boosts: string | null }>`
      select r.*, p.name as creator_name, p.avatar_url as creator_avatar,
        (select string_agg(b.content || ' ' || bp.name, ', ' order by b.id) from boosts b join people bp on bp.id = b.person_id where b.recording_id = r.id) as boosts
      from recordings r left join people p on p.id = r.creator_id
      where r.parent_id = ${r.id} and r.type = 'comment' and r.status = 'active' order by r.created_at`
    const subs = yield* peopleByIds(yield* subscriberIds(r.id))
    const subscribed = subs.some((p) => p.id === c.me.id)
    const pool = yield* projectPeople(project)
    const readOnly = r.status !== "active"
    return html`
<section aria-label="Reactions"${sx(fs.boosts)}>
  ${boosts}
  ${readOnly ? "" : html`<form method="post" action="/r/${r.id}/reactions"${sx(fs.boostForm)}><input name="content" maxlength="16" size="16" placeholder="React with an emoji or a few words" aria-label="Reaction" required${sx(fs.boostInput)}> <button${sx(fs.boostButton)}>React</button></form>`}
</section>
${opts.comments === false ? "" : html`
<section aria-label="Comments" id="comments"${sx(fs.section)}>
  <h2${sx(fs.heading)}>Comments</h2>
  ${comments.map((m) => html`
  <article id="comment-${m.id}"${sx(fs.comment)}>
    ${face({ name: m.creator_name ?? "Someone", avatar_url: m.creator_avatar })}
    <div>
      <p${sx(fs.commentHead)}><b>${m.creator_name}</b> <small>${fmtDateTime(m.created_at, c.me.time_zone)}${m.updated_at.getTime() - m.created_at.getTime() > 1000 ? " (edited)" : ""}</small></p>
      <div${sx(fs.commentBody)}>${fmt(m.body)}</div>
      ${m.boosts ? html`<p${sx(fs.commentMeta)}><small>Reactions: ${m.boosts}</small></p>` : ""}
      <p${sx(fs.commentMeta)}>
        <a href="/r/${m.id}/reactions"${sx(fs.quiet)}>React</a>
        ${m.creator_id === c.me.id && !readOnly ? html`<a href="/r/${r.id}/comments/${m.id}/edit"${sx(fs.quiet)}>Edit</a> <a href="/r/${m.id}/trash"${sx(fs.quiet)}>Delete</a>` : ""}
      </p>
    </div>
  </article>`)}
  ${readOnly ? "" : html`
  <form method="post" action="/r/${r.id}/comments"${sx(fs.box)}>
    ${face(c.me)}
    <div>
      <p><textarea name="body" rows="4" cols="70" placeholder="Add a comment here…" aria-label="Add a comment" required${sx(fs.boxField)}></textarea></p>
      <div${sx(fs.hints)}>
        <p${sx(fs.hint)}><small>Mention someone with @: ${pool.filter((p) => p.id !== c.me.id).map((p, i) => html`${i ? ", " : ""}@${p.name.split(" ")[0]}`)}</small></p>
        <p${sx(fs.hint)}><small>Adding this comment will notify ${plural(subs.filter((p) => p.id !== c.me.id).length, "person", "people")}. <a href="/r/${r.id}/subscribers">Who's that?</a></small></p>
      </div>
      <p><button>Add this comment</button> <small>You can also reply to the notification email to comment.</small></p>
    </div>
  </form>`}
</section>`}
<section aria-label="Subscribers"${sx(fs.section)}>
  <h2${sx(fs.heading)}>Subscribers</h2>
  <div${sx(fs.subs)}>
    <p${sx(fs.people)}>
      <span${sx(fs.stack)} aria-hidden="true">${subs.slice(0, 6).map((p) => html`<span${sx(fs.stacked)}>${face(p, 28)}</span>`)}</span>
      <span>${plural(subs.length, "person", "people")} will be notified when someone comments on this: ${subs.map((p, i) => html`${i ? ", " : ""}${personLink(p)}`)}</span>
    </p>
    <div${sx(fs.subActions)}>
      <form method="post" action="/r/${r.id}/${subscribed ? "unsubscribe" : "subscribe"}"><button>${subscribed ? "Unsubscribe me" : "Subscribe me"}</button></form>
      <a href="/r/${r.id}/subscribers"><small>Add/remove people…</small></a>
    </div>
  </div>
  ${subscribed ? "" : html`<p><small>You're not getting notifications about new comments.</small></p>`}
</section>
<p${sx(fs.more)}><a href="/r/${r.id}/menu">••• More options for this ${TYPE_NAMES[r.type] ?? "item"}</a></p>`
  })

const boostList = (c: Ctx, recordingId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const bs = yield* sql<{ id: number; content: string; person_id: number; name: string }>`
      select b.id, b.content, b.person_id, p.name from boosts b join people p on p.id = b.person_id where b.recording_id = ${recordingId} order by b.id`
    if (!bs.length) return html``
    return html`${bs.map((b) => html`<span${sx(fs.boost, b.person_id === c.me.id && fs.boostMine)}>${b.content} <span${sx(fs.boostWho)}>${b.name}</span>${b.person_id === c.me.id
      ? html`<form method="post" action="/reactions/${b.id}/delete" style="display:inline"><button title="Remove your reaction" aria-label="Remove your reaction"${sx(fs.unboost)}>×</button></form>` : ""}</span>`)}`
  })

/** Item page crumbs: Project › Tool. */
const crumbsFor = (project: Project, r: Recording) =>
  project.kind === "ping" ? [["Private chats", "/chats"] as const, [project.name || "Private chat", `/chats/${project.id}`] as const] : projectCrumbs(project, TYPE_TOOL[r.type])

// ---------- move / copy destinations ----------

/** Which parent types a recording can live under. null = top level of the tool. */
const DEST: Record<string, { parentTypes: string[]; topLevel: boolean }> = {
  message: { parentTypes: [], topLevel: true },
  todolist: { parentTypes: [], topLevel: true },
  todo: { parentTypes: ["todolist", "todogroup"], topLevel: false },
  folder: { parentTypes: ["folder"], topLevel: true },
  doc: { parentTypes: ["folder"], topLevel: true },
  upload: { parentTypes: ["folder"], topLevel: true },
  cloudfile: { parentTypes: ["folder"], topLevel: true },
  event: { parentTypes: [], topLevel: true },
  card: { parentTypes: ["column"], topLevel: false },
  question: { parentTypes: [], topLevel: true },
  forward: { parentTypes: [], topLevel: true },
}

const copySubtree = (c: Ctx, src: Recording, projectId: number, parentId: number | null): Effect.Effect<number, unknown, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [n] = yield* sql<Recording>`insert into recordings ${sql.insert({
      account_id: src.account_id, project_id: projectId, parent_id: parentId, type: src.type, title: src.title, body: src.body,
      data: JSON.stringify(src.data), status: "active", visible_to_clients: src.visible_to_clients, creator_id: c.me.id, position: src.position,
    })} returning *`
    yield* sql`insert into versions ${sql.insert({ recording_id: n!.id, title: n!.title, body: n!.body, data: JSON.stringify(n!.data), person_id: c.me.id })}`
    yield* subscribe(n!.id, [c.me.id])
    const kids = yield* sql<Recording>`select * from recordings where parent_id = ${src.id} and status = 'active' and type <> 'comment'`
    for (const k of kids) yield* copySubtree(c, k, projectId, n!.id)
    return n!.id
  })

// ---------- routes ----------
export const routes = [
  /** Go to wherever a recording lives. */
  get("/r/:id/go", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.id)
      if (r.type === "comment") return redirect(`/r/${r.parent_id}/go#comment-${r.id}`)
      return redirect(urlFor(r))
    })),

  get("/r/:id/line", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id, "line")
      return redirect(project.kind === "ping" ? `/chats/${project.id}#line-${r.id}` : `/projects/${project.id}/chat#line-${r.id}`)
    })),

  // Comments
  post("/r/:id/comments", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      const body = str(yield* c.form, "body")
      if (!body) return back(c, urlFor(r), "Your comment was empty, so nothing was posted.")
      const comment = yield* addComment(c, r, project, body)
      return redirect(`${urlFor(r).split("#")[0]}#comment-${comment.id}`)
    })),

  get("/r/:id/comments/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      const { r: m } = yield* findRecording(c, c.params.cid, "comment")
      if (m.creator_id !== c.me.id) return yield* new NotFound()
      return yield* render(c, "Edit comment", html`
<h1>Edit your comment</h1>
<p>On <a href="${urlFor(r)}">${titleOf(r)}</a></p>
<form method="post" action="/r/${r.id}/comments/${m.id}">
  <p><textarea name="body" rows="6" cols="70" required>${m.body}</textarea></p>
  <button>Save changes</button> <a href="${urlFor(r)}#comment-${m.id}">Cancel</a>
</form>`, crumbsFor(project, r))
    })),

  post("/r/:id/comments/:cid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: m } = yield* findRecording(c, c.params.cid, "comment")
      if (m.creator_id !== c.me.id) return yield* new NotFound()
      const body = str(yield* c.form, "body")
      if (!body) return back(c, `/r/${m.id}/go`, "A comment can't be empty. Delete it instead?")
      yield* sql`update recordings set body = ${body}, updated_at = now() where id = ${m.id}`
      yield* sql`insert into versions ${sql.insert({ recording_id: m.id, title: "", body, data: "{}", person_id: c.me.id })}`
      return redirect(`/r/${m.parent_id}/go#comment-${m.id}`, "Saved.")
    })),

  // Boosts
  get("/r/:id/reactions", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      const list = yield* boostList(c, r.id)
      return yield* render(c, "React", html`
<h1>React</h1>
<p>Send a quick reply to <a href="${urlFor(r)}">${titleOf(r)}</a>: an emoji or a few words.</p>
${list || html`<p>No reactions yet.</p>`}
<form method="post" action="/r/${r.id}/reactions">
  <p><label>An emoji or a few words (16 letters or less)<br><input name="content" maxlength="16" required autofocus></label></p>
  <button>React</button>
</form>
<p><a href="/my/reactions">All your reactions, sent and received</a></p>`, crumbsFor(project, r))
    })),

  post("/r/:id/reactions", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      const content = str(yield* c.form, "content")
      if (!content) return back(c, urlFor(r))
      if ([...content].length > 16) return back(c, `/r/${r.id}/reactions`, "Reactions are 16 letters or less. Write a comment for anything longer.")
      yield* sql`insert into boosts ${sql.insert({ recording_id: r.id, person_id: c.me.id, content })}`
      if (r.creator_id) yield* notify(c, { personIds: [r.creator_id], recording: r, kind: "boost", summary: `${c.me.name} reacted to ${titleOf(r)}: ${content}`, email: false })
      return back(c, urlFor(r))
    })),

  post("/reactions/:bid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from boosts where id = ${Number(c.params.bid)} and person_id = ${c.me.id}`
      return back(c, "/")
    })),

  // Subscribers
  get("/r/:id/subscribers", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      const subs = yield* subscriberIds(r.id)
      const pool = yield* projectPeople(project)
      return yield* render(c, "Subscribers", html`
<h1>Who gets notified about new comments?</h1>
<p>On <a href="${urlFor(r)}">${titleOf(r)}</a></p>
<form method="post" action="/r/${r.id}/subscribers">
  ${peopleCheckboxes("person_ids", pool, subs)}
  <button>Save changes</button> <a href="${urlFor(r)}">Cancel</a>
</form>`, crumbsFor(project, r))
    })),

  post("/r/:id/subscribers", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.id)
      const pool = (yield* projectPeople(project)).map((p) => p.id)
      const chosen = ids(yield* c.form, "person_ids").filter((id) => pool.includes(id))
      yield* sql`delete from subscriptions where recording_id = ${r.id}`
      yield* subscribe(r.id, chosen)
      return redirect(urlFor(r), "Subscribers updated.")
    })),

  post("/r/:id/subscribe", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.id)
      yield* subscribe(r.id, [c.me.id])
      return back(c, urlFor(r), "You'll be notified about new comments.")
    })),

  post("/r/:id/unsubscribe", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      yield* sql`delete from subscriptions where recording_id = ${r.id} and person_id = ${c.me.id}`
      return back(c, urlFor(r), "You won't be notified about new comments.")
    })),

  // The ••• menu
  get("/r/:id/menu", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.id)
      const [bm] = yield* sql`select 1 from bookmarks where person_id = ${c.me.id} and recording_id = ${r.id}`
      const hasClients = (yield* projectPeople(project)).some(isClient)
      const movable = !!DEST[r.type]
      const editPath = EDIT_PATHS[r.type]?.(r)
      return yield* render(c, "Options", html`
<h1>${titleOf(r)}</h1>
<p${sx(fs.menuFor)}>Options for this ${TYPE_NAMES[r.type] ?? "item"}</p>
${menu.wrap(
  menu.group("Change",
    editPath && r.status === "active" && menu.link(editPath, "Edit"),
    movable && menu.link(`/r/${r.id}/move?mode=move`, "Move"),
    movable && menu.link(`/r/${r.id}/move?mode=copy`, "Copy"),
    r.type === "message" && menu.post(`/r/${r.id}/pin`, r.data.pinned ? "Unpin from top" : "Pin to top")),
  menu.group("Keep track",
    menu.post(`/r/${r.id}/bookmark`, bm ? "Remove bookmark" : "Bookmark"),
    menu.link(`/r/${r.id}/remind`, "Remind me later…"),
    menu.link(`/r/${r.id}/subscribers`, "Notifications (who's subscribed)"),
    menu.link(`/r/${r.id}/history`, "History")),
  menu.group("Share",
    menu.copy("Copy link", `${c.url.origin}${urlFor(r)}`),
    hasClients && !isClient(c.me) && menu.link(`/r/${r.id}/clients`, r.visible_to_clients ? "Hide from clients" : "Show to clients")),
  menu.group("Archive or trash",
    r.status === "active" && r.type !== "comment" && menu.post(`/r/${r.id}/archive`, "Archive"),
    r.status === "archived" && menu.post(`/r/${r.id}/unarchive`, "Unarchive"),
    r.status !== "trashed" ? menu.link(`/r/${r.id}/trash`, "Put in the trash", true) : menu.post(`/r/${r.id}/restore`, "Put it back")),
)}
<p${sx(kit.links)}><a href="${urlFor(r)}">Back to the ${TYPE_NAMES[r.type] ?? "item"}</a></p>`, crumbsFor(project, r))
    })),

  // Move / copy
  get("/r/:id/move", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.id)
      const d = DEST[r.type]
      if (!d) return yield* new NotFound()
      const mode = c.query.get("mode") === "copy" ? "copy" : "move"
      const targetId = num(c.query.get("project_id"))
      const projects = yield* sql<{ id: number; name: string }>`
        select id, name from projects p where account_id = ${c.me.account_id} and kind = 'project' and status = 'active'
          and (all_access ${isClient(c.me) ? sql`and false` : sql``} or exists (select 1 from project_people pp where pp.project_id = p.id and pp.person_id = ${c.me.id}))
        order by name`
      if (!targetId)
        return yield* render(c, mode === "move" ? "Move" : "Copy", html`
<h1>${mode === "move" ? "Move" : "Copy"} “${titleOf(r)}”</h1>
<form method="get" action="/r/${r.id}/move">
  <input type="hidden" name="mode" value="${mode}">
  <p><label>Pick a project<br><select name="project_id">${projects.map((p) => html`<option value="${p.id}"${p.id === project.id ? raw(" selected") : ""}>${p.name}</option>`)}</select></label></p>
  <button>Next</button> <a href="${urlFor(r)}">Cancel</a>
</form>`, crumbsFor(project, r))
      const target = yield* findProject(c, targetId)
      const parents = d.parentTypes.length
        ? yield* sql<Recording>`select * from recordings where project_id = ${target.id} and type in ${sql.in(d.parentTypes)} and status = 'active' and id <> ${r.id} order by type, position`
        : []
      return yield* render(c, mode === "move" ? "Move" : "Copy", html`
<h1>${mode === "move" ? "Move" : "Copy"} “${titleOf(r)}” to ${target.name}</h1>
<form method="post" action="/r/${r.id}/move">
  <input type="hidden" name="mode" value="${mode}">
  <input type="hidden" name="project_id" value="${target.id}">
  ${d.parentTypes.length ? html`<p><label>Pick a destination<br><select name="parent_id">
    ${d.topLevel ? html`<option value="">Top level</option>` : ""}
    ${parents.map((p) => html`<option value="${p.id}">${TYPE_NAMES[p.type]}: ${titleOf(p)}</option>`)}
  </select></label></p>` : ""}
  ${d.parentTypes.length && !d.topLevel && !parents.length ? html`<p role="alert">${target.name} doesn't have a ${d.parentTypes.map((t) => TYPE_NAMES[t]).join(" or ")} to put this in yet.</p>` : html`<button>${mode === "move" ? "Move it" : "Copy it"}</button>`}
  <a href="/r/${r.id}/move?mode=${mode}">Back</a>
</form>`, crumbsFor(project, r))
    })),

  post("/r/:id/move", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      const d = DEST[r.type]
      if (!d) return yield* new NotFound()
      const fd = yield* c.form
      const target = yield* findProject(c, str(fd, "project_id"))
      const parentId = num(str(fd, "parent_id"))
      if (parentId) {
        const [p] = yield* sql<Recording>`select * from recordings where id = ${parentId} and project_id = ${target.id}`
        if (!p || !d.parentTypes.includes(p.type)) return yield* new NotFound()
      } else if (!d.topLevel) return back(c, urlFor(r), "Pick where to put it.")
      if (str(fd, "mode") === "copy") {
        const id = yield* copySubtree(c, r, target.id, parentId)
        yield* logEvent(c, { project_id: target.id, recording_id: id, action: "copied", summary: `copied ${titleOf(r)} to ${target.name}` })
        const [n] = yield* sql<Recording>`select * from recordings where id = ${id}`
        return redirect(urlFor(n!), { msg: `Copied to ${target.name}.` })
      }
      yield* sql`update recordings set parent_id = ${parentId}, project_id = ${target.id}, updated_at = now() where id = ${r.id}`
      yield* sql`with recursive sub as (select id from recordings where parent_id = ${r.id} union all select x.id from recordings x join sub on x.parent_id = sub.id)
        update recordings set project_id = ${target.id} where id in (select id from sub)`
      yield* logEvent(c, { project_id: target.id, recording_id: r.id, action: "moved", summary: `moved ${titleOf(r)} to ${target.name}` })
      return redirect(urlFor({ ...r, project_id: target.id, parent_id: parentId }), `Moved to ${target.name}.`)
    })),

  // History
  get("/r/:id/history", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.id)
      const vs = yield* sql<{ id: number; title: string; body: string; data: any; name: string | null; created_at: Date }>`
        select v.*, p.name from versions v left join people p on p.id = v.person_id where recording_id = ${r.id} order by v.id desc`
      return yield* render(c, "History", html`
<h1>History of “${titleOf(r)}”</h1>
<p>${plural(vs.length, "version")}, newest first. Text that changed from the version before is marked.</p>
${vs.map((v, i) => {
  const prev = vs[i + 1]
  return html`<article>
  <h2>${i === 0 ? "Current version" : `Version ${vs.length - i}`}</h2>
  <p><small>${v.name ?? "Someone"} · ${fmtDateTime(v.created_at, c.me.time_zone)}</small></p>
  ${v.title ? html`<p><b>${prev && prev.title !== v.title ? html`<mark>${v.title}</mark>` : v.title}</b></p>` : ""}
  ${prev && prev.body !== v.body ? html`<div><mark>Changed:</mark><br>${fmt(v.body)}</div>` : html`<div>${fmt(v.body)}</div>`}
  ${r.type === "upload" && v.data?.path ? html`<p><a href="/uploads/${r.id}/download?version=${encodeURIComponent(v.data.path)}">Download this version (${v.data.filename})</a></p>` : ""}
</article>`
})}
<p><a href="${urlFor(r)}">Back</a></p>`, crumbsFor(project, r))
    })),

  // Bookmark
  post("/r/:id/bookmark", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      const del = yield* sql`delete from bookmarks where person_id = ${c.me.id} and recording_id = ${r.id} returning id`
      if (!del.length) yield* sql`insert into bookmarks ${sql.insert({ person_id: c.me.id, recording_id: r.id })}`
      return back(c, urlFor(r), del.length ? "Bookmark removed." : { msg: "Bookmarked.", href: "/my/bookmarks", label: "See your bookmarks" })
    })),

  // Bubble up
  get("/r/:id/remind", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      return yield* render(c, "Remind me later", html`
<h1>Remind me about “${titleOf(r)}”</h1>
<p>We'll show it in your Updates when you pick.</p>
<form method="post" action="/r/${r.id}/remind">
  <p><label><input type="radio" name="when" value="later_today" checked> Later today (in 4 hours)</label><br>
  <label><input type="radio" name="when" value="tomorrow"> Tomorrow morning</label><br>
  <label><input type="radio" name="when" value="next_week"> Next week</label><br>
  <label><input type="radio" name="when" value="custom"> Pick a date and time:</label> <input type="datetime-local" name="at"></p>
  <button>Remind me</button> <a href="${urlFor(r)}">Cancel</a>
</form>
<p><a href="/my/reminders">Your reminders</a></p>`, crumbsFor(project, r))
    })),

  post("/r/:id/remind", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      const fd = yield* c.form
      const when = str(fd, "when")
      const now = new Date()
      let at: Date
      if (when === "tomorrow") at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9)
      else if (when === "next_week") at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7), 9)
      else if (when === "custom") at = new Date(str(fd, "at"))
      else at = new Date(now.getTime() + 4 * 3600_000)
      if (Number.isNaN(at.getTime()) || at <= now) return back(c, `/r/${r.id}/remind`, "Pick a time in the future.")
      yield* sql`insert into bubble_ups ${sql.insert({ person_id: c.me.id, recording_id: r.id, bubble_at: at })}`
      return redirect(urlFor(r), { msg: `We'll remind you ${fmtDateTime(at, c.me.time_zone)}.`, href: "/my/reminders", label: "See your reminders" })
    })),

  // Trash
  get("/r/:id/trash", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      return yield* render(c, "Trash it?", html`
<h1>Put this in the trash?</h1>
<p>“${titleOf(r)}”${r.type !== "comment" ? " and everything in it" : ""}. You can put it back for 30 days.</p>
<form method="post" action="/r/${r.id}/trash"><button>Yes, put it in the trash</button> <a href="${urlFor(r)}">Never mind</a></form>`, crumbsFor(project, r))
    })),

  post("/r/:id/trash", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.id)
      if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NotFound()
      yield* sql`update recordings set status = 'trashed', trashed_at = now() where id = ${r.id}`
      yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "trashed", summary: `trashed ${titleOf(r)}` })
      const parentUrl = r.parent_id ? `/r/${r.parent_id}/go` : TYPE_TOOL[r.type] ? toolUrl(project, TYPE_TOOL[r.type]!) : `/projects/${project.id}`
      return redirect(parentUrl, { msg: "Moved to the trash.", href: `/r/${r.id}/undo-trash`, label: "Undo" })
    })),

  get("/r/:id/undo-trash", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      yield* sql`update recordings set status = 'active', trashed_at = null where id = ${r.id} and status = 'trashed'`
      return redirect(urlFor(r), "Put back.")
    })),

  post("/r/:id/restore", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      yield* sql`update recordings set status = 'active', trashed_at = null where id = ${r.id}`
      yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "restored", summary: `restored ${titleOf(r)} from the trash` })
      return redirect(urlFor(r), "Put back.")
    })),

  // Archive
  post("/r/:id/archive", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      yield* sql`update recordings set status = 'archived' where id = ${r.id}`
      yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "archived", summary: `archived ${titleOf(r)}` })
      return redirect(urlFor(r), "Archived. It's read-only now.")
    })),

  post("/r/:id/unarchive", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      yield* sql`update recordings set status = 'active' where id = ${r.id}`
      return redirect(urlFor(r), "Unarchived.")
    })),

  // Pin (messages)
  post("/r/:id/pin", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id, "message")
      yield* sql`update recordings set data = data || ${JSON.stringify({ pinned: !r.data.pinned })}::jsonb where id = ${r.id}`
      return redirect(urlFor(r), r.data.pinned ? "Unpinned." : "Pinned to the top of Posts.")
    })),

  // Client visibility
  get("/r/:id/clients", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      if (isClient(c.me)) return yield* new NotFound()
      return yield* render(c, "Client visibility", html`
<h1>${r.visible_to_clients ? "Hide this from clients?" : "Make this visible to clients?"}</h1>
<p>${r.visible_to_clients
  ? "Clients won't see it or any of its comments anymore."
  : "They'll see it and every comment on it."}</p>
<form method="post" action="/r/${r.id}/clients">
  <input type="hidden" name="visible" value="${r.visible_to_clients ? "" : "on"}">
  <button>${r.visible_to_clients ? "Yes, hide it from clients" : "Yes, show it to clients"}</button> <a href="${urlFor(r)}">Never mind</a>
</form>`, crumbsFor(project, r))
    })),

  post("/r/:id/clients", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      if (isClient(c.me)) return yield* new NotFound()
      const visible = bool(yield* c.form, "visible")
      yield* sql`update recordings set visible_to_clients = ${visible} where id = ${r.id}`
      return redirect(urlFor(r), visible ? "Clients can see this now." : "Hidden from clients.")
    })),
]

/** Post a comment on any recording: subscribes the commenter, notifies subscribers and mentions. */
export const addComment = (c: Ctx, r: Recording, project: Project, body: string) =>
  Effect.gen(function* () {
    const subs = yield* subscriberIds(r.id)
    const comment = yield* createRecording(c, {
      project, type: "comment", parent_id: r.id, body, visible_to_clients: true,
      verb: `commented on ${titleOf(r)}`, quiet: true,
    })
    yield* logEvent(c, { project_id: project.id, recording_id: comment.id, action: "commented", summary: `commented on ${titleOf(r)}` })
    yield* subscribe(r.id, [c.me.id])
    yield* notify(c, { personIds: subs, recording: comment, kind: "comment", summary: `${c.me.name} commented on ${titleOf(r)}` })
    return comment
  })


/** Where "Edit" goes for each type. Areas own the edit pages. */
const EDIT_PATHS: Record<string, (r: Recording) => string> = {
  message: (r) => `/projects/${r.project_id}/posts/${r.id}/edit`,
  todolist: (r) => `/projects/${r.project_id}/lists/${r.id}/edit`,
  todo: (r) => `/projects/${r.project_id}/tasks/${r.id}/edit`,
  folder: (r) => `/projects/${r.project_id}/folders/${r.id}/edit`,
  doc: (r) => `/projects/${r.project_id}/docs/${r.id}/edit`,
  cloudfile: (r) => `/projects/${r.project_id}/cloudfiles/${r.id}/edit`,
  event: (r) => `/projects/${r.project_id}/events/${r.id}/edit`,
  question: (r) => `/projects/${r.project_id}/questions/${r.id}/edit`,
  answer: (r) => `/projects/${r.project_id}/answers/${r.id}/edit`,
  card: (r) => `/projects/${r.project_id}/cards/${r.id}/edit`,
  door: (r) => `/projects/${r.project_id}/links/${r.id}/edit`,
  upload: (r) => `/projects/${r.project_id}/uploads/${r.id}/edit`,
}

export type { Raw }
