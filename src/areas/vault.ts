// Files: folders, docs, uploads (with versions), cloud links, public links.
// Pages: client/areas/vault.tsx. This file is what their forms post to, plus the file downloads and the public link lookup.
//
//   POST /projects/:id/folders                 new folder           POST /projects/:id/folders/:fid/edit
//   POST /projects/:id/docs                    new doc (or draft)   POST /projects/:id/docs/:did/edit   (and publish a draft)
//   POST /projects/:id/uploads                 upload files         POST /projects/:id/uploads/:uid/edit
//   POST /projects/:id/uploads/:uid/versions   a new version of a file
//   GET  /uploads/:uid/raw                     the file, inline when that's safe
//   GET  /uploads/:uid/download                the file (or ?version=<path>), as a download
//   POST /projects/:id/cloudfiles              link a file elsewhere  POST /projects/:id/cloudfiles/:cid/edit
//   POST /r/:id/public-link                    public link on / off   (not clients)
//   GET  /p/:token                             what the public page shows   (public)
//   GET  /p/:token/download                    the file behind a public link (public)
//
// Clients can add things, and can only change what they made.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { resolve, sep, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { get, post, pubGet, redirect, invalid, json, str, num, isClient, NoAccess, NotFound, type Ctx, type PubCtx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, toolUrl, urlFor, titleOf,
  notifyIdsFrom, notify, subscribe, logEvent, clientVisibleFrom, type Project, type Recording,
} from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]

// ─── Storage ───────────────────────────────────────────────────────────────
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
const store = (recordingId: number, filename: string, bytes: ArrayBuffer | Uint8Array | string) => Effect.promise(async () => {
  const rel = `${recordingId}/${Date.now()}-${safeName(filename)}`
  await mkdir(resolve(STORAGE, String(recordingId)), { recursive: true })
  await Bun.write(resolve(STORAGE, rel), bytes)
  return rel
})

/** Store an uploaded File. Null when reading or writing it failed (a dropped connection). */
const storeUpload = (recordingId: number, file: File) =>
  Effect.tryPromise(() => file.arrayBuffer()).pipe(
    Effect.flatMap((buf) => store(recordingId, file.name, buf)),
    Effect.catchCause(() => Effect.succeed(null)),
  )

/**
 * Serve a stored file. Inline only for types browsers render safely; everything else downloads.
 * Chat attachments go through here too (chat.ts), so nothing uploaded can run on our origin.
 */
export const sendFile = (rel: string, filename: string, contentType: string, inline: boolean) => Effect.gen(function* () {
  const abs = storagePath(rel)
  if (!abs) return yield* new NotFound()
  const f = Bun.file(abs)
  if (!(yield* Effect.promise(() => f.exists()))) return yield* new NotFound()

  const bytes       = new Uint8Array(yield* Effect.promise(() => f.arrayBuffer()))
  const renderable  = /^(image\/(png|jpe?g|gif|webp|svg\+xml)|video\/|audio\/|application\/pdf$)/.test(contentType)
  const disposition = inline && renderable ? "inline" : "attachment"
  return HttpServerResponse.uint8Array(bytes, {
    contentType: contentType || "application/octet-stream",
    headers: {
      "content-disposition":     `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "x-content-type-options":  "nosniff",
      // SVGs and PDFs can carry scripts; never let them run on our origin.
      "content-security-policy": "sandbox",
    },
  })
})

// ─── Helpers ───────────────────────────────────────────────────────────────

const isUrl = (s: string) => {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

const readColor = (fd: FormData) => (COLORS.includes(str(fd, "color")) ? str(fd, "color") : "")

/** A folder in this project to put things in, from a form value. null = top level. */
const findFolder = (c: Ctx, p: Project, id: string | null | undefined) => Effect.gen(function* () {
  const fid = num(id)
  if (!fid) return null
  const { r, project } = yield* findRecording(c, fid, "folder")
  if (project.id !== p.id || r.status !== "active") return yield* new NotFound()
  return r
})

/** A recording to change: clients only their own. */
const findToChange = (c: Ctx, id: string | undefined, type: string) => Effect.gen(function* () {
  const found = yield* findRecording(c, id, type)
  if (isClient(c.me) && found.r.creator_id !== c.me.id) return yield* new NoAccess()
  return found
})

const backTo = (p: Project, folder: Recording | null) => (folder ? urlFor(folder) : toolUrl(p, "vault"))

/** Is `path` the current file or one of this upload's older versions? */
const versionBelongs = (r: Recording, path: string) => Effect.gen(function* () {
  if (path === r.data.path)                                      return true
  if ((r.data.versions ?? []).some((v: any) => v.path === path)) return true
  const sql   = yield* SqlClient.SqlClient
  const [row] = yield* sql`select 1 from versions where recording_id = ${r.id} and data->>'path' = ${path}`
  return !!row
})

/** The upload behind a public link, while the link, the file and its project are all still there. */
const findPublic = (c: PubCtx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [r] = yield* sql<Recording>`
    select r.* from public_links l join recordings r on r.id = l.recording_id join projects p on p.id = r.project_id
    where l.token = ${c.params.token ?? ""} and r.status = 'active' and r.type = 'upload' and p.status <> 'trashed'`
  if (!r) return yield* new NotFound()
  return r
})

/** A draft doc goes live: now is its posting time, and whoever was picked hears about it. */
const publishDraft = (c: Ctx, r: Recording, project: Project, notifyIds: number[]) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`update recordings set status = 'active', created_at = now(), updated_at = now() where id = ${r.id}`
  const live = { ...r, status: "active" as const }
  yield* subscribe(r.id, [c.me.id, ...notifyIds])
  yield* logEvent(c, { project_id: project.id, recording_id: r.id, action: "created", summary: `posted a doc: ${titleOf(r)}` })
  if (notifyIds.length) yield* notify(c, { personIds: notifyIds, recording: live, kind: "doc", summary: `${c.me.name} posted a doc: ${titleOf(r)}` })
})

// ─── Folders ───────────────────────────────────────────────────────────────

// A folder inside another one inherits whether clients see it.
const newFolder = post("/projects/:id/folders", (c) => Effect.gen(function* () {
  const p      = yield* findProject(c, c.params.id)
  const fd     = yield* c.form
  const parent = yield* findFolder(c, p, str(fd, "folder_id"))
  const title  = str(fd, "title")
  if (!title) return invalid(["Your folder needs a name."])

  const r = yield* createRecording(c, {
    project:            p,
    type:               "folder",
    tool:               str(fd, "tool"),
    parent_id:          parent?.id ?? null,
    title,
    data:               { color: readColor(fd) },
    visible_to_clients: parent ? parent.visible_to_clients : undefined,
    verb:               "made a folder",
  })
  return redirect(urlFor(r))
}))

const editFolder = post("/projects/:id/folders/:fid/edit", (c) => Effect.gen(function* () {
  const { r } = yield* findToChange(c, c.params.fid, "folder")
  const fd    = yield* c.form
  const title = str(fd, "title")
  if (!title) return invalid(["Your folder needs a name."])

  const updated = yield* updateRecording(c, r, { title, data: { color: readColor(fd) } })
  return redirect(urlFor(updated), "Saved.")
}))

// ─── Docs ──────────────────────────────────────────────────────────────────

const newDoc = post("/projects/:id/docs", (c) => Effect.gen(function* () {
  const p      = yield* findProject(c, c.params.id)
  const fd     = yield* c.form
  const folder = yield* findFolder(c, p, str(fd, "folder_id"))
  const people = yield* projectPeople(p)
  const title  = str(fd, "title")
  if (!title) return invalid(["Your doc needs a title."])

  const isDraft = fd.get("draft") === "1"
  const r = yield* createRecording(c, {
    project:            p,
    type:               "doc",
    tool:               str(fd, "tool"),
    parent_id:          folder?.id ?? null,
    title,
    body:               str(fd, "body"),
    visible_to_clients: clientVisibleFrom(fd, people, undefined),
    status:             isDraft ? "drafted" : "active",
    notifyIds:          isDraft ? [] : notifyIdsFrom(fd, people, c.me),
    verb:               "posted a doc",
  })

  if (isDraft) return redirect("/my/drafts", "Saved as a draft.")
  return redirect(urlFor(r))
}))

const editDoc = post("/projects/:id/docs/:did/edit", (c) => Effect.gen(function* () {
  const { r, project } = yield* findToChange(c, c.params.did, "doc")
  const fd     = yield* c.form
  const people = yield* projectPeople(project)
  const title  = str(fd, "title")
  if (!title) return invalid(["Your doc needs a title."])

  const wasDraft = r.status === "drafted"
  const updated  = yield* updateRecording(c, r, {
    title,
    body:               str(fd, "body"),
    visible_to_clients: clientVisibleFrom(fd, people, r.visible_to_clients),
  }, { quiet: wasDraft })   // editing a draft tells nobody

  if (wasDraft && fd.get("publish") === "1") {
    yield* publishDraft(c, updated, project, notifyIdsFrom(fd, people, c.me))
    return redirect(urlFor(updated))
  }
  if (wasDraft) return redirect("/my/drafts", "Saved.")
  return redirect(urlFor(updated), "Saved.")
}))

// ─── Uploads ───────────────────────────────────────────────────────────────

// Each file becomes its own upload. A file that fails to store is dropped, and the rest still post.
const uploadFiles = post("/projects/:id/uploads", (c) => Effect.gen(function* () {
  const sql    = yield* SqlClient.SqlClient
  const p      = yield* findProject(c, c.params.id)
  const fd     = yield* c.form
  const folder = yield* findFolder(c, p, str(fd, "folder_id"))
  const people = yield* projectPeople(p)
  const files  = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0)
  if (!files.length) return invalid(["Choose at least one file to upload."])

  const posted: Recording[] = []
  const failed: string[]    = []
  for (const file of files) {
    const r = yield* createRecording(c, {
      project:            p,
      type:               "upload",
      tool:               str(fd, "tool"),
      parent_id:          folder?.id ?? null,
      title:              safeName(file.name),
      body:               str(fd, "body"),
      data:               { filename: safeName(file.name), size: file.size, content_type: file.type || "application/octet-stream", versions: [] },
      visible_to_clients: clientVisibleFrom(fd, people, undefined),
      verb:               "uploaded a file",
    })

    const rel = yield* storeUpload(r.id, file)
    if (!rel) {
      yield* sql`delete from recordings where id = ${r.id}`
      failed.push(file.name)
      continue
    }

    // The recording was made before the file had a path; give it (and its first version) one.
    const data = { ...r.data, path: rel }
    yield* sql`update recordings set data = ${JSON.stringify(data)} where id = ${r.id}`
    yield* sql`update versions set data = ${JSON.stringify(data)} where recording_id = ${r.id}`
    posted.push({ ...r, data })
  }

  // One notification for the batch, about the first file.
  const notifyIds = notifyIdsFrom(fd, people, c.me)
  if (posted.length && notifyIds.length) {
    const first   = posted[0]!
    const summary = posted.length === 1 ? `${c.me.name} uploaded ${first.title}` : `${c.me.name} uploaded ${posted.length} files`
    yield* subscribe(first.id, notifyIds)
    yield* notify(c, { personIds: notifyIds, recording: first, kind: "upload", summary })
  }

  if (failed.length)       return redirect(backTo(p, folder), `${failed[0]} didn't upload. Check your connection and try again.`)
  if (posted.length === 1) return redirect(urlFor(posted[0]!))
  return redirect(backTo(p, folder), `Posted ${posted.length} files.`)
}))

const editUpload = post("/projects/:id/uploads/:uid/edit", (c) => Effect.gen(function* () {
  const { r } = yield* findToChange(c, c.params.uid, "upload")
  const fd    = yield* c.form
  if (!str(fd, "title")) return redirect(`/projects/${r.project_id}/uploads/${r.id}/edit`, "The file needs a name.")

  const updated = yield* updateRecording(c, r, { title: str(fd, "title"), body: str(fd, "body") })
  return redirect(urlFor(updated), "Saved.")
}))

// The old file stays, listed in data.versions, and can still be downloaded.
const uploadVersion = post("/projects/:id/uploads/:uid/versions", (c) => Effect.gen(function* () {
  const { r } = yield* findToChange(c, c.params.uid, "upload")
  if (r.status !== "active") return redirect(urlFor(r))

  const file = (yield* c.form).get("file")
  if (!file || typeof file === "string" || file.size === 0) return redirect(urlFor(r), "Choose a file to upload as the new version.")

  const rel = yield* storeUpload(r.id, file)
  if (!rel) return redirect(urlFor(r), `${file.name} didn't upload. Check your connection and try again.`)

  const old = { path: r.data.path, filename: r.data.filename, size: r.data.size, content_type: r.data.content_type, at: r.updated_at, person_id: r.creator_id }
  const updated = yield* updateRecording(c, r, {
    title: r.title,
    data: {
      path:         rel,
      filename:     safeName(file.name),
      size:         file.size,
      content_type: file.type || "application/octet-stream",
      versions:     [...(r.data.versions ?? []), old],
    },
  }, { summary: `uploaded a new version of ${r.title}` })
  return redirect(urlFor(updated), "New version uploaded.")
}))

const rawFile = get("/uploads/:uid/raw", (c) => Effect.gen(function* () {
  const { r } = yield* findRecording(c, c.params.uid, "upload")
  return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), true)
}))

// ?version=<path> downloads an older version, but only one that belongs to this upload.
const downloadFile = get("/uploads/:uid/download", (c) => Effect.gen(function* () {
  const { r }   = yield* findRecording(c, c.params.uid, "upload")
  const version = c.query.get("version")

  if (version && version !== r.data.path) {
    if (!(yield* versionBelongs(r, version))) return yield* new NotFound()
    const v        = (r.data.versions ?? []).find((x: any) => x.path === version)
    const filename = v?.filename ?? version.split("/").pop()!.replace(/^\d+-/, "")
    return yield* sendFile(version, filename, String(v?.content_type ?? ""), false)
  }
  return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), false)
}))

// ─── Cloud files (links to files elsewhere) ────────────────────────────────

const newCloudFile = post("/projects/:id/cloudfiles", (c) => Effect.gen(function* () {
  const p      = yield* findProject(c, c.params.id)
  const fd     = yield* c.form
  const folder = yield* findFolder(c, p, str(fd, "folder_id"))
  const people = yield* projectPeople(p)
  const url    = str(fd, "url")
  if (!isUrl(url)) return invalid(["That doesn't look like a link."])

  const r = yield* createRecording(c, {
    project:            p,
    type:               "cloudfile",
    tool:               str(fd, "tool"),
    parent_id:          folder?.id ?? null,
    title:              str(fd, "title") || url,
    data:               { url },
    visible_to_clients: clientVisibleFrom(fd, people, undefined),
    verb:               "linked a file",
  })
  return redirect(urlFor(r))
}))

const editCloudFile = post("/projects/:id/cloudfiles/:cid/edit", (c) => Effect.gen(function* () {
  const { r } = yield* findToChange(c, c.params.cid, "cloudfile")
  const fd    = yield* c.form
  const url   = str(fd, "url")
  if (!isUrl(url)) return invalid(["That doesn't look like a link."])

  const updated = yield* updateRecording(c, r, { title: str(fd, "title") || url, data: { url } })
  return redirect(urlFor(updated), "Saved.")
}))

// ─── Public links ──────────────────────────────────────────────────────────

const togglePublicLink = post("/r/:id/public-link", (c) => Effect.gen(function* () {
  const sql   = yield* SqlClient.SqlClient
  const { r } = yield* findRecording(c, c.params.id, "upload")
  if (isClient(c.me)) return yield* new NoAccess()

  if ((yield* c.form).get("on") === "1") {
    yield* sql`insert into public_links (token, recording_id) values (${crypto.randomUUID().replace(/-/g, "")}, ${r.id}) on conflict do nothing`
    yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "shared", summary: `turned on a public link for ${r.title}` })
    return redirect(`/r/${r.id}/public-link`, "Public link is on.")
  }

  // Turning it off deletes the token, so the old link stops working for good.
  yield* sql`delete from public_links where recording_id = ${r.id}`
  return redirect(`/r/${r.id}/public-link`, "Public link turned off. The old link no longer works.")
}))

// The signed-out page reads this (public_links only sync to the item's viewers).
const publicLinkInfo = pubGet("/p/:token", (c) => Effect.gen(function* () {
  const r = yield* findPublic(c)
  return json({ title: r.title, filename: r.data.filename ?? "file", size: Number(r.data.size ?? 0) })
}))

const publicLinkDownload = pubGet("/p/:token/download", (c) => Effect.gen(function* () {
  const r = yield* findPublic(c)
  return yield* sendFile(r.data.path ?? "", r.data.filename ?? "file", String(r.data.content_type ?? ""), false)
}))

export const routes = [
  newFolder,
  editFolder,
  newDoc,
  editDoc,
  uploadFiles,
  editUpload,
  uploadVersion,
  rawFile,
  downloadFile,
  newCloudFile,
  editCloudFile,
  togglePublicLink,
  publicLinkInfo,
  publicLinkDownload,
]

// ─── Sample data ───────────────────────────────────────────────────────────

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#1d4ed8"/><text x="60" y="26" font-family="sans-serif" font-size="16" fill="#fff" text-anchor="middle">Northwind</text></svg>`

export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const { maya, ann, bob } = s.people
  const web = s.projects.website

  const brand = yield* createRecording(s.as(ann), { project: web, type: "folder", title: "Brand assets", data: { color: "blue" }, visible_to_clients: true })
  const logos = yield* createRecording(s.as(ann), { project: web, type: "folder", parent_id: brand.id, title: "Logos", visible_to_clients: true })
  yield* createRecording(s.as(ann), { project: web, type: "folder", title: "Research", data: { color: "green" } })

  const copy = yield* createRecording(s.as(maya), {
    project:            web,
    type:               "doc",
    title:              "Homepage copy, draft 2",
    body:               "Northwind sells kitchen tools that last.\n\nHeadline: Buy it once.\nSubhead: Pans, knives and boards built for twenty years of dinners.",
    visible_to_clients: true,
    notifyIds:          [ann.id],
    verb:               "posted a doc",
  })
  yield* updateRecording(s.as(ann), copy, { body: copy.body + "\n\nCTA: See the collection" }, { summary: `edited ${copy.title}` })
  yield* createRecording(s.as(bob), { project: web, type: "doc", title: "Tech notes: hosting", body: "Static site on a CDN. No CMS (see the idea post)." })
  yield* createRecording(s.as(ann), { project: web, type: "doc", tool: "vault-2", title: "Northwind brand notes", body: "Our colors, our voice, and the words we never use.", visible_to_clients: true })

  const addFile = (by: typeof maya, parent: number | null, name: string, type: string, bytes: string, visible = false) => Effect.gen(function* () {
    const r = yield* createRecording(s.as(by), {
      project:            web,
      type:               "upload",
      parent_id:          parent,
      title:              name,
      visible_to_clients: visible,
      data:               { filename: name, size: new TextEncoder().encode(bytes).length, content_type: type, versions: [] },
      verb:               "uploaded a file",
    })
    const rel  = yield* store(r.id, name, bytes)
    const data = { ...r.data, path: rel }
    yield* sql`update recordings set data = ${JSON.stringify(data)} where id = ${r.id}`
    yield* sql`update versions set data = ${JSON.stringify(data)} where recording_id = ${r.id}`
  })
  yield* addFile(ann, logos.id, "northwind-logo.svg", "image/svg+xml", LOGO_SVG, true)
  yield* addFile(bob, null,     "meeting-notes.txt",  "text/plain",    "Kickoff call\n- Six weeks\n- Static site\n- Dan signs off on copy\n")

  yield* createRecording(s.as(maya), {
    project: web,
    type:    "cloudfile",
    title:   "Sitemap (Google Sheet)",
    data:    { url: "https://docs.google.com/spreadsheets/d/example" },
    verb:    "linked a file",
  })
})
