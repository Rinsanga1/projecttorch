// "Every item works the same": comments, boosts, subscribers, the ••• menu, move/copy, history,
// bookmarks, bubble ups, trash, archive and client visibility, for any recording. Posts: src/areas/items.ts.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db, temp } from "../store.ts"
import { me, findRecording, findProject, projectPeople, peopleByIds, subscriberIds, comments, boostsOn, visibleProjects, recordings, NotFound, useApi } from "../data.ts"
import { isClient, titleOf, urlFor, TYPE_NAMES, type Project, type Recording } from "../../shared/domain.ts"
import { fmtDateTime, ms, plural } from "../../shared/format.ts"
import { Face, Fmt, kit, menu, sx } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes, PostOnOpen } from "../ui/forms.tsx"
import { Page, crumbsFor, page } from "../ui/page.tsx"
import { color, radius, space, text } from "../ui/tokens.stylex.ts"

// ---------- pieces other areas render ----------

/** Banner at the top of a trashed / archived / drafted item. */
export const StatusBanner = ({ r, trashedBy }: { r: Recording; trashedBy?: string | null }) => {
  if (r.status === "trashed") {
    const left = Math.max(0, 30 - Math.floor((Date.now() - ms(r.trashed_at ?? new Date())) / 86_400_000))
    return (
      <div role="note">
        <p><b>This {TYPE_NAMES[r.type] ?? "item"} is in the trash.</b> {trashedBy ?? "Someone"} put it there on {fmtDateTime(r.trashed_at)}. It'll be deleted forever in {plural(left, "day")}.</p>
        <Form action={`/r/${r.id}/restore`}><button>Put it back</button></Form>
      </div>
    )
  }
  if (r.status === "archived")
    return (
      <div role="note">
        <p><b>This is archived.</b> It's read-only until you unarchive it.</p>
        <Form action={`/r/${r.id}/unarchive`}><button>Unarchive</button></Form>
      </div>
    )
  if (r.status === "drafted") return <div role="note"><p><b>This is a draft.</b> Only you can see it.</p></div>
  return null
}

// Drawn at the file icons' stroke, in currentColor.
const Svg = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
)
const EYE = `<path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/>`
const LOCK = `<rect x="3" y="7" width="10" height="7" rx="2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`

/** Visible-to-clients banner, only for projects with clients. */
export const ClientBanner = ({ r, hasClients }: { r: Recording; hasClients: boolean }) =>
  hasClients && !isClient(me())
    ? <p {...sx(fs.vis)}><Svg d={r.visible_to_clients ? EYE : LOCK} /><span>{r.visible_to_clients ? "This is visible to clients." : "Clients can't see this."}</span> <a href={`/r/${r.id}/clients`}>Change</a></p>
    : null

// The bottom of every item page, kept short so the record stays the biggest thing: the boost pills and a quiet "React",
// the comment thread, a one-line comment box that opens as you write, and one line about who gets notified.
const fs = stylex.create({
  vis: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: text.sm, color: color.muted },
  menuFor: { color: color.muted, marginBottom: space.s6 },
  boosts: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, marginBlock: space.s5 },
  boost: {
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, paddingBlock: 4, paddingInline: 12,
    borderRadius: radius.pill, backgroundColor: color.tile, fontSize: text.sm,
  },
  boostMine: { paddingRight: 4 },
  boostWho: { color: color.muted, fontSize: text.xs },
  unboost: { minHeight: 24, width: 24, padding: 0, fontSize: text.base, lineHeight: 1, backgroundColor: color.sheet },
  boostForm: { display: "inline-flex", alignItems: "center", gap: 6, margin: 0 },
  boostInput: { width: "13rem", minHeight: 32, paddingBlock: 3, borderRadius: radius.pill, fontSize: text.sm },
  boostButton: { minHeight: 32 },
  section: { marginTop: space.s7, paddingTop: space.s6, borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: color.line },
  heading: { marginTop: 0, marginBottom: space.s4 },
  comment: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, paddingBlock: space.s4 },
  commentHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, marginBottom: 2 },
  commentBody: { maxWidth: "70ch" },
  commentMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s3, marginTop: space.s2, marginBottom: 0, fontSize: text.sm },
  quiet: { color: color.muted, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  box: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, marginTop: space.s3, padding: space.s4, borderRadius: radius.xl, backgroundColor: color.tile },
  // One line until you're writing in it (focused, or with text in it), then room to write.
  boxField: { width: "100%", maxWidth: "none", backgroundColor: color.sheet, resize: "none", minHeight: { default: "6.5em", ":placeholder-shown": { default: "2.75em", ":focus": "6.5em" } } },
  reactOpen: { display: "inline-flex", margin: 0 },
  subsLine: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, marginTop: space.s6, fontSize: text.sm, color: color.muted },
  hints: { display: "grid", gap: 2, marginBlock: space.s2 },
  hint: { margin: 0 },
  stack: { display: "flex", flexShrink: 0, paddingLeft: 8 },
  stacked: { marginLeft: -8, borderRadius: radius.pill, borderWidth: 2, borderStyle: "solid", borderColor: color.sheet, display: "inline-flex" },
  more: { marginTop: space.s6, marginBottom: 0 },
})

/** A boost pill per reaction; yours carry a remove button (optimistic). */
const BoostList = observer(({ recordingId }: { recordingId: number }) => {
  const m = me()
  return (
    <>
      {boostsOn(recordingId).map((b) => (
        <span key={b.id} {...sx(fs.boost, b.person_id === m.id && fs.boostMine)}>
          {b.content} <span {...sx(fs.boostWho)}>{db.people.get(String(b.person_id))?.name}</span>
          {b.person_id === m.id && (
            <Form action={`/reactions/${b.id}/delete`} style={{ display: "inline" }} optimistic={() => db.boosts.delete(String(b.id))}>
              <button title="Remove your reaction" aria-label="Remove your reaction" {...sx(fs.unboost)}>×</button>
            </Form>
          )}
        </span>
      ))}
    </>
  )
})

/** Add a boost right away; the server's row replaces the stand-in. */
const addBoost = (recordingId: number) => (fd: FormData) => {
  const content = String(fd.get("content") ?? "").trim()
  if (content && [...content].length <= 16) temp("boosts", { recording_id: recordingId, person_id: me().id, content, created_at: new Date().toISOString() })
}

/** Boosts, comments, subscribers and the ••• link. Goes at the bottom of every item page. */
export const ItemFooter = observer(({ r, project, showComments = true }: { r: Recording; project: Project; showComments?: boolean }) => {
  const m = me()
  const thread = showComments ? comments(r.id) : []
  const subs = peopleByIds(subscriberIds(r.id))
  const subscribed = subs.some((p) => p.id === m.id)
  const pool = projectPeople(project)
  const readOnly = r.status !== "active"
  return (
    <>
      <section aria-label="Reactions" {...sx(fs.boosts)}>
        <BoostList recordingId={r.id} />
        {!readOnly && (
          <details {...sx(fs.reactOpen)}>
            <summary>React</summary>
            <Form action={`/r/${r.id}/reactions`} optimistic={addBoost(r.id)} {...sx(fs.boostForm)}>
              <input name="content" maxLength={16} size={16} placeholder="An emoji or a few words" aria-label="Reaction" required autoFocus {...sx(fs.boostInput)} />{" "}
              <button data-quiet {...sx(fs.boostButton)}>Add</button>
            </Form>
          </details>
        )}
      </section>
      {showComments && (
        <section aria-label="Comments" id="comments" {...sx(fs.section)}>
          {thread.length > 0 && <h2 {...sx(fs.heading)}>Comments</h2>}
          {thread.map((cm) => {
            const author = db.people.get(String(cm.creator_id))
            const bs = boostsOn(cm.id)
            return (
              <article key={cm.id} id={`comment-${cm.id}`} {...sx(fs.comment)}>
                <Face p={author ?? { name: "Someone" }} />
                <div>
                  <p {...sx(fs.commentHead)}><b>{author?.name}</b> <small>{cm.via ? `via ${cm.via} · ` : ""}{fmtDateTime(cm.created_at, m.time_zone)}{ms(cm.updated_at) - ms(cm.created_at) > 1000 ? " (edited)" : ""}</small></p>
                  <Fmt text={cm.body} {...sx(fs.commentBody)} />
                  {bs.length > 0 && <p {...sx(fs.commentMeta)}><small>Reactions: {bs.map((b) => `${b.content} ${db.people.get(String(b.person_id))?.name ?? ""}`).join(", ")}</small></p>}
                  <p {...sx(fs.commentMeta)}>
                    <a href={`/r/${cm.id}/reactions`} data-row-action {...sx(fs.quiet)}>React</a>
                    {cm.creator_id === m.id && !readOnly && <><a href={`/r/${r.id}/comments/${cm.id}/edit`} {...sx(fs.quiet)}>Edit</a> <a href={`/r/${cm.id}/trash`} {...sx(fs.quiet)}>Delete</a></>}
                  </p>
                </div>
              </article>
            )
          })}
          {!readOnly && (
            <Form action={`/r/${r.id}/comments`} data-composer {...sx(fs.box)}>
              <Face p={m} />
              <div>
                <p><textarea name="body" rows={1} cols={70} placeholder="Add a comment…" aria-label="Add a comment" required {...sx(fs.boxField)} /></p>
                {/* The rest shows once you're writing (app.css [data-composer]). */}
                <div data-composer-more>
                  <div {...sx(fs.hints)}>
                    <p {...sx(fs.hint)}><small>Mention someone with @: {pool.filter((p) => p.id !== m.id).map((p) => `@${p.name.split(" ")[0]}`).join(", ")}</small></p>
                    <p {...sx(fs.hint)}><small>This notifies {plural(subs.filter((p) => p.id !== m.id).length, "person", "people")}. <a href={`/r/${r.id}/subscribers`}>Who's that?</a></small></p>
                  </div>
                  <p><button>Add this comment</button></p>
                </div>
              </div>
            </Form>
          )}
        </section>
      )}
      <section aria-label="Who gets notified" {...sx(fs.subsLine)}>
        <span {...sx(fs.stack)} aria-hidden="true">{subs.slice(0, 6).map((p) => <span key={p.id} {...sx(fs.stacked)}><Face p={p} px={24} /></span>)}</span>
        <span title={subs.map((p) => p.name).join(", ")}>{subscribed ? `${plural(subs.length, "person", "people")} get notified of new comments` : "You're not notified of new comments"}</span>
        <a href={`/r/${r.id}/subscribers`}>Change</a>
        <Form
          action={`/r/${r.id}/${subscribed ? "unsubscribe" : "subscribe"}`} style={{ display: "inline" }}
          optimistic={() => (subscribed ? db.subscriptions.delete(`${r.id}:${m.id}`) : db.subscriptions.set(`${r.id}:${m.id}`, { recording_id: r.id, person_id: m.id }))}
        >
          <button data-quiet {...sx(kit.linkButton)}>{subscribed ? "Unsubscribe me" : "Subscribe me"}</button>
        </Form>
      </section>
      <p {...sx(fs.more)}><a href={`/r/${r.id}/menu`}>••• More options for this {TYPE_NAMES[r.type] ?? "item"}</a></p>
    </>
  )
})

// ---------- move / copy destinations ----------

/** Which parent types a recording can live under. null = top level of the tool. Mirrors src/areas/items.ts. */
const DEST: Record<string, { parentTypes: string[]; topLevel: boolean }> = {
  message: { parentTypes: [], topLevel: true },
  todo: { parentTypes: ["todo"], topLevel: true },
  folder: { parentTypes: ["folder"], topLevel: true },
  doc: { parentTypes: ["folder"], topLevel: true },
  upload: { parentTypes: ["folder"], topLevel: true },
  cloudfile: { parentTypes: ["folder"], topLevel: true },
  event: { parentTypes: [], topLevel: true },
  card: { parentTypes: ["column"], topLevel: false },
}

/** Where "Edit" goes for each type. Areas own the edit pages. */
const EDIT_PATHS: Record<string, (r: Recording) => string> = {
  message: (r) => `/projects/${r.project_id}/posts/${r.id}/edit`,
  todo: (r) => `/projects/${r.project_id}/tasks/${r.id}/edit`,
  folder: (r) => `/projects/${r.project_id}/folders/${r.id}/edit`,
  doc: (r) => `/projects/${r.project_id}/docs/${r.id}/edit`,
  cloudfile: (r) => `/projects/${r.project_id}/cloudfiles/${r.id}/edit`,
  event: (r) => `/projects/${r.project_id}/events/${r.id}/edit`,
  card: (r) => `/projects/${r.project_id}/cards/${r.id}/edit`,
  upload: (r) => `/projects/${r.project_id}/uploads/${r.id}/edit`,
}

/** The recording named by the route's :id. */
const useItem = (param = "id", type?: string) => findRecording(useParams()[param], type)

// ---------- pages ----------
export const routes = [
  /** Go to wherever a recording lives. */
  page("/r/:id/go", () => {
    const { r } = useItem()
    const hash = location.hash
    if (r.type === "comment") return <Navigate replace to={`/r/${r.parent_id}/go#comment-${r.id}`} />
    return <Navigate replace to={urlFor(r) + (urlFor(r).includes("#") ? "" : hash)} />
  }),

  page("/r/:id/line", () => {
    const { r, project } = useItem("id", "line")
    return <Navigate replace to={project.kind === "ping" ? `/chats/${project.id}#line-${r.id}` : `/projects/${project.id}/chat#line-${r.id}`} />
  }),

  page("/r/:id/comments/:cid/edit", () => {
    const { r, project } = useItem()
    const { r: cm } = useItem("cid", "comment")
    if (cm.creator_id !== me().id) throw new NotFound()
    return (
      <Page title="Edit comment" crumbs={crumbsFor(project, r)}>
        <h1>Edit your comment</h1>
        <p>On <a href={urlFor(r)}>{titleOf(r)}</a></p>
        <Form action={`/r/${r.id}/comments/${cm.id}`}>
          <p><textarea name="body" rows={6} cols={70} required defaultValue={cm.body} /></p>
          <button>Save changes</button> <a href={`${urlFor(r)}#comment-${cm.id}`}>Cancel</a>
        </Form>
      </Page>
    )
  }),

  page("/r/:id/reactions", () => {
    const { r, project } = useItem()
    return (
      <Page title="React" crumbs={crumbsFor(project, r)}>
        <h1>React</h1>
        <p>Reply to “<a href={urlFor(r)}>{titleOf(r)}</a>” with an emoji or a few words.</p>
        {boostsOn(r.id).length ? <BoostList recordingId={r.id} /> : <p>No reactions yet.</p>}
        <Form action={`/r/${r.id}/reactions`} optimistic={addBoost(r.id)}>
          <p><label>An emoji or a few words (16 letters or less)<br /><input name="content" maxLength={16} required autoFocus /></label></p>
          <button>React</button>
        </Form>
        <p><a href="/my/reactions">All your reactions, sent and received</a></p>
      </Page>
    )
  }),

  page("/r/:id/subscribers", () => {
    const { r, project } = useItem()
    return (
      <Page title="Subscribers" crumbs={crumbsFor(project, r)}>
        <h1>Who gets notified about new comments?</h1>
        <p>On <a href={urlFor(r)}>{titleOf(r)}</a></p>
        <Form action={`/r/${r.id}/subscribers`}>
          <PeopleCheckboxes name="person_ids" people={projectPeople(project)} checked={subscriberIds(r.id)} />
          <button>Save changes</button> <a href={urlFor(r)}>Cancel</a>
        </Form>
      </Page>
    )
  }),

  // The ••• menu
  page("/r/:id/menu", () => {
    const { r, project } = useItem()
    const m = me()
    const bookmarked = [...db.bookmarks.values()].some((b) => b.person_id === m.id && b.recording_id === r.id)
    const hasClients = projectPeople(project).some(isClient)
    const movable = !!DEST[r.type]
    const editPath = EDIT_PATHS[r.type]?.(r)
    return (
      <Page title="Options" crumbs={crumbsFor(project, r)}>
        <h1>{titleOf(r)}</h1>
        <p {...sx(fs.menuFor)}>Options for this {TYPE_NAMES[r.type] ?? "item"}</p>
        <menu.Wrap>
          <menu.Group label="Change" items={[
            editPath && r.status === "active" && <menu.Link href={editPath}>Edit</menu.Link>,
            movable && <menu.Link href={`/r/${r.id}/move?mode=move`}>Move</menu.Link>,
            movable && <menu.Link href={`/r/${r.id}/move?mode=copy`}>Copy</menu.Link>,
            r.type === "message" && <menu.Post action={`/r/${r.id}/pin`}>{r.data.pinned ? "Unpin from top" : "Pin to top"}</menu.Post>,
          ]} />
          <menu.Group label="Keep track" items={[
            <menu.Post action={`/r/${r.id}/bookmark`}>{bookmarked ? "Remove bookmark" : "Bookmark"}</menu.Post>,
            <menu.Link href={`/r/${r.id}/remind`}>Remind me later…</menu.Link>,
            <menu.Link href={`/r/${r.id}/subscribers`}>Notifications (who's subscribed)</menu.Link>,
            <menu.Link href={`/r/${r.id}/history`}>History</menu.Link>,
          ]} />
          <menu.Group label="Share" items={[
            <menu.Copy label="Copy link" value={`${location.origin}${urlFor(r)}`} />,
            hasClients && !isClient(m) && <menu.Link href={`/r/${r.id}/clients`}>{r.visible_to_clients ? "Hide from clients" : "Show to clients"}</menu.Link>,
          ]} />
          <menu.Group label="Archive or trash" items={[
            r.status === "active" && r.type !== "comment" && <menu.Post action={`/r/${r.id}/archive`}>Archive</menu.Post>,
            r.status === "archived" && <menu.Post action={`/r/${r.id}/unarchive`}>Unarchive</menu.Post>,
            r.status !== "trashed" ? <menu.Link href={`/r/${r.id}/trash`} danger>Put in the trash</menu.Link> : <menu.Post action={`/r/${r.id}/restore`}>Put it back</menu.Post>,
          ]} />
        </menu.Wrap>
        <p {...sx(kit.links)}><a href={urlFor(r)}>Back to the {TYPE_NAMES[r.type] ?? "item"}</a></p>
      </Page>
    )
  }),

  // Move / copy
  page("/r/:id/move", () => {
    const { r, project } = useItem()
    const [q] = useSearchParams()
    const d = DEST[r.type]
    if (!d) throw new NotFound()
    const mode = q.get("mode") === "copy" ? "copy" : "move"
    const verb = mode === "move" ? "Move" : "Copy"
    const targetId = Number(q.get("project_id")) || null
    // Projects you're on (or all-access ones, unless you're a client): where you can put things.
    const m = me()
    const projects = visibleProjects().filter((p) => (p.all_access && !isClient(m)) || [...db.project_people.values()].some((pp) => pp.project_id === p.id && pp.person_id === m.id))
    if (!targetId)
      return (
        <Page title={verb} crumbs={crumbsFor(project, r)}>
          <h1>{verb} “{titleOf(r)}”</h1>
          <GetForm method="get" action={`/r/${r.id}/move`}>
            <input type="hidden" name="mode" value={mode} />
            <p><label>Pick a project<br /><select name="project_id" defaultValue={project.id}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></p>
            <button>Next</button> <a href={urlFor(r)}>Cancel</a>
          </GetForm>
        </Page>
      )
    const target = findProject(targetId)
    const parents = d.parentTypes.length
      ? recordings((x) => x.project_id === target.id && d.parentTypes.includes(x.type) && x.status === "active" && x.id !== r.id)
          .sort((a, b) => a.type.localeCompare(b.type) || a.position - b.position)
      : []
    return (
      <Page title={verb} crumbs={crumbsFor(project, r)}>
        <h1>{verb} “{titleOf(r)}” to {target.name}</h1>
        <Form action={`/r/${r.id}/move`}>
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="project_id" value={target.id} />
          {d.parentTypes.length > 0 && (
            <p><label>Pick a destination<br /><select name="parent_id">
              {d.topLevel && <option value="">Top level</option>}
              {parents.map((p) => <option key={p.id} value={p.id}>{TYPE_NAMES[p.type]}: {titleOf(p)}</option>)}
            </select></label></p>
          )}
          {d.parentTypes.length && !d.topLevel && !parents.length
            ? <p role="alert">{target.name} doesn't have a {d.parentTypes.map((t) => TYPE_NAMES[t]).join(" or ")} to put this in yet.</p>
            : <button>{mode === "move" ? "Move it" : "Copy it"}</button>}
          <a href={`/r/${r.id}/move?mode=${mode}`}>Back</a>
        </Form>
      </Page>
    )
  }),

  // History: versions come from the server.
  page("/r/:id/history", () => {
    const { r, project } = useItem()
    const tz = me().time_zone
    const { data: vs, error } = useApi<Array<{ id: number; title: string; body: string; data: any; name: string | null; created_at: string }>>(`/r/${r.id}/history`)
    return (
      <Page title="History" crumbs={crumbsFor(project, r)}>
        <h1>History of “{titleOf(r)}”</h1>
        {error && <p role="alert">{error}</p>}
        {vs && (
          <>
            <p>{plural(vs.length, "version")}, newest first. Text that changed from the version before is marked.</p>
            {vs.map((v, i) => {
              const prev = vs[i + 1]
              return (
                <article key={v.id}>
                  <h2>{i === 0 ? "Current version" : `Version ${vs.length - i}`}</h2>
                  <p><small>{v.name ?? "Someone"} · {fmtDateTime(v.created_at, tz)}</small></p>
                  {v.title && <p><b>{prev && prev.title !== v.title ? <mark>{v.title}</mark> : v.title}</b></p>}
                  {prev && prev.body !== v.body ? <div><mark>Changed:</mark><br /><Fmt text={v.body} /></div> : <Fmt text={v.body} />}
                  {r.type === "upload" && v.data?.path && <p><a href={`/api/uploads/${r.id}/download?version=${encodeURIComponent(v.data.path)}`}>Download this version ({v.data.filename})</a></p>}
                </article>
              )
            })}
          </>
        )}
        <p><a href={urlFor(r)}>Back</a></p>
      </Page>
    )
  }),

  // Bubble up
  page("/r/:id/remind", () => {
    const { r, project } = useItem()
    return (
      <Page title="Remind me later" crumbs={crumbsFor(project, r)}>
        <h1>Remind me about “{titleOf(r)}”</h1>
        <p>We'll show it in your Updates when you pick.</p>
        <Form action={`/r/${r.id}/remind`}>
          <p>
            <label><input type="radio" name="when" value="later_today" defaultChecked /> Later today (in 4 hours)</label><br />
            <label><input type="radio" name="when" value="tomorrow" /> Tomorrow morning</label><br />
            <label><input type="radio" name="when" value="next_week" /> Next week</label><br />
            <label><input type="radio" name="when" value="custom" /> Pick a date and time:</label> <input type="datetime-local" name="at" />
          </p>
          <button>Remind me</button> <a href={urlFor(r)}>Cancel</a>
        </Form>
        <p><a href="/my/reminders">Your reminders</a></p>
      </Page>
    )
  }),

  // Trash
  page("/r/:id/trash", () => {
    const { r, project } = useItem()
    return (
      <Page title="Trash it?" crumbs={crumbsFor(project, r)}>
        <h1>Put this in the trash?</h1>
        <p>“{titleOf(r)}”{r.type !== "comment" ? " and everything in it" : ""}. You can put it back for 30 days.</p>
        <Form action={`/r/${r.id}/trash`}><button>Yes, put it in the trash</button> <a href={urlFor(r)}>Never mind</a></Form>
      </Page>
    )
  }),

  page("/r/:id/undo-trash", () => {
    const { id } = useParams()
    return <Page title="Putting it back"><p>Putting it back…</p><PostOnOpen action={`/r/${id}/undo-trash`} /></Page>
  }),

  // Client visibility
  page("/r/:id/clients", () => {
    const { r, project } = useItem()
    if (isClient(me())) throw new NotFound()
    return (
      <Page title="Client visibility" crumbs={crumbsFor(project, r)}>
        <h1>{r.visible_to_clients ? "Hide this from clients?" : "Make this visible to clients?"}</h1>
        <p>{r.visible_to_clients ? "Clients won't see it or any of its comments anymore." : "They'll see it and every comment on it."}</p>
        <Form action={`/r/${r.id}/clients`}>
          <input type="hidden" name="visible" value={r.visible_to_clients ? "" : "on"} />
          <button>{r.visible_to_clients ? "Yes, hide it from clients" : "Yes, show it to clients"}</button> <a href={urlFor(r)}>Never mind</a>
        </Form>
      </Page>
    )
  }),
]
