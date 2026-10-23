// Message Board: the board, new message, message, edit, categories. Posts: src/areas/messages.ts.
import { observer } from "mobx-react-lite"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, findProject, findRecording, projectPeople, personById, recordings, commentCount, inWindow, useVisit, NoAccess, type PersonWithCompany } from "../data.ts"
import { isAdmin, isClient, urlFor, windowQuery, windowUrl, type Category, type Project, type Recording, type Tool } from "../../shared/domain.ts"
import { excerpt, fmtDate, ms } from "../../shared/format.ts"
import { ByLine, Face, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, NotifyPicker, submitOnChange, TextArea, TextField } from "../ui/forms.tsx"
import { NewTag, useWindow, WindowField } from "../ui/in-window.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"

const categories = (): Category[] =>
  [...db.categories.values()].filter((k) => k.account_id === me().account_id).sort((a, b) => a.name.localeCompare(b.name))

const MessageForm = ({ p, w, cats, people, m }: { p: Project; w: Tool; cats: Category[]; people: PersonWithCompany[]; m: Partial<Recording> }) => {
  // A new post or a draft: notify people, offer "Save as a draft".
  const fresh = !m.id || m.status === "drafted"
  return (
    <Form action={m.id ? `/projects/${p.id}/posts/${m.id}/edit` : `/projects/${p.id}/posts`}>
      {!m.id && <WindowField w={w} />}
      <p><label>Pick a category (optional)<br /><select name="category_id" defaultValue={String(m.data?.category_id ?? "")}><option value="">None</option>
        {cats.map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}
      </select></label> <small><a href="/categories">Edit categories</a></small></p>
      <TextField label="Title" name="title" value={m.title ?? ""} required placeholder="Type a title…" />
      <TextArea label="Post" name="body" value={m.body ?? ""} placeholder="Write away…" />
      {fresh && <NotifyPicker people={people} me={me()} />}
      <ClientSwitch project={p} people={people} current={m.visible_to_clients} />
      <p>
        <button name="publish" value="1">{fresh ? "Share this post" : "Save changes"}</button>{" "}
        {fresh && <><button name="draft" value="1">Save as a draft</button>{" "}</>}
        <a href={m.id ? urlFor(m as Recording) : windowUrl(p, w)}>{m.id ? "Cancel" : "Discard"}</a>
      </p>
    </Form>
  )
}

const Tags = ({ r, cat, pinned }: { r: Recording; cat: Category | undefined; pinned: string }) =>
  r.data.pinned || cat ? (
    <p {...sx(kit.tags)}>
      {r.data.pinned && <span {...sx(kit.tag, kit.tagAccent)}>{pinned}</span>}
      {cat && <span {...sx(kit.tag)}>{cat.emoji} {cat.name}</span>}
    </p>
  ) : null

const catOf = (cats: Category[], r: Recording) => cats.find((k) => k.id === Number(r.data.category_id))

const Message = observer(({ r, project }: { r: Recording; project: Project }) => {
  const m = me()
  useVisit(urlFor(r), r.title, project.id)
  return (
    <Page title={r.title} crumbs={projectCrumbs(project, "message_board")}>
      <StatusBanner r={r} />
      <ClientBanner r={r} hasClients={projectPeople(project).some(isClient)} />
      <article>
        <Tags r={r} cat={catOf(categories(), r)} pinned="Pinned to the top" />
        <h1>{r.title}</h1>
        <ByLine who={personById(r.creator_id)} when={r.created_at} tz={m.time_zone} via={r.via} />
        <Fmt text={r.body} {...sx(kit.prose)} />
      </article>
      <ItemFooter r={r} project={project} />
    </Page>
  )
})

export const routes = [
  page("/projects/:id/posts", () => {
    const [q] = useSearchParams()
    const p = findProject(useParams().id)
    const w = useWindow(p, "message_board")
    const here = inWindow(p, w.id)
    useVisit(windowUrl(p, w), `${p.name}: ${w.name}`, p.id)
    const m = me()
    const cats = categories()
    const catId = Number(q.get("category")) || null
    const msgs = recordings((r) => r.project_id === p.id && r.type === "message" && r.status === "active" && here(r) && (!catId || Number(r.data.category_id) === catId))
      .sort((a, b) => Number(!!b.data.pinned) - Number(!!a.data.pinned) || ms(b.created_at) - ms(a.created_at))
    const drafts = recordings((r) => r.project_id === p.id && r.type === "message" && r.status === "drafted" && r.creator_id === m.id && here(r)).length
    return (
      <Page title={w.name} crumbs={projectCrumbs(p)}>
        <PageHead title={w.name} actions={[p.status === "active" && <a key="new" href={`/projects/${p.id}/posts/new${windowQuery(w)}`} data-button>Write a post</a>]} />
        {/* The category filter earns its row once there are enough posts to sort through. */}
        {(msgs.length > 5 || catId) && <GetForm method="get" ref={submitOnChange} {...sx(kit.toolbar)}>
          {w.id !== w.type && <input type="hidden" name="w" value={w.id} />}
          <label>Category <select name="category" key={catId ?? ""} defaultValue={catId ?? ""} {...sx(kit.toolbarControl)}><option value="">All posts</option>
            {cats.map((k) => <option key={k.id} value={k.id}>{k.emoji} {k.name}</option>)}</select></label>
        </GetForm>}
        {msgs.length === 0 ? (
          <p {...sx(kit.empty)}>{catId ? "No posts in this category." : "Share news, ideas, and updates with the team. Start with “Write a post”."}</p>
        ) : (
          <ul {...sx(kit.rows)}>
            {msgs.map((x) => {
              const author = personById(x.creator_id)
              const n = commentCount(x.id)
              return (
                <li key={x.id} {...sx(kit.row)}>
                  <Face p={author ?? { name: "Someone" }} />
                  <div>
                    <Tags r={x} cat={catOf(cats, x)} pinned="Pinned" />
                    <a href={urlFor(x)} {...sx(kit.rowTitle)}>{x.title}</a><NewTag r={x} />
                    <span {...sx(kit.rowMeta)}>{author?.name ?? "Someone"} · {fmtDate(x.created_at, m.time_zone)}{n ? ` · ${n} comment${n === 1 ? "" : "s"}` : ""}</span>
                    <p {...sx(kit.rowText)}>{excerpt(x.body)}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p {...sx(kit.links)}>
          {drafts > 0 && <a href="/my/drafts">Your drafts ({drafts})</a>}
          <a href="/categories">Edit categories</a>
          <a href={`/projects/${p.id}/trash`}>Archived posts</a>
        </p>
      </Page>
    )
  }),

  page("/projects/:id/posts/new", () => {
    const p = findProject(useParams().id)
    const w = useWindow(p, "message_board")
    return (
      <Page title="Write a post" crumbs={projectCrumbs(p, "message_board")}>
        <h1>Write a post</h1>
        <MessageForm p={p} w={w} cats={categories()} people={projectPeople(p)} m={{}} />
      </Page>
    )
  }),

  page("/projects/:id/posts/:mid", () => {
    const { r, project } = findRecording(useParams().mid, "message")
    if (r.status === "drafted") return <Navigate replace to={`/projects/${project.id}/posts/${r.id}/edit`} />
    return <Message r={r} project={project} />
  }),

  page("/projects/:id/posts/:mid/edit", () => {
    const { r, project } = findRecording(useParams().mid, "message")
    const m = me()
    if (r.creator_id !== m.id && !isAdmin(m)) throw new NoAccess()
    const w = useWindow(project, "message_board")
    const title = r.status === "drafted" ? "Finish your draft" : "Edit post"
    return (
      <Page title={title} crumbs={projectCrumbs(project, "message_board")}>
        <h1>{title}</h1>
        <MessageForm p={project} w={w} cats={categories()} people={projectPeople(project)} m={r} />
      </Page>
    )
  }),

  // Categories (account-wide)
  page("/categories", () => {
    const cats = categories()
    const client = isClient(me())
    return (
      <Page title="Post categories">
        <h1>Post categories</h1>
        <p>Labels with an emoji. You don't have to use them. If you delete one, its posts stay. They just lose the label.</p>
        {cats.length ? (
          <ul>
            {cats.map((k) => (
              <li key={k.id}>
                <Form action={`/categories/${k.id}`} style={{ display: "inline" }}>
                  <input name="emoji" defaultValue={k.emoji} size={3} aria-label="Emoji" /> <input name="name" defaultValue={k.name} aria-label="Name" /> <button>Save</button>
                </Form>
                {!client && <> <Form action={`/categories/${k.id}/delete`} style={{ display: "inline" }}><button>Delete</button></Form></>}
              </li>
            ))}
          </ul>
        ) : <p>No categories yet.</p>}
        {!client && (
          <>
            <h2>Add a category</h2>
            {/* Keyed by the count so the fields clear once the new category shows up. */}
            <Form action="/categories" key={cats.length}>
              <input name="emoji" size={3} placeholder="🙂" aria-label="Emoji" /> <input name="name" required placeholder="Name" aria-label="Name" /> <button>Add a category</button>
            </Form>
          </>
        )}
      </Page>
    )
  }),
]
