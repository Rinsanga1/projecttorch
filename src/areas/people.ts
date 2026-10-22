// People & clients: the directory, someone's profile, invite people, pending invitations,
// client access for a project, and what a client sees.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDate, fmtDateTime, plural, type Raw } from "../lib/html.ts"
import { get, post, redirect, render, str, ids, bool, errors, isAdmin, isClient, isOutOfOffice, NoAccess, NotFound, type Ctx, type Person } from "../lib/web.ts"
import {
  findProject, projectPeople, visibleProjects, canInvite, sendEmail, projectUrl, toolUrl, urlFor, titleOf, TYPE_NAMES, TYPE_TOOL, logEvent,
  type Project, type Recording,
} from "../lib/core.ts"
import type { Seed } from "../seed.ts"
import { face, kit, sx } from "../lib/ui.ts"
import { color, radius, space, text } from "../lib/tokens.stylex.ts"

// The client preview: each tool a tile listing what a client would find in it; the people they'd see by face.
const pv = stylex.create({
  intro: { color: color.muted },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  tool: { borderTopWidth: 0, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile, display: "grid", gap: space.s2, alignContent: "start" },
  toolName: { fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none", ":hover": { textDecoration: "underline" } },
  items: { margin: 0 },
  item: { display: "flex", alignItems: "baseline", gap: space.s2, paddingBlock: space.s2 },
  tag: { flexShrink: 0, backgroundColor: color.sheet },
  none: { margin: 0, fontSize: text.sm, color: color.muted },
  people: { display: "flex", flexWrap: "wrap", gap: space.s2, margin: 0, marginBottom: space.s5 },
  person: { display: "inline-flex", alignItems: "center", gap: space.s2, borderTopWidth: 0, paddingBlock: 4, paddingLeft: 4, paddingRight: 14,
    borderRadius: radius.pill, backgroundColor: color.tile, fontSize: text.sm },
})

type Company = { id: number; name: string }

const companies = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Company>`select id, name from companies where account_id = ${c.me.account_id} order by name`
  })

/** Clients only see people they share a project with, or people at their own company. */
const canSeePerson = (c: Ctx, p: Person) =>
  Effect.gen(function* () {
    if (p.account_id !== c.me.account_id) return false
    if (!isClient(c.me) || p.id === c.me.id || (p.company_id && p.company_id === c.me.company_id)) return true
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql`select 1 from project_people a join project_people b on a.project_id = b.project_id
      where a.person_id = ${c.me.id} and b.person_id = ${p.id} limit 1`
    return !!row
  })

const localTime = (tz: string) => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })

type InviteValues = { who: string; name: string; email: string; title: string; company_id: string; new_company: string; project_ids: number[]; note: string }

const inviteForm = (c: Ctx, cos: ReadonlyArray<Company>, projects: ReadonlyArray<Project>, v: InviteValues, errs: ReadonlyArray<Raw | string>) => html`
<h1>Invite people</h1>
${errs.length ? html`<div role="alert"><p><b>Please fix:</b></p><ul>${errs.map((e) => html`<li>${e}</li>`)}</ul></div>` : ""}
<form method="post" action="/people/invite">
  <fieldset><legend>Who</legend>
    <label><input type="radio" name="who" value="staff"${v.who !== "client" ? raw(" checked") : ""}> Someone at ${c.account.name}</label><br>
    <label><input type="radio" name="who" value="client"${v.who === "client" ? raw(" checked") : ""}> A client</label>
  </fieldset>
  <p><label>Name<br><input name="name" value="${v.name}" required></label></p>
  <p><label>Email<br><input type="email" name="email" value="${v.email}" required></label></p>
  <p><label>Title (optional)<br><input name="title" value="${v.title}"></label></p>
  <p><label>Company<br><select name="company_id">
    <option value="">Pick a company…</option>
    ${cos.map((k) => html`<option value="${k.id}"${String(k.id) === v.company_id ? raw(" selected") : ""}>${k.name}</option>`)}
  </select></label>
  <label>or a new company: <input name="new_company" value="${v.new_company}"></label></p>
  ${projects.length ? html`<fieldset><legend>Add them to these projects</legend>
    ${projects.map((p) => html`<label><input type="checkbox" name="project_ids" value="${p.id}"${v.project_ids.includes(p.id) ? raw(" checked") : ""}> ${p.name}</label><br>`)}
  </fieldset>` : ""}
  <p><label>Add a personal note (optional)<br><textarea name="note" rows="3" cols="60">${v.note}</textarea></label></p>
  <p><button>Send invitation</button> <a href="/people">Cancel</a></p>
</form>
<p><a href="/people/pending">Pending invitations</a></p>`

/** Send (or resend) the invitation email. */
const sendInvite = (c: Ctx, p: Person, note: string, projectNames: ReadonlyArray<string>) =>
  sendEmail(p, {
    subject: `${c.me.name} invited you to ${c.account.name}'s Saintsflow`,
    body: `${c.me.name} invited you to join ${c.account.name} on Saintsflow${projectNames.length ? `, to work on ${projectNames.join(", ")}` : ""}.${note ? `\n\n“${note}”` : ""}\n\nAccept the invitation to set up your login.`,
    kind: "invite",
    link: `/join/${p.invite_token}`,
  }, true)

export const routes = [
  get("/people", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const q = (c.query.get("q") ?? "").trim().toLowerCase()
      const everyone = yield* sql<Person & { company_name: string | null }>`
        select p.*, k.name as company_name from people p left join companies k on k.id = p.company_id
        where p.account_id = ${c.me.account_id} and p.removed_at is null and p.joined_at is not null order by k.name nulls first, p.name`
      const visible: typeof everyone[number][] = []
      for (const p of everyone) if ((yield* canSeePerson(c, p)) && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q))) visible.push(p)
      const groups = new Map<string, typeof visible>()
      for (const p of visible) groups.set(p.company_name ?? c.account.name, [...(groups.get(p.company_name ?? c.account.name) ?? []), p])
      return yield* render(c, `Everyone at ${c.account.name}`, html`
<h1>Everyone at ${c.account.name}</h1>
<form method="get"><label>Filter by name <input type="search" name="q" value="${c.query.get("q") ?? ""}"></label> <button>Filter</button></form>
${canInvite(c) ? html`<p><a href="/people/invite" data-button>Invite people</a> <a href="/people/pending">Pending invitations</a></p>` : ""}
${visible.length
  ? html`${[...groups].map(([company, ps]) => html`<h2>${company}</h2><ul>${ps.map((p) => html`<li><a href="/people/${p.id}">${p.name}</a>${p.title ? html`, ${p.title}` : ""}${p.role !== "member" ? ` (${p.role})` : ""}${isOutOfOffice(p) ? " · out of office" : ""}</li>`)}</ul>`)}`
  : html`<p>${q ? `Nobody matches “${q}”.` : "Nobody's here yet."}</p>`}`)
    })),

  get("/people/invite", (c) =>
    Effect.gen(function* () {
      if (!canInvite(c)) return yield* new NoAccess()
      const cos = yield* companies(c)
      const projects = yield* visibleProjects(c)
      const client = c.query.get("client") === "1"
      const projectId = Number(c.query.get("project_id")) || 0
      const clientCompany = cos.find((k) => k.name !== c.account.name)
      return yield* render(c, "Invite people", inviteForm(c, cos, projects, {
        who: client ? "client" : "staff", name: "", email: "", title: "", new_company: "", note: "",
        company_id: String(client ? clientCompany?.id ?? "" : cos.find((k) => k.name === c.account.name)?.id ?? ""),
        project_ids: projectId ? [projectId] : [],
      }, []), [["Everyone", "/people"]])
    })),

  post("/people/invite", (c) =>
    Effect.gen(function* () {
      if (!canInvite(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const cos = yield* companies(c)
      const projects = yield* visibleProjects(c)
      const v: InviteValues = {
        who: str(fd, "who") === "client" ? "client" : "staff", name: str(fd, "name"), email: str(fd, "email").toLowerCase(), title: str(fd, "title"),
        company_id: str(fd, "company_id"), new_company: str(fd, "new_company"), note: str(fd, "note"),
        project_ids: ids(fd, "project_ids").filter((id) => projects.some((p) => p.id === id)),
      }
      const errs: (Raw | string)[] = []
      if (!v.name) errs.push("Add their name.")
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.push("That doesn't look like an email address.")
      if (v.who === "client" && !v.company_id && !v.new_company) errs.push("Pick or name the client's company.")
      const [existing] = yield* sql<Person>`select * from people where account_id = ${c.me.account_id} and lower(email) = ${v.email}`
      if (existing && !existing.removed_at)
        errs.push(existing.joined_at
          ? html`${v.email} is already in this account. <a href="/people/${existing.id}">See ${existing.name}'s profile</a>`
          : html`${v.email} was already invited. <a href="/people/pending">Resend the invitation</a>`)
      if (errs.length) return yield* render(c, "Invite people", inviteForm(c, cos, projects, v, errs), [["Everyone", "/people"]], 422)

      let companyId = Number(v.company_id) || null
      if (companyId && !cos.some((k) => k.id === companyId)) companyId = null
      if (v.new_company) {
        const same = cos.find((k) => k.name.toLowerCase() === v.new_company.toLowerCase())
        companyId = same?.id ?? (yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: c.me.account_id, name: v.new_company })} returning id`)[0]!.id
      }
      const fields = {
        name: v.name, title: v.title || null, company_id: companyId, role: v.who === "client" ? "client" : "member",
        invited_by: c.me.id, invite_token: crypto.randomUUID(), invited_at: new Date(), joined_at: null, removed_at: null,
      }
      // A removed person coming back gets their old row (email is unique per account).
      const [p] = existing
        ? yield* sql<Person>`update people set ${sql.update(fields)} where id = ${existing.id} returning *`
        : yield* sql<Person>`insert into people ${sql.insert({ ...fields, account_id: c.me.account_id, email: v.email, prefs: JSON.stringify({ notify_email: true }) })} returning *`
      for (const pid of v.project_ids) yield* sql`insert into project_people (project_id, person_id) values (${pid}, ${p!.id}) on conflict do nothing`
      yield* sendInvite(c, p!, v.note, projects.filter((x) => v.project_ids.includes(x.id)).map((x) => x.name))
      yield* logEvent(c, { project_id: v.project_ids[0] ?? null, action: "invited", summary: `invited ${v.name}${v.who === "client" ? " (client)" : ""}` })
      return redirect("/people/pending",
        { msg: `Invitation sent to ${v.email}.`, href: "/inbox", label: "See the email" })
    })),

  get("/people/pending", (c) =>
    Effect.gen(function* () {
      if (!canInvite(c)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const pending = yield* sql<Person & { inviter: string | null }>`
        select p.*, i.name as inviter from people p left join people i on i.id = p.invited_by
        where p.account_id = ${c.me.account_id} and p.joined_at is null and p.removed_at is null order by p.invited_at desc nulls last`
      return yield* render(c, "Pending invitations", html`
<h1>Pending invitations</h1>
${pending.length
  ? html`<ul>${pending.map((p) => html`<li>${p.name} &lt;${p.email}&gt;${p.role === "client" ? " (client)" : ""}
    <small>invited by ${p.inviter ?? "someone"} ${p.invited_at ? fmtDateTime(p.invited_at, c.me.time_zone) : ""}</small>
    ${isAdmin(c.me) || p.invited_by === c.me.id ? html`
    <form method="post" action="/people/pending/${p.id}/resend" style="display:inline"><button>Resend</button></form>
    <form method="post" action="/people/pending/${p.id}/cancel" style="display:inline"><button>Cancel invitation</button></form>` : ""}</li>`)}</ul>`
  : html`<p>No pending invitations.</p>`}
<p><a href="/people/invite">Invite people</a></p>`, [["Everyone", "/people"]])
    })),

  post("/people/pending/:pid/resend", (c) =>
    Effect.gen(function* () {
      const p = yield* pendingInvite(c)
      const sql = yield* SqlClient.SqlClient
      const [u] = yield* sql<Person>`update people set invited_at = now() where id = ${p.id} returning *`
      yield* sendInvite(c, u!, "", [])
      return redirect("/people/pending", { msg: `Invitation resent to ${p.email}.`, href: "/inbox", label: "See the email" })
    })),

  post("/people/pending/:pid/cancel", (c) =>
    Effect.gen(function* () {
      const p = yield* pendingInvite(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from people where id = ${p.id} and joined_at is null`
      return redirect("/people/pending", `Cancelled the invitation for ${p.email}.`)
    })),

  get("/people/:id", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [p] = yield* sql<Person & { company_name: string | null }>`
        select p.*, k.name as company_name from people p left join companies k on k.id = p.company_id where p.id = ${Number(c.params.id) || 0}`
      if (!p || p.account_id !== c.me.account_id || p.removed_at || !p.joined_at) return yield* new NotFound()
      if (!(yield* canSeePerson(c, p))) return yield* new NoAccess()
      const memberOf = new Set((yield* sql<{ project_id: number }>`select project_id from project_people where person_id = ${p.id}`).map((r) => r.project_id))
      const shared = (yield* visibleProjects(c)).filter((x) => memberOf.has(x.id) || (x.all_access && !isClient(p)))
      const self = p.id === c.me.id
      const ooo = isOutOfOffice(p) ? p.prefs.ooo! : null
      const first = p.name.split(" ")[0]
      return yield* render(c, p.name, html`
${p.avatar_url ? html`<p><img src="${p.avatar_url}" alt="" width="96" height="96"></p>` : ""}
<h1>${p.name}</h1>
<p>${p.title ? html`${p.title}, ` : ""}${p.company_name ?? c.account.name}${p.role !== "member" ? ` (${p.role})` : ""}</p>
${ooo ? html`<p role="note"><b>${first} is out of office until ${fmtDate(ooo.until)}.</b>${ooo.message ? html` ${ooo.message}` : ""}</p>` : ""}
${p.bio ? html`<div>${fmt(p.bio)}</div>` : ""}
<p>${p.location ? html`${p.location} · ` : ""}It's ${localTime(p.time_zone)} there (${p.time_zone}).</p>
<p>Email: ${p.email}</p>
<ul>
  ${!self ? html`<li><a href="/chats/new?with=${p.id}">Message ${first}</a></li>` : ""}
  ${!isClient(c.me) ? html`<li><a href="/reports/assignments?person=${p.id}">What's on ${self ? "your" : `${first}'s`} plate?</a></li>
  <li><a href="/reports/activity?person=${p.id}">${self ? "What have you been up to?" : `What's ${first} been up to?`}</a></li>` : ""}
  ${self ? html`<li><a href="/my/profile">Edit your profile</a></li>` : isAdmin(c.me) ? html`<li><a href="/admin/people/${p.id}">Edit in Admin</a></li>` : ""}
</ul>
<h2>Projects</h2>
${shared.length ? html`<ul>${shared.map((x) => html`<li><a href="${projectUrl(x)}">${x.name}</a></li>`)}</ul>` : html`<p>No projects you're both on.</p>`}`, [["Everyone", "/people"]])
    })),

  // Client access for a project
  get("/projects/:id/clients", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const clients = (yield* projectPeople(p)).filter(isClient)
      return yield* render(c, "Client access", html`
<h1>Client access for ${p.name}</h1>
<p>Clients only see things you specifically show them. Everything else stays between your team.</p>
<h2>Clients on this project</h2>
${clients.length
  ? html`<ul>${clients.map((x) => html`<li><a href="/people/${x.id}">${x.name}</a>${x.company_name ? html` <small>(${x.company_name})</small>` : ""}
    <form method="post" action="/projects/${p.id}/clients/${x.id}/remove" style="display:inline"><button>Remove from project</button></form></li>`)}</ul>`
  : html`<p>No clients on this project yet.</p>`}
${canInvite(c) ? html`<p><a href="/people/invite?project_id=${p.id}&client=1">Invite clients</a></p>` : ""}
<form method="post" action="/projects/${p.id}/clients">
  <fieldset><legend>When someone posts something new…</legend>
    <label><input type="radio" name="see_new" value="hidden"${!p.clients_see_new ? raw(" checked") : ""}> Clients can't see it until someone shows it to them</label><br>
    <label><input type="radio" name="see_new" value="visible"${p.clients_see_new ? raw(" checked") : ""}> Clients see it right away</label>
  </fieldset>
  <p><button>Save</button> <a href="${projectUrl(p)}">Cancel</a></p>
</form>
<p><a href="/projects/${p.id}/clients/preview">What will clients see?</a></p>`, [[p.name, projectUrl(p)]])
    })),

  post("/projects/:id/clients", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const visible = str(yield* c.form, "see_new") === "visible"
      yield* sql`update projects set clients_see_new = ${visible} where id = ${p.id}`
      return redirect(projectUrl(p), visible ? "New things will be visible to clients." : "New things start out hidden from clients.")
    })),

  post("/projects/:id/clients/:pid/remove", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const [x] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id} and role = 'client'`
      if (!x) return yield* new NotFound()
      yield* sql`delete from project_people where project_id = ${p.id} and person_id = ${x.id}`
      return redirect(`/projects/${p.id}/clients`, `${x.name} isn't on ${p.name} anymore.`)
    })),

  get("/projects/:id/clients/preview", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<Recording>`select * from recordings where project_id = ${p.id} and status = 'active' order by type, position, id`
      // A client sees an item only if it and every ancestor is visible (as clientVisible() in core).
      const byId = new Map(rows.map((r) => [r.id, r]))
      const passes = (r: Recording) => r.visible_to_clients || ["comment", "line", "step", "todogroup", "answer", "column"].includes(r.type)
      const seen = (r: Recording): boolean => passes(r) && (!r.parent_id || (byId.has(r.parent_id) && seen(byId.get(r.parent_id)!)))
      const shown = rows.filter((r) => !["comment", "line", "step", "todogroup", "answer", "column"].includes(r.type) && seen(r))
      const people = (yield* sql<Person>`select pe.* from project_people pp join people pe on pe.id = pp.person_id
        where pp.project_id = ${p.id} and pe.removed_at is null and pe.joined_at is not null order by pe.name`)
      const tools = p.tools.filter((t) => t.enabled && t.type !== "timesheet")
      return yield* render(c, "What a client sees", html`
<h1>What a client sees on ${p.name}</h1>
<p${sx(pv.intro)}>The same project, filtered. Clients only see tools and items marked visible to them.</p>
<h2>Tools</h2>
<ul${sx(pv.grid)}>${tools.map((t) => {
  const items = shown.filter((r) => TYPE_TOOL[r.type] === t.type)
  return html`<li${sx(pv.tool)}><a href="${toolUrl(p, t.type)}"${sx(pv.toolName)}>${t.name}</a>${items.length
    ? html`<ul${sx(pv.items)}>${items.map((r) => html`<li${sx(pv.item)}><span${sx(kit.tag, pv.tag)}>${TYPE_NAMES[r.type]}</span> <a href="${urlFor(r)}">${titleOf(r)}</a></li>`)}</ul>`
    : html`<p${sx(pv.none)}>Nothing visible yet</p>`}</li>`
})}</ul>
<h2>People they'd see</h2>
<ul${sx(pv.people)}>${people.map((x) => html`<li${sx(pv.person)}>${face(x, 24)}${x.name}${isClient(x) ? " (client)" : ""}</li>`)}</ul>
<h2>Also</h2>
<ul>
  <li>A simpler menu: no Admin and no company-wide reports.</li>
  <li>${c.account.settings.clients_can_ping ? "They can start a private chat with anyone at your company." : "They can only start private chats with people on their projects, unless an admin changes this."} ${isAdmin(c.me) ? html`<a href="/admin/permissions">Change</a>` : ""}</li>
</ul>
<p${sx(kit.links)}><a href="/projects/${p.id}/clients">Back to client access</a></p>`, [[p.name, projectUrl(p)]])
    })),
]

/** A never-joined person the current person may resend or cancel. */
const pendingInvite = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where id = ${Number(c.params.pid) || 0} and account_id = ${c.me.account_id} and joined_at is null and removed_at is null`
    if (!p) return yield* new NotFound()
    if (!canInvite(c) || !(isAdmin(c.me) || p.invited_by === c.me.id)) return yield* new NoAccess()
    return p
  })

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [eve] = yield* sql<Person>`insert into people ${sql.insert({
      account_id: s.account.id, name: "Eve Park", email: "eve@acme.test", title: "Writer", role: "member",
      invited_by: s.people.maya.id, invite_token: "demo-invite-token", invited_at: new Date(Date.now() - 2 * 86400_000),
      prefs: JSON.stringify({ notify_email: true }), company_id: s.people.maya.company_id,
    })} returning *`
    yield* sql`insert into project_people (project_id, person_id) values (${s.projects.marketing.id}, ${eve!.id})`
    yield* sql`insert into emails ${sql.insert({
      to_email: eve!.email, subject: `Maya Ortiz invited you to Acme's Saintsflow`, kind: "invite", link: "/join/demo-invite-token",
      body: "Maya Ortiz invited you to join Acme on Saintsflow, to work on Marketing Plan.\n\nAccept the invitation to set up your login.",
    })}`
  })
