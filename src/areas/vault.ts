// Files: the vault, folders, docs, uploads (with versions), cloud links, public links.
// The pages are client/areas/vault.tsx; these are their posts, plus the file downloads and the public link lookup.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdir } from "node:fs/promises"
import { resolve, sep, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { get, post, pubGet, redirect, invalid, json, str, num, isClient, NoAccess, NotFound, type Ctx, type PubCtx } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, toolUrl, urlFor, titleOf,
  notifyIdsFrom, notify, subscribe, logEvent, type Project, type Recording,
} from "../lib/core.ts"
import type { Seed } from "../seed.ts"

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

const isUrl = (s: string) => {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]

/** A folder in this project to put things in, from a form value. null = top level. */
const findFolder = (c: Ctx, p: Project, id: string | null | undefined) =>
  Effect.gen(function* () {
    const fid = num(id)
    if (!fid) return null
    const { r, project } = yield* findRecording(c, fid, "folder")
    if (project.id !== p.id || r.status !== "active") return yield* new NotFound()
    return r
  })

const backTo = (p: Project, folder: Recording | null) => (folder ? urlFor(folder) : toolUrl(p, "vault"))

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
  // Folders
  post("/projects/:id/folders", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const f = { title: str(fd, "title"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "" } }
      if (!f.title) return invalid(["Your folder needs a name."])
      const r = yield* createRecording(c, { project: p, type: "folder", parent_id: folder?.id ?? null, ...f, visible_to_clients: folder ? folder.visible_to_clients : undefined, verb: "made a folder" })
      return redirect(urlFor(r))
    })),

  post("/projects/:id/folders/:fid/edit", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.fid, "folder")
      const fd = yield* c.form
      const ch = { title: str(fd, "title"), data: { color: COLORS.includes(str(fd, "color")) ? str(fd, "color") : "" } }
      if (!ch.title) return invalid(["Your folder needs a name."])
      const u = yield* updateRecording(c, r, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  // Docs
  post("/projects/:id/docs", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const people = yield* projectPeople(p)
      const draft = fd.get("draft") === "1"
      const d = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!d.title) return invalid(["Your doc needs a title."])
      const r = yield* createRecording(c, {
        project: p, type: "doc", parent_id: folder?.id ?? null, ...d, status: draft ? "drafted" : "active",
        notifyIds: draft ? [] : notifyIdsFrom(fd, people, c.me), verb: "posted a doc",
      })
      return redirect(draft ? "/my/drafts" : urlFor(r), draft ? "Saved as a draft." : undefined)
    })),

  post("/projects/:id/docs/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project: p } = yield* findRecording(c, c.params.did, "doc")
      if (isClient(c.me) && r.creator_id !== c.me.id) return yield* new NoAccess()
      const fd = yield* c.form
      const people = yield* projectPeople(p)
      const ch = { title: str(fd, "title"), body: str(fd, "body"), visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!ch.title) return invalid(["Your doc needs a title."])
      const u = yield* updateRecording(c, r, ch, { quiet: r.status === "drafted" })
      if (r.status === "drafted" && fd.get("publish") === "1") {
        yield* publishDraft(c, u, p, notifyIdsFrom(fd, people, c.me))
        return redirect(urlFor(u))
      }
      return redirect(r.status === "drafted" ? "/my/drafts" : urlFor(u), "Saved.")
    })),

  // Uploads
  post("/projects/:id/uploads", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const people = yield* projectPeople(p)
      const files = fd.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0)
      if (!files.length) return invalid(["Choose at least one file to upload."])
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
  post("/projects/:id/cloudfiles", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      const fd = yield* c.form
      const folder = yield* findFolder(c, p, str(fd, "folder_id"))
      const url = str(fd, "url")
      const l = { title: str(fd, "title") || url, data: { url }, visible_to_clients: fd.get("visible_to_clients") === "on" }
      if (!isUrl(url)) return invalid(["That doesn't look like a link."])
      const r = yield* createRecording(c, { project: p, type: "cloudfile", parent_id: folder?.id ?? null, ...l, verb: "linked a file" })
      return redirect(urlFor(r))
    })),

  post("/projects/:id/cloudfiles/:cid/edit", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.cid, "cloudfile")
      const fd = yield* c.form
      const url = str(fd, "url")
      const ch = { title: str(fd, "title") || url, data: { url } }
      if (!isUrl(url)) return invalid(["That doesn't look like a link."])
      const u = yield* updateRecording(c, r, ch)
      return redirect(urlFor(u), "Saved.")
    })),

  // Public links
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

  // The signed-out page reads this (public_links only sync to the item's viewers).
  pubGet("/p/:token", (c) =>
    Effect.gen(function* () {
      const r = yield* findPublic(c)
      return json({ title: r.title, filename: r.data.filename ?? "file", size: Number(r.data.size ?? 0) })
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
