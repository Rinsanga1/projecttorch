// Message Board: posts and their categories.
// Pages: client/areas/messages.tsx. This file is what their forms post to.
//
//   POST /projects/:id/posts              new post, or save as a draft
//   POST /projects/:id/posts/:mid/edit    edit a post, or edit / publish a draft
//   POST /categories                      add a category       (account-wide)
//   POST /categories/:cid                 rename a category
//   POST /categories/:cid/delete          delete a category

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, invalid, str, isAdmin, isClient, NoAccess } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, createRecording, updateRecording, urlFor, notifyIdsFrom, clientVisibleFrom } from "../lib/core.ts"
import { addComment } from "./items.ts"
import type { Seed } from "../seed.ts"

// ─── Reading forms. Plain functions: FormData in, data out. ────────────────

// Who sees it (clientVisibleFrom) depends on the project's people, so the handlers add that.
const readMessage = (fd: FormData) => ({
  title: str(fd, "title"),
  body:  str(fd, "body"),
  data:  { category_id: Number(str(fd, "category_id")) || null },
})

const readCategory = (fd: FormData) => ({
  emoji: str(fd, "emoji"),
  name:  str(fd, "name"),
})

const NEEDS_TITLE = "Your post needs a title."
const NEEDS_NAME  = "A category needs a name."

// ─── Posts ─────────────────────────────────────────────────────────────────

const newPost = post("/projects/:id/posts", (c) => Effect.gen(function* () {
  const project = yield* findProject(c, c.params.id)
  const fd      = yield* c.form
  const message = readMessage(fd)
  if (!message.title) return invalid([NEEDS_TITLE])

  // Drafts notify nobody.
  const people  = yield* projectPeople(project)
  const isDraft = fd.get("draft") === "1"

  const r = yield* createRecording(c, {
    project,
    type:               "message",
    tool:               str(fd, "tool"),
    ...message,
    visible_to_clients: clientVisibleFrom(fd, people, undefined),
    status:             isDraft ? "drafted" : "active",
    notifyIds:          isDraft ? [] : notifyIdsFrom(fd, people, c.me),
    verb:               "shared a post",
  })

  if (isDraft) return redirect("/my/drafts", "Saved as a draft.")
  return redirect(urlFor(r))
}))

const editPost = post("/projects/:id/posts/:mid/edit", (c) => Effect.gen(function* () {
  const { r, project } = yield* findRecording(c, c.params.mid, "message")
  if (r.creator_id !== c.me.id && !isAdmin(c.me)) return yield* new NoAccess()

  const fd      = yield* c.form
  const message = readMessage(fd)
  if (!message.title) return invalid([NEEDS_TITLE])

  const people   = yield* projectPeople(project)
  const wasDraft = r.status === "drafted"
  const visible  = clientVisibleFrom(fd, people, r.visible_to_clients)
  const updated  = yield* updateRecording(c, r, { ...message, visible_to_clients: visible }, { quiet: wasDraft })   // editing a draft tells nobody

  // Three outcomes: publish a draft, save a draft, save a post.
  if (wasDraft && fd.get("publish") === "1") {
    // Publishing: the draft is deleted and posted fresh, with notifications.
    // One transaction, so a failed post can't lose the draft.
    const sql    = yield* SqlClient.SqlClient
    const posted = yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`delete from recordings where id = ${r.id}`
      return yield* createRecording(c, {
        project,
        type:               "message",
        title:              updated.title,
        body:               updated.body,
        data:               updated.data,
        visible_to_clients: updated.visible_to_clients,
        notifyIds:          notifyIdsFrom(fd, people, c.me),
        verb:               "shared a post",
      })
    }))
    return redirect(urlFor(posted))
  }
  if (wasDraft) return redirect("/my/drafts", "Saved.")
  return redirect(urlFor(updated), "Saved.")
}))

// ─── Categories. Account-wide; clients can't touch them. ───────────────────
// Every query filters on account_id, so you can only ever change your own account's.

const addCategory = post("/categories", (c) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql      = yield* SqlClient.SqlClient
  const category = readCategory(yield* c.form)
  if (!category.name) return redirect("/categories", NEEDS_NAME)

  yield* sql`insert into categories ${sql.insert({ account_id: c.me.account_id, ...category })}`
  return redirect("/categories", "Category added.")
}))

const renameCategory = post("/categories/:cid", (c) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql      = yield* SqlClient.SqlClient
  const category = readCategory(yield* c.form)
  if (!category.name) return redirect("/categories", NEEDS_NAME)

  yield* sql`update categories set emoji = ${category.emoji}, name = ${category.name}
             where id = ${Number(c.params.cid)} and account_id = ${c.me.account_id}`
  return redirect("/categories", "Saved.")
}))

const deleteCategory = post("/categories/:cid/delete", (c) => Effect.gen(function* () {
  if (isClient(c.me)) return yield* new NoAccess()
  const sql = yield* SqlClient.SqlClient

  yield* sql`delete from categories where id = ${Number(c.params.cid)} and account_id = ${c.me.account_id}`
  return redirect("/categories", "Category deleted. Its posts are still here, just without the label.")
}))

export const routes = [
  newPost,
  editPost,
  addCategory,
  renameCategory,
  deleteCategory,
]

// ─── Sample data ───────────────────────────────────────────────────────────

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann, bob, dan } = s.people
  const website = s.projects.website

  const [announcement] = yield* sql<{ id: number }>`select id from categories where account_id = ${s.account.id} and name = 'Announcement'`
  const [idea]         = yield* sql<{ id: number }>`select id from categories where account_id = ${s.account.id} and name = 'Idea'`

  const kickoff = yield* createRecording(s.as(maya), {
    project:            website,
    type:               "message",
    title:              "Kickoff: what we're making and why",
    body:               "We're rebuilding the Northwind site from scratch. Six weeks, fixed.\n\nThe goal: one page that explains what they sell, in plain words. @Ann is on design, @Bob on code.",
    data:               { category_id: announcement!.id, pinned: true },
    visible_to_clients: true,
    notifyIds:          [ann.id, bob.id, dan.id],
    verb:               "shared a post",
  })
  yield* addComment(s.as(ann), kickoff, website, "Love it. First sketches by Friday.")
  yield* addComment(s.as(dan), kickoff, website, "Thanks Maya, excited to see this.")
  yield* sql`insert into boosts ${sql.insert({ recording_id: kickoff.id, person_id: bob.id, content: "🙌" })}`

  yield* createRecording(s.as(bob), {
    project:   website,
    type:      "message",
    title:     "Idea: drop the CMS",
    body:      "Their content changes twice a year. Static pages are faster and cheaper. Thoughts?",
    data:      { category_id: idea!.id },
    notifyIds: [maya.id, ann.id],
    verb:      "shared a post",
  })

  yield* createRecording(s.as(maya), {
    project: website,
    type:    "message",
    title:   "Half-finished thoughts on pricing",
    body:    "Not ready yet…",
    status:  "drafted",
  })
})
