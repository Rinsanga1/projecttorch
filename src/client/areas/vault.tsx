// Files: the vault, folders, docs, uploads (with versions), cloud links, public links. Posts: src/areas/vault.ts.
// Stored files (raw, download, public download) are served by the server under /api.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, findProject, findRecording, projectPeople, personById, recordings, commentCount, useApi, useVisit, NoAccess, NotFound } from "../data.ts"
import { isClient, titleOf, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { fmtDate, plural } from "../../shared/format.ts"
import { ByLine, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, NotifyPicker, submitOnChange, TextArea, TextField } from "../ui/forms.tsx"
import { NewTag } from "../ui/in-window.tsx"
import { Page, page, projectCrumbs, type Crumb } from "../ui/page.tsx"
import { color, media, radius, space, text } from "../ui/tokens.stylex.ts"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"
import { DOT } from "./cards.tsx"

const fmtSize = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`)

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const VAULT_TYPES = ["folder", "doc", "upload", "cloudfile"]

// ---------- reads ----------

/** What's in a folder (or the top level): folders first, then by the chosen sort. */
const vaultItems = (projectId: number, folderId: number | null, sort: string) => {
  const order = (a: Recording, b: Recording) =>
    sort === "newest" ? b.created_at.localeCompare(a.created_at)
    : sort === "alpha" ? a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    : a.position - b.position || a.id - b.id
  return recordings((r) => r.project_id === projectId && VAULT_TYPES.includes(r.type) && r.status === "active" && r.parent_id === folderId)
    .sort((a, b) => Number(b.type === "folder") - Number(a.type === "folder") || order(a, b))
}

const childCount = (id: number) => recordings((k) => k.parent_id === id && VAULT_TYPES.includes(k.type) && k.status === "active").length

/** A folder in this project to put things in, from ?folder=. null = top level. */
const findFolder = (p: Project, id: string | null) => {
  const fid = Number(id)
  if (!Number.isInteger(fid) || fid <= 0) return null
  const { r, project } = findRecording(fid, "folder")
  if (project.id !== p.id || r.status !== "active") throw new NotFound()
  return r
}

/** Project › Files › parent folders… */
const folderCrumbs = (p: Project, parentId: number | null): Crumb[] => {
  const chain: Crumb[] = []
  for (let f = parentId ? db.recordings.get(String(parentId)) : undefined; f; f = f.parent_id ? db.recordings.get(String(f.parent_id)) : undefined) {
    chain.unshift([f.title, `/projects/${p.id}/folders/${f.id}`])
  }
  return [...projectCrumbs(p, "vault"), ...chain]
}

const backTo = (p: Project, folder: Recording | null) => (folder ? urlFor(folder) : toolUrl(p, "vault"))

// ---------- pieces ----------

// Each item gets a drawn icon on a tile square; grid view is a card grid with image thumbnails.
const vs = stylex.create({
  row: { display: "grid", gridTemplateColumns: "40px 1fr", columnGap: space.s3, alignItems: "center", paddingBlock: space.s3 },
  icon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: color.tile, color: color.ink,
    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  title: { fontWeight: 600, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  meta: { display: "flex", flexWrap: "wrap", columnGap: space.s2, fontSize: text.sm, color: color.muted },
  quiet: { color: color.muted, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  card: {
    position: "relative", borderTopWidth: 0, padding: space.s3, borderRadius: radius.xl, display: "grid", gap: space.s2, alignContent: "start",
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  thumb: { display: "flex", alignItems: "center", justifyContent: "center", aspectRatio: "4 / 3", borderRadius: radius.lg, backgroundColor: color.sheet, overflow: "hidden" },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover", borderRadius: 0 },
  new: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, marginBottom: space.s5, maxWidth: "none" },
  newMore: { margin: 0 },
  newMoreLinks: { display: "flex", flexWrap: "wrap", gap: space.s2, marginTop: space.s2 },
  // A folder's color, as a dot (never the color's name as text).
  dot: (bg: string) => ({ backgroundColor: bg }),
  dotBox: { display: "inline-block", width: 9, height: 9, borderRadius: radius.pill, marginRight: space.s2, verticalAlign: 1 },
})

const ICONS: Record<string, string> = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h5A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
  doc: '<path d="M6 3h5.5L15 6.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M11 3v4h4M7.5 10.5h5M7.5 13.5h5"/>',
  cloudfile: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  upload: '<path d="M14.5 9.5 9.6 14.4a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.4 5.4a1.1 1.1 0 0 1-1.5-1.5L11.6 6.4"/>',
}
const Drawn = ({ type, size = 20 }: { type: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: ICONS[type] ?? ICONS.upload! }} />
)

const NewMenu = ({ p, folderId }: { p: Project; folderId: number | null }) => {
  const q = folderId ? `?folder=${folderId}` : ""
  return (
    <div {...sx(vs.new)}>
      <a href={`/projects/${p.id}/uploads/new${q}`} data-button data-primary>Upload files</a>
      <a href={`/projects/${p.id}/docs/new${q}`} data-button>New doc</a>
      <details {...sx(vs.newMore)}>
        <summary aria-label="More ways to add" title="New folder, or a link to a cloud file" {...sx(kit.quietSummary)}>•••</summary>
        <p {...sx(vs.newMoreLinks)}>
          <a href={`/projects/${p.id}/folders/new${q}`} data-button>New folder</a>
          <a href={`/projects/${p.id}/cloudfiles/new${q}`} data-button>Link a Google Doc, Sheet or other file</a>
        </p>
      </details>
    </div>
  )
}

const ItemLabel = observer(({ r }: { r: Recording }) => {
  const comments = commentCount(r.id)
  return (
    <div>
      {r.type === "folder" && r.data.color && <span aria-hidden="true" {...sx(vs.dotBox, vs.dot(DOT[r.data.color] ?? DOT.gray!))} />}<a href={urlFor(r)} {...sx(vs.title)}>{titleOf(r)}</a><NewTag r={r} />
      {r.type === "folder" && <> <small>({plural(childCount(r.id), "item")})</small></>}
      {r.type === "upload" && r.data.size ? <> <small>({fmtSize(r.data.size)})</small></> : null}
      <span {...sx(vs.meta)}>
        <span>{personById(r.creator_id)?.name ?? "Someone"} · {fmtDate(r.updated_at, me().time_zone)}{comments ? ` · ${plural(comments, "comment")}` : ""}</span>
        <a href={`/r/${r.id}/move?mode=move`} data-row-action {...sx(vs.quiet)}>Move</a>
      </span>
    </div>
  )
})

const Listing = ({ items, view }: { items: ReadonlyArray<Recording>; view: string }) =>
  view === "grid" ? (
    <ul {...sx(vs.grid)}>
      {items.map((r) => (
        <li key={r.id} {...sx(vs.card)}>
          <a href={urlFor(r)} tabIndex={-1} aria-hidden="true" {...sx(vs.thumb)}>
            {r.type === "upload" && String(r.data.content_type ?? "").startsWith("image/")
              ? <img src={`/api/uploads/${r.id}/raw`} alt="" {...sx(vs.thumbImg)} />
              : <Drawn type={r.type} size={36} />}
          </a>
          <ItemLabel r={r} />
        </li>
      ))}
    </ul>
  ) : (
    <ul {...sx(kit.rows)}>
      {items.map((r) => <li key={r.id} {...sx(vs.row)}><span {...sx(vs.icon)}><Drawn type={r.type} /></span><ItemLabel r={r} /></li>)}
    </ul>
  )

const SortViewForm = ({ sort, view }: { sort: string; view: string }) => (
  <GetForm method="get" ref={submitOnChange} {...sx(kit.toolbar)}>
    <label>Sort <select name="sort" defaultValue={sort} {...sx(kit.toolbarControl)}>
      <option value="position">Your order</option>
      <option value="newest">Newest</option>
      <option value="alpha">A–Z</option>
    </select></label>
    <label>View <select name="view" defaultValue={view} {...sx(kit.toolbarControl)}><option value="list">List</option><option value="grid">Grid</option></select></label>
  </GetForm>
)

const useSortView = () => {
  const [q] = useSearchParams()
  return { sort: q.get("sort") ?? "position", view: q.get("view") === "grid" ? "grid" : "list" }
}

const FolderField = ({ folder }: { folder: Recording | null }) =>
  folder ? <><input type="hidden" name="folder_id" value={folder.id} /><p>In the folder <b>{folder.title}</b></p></> : null

// ---------- forms ----------

const FolderForm = ({ p, folder, f }: { p: Project; folder: Recording | null; f: Partial<Recording> }) => (
  <Form action={f.id ? `/projects/${p.id}/folders/${f.id}/edit` : `/projects/${p.id}/folders`}>
    {!f.id && <FolderField folder={folder} />}
    <TextField label="Name this folder" name="title" value={f.title ?? ""} required />
    <p><label>Color<br /><select name="color" defaultValue={f.data?.color ?? ""}>{COLORS.map((k) => <option key={k} value={k}>{k || "None"}</option>)}</select></label></p>
    <p><button>{f.id ? "Save changes" : "Create folder"}</button> <a href={f.id ? urlFor(f as Recording) : backTo(p, folder)}>Cancel</a></p>
  </Form>
)

const DocForm = observer(({ p, folder, d }: { p: Project; folder: Recording | null; d: Partial<Recording> }) => {
  const people = projectPeople(p)
  const published = d.id && d.status !== "drafted"
  return (
    <Form action={d.id ? `/projects/${p.id}/docs/${d.id}/edit` : `/projects/${p.id}/docs`}>
      {!d.id && <FolderField folder={folder} />}
      <TextField label="Title" name="title" value={d.title ?? ""} required placeholder="Give it a title…" />
      <TextArea label="The document" name="body" value={d.body ?? ""} placeholder="Write away…" />
      {!published && <NotifyPicker people={people} me={me()} />}
      <ClientSwitch project={p} people={people} current={d.visible_to_clients} />
      <p>
        <button name="publish" value="1">{published ? "Save changes" : "Post this doc"}</button>{" "}
        {!published && <button name="draft" value="1">Save as a draft</button>}{" "}
        <a href={d.id ? urlFor(d as Recording) : backTo(p, folder)}>{d.id ? "Cancel" : "Discard"}</a>
      </p>
    </Form>
  )
})

const CloudForm = observer(({ p, folder, l }: { p: Project; folder: Recording | null; l: Partial<Recording> }) => (
  <Form action={l.id ? `/projects/${p.id}/cloudfiles/${l.id}/edit` : `/projects/${p.id}/cloudfiles`}>
    {!l.id && <FolderField folder={folder} />}
    <TextField label="Paste the link" name="url" value={l.data?.url ?? ""} required type="url" placeholder="https://docs.google.com/…" />
    <TextField label="Title" name="title" value={l.title ?? ""} />
    {!l.id && <ClientSwitch project={p} people={projectPeople(p)} current={l.visible_to_clients} />}
    <p><button>{l.id ? "Save changes" : "Add this link"}</button> <a href={l.id ? urlFor(l as Recording) : backTo(p, folder)}>Cancel</a></p>
  </Form>
))

/** The project from :id and the folder from ?folder=, for the "new" pages. */
const useNewIn = () => {
  const p = findProject(useParams().id)
  const [q] = useSearchParams()
  return { p, folder: findFolder(p, q.get("folder")) }
}

/** A doc page: drafts go to their edit page instead (see the route). */
const DocView = observer(({ r, p }: { r: Recording; p: Project }) => {
  const m = me()
  const { data: versions } = useApi<Array<{ name: string | null; created_at: string }>>(`/r/${r.id}/history`)
  const last = versions?.[0]
  const n = versions?.length ?? 0
  useVisit(urlFor(r), r.title, p.id)
  return (
    <Page title={r.title} crumbs={folderCrumbs(p, r.parent_id)}>
      <StatusBanner r={r} />
      <ClientBanner r={r} hasClients={projectPeople(p).some(isClient)} />
      <article>
        <h1>{r.title}</h1>
        <ByLine who={personById(r.creator_id)} when={r.created_at} tz={m.time_zone} />
        {last && n > 1 && <p><small>Last edited by {last.name ?? "someone"} on {fmtDate(last.created_at, m.time_zone)}</small></p>}
        <Fmt text={r.body} />
      </article>
      <p>{r.status === "active" && <><a href={`/projects/${p.id}/docs/${r.id}/edit`}>Edit</a> · </>}<a href={`/r/${r.id}/history`}>Previous versions{last && n > 1 ? ` (${n - 1})` : ""}</a></p>
      <ItemFooter r={r} project={p} />
    </Page>
  )
})

// ---------- pages ----------
export const routes = [
  page("/projects/:id/files", () => {
    const p = findProject(useParams().id)
    const { sort, view } = useSortView()
    const items = vaultItems(p.id, null, sort)
    useVisit(toolUrl(p, "vault"), `${p.name}: Files`, p.id)
    return (
      <Page title="Files" crumbs={projectCrumbs(p)}>
        <PageHead title="Files" />
        {p.status === "active" && <NewMenu p={p} folderId={null} />}
        {items.length > 10 && <SortViewForm sort={sort} view={view} />}
        {items.length ? <Listing items={items} view={view} /> : <p {...sx(kit.empty)}>Keep docs, files, and images here. Put them in folders so they're easy to find.</p>}
        <p {...sx(kit.links)}><a href={`/projects/${p.id}/trash`}>Archived & trashed files</a></p>
      </Page>
    )
  }),

  // Folders
  page("/projects/:id/folders/new", () => {
    const { p, folder } = useNewIn()
    return <Page title="New folder" crumbs={folderCrumbs(p, folder?.id ?? null)}><h1>New folder</h1><FolderForm p={p} folder={folder} f={{}} /></Page>
  }),

  page("/projects/:id/folders/:fid", () => {
    const { r, project: p } = findRecording(useParams().fid, "folder")
    const { sort, view } = useSortView()
    const items = vaultItems(p.id, r.id, sort)
    useVisit(urlFor(r), r.title, p.id)
    return (
      <Page title={r.title} crumbs={folderCrumbs(p, r.parent_id)}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(p).some(isClient)} />
        <h1>{r.data.color && <span aria-hidden="true" {...sx(vs.dotBox, vs.dot(DOT[r.data.color] ?? DOT.gray!))} />}{r.title}</h1>
        {r.status === "active" && p.status === "active" && <NewMenu p={p} folderId={r.id} />}
        {items.length > 10 && <SortViewForm sort={sort} view={view} />}
        {items.length ? <Listing items={items} view={view} /> : <p>This folder is empty. Add a doc or upload files to it.</p>}
        {r.status === "active" && <p><a href={`/projects/${p.id}/folders/${r.id}/edit`}>Rename or recolor this folder</a></p>}
        <ItemFooter r={r} project={p} />
      </Page>
    )
  }),

  page("/projects/:id/folders/:fid/edit", () => {
    const { r, project: p } = findRecording(useParams().fid, "folder")
    return <Page title="Edit folder" crumbs={folderCrumbs(p, r.id)}><h1>Edit folder</h1><FolderForm p={p} folder={null} f={r} /></Page>
  }),

  // Docs
  page("/projects/:id/docs/new", () => {
    const { p, folder } = useNewIn()
    return <Page title="New doc" crumbs={folderCrumbs(p, folder?.id ?? null)}><h1>New doc</h1><DocForm p={p} folder={folder} d={{}} /></Page>
  }),

  page("/projects/:id/docs/:did", () => {
    const { r, project: p } = findRecording(useParams().did, "doc")
    if (r.status === "drafted") return <Navigate replace to={`/projects/${p.id}/docs/${r.id}/edit`} />
    return <DocView r={r} p={p} />
  }),

  page("/projects/:id/docs/:did/edit", () => {
    const { r, project: p } = findRecording(useParams().did, "doc")
    if (r.status !== "active" && r.status !== "drafted") return <Navigate replace to={urlFor(r)} />
    if (isClient(me()) && r.creator_id !== me().id) throw new NoAccess()
    const title = r.status === "drafted" ? "Finish your draft" : "Edit doc"
    return <Page title={title} crumbs={folderCrumbs(p, r.parent_id)}><h1>{title}</h1><DocForm p={p} folder={null} d={r} /></Page>
  }),

  // Uploads
  page("/projects/:id/uploads/new", () => {
    const { p, folder } = useNewIn()
    const people = projectPeople(p)
    return (
      <Page title="Upload files" crumbs={folderCrumbs(p, folder?.id ?? null)}>
        <h1>Upload files</h1>
        <Form action={`/projects/${p.id}/uploads`} encType="multipart/form-data">
          <FolderField folder={folder} />
          <p><label>Choose files, or drop them here<br /><input type="file" name="files" multiple required /></label></p>
          <TextArea label="Add a note about these files (optional)" name="body" />
          <NotifyPicker people={people} me={me()} />
          <ClientSwitch project={p} people={people} />
          <p><button>Post these files</button> <a href={backTo(p, folder)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  page("/projects/:id/uploads/:uid", () => {
    const { r, project: p } = findRecording(useParams().uid, "upload")
    const m = me()
    const versions = (r.data.versions ?? []) as any[]
    const link = [...db.public_links.values()].some((l) => l.recording_id === r.id)
    const ct = String(r.data.content_type ?? "")
    const raw = `/api/uploads/${r.id}/raw`
    useVisit(urlFor(r), r.title, p.id)
    return (
      <Page title={r.title} crumbs={folderCrumbs(p, r.parent_id)}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(p).some(isClient)} />
        <article>
          <h1>📎 {r.title}</h1>
          <ByLine who={personById(r.creator_id)} when={r.created_at} tz={m.time_zone} />
          {ct.startsWith("image/") ? <p><img src={raw} alt={r.title} /></p>
            : ct.startsWith("video/") ? <p><video src={raw} controls width={640} /></p>
            : ct === "application/pdf" ? <p><embed src={raw} type="application/pdf" width={640} height={480} /></p>
            : <p><i>No preview for this kind of file.</i></p>}
          <p>{r.data.filename} · {fmtSize(Number(r.data.size ?? 0))} · {ct || "unknown type"}</p>
          {r.body && <Fmt text={r.body} />}
        </article>
        <p><a href={`/api/uploads/${r.id}/download`} data-button>Download</a></p>
        {r.status === "active" && (
          // Keyed by the current file, so the picker clears once the new version lands.
          <Form key={r.data.path} action={`/projects/${p.id}/uploads/${r.id}/versions`} encType="multipart/form-data">
            <label>Upload a new version <input type="file" name="file" required /></label> <button>Upload</button>
          </Form>
        )}
        <p>
          <a href={`/r/${r.id}/history`}>Versions ({versions.length + 1})</a>
          {r.status === "active" && <> · <a href={`/projects/${p.id}/uploads/${r.id}/edit`}>Rename or add a note</a></>}
          {!isClient(m) && <> · <a href={`/r/${r.id}/public-link`}>{link ? "Public link is on" : "Share a public link"}</a></>}
        </p>
        {versions.length > 0 && (
          <>
            <h2>Older versions</h2>
            <ul>{[...versions].reverse().map((v) => (
              <li key={v.path}>{v.filename} · {fmtSize(Number(v.size ?? 0))} · {fmtDate(v.at, m.time_zone)}{" "}
                <a href={`/api/uploads/${r.id}/download?version=${encodeURIComponent(v.path)}`}>Download</a></li>
            ))}</ul>
          </>
        )}
        <ItemFooter r={r} project={p} />
      </Page>
    )
  }),

  page("/projects/:id/uploads/:uid/edit", () => {
    const { r, project: p } = findRecording(useParams().uid, "upload")
    if (isClient(me()) && r.creator_id !== me().id) throw new NoAccess()
    return (
      <Page title="Edit file" crumbs={folderCrumbs(p, r.parent_id)}>
        <h1>Edit file</h1>
        <Form action={`/projects/${p.id}/uploads/${r.id}/edit`}>
          <TextField label="Name" name="title" value={r.title} required />
          <TextArea label="Note" name="body" value={r.body} />
          <p><button>Save changes</button> <a href={urlFor(r)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  // Cloud files
  page("/projects/:id/cloudfiles/new", () => {
    const { p, folder } = useNewIn()
    return (
      <Page title="Link a cloud file" crumbs={folderCrumbs(p, folder?.id ?? null)}>
        <h1>Link a cloud file</h1><p>Google Docs, Sheets, Dropbox, anything with a URL.</p><CloudForm p={p} folder={folder} l={{}} />
      </Page>
    )
  }),

  page("/projects/:id/cloudfiles/:cid", () => {
    const { r, project: p } = findRecording(useParams().cid, "cloudfile")
    useVisit(urlFor(r), r.title, p.id)
    return (
      <Page title={r.title} crumbs={folderCrumbs(p, r.parent_id)}>
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={projectPeople(p).some(isClient)} />
        <article>
          <h1>🔗 {r.title}</h1>
          <ByLine who={personById(r.creator_id)} when={r.created_at} tz={me().time_zone} />
          <p><a href={r.data.url} target="_blank" rel="noopener noreferrer">Open {r.data.url}</a></p>
        </article>
        {r.status === "active" && <p><a href={`/projects/${p.id}/cloudfiles/${r.id}/edit`}>Edit</a></p>}
        <ItemFooter r={r} project={p} />
      </Page>
    )
  }),

  page("/projects/:id/cloudfiles/:cid/edit", () => {
    const { r, project: p } = findRecording(useParams().cid, "cloudfile")
    return <Page title="Edit link" crumbs={folderCrumbs(p, r.parent_id)}><h1>Edit link</h1><CloudForm p={p} folder={null} l={r} /></Page>
  }),

  // Public links
  page("/r/:id/public-link", () => {
    const { r, project: p } = findRecording(useParams().id, "upload")
    if (isClient(me())) throw new NoAccess()
    const link = [...db.public_links.values()].find((l) => l.recording_id === r.id)
    const url = link ? `${location.origin}/p/${link.token}` : ""
    return (
      <Page title="Public link" crumbs={folderCrumbs(p, r.parent_id)}>
        <h1>Public link for “{r.title}”</h1>
        <p>Share one file with someone who isn't in Saintsflow.</p>
        {link ? (
          <>
            <p><label>The link <input readOnly size={60} value={url} onClick={(e) => e.currentTarget.select()} /></label>{" "}
              <button type="button" onClick={() => navigator.clipboard.writeText(url)}>Copy</button></p>
            <p>Anyone with this link can see and download this file. Turn it off any time.</p>
            <Form action={`/r/${r.id}/public-link`}><input type="hidden" name="on" value="" /><button>Turn off the link</button></Form>
          </>
        ) : (
          <>
            <p>Anyone with the link will be able to see and download this file, even without an account.</p>
            <Form action={`/r/${r.id}/public-link`}><input type="hidden" name="on" value="1" /><button>Share a public link</button></Form>
          </>
        )}
        <p><a href={urlFor(r)}>Back to the file</a></p>
      </Page>
    )
  }),

  page("/p/:token", () => {
    const { token } = useParams()
    const { data: f, error } = useApi<{ title: string; filename: string; size: number }>(`/p/${token}`)
    if (error === "NotFound") throw new NotFound()
    return (
      <Page title={f?.title ?? "Shared file"}>
        {error && <p role="alert">{error}</p>}
        {f && (
          <>
            <h1>{f.title}</h1>
            <p>{f.filename} · {fmtSize(f.size)}</p>
            <p><a href={`/api/p/${token}/download`} data-button>Download</a></p>
            <p><small>Shared with a public link from Saintsflow.</small></p>
          </>
        )}
      </Page>
    )
  }, { pub: true }),
]
