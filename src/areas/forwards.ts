// Forwarded emails & links: the forwards list, a forwarded email, add a link, a link, edit a link.
// The pages are client/areas/forwards.tsx; these are their posts.
import { Effect } from "effect"
import { post, redirect, invalid, str, isClient, NoAccess } from "../lib/web.ts"
import { findProject, findRecording, createRecording, updateRecording, projectUrl, urlFor, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const address = (p: Project) => (p.email_token ? `${p.email_token}@forwards.saintsflow.test` : null)

const isLink = (u: string) => /^https?:\/\/[^\s.]+\.[^\s]+$/.test(u)

const doorErrors = (d: { title: string; url: string }) => [
  ...(isLink(d.url) ? [] : ["That doesn't look like a link."]),
  ...(d.title ? [] : ["Your link needs a name."]),
]

const readDoor = (fd: FormData) => ({ title: str(fd, "title"), url: str(fd, "url"), description: str(fd, "description"), visible_to_clients: fd.get("visible_to_clients") === "on" })

export const routes = [
  // ponytail: no inbound mail server. This form stands in for mail arriving at the project's address; wire an inbound webhook (Postmark/SES) to the same createRecording call later.
  post("/projects/:id/forwards", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const fd = yield* c.form
      const v = { from: str(fd, "from"), title: str(fd, "title"), body: str(fd, "body") }
      const errs = [...(v.from.includes("@") ? [] : ["Who's the email from? Add their address."]), ...(v.title ? [] : ["Give the email a subject."])]
      if (errs.length) return invalid(errs)
      const r = yield* createRecording(c, {
        project: p, type: "forward", title: v.title, body: v.body,
        data: { from: v.from, to: address(p), original_subject: v.title }, verb: "forwarded an email",
      })
      return redirect(urlFor(r), "Forwarded into the project.")
    })),

  // Links (type "door")
  post("/projects/:id/links", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const d = readDoor(yield* c.form)
      const errs = doorErrors(d)
      if (errs.length) return invalid(errs)
      yield* createRecording(c, { project: p, type: "door", title: d.title, data: { url: d.url, description: d.description }, visible_to_clients: d.visible_to_clients, verb: "added a link" })
      return redirect(projectUrl(p), `Added the ${d.title} link.`)
    })),

  post("/projects/:id/links/:did/edit", (c) =>
    Effect.gen(function* () {
      const { r, project } = yield* findRecording(c, c.params.did, "door")
      if (isClient(c.me)) return yield* new NoAccess()
      const d = readDoor(yield* c.form)
      const errs = doorErrors(d)
      if (errs.length) return invalid(errs)
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
