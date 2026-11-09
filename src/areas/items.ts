// "Every item works the same": comments, boosts, subscribers, move/copy, history, bookmarks, bubble ups, trash,
// archive and client visibility, for any recording.
// Pages: client/areas/items.tsx. This file is what their forms post to.
//
//   POST /r/:id/comments              comment             POST /r/:id/comments/:cid   edit your comment
//   POST /r/:id/reactions             boost (≤16 letters) POST /reactions/:bid/delete
//   POST /r/:id/subscribers           set who's subscribed
//   POST /r/:id/subscribe | unsubscribe
//   POST /r/:id/move                  move or copy (mode=copy) to a project / parent
//   GET  /r/:id/history               its versions (not synced, so the page asks)
//   POST /r/:id/bookmark              bookmark / unbookmark
//   POST /r/:id/remind                bubble up later
//   POST /r/:id/trash | undo-trash | restore
//   POST /r/:id/archive | unarchive
//   POST /r/:id/pin                   posts only
//   POST /r/:id/clients               show to / hide from clients

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { fmtDateTime } from "../shared/format.ts"
import { get, post, redirect, back, json, str, ids, bool, num, isClient, NotFound, type Ctx } from "../lib/web.ts"
import {
  findRecording, findProject, projectPeople, urlFor, titleOf, TYPE_TOOL, toolUrl,
  subscribe, subscriberIds, notify, createRecording, logEvent,
  type Recording, type Project,
} from "../lib/core.ts"
import { dayIn, zonedToUtc } from "./hey.ts"

const HOUR = 3600_000

// ─── Comments (used by other areas too) ────────────────────────────────────

/** Post a comment on any recording: subscribes the commenter, notifies subscribers and mentions. */
export const addComment = (c: Ctx, r: Recording, project: Project, body: string) => Effect.gen(function* () {
  const subscribers = yield* subscriberIds(r.id)
  const comment = yield* createRecording(c, {
    project,
    type:               "comment",
    parent_id:          r.id,
    body,
    visible_to_clients: true,
    verb:               `commented on ${titleOf(r)}`,
    quiet:              true,
  })
  yield* logEvent(c, { project_id: project.id, recording_id: comment.id, action: "commented", summary: `commented on ${titleOf(r)}` })
  yield* subscribe(r.id, [c.me.id])
  yield* notify(c, { personIds: subscribers, recording: comment, kind: "comment", summary: `${c.me.name} commented on ${titleOf(r)}` })
  return comment
})

const postComment = post("/r/:id/comments", (c) => Effect.gen(function* () {
  const { r, project } = yield* findRecording(c, c.params.id)
  const body = str(yield* c.form, "body")
  if (!body) return back(c, urlFor(r), "Your comment was empty, so nothing was posted.")

  const comment = yield* addComment(c, r, project, body)
  return redirect(`${urlFor(r).split("#")[0]}#comment-${comment.id}`)
}))

// Only your own comments.
const editComment = post("/r/:id/comments/:cid", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { r: comment } = yield* findRecording(c, c.params.cid, "comment")
  if (comment.creator_id !== c.me.id) return yield* new NotFound()

  const body = str(yield* c.form, "body")
  if (!body) return back(c, `/r/${comment.id}/go`, "A comment can't be empty. Delete it instead?")

  yield* sql`update recordings set body = ${body}, updated_at = now() where id = ${comment.id}`
  yield* sql`insert into versions ${sql.insert({ recording_id: comment.id, title: "", body, data: "{}", person_id: c.me.id })}`
  return redirect(`/r/${comment.parent_id}/go#comment-${comment.id}`, "Saved.")
}))

// ─── Boosts ────────────────────────────────────────────────────────────────

const boost = post("/r/:id/reactions", (c) => Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const { r }   = yield* findRecording(c, c.params.id)
  const content = str(yield* c.form, "content")
  if (!content)                return back(c, urlFor(r))
  if ([...content].length > 16) return back(c, `/r/${r.id}/reactions`, "Reactions are 16 letters or less. Write a comment for anything longer.")

  yield* sql`insert into boosts ${sql.insert({ recording_id: r.id, person_id: c.me.id, content })}`
  if (r.creator_id) yield* notify(c, { personIds: [r.creator_id], recording: r, kind: "boost", summary: `${c.me.name} reacted to ${titleOf(r)}: ${content}`, email: false })
  return back(c, urlFor(r))
}))

const deleteBoost = post("/reactions/:bid/delete", (c) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`delete from boosts where id = ${Number(c.params.bid)} and person_id = ${c.me.id}`
  return back(c, "/")
}))

// ─── Subscribers ───────────────────────────────────────────────────────────

// The form lists everyone who should be subscribed; only people on the project count.
const setSubscribers = post("/r/:id/subscribers", (c) => Effect.gen(function* () {
  const sql            = yield* SqlClient.SqlClient
  const { r, project } = yield* findRecording(c, c.params.id)
  const pool           = (yield* projectPeople(project)).map((p) => p.id)
  const chosen         = ids(yield* c.form, "person_ids").filter((id) => pool.includes(id))

  yield* sql.withTransaction(Effect.gen(function* () {
    yield* sql`delete from subscriptions where recording_id = ${r.id}`
    yield* subscribe(r.id, chosen)
  }))
  return redirect(urlFor(r), "Subscribers updated.")
}))

const subscribeMe = post("/r/:id/subscribe", (c) => Effect.gen(function* () {
  const { r } = yield* findRecording(c, c.params.id)
  yield* subscribe(r.id, [c.me.id])
  return back(c, urlFor(r), "You'll be notified about new comments.")
}))

const unsubscribeMe = post("/r/:id/unsubscribe", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  yield* sql`delete from subscriptions where recording_id = ${r.id} and person_id = ${c.me.id}`
  return back(c, urlFor(r), "You won't be notified about new comments.")
}))

// ─── Move / copy ───────────────────────────────────────────────────────────

/** Which parent types a recording can live under. Mirrored in client/areas/items.tsx. */
const DEST: Record<string, { parentTypes: string[]; topLevel: boolean }> = {
  message:   { parentTypes: [],         topLevel: true },
  todo:      { parentTypes: ["todo"],   topLevel: true },
  folder:    { parentTypes: ["folder"], topLevel: true },
  doc:       { parentTypes: ["folder"], topLevel: true },
  upload:    { parentTypes: ["folder"], topLevel: true },
  cloudfile: { parentTypes: ["folder"], topLevel: true },
  event:     { parentTypes: [],         topLevel: true },
  card:      { parentTypes: ["column"], topLevel: false },
}

/** Copy a recording and everything under it (not comments). Returns the new top recording's id. */
const copySubtree = (c: Ctx, src: Recording, projectId: number, parentId: number | null): Effect.Effect<number, unknown, SqlClient.SqlClient> => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [copy] = yield* sql<Recording>`insert into recordings ${sql.insert({
    account_id:         src.account_id,
    project_id:         projectId,
    parent_id:          parentId,
    type:               src.type,
    title:              src.title,
    body:               src.body,
    data:               JSON.stringify(src.data),
    status:             "active",
    visible_to_clients: src.visible_to_clients,
    creator_id:         c.me.id,
    position:           src.position,
  })} returning *`
  yield* sql`insert into versions ${sql.insert({ recording_id: copy!.id, title: copy!.title, body: copy!.body, data: JSON.stringify(copy!.data), person_id: c.me.id })}`
  yield* subscribe(copy!.id, [c.me.id])

  const children = yield* sql<Recording>`select * from recordings where parent_id = ${src.id} and status = 'active' and type <> 'comment'`
  for (const child of children) yield* copySubtree(c, child, projectId, copy!.id)
  return copy!.id
})

/** Is `id` this recording or somewhere under it? */
const isInside = (r: Recording, id: number) => Effect.gen(function* () {
  if (id === r.id) return true
  const sql = yield* SqlClient.SqlClient
  const [hit] = yield* sql`with recursive sub as (select id from recordings where parent_id = ${r.id}
                                                  union all select x.id from recordings x join sub on x.parent_id = sub.id)
                           select 1 from sub where id = ${id}`
  return !!hit
})

const moveOrCopy = post("/r/:id/move", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  const dest  = DEST[r.type]
  if (!dest) return yield* new NotFound()

  const fd       = yield* c.form
  const target   = yield* findProject(c, str(fd, "project_id"))
  const parentId = num(str(fd, "parent_id"))

  if (parentId) {
    const [parent] = yield* sql<Recording>`select * from recordings where id = ${parentId} and project_id = ${target.id}`
    if (!parent || !dest.parentTypes.includes(parent.type)) return yield* new NotFound()
    // A folder can't go inside itself: a move would make a loop, a copy would copy itself forever.
    if (yield* isInside(r, parentId)) return back(c, urlFor(r), "It can't go inside itself. Pick somewhere else.")
  } else if (!dest.topLevel) {
    return back(c, urlFor(r), "Pick where to put it.")
  }

  if (str(fd, "mode") === "copy") {
    // One transaction: a copy that fails halfway leaves nothing behind.
    const id = yield* sql.withTransaction(copySubtree(c, r, target.id, parentId))
    yield* logEvent(c, { project_id: target.id, recording_id: id, action: "copied", summary: `copied ${titleOf(r)} to ${target.name}` })
    const [copy] = yield* sql<Recording>`select * from recordings where id = ${id}`
    return redirect(urlFor(copy!), { msg: `Copied to ${target.name}.` })
  }

  // Move it, and everything under it follows to the new project.
  yield* sql.withTransaction(Effect.gen(function* () {
    yield* sql`update recordings set parent_id = ${parentId}, project_id = ${target.id}, updated_at = now() where id = ${r.id}`
    yield* sql`with recursive sub as (select id from recordings where parent_id = ${r.id}
                                      union all select x.id from recordings x join sub on x.parent_id = sub.id)
               update recordings set project_id = ${target.id} where id in (select id from sub)`
  }))
  yield* logEvent(c, { project_id: target.id, recording_id: r.id, action: "moved", summary: `moved ${titleOf(r)} to ${target.name}` })
  return redirect(urlFor({ ...r, project_id: target.id, parent_id: parentId }), `Moved to ${target.name}.`)
}))

// ─── History, bookmark, reminder ───────────────────────────────────────────

const history = get("/r/:id/history", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  return json(yield* sql<{ id: number; title: string; body: string; data: any; name: string | null; created_at: Date }>`
    select v.*, p.name from versions v left join people p on p.id = v.person_id where recording_id = ${r.id} order by v.id desc`)
}))

const toggleBookmark = post("/r/:id/bookmark", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)

  const removed = yield* sql`delete from bookmarks where person_id = ${c.me.id} and recording_id = ${r.id} returning id`
  if (removed.length) return back(c, urlFor(r), "Bookmark removed.")

  yield* sql`insert into bookmarks ${sql.insert({ person_id: c.me.id, recording_id: r.id })}`
  return back(c, urlFor(r), { msg: "Bookmarked.", href: "/my/bookmarks", label: "See your bookmarks" })
}))

/** The reminder form's choice → when, in the person's own time zone. In 4 hours unless it says otherwise. */
const remindAt = (fd: FormData, tz: string): Date => {
  switch (str(fd, "when")) {
    case "tomorrow":  return zonedToUtc(`${dayIn(tz, 1)}T09:00`, tz)
    case "next_week": {
      // Next Monday, 9am. On a Monday, that's a week away.
      const weekday = new Date(`${dayIn(tz)}T00:00Z`).getUTCDay()
      return zonedToUtc(`${dayIn(tz, (8 - weekday) % 7 || 7)}T09:00`, tz)
    }
    case "custom":    return zonedToUtc(str(fd, "at"), tz)
    default:          return new Date(Date.now() + 4 * HOUR)
  }
}

const remind = post("/r/:id/remind", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  const at    = remindAt(yield* c.form, c.me.time_zone)
  if (Number.isNaN(at.getTime()) || at <= new Date()) return back(c, `/r/${r.id}/remind`, "Pick a time in the future.")

  yield* sql`insert into bubble_ups ${sql.insert({ person_id: c.me.id, recording_id: r.id, bubble_at: at })}`
  return redirect(urlFor(r), { msg: `We'll remind you ${fmtDateTime(at, c.me.time_zone)}.`, href: "/my/reminders", label: "See your reminders" })
}))

// ─── Trash and archive ─────────────────────────────────────────────────────

// Clients can only trash their own things.
const trash = post("/r/:id/trash", (c) => Effect.gen(function* () {
  const sql            = yield* SqlClient.SqlClient
  const { r, project } = yield* findRecording(c, c.params.id)
  if (r.creator_id !== c.me.id && isClient(c.me)) return yield* new NotFound()

  yield* sql`update recordings set status = 'trashed', trashed_at = now() where id = ${r.id}`
  yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "trashed", summary: `trashed ${titleOf(r)}` })

  // Back to where it lived: its parent, its window, or the project.
  const tool = TYPE_TOOL[r.type]
  let returnTo = `/projects/${project.id}`
  if (tool)        returnTo = toolUrl(project, tool)
  if (r.parent_id) returnTo = `/r/${r.parent_id}/go`
  return redirect(returnTo, { msg: "Moved to the trash.", href: `/r/${r.id}/undo-trash`, label: "Undo" })
}))

const undoTrash = post("/r/:id/undo-trash", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  yield* sql`update recordings set status = 'active', trashed_at = null where id = ${r.id} and status = 'trashed'`
  return redirect(urlFor(r), "Put back.")
}))

const restore = post("/r/:id/restore", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  yield* sql`update recordings set status = 'active', trashed_at = null where id = ${r.id}`
  yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "restored", summary: `restored ${titleOf(r)} from the trash` })
  return redirect(urlFor(r), "Put back.")
}))

const archive = post("/r/:id/archive", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  yield* sql`update recordings set status = 'archived' where id = ${r.id}`
  yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "archived", summary: `archived ${titleOf(r)}` })
  return redirect(urlFor(r), "Archived. It's read-only now.")
}))

const unarchive = post("/r/:id/unarchive", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  yield* sql`update recordings set status = 'active' where id = ${r.id}`
  return redirect(urlFor(r), "Unarchived.")
}))

// ─── Pin and client visibility ─────────────────────────────────────────────

const togglePin = post("/r/:id/pin", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id, "message")
  yield* sql`update recordings set data = data || ${JSON.stringify({ pinned: !r.data.pinned })}::jsonb where id = ${r.id}`
  if (r.data.pinned) return redirect(urlFor(r), "Unpinned.")
  return redirect(urlFor(r), "Pinned to the top of Posts.")
}))

const setClientVisibility = post("/r/:id/clients", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id)
  if (isClient(c.me)) return yield* new NotFound()

  const visible = bool(yield* c.form, "visible")
  yield* sql`update recordings set visible_to_clients = ${visible} where id = ${r.id}`
  if (visible) return redirect(urlFor(r), "Clients can see this now.")
  return redirect(urlFor(r), "Hidden from clients.")
}))

export const routes = [
  postComment,
  editComment,
  boost,
  deleteBoost,
  setSubscribers,
  subscribeMe,
  unsubscribeMe,
  moveOrCopy,
  history,
  toggleBookmark,
  remind,
  trash,
  undoTrash,
  restore,
  archive,
  unarchive,
  togglePin,
  setClientVisibility,
]
