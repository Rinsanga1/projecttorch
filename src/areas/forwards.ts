// Forwarded emails & links: the forwards list, a forwarded email, add a link, a link, edit a link.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, fmt, fmtDate, excerpt, type Raw } from "../lib/html.ts"
import { get, post, redirect, render, str, errors, isClient, NoAccess, type Ctx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, projectUrl, toolUrl, urlFor,
  clientSwitch, textField, textArea, clientFilter, trackVisit, byLine, personById,
  type Project, type Recording,
} from "../lib/core.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import type { Seed } from "../seed.ts"
import { kit, pageHead, sx } from "../lib/ui.ts"
import { color, font, radius, space, text } from "../lib/tokens.stylex.ts"

// The forwarding address in a tile, ready to copy; forwards as rows.
const fw = stylex.create({
  address: { display: "grid", gap: space.s2, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile, marginBottom: space.s5 },
  addressText: { margin: 0 },
  addressInput: { width: "min(100%, 34rem)", fontFamily: font.mono, fontSize: text.sm, backgroundColor: color.sheet },
})


const address = (p: Project) => (p.email_token ? `${p.email_token}@forwards.saintsflow.test` : null)

const isLink = (u: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(u)

const forwardForm = (p: Project, v: { from: string; title: string; body: string }, errs: string[]) => html`
<h2>Simulate forwarding an email</h2>
<p><small>There's no mail server yet, so paste an email here to see what forwarding does.</small></p>
${errors(errs)}
<form method="post" action="/projects/${p.id}/forwards">
  ${textField("From", "from", v.from, { required: true, placeholder: "someone@example.com", type: "email" })}
  ${textField("Subject", "title", v.title, { required: true })}
  ${textArea("Email", "body", v.body)}
  <button>Forward it into ${p.name}</button>
</form>`

const doorForm = (p: Project, people: ReadonlyArray<any>, d: { id?: number; title: string; url: string; description: string; visible_to_clients?: boolean }, errs: string[]): Raw => html`
<h1>${d.id ? "Edit link" : "Add a link"}</h1>
<p>Link this project to another tool, like Figma, GitHub, or a Google Drive folder.</p>
${errors(errs)}
<form method="post" action="${d.id ? `/projects/${p.id}/links/${d.id}/edit` : `/projects/${p.id}/links`}">
  ${textField("URL", "url", d.url, { required: true, placeholder: "https://", type: "url" })}
  ${textField("Name", "title", d.title, { required: true, placeholder: "Figma mockups" })}
  ${textField("Short description (optional)", "description", d.description)}
  ${clientSwitch(p, people, d.visible_to_clients)}
  <p><button>${d.id ? "Save changes" : "Add this link"}</button> <a href="${d.id ? `/projects/${p.id}/links/${d.id}` : projectUrl(p)}">Cancel</a></p>
</form>`

const doorErrors = (d: { title: string; url: string }) => [
  ...(isLink(d.url) ? [] : ["That doesn't look like a link."]),
  ...(d.title ? [] : ["Your link needs a name."]),
]

const forwardsPage = (c: Ctx, p: Project, form: Raw) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const fws = yield* sql<Recording & { comments: number }>`
      select r.*, (select count(*) from recordings x where x.parent_id = r.id and x.type = 'comment' and x.status = 'active')::int as comments
      from recordings r where r.project_id = ${p.id} and r.type = 'forward' and r.status = 'active' ${clientFilter(sql, c.me, "r")}
      order by r.created_at desc`
    const addr = address(p)
    return html`
${pageHead("Forwarded emails")}
<div${sx(fw.address)}>
${fws.length === 0 ? html`<p${sx(fw.addressText)}>Forward emails to this project so everyone can see them and talk about them. Send them to:</p>` : html`<p${sx(fw.addressText)}>This project's address:</p>`}
${addr ? html`<p${sx(fw.addressText)}><input readonly size="50" value="${addr}" onclick="this.select()" aria-label="Forwarding address"${sx(fw.addressInput)}></p>` : html`<p${sx(fw.addressText)}>This project doesn't have a forwarding address.</p>`}
</div>
${fws.length ? html`<ul${sx(kit.rows)}>${fws.map((f) => html`<li>
  <a href="${urlFor(f)}"${sx(kit.rowTitle)}>${f.title}</a>
  <span${sx(kit.rowMeta)}>From ${f.data.from} · ${fmtDate(f.created_at, c.me.time_zone)}${f.comments ? ` · ${f.comments} comment${f.comments === 1 ? "" : "s"}` : ""}</span>
  <p${sx(kit.rowText)}>${excerpt(f.body)}</p></li>`)}</ul>` : ""}
${p.status === "active" && !isClient(c.me) ? form : ""}`
  })

export const routes = [
  get("/projects/:id/forwards", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      yield* trackVisit(c, toolUrl(p, "forwards"), `${p.name}: Forwarded emails`, p.id)
      return yield* render(c, "Forwarded emails", yield* forwardsPage(c, p, forwardForm(p, { from: "", title: "", body: "" }, [])), projectCrumbs(p))
    })),

  // ponytail: no inbound mail server. This form stands in for mail arriving at the project's address; wire an inbound webhook (Postmark/SES) to the same createRecording call later.
  post("/projects/:id/forwards", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const v = { from: str(fd, "from"), title: str(fd, "title"), body: str(fd, "body") }
      const errs = [...(v.from.includes("@") ? [] : ["Who's the email from? Add their address."]), ...(v.title ? [] : ["Give the email a subject."])]
      if (errs.length) return yield* render(c, "Forwarded emails", yield* forwardsPage(c, p, forwardForm(p, v, errs)), projectCrumbs(p), 422)
      const r = yield* createRecording(c, {
        project: p, type: "forward", title: v.title, body: v.body,
        data: { from: v.from, to: address(p), original_subject: v.title }, verb: "forwarded an email",
      })
      return redirect(urlFor(r), "Forwarded into the project.")
    })),

  get("/projects/:id/forwards/:fid", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.fid, "forward")
      const people = yield* projectPeople(project)
      const by = r.creator_id ? yield* personById(r.creator_id) : null
      yield* trackVisit(c, urlFor(r), r.title, project.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  <h1>${r.title}</h1>
  <p><small>Forwarded by</small></p>
  ${byLine(by, r.created_at, c.me.time_zone)}
  <dl>
    <dt>From</dt><dd>${r.data.from}</dd>
    <dt>To</dt><dd>${r.data.to ?? ""}</dd>
    <dt>Subject</dt><dd>${r.data.original_subject ?? r.title}</dd>
  </dl>
  <div>${fmt(r.body)}</div>
</article>
${yield* itemFooter(c, r, project)}`, projectCrumbs(project, "forwards"))
    })),

  // Links (type "door")
  get("/projects/:id/links/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "Add a link", doorForm(p, yield* projectPeople(p), { title: "", url: "", description: "" }, []), projectCrumbs(p))
    })),

  post("/projects/:id/links", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const d = { title: str(fd, "title"), url: str(fd, "url"), description: str(fd, "description"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      const errs = doorErrors(d)
      if (errs.length) return yield* render(c, "Add a link", doorForm(p, people, d, errs), projectCrumbs(p), 422)
      yield* createRecording(c, { project: p, type: "door", title: d.title, data: { url: d.url, description: d.description }, visible_to_clients: d.visible_to_clients, verb: "added a link" })
      return redirect(projectUrl(p), `Added the ${d.title} link.`)
    })),

  get("/projects/:id/links/:did", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.did, "door")
      const people = yield* projectPeople(project)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<h1>${r.title}</h1>
${r.data.description ? html`<p>${r.data.description}</p>` : ""}
<p><a href="${r.data.url}" target="_blank" rel="noopener">Open ${r.title}</a> <small>(${r.data.url}, opens in a new tab)</small></p>
${!isClient(c.me) && r.status === "active" ? html`<p><a href="/projects/${project.id}/links/${r.id}/edit">Edit</a> · <a href="/r/${r.id}/trash">Remove</a></p>` : ""}
${yield* itemFooter(c, r, project, { comments: false })}`, [[project.name, projectUrl(project)]])
    })),

  get("/projects/:id/links/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.did, "door")
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "Edit link", doorForm(project, yield* projectPeople(project), { id: r.id, title: r.title, url: r.data.url, description: r.data.description ?? "", visible_to_clients: r.visible_to_clients }, []), [[project.name, projectUrl(project)]])
    })),

  post("/projects/:id/links/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.did, "door")
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const d = { id: r.id, title: str(fd, "title"), url: str(fd, "url"), description: str(fd, "description"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      const errs = doorErrors(d)
      if (errs.length) return yield* render(c, "Edit link", doorForm(project, yield* projectPeople(project), d, errs), [[project.name, projectUrl(project)]], 422)
      yield* updateRecording(c, r, { title: d.title, data: { url: d.url, description: d.description }, visible_to_clients: d.visible_to_clients })
      return redirect(`/projects/${project.id}/links/${r.id}`, "Saved.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const { maya, bob, dan } = s.people
    const p = s.projects.website
    yield* createRecording(s.as(maya), {
      project: p, type: "forward", title: "Fwd: Brand guidelines PDF",
      body: "Hi Maya,\n\nAttached are our brand guidelines. Logo files to follow.\n\nDan",
      data: { from: dan.email, to: `${p.email_token}@forwards.saintsflow.test`, original_subject: "Brand guidelines PDF" }, verb: "forwarded an email",
    })
    yield* createRecording(s.as(maya), { project: p, type: "door", title: "Figma mockups", data: { url: "https://www.figma.com/", description: "Ann's homepage designs" }, visible_to_clients: true, verb: "added a link" })
    yield* createRecording(s.as(bob), { project: p, type: "door", title: "GitHub repo", data: { url: "https://github.com/", description: "The site's code" }, verb: "added a link" })
  })
