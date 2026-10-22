// Message Board: the board, new message, message, edit, categories.
// The pages are client/areas/messages.tsx; these are their posts.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, invalid, str, isAdmin, isClient, NoAccess } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, createRecording, updateRecording, urlFor, notifyIdsFrom } from "../lib/core.ts"
import { addComment } from "./items.ts"
import type { Seed } from "../seed.ts"

const readMessage = (fd: FormData) => ({
  title: str(fd, "title"), body: str(fd, "body"), data: { category_id: Number(str(fd, "category_id")) || null }, visible_to_clients: fd.get("visible_to_clients") === "on",
})

export const routes = [
  post("/projects/:id/posts", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const draft = fd.get("draft") === "1"
      const m = readMessage(fd)
      if (!m.title) return invalid(["Your post needs a title."])
      const r = yield* createRecording(c, {
        project: p, type: "message", ...m, status: draft ? "drafted" : "active",
        notifyIds: draft ? [] : notifyIdsFrom(fd, people, c.me), verb: "shared a post",
      })
      return redirect(draft ? "/my/drafts" : urlFor(r), draft ? "Saved as a draft." : undefined)
    })),

  post("/projects/:id/posts/:mid/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.mid, "message")
      if (r.creator_id !== c.me.id && !isAdmin(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(project)
      const ch = readMessage(fd)
      if (!ch.title) return invalid(["Your post needs a title."])
      const u = yield* updateRecording(c, r, ch, { quiet: r.status === "drafted" })
      if (r.status === "drafted" && fd.get("publish") === "1") {
        // Publishing a draft: it becomes a fresh post with notifications.
        yield* sql`delete from recordings where id = ${r.id}`
        const posted = yield* createRecording(c, { project, type: "message", title: u.title, body: u.body, data: u.data, visible_to_clients: u.visible_to_clients, notifyIds: notifyIdsFrom(fd, people, c.me), verb: "shared a post" })
        return redirect(urlFor(posted))
      }
      return redirect(r.status === "drafted" ? "/my/drafts" : urlFor(u), "Saved.")
    })),

  // Categories (account-wide)
  post("/categories", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      if (!str(fd, "name")) return redirect("/categories", "A category needs a name.")
      yield* sql`insert into categories ${sql.insert({ account_id: c.me.account_id, emoji: str(fd, "emoji"), name: str(fd, "name") })}`
      return redirect("/categories", "Category added.")
    })),

  post("/categories/:cid", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      if (!str(fd, "name")) return redirect("/categories", "A category needs a name.")
      yield* sql`update categories set emoji = ${str(fd, "emoji")}, name = ${str(fd, "name")} where id = ${Number(c.params.cid)} and account_id = ${c.me.account_id}`
      return redirect("/categories", "Saved.")
    })),

  post("/categories/:cid/delete", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from categories where id = ${Number(c.params.cid)} and account_id = ${c.me.account_id}`
      return redirect("/categories", "Category deleted. Its posts are still here, just without the label.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [announce] = yield* sql<{ id: number }>`select id from categories where account_id = ${s.account.id} and name = 'Announcement'`
    const [pitch] = yield* sql<{ id: number }>`select id from categories where account_id = ${s.account.id} and name = 'Idea'`
    const { maya, ann, bob, dan } = s.people
    const kickoff = yield* createRecording(s.as(maya), {
      project: s.projects.website, type: "message", title: "Kickoff: what we're making and why",
      body: "We're rebuilding the Northwind site from scratch. Six weeks, fixed.\n\nThe goal: one page that explains what they sell, in plain words. @Ann is on design, @Bob on code.",
      data: { category_id: announce!.id, pinned: true }, visible_to_clients: true, notifyIds: [ann.id, bob.id, dan.id], verb: "shared a post",
    })
    yield* addComment(s.as(ann), kickoff, s.projects.website, "Love it. First sketches by Friday.")
    yield* addComment(s.as(dan), kickoff, s.projects.website, "Thanks Maya, excited to see this.")
    yield* sql`insert into boosts ${sql.insert({ recording_id: kickoff.id, person_id: bob.id, content: "🙌" })}`
    yield* createRecording(s.as(bob), {
      project: s.projects.website, type: "message", title: "Idea: drop the CMS",
      body: "Their content changes twice a year. Static pages are faster and cheaper. Thoughts?",
      data: { category_id: pitch!.id }, notifyIds: [maya.id, ann.id], verb: "shared a post",
    })
    yield* createRecording(s.as(maya), {
      project: s.projects.hq, type: "message", title: "Office closed Monday",
      body: "It's a holiday. See you all on Tuesday.", data: { category_id: announce!.id }, notifyIds: [ann.id, bob.id, s.people.cara.id],
    })
    yield* createRecording(s.as(maya), { project: s.projects.website, type: "message", title: "Half-finished thoughts on pricing", body: "Not ready yet…", status: "drafted" })
  })
