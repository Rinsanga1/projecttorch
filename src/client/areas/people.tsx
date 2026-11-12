// People & clients: the directory, someone's profile, invite people, pending invitations,
// client access for a project, and what a client sees. Posts: src/areas/people.ts.
import * as stylex from "@stylexjs/stylex"
import { Fragment, useState } from "react"
import { observer } from "mobx-react-lite"
import { useParams, useSearchParams, Form as GetForm } from "react-router"
import { db } from "../store.ts"
import {
  me, account, accountPeople, findProject, projectPeople, visibleProjects, memberIds, canInvite, recordings, personById,
  NoAccess, NotFound, type PersonWithCompany,
} from "../data.ts"
import { isAdmin, isClient, isOutOfOffice, projectUrl, windowUrl, urlFor, titleOf, TYPE_NAMES, TYPE_TOOL, CLIENT_INHERITS, type Person, type Recording } from "../../shared/domain.ts"
import { fmtDate, fmtDateTime } from "../../shared/format.ts"
import { Form } from "../ui/forms.tsx"
import { Face, Fmt, kit, sx } from "../ui/kit.tsx"
import { Page, page } from "../ui/page.tsx"
import { color, radius, space, text } from "../ui/tokens.stylex.ts"

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

const companies = () => [...db.companies.values()].filter((k) => k.account_id === me().account_id).sort((a, b) => a.name.localeCompare(b.name))

/** Clients only see people they share a project with, or people at their own company. */
const canSeePerson = (m: Person, p: Person) => {
  if (p.account_id !== m.account_id) return false
  if (!isClient(m) || p.id === m.id || (p.company_id && p.company_id === m.company_id)) return true
  const mine = new Set([...db.project_people.values()].filter((pp) => pp.person_id === m.id).map((pp) => pp.project_id))
  return [...db.project_people.values()].some((pp) => pp.person_id === p.id && mine.has(pp.project_id))
}

/** The team link, after Campfire: anyone with it joins as a member. Clients still come in by invitation. */
export const TeamLink = observer(() => {
  const a = account()
  const [copied, setCopied] = useState(false)
  if (!a.join_code || !canInvite()) return null
  const url = `${location.origin}/join/${a.join_code}`
  return (
    <section aria-labelledby="team-link">
      <h2 id="team-link">Invite your team with a link</h2>
      <p>Anyone with this link can join {a.name} and see every all-access project. Clients still need an invitation.</p>
      <p><input readOnly size={60} value={url} aria-labelledby="team-link" onClick={(e) => e.currentTarget.select()} />{" "}
        <button type="button" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {})}>{copied ? "Copied" : "Copy"}</button>{" "}
        {"share" in navigator && <button type="button" onClick={() => navigator.share({ title: `Join ${a.name} on ProjectTorch`, url }).catch(() => {})}>Share</button>}</p>
      {isAdmin(me()) && <Form action="/people/join-link"><p><button data-quiet>Make a new link</button> The old one stops working.</p></Form>}
    </section>
  )
})

const localTime = (tz: string) => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })

export const routes = [
  page("/people", () => {
    const [query] = useSearchParams()
    const m = me()
    const a = account()
    const q = (query.get("q") ?? "").trim().toLowerCase()
    const visible = accountPeople().filter((p) => canSeePerson(m, p) && (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)))
    const groups = new Map<string, PersonWithCompany[]>()
    for (const p of visible) groups.set(p.company_name ?? a.name, [...(groups.get(p.company_name ?? a.name) ?? []), p])
    return (
      <Page title={`Everyone at ${a.name}`}>
        <h1>Everyone at {a.name}</h1>
        <GetForm method="get"><label>Filter by name <input type="search" name="q" defaultValue={query.get("q") ?? ""} /></label> <button>Filter</button></GetForm>
        {canInvite() && <p><a href="/people/invite" data-button>Invite people</a> <a href="/people/pending">Pending invitations</a></p>}
        {visible.length
          ? [...groups].map(([company, ps]) => (
            <Fragment key={company}>
              <h2>{company}</h2>
              <ul>{ps.map((p) => <li key={p.id}><a href={`/people/${p.id}`}>{p.name}</a>{p.title && `, ${p.title}`}{p.role !== "member" ? ` (${p.role})` : ""}{isOutOfOffice(p) ? " · out of office" : ""}</li>)}</ul>
            </Fragment>
          ))
          : <p>{q ? `Nobody matches “${q}”.` : "Nobody's here yet."}</p>}
        <TeamLink />
      </Page>
    )
  }),

  page("/people/invite", () => {
    const [q] = useSearchParams()
    if (!canInvite()) throw new NoAccess()
    const a = account()
    const cos = companies()
    const projects = visibleProjects()
    const client = q.get("client") === "1"
    const projectId = Number(q.get("project_id")) || 0
    const clientCompany = cos.find((k) => k.name !== a.name)
    const companyId = String(client ? clientCompany?.id ?? "" : cos.find((k) => k.name === a.name)?.id ?? "")
    return (
      <Page title="Invite people" crumbs={[["Everyone", "/people"]]}>
        <h1>Invite people</h1>
        {!client && <><TeamLink /><h2>Or invite someone by email</h2></>}
        <Form action="/people/invite" key={q.toString()}>
          <fieldset><legend>Who</legend>
            <label><input type="radio" name="who" value="staff" defaultChecked={!client} /> Someone at {a.name}</label><br />
            <label><input type="radio" name="who" value="client" defaultChecked={client} /> A client</label>
          </fieldset>
          <p><label>Name<br /><input name="name" required /></label></p>
          <p><label>Email<br /><input type="email" name="email" required /></label></p>
          <p><label>Title (optional)<br /><input name="title" /></label></p>
          <p>
            <label>Company<br /><select name="company_id" defaultValue={companyId}>
              <option value="">Pick a company…</option>
              {cos.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></label>{" "}
            <label>or a new company: <input name="new_company" /></label>
          </p>
          {projects.length > 0 && (
            <fieldset><legend>Add them to these projects</legend>
              {projects.map((p) => <span key={p.id}><label><input type="checkbox" name="project_ids" value={p.id} defaultChecked={p.id === projectId} /> {p.name}</label><br /></span>)}
            </fieldset>
          )}
          <p><label>Add a personal note (optional)<br /><textarea name="note" rows={3} cols={60} /></label></p>
          <p><button>Send invitation</button> <a href="/people">Cancel</a></p>
        </Form>
        <p><a href="/people/pending">Pending invitations</a></p>
      </Page>
    )
  }),

  page("/people/pending", () => {
    if (!canInvite()) throw new NoAccess()
    const m = me()
    const pending = [...db.people.values()]
      .filter((p) => p.account_id === m.account_id && !p.joined_at && !p.removed_at)
      .sort((a, b) => (b.invited_at ?? "").localeCompare(a.invited_at ?? ""))
    return (
      <Page title="Pending invitations" crumbs={[["Everyone", "/people"]]}>
        <h1>Pending invitations</h1>
        {pending.length ? (
          <ul>{pending.map((p) => (
            <li key={p.id}>{p.name} &lt;{p.email}&gt;{p.role === "client" ? " (client)" : ""}{" "}
              <small>invited by {personById(p.invited_by)?.name ?? "someone"} {p.invited_at ? fmtDateTime(p.invited_at, m.time_zone) : ""}</small>
              {(isAdmin(m) || p.invited_by === m.id) && (
                <>
                  {" "}<Form action={`/people/pending/${p.id}/resend`} style={{ display: "inline" }}><button>Resend</button></Form>
                  {" "}<Form action={`/people/pending/${p.id}/cancel`} style={{ display: "inline" }}><button>Cancel invitation</button></Form>
                </>
              )}
            </li>
          ))}</ul>
        ) : <p>No pending invitations.</p>}
        <p><a href="/people/invite">Invite people</a></p>
      </Page>
    )
  }),

  page("/people/:id", () => {
    const m = me()
    const p = db.people.get(String(Number(useParams().id) || 0))
    if (!p || p.account_id !== m.account_id || p.removed_at || !p.joined_at) throw new NotFound()
    if (!canSeePerson(m, p)) throw new NoAccess()
    const companyName = p.company_id ? db.companies.get(String(p.company_id))?.name ?? null : null
    const memberOf = new Set([...db.project_people.values()].filter((pp) => pp.person_id === p.id).map((pp) => pp.project_id))
    const shared = visibleProjects().filter((x) => memberOf.has(x.id) || (x.all_access && !isClient(p)))
    const self = p.id === m.id
    const ooo = isOutOfOffice(p) ? p.prefs.ooo! : null
    const first = p.name.split(" ")[0]
    return (
      <Page title={p.name} crumbs={[["Everyone", "/people"]]}>
        {p.avatar_url && <p><img src={p.avatar_url} alt="" width={96} height={96} /></p>}
        <h1>{p.name}</h1>
        <p>{p.title && `${p.title}, `}{companyName ?? account().name}{p.role !== "member" ? ` (${p.role})` : ""}</p>
        {ooo && <p role="note"><b>{first} is out of office until {fmtDate(ooo.until)}.</b>{ooo.message && ` ${ooo.message}`}</p>}
        {p.bio && <Fmt text={p.bio} />}
        <p>{p.location && `${p.location} · `}It's {localTime(p.time_zone)} there ({p.time_zone}).</p>
        <p>Email: {p.email}</p>
        <ul>
          {!self && <li><a href={`/chats/new?with=${p.id}`}>Message {first}</a></li>}
          {!isClient(m) && (
            <>
              <li><a href={`/reports/assignments?person=${p.id}`}>What's on {self ? "your" : `${first}'s`} plate?</a></li>
              <li><a href={`/reports/activity?person=${p.id}`}>{self ? "What have you been up to?" : `What's ${first} been up to?`}</a></li>
            </>
          )}
          {self ? <li><a href="/my/profile">Edit your profile</a></li> : isAdmin(m) && <li><a href={`/admin/people/${p.id}`}>Edit in Admin</a></li>}
        </ul>
        <h2>Projects</h2>
        {shared.length ? <ul>{shared.map((x) => <li key={x.id}><a href={projectUrl(x)}>{x.name}</a></li>)}</ul> : <p>No projects you're both on.</p>}
      </Page>
    )
  }),

  // Client access for a project
  page("/projects/:id/clients", () => {
    const p = findProject(useParams().id)
    if (isClient(me())) throw new NoAccess()
    const clients = projectPeople(p).filter(isClient)
    return (
      <Page title="Client access" crumbs={[[p.name, projectUrl(p)]]}>
        <h1>Client access for {p.name}</h1>
        <p>Clients only see things you specifically show them. Everything else stays between your team.</p>
        <h2>Clients on this project</h2>
        {clients.length ? (
          <ul>{clients.map((x) => (
            <li key={x.id}><a href={`/people/${x.id}`}>{x.name}</a>{x.company_name && <> <small>({x.company_name})</small></>}{" "}
              <Form action={`/projects/${p.id}/clients/${x.id}/remove`} style={{ display: "inline" }}><button>Remove from project</button></Form></li>
          ))}</ul>
        ) : <p>No clients on this project yet.</p>}
        {canInvite() && <p><a href={`/people/invite?project_id=${p.id}&client=1`}>Invite clients</a></p>}
        <Form action={`/projects/${p.id}/clients`}>
          <fieldset><legend>When someone posts something new…</legend>
            <label><input type="radio" name="see_new" value="hidden" defaultChecked={!p.clients_see_new} /> Clients can't see it until someone shows it to them</label><br />
            <label><input type="radio" name="see_new" value="visible" defaultChecked={p.clients_see_new} /> Clients see it right away</label>
          </fieldset>
          <p><button>Save</button> <a href={projectUrl(p)}>Cancel</a></p>
        </Form>
        <p><a href={`/projects/${p.id}/clients/preview`}>What will clients see?</a></p>
      </Page>
    )
  }),

  page("/projects/:id/clients/preview", () => {
    const p = findProject(useParams().id)
    const m = me()
    if (isClient(m)) throw new NoAccess()
    // A client sees an item only if it and every (active) ancestor is visible.
    const seen = (r: Recording): boolean => {
      const parent = r.parent_id === null ? null : db.recordings.get(String(r.parent_id))
      return (r.visible_to_clients || CLIENT_INHERITS.includes(r.type)) && (r.parent_id === null || (parent?.status === "active" && parent.project_id === p.id && seen(parent)))
    }
    const shown = recordings((r) => r.project_id === p.id && r.status === "active" && !CLIENT_INHERITS.includes(r.type) && seen(r))
      .sort((a, b) => a.type.localeCompare(b.type) || a.position - b.position || a.id - b.id)
    const members = new Set(memberIds(p.id))
    const people = [...db.people.values()].filter((x) => members.has(x.id) && !x.removed_at && x.joined_at).sort((a, b) => a.name.localeCompare(b.name))
    const tools = p.tools.filter((t) => t.enabled)
    return (
      <Page title="What a client sees" crumbs={[[p.name, projectUrl(p)]]}>
        <h1>What a client sees on {p.name}</h1>
        <p {...sx(pv.intro)}>The same project, filtered. Clients only see tools and items marked visible to them.</p>
        <h2>Tools</h2>
        <ul {...sx(pv.grid)}>{tools.map((t) => {
          const items = shown.filter((r) => TYPE_TOOL[r.type] === t.type)
          return (
            <li key={t.type} {...sx(pv.tool)}>
              <a href={windowUrl(p, t)} {...sx(pv.toolName)}>{t.name}</a>
              {items.length
                ? <ul {...sx(pv.items)}>{items.map((r) => <li key={r.id} {...sx(pv.item)}><span {...sx(kit.tag, pv.tag)}>{TYPE_NAMES[r.type]}</span> <a href={urlFor(r)}>{titleOf(r)}</a></li>)}</ul>
                : <p {...sx(pv.none)}>Nothing visible yet</p>}
            </li>
          )
        })}</ul>
        <h2>People they'd see</h2>
        <ul {...sx(pv.people)}>{people.map((x) => <li key={x.id} {...sx(pv.person)}><Face p={x} px={24} />{x.name}{isClient(x) ? " (client)" : ""}</li>)}</ul>
        <h2>Also</h2>
        <ul>
          <li>A simpler menu: no Admin and no company-wide reports.</li>
          <li>{account().settings.clients_can_ping ? "They can start a private chat with anyone at your company." : "They can only start private chats with people on their projects, unless an admin changes this."} {isAdmin(m) && <a href="/admin/permissions">Change</a>}</li>
        </ul>
        <p {...sx(kit.links)}><a href={`/projects/${p.id}/clients`}>Back to client access</a></p>
      </Page>
    )
  }),
]
