// Forwarded emails & links: the forwards list, a forwarded email, add a link, a link, edit a link.
// Posts: src/areas/forwards.ts.
import * as stylex from "@stylexjs/stylex"
import { useParams } from "react-router"
import { me, findProject, findRecording, projectPeople, personById, recordings, commentCount, useVisit, NoAccess, type PersonWithCompany } from "../data.ts"
import { isClient, projectUrl, toolUrl, urlFor, type Project } from "../../shared/domain.ts"
import { excerpt, fmtDate, ms } from "../../shared/format.ts"
import { ByLine, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, font, radius, space, text } from "../ui/tokens.stylex.ts"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"

// The forwarding address in a tile, ready to copy; forwards as rows.
const fw = stylex.create({
  address: { display: "grid", gap: space.s2, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile, marginBottom: space.s5 },
  addressText: { margin: 0 },
  addressInput: { width: "min(100%, 34rem)", fontFamily: font.mono, fontSize: text.sm, backgroundColor: color.sheet },
})

const address = (p: Project) => (p.email_token ? `${p.email_token}@forwards.saintsflow.test` : null)

const ForwardForm = ({ p }: { p: Project }) => (
  <>
    <h2>Simulate forwarding an email</h2>
    <p><small>There's no mail server yet, so paste an email here to see what forwarding does.</small></p>
    <Form action={`/projects/${p.id}/forwards`}>
      <TextField label="From" name="from" required placeholder="someone@example.com" type="email" />
      <TextField label="Subject" name="title" required />
      <TextArea label="Email" name="body" />
      <button>Forward it into {p.name}</button>
    </Form>
  </>
)

type Door = { id?: number; title: string; url: string; description: string; visible_to_clients?: boolean }

const DoorForm = ({ p, people, d }: { p: Project; people: PersonWithCompany[]; d: Door }) => (
  <>
    <h1>{d.id ? "Edit link" : "Add a link"}</h1>
    <p>Link this project to another tool, like Figma, GitHub, or a Google Drive folder.</p>
    <Form action={d.id ? `/projects/${p.id}/links/${d.id}/edit` : `/projects/${p.id}/links`}>
      <TextField label="URL" name="url" value={d.url} required placeholder="https://" type="url" />
      <TextField label="Name" name="title" value={d.title} required placeholder="Figma mockups" />
      <TextField label="Short description (optional)" name="description" value={d.description} />
      <ClientSwitch project={p} people={people} current={d.visible_to_clients} />
      <p><button>{d.id ? "Save changes" : "Add this link"}</button> <a href={d.id ? `/projects/${p.id}/links/${d.id}` : projectUrl(p)}>Cancel</a></p>
    </Form>
  </>
)

export const routes = [
  page("/projects/:id/forwards", () => {
    const p = findProject(useParams().id)
    useVisit(toolUrl(p, "forwards"), `${p.name}: Forwarded emails`, p.id)
    const m = me()
    const fws = recordings((r) => r.project_id === p.id && r.type === "forward" && r.status === "active").sort((a, b) => ms(b.created_at) - ms(a.created_at))
    const addr = address(p)
    return (
      <Page title="Forwarded emails" crumbs={projectCrumbs(p)}>
        <PageHead title="Forwarded emails" />
        <div {...sx(fw.address)}>
          {fws.length === 0
            ? <p {...sx(fw.addressText)}>Forward emails to this project so everyone can see them and talk about them. Send them to:</p>
            : <p {...sx(fw.addressText)}>This project's address:</p>}
          {addr
            ? <p {...sx(fw.addressText)}><input readOnly size={50} value={addr} onClick={(e) => e.currentTarget.select()} aria-label="Forwarding address" {...sx(fw.addressInput)} /></p>
            : <p {...sx(fw.addressText)}>This project doesn't have a forwarding address.</p>}
        </div>
        {fws.length > 0 && (
          <ul {...sx(kit.rows)}>
            {fws.map((f) => {
              const n = commentCount(f.id)
              return (
                <li key={f.id}>
                  <a href={urlFor(f)} {...sx(kit.rowTitle)}>{f.title}</a>
                  <span {...sx(kit.rowMeta)}>From {f.data.from} · {fmtDate(f.created_at, m.time_zone)}{n ? ` · ${n} comment${n === 1 ? "" : "s"}` : ""}</span>
                  <p {...sx(kit.rowText)}>{excerpt(f.body)}</p>
                </li>
              )
            })}
          </ul>
        )}
        {p.status === "active" && !isClient(m) && <ForwardForm p={p} />}
      </Page>
    )
  }),

  page("/projects/:id/forwards/:fid", () => {
    const { r, project } = findRecording(useParams().fid, "forward")
    useVisit(urlFor(r), r.title, project.id)
    return (
      <Page title={r.title} crumbs={projectCrumbs(project, "forwards")}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(project).some(isClient)} />
        <article>
          <h1>{r.title}</h1>
          <p><small>Forwarded by</small></p>
          <ByLine who={personById(r.creator_id)} when={r.created_at} tz={me().time_zone} />
          <dl>
            <dt>From</dt><dd>{r.data.from}</dd>
            <dt>To</dt><dd>{r.data.to ?? ""}</dd>
            <dt>Subject</dt><dd>{r.data.original_subject ?? r.title}</dd>
          </dl>
          <Fmt text={r.body} />
        </article>
        <ItemFooter r={r} project={project} />
      </Page>
    )
  }),

  // Links (type "door")
  page("/projects/:id/links/new", () => {
    const p = findProject(useParams().id)
    if (isClient(me())) throw new NoAccess()
    return <Page title="Add a link" crumbs={projectCrumbs(p)}><DoorForm p={p} people={projectPeople(p)} d={{ title: "", url: "", description: "" }} /></Page>
  }),

  page("/projects/:id/links/:did", () => {
    const { r, project } = findRecording(useParams().did, "door")
    return (
      <Page title={r.title} crumbs={[[project.name, projectUrl(project)]]}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(project).some(isClient)} />
        <h1>{r.title}</h1>
        {r.data.description && <p>{r.data.description}</p>}
        <p><a href={r.data.url} target="_blank" rel="noopener">Open {r.title}</a> <small>({r.data.url}, opens in a new tab)</small></p>
        {!isClient(me()) && r.status === "active" && <p><a href={`/projects/${project.id}/links/${r.id}/edit`}>Edit</a> · <a href={`/r/${r.id}/trash`}>Remove</a></p>}
        <ItemFooter r={r} project={project} showComments={false} />
      </Page>
    )
  }),

  page("/projects/:id/links/:did/edit", () => {
    const { r, project } = findRecording(useParams().did, "door")
    if (isClient(me())) throw new NoAccess()
    return (
      <Page title="Edit link" crumbs={[[project.name, projectUrl(project)]]}>
        <DoorForm p={project} people={projectPeople(project)} d={{ id: r.id, title: r.title, url: r.data.url, description: r.data.description ?? "", visible_to_clients: r.visible_to_clients }} />
      </Page>
    )
  }),
]
