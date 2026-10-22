// "Every item works the same": comments, boosts, subscribers, move/copy, history, bookmarks, bubble ups, trash,
// archive and client visibility, for any recording. The pages are client/areas/items.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { fmtDateTime } from "../shared/format.ts"
import { get, post, redirect, back, json, str, ids, bool, num, isClient, NotFound, type Ctx } from "../lib/web.ts"
import {
  findRecording, findProject, projectPeople, urlFor, titleOf, TYPE_TOOL, toolUrl,
  subscribe, subscriberIds, notify, createRecording, logEvent,
  type Recording, type Project,
} from "../lib/core.ts"

// ---------- move / copy destinations ----------

/** Which parent types a recording can live under. Mirrored in client/areas/items.tsx. */
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
  // Comments
  post("/r/:id/comments", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.id)
      const body = str(yield* c.form, "body")
      if (!body) return back(c, urlFor(r), "Your comment was empty, so nothing was posted.")
      const comment = yield* addComment(c, r, project, body)
      return redirect(`${urlFor(r).split("#")[0]}#comment-${comment.id}`)
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

  // Move / copy
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

  // History: versions aren't in the browser's copy, so the page asks for them.
  get("/r/:id/history", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id)
      return json(yield* sql<{ id: number; title: string; body: string; data: any; name: string | null; created_at: Date }>`
        select v.*, p.name from versions v left join people p on p.id = v.person_id where recording_id = ${r.id} order by v.id desc`)
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

  post("/r/:id/undo-trash", (c) =>
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

  // Pin (posts)
  post("/r/:id/pin", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id, "message")
      yield* sql`update recordings set data = data || ${JSON.stringify({ pinned: !r.data.pinned })}::jsonb where id = ${r.id}`
      return redirect(urlFor(r), r.data.pinned ? "Unpinned." : "Pinned to the top of Posts.")
    })),

  // Client visibility
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
