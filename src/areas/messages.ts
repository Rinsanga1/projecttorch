// Message Board: the board, new message, message, edit, categories.
// This is the reference area: other areas follow the same shape.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, excerpt, fmtDate } from "../lib/html.ts"
import { get, post, redirect, render, str, errors, isAdmin, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor, titleOf,
  notifyPicker, notifyIdsFrom, clientSwitch, textField, textArea, commentCount, byLine, clientFilter, trackVisit, personById,
  type Project, type Recording,
} from "../lib/core.ts"
import { itemFooter, statusBanner, clientBanner, addComment } from "./items.ts"
import { face, kit, pageHead, sx } from "../lib/ui.ts"
import type { Seed } from "../seed.ts"

type Category = { id: number; emoji: string; name: string }

const categories = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Category>`select id, emoji, name from categories where account_id = ${c.me.account_id} order by name`
  })

const messageForm = (c: Ctx, p: Project, cats: ReadonlyArray<Category>, people: ReadonlyArray<any>, m: Partial<Recording> & { data?: any }, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${m.id ? `/projects/${p.id}/posts/${m.id}/edit` : `/projects/${p.id}/posts`}">
  <p><label>Pick a category (optional)<br><select name="category_id"><option value="">None</option>
    ${cats.map((k) => html`<option value="${k.id}"${Number(m.data?.category_id) === k.id ? raw(" selected") : ""}>${k.emoji} ${k.name}</option>`)}
  </select></label> <small><a href="/categories">Edit categories</a></small></p>
  ${textField("Title", "title", m.title ?? "", { required: true, placeholder: "Type a title…" })}
  ${textArea("Post", "body", m.body ?? "", "Write away…")}
  ${m.id && m.status !== "drafted" ? "" : notifyPicker(people, c.me)}
  ${clientSwitch(p, people, m.visible_to_clients)}
  <p>
    <button name="publish" value="1">${m.id && m.status !== "drafted" ? "Save changes" : "Share this post"}</button>
    ${m.id && m.status !== "drafted" ? "" : html`<button name="draft" value="1">Save as a draft</button>`}
    <a href="${m.id ? urlFor(m as Recording) : toolUrl(p, "message_board")}">${m.id ? "Cancel" : "Discard"}</a>
  </p>
</form>`

export const routes = [
  get("/projects/:id/posts", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const cats = yield* categories(c)
      const catId = Number(c.query.get("category")) || null
      const msgs = yield* sql<Recording & { creator_name: string | null; creator_avatar: string | null; comments: number }>`
        select r.*, pe.name as creator_name, pe.avatar_url as creator_avatar,
          (select count(*) from recordings x where x.parent_id = r.id and x.type = 'comment' and x.status = 'active')::int as comments
        from recordings r left join people pe on pe.id = r.creator_id
        where r.project_id = ${p.id} and r.type = 'message' and r.status = 'active' ${clientFilter(sql, c.me, "r")}
          ${catId ? sql`and (r.data->>'category_id')::int = ${catId}` : sql``}
        order by (r.data->>'pinned')::boolean is true desc, r.created_at desc`
      const [drafts] = yield* sql<{ n: number }>`select count(*)::int as n from recordings where project_id = ${p.id} and type = 'message' and status = 'drafted' and creator_id = ${c.me.id}`
      const cat = (r: Recording) => cats.find((k) => k.id === Number(r.data.category_id))
      yield* trackVisit(c, toolUrl(p, "message_board"), `${p.name}: Posts`, p.id)
      return yield* render(c, "Posts", html`
${pageHead("Posts", p.status === "active" ? html`<a href="/projects/${p.id}/posts/new" data-button>Write a post</a>` : "")}
<form method="get"${sx(kit.toolbar)}><label>Category <select name="category"${sx(kit.toolbarControl)}><option value="">All posts</option>
  ${cats.map((k) => html`<option value="${k.id}"${k.id === catId ? raw(" selected") : ""}>${k.emoji} ${k.name}</option>`)}</select></label> <button${sx(kit.toolbarControl)}>Filter</button></form>
${msgs.length === 0
  ? html`<p${sx(kit.empty)}>${catId ? "No posts in this category." : "Share news, ideas, and updates with the team. Start with “Write a post”."}</p>`
  : html`<ul${sx(kit.rows)}>${msgs.map((m) => html`<li${sx(kit.row)}>
    ${face({ name: m.creator_name ?? "Someone", avatar_url: m.creator_avatar })}
    <div>
      ${m.data.pinned || cat(m) ? html`<p${sx(kit.tags)}>${m.data.pinned ? html`<span${sx(kit.tag, kit.tagAccent)}>Pinned</span>` : ""}${cat(m) ? html`<span${sx(kit.tag)}>${cat(m)!.emoji} ${cat(m)!.name}</span>` : ""}</p>` : ""}
      <a href="${urlFor(m)}"${sx(kit.rowTitle)}>${m.title}</a>
      <span${sx(kit.rowMeta)}>${m.creator_name ?? "Someone"} · ${fmtDate(m.created_at, c.me.time_zone)}${m.comments ? ` · ${m.comments} comment${m.comments === 1 ? "" : "s"}` : ""}</span>
      <p${sx(kit.rowText)}>${excerpt(m.body)}</p>
    </div></li>`)}</ul>`}
<p${sx(kit.links)}>${drafts!.n ? html`<a href="/my/drafts">Your drafts (${drafts!.n})</a>` : ""}<a href="/categories">Edit categories</a><a href="/projects/${p.id}/trash">Archived posts</a></p>`, projectCrumbs(p))
    })),

  get("/projects/:id/posts/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const people = yield* projectPeople(p)
      return yield* render(c, "Write a post", html`<h1>Write a post</h1>${messageForm(c, p, yield* categories(c), people, {}, [])}`, projectCrumbs(p, "message_board"))
    })),

  post("/projects/:id/posts", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const draft = fd.get("draft") === "1"
      const m = { title: str(fd, "title"), body: str(fd, "body"), data: { category_id: Number(str(fd, "category_id")) || null }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!m.title)
        return yield* render(c, "Write a post", html`<h1>Write a post</h1>${messageForm(c, p, yield* categories(c), people, m, ["Your post needs a title."])}`, projectCrumbs(p, "message_board"), 422)
      const r = yield* createRecording(c, {
        project: p, type: "message", ...m, status: draft ? "drafted" : "active",
        notifyIds: draft ? [] : notifyIdsFrom(fd, people, c.me), verb: "shared a post",
      })
      return redirect(draft ? "/my/drafts" : urlFor(r), draft ? "Saved as a draft." : undefined)
    })),

  get("/projects/:id/posts/:mid", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.mid, "message")
      if (r.status === "drafted") return redirect(`/projects/${project.id}/posts/${r.id}/edit`)
      const cats = yield* categories(c)
      const cat = cats.find((k) => k.id === Number(r.data.category_id))
      const people = yield* projectPeople(project)
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      yield* trackVisit(c, urlFor(r), r.title, project.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  ${cat || r.data.pinned ? html`<p${sx(kit.tags)}>${r.data.pinned ? html`<span${sx(kit.tag, kit.tagAccent)}>Pinned to the top</span>` : ""}${cat ? html`<span${sx(kit.tag)}>${cat.emoji} ${cat.name}</span>` : ""}</p>` : ""}
  <h1>${r.title}</h1>
  ${byLine(author, r.created_at, c.me.time_zone)}
  <div${sx(kit.prose)}>${fmt(r.body)}</div>
</article>
${yield* itemFooter(c, r, project)}`, projectCrumbs(project, "message_board"))
    })),

  get("/projects/:id/posts/:mid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.mid, "message")
      if (r.creator_id !== c.me.id && !isAdmin(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      return yield* render(c, r.status === "drafted" ? "Finish your draft" : "Edit post",
        html`<h1>${r.status === "drafted" ? "Finish your draft" : "Edit post"}</h1>${messageForm(c, project, yield* categories(c), people, r, [])}`, projectCrumbs(project, "message_board"))
    })),

  post("/projects/:id/posts/:mid/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project } = yield* findRecording(c, c.params.mid, "message")
      if (r.creator_id !== c.me.id && !isAdmin(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(project)
      const ch = { title: str(fd, "title"), body: str(fd, "body"), data: { category_id: Number(str(fd, "category_id")) || null }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!ch.title)
        return yield* render(c, "Edit post", html`<h1>Edit post</h1>${messageForm(c, project, yield* categories(c), people, { ...r, ...ch, data: { ...r.data, ...ch.data } }, ["Your post needs a title."])}`, projectCrumbs(project, "message_board"), 422)
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
  get("/categories", (c) =>
    Effect.gen(function* () {
      const cats = yield* categories(c)
      return yield* render(c, "Post categories", html`
<h1>Post categories</h1>
<p>Labels with an emoji. You don't have to use them. If you delete one, its posts stay. They just lose the label.</p>
${cats.length ? html`<ul>${cats.map((k) => html`<li>
  <form method="post" action="/categories/${k.id}" style="display:inline">
    <input name="emoji" value="${k.emoji}" size="3" aria-label="Emoji"> <input name="name" value="${k.name}" aria-label="Name"> <button>Save</button>
  </form>
  ${!isClient(c.me) ? html`<form method="post" action="/categories/${k.id}/delete" style="display:inline"><button>Delete</button></form>` : ""}</li>`)}</ul>` : html`<p>No categories yet.</p>`}
${!isClient(c.me) ? html`<h2>Add a category</h2>
<form method="post" action="/categories"><input name="emoji" size="3" placeholder="🙂" aria-label="Emoji"> <input name="name" required placeholder="Name" aria-label="Name"> <button>Add a category</button></form>` : ""}`)
    })),

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
