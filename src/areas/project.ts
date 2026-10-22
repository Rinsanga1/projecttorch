// The project: project home, edit, ••• menu, change tools, people, activity, archived & trashed items, gauge, webhooks.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDate, fmtDateTime, excerpt, plural, isoDate } from "../lib/html.ts"
import { get, post, redirect, render, str, ids, bool, errors, isAdmin, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import {
  findProject, projectPeople, accountPeople, projectUrl, toolUrl, toolName, defaultTools, peopleCheckboxes, logEvent, trackVisit,
  urlFor, titleOf, TYPE_NAMES, clientFilter, canCreateProjects, personLink,
  type Project, type Recording, type Tool, type ToolType,
} from "../lib/core.ts"
import { face, kit, menu, sx } from "../lib/ui.ts"
import { color, font, media, motion, radius, space, text } from "../lib/tokens.stylex.ts"
import { copyProject } from "./home.ts"

// The pages off the project menu: activity and gauge updates as rows led by a face, trashed and archived items as
// rows with their action at the end, a tile around the forms that add something (a webhook, a gauge update).
const pm = stylex.create({
  row: { display: "grid", gridTemplateColumns: "24px 1fr auto", columnGap: space.s3, alignItems: "start", paddingBlock: 10 },
  time: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  intro: { color: color.muted },
  item: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, justifyContent: "space-between" },
  itemTitle: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: 2, minWidth: 0 },
  tile: { marginTop: space.s6, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  tileTitle: { marginTop: 0 },
  needle: { display: "flex", alignItems: "center", gap: space.s4, marginBottom: space.s5, maxWidth: "none" },
  needleNum: { fontSize: text.xxl, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  meter: { width: "min(100%, 320px)", height: 10 },
  range: { width: "min(100%, 320px)", verticalAlign: "middle" },
  url: { fontFamily: font.mono, fontSize: text.sm, overflowWrap: "anywhere" },
  events: { display: "flex", flexWrap: "wrap", rowGap: space.s2 },
})

const PITCH: Record<ToolType, string> = {
  message_board: "Share news and ideas with the team. Talk them over in one place.",
  todos: "Make lists of work. Give each task to someone and set a due date.",
  vault: "Keep docs, files, and images here. Sort them into folders.",
  campfire: "Chat with the team about anything.",
  schedule: "Add events and dates. Tasks and cards with due dates show up here too.",
  checkins: "Ask the team the same question each day or week, like “What did you get done today?”",
  cardtable: "Move cards from column to column as work gets done. Add your first card to New, or set up columns first.",
  forwards: "Forward emails here so everyone can read them and talk.",
  timesheet: "Log time on any task and it adds up here.",
}

// Project home: the title over a row of facts, then each tool as a tile, kargul's card grid on the white sheet.
const ps = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: space.s4, marginBottom: space.s5 },
  title: { fontSize: { default: text.xxl, "@media (min-width: 768px)": "2.5rem" }, marginBottom: space.s2 },
  lede: { fontSize: text.md, color: color.muted, marginBottom: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, flexShrink: 0 },
  facts: {
    display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s5, rowGap: space.s2, maxWidth: "none",
    paddingBlock: space.s3, marginBottom: space.s6, borderBlockWidth: 1, borderBlockStyle: "solid", borderBlockColor: color.line,
    fontSize: text.sm, color: color.muted,
  },
  fact: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  factInk: { color: color.ink },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s4, marginBottom: space.s6 },
  tile: {
    position: "relative", backgroundColor: color.tile, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s5, minHeight: 196,
    display: "flex", flexDirection: "column", gap: space.s3, transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  // A tool tile is one big link to the tool (its title link covers the tile); preview links sit above it.
  linked: { backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } } },
  tileLink: { "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" } },
  above: { position: "relative", zIndex: 1 },
  tileTitle: { margin: 0, fontSize: text.md, letterSpacing: "-0.02em" },
  tileBody: { margin: 0, fontSize: text.sm, color: color.muted },
  tileText: { margin: 0, fontSize: text.sm },
  list: { margin: 0, fontSize: text.sm },
  item: { borderTopWidth: 0, paddingBlock: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemLink: { position: "relative", zIndex: 1, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  more: { display: "flex", flexWrap: "wrap", columnGap: space.s5, rowGap: space.s2, maxWidth: "none", fontSize: text.sm, marginBottom: 0 },
})

/** A few lines of live preview for each tool card on the project page. */
const preview = (c: Ctx, p: Project, t: ToolType) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const cf = clientFilter(sql, c.me, "r")
    const items = (rows: ReadonlyArray<Recording>, label: (r: Recording) => unknown = (r) => titleOf(r)) =>
      rows.length ? html`<ul${sx(ps.list)}>${rows.map((r) => html`<li${sx(ps.item)}><a href="${urlFor(r)}"${sx(ps.itemLink)}>${label(r)}</a></li>`)}</ul>` : null
    switch (t) {
      case "message_board":
        return items(yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'message' and status = 'active' ${cf} order by (data->>'pinned')::boolean is true desc, created_at desc limit 3`)
      case "todos": {
        const lists = yield* sql<Recording & { done: number; total: number }>`
          select r.*, (select count(*) filter (where t.data->>'completed_at' is not null) from recordings t where t.type = 'todo' and t.status = 'active' and (t.parent_id = r.id or t.parent_id in (select g.id from recordings g where g.parent_id = r.id and g.type = 'todogroup')))::int as done,
            (select count(*) from recordings t where t.type = 'todo' and t.status = 'active' and (t.parent_id = r.id or t.parent_id in (select g.id from recordings g where g.parent_id = r.id and g.type = 'todogroup')))::int as total
          from recordings r where project_id = ${p.id} and type = 'todolist' and status = 'active' ${cf} order by position limit 4`
        return items(lists, (r) => `${r.title} (${(r as any).done}/${(r as any).total} completed)`)
      }
      case "vault":
        return items(yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type in ('folder','doc','upload','cloudfile') and parent_id is null and status = 'active' ${cf} order by updated_at desc limit 3`)
      case "campfire": {
        const lines = yield* sql<Recording & { name: string }>`select r.*, pe.name from recordings r left join people pe on pe.id = r.creator_id where project_id = ${p.id} and type = 'line' and status = 'active' order by r.created_at desc limit 3`
        return lines.length ? html`<ul${sx(ps.list)}>${[...lines].reverse().map((l) => html`<li${sx(ps.item)}><b>${l.name ?? (l.data.chatbot_name ? `${l.data.chatbot_name} (bot)` : "Someone")}:</b> ${excerpt(l.body, 80)}</li>`)}</ul>` : null
      }
      case "schedule":
        return items(yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'event' and status = 'active' and (data->>'starts_at') >= ${isoDate(new Date())} ${cf} order by data->>'starts_at' limit 3`,
          (r) => `${fmtDate(r.data.starts_at)}: ${r.title}`)
      case "checkins":
        return items(yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'question' and status = 'active' ${cf} order by position limit 3`)
      case "cardtable": {
        const cols = yield* sql<Recording & { n: number }>`select r.*, (select count(*) from recordings k where k.parent_id = r.id and k.type = 'card' and k.status = 'active')::int as n
          from recordings r where project_id = ${p.id} and type = 'column' and status = 'active' order by position`
        return cols.length ? html`<p${sx(ps.tileText)}>${cols.map((col, i) => html`${i ? " · " : ""}${col.title}: ${(col as any).n}`)}</p>` : null
      }
      case "forwards":
        return items(yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'forward' and status = 'active' ${cf} order by created_at desc limit 3`)
      case "timesheet": {
        const [row] = yield* sql<{ m: number }>`select coalesce(sum(minutes), 0)::int as m from time_entries where project_id = ${p.id} and on_date >= date_trunc('month', now())`
        return row!.m ? html`<p${sx(ps.tileText)}>${(row!.m / 60).toFixed(1)} hours logged this month</p>` : null
      }
    }
  })

const enabledTools = (p: Project) => p.tools.filter((t) => t.enabled)

const crumbs = (p: Project) => [[p.name, projectUrl(p)] as const]

export const routes = [
  get("/projects/:id", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (p.kind === "ping") return redirect(`/chats/${p.id}`)
      const people = yield* projectPeople(p)
      const clients = people.filter(isClient)
      const tools = isClient(c.me) ? enabledTools(p).filter((t) => t.type !== "timesheet") : enabledTools(p)
      const previews = yield* Effect.forEach(tools, (t) => preview(c, p, t.type))
      const doors = yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'door' and status = 'active' ${clientFilter(sql, c.me, "r")} order by position`
      const [gauge] = yield* sql<{ value: number; note: string | null; created_at: Date }>`select * from gauge_updates where project_id = ${p.id} order by id desc limit 1`
      const [bm] = yield* sql`select 1 from bookmarks where person_id = ${c.me.id} and project_id = ${p.id} and recording_id is null`
      yield* trackVisit(c, projectUrl(p), p.name, p.id)
      return yield* render(c, p.name, html`
${p.kind === "template" ? html`<div role="note"><p><b>This is a template.</b> Changing it doesn't change projects already made from it.</p>
  <p><a href="/templates/${p.id}/use" data-button>Make a project from this template</a></p></div>` : ""}
${p.status === "archived" ? html`<div role="note"><p><b>This project is archived.</b> It's read-only.</p>${!isClient(c.me) ? html`<form method="post" action="/projects/${p.id}/unarchive"><button>Unarchive</button></form>` : ""}</div>` : ""}
${p.status === "trashed" ? html`<div role="note"><p><b>This project is in the trash.</b></p><form method="post" action="/projects/${p.id}/restore"><button>Put it back</button></form></div>` : ""}
<div${sx(ps.head)}>
  <div>
    <h1${sx(ps.title)}>${p.name}</h1>
    ${p.description ? html`<p${sx(ps.lede)}>${fmt(p.description)}</p>` : ""}
  </div>
  <div${sx(ps.actions)}>
    <form method="post" action="/projects/${p.id}/bookmark" style="display:inline"><button>${bm ? "Remove bookmark" : "Bookmark"}</button></form>
    <a href="/projects/${p.id}/menu" data-button>••• Project menu</a>
  </div>
</div>
<p${sx(ps.facts)}>
  ${p.starts_on || p.ends_on ? html`<span${sx(ps.fact, ps.factInk)}>${fmtDate(p.starts_on)} → ${fmtDate(p.ends_on)}</span>` : ""}
  <span${sx(ps.fact)}>People: <span${sx(ps.factInk)}>${people.map((x, i) => html`${i ? ", " : ""}${personLink(x)}`)}${p.all_access && !p.is_hq ? " (and everyone else at the company: all-access)" : ""}</span>
    ${!isClient(c.me) ? html`<a href="/projects/${p.id}/people">Add/remove people</a>` : ""}</span>
  ${gauge || !isClient(c.me) ? html`<span${sx(ps.fact)}>Status: ${gauge ? html`<meter min="0" max="100" value="${gauge.value}">${gauge.value}%</meter> <span${sx(ps.factInk)}>${gauge.value}%${gauge.note ? html`: ${gauge.note}` : ""}</span>` : "not set"} <a href="/projects/${p.id}/status">${gauge ? "Update" : "Set the status"}</a></span>` : ""}
  ${!isClient(c.me) ? html`<a href="/projects/${p.id}/edit">Edit name, description & dates</a>` : ""}
</p>
${clients.length && !isClient(c.me) ? html`<p><small>Clients are on this project (${clients.map((x) => x.name).join(", ")}). They only see what you show them. <a href="/projects/${p.id}/clients">Client access</a></small></p>` : ""}
<div${sx(ps.grid)}>
${tools.map((t, i) => html`
<section aria-label="${t.name}"${sx(ps.tile, ps.linked)}>
  <h2${sx(ps.tileTitle)}><a href="${toolUrl(p, t.type)}"${sx(ps.tileLink)}>${t.name}</a></h2>
  ${previews[i] ?? html`<p${sx(ps.tileBody)}>${PITCH[t.type]}</p>`}
</section>`)}
${doors.length ? html`<section aria-label="Links"${sx(ps.tile)}><h2${sx(ps.tileTitle)}>Links</h2><ul${sx(ps.list)}>${doors.map((d) => html`<li${sx(ps.item)}><a href="${d.data.url}" target="_blank" rel="noopener"${sx(ps.itemLink)}>${d.title}</a>${d.data.description ? html`<small>: ${d.data.description}</small>` : ""} <small><a href="/projects/${p.id}/links/${d.id}" aria-label="Link options"${sx(ps.above)}>•••</a></small></li>`)}</ul></section>` : ""}
</div>
<p${sx(ps.more)}>
  ${!isClient(c.me) && p.status === "active" ? html`<span><a href="/projects/${p.id}/links/new">Add a link</a> <small>(to another tool, like Figma, GitHub, or a Google Drive folder)</small></span>` : ""}
  <a href="/projects/${p.id}/activity">See all activity on this project</a>
</p>`, p.kind === "template" ? [["Templates", "/templates"]] : [["Home", "/"]])
    })),

  post("/projects/:id/bookmark", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const del = yield* sql`delete from bookmarks where person_id = ${c.me.id} and project_id = ${p.id} and recording_id is null returning 1`
      if (!del.length) yield* sql`insert into bookmarks ${sql.insert({ person_id: c.me.id, project_id: p.id })}`
      return redirect(projectUrl(p), del.length ? "Bookmark removed." : { msg: "Bookmarked.", href: "/my/bookmarks", label: "See your bookmarks" })
    })),

  get("/projects/:id/edit", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "Edit project", editForm(p, []), crumbs(p))
    })),

  post("/projects/:id/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const next = { ...p, name: str(fd, "name"), description: str(fd, "description") || null, starts_on: str(fd, "starts_on") || null, ends_on: str(fd, "ends_on") || null }
      const errs = [
        ...(next.name ? [] : ["Your project needs a name."]),
        ...(next.starts_on && next.ends_on && next.ends_on < next.starts_on ? ["The end date has to come after the start date."] : []),
      ]
      if (errs.length) return yield* render(c, "Edit project", editForm(next, errs), crumbs(p), 422)
      yield* sql`update projects set name = ${next.name}, description = ${next.description}, starts_on = ${next.starts_on}, ends_on = ${next.ends_on} where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `updated the project details` })
      return redirect(projectUrl(p), "Saved.")
    })),

  get("/projects/:id/menu", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const [pin] = yield* sql`select 1 from pins where person_id = ${c.me.id} and project_id = ${p.id}`
      const [bm] = yield* sql`select 1 from bookmarks where person_id = ${c.me.id} and project_id = ${p.id} and recording_id is null`
      const staff = !isClient(c.me)
      return yield* render(c, "Project menu", html`
<h1>Project menu</h1>
${menu.wrap(
  staff && menu.group("Project",
    menu.link(`/projects/${p.id}/edit`, "Edit name, description & dates"),
    menu.link(`/projects/${p.id}/tools`, "Change tools"),
    menu.link(`/projects/${p.id}/people`, "Add/remove people"),
    menu.link(`/projects/${p.id}/clients`, "Set up client access")),
  menu.group("For you",
    menu.post(`/projects/${p.id}/pin`, pin ? "Unpin from Home" : "Pin to Home"),
    menu.post(`/projects/${p.id}/bookmark`, bm ? "Remove bookmark" : "Bookmark")),
  menu.group("Records",
    staff && p.kind === "project" && menu.post(`/projects/${p.id}/save-as-template`, "Save as a template"),
    menu.link(`/projects/${p.id}/trash`, "Archived & trashed items"),
    menu.link(`/projects/${p.id}/activity`, "See all activity"),
    staff && menu.link(`/projects/${p.id}/webhooks`, "Webhooks")),
  staff && menu.group("Archive or trash",
    p.status === "active" && !p.is_hq && menu.post(`/projects/${p.id}/archive`, "Archive this project"),
    p.status === "archived" && menu.post(`/projects/${p.id}/unarchive`, "Unarchive this project"),
    !p.is_hq && p.status !== "trashed" && menu.link(`/projects/${p.id}/trash-project`, "Put this project in the trash", true)),
)}`, crumbs(p))
    })),

  get("/projects/:id/tools", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const tools = [...p.tools, ...defaultTools().filter((d) => !p.tools.some((t) => t.type === d.type))]
      return yield* render(c, "Change tools", html`
<h1>Change tools</h1>
<p>Turning a tool off hides it. Nothing is deleted. Turn it back on and it's all there.</p>
<form method="post" action="/projects/${p.id}/tools">
  <table><thead><tr><th>On</th><th>Name</th><th>Order</th></tr></thead><tbody>
  ${tools.map((t, i) => html`<tr>
    <td><input type="checkbox" name="on_${t.type}"${t.enabled ? raw(" checked") : ""} aria-label="${t.name} on"></td>
    <td><input name="name_${t.type}" value="${t.name}" aria-label="Rename ${t.name}"></td>
    <td><input type="number" name="pos_${t.type}" value="${i + 1}" min="1" max="20" size="3" aria-label="Position"></td></tr>`)}
  </tbody></table>
  <p><button>Save changes</button> <a href="${projectUrl(p)}">Cancel</a></p>
</form>
<p><a href="/projects/${p.id}/links/new">Add a link</a></p>`, crumbs(p))
    })),

  post("/projects/:id/tools", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const tools: Tool[] = defaultTools()
        .map((d) => ({ type: d.type, name: str(fd, `name_${d.type}`) || d.name, enabled: bool(fd, `on_${d.type}`), pos: Number(str(fd, `pos_${d.type}`)) || 99 }))
        .sort((a, b) => a.pos - b.pos)
        .map(({ pos, ...t }) => t)
      yield* sql`update projects set tools = ${JSON.stringify(tools)} where id = ${p.id}`
      return redirect(projectUrl(p), "Tools updated.")
    })),

  get("/projects/:id/people", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "People on this project", yield* peoplePage(c, p, []), crumbs(p))
    })),

  post("/projects/:id/people", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const keep = ids(fd, "person_ids")
      if (!keep.includes(c.me.id) && !(p.all_access && !isClient(c.me)) && !bool(fd, "confirm_self"))
        return yield* render(c, "People on this project", yield* peoplePage(c, p, ["If you remove yourself you'll lose access to this project. Tick “Yes, remove me” to do it anyway."], keep), crumbs(p), 422)
      yield* sql`delete from project_people where project_id = ${p.id}`
      for (const id of keep) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      if (!p.is_hq) yield* sql`update projects set all_access = ${str(fd, "access") === "all"} where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `changed who's on ${p.name}` })
      return redirect(keep.includes(c.me.id) || str(fd, "access") === "all" ? projectUrl(p) : "/", "People updated.")
    })),

  get("/projects/:id/activity", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const personId = Number(c.query.get("person")) || null
      const pageN = Math.max(1, Number(c.query.get("page")) || 1)
      const evs = yield* sql<{ id: number; summary: string; created_at: Date; name: string | null; avatar_url: string | null; person_id: number | null; recording_id: number | null; visible: boolean | null }>`
        select e.*, pe.name, pe.avatar_url, r.visible_to_clients as visible from events e left join people pe on pe.id = e.person_id left join recordings r on r.id = e.recording_id
        where e.project_id = ${p.id} ${personId ? sql`and e.person_id = ${personId}` : sql``}
          ${isClient(c.me) ? sql`and (r.visible_to_clients or e.recording_id is null)` : sql``}
        order by e.created_at desc limit 51 offset ${(pageN - 1) * 50}`
      const people = yield* projectPeople(p)
      return yield* render(c, "Project activity", html`
<h1>Activity on ${p.name}</h1>
<form method="get"${sx(kit.toolbar)}><label>Show only what <select name="person"${sx(kit.toolbarControl)}><option value="">everyone</option>
  ${people.map((x) => html`<option value="${x.id}"${x.id === personId ? raw(" selected") : ""}>${x.name}</option>`)}</select> did</label> <button${sx(kit.toolbarControl)}>Filter</button></form>
${evs.length ? activityList(evs.slice(0, 50), c.me.time_zone) : html`<p${sx(kit.empty)}>Nothing's happened yet. Activity shows up here as people post, comment, and check things off.</p>`}
${evs.length > 50 ? html`<p><a href="?page=${pageN + 1}${personId ? `&person=${personId}` : ""}">Show more</a></p>` : ""}`, crumbs(p))
    })),

  get("/projects/:id/trash", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const rows = yield* sql<Recording & { by: string | null }>`
        select r.*, (select pe.name from events e join people pe on pe.id = e.person_id where e.recording_id = r.id and e.action in ('trashed','archived') order by e.id desc limit 1) as by
        from recordings r where project_id = ${p.id} and status in ('trashed','archived') ${clientFilter(sql, c.me, "r")} order by coalesce(trashed_at, updated_at) desc`
      const trashed = rows.filter((r) => r.status === "trashed")
      const archived = rows.filter((r) => r.status === "archived")
      const daysLeft = (r: Recording) => Math.max(0, 30 - Math.floor((Date.now() - new Date(r.trashed_at!).getTime()) / 86_400_000))
      return yield* render(c, "Archived & trashed items", html`
<h1>Archived & trashed items</h1>
<p${sx(pm.intro)}>Things in the trash are deleted forever after 30 days.</p>
${!rows.length ? html`<p${sx(kit.empty)}>Nothing archived, nothing in the trash.</p>` : ""}
${trashed.length ? html`<h2>In the trash</h2><ul${sx(kit.rows)}>${trashed.map((r) => html`<li${sx(pm.item)}><span${sx(pm.itemTitle)}><span${sx(kit.tag)}>${TYPE_NAMES[r.type]}</span> <a href="${urlFor(r)}">${titleOf(r)}</a> <small>(trashed ${r.by ? `by ${r.by} ` : ""}${fmtDate(r.trashed_at)}, ${plural(daysLeft(r), "day")} left)</small></span>
  <form method="post" action="/r/${r.id}/restore" style="display:inline"><button${sx(kit.toolbarControl)}>Put it back</button></form></li>`)}</ul>` : ""}
${archived.length ? html`<h2>Archived</h2><ul${sx(kit.rows)}>${archived.map((r) => html`<li${sx(pm.item)}><span${sx(pm.itemTitle)}><span${sx(kit.tag)}>${TYPE_NAMES[r.type]}</span> <a href="${urlFor(r)}">${titleOf(r)}</a></span>
  <form method="post" action="/r/${r.id}/unarchive" style="display:inline"><button${sx(kit.toolbarControl)}>Unarchive</button></form></li>`)}</ul>` : ""}`, crumbs(p))
    })),

  // Whole-project lifecycle
  post("/projects/:id/archive", (c) => setProjectStatus(c, "archived", "Archived. Find it under Archived projects.")),
  post("/projects/:id/unarchive", (c) => setProjectStatus(c, "active", "Unarchived.")),
  post("/projects/:id/restore", (c) => setProjectStatus(c, "active", "Put back.")),
  get("/projects/:id/trash-project", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me) || p.is_hq) return yield* new NoAccess()
      return yield* render(c, "Trash this project?", html`
<h1>Put ${p.name} in the trash?</h1>
<p>Everything in it goes too. An admin can put it back for 30 days, then it's deleted forever.</p>
<form method="post" action="/projects/${p.id}/trash-project"><button>Yes, put this project in the trash</button> <a href="${projectUrl(p)}">Never mind</a></form>`, crumbs(p))
    })),
  post("/projects/:id/trash-project", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me) || p.is_hq) return yield* new NoAccess()
      yield* sql`update projects set status = 'trashed', trashed_at = now() where id = ${p.id}`
      yield* logEvent(c, { project_id: p.id, action: "trashed", summary: `put the project ${p.name} in the trash` })
      return redirect("/", "Project moved to the trash.")
    })),

  post("/projects/:id/save-as-template", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const t = yield* copyProject(c, p, { name: `${p.name} (template)`, description: p.description, kind: "template" })
      yield* sql`insert into project_people (project_id, person_id) values (${t.id}, ${c.me.id})`
      return redirect(`/projects/${t.id}`, "Saved as a template.")
    })),

  // Gauge
  get("/projects/:id/status", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const ups = yield* sql<{ value: number; note: string | null; created_at: Date; name: string | null; avatar_url: string | null }>`
        select g.*, pe.name, pe.avatar_url from gauge_updates g left join people pe on pe.id = g.person_id where project_id = ${p.id} order by g.id desc`
      return yield* render(c, "Status", html`
<h1>Status of ${p.name}</h1>
<p${sx(pm.intro)}>How far along is this project? A person sets it. It doesn't count tasks.</p>
${ups[0] ? html`<p${sx(pm.needle)}><span${sx(pm.needleNum)}>${ups[0].value}%</span> <meter min="0" max="100" value="${ups[0].value}"${sx(pm.meter)}></meter></p>` : html`<p${sx(pm.intro)}>Not set yet.</p>`}
${!isClient(c.me) ? html`<form method="post" action="/projects/${p.id}/status"${sx(pm.tile)}>
  <p><label>How far along? (0–100)<br><input type="range" name="value" min="0" max="100" step="5" value="${ups[0]?.value ?? 0}" oninput="this.nextElementSibling.value=this.value"${sx(pm.range)}> <output>${ups[0]?.value ?? 0}</output></label></p>
  <p><label>What changed? (optional)<br><input name="note" size="60"></label></p>
  <button>Update status</button>
</form>` : ""}
${ups.length ? html`<h2>Past updates</h2><ul${sx(kit.rows)}>${ups.map((u) => html`<li${sx(pm.row)}>${face({ name: u.name ?? "Someone", avatar_url: u.avatar_url }, 24)}
  <span><b>${u.value}%</b> · ${u.name ?? "Someone"}${u.note ? html`: ${u.note}` : ""}</span><small${sx(pm.time)}>${fmtDateTime(u.created_at, c.me.time_zone)}</small></li>`)}</ul>` : ""}
<p${sx(kit.links)}><a href="/overview">See every project's status on the Overview</a></p>`, crumbs(p))
    })),

  post("/projects/:id/status", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const value = Math.min(100, Math.max(0, Math.round(Number(str(fd, "value")) || 0)))
      yield* sql`insert into gauge_updates ${sql.insert({ project_id: p.id, person_id: c.me.id, value, note: str(fd, "note") || null })}`
      yield* logEvent(c, { project_id: p.id, action: "edited", summary: `set the status to ${value}%` })
      return redirect(projectUrl(p), "Status updated.")
    })),

  // Webhooks
  get("/projects/:id/webhooks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const hooks = yield* sql<{ id: number; url: string; types: string[] }>`select * from webhooks where project_id = ${p.id} order by id`
      const deliveries = yield* sql<{ webhook_id: number; event: string; status: number | null; error: string | null; created_at: Date }>`
        select d.* from webhook_deliveries d join webhooks w on w.id = d.webhook_id where w.project_id = ${p.id} order by d.id desc limit 20`
      return yield* render(c, "Webhooks", html`
<h1>Webhooks for ${p.name}</h1>
<p${sx(pm.intro)}>Send what happens in this project to another system.</p>
${hooks.length ? html`<ul${sx(kit.rows)}>${hooks.map((h) => html`<li${sx(pm.item)}><span${sx(pm.itemTitle)}><span${sx(pm.url)}>${h.url}</span> <small>(${h.types.length ? h.types.join(", ") : "every event"})</small></span>
  <span${sx(kit.actions)}><form method="post" action="/projects/${p.id}/webhooks/${h.id}/test" style="display:inline"><button${sx(kit.toolbarControl)}>Send a test</button></form>
  <form method="post" action="/projects/${p.id}/webhooks/${h.id}/delete" style="display:inline"><button${sx(kit.toolbarControl)}>Delete</button></form></span></li>`)}</ul>` : html`<p${sx(pm.intro)}>No webhooks yet.</p>`}
<section aria-labelledby="add-webhook"${sx(pm.tile)}><h2 id="add-webhook"${sx(pm.tileTitle)}>Add a webhook</h2>
<form method="post" action="/projects/${p.id}/webhooks">
  <p><label>Payload URL<br><input type="url" name="url" size="60" required placeholder="https://example.com/hook"></label></p>
  <fieldset><legend>Which events? (none = all)</legend>
    <div${sx(pm.events)}>${["created", "edited", "completed", "commented", "trashed", "moved", "archived"].map((t) => html`<label><input type="checkbox" name="types" value="${t}"> ${t}</label>`)}</div>
  </fieldset>
  <button>Add webhook</button>
</form></section>
<h2>Recent deliveries</h2>
${deliveries.length ? html`<ul>${deliveries.map((d) => html`<li>${fmtDateTime(d.created_at, c.me.time_zone)} · ${d.event} · ${d.status ?? "failed"}${d.error ? html`: We couldn't reach that URL. ${d.error}` : ""}</li>`)}</ul>` : html`<p${sx(pm.intro)}>Nothing sent yet.</p>`}`, crumbs(p))
    })),

  post("/projects/:id/webhooks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const url = str(fd, "url")
      if (!/^https?:\/\//.test(url)) return redirect(`/projects/${p.id}/webhooks`, "That doesn't look like a link.")
      yield* sql`insert into webhooks (project_id, url, types) values (${p.id}, ${url}, ${fd.getAll("types").map(String)})`
      return redirect(`/projects/${p.id}/webhooks`, "Webhook added.")
    })),

  post("/projects/:id/webhooks/:wid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* sql`delete from webhooks where id = ${Number(c.params.wid)} and project_id = ${p.id}`
      return redirect(`/projects/${p.id}/webhooks`, "Webhook deleted.")
    })),

  post("/projects/:id/webhooks/:wid/test", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      yield* logEvent(c, { project_id: p.id, action: "test", summary: "sent a test webhook" })
      return redirect(`/projects/${p.id}/webhooks`, "Test sent. Refresh to see the delivery.")
    })),
]

const setProjectStatus = (c: Ctx, status: "active" | "archived", msg: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const p = yield* findProject(c, c.params.id, { allowTrashed: true })
    if (isClient(c.me) || (p.is_hq && status !== "active")) return yield* new NoAccess()
    yield* sql`update projects set status = ${status}, trashed_at = null where id = ${p.id}`
    yield* logEvent(c, { project_id: p.id, action: status === "archived" ? "archived" : "restored", summary: `${status === "archived" ? "archived" : "reactivated"} the project ${p.name}` })
    return redirect(projectUrl(p), msg)
  })

const editForm = (p: Project, errs: string[]) => html`
<h1>Edit project details</h1>
${errors(errs)}
<form method="post" action="/projects/${p.id}/edit">
  <p><label>Name<br><input name="name" value="${p.name}" required></label></p>
  <p><label>Description<br><textarea name="description" rows="3" cols="60">${p.description ?? ""}</textarea></label></p>
  <p><label>Start date <input type="date" name="starts_on" value="${isoDate(p.starts_on)}"></label>
     <label>End date <input type="date" name="ends_on" value="${isoDate(p.ends_on)}"></label></p>
  <p><small>Projects with both dates show up on the <a href="/timeline">Timeline</a>.</small></p>
  <p><button>Save changes</button> <a href="${projectUrl(p)}">Cancel</a></p>
</form>`

const peoplePage = (c: Ctx, p: Project, errs: string[], checkedIds?: number[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const everyone = yield* accountPeople(c.me.account_id)
    const members = checkedIds ?? (yield* sql<{ person_id: number }>`select person_id from project_people where project_id = ${p.id}`).map((r) => r.person_id)
    return html`
<h1>People on ${p.name}</h1>
${errors(errs)}
<form method="post" action="/projects/${p.id}/people">
  ${peopleCheckboxes("person_ids", everyone, members)}
  ${errs.length ? html`<p><label><input type="checkbox" name="confirm_self"> Yes, remove me</label></p>` : ""}
  ${!p.is_hq ? html`<fieldset><legend>Who can see it?</legend>
    <label><input type="radio" name="access" value="invited"${!p.all_access ? raw(" checked") : ""}> Just the people checked above</label><br>
    <label><input type="radio" name="access" value="all"${p.all_access ? raw(" checked") : ""}> Everyone at the company (all-access)</label>
  </fieldset>` : html`<p>HQ is all-access: everyone at the company can see it.</p>`}
  <p><button>Save changes</button> <a href="${projectUrl(p)}">Cancel</a></p>
</form>
<p><a href="/people/invite?project_id=${p.id}">Invite someone new</a> · <a href="/projects/${p.id}/clients">Clients on this project</a></p>`
  })

/** A feed of events, grouped by day. Shared with the Activity area. */
export const activityList = (evs: ReadonlyArray<{ summary: string; created_at: Date; name: string | null; avatar_url?: string | null; recording_id: number | null; project_name?: string; project_id?: number | null }>, tz: string) => {
  const days = new Map<string, typeof evs[number][]>()
  for (const e of evs) {
    const d = fmtDate(e.created_at, tz)
    days.set(d, [...(days.get(d) ?? []), e])
  }
  return html`${[...days].map(([d, es]) => html`<h2${sx(kit.day)}><span>${d}</span><span${sx(kit.dayRule)}></span></h2><ul${sx(kit.rows)}>${es.map((e) => html`<li${sx(pm.row)}>
    ${face({ name: e.name ?? "Someone", avatar_url: e.avatar_url }, 24)}
    <span><b>${e.name ?? "Someone"}</b> ${e.recording_id ? html`<a href="/r/${e.recording_id}/go">${e.summary}</a>` : e.summary}
    ${e.project_name ? html`<small>in <a href="/projects/${e.project_id}">${e.project_name}</a></small>` : ""}</span>
    <small${sx(pm.time)}>${new Date(e.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}</small></li>`)}</ul>`)}`
}
