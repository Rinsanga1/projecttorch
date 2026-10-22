// Home: Home, All projects, Archived projects, New project, Who's on this project?, Templates.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmtDate, excerpt, today, type Raw } from "../lib/html.ts"
import { get, post, redirect, render, str, ids, bool, errors, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import {
  visibleProjects, findProject, projectUrl, defaultTools, accountPeople, peopleCheckboxes, canCreateProjects, canInvite,
  logEvent, sendEmail, type Project, type Recording,
} from "../lib/core.ts"
import { sx } from "../lib/ui.ts"
import { color, media, motion, radius, space, text } from "../lib/tokens.stylex.ts"

type Listed = Project & { member_names: string | null; pinned: boolean }

const DESKTOP = "@media (min-width: 768px)"
const hs = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s4, marginBottom: space.s6 },
  title: { margin: 0 },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2, margin: 0 },
  group: { fontSize: text.xs, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: color.muted, marginTop: space.s6, marginBottom: space.s3 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: space.s4, marginBottom: space.s2 },
  card: {
    position: "relative", display: "flex", flexDirection: "column", gap: 6, minHeight: 168, paddingBlock: space.s5, paddingInline: space.s5,
    borderRadius: radius.xl, borderTopWidth: 0, transitionProperty: "background-color", transitionDuration: motion.fast,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  // The name link covers the whole card, so the card is the click target; the Pin button sits above it.
  cardName: {
    fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none", color: color.ink, paddingRight: space.s6,
    "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" },
  },
  cardDesc: { fontSize: text.sm, color: color.muted, margin: 0, flexGrow: 1 },
  tag: {
    alignSelf: "flex-start", paddingBlock: 4, paddingInline: 9, borderRadius: radius.pill, backgroundColor: color.primary, color: color.onPrimary,
    fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
  },
  pin: { position: "absolute", zIndex: 1, top: 14, right: 14, minHeight: 28, paddingBlock: 4, paddingInline: 10, fontSize: text.xs, backgroundColor: color.sheet },
  columns: { display: "grid", gridTemplateColumns: { default: "1fr", [DESKTOP]: "1fr 1fr" }, gap: space.s4, marginTop: space.s6 },
  panel: { backgroundColor: color.tile, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s5 },
  panelTitle: { marginTop: 0, fontSize: text.md },
  row: { display: "flex", gap: space.s3, alignItems: "baseline", borderTopColor: color.line },
  when: { flexShrink: 0, width: "4.5em", fontSize: text.sm, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  // Timeline: each dated project as a bar on one shared track, with today marked.
  lineup: { marginBottom: space.s6 },
  lineupHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: space.s3 },
  lineupTitle: { margin: 0, fontSize: text.md },
  track: { position: "relative", display: "grid", gap: space.s2, paddingTop: 26, paddingBottom: space.s2 },
  lane: { position: "relative", zIndex: 1, height: 34 },
  bar: (left: string, width: string) => ({ left, width }),
  barBox: {
    position: "absolute", top: 0, bottom: 0, minWidth: "fit-content", display: "flex", alignItems: "center", gap: space.s2,
    paddingInline: 14, borderRadius: radius.pill, fontSize: text.sm, fontWeight: 600,
    color: color.ink, textDecoration: "none", whiteSpace: "nowrap",
    transitionProperty: "background-color, transform", transitionDuration: motion.fast, transitionTimingFunction: motion.out,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
    transform: { default: null, ":active": { default: "scale(.98)", [media.reduce]: null } },
  },
  barDates: { fontWeight: 400, color: color.muted },
  today: (left: string) => ({ left }),
  todayLine: { position: "absolute", top: 0, bottom: 0, width: 2, marginLeft: -1, borderRadius: 2, backgroundColor: color.accent, pointerEvents: "none" },
  todayLabel: {
    position: "absolute", top: 0, transform: "translateX(-50%)", paddingBlock: 3, paddingInline: 8, borderRadius: radius.pill,
    backgroundColor: color.accent, color: color.onAccent, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", lineHeight: 1,
  },
})

const DAY = 86_400_000
const lineup = (ps: ReadonlyArray<Listed>) => {
  const t = (d: unknown) => Date.parse(String(d instanceof Date ? d.toISOString() : d).slice(0, 10))
  const from = Math.min(...ps.map((p) => t(p.starts_on)))
  const to = Math.max(...ps.map((p) => t(p.ends_on))) + DAY
  const pct = (ms: number) => `${(((ms - from) / (to - from)) * 100).toFixed(2)}%`
  const now = t(new Date())
  return html`<div${sx(hs.track)}>
    ${ps.map((p) => html`<div${sx(hs.lane)}><a href="${projectUrl(p)}"${sx(hs.barBox, hs.bar(pct(t(p.starts_on)), pct(from + t(p.ends_on) + DAY - t(p.starts_on))))}>${p.name} <span${sx(hs.barDates)}>${fmtDate(p.starts_on)} → ${fmtDate(p.ends_on)}</span></a></div>`)}
    ${now >= from && now <= to ? html`<span aria-hidden="true"${sx(hs.todayLine, hs.today(pct(now)))}></span><span${sx(hs.todayLabel, hs.today(pct(now)))}>Today</span>` : ""}
  </div>`
}

const projectCard = (p: Listed, opts: { pin?: boolean } = {}) => html`
<li${sx(hs.card)}>
  <a href="${projectUrl(p)}"${sx(hs.cardName)}>${p.name}</a>
  ${p.is_hq ? html`<span${sx(hs.tag)}>HQ</span>` : ""}${p.all_access && !p.is_hq ? html`<span${sx(hs.tag)}>All-access</span>` : ""}
  ${p.description ? html`<p${sx(hs.cardDesc)}>${excerpt(p.description, 100)}</p>` : ""}
  ${p.member_names ? html`<small>${p.member_names}</small>` : ""}
  ${opts.pin !== false && p.kind === "project" ? html`<form method="post" action="/projects/${p.id}/pin" style="display:inline"><button${sx(hs.pin)}>${p.pinned ? "Unpin" : "Pin"}</button></form>` : ""}
</li>`
const cards = (ps: ReadonlyArray<Listed>, opts?: { pin?: boolean }) => html`<ul${sx(hs.cards)}>${ps.map((p) => projectCard(p, opts))}</ul>`

/** What's on my plate / my next dates, for the Home cards. */
export const myUpcoming = (c: Ctx, limit = 5) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const assigned = yield* sql<Recording & { project_name: string }>`
      select r.*, p.name as project_name from recordings r join projects p on p.id = r.project_id
      where r.type in ('todo','card','step') and r.status = 'active' and p.status = 'active'
        and r.data->'assignee_ids' @> ${JSON.stringify([c.me.id])}::jsonb and r.data->>'completed_at' is null
      order by r.data->>'due_on' nulls last, r.id limit ${limit}`
    const dates = yield* sql<Recording & { project_name: string; on_date: string }>`
      select r.*, p.name as project_name, coalesce(r.data->>'starts_at', r.data->>'due_on') as on_date from recordings r join projects p on p.id = r.project_id
      where r.status = 'active' and p.status = 'active' and (
        (r.type = 'event' and (r.data->'participant_ids' @> ${JSON.stringify([c.me.id])}::jsonb or r.creator_id = ${c.me.id}) and (r.data->>'starts_at') >= ${today()})
        or (r.type in ('todo','card') and r.data->'assignee_ids' @> ${JSON.stringify([c.me.id])}::jsonb and r.data->>'completed_at' is null and (r.data->>'due_on') >= ${today()}))
      order by on_date limit ${limit}`
    return { assigned, dates }
  })

export const routes = [
  get("/", (c) =>
    Effect.gen(function* () {
      const all = yield* visibleProjects(c)
      const hq = all.filter((p) => p.is_hq)
      const pinned = all.filter((p) => p.pinned && !p.is_hq)
      const recentIds = (c.me.prefs.recent_projects ?? []).filter((id) => !pinned.some((p) => p.id === id) && !hq.some((p) => p.id === id))
      const recent = recentIds.map((id) => all.find((p) => p.id === id)).filter((p): p is Listed => !!p).slice(0, 6)
      const others = pinned.length + recent.length ? [] : all.filter((p) => !p.is_hq).slice(0, 6)
      const dated = all.filter((p) => p.starts_on && p.ends_on)
      const { assigned, dates } = yield* myUpcoming(c)
      return yield* render(c, "Home", html`
<div${sx(hs.head)}>
  <h1${sx(hs.title)}>Home</h1>
  <p${sx(hs.actions)}>
    ${canCreateProjects(c) ? html`<a href="/projects/new" data-button>Make a new project</a>` : ""}
    ${canInvite(c) ? html`<a href="/people/invite" data-button>Invite people</a>` : ""}
  </p>
</div>
<section aria-label="Timeline"${sx(hs.lineup)}>
  <div${sx(hs.lineupHead)}><h2${sx(hs.lineupTitle)}><a href="/timeline">Timeline</a></h2>${dated.length ? html`<a href="/timeline"><small>Open the Timeline</small></a>` : ""}</div>
  ${dated.length
    ? lineup(dated)
    : html`<p>Projects with start and end dates show up here. <a href="/timeline">Open the Timeline</a></p>`}
</section>
${all.length === 0
  ? html`<p>Welcome to Home. Projects you make or get added to show up here.</p>${canCreateProjects(c) ? html`<p><a href="/projects/new">Make a new project</a></p>` : ""}`
  : html`
${hq.length ? cards(hq, { pin: false }) : ""}
${pinned.length ? html`<h2${sx(hs.group)}>Pinned</h2>${cards(pinned)}` : ""}
${recent.length ? html`<h2${sx(hs.group)}>Recently visited</h2>${cards(recent)}` : ""}
${others.length ? html`<h2${sx(hs.group)}>Projects</h2>${cards(others)}` : ""}`}
<p><small><a href="/projects">View all projects</a> · <a href="/templates">Templates</a></small></p>
<div${sx(hs.columns)}>
<section aria-label="Your Calendar"${sx(hs.panel)}>
  <h2${sx(hs.panelTitle)}><a href="/my/calendar">Your Calendar</a></h2>
  ${dates.length ? html`<ul>${dates.map((r) => html`<li${sx(hs.row)}><span${sx(hs.when)}>${fmtDate(r.on_date)}</span><span><a href="/r/${r.id}/go">${r.title}</a> <small>${r.project_name}</small></span></li>`)}</ul>` : html`<p>No upcoming dates for you.</p>`}
</section>
<section aria-label="Your Assignments"${sx(hs.panel)}>
  <h2${sx(hs.panelTitle)}><a href="/my/assignments">Your Assignments</a></h2>
  ${assigned.length ? html`<ul>${assigned.map((r) => html`<li${sx(hs.row)}><span><a href="/r/${r.id}/go">${r.title}</a> <small>${r.project_name}${r.data.due_on ? `, due ${fmtDate(r.data.due_on)}` : ""}</small></span></li>`)}</ul>` : html`<p>Nothing's assigned to you right now.</p>`}
</section>
</div>`)
    })),

  post("/projects/:id/pin", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const del = yield* sql`delete from pins where person_id = ${c.me.id} and project_id = ${p.id} returning 1`
      if (!del.length) yield* sql`insert into pins (person_id, project_id) values (${c.me.id}, ${p.id})`
      return redirect(c.req.headers["referer"] ? new URL(c.req.headers["referer"]).pathname : "/", del.length ? `Unpinned ${p.name}.` : `Pinned ${p.name} to Home.`)
    })),

  get("/projects", (c) =>
    Effect.gen(function* () {
      const q = (c.query.get("q") ?? "").trim().toLowerCase()
      const view = c.query.get("view") === "list" ? "list" : "cards"
      const sort = c.query.get("sort") ?? "recent"
      let ps = yield* visibleProjects(c)
      if (q) ps = ps.filter((p) => p.name.toLowerCase().includes(q))
      const recent = c.me.prefs.recent_projects ?? []
      if (sort === "recent") ps = [...ps].sort((a, b) => (recent.indexOf(a.id) + 1 || 999) - (recent.indexOf(b.id) + 1 || 999))
      if (sort === "newest") ps = [...ps].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      return yield* render(c, "All projects", html`
<h1>All projects</h1>
<form method="get" action="/projects">
  <label>Filter by name… <input type="search" name="q" value="${c.query.get("q") ?? ""}"></label>
  <label>Sort <select name="sort">
    <option value="recent"${sort === "recent" ? raw(" selected") : ""}>Recently visited</option>
    <option value="alpha"${sort === "alpha" ? raw(" selected") : ""}>Alphabetical</option>
    <option value="newest"${sort === "newest" ? raw(" selected") : ""}>Newest</option>
  </select></label>
  <label>View <select name="view"><option value="cards">Cards</option><option value="list"${view === "list" ? raw(" selected") : ""}>List</option></select></label>
  <button>Apply</button>
</form>
${canCreateProjects(c) ? html`<p><a href="/projects/new" data-button>Make a new project</a></p>` : ""}
${ps.length === 0
  ? q ? html`<p>No projects match “${q}”.</p>` : html`<p>No projects yet. Make one to get started.</p>`
  : view === "list"
    ? html`<table><thead><tr><th>Project</th><th>People</th><th>Dates</th><th></th></tr></thead><tbody>${ps.map((p) => html`<tr>
        <td><a href="${projectUrl(p)}">${p.name}</a></td><td>${p.member_names ?? ""}</td>
        <td>${p.starts_on ? html`${fmtDate(p.starts_on)} → ${fmtDate(p.ends_on)}` : ""}</td>
        <td><form method="post" action="/projects/${p.id}/pin"><button>${p.pinned ? "Unpin" : "Pin"}</button></form></td></tr>`)}</tbody></table>`
    : cards(ps)}
<p><a href="/projects/archived">Archived projects</a> · <a href="/templates">Templates</a></p>`)
    })),

  get("/projects/archived", (c) =>
    Effect.gen(function* () {
      const q = (c.query.get("q") ?? "").trim().toLowerCase()
      const ps = (yield* visibleProjects(c, { status: "archived" })).filter((p) => !q || p.name.toLowerCase().includes(q))
      return yield* render(c, "Archived projects", html`
<h1>Archived projects</h1>
<form method="get"><label>Filter by name <input type="search" name="q" value="${c.query.get("q") ?? ""}"></label> <button>Filter</button></form>
${ps.length
  ? html`<ul>${ps.map((p) => html`<li><a href="${projectUrl(p)}">${p.name}</a> ${!isClient(c.me) ? html`<form method="post" action="/projects/${p.id}/unarchive" style="display:inline"><button>Unarchive</button></form>` : ""}</li>`)}</ul>`
  : html`<p>Nothing's archived. When a project wraps up, archive it from its ••• menu. Everything in it is kept.</p>`}`, [["All projects", "/projects"]])
    })),

  get("/projects/new", (c) =>
    Effect.gen(function* () {
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const templates = yield* visibleProjects(c, { kind: "template" })
      return yield* render(c, "New project", newProjectForm(templates, c.query.get("template_id") ?? "", [], "", ""))
    })),

  post("/projects", (c) =>
    Effect.gen(function* () {
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const name = str(fd, "name")
      const templateId = Number(str(fd, "template_id")) || null
      if (!name) {
        const templates = yield* visibleProjects(c, { kind: "template" })
        return yield* render(c, "New project", newProjectForm(templates, String(templateId ?? ""), ["Your project needs a name."], name, str(fd, "description")), undefined, 422)
      }
      if (templateId) return redirect(`/templates/${templateId}/use?name=${encodeURIComponent(name)}`)
      const [p] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: c.me.account_id, name, description: str(fd, "description") || null, all_access: str(fd, "access") === "all",
        tools: JSON.stringify(defaultTools()), email_token: crypto.randomUUID().slice(0, 12), created_by: c.me.id,
      })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${p!.id}, ${c.me.id})`
      yield* logEvent(c, { project_id: p!.id, action: "created", summary: `started the project ${name}` })
      return redirect(`/projects/${p!.id}/people/setup`)
    })),

  get("/projects/:id/people/setup", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const everyone = (yield* accountPeople(c.me.account_id)).filter((x) => x.id !== c.me.id)
      return yield* render(c, "Who's on this project?", html`
<h1>Who's on ${p.name}?</h1>
<form method="post" action="/projects/${p.id}/people/setup">
  <p>Add people from ${c.account.name}:</p>
  ${everyone.length ? peopleCheckboxes("person_ids", everyone) : html`<p>Nobody else is here yet.</p>`}
  <p><label>Or invite new people by email (one per line)<br><textarea name="emails" rows="3" cols="50" placeholder="name@example.com"></textarea></label></p>
  <p><label><input type="checkbox" name="send_email" checked> Send them an email invitation</label></p>
  <p><label>Add a personal note to the invitation (optional)<br><textarea name="note" rows="2" cols="50"></textarea></label></p>
  <button>Add these people</button> <a href="${projectUrl(p)}">Skip for now</a>
</form>`, [[p.name, projectUrl(p)]])
    })),

  post("/projects/:id/people/setup", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const emails = str(fd, "emails").split(/[\s,]+/).filter(Boolean)
      const bad = emails.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      if (bad.length) return redirect(`/projects/${p.id}/people/setup`, `“${bad[0]}” doesn't look like an email address.`)
      const added = [...ids(fd, "person_ids")]
      for (const email of emails) {
        const [existing] = yield* sql<{ id: number }>`select id from people where account_id = ${c.me.account_id} and lower(email) = lower(${email})`
        if (existing) { added.push(existing.id); continue }
        const token = crypto.randomUUID()
        const [np] = yield* sql<any>`insert into people ${sql.insert({ account_id: c.me.account_id, name: email.split("@")[0]!, email, invited_by: c.me.id, invite_token: token, invited_at: new Date(), prefs: JSON.stringify({ notify_email: true }) })} returning *`
        added.push(np.id)
        if (bool(fd, "send_email"))
          yield* sendEmail(np, { subject: `${c.me.name} invited you to ${c.account.name}`, body: `${c.me.name} invited you to join ${c.account.name} on Saintsflow, to work on ${p.name}.\n\n${str(fd, "note")}`, kind: "invite", link: `/join/${token}` }, true)
      }
      for (const id of added) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      return redirect(projectUrl(p), added.length ? `Added ${added.length} ${added.length === 1 ? "person" : "people"}.` : undefined)
    })),

  get("/templates", (c) =>
    Effect.gen(function* () {
      const ts = yield* visibleProjects(c, { kind: "template" })
      return yield* render(c, "Templates", html`
<h1>Templates</h1>
${ts.length
  ? html`<ul>${ts.map((t) => html`<li><a href="/projects/${t.id}">${t.name}</a> ${t.description ? html`: ${t.description}` : ""} <a href="/templates/${t.id}/use" data-button>Use this template</a></li>`)}</ul>`
  : html`<p>Templates are projects you copy over and over. Start one from scratch, or save any project as a template from its ••• menu.</p>`}
${!isClient(c.me) ? html`<form method="post" action="/templates"><p><label>Name a new template <input name="name" required></label> <button>Make a new template</button></p></form>` : ""}`, [["Home", "/"]])
    })),

  post("/templates", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const name = str(yield* c.form, "name")
      if (!name) return redirect("/templates", "Your template needs a name.")
      const [t] = yield* sql<Project>`insert into projects ${sql.insert({ account_id: c.me.account_id, kind: "template", name, tools: JSON.stringify(defaultTools()), created_by: c.me.id })} returning *`
      yield* sql`insert into project_people (project_id, person_id) values (${t!.id}, ${c.me.id})`
      return redirect(`/projects/${t!.id}`)
    })),

  get("/templates/:id/use", (c) =>
    Effect.gen(function* () {
      const t = yield* findProject(c, c.params.id)
      if (t.kind !== "template") return redirect(projectUrl(t))
      const everyone = (yield* accountPeople(c.me.account_id)).filter((x) => x.id !== c.me.id)
      return yield* render(c, "New project from a template", useTemplateForm(t, everyone, c.query.get("name") ?? "", []), [["Templates", "/templates"], [t.name, `/projects/${t.id}`]])
    })),

  post("/templates/:id/use", (c) =>
    Effect.gen(function* () {
      if (!canCreateProjects(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const t = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const name = str(fd, "name")
      if (!name) {
        const everyone = (yield* accountPeople(c.me.account_id)).filter((x) => x.id !== c.me.id)
        return yield* render(c, "New project from a template", useTemplateForm(t, everyone, "", ["Your project needs a name."]), undefined, 422)
      }
      const p = yield* copyProject(c, t, { name, description: str(fd, "description") || t.description, kind: "project" })
      for (const id of [c.me.id, ...ids(fd, "person_ids")]) yield* sql`insert into project_people (project_id, person_id) values (${p.id}, ${id}) on conflict do nothing`
      yield* logEvent(c, { project_id: p.id, action: "created", summary: `started ${name} from the template ${t.name}` })
      return redirect(projectUrl(p), `Made ${name} from ${t.name}.`)
    })),
]

/** Copy a project and all its active recordings (not comments). Used for templates both ways. */
export const copyProject = (c: Ctx, src: Project, over: { name: string; description: string | null; kind: "project" | "template" }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Project>`insert into projects ${sql.insert({
      account_id: src.account_id, kind: over.kind, name: over.name, description: over.description, tools: JSON.stringify(src.tools),
      email_token: crypto.randomUUID().slice(0, 12), created_by: c.me.id,
    })} returning *`
    const rows = yield* sql<Recording>`select * from recordings where project_id = ${src.id} and status = 'active' and type not in ('comment','line','answer') order by id`
    const map = new Map<number, number>()
    for (const r of rows) {
      const [n] = yield* sql<{ id: number }>`insert into recordings ${sql.insert({
        account_id: r.account_id, project_id: p!.id, parent_id: r.parent_id ? map.get(r.parent_id) ?? null : null, type: r.type, title: r.title, body: r.body,
        data: JSON.stringify({ ...r.data, completed_at: null, completer_id: null }), visible_to_clients: r.visible_to_clients, creator_id: c.me.id, position: r.position,
      })} returning id`
      map.set(r.id, n!.id)
    }
    return p!
  })

const newProjectForm = (templates: ReadonlyArray<Project>, templateId: string, errs: string[], name: string, description: string): Raw => html`
<h1>Make a new project</h1>
${errors(errs)}
<form method="post" action="/projects">
  <p><label>Name this project<br><input name="name" value="${name}" required autofocus></label></p>
  <p><label>Add a description or a short note (optional)<br><textarea name="description" rows="3" cols="60">${description}</textarea></label></p>
  ${templates.length ? html`<p><label>Start from a template<br><select name="template_id"><option value="">No template, start blank</option>
    ${templates.map((t) => html`<option value="${t.id}"${String(t.id) === templateId ? raw(" selected") : ""}>${t.name}</option>`)}</select></label></p>` : ""}
  <fieldset><legend>Who can see it?</legend>
    <label><input type="radio" name="access" value="invited" checked> Just the people I invite</label><br>
    <label><input type="radio" name="access" value="all"> Everyone at the company can see it (all-access)</label>
  </fieldset>
  <p><button>Create project</button> <a href="/">Cancel</a></p>
</form>`

const useTemplateForm = (t: Project, everyone: ReadonlyArray<any>, name: string, errs: string[]) => html`
<h1>New project from “${t.name}”</h1>
<p>We'll copy everything in the template into a brand-new project.</p>
${errors(errs)}
<form method="post" action="/templates/${t.id}/use">
  <p><label>Project name<br><input name="name" value="${name}" required></label></p>
  <p><label>Description<br><textarea name="description" rows="3" cols="60">${t.description ?? ""}</textarea></label></p>
  <p>Who's on this project?</p>
  ${peopleCheckboxes("person_ids", everyone)}
  <p><button>Create project</button> <a href="/templates">Cancel</a></p>
</form>`
