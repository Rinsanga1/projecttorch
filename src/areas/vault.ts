// Files: the vault, folders, docs, uploads (with versions), cloud links, public links.
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { resolve, sep, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { html, raw, fmt, fmtDate, plural } from "../lib/html.ts"
import { get, post, pubGet, redirect, render, str, num, errors, isClient, NoAccess, NotFound, type Ctx, type PubCtx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor, titleOf,
  notifyPicker, notifyIdsFrom, clientSwitch, textField, textArea, byLine, clientFilter, trackVisit, personById,
  notify, subscribe, logEvent, type Project, type Recording,
} from "../lib/core.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import type { Seed } from "../seed.ts"
import { kit, pageHead, sx } from "../lib/ui.ts"
import { color, media, radius, space, text } from "../lib/tokens.stylex.ts"

// ---------- storage ----------
// Files live at storage/<recording id>/<timestamp>-<safe name>. data.path is relative to STORAGE.
// ponytail: local disk, no storage quota. Move to S3-style object storage and count bytes per account when it matters.
const STORAGE = fileURLToPath(new URL("../../storage/", import.meta.url))

const safeName = (name: string) => basename(name.replace(/\\/g, "/")).replace(/[^\w.\- ]+/g, "_").replace(/^\.+/, "").slice(-120) || "file"

/** Absolute path for a stored file, or null if it would escape STORAGE. */
const storagePath = (rel: string) => {
  const abs = resolve(STORAGE, rel)
  return abs.startsWith(resolve(STORAGE) + sep) ? abs : null
}

/** Write bytes to storage for a recording. Returns the relative path. */
const store = (recordingId: number, filename: string, bytes: ArrayBuffer | Uint8Array | string) =>
  Effect.promise(async () => {
    const rel = `${recordingId}/${Date.now()}-${safeName(filename)}`
    await mkdir(resolve(STORAGE, String(recordingId)), { recursive: true })
    await Bun.write(resolve(STORAGE, rel), bytes)
    return rel
  })

const fmtSize = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`)

const isUrl = (s: string) => {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const VAULT_TYPES = ["folder", "doc", "upload", "cloudfile"]

// ---------- queries ----------

type Listed = Recording & { creator_name: string | null; children: number; comments: number }

const vaultItems = (c: Ctx, projectId: number, folderId: number | null, sort: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const order = sort === "newest" ? sql`r.created_at desc` : sort === "alpha" ? sql`lower(r.title)` : sql`r.position, r.id`
    return yield* sql<Listed>`
      select r.*, pe.name as creator_name,
        (select count(*) from recordings k where k.parent_id = r.id and k.type in ('folder','doc','upload','cloudfile') and k.status = 'active')::int as children,
        (select count(*) from recordings k where k.parent_id = r.id and k.type = 'comment' and k.status = 'active')::int as comments
      from recordings r left join people pe on pe.id = r.creator_id
      where r.project_id = ${projectId} and r.type in ${sql.in(VAULT_TYPES)} and r.status = 'active'
        and r.parent_id is not distinct from ${folderId} ${clientFilter(sql, c.me, "r")}
      order by (r.type = 'folder') desc, ${order}`
  })

/** A folder in this project to put things in, from a ?folder= or form value. null = top level. */
const findFolder = (c: Ctx, p: Project, id: string | null | undefined) =>
  Effect.gen(function* () {
    const fid = num(id)
    if (!fid) return null
    const { r, project } = yield* findRecording(c, fid, "folder")
    if (project.id !== p.id || r.status !== "active") return yield* new NotFound()
    return r
  })

/** Project › Files › parent folders… */
const crumbsFor = (p: Project, parentId: number | null) =>
  Effect.gen(function* () {
    const base = projectCrumbs(p, "vault")
    if (!parentId) return base
    const sql = yield* SqlClient.SqlClient
    const chain = yield* sql<{ id: number; title: string; depth: number }>`
      with recursive up as (
        select id, parent_id, title, 0 as depth from recordings where id = ${parentId}
        union all select r.id, r.parent_id, r.title, up.depth + 1 from recordings r join up on r.id = up.parent_id where r.type = 'folder')
      select id, title, depth from up order by depth desc`
    return [...base, ...chain.map((f) => [f.title, `/projects/${p.id}/folders/${f.id}`] as const)]
  })

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
  new: { display: "flex", flexWrap: "wrap", gap: space.s2, marginBottom: space.s5, maxWidth: "none" },
})

const ICONS: Record<string, string> = {
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h5A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
  doc: '<path d="M6 3h5.5L15 6.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M11 3v4h4M7.5 10.5h5M7.5 13.5h5"/>',
  cloudfile: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l.8-.8"/>',
  upload: '<path d="M14.5 9.5 9.6 14.4a3.2 3.2 0 0 1-4.5-4.5l5.6-5.6a2.1 2.1 0 0 1 3 3l-5.4 5.4a1.1 1.1 0 0 1-1.5-1.5L11.6 6.4"/>',
}
const drawn = (type: string, size = 20) =>
  raw(`<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type] ?? ICONS.upload}</svg>`)

const newMenu = (p: Project, folderId: number | null) => {
  const q = folderId ? `?folder=${folderId}` : ""
  return html`<p${sx(vs.new)}>
  <a href="/projects/${p.id}/docs/new${q}" data-button>New doc</a>
  <a href="/projects/${p.id}/folders/new${q}" data-button>New folder</a>
  <a href="/projects/${p.id}/uploads/new${q}" data-button>Upload files</a>
  <a href="/projects/${p.id}/cloudfiles/new${q}" data-button>Link to a Google Doc, Sheet…</a></p>`
}


const itemLabel = (r: Listed, c: Ctx) => html`<div>
  <a href="${urlFor(r)}"${sx(vs.title)}>${titleOf(r)}</a>
  ${r.type === "folder" ? html` <small>(${plural(r.children, "item")}${r.data.color ? `, ${r.data.color}` : ""})</small>` : ""}
  ${r.type === "upload" && r.data.size ? html` <small>(${fmtSize(r.data.size)})</small>` : ""}
  <span${sx(vs.meta)}><span>${r.creator_name ?? "Someone"} · ${fmtDate(r.updated_at, c.me.time_zone)}${r.comments ? ` · ${plural(r.comments, "comment")}` : ""}</span>
  <a href="/r/${r.id}/move?mode=move"${sx(vs.quiet)}>Move</a></span></div>`

const listing = (c: Ctx, items: ReadonlyArray<Listed>, view: string) => {
  if (view === "grid")
    return html`<ul${sx(vs.grid)}>${items.map((r) => html`<li${sx(vs.card)}>
      <a href="${urlFor(r)}" tabindex="-1" aria-hidden="true"${sx(vs.thumb)}>${r.type === "upload" && String(r.data.content_type ?? "").startsWith("image/")
        ? html`<img src="/uploads/${r.id}/raw" alt=""${sx(vs.thumbImg)}>` : drawn(r.type, 36)}</a>
      ${itemLabel(r, c)}</li>`)}</ul>`
  return html`<ul${sx(kit.rows)}>${items.map((r) => html`<li${sx(vs.row)}><span${sx(vs.icon)}>${drawn(r.type)}</span>${itemLabel(r, c)}</li>`)}</ul>`
}

const sortViewForm = (sort: string, view: string) => html`
<form method="get"${sx(kit.toolbar)}>
  <label>Sort <select name="sort"${sx(kit.toolbarControl)}>
    <option value="position">Your order</option>
    <option value="newest"${sort === "newest" ? raw(" selected") : ""}>Newest</option>
    <option value="alpha"${sort === "alpha" ? raw(" selected") : ""}>A–Z</option>
  </select></label>
  <label>View <select name="view"${sx(kit.toolbarControl)}><option value="list">List</option><option value="grid"${view === "grid" ? raw(" selected") : ""}>Grid</option></select></label>
  <button${sx(kit.toolbarControl)}>Apply</button>
</form>`

const folderField = (folder: Recording | null) => (folder ? html`<input type="hidden" name="folder_id" value="${folder.id}"><p>In the folder <b>${folder.title}</b></p>` : "")

const backTo = (p: Project, folder: Recording | null) => (folder ? urlFor(folder) : toolUrl(p, "vault"))

// ---------- forms ----------

const folderForm = (p: Project, folder: Recording | null, f: Partial<Recording>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${f.id ? `/projects/${p.id}/folders/${f.id}/edit` : `/projects/${p.id}/folders`}">
  ${f.id ? "" : folderField(folder)}
  ${textField("Name this folder", "title", f.title ?? "", { required: true })}
  <p><label>Color<br><select name="color">${COLORS.map((k) => html`<option value="${k}"${(f.data?.color ?? "") === k ? raw(" selected") : ""}>${k || "None"}</option>`)}</select></label></p>
  <p><button>${f.id ? "Save changes" : "Create folder"}</button> <a href="${f.id ? urlFor(f as Recording) : backTo(p, folder)}">Cancel</a></p>
</form>`

const docForm = (c: Ctx, p: Project, folder: Recording | null, people: ReadonlyArray<any>, d: Partial<Recording>, errs: string[]) => {
  const published = d.id && d.status !== "drafted"
  return html`
${errors(errs)}
<form method="post" action="${d.id ? `/projects/${p.id}/docs/${d.id}/edit` : `/projects/${p.id}/docs`}">
  ${d.id ? "" : folderField(folder)}
  ${textField("Title", "title", d.title ?? "", { required: true, placeholder: "Give it a title…" })}
  ${textArea("The document", "body", d.body ?? "", "Write away…")}
  ${published ? "" : notifyPicker(people, c.me)}
  ${clientSwitch(p, people, d.visible_to_clients)}
  <p>
    <button name="publish" value="1">${published ? "Save changes" : "Post this doc"}</button>
    ${published ? "" : html`<button name="draft" value="1">Save as a draft</button>`}
    <a href="${d.id ? urlFor(d as Recording) : backTo(p, folder)}">${d.id ? "Cancel" : "Discard"}</a>
  </p>
</form>`
}

const uploadForm = (c: Ctx, p: Project, folder: Recording | null, people: ReadonlyArray<any>, errs: string[], note = "") => html`
${errors(errs)}
<form method="post" action="/projects/${p.id}/uploads" enctype="multipart/form-data">
  ${folderField(folder)}
  <p><label>Choose files, or drop them here<br><input type="file" name="files" multiple required></label></p>
  ${textArea("Add a note about these files (optional)", "body", note)}
  ${notifyPicker(people, c.me)}
  ${clientSwitch(p, people)}
  <p><button>Post these files</button> <a href="${backTo(p, folder)}">Cancel</a></p>
</form>`

const cloudForm = (p: Project, folder: Recording | null, people: ReadonlyArray<any>, l: Partial<Recording>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${l.id ? `/projects/${p.id}/cloudfiles/${l.id}/edit` : `/projects/${p.id}/cloudfiles`}">
  ${l.id ? "" : folderField(folder)}
  ${textField("Paste the link", "url", l.data?.url ?? "", { required: true, type: "url", placeholder: "https://docs.google.com/…" })}
  ${textField("Title", "title", l.title ?? "")}
  ${l.id ? "" : clientSwitch(p, people, l.visible_to_clients)}
  <p><button>${l.id ? "Save changes" : "Add this link"}</button> <a href="${l.id ? urlFor(l as Recording) : backTo(p, folder)}">Cancel</a></p>
</form>`

// ---------- file serving ----------

/** Serve a stored file. Inline only for types browsers render safely; everything else downloads. */
const sendFile = (rel: string, filename: string, contentType: string, inline: boolean) =>
  Effect.gen(function* () {
    const abs = storagePath(rel)
    if (!abs) return yield* new NotFound()
    const f = Bun.file(abs)
    if (!(yield* Effect.promise(() => f.exists()))) return yield* new NotFound()
    const bytes = new Uint8Array(yield* Effect.promise(() => f.arrayBuffer()))
    const renderable = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|video\/|audio\/|application\/pdf$)/.test(contentType)
    const disposition = inline && renderable ? "inline" : "attachment"
    return HttpServerResponse.uint8Array(bytes, {
      contentType: contentType || "application/octet-stream",
      headers: {
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "x-content-type-options": "nosniff",
        // SVGs and PDFs can carry scripts; never let them run on our origin.
        "content-security-policy": "sandbox",
      },
    })
  })

/** Is `path` the current file or one of this upload's older versions? */
const versionBelongs = (r: Recording, path: string) =>
  Effect.gen(function* () {
    if (path === r.data.path) return true
    if ((r.data.versions ?? []).some((v: any) => v.path === path)) return true
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql`select 1 from versions where recording_id = ${r.id} and data->>'path' = ${path}`
    return !!row
  })

const findPublic = (c: PubCtx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [r] = yield* sql<Recording>`
      select r.* from public_links l join recordings r on r.id = l.recording_id join projects p on p.id = r.project_id
      where l.token = ${c.params.token ?? ""} and r.status = 'active' and r.type = 'upload' and p.status <> 'trashed'`
    if (!r) return yield* new NotFound()
    return r
  })

// ---------- publishing a draft doc ----------
const publishDraft = (c: Ctx, r: Recording, project: Project, notifyIds: number[]) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`update recordings set status = 'active', created_at = now(), updated_at = now() where id = ${r.id}`
    const live = { ...r, status: "active" as const }
    yield* subscribe(r.id, [c.me.id, ...notifyIds])
    yield* logEvent(c, { project_id: project.id, recording_id: r.id, action: "created", summary: `posted a doc: ${titleOf(r)}` })
    if (notifyIds.length) yield* notify(c, { personIds: notifyIds, recording: live, kind: "doc", summary: `${c.me.name} posted a doc: ${titleOf(r)}` })
  })

// ---------- routes ----------
export const routes = [
  get("/projects/:id/files", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const sort = c.query.get("sort") ?? "position"
      const view = c.query.get("view") === "grid" ? "grid" : "list"
      const items = yield* vaultItems(c, p.id, null, sort)
      yield* trackVisit(c, toolUrl(p, "vault"), `${p.name}: Files`, p.id)
      return yield* render(c, "Files", html`
${pageHead("Files")}
${p.status === "active" ? newMenu(p, null) : ""}
${sortViewForm(sort, view)}
${items.length ? listing(c, items, view) : html`<p${sx(kit.empty)}>Keep docs, files, and images here. Put them in folders so they're easy to find.</p>`}
<p${sx(kit.links)}><a href="/projects/${p.id}/trash">Archived & trashed files</a></p>`, projectCrumbs(p))
    })),

  // Folders
  get("/projects/:id/folders/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const folder = yield* findFolder(c, p, c.query.get("folder"))
      return yield* render(c, "New folder", html`<h1>New folder</h1>${folderForm(p, folder, {}, [])}`, yield* crumbsFor(p, folder?.id ?? null))
    })),

  post("/projects/:id/folders", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const f = { title: str(fd, "title"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "" } }
      if (!f.title) return yield* render(c, "New folder", html`<h1>New folder</h1>${folderForm(p, folder, f, ["Your folder needs a name."])}`, yield* crumbsFor(p, folder?.id ?? null), 422)
      const r = yield* createRecording(c, { project: p, type: "folder", parent_id: folder?.id ?? null, ...f, visible_to_clients: folder ? folder.visible_to_clients : undefined, verb: "made a folder" })
      return redirect(urlFor(r))
    })),

  get("/projects/:id/folders/:fid", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.fid, "folder")
      const sort = c.query.get("sort") ?? "position"
      const view = c.query.get("view") === "grid" ? "grid" : "list"
      const items = yield* vaultItems(c, p.id, r.id, sort)
      const people = yield* projectPeople(p)
      yield* trackVisit(c, urlFor(r), r.title, p.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<h1>📁 ${r.title}</h1>
${r.data.color ? html`<p><small>Color: ${r.data.color}</small></p>` : ""}
${r.status === "active" && p.status === "active" ? newMenu(p, r.id) : ""}
${sortViewForm(sort, view)}
${items.length ? listing(c, items, view) : html`<p>This folder is empty. Add a doc or upload files to it.</p>`}
${r.status === "active" ? html`<p><a href="/projects/${p.id}/folders/${r.id}/edit">Rename or recolor this folder</a></p>` : ""}
${yield* itemFooter(c, r, p)}`, yield* crumbsFor(p, r.parent_id))
    })),

  get("/projects/:id/folders/:fid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.fid, "folder")
      return yield* render(c, "Edit folder", html`<h1>Edit folder</h1>${folderForm(p, null, r, [])}`, yield* crumbsFor(p, r.id))
    })),

  post("/projects/:id/folders/:fid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.fid, "folder")
      const fd = yield* c.form
      const ch = { title: str(fd, "title"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "" } }
      if (!ch.title) return yield* render(c, "Edit folder", html`<h1>Edit folder</h1>${folderForm(p, null, { ...r, ...ch }, ["Your folder needs a name."])}`, yield* crumbsFor(p, r.id), 422)
      const u = yield* updateRecording(c, r, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  // Docs
  get("/projects/:id/docs/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const folder = yield* findFolder(c, p, c.query.get("folder"))
      const people = yield* projectPeople(p)
      return yield* render(c, "New doc", html`<h1>New doc</h1>${docForm(c, p, folder, people, {}, [])}`, yield* crumbsFor(p, folder?.id ?? null))
    })),

  post("/projects/:id/docs", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const people = yield* projectPeople(p)
      const draft = fd.get("draft") === "1"
      const d = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!d.title)
        return yield* render(c, "New doc", html`<h1>New doc</h1>${docForm(c, p, folder, people, d, ["Your doc needs a title."])}`, yield* crumbsFor(p, folder?.id ?? null), 422)
      const r = yield* createRecording(c, {
        project: p, type: "doc", parent_id: folder?.id ?? null, ...d, status: draft ? "drafted" : "active",
        notifyIds: draft ? [] : notifyIdsFrom(fd, people, c.me), verb: "posted a doc",
      })
      return redirect(draft ? "/my/drafts" : urlFor(r), draft ? "Saved as a draft." : undefined)
    })),

  get("/projects/:id/docs/:did", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project: p } = yield* findRecording(c, c.params.did, "doc")
      if (r.status === "drafted") return redirect(`/projects/${p.id}/docs/${r.id}/edit`)
      const people = yield* projectPeople(p)
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      const [last] = yield* sql<{ name: string | null; created_at: Date; n: number }>`
        select pe.name, v.created_at, (select count(*) from versions where recording_id = ${r.id})::int as n
        from versions v left join people pe on pe.id = v.person_id where v.recording_id = ${r.id} order by v.id desc limit 1`
      yield* trackVisit(c, urlFor(r), r.title, p.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  <h1>${r.title}</h1>
  ${byLine(author, r.created_at, c.me.time_zone)}
  ${last && last.n > 1 ? html`<p><small>Last edited by ${last.name ?? "someone"} on ${fmtDate(last.created_at, c.me.time_zone)}</small></p>` : ""}
  <div>${fmt(r.body)}</div>
</article>
<p>${r.status === "active" ? html`<a href="/projects/${p.id}/docs/${r.id}/edit">Edit</a> · ` : ""}<a href="/r/${r.id}/history">Previous versions${last && last.n > 1 ? ` (${last.n - 1})` : ""}</a></p>
${yield* itemFooter(c, r, p)}`, yield* crumbsFor(p, r.parent_id))
    })),

  get("/projects/:id/docs/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.did, "doc")
      if (r.status !== "active" && r.status !== "drafted") return redirect(urlFor(r))
      if (isClient(c.me) && r.creator_id !== c.me.id) return yield* new NoAccess()
      const people = yield* projectPeople(p)
      const title = r.status === "drafted" ? "Finish your draft" : "Edit doc"
      return yield* render(c, title, html`<h1>${title}</h1>${docForm(c, p, null, people, r, [])}`, yield* crumbsFor(p, r.parent_id))
    })),

  post("/projects/:id/docs/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.did, "doc")
      if (isClient(c.me) && r.creator_id !== c.me.id) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const ch = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!ch.title)
        return yield* render(c, "Edit doc", html`<h1>Edit doc</h1>${docForm(c, p, null, people, { ...r, ...ch }, ["Your doc needs a title."])}`, yield* crumbsFor(p, r.parent_id), 422)
      const u = yield* updateRecording(c, r, ch, { quiet: r.status === "drafted" })
      if (r.status === "drafted" && fd.get("publish") === "1") {
        yield* publishDraft(c, u, p, notifyIdsFrom(fd, people, c.me))
        return redirect(urlFor(u))
      }
      return redirect(r.status === "drafted" ? "/my/drafts" : urlFor(u), "Saved.")
    })),

  // Uploads
  get("/projects/:id/uploads/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const folder = yield* findFolder(c, p, c.query.get("folder"))
      const people = yield* projectPeople(p)
      return yield* render(c, "Upload files", html`<h1>Upload files</h1>${uploadForm(c, p, folder, people, [])}`, yield* crumbsFor(p, folder?.id ?? null))
    })),

  post("/projects/:id/uploads", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const people = yield* projectPeople(p)
      const files = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0)
      if (!files.length)
        return yield* render(c, "Upload files", html`<h1>Upload files</h1>${uploadForm(c, p, folder, people, ["Choose at least one file to upload."], str(fd, "body"))}`, yield* crumbsFor(p, folder?.id ?? null), 422)
      const posted: Recording[] = []
      const failed: string[] = []
      for (const file of files) {
        const r = yield* createRecording(c, {
          project: p, type: "upload", parent_id: folder?.id ?? null, title: safeName(file.name), body: str(fd, "body"),
          data: { filename: safeName(file.name), size: file.size, content_type: file.type || "application/octet-stream", versions: [] },
          visible_to_clients: fd.get("visible_to_clients") === "on", verb: "uploaded a file",
        })
        const rel = yield* Effect.tryPromise(() => file.arrayBuffer()).pipe(
          Effect.flatMap((buf) => store(r.id, file.name, buf)),
          Effect.catchCause(() => Effect.succeed(null)),
        )
        if (!rel) {
          yield* sql`delete from recordings where id = ${r.id}`
          failed.push(file.name)
          continue
        }
        const data = { ...r.data, path: rel }
        yield* sql`update recordings set data = ${JSON.stringify(data)} where id = ${r.id}`
        yield* sql`update versions set data = ${JSON.stringify(data)} where recording_id = ${r.id}`
        posted.push({ ...r, data })
      }
      const notifyIds = notifyIdsFrom(fd, people, c.me)
      if (posted.length && notifyIds.length) {
        yield* subscribe(posted[0]!.id, notifyIds)
        yield* notify(c, { personIds: notifyIds, recording: posted[0]!, kind: "upload",
          summary: posted.length === 1 ? `${c.me.name} uploaded ${posted[0]!.title}` : `${c.me.name} uploaded ${posted.length} files` })
      }
      if (failed.length) return redirect(backTo(p, folder), `${failed[0]} didn't upload. Check your connection and try again.`)
      return redirect(posted.length === 1 ? urlFor(posted[0]!) : backTo(p, folder), posted.length > 1 ? `Posted ${posted.length} files.` : undefined)
    })),

  get("/projects/:id/uploads/:uid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project: p } = yield* findRecording(c, c.params.uid, "upload")
      const people = yield* projectPeople(p)
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      const versions = (r.data.versions ?? []) as any[]
      const [link] = yield* sql`select 1 from public_links where recording_id = ${r.id}`
      const ct = String(r.data.content_type ?? "")
      const raw = `/uploads/${r.id}/raw`
      yield* trackVisit(c, urlFor(r), r.title, p.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  <h1>📎 ${r.title}</h1>
  ${byLine(author, r.created_at, c.me.time_zone)}
  ${ct.startsWith("image/") ? html`<p><img src="${raw}" alt="${r.title}"></p>`
    : ct.startsWith("video/") ? html`<p><video src="${raw}" controls width="640"></video></p>`
    : ct === "application/pdf" ? html`<p><embed src="${raw}" type="application/pdf" width="640" height="480"></p>`
    : html`<p><i>No preview for this kind of file.</i></p>`}
  <p>${r.data.filename} · ${fmtSize(Number(r.data.size ?? 0))} · ${ct || "unknown type"}</p>
  ${r.body ? html`<div>${fmt(r.body)}</div>` : ""}
</article>
<p><a href="/uploads/${r.id}/download" data-button>Download</a></p>
${r.status === "active" ? html`
<form method="post" action="/projects/${p.id}/uploads/${r.id}/versions" enctype="multipart/form-data">
  <label>Upload a new version <input type="file" name="file" required></label> <button>Upload</button>
</form>` : ""}
<p><a href="/r/${r.id}/history">Versions (${versions.length + 1})</a>
  ${r.status === "active" ? html` · <a href="/projects/${p.id}/uploads/${r.id}/edit">Rename or add a note</a>` : ""}
  ${!isClient(c.me) ? html` · <a href="/r/${r.id}/public-link">${link ? "Public link is on" : "Share a public link"}</a>` : ""}</p>
${versions.length ? html`<h2>Older versions</h2><ul>${[...versions].reverse().map((v) => html`<li>${v.filename} · ${fmtSize(Number(v.size ?? 0))} · ${fmtDate(v.at, c.me.time_zone)}
  <a href="/uploads/${r.id}/download?version=${encodeURIComponent(v.path)}">Download</a></li>`)}</ul>` : ""}
${yield* itemFooter(c, r, p)}`, yield* crumbsFor(p, r.parent_id))
    })),

  get("/projects/:id/uploads/:uid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.uid, "upload")
      if (isClient(c.me) && r.creator_id !== c.me.id) return yield* new NoAccess()
      return yield* render(c, "Edit file", html`
<h1>Edit file</h1>
<form method="post" action="/projects/${p.id}/uploads/${r.id}/edit">
  ${textField("Name", "title", r.title, { required: true })}
  ${textArea("Note", "body", r.body)}
  <p><button>Save changes</button> <a href="${urlFor(r)}">Cancel</a></p>
</form>`, yield* crumbsFor(p, r.parent_id))
    })),

  post("/projects/:id/uploads/:uid/edit", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.uid, "upload")
      if (isClient(c.me) && r.creator_id !== c.me.id) return yield* new NoAccess()
      const fd = yield* c.form
      if (!str(fd, "title")) return redirect(`/projects/${r.project_id}/uploads/${r.id}/edit`, "The file needs a name.")
      const u = yield* updateRecording(c, r, { title: str(fd, "title"), body: str(fd, "body") })
      return redirect(urlFor(u), "Saved.")
    })),

  post("/projects/:id/uploads/:uid/versions", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.uid, "upload")
      if (r.status !== "active") return redirect(urlFor(r))
      const file = (yield* c.form).get("file")
      if (!file || typeof file === "string" || file.size === 0) return redirect(urlFor(r), "Choose a file to upload as the new version.")
      const rel = yield* Effect.tryPromise(() => file.arrayBuffer()).pipe(Effect.flatMap((buf) => store(r.id, file.name, buf)), Effect.catchCause(() => Effect.succeed(null)))
      if (!rel) return redirect(urlFor(r), `${file.name} didn't upload. Check your connection and try again.`)
      const old = { path: r.data.path, filename: r.data.filename, size: r.data.size, content_type: r.data.content_type, at: r.updated_at, person_id: r.creator_id }
      const u = yield* updateRecording(c, r, {
        title: r.title,
        data: { path: rel, filename: safeName(file.name), size: file.size, content_type: file.type || "application/octet-stream", versions: [...(r.data.versions ?? []), old] },
      }, { summary: `uploaded a new version of ${r.title}` })
      return redirect(urlFor(u), "New version uploaded.")
    })),

  get("/uploads/:uid/raw", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.uid, "upload")
      return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), true)
    })),

  get("/uploads/:uid/download", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.uid, "upload")
      const version = c.query.get("version")
      if (version && version !== r.data.path) {
        if (!(yield* versionBelongs(r, version))) return yield* new NotFound()
        const v = (r.data.versions ?? []).find((x: any) => x.path === version)
        return yield* sendFile(version, v?.filename ?? version.split("/").pop()!.replace(/^\d+-/, ""), String(v?.content_type ?? ""), false)
      }
      return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), false)
    })),

  // Cloud files
  get("/projects/:id/cloudfiles/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const folder = yield* findFolder(c, p, c.query.get("folder"))
      const people = yield* projectPeople(p)
      return yield* render(c, "Link a cloud file", html`<h1>Link a cloud file</h1><p>Google Docs, Sheets, Dropbox, anything with a URL.</p>${cloudForm(p, folder, people, {}, [])}`, yield* crumbsFor(p, folder?.id ?? null))
    })),

  post("/projects/:id/cloudfiles", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const people = yield* projectPeople(p)
      const url = str(fd, "url")
      const l = { title: str(fd, "title") || url, data: { url }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!isUrl(url))
        return yield* render(c, "Link a cloud file", html`<h1>Link a cloud file</h1>${cloudForm(p, folder, people, { ...l, title: str(fd, "title") }, ["That doesn't look like a link."])}`, yield* crumbsFor(p, folder?.id ?? null), 422)
      const r = yield* createRecording(c, { project: p, type: "cloudfile", parent_id: folder?.id ?? null, ...l, verb: "linked a file" })
      return redirect(urlFor(r))
    })),

  get("/projects/:id/cloudfiles/:cid", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.cid, "cloudfile")
      const people = yield* projectPeople(p)
      const author = r.creator_id ? yield* personById(r.creator_id) : null
      yield* trackVisit(c, urlFor(r), r.title, p.id)
      return yield* render(c, r.title, html`
${statusBanner(r)}
${clientBanner(c, r, people.some(isClient))}
<article>
  <h1>🔗 ${r.title}</h1>
  ${byLine(author, r.created_at, c.me.time_zone)}
  <p><a href="${r.data.url}" target="_blank" rel="noopener noreferrer">Open ${r.data.url}</a></p>
</article>
${r.status === "active" ? html`<p><a href="/projects/${p.id}/cloudfiles/${r.id}/edit">Edit</a></p>` : ""}
${yield* itemFooter(c, r, p)}`, yield* crumbsFor(p, r.parent_id))
    })),

  get("/projects/:id/cloudfiles/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.cid, "cloudfile")
      return yield* render(c, "Edit link", html`<h1>Edit link</h1>${cloudForm(p, null, [], r, [])}`, yield* crumbsFor(p, r.parent_id))
    })),

  post("/projects/:id/cloudfiles/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.cid, "cloudfile")
      const fd = yield* c.form
      const url = str(fd, "url")
      const ch = { title: str(fd, "title") || url, data: { url } }
      if (!isUrl(url)) return yield* render(c, "Edit link", html`<h1>Edit link</h1>${cloudForm(p, null, [], { ...r, ...ch }, ["That doesn't look like a link."])}`, yield* crumbsFor(p, r.parent_id), 422)
      const u = yield* updateRecording(c, r, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  // Public links
  get("/r/:id/public-link", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r, project: p } = yield* findRecording(c, c.params.id, "upload")
      if (isClient(c.me)) return yield* new NoAccess()
      const [link] = yield* sql<{ token: string }>`select token from public_links where recording_id = ${r.id}`
      return yield* render(c, "Public link", html`
<h1>Public link for “${r.title}”</h1>
<p>Share one file with someone who isn't in Saintsflow.</p>
${link ? html`
<p><label>The link <input readonly size="60" value="${c.url.origin}/p/${link.token}" onclick="this.select()"></label>
  <button type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.querySelector('input').value)">Copy</button></p>
<p>Anyone with this link can see and download this file. Turn it off any time.</p>
<form method="post" action="/r/${r.id}/public-link"><input type="hidden" name="on" value=""><button>Turn off the link</button></form>`
: html`
<p>Anyone with the link will be able to see and download this file, even without an account.</p>
<form method="post" action="/r/${r.id}/public-link"><input type="hidden" name="on" value="1"><button>Share a public link</button></form>`}
<p><a href="${urlFor(r)}">Back to the file</a></p>`, yield* crumbsFor(p, r.parent_id))
    })),

  post("/r/:id/public-link", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r } = yield* findRecording(c, c.params.id, "upload")
      if (isClient(c.me)) return yield* new NoAccess()
      if ((yield* c.form).get("on") === "1") {
        yield* sql`insert into public_links (token, recording_id) values (${crypto.randomUUID().replace(/-/g, "")}, ${r.id}) on conflict do nothing`
        yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "shared", summary: `turned on a public link for ${r.title}` })
        return redirect(`/r/${r.id}/public-link`, "Public link is on.")
      }
      yield* sql`delete from public_links where recording_id = ${r.id}`
      return redirect(`/r/${r.id}/public-link`, "Public link turned off. The old link no longer works.")
    })),

  pubGet("/p/:token", (c) =>
    Effect.gen(function* () {
      const r = yield* findPublic(c)
      return yield* render(c, r.title, html`
<h1>${r.title}</h1>
<p>${r.data.filename} · ${fmtSize(Number(r.data.size ?? 0))}</p>
<p><a href="/p/${c.params.token}/download" data-button>Download</a></p>
<p><small>Shared with a public link from Saintsflow.</small></p>`)
    })),

  pubGet("/p/:token/download", (c) =>
    Effect.gen(function* () {
      const r = yield* findPublic(c)
      return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), false)
    })),
]

// ---------- sample data ----------
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#1d4ed8"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">Northwind</text></svg>`

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob } = s.people
    const web = s.projects.website
    const brand = yield* createRecording(s.as(ann), { project: web, type: "folder", title: "Brand assets", data: { color: "blue" }, visible_to_clients: true })
    const logos = yield* createRecording(s.as(ann), { project: web, type: "folder", parent_id: brand.id, title: "Logos", visible_to_clients: true })
    yield* createRecording(s.as(ann), { project: web, type: "folder", title: "Research", data: { color: "green" } })
    const copy = yield* createRecording(s.as(maya), {
      project: web, type: "doc", title: "Homepage copy, draft 2",
      body: "Northwind sells kitchen tools that last.\n\nHeadline: Buy it once.\nSubhead: Pans, knives and boards built for twenty years of dinners.",
      visible_to_clients: true, notifyIds: [ann.id], verb: "posted a doc",
    })
    yield* updateRecording(s.as(ann), copy, { body: copy.body + "\n\nCTA: See the collection" }, { summary: `edited ${copy.title}` })
    yield* createRecording(s.as(bob), { project: web, type: "doc", title: "Tech notes: hosting", body: "Static site on a CDN. No CMS (see the idea post)." })

    const addFile = (by: typeof maya, parent: number | null, name: string, type: string, bytes: string, visible = false) =>
      Effect.gen(function* () {
        const r = yield* createRecording(s.as(by), {
          project: web, type: "upload", parent_id: parent, title: name, visible_to_clients: visible,
          data: { filename: name, size: new TextEncoder().encode(bytes).length, content_type: type, versions: [] }, verb: "uploaded a file",
        })
        const rel = yield* store(r.id, name, bytes)
        const data = { ...r.data, path: rel }
        yield* sql`update recordings set data = ${JSON.stringify(data)} where id = ${r.id}`
        yield* sql`update versions set data = ${JSON.stringify(data)} where recording_id = ${r.id}`
      })
    yield* addFile(ann, logos.id, "northwind-logo.svg", "image/svg+xml", LOGO_SVG, true)
    yield* addFile(bob, null, "meeting-notes.txt", "text/plain", "Kickoff call\n- Six weeks\n- Static site\n- Dan signs off on copy\n")
    yield* createRecording(s.as(maya), {
      project: web, type: "cloudfile", title: "Sitemap (Google Sheet)", data: { url: "https://docs.google.com/spreadsheets/d/example" }, verb: "linked a file",
    })
  })

