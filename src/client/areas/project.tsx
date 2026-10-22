// The project: project home, edit, ••• menu, change tools, people, activity, archived & trashed items, gauge, webhooks.
// Posts: src/areas/project.ts.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useState } from "react"
import { Form as GetForm, Navigate, useParams, useSearchParams } from "react-router"
import { db, temp } from "../store.ts"
import { me, findProject, projectPeople, accountPeople, memberIds, recordings, useApi, useVisit, NoAccess } from "../data.ts"
import { defaultTools, isClient, projectUrl, toolUrl, urlFor, titleOf, TYPE_NAMES, type Project, type Recording, type ToolType } from "../../shared/domain.ts"
import { fmtDate, fmtDateTime, excerpt, plural, isoDate, ms, today } from "../../shared/format.ts"
import { ActivityList } from "../ui/activity.tsx"
import { Face, Fmt, kit, menu, sx } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, font, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"
import { togglePin } from "./home.tsx"

// The pages off the project menu: activity and gauge updates as rows led by a face, trashed and archived items as
// rows with their action at the end, a tile around the forms that add something (a webhook, a gauge update).
const pm = stylex.create({
  row: { display: "grid", gridTemplateColumns: "24px 1fr auto", columnGap: space.s3, alignItems: "start", paddingBlock: 10 },
  time: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  intro: { color: color.muted },
  item: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, justifyContent: "space-between" },
  itemTitle: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: 2, minWidth: 0 },
  tile: { marginTop: space.s6, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  tileTitle: { marginTop: 0 },
  needle: { display: "flex", alignItems: "center", gap: space.s4, marginBottom: space.s5, maxWidth: "none" },
  needleNum: { fontSize: text.xxl, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  meter: { width: "min(100%, 320px)", height: 10 },
  range: { width: "min(100%, 320px)", verticalAlign: "middle" },
  url: { fontFamily: font.mono, fontSize: text.sm, overflowWrap: "anywhere" },
  events: { display: "flex", flexWrap: "wrap", rowGap: space.s2 },
})

const PITCH: Record<ToolType, string> = {
  message_board: "Share news and ideas with the team. Talk them over in one place.",
  todos: "Make lists of work. Give each task to someone and set a due date.",
  vault: "Keep docs, files, and images here. Sort them into folders.",
  campfire: "Chat with the team about anything.",
  schedule: "Add events and dates. Tasks and cards with due dates show up here too.",
  checkins: "Ask the team the same question each day or week, like “What did you get done today?”",
  cardtable: "Move cards from column to column as work gets done. Add your first card to New, or set up columns first.",
  forwards: "Forward emails here so everyone can read them and talk.",
  timesheet: "Log time on any task and it adds up here.",
}

// Project home: the title over a row of facts, then each tool as a tile, kargul's card grid on the white sheet.
const ps = stylex.create({
  head: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: space.s4, marginBottom: space.s5 },
  title: { fontSize: { default: text.xxl, "@media (min-width: 768px)": "2.5rem" }, marginBottom: space.s2 },
  lede: { fontSize: text.md, color: color.muted, marginBottom: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, flexShrink: 0 },
  facts: {
    display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s5, rowGap: space.s2, maxWidth: "none",
    paddingBlock: space.s3, marginBottom: space.s6, borderBlockWidth: 1, borderBlockStyle: "solid", borderBlockColor: color.line,
    fontSize: text.sm, color: color.muted,
  },
  fact: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  factInk: { color: color.ink },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s4, marginBottom: space.s6 },
  tile: {
    position: "relative", backgroundColor: color.tile, borderRadius: radius.xl, paddingBlock: space.s5, paddingInline: space.s5, minHeight: 196,
    display: "flex", flexDirection: "column", gap: space.s3, transitionProperty: "background-color", transitionDuration: motion.fast,
  },
  // A tool tile is one big link to the tool (its title link covers the tile); preview links sit above it.
  linked: { backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } } },
  tileLink: { "::after": { content: "\"\"", position: "absolute", inset: 0, borderRadius: "inherit" } },
  above: { position: "relative", zIndex: 1 },
  tileTitle: { margin: 0, fontSize: text.md, letterSpacing: "-0.02em" },
  tileBody: { margin: 0, fontSize: text.sm, color: color.muted },
  tileText: { margin: 0, fontSize: text.sm },
  list: { margin: 0, fontSize: text.sm },
  item: { borderTopWidth: 0, paddingBlock: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  itemLink: { position: "relative", zIndex: 1, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  more: { display: "flex", flexWrap: "wrap", columnGap: space.s5, rowGap: space.s2, maxWidth: "none", fontSize: text.sm, marginBottom: 0 },
})

const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id
const newestFirst = (a: Recording, b: Recording) => b.created_at.localeCompare(a.created_at)

/** A few lines of live preview for each tool card on the project page; null shows the tool's pitch instead. */
const preview = (p: Project, t: ToolType) => {
  const active = (type: string | string[]) => recordings((r) => r.project_id === p.id && r.status === "active" && (typeof type === "string" ? r.type === type : type.includes(r.type)))
  const items = (rows: ReadonlyArray<Recording>, label: (r: Recording) => string = (r) => titleOf(r)) =>
    rows.length ? <ul {...sx(ps.list)}>{rows.map((r) => <li key={r.id} {...sx(ps.item)}><a href={urlFor(r)} {...sx(ps.itemLink)}>{label(r)}</a></li>)}</ul> : null
  switch (t) {
    case "message_board":
      return items(active("message").sort((a, b) => Number(!!b.data.pinned) - Number(!!a.data.pinned) || newestFirst(a, b)).slice(0, 3))
    case "todos": {
      const todosOf = (list: Recording) => {
        const groups = new Set(recordings((g) => g.parent_id === list.id && g.type === "todogroup").map((g) => g.id))
        return recordings((x) => x.type === "todo" && x.status === "active" && (x.parent_id === list.id || groups.has(x.parent_id!)))
      }
      return items(active("todolist").sort(byPosition).slice(0, 4), (r) => {
        const ts = todosOf(r)
        return `${r.title} (${ts.filter((x) => x.data.completed_at).length}/${ts.length} completed)`
      })
    }
    case "vault":
      return items(active(["folder", "doc", "upload", "cloudfile"]).filter((r) => r.parent_id === null).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3))
    case "campfire": {
      const lines = active("line").sort(newestFirst).slice(0, 3).reverse()
      return lines.length
        ? <ul {...sx(ps.list)}>{lines.map((l) => <li key={l.id} {...sx(ps.item)}><b>{db.people.get(String(l.creator_id))?.name ?? (l.data.chatbot_name ? `${l.data.chatbot_name} (bot)` : "Someone")}:</b> {excerpt(l.body, 80)}</li>)}</ul>
        : null
    }
    case "schedule":
      return items(active("event").filter((r) => r.data.starts_at >= isoDate(new Date())).sort((a, b) => String(a.data.starts_at).localeCompare(b.data.starts_at)).slice(0, 3),
        (r) => `${fmtDate(r.data.starts_at)}: ${r.title}`)
    case "checkins":
      return items(active("question").sort(byPosition).slice(0, 3))
    case "cardtable": {
      const cols = active("column").sort(byPosition)
      return cols.length
        ? <p {...sx(ps.tileText)}>{cols.map((col, i) => `${i ? " · " : ""}${col.title}: ${recordings((k) => k.parent_id === col.id && k.type === "card" && k.status === "active").length}`).join("")}</p>
        : null
    }
    case "forwards":
      return items(active("forward").sort(newestFirst).slice(0, 3))
    case "timesheet": {
      const month = today().slice(0, 7) + "-01"
      const m = [...db.time_entries.values()].filter((e) => e.project_id === p.id && e.on_date >= month).reduce((n, e) => n + e.minutes, 0)
      return m ? <p {...sx(ps.tileText)}>{(m / 60).toFixed(1)} hours logged this month</p> : null
    }
  }
}

const enabledTools = (p: Project) => p.tools.filter((t) => t.enabled)

/** My bookmark of the project itself (not of something in it). */
const projectBookmark = (projectId: number) => {
  const m = me()
  return [...db.bookmarks.values()].find((b) => b.person_id === m.id && b.project_id === projectId && b.recording_id === null)
}
const toggleBookmark = (projectId: number) => () => {
  const b = projectBookmark(projectId)
  if (b) db.bookmarks.delete(String(b.id))
  else temp("bookmarks", { person_id: me().id, project_id: projectId, recording_id: null, created_at: new Date().toISOString() })
}

const useProject = (opts?: { staff?: boolean }) => {
  const p = findProject(useParams().id)
  if (opts?.staff && isClient(me())) throw new NoAccess()
  return p
}

const ProjectHome = observer(({ p }: { p: Project }) => {
  useVisit(projectUrl(p), p.name, p.id)
  const m = me()
  const people = projectPeople(p)
  const clients = people.filter(isClient)
  const tools = isClient(m) ? enabledTools(p).filter((t) => t.type !== "timesheet") : enabledTools(p)
  const doors = recordings((r) => r.project_id === p.id && r.type === "door" && r.status === "active").sort(byPosition)
  const gauge = [...db.gauge_updates.values()].filter((g) => g.project_id === p.id).sort((a, b) => b.id - a.id)[0]
  const bm = projectBookmark(p.id)
  return (
    <Page title={p.name} crumbs={p.kind === "template" ? [["Templates", "/templates"]] : [["Home", "/"]]}>
      {p.kind === "template" && (
        <div role="note"><p><b>This is a template.</b> Changing it doesn't change projects already made from it.</p>
          <p><a href={`/templates/${p.id}/use`} data-button>Make a project from this template</a></p></div>
      )}
      {p.status === "archived" && <div role="note"><p><b>This project is archived.</b> It's read-only.</p>{!isClient(m) && <Form action={`/projects/${p.id}/unarchive`}><button>Unarchive</button></Form>}</div>}
      {p.status === "trashed" && <div role="note"><p><b>This project is in the trash.</b></p><Form action={`/projects/${p.id}/restore`}><button>Put it back</button></Form></div>}
      <div {...sx(ps.head)}>
        <div>
          <h1 {...sx(ps.title)}>{p.name}</h1>
          {p.description && <Fmt text={p.description} {...sx(ps.lede)} />}
        </div>
        <div {...sx(ps.actions)}>
          <Form action={`/projects/${p.id}/bookmark`} style={{ display: "inline" }} optimistic={toggleBookmark(p.id)}><button>{bm ? "Remove bookmark" : "Bookmark"}</button></Form>
          <a href={`/projects/${p.id}/menu`} data-button>••• Project menu</a>
        </div>
      </div>
      <p {...sx(ps.facts)}>
        {(p.starts_on || p.ends_on) && <span {...sx(ps.fact, ps.factInk)}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</span>}
        <span {...sx(ps.fact)}>People: <span {...sx(ps.factInk)}>{people.map((x, i) => <span key={x.id}>{i ? ", " : ""}<a href={`/people/${x.id}`}>{x.name}</a></span>)}{p.all_access && !p.is_hq ? " (and everyone else at the company: all-access)" : ""}</span>
          {!isClient(m) && <a href={`/projects/${p.id}/people`}>Add/remove people</a>}</span>
        {(gauge || !isClient(m)) && (
          <span {...sx(ps.fact)}>Status: {gauge
            ? <><meter min={0} max={100} value={gauge.value}>{gauge.value}%</meter> <span {...sx(ps.factInk)}>{gauge.value}%{gauge.note && <>: {gauge.note}</>}</span></>
            : "not set"} <a href={`/projects/${p.id}/status`}>{gauge ? "Update" : "Set the status"}</a></span>
        )}
        {!isClient(m) && <a href={`/projects/${p.id}/edit`}>Edit name, description & dates</a>}
      </p>
      {clients.length > 0 && !isClient(m) && <p><small>Clients are on this project ({clients.map((x) => x.name).join(", ")}). They only see what you show them. <a href={`/projects/${p.id}/clients`}>Client access</a></small></p>}
      <div {...sx(ps.grid)}>
        {tools.map((t) => (
          <section key={t.type} aria-label={t.name} {...sx(ps.tile, ps.linked)}>
            <h2 {...sx(ps.tileTitle)}><a href={toolUrl(p, t.type)} {...sx(ps.tileLink)}>{t.name}</a></h2>
            {preview(p, t.type) ?? <p {...sx(ps.tileBody)}>{PITCH[t.type]}</p>}
          </section>
        ))}
        {doors.length > 0 && (
          <section aria-label="Links" {...sx(ps.tile)}><h2 {...sx(ps.tileTitle)}>Links</h2><ul {...sx(ps.list)}>{doors.map((d) => (
            <li key={d.id} {...sx(ps.item)}><a href={d.data.url} target="_blank" rel="noopener" {...sx(ps.itemLink)}>{d.title}</a>{d.data.description && <small>: {d.data.description}</small>} <small><a href={`/projects/${p.id}/links/${d.id}`} aria-label="Link options" {...sx(ps.above)}>•••</a></small></li>
          ))}</ul></section>
        )}
      </div>
      <p {...sx(ps.more)}>
        {!isClient(m) && p.status === "active" && <span><a href={`/projects/${p.id}/links/new`}>Add a link</a> <small>(to another tool, like Figma, GitHub, or a Google Drive folder)</small></span>}
        <a href={`/projects/${p.id}/activity`}>See all activity on this project</a>
      </p>
    </Page>
  )
})

/** The people form; "Yes, remove me" shows once the server has said you're removing yourself. */
const PeopleForm = ({ p }: { p: Project }) => {
  const m = me()
  const [confirm, setConfirm] = useState(false)
  // The server's rule, checked as the form goes out, so the confirm box is there when its error shows.
  const removingMe = (fd: FormData) => !fd.getAll("person_ids").includes(String(m.id)) && !p.all_access && !fd.get("confirm_self")
  return (
    <Form action={`/projects/${p.id}/people`} onSubmitCapture={(e) => removingMe(new FormData(e.currentTarget)) && setConfirm(true)}>
      <PeopleCheckboxes name="person_ids" people={accountPeople()} checked={memberIds(p.id)} />
      {confirm && <p><label><input type="checkbox" name="confirm_self" /> Yes, remove me</label></p>}
      {!p.is_hq ? (
        <fieldset><legend>Who can see it?</legend>
          <label><input type="radio" name="access" value="invited" defaultChecked={!p.all_access} /> Just the people checked above</label><br />
          <label><input type="radio" name="access" value="all" defaultChecked={p.all_access} /> Everyone at the company (all-access)</label>
        </fieldset>
      ) : <p>HQ is all-access: everyone at the company can see it.</p>}
      <p><button>Save changes</button> <a href={projectUrl(p)}>Cancel</a></p>
    </Form>
  )
}

const StatusForm = ({ p, value }: { p: Project; value: number }) => {
  const [v, setV] = useState(value)
  return (
    <Form action={`/projects/${p.id}/status`} {...sx(pm.tile)}>
      <p><label>How far along? (0–100)<br /><input type="range" name="value" min={0} max={100} step={5} defaultValue={value} onInput={(e) => setV(Number(e.currentTarget.value))} {...sx(pm.range)} /> <output>{v}</output></label></p>
      <p><label>What changed? (optional)<br /><input name="note" size={60} /></label></p>
      <button>Update status</button>
    </Form>
  )
}

type Delivery = { webhook_id: number; event: string; status: number | null; error: string | null; created_at: string }

export const routes = [
  page("/projects/:id", () => {
    const p = useProject()
    if (p.kind === "ping") return <Navigate replace to={`/chats/${p.id}`} />
    return <ProjectHome p={p} />
  }),

  page("/projects/:id/edit", () => {
    const p = useProject({ staff: true })
    return (
      <Page title="Edit project" crumbs={projectCrumbs(p)}>
        <h1>Edit project details</h1>
        <Form action={`/projects/${p.id}/edit`}>
          <p><label>Name<br /><input name="name" defaultValue={p.name} required /></label></p>
          <p><label>Description<br /><textarea name="description" rows={3} cols={60} defaultValue={p.description ?? ""} /></label></p>
          <p><label>Start date <input type="date" name="starts_on" defaultValue={isoDate(p.starts_on)} /></label>{" "}
            <label>End date <input type="date" name="ends_on" defaultValue={isoDate(p.ends_on)} /></label></p>
          <p><small>Projects with both dates show up on the <a href="/timeline">Timeline</a>.</small></p>
          <p><button>Save changes</button> <a href={projectUrl(p)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  page("/projects/:id/menu", () => {
    const p = useProject()
    const m = me()
    const pin = db.pins.has(`${m.id}:${p.id}`)
    const bm = projectBookmark(p.id)
    const staff = !isClient(m)
    return (
      <Page title="Project menu" crumbs={projectCrumbs(p)}>
        <h1>Project menu</h1>
        <menu.Wrap>
          {staff && <menu.Group label="Project" items={[
            <menu.Link href={`/projects/${p.id}/edit`}>Edit name, description & dates</menu.Link>,
            <menu.Link href={`/projects/${p.id}/tools`}>Change tools</menu.Link>,
            <menu.Link href={`/projects/${p.id}/people`}>Add/remove people</menu.Link>,
            <menu.Link href={`/projects/${p.id}/clients`}>Set up client access</menu.Link>,
          ]} />}
          <menu.Group label="For you" items={[
            <menu.Post action={`/projects/${p.id}/pin`} optimistic={togglePin(p.id)}>{pin ? "Unpin from Home" : "Pin to Home"}</menu.Post>,
            <menu.Post action={`/projects/${p.id}/bookmark`} optimistic={toggleBookmark(p.id)}>{bm ? "Remove bookmark" : "Bookmark"}</menu.Post>,
          ]} />
          <menu.Group label="Records" items={[
            staff && p.kind === "project" && <menu.Post action={`/projects/${p.id}/save-as-template`}>Save as a template</menu.Post>,
            <menu.Link href={`/projects/${p.id}/trash`}>Archived & trashed items</menu.Link>,
            <menu.Link href={`/projects/${p.id}/activity`}>See all activity</menu.Link>,
            staff && <menu.Link href={`/projects/${p.id}/webhooks`}>Webhooks</menu.Link>,
          ]} />
          {staff && <menu.Group label="Archive or trash" items={[
            p.status === "active" && !p.is_hq && <menu.Post action={`/projects/${p.id}/archive`}>Archive this project</menu.Post>,
            p.status === "archived" && <menu.Post action={`/projects/${p.id}/unarchive`}>Unarchive this project</menu.Post>,
            !p.is_hq && p.status !== "trashed" && <menu.Link href={`/projects/${p.id}/trash-project`} danger>Put this project in the trash</menu.Link>,
          ]} />}
        </menu.Wrap>
      </Page>
    )
  }),

  page("/projects/:id/tools", () => {
    const p = useProject({ staff: true })
    const tools = [...p.tools, ...defaultTools().filter((d) => !p.tools.some((t) => t.type === d.type))]
    return (
      <Page title="Change tools" crumbs={projectCrumbs(p)}>
        <h1>Change tools</h1>
        <p>Turning a tool off hides it. Nothing is deleted. Turn it back on and it's all there.</p>
        <Form action={`/projects/${p.id}/tools`}>
          <table><thead><tr><th>On</th><th>Name</th><th>Order</th></tr></thead><tbody>
            {tools.map((t, i) => (
              <tr key={t.type}>
                <td><input type="checkbox" name={`on_${t.type}`} defaultChecked={t.enabled} aria-label={`${t.name} on`} /></td>
                <td><input name={`name_${t.type}`} defaultValue={t.name} aria-label={`Rename ${t.name}`} /></td>
                <td><input type="number" name={`pos_${t.type}`} defaultValue={i + 1} min={1} max={20} size={3} aria-label="Position" /></td>
              </tr>
            ))}
          </tbody></table>
          <p><button>Save changes</button> <a href={projectUrl(p)}>Cancel</a></p>
        </Form>
        <p><a href={`/projects/${p.id}/links/new`}>Add a link</a></p>
      </Page>
    )
  }),

  page("/projects/:id/people", () => {
    const p = useProject({ staff: true })
    return (
      <Page title="People on this project" crumbs={projectCrumbs(p)}>
        <h1>People on {p.name}</h1>
        <PeopleForm p={p} />
        <p><a href={`/people/invite?project_id=${p.id}`}>Invite someone new</a> · <a href={`/projects/${p.id}/clients`}>Clients on this project</a></p>
      </Page>
    )
  }),

  page("/projects/:id/activity", () => {
    const p = useProject()
    const [q] = useSearchParams()
    const personId = Number(q.get("person")) || null
    const pageN = Math.max(1, Number(q.get("page")) || 1)
    const evs = [...db.events.values()]
      .filter((e) => e.project_id === p.id && (!personId || e.person_id === personId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice((pageN - 1) * 50, pageN * 50 + 1)
      .map((e) => {
        const who = db.people.get(String(e.person_id))
        return { ...e, name: who?.name ?? null, avatar_url: who?.avatar_url ?? null }
      })
    return (
      <Page title="Project activity" crumbs={projectCrumbs(p)}>
        <h1>Activity on {p.name}</h1>
        <GetForm method="get" {...sx(kit.toolbar)}><label>Show only what <select name="person" defaultValue={personId ?? ""} {...sx(kit.toolbarControl)}><option value="">everyone</option>
          {projectPeople(p).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> did</label> <button {...sx(kit.toolbarControl)}>Filter</button></GetForm>
        {evs.length ? <ActivityList events={evs.slice(0, 50)} tz={me().time_zone} /> : <p {...sx(kit.empty)}>Nothing's happened yet. Activity shows up here as people post, comment, and check things off.</p>}
        {evs.length > 50 && <p><a href={`?page=${pageN + 1}${personId ? `&person=${personId}` : ""}`}>Show more</a></p>}
      </Page>
    )
  }),

  page("/projects/:id/trash", () => {
    const p = useProject()
    const rows = recordings((r) => r.project_id === p.id && (r.status === "trashed" || r.status === "archived"))
      .sort((a, b) => (b.trashed_at ?? b.updated_at).localeCompare(a.trashed_at ?? a.updated_at))
    const by = (r: Recording) => {
      const e = [...db.events.values()].filter((e) => e.recording_id === r.id && (e.action === "trashed" || e.action === "archived")).sort((a, b) => b.id - a.id)[0]
      return e ? db.people.get(String(e.person_id))?.name ?? null : null
    }
    const trashed = rows.filter((r) => r.status === "trashed")
    const archived = rows.filter((r) => r.status === "archived")
    const daysLeft = (r: Recording) => Math.max(0, 30 - Math.floor((Date.now() - ms(r.trashed_at!)) / 86_400_000))
    return (
      <Page title="Archived & trashed items" crumbs={projectCrumbs(p)}>
        <h1>Archived & trashed items</h1>
        <p {...sx(pm.intro)}>Things in the trash are deleted forever after 30 days.</p>
        {!rows.length && <p {...sx(kit.empty)}>Nothing archived, nothing in the trash.</p>}
        {trashed.length > 0 && <><h2>In the trash</h2><ul {...sx(kit.rows)}>{trashed.map((r) => {
          const who = by(r)
          return (
            <li key={r.id} {...sx(pm.item)}><span {...sx(pm.itemTitle)}><span {...sx(kit.tag)}>{TYPE_NAMES[r.type]}</span> <a href={urlFor(r)}>{titleOf(r)}</a> <small>(trashed {who ? `by ${who} ` : ""}{fmtDate(r.trashed_at)}, {plural(daysLeft(r), "day")} left)</small></span>
              <Form action={`/r/${r.id}/restore`} style={{ display: "inline" }}><button {...sx(kit.toolbarControl)}>Put it back</button></Form></li>
          )
        })}</ul></>}
        {archived.length > 0 && <><h2>Archived</h2><ul {...sx(kit.rows)}>{archived.map((r) => (
          <li key={r.id} {...sx(pm.item)}><span {...sx(pm.itemTitle)}><span {...sx(kit.tag)}>{TYPE_NAMES[r.type]}</span> <a href={urlFor(r)}>{titleOf(r)}</a></span>
            <Form action={`/r/${r.id}/unarchive`} style={{ display: "inline" }}><button {...sx(kit.toolbarControl)}>Unarchive</button></Form></li>
        ))}</ul></>}
      </Page>
    )
  }),

  page("/projects/:id/trash-project", () => {
    const p = useProject()
    if (isClient(me()) || p.is_hq) throw new NoAccess()
    return (
      <Page title="Trash this project?" crumbs={projectCrumbs(p)}>
        <h1>Put {p.name} in the trash?</h1>
        <p>Everything in it goes too. An admin can put it back for 30 days, then it's deleted forever.</p>
        <Form action={`/projects/${p.id}/trash-project`}><button>Yes, put this project in the trash</button> <a href={projectUrl(p)}>Never mind</a></Form>
      </Page>
    )
  }),

  // Gauge
  page("/projects/:id/status", () => {
    const p = useProject()
    const m = me()
    const ups = [...db.gauge_updates.values()].filter((g) => g.project_id === p.id).sort((a, b) => b.id - a.id)
    return (
      <Page title="Status" crumbs={projectCrumbs(p)}>
        <h1>Status of {p.name}</h1>
        <p {...sx(pm.intro)}>How far along is this project? A person sets it. It doesn't count tasks.</p>
        {ups[0] ? <p {...sx(pm.needle)}><span {...sx(pm.needleNum)}>{ups[0].value}%</span> <meter min={0} max={100} value={ups[0].value} {...sx(pm.meter)} /></p> : <p {...sx(pm.intro)}>Not set yet.</p>}
        {!isClient(m) && <StatusForm p={p} value={ups[0]?.value ?? 0} />}
        {ups.length > 0 && <><h2>Past updates</h2><ul {...sx(kit.rows)}>{ups.map((u) => {
          const who = db.people.get(String(u.person_id))
          return (
            <li key={u.id} {...sx(pm.row)}><Face p={{ name: who?.name ?? "Someone", avatar_url: who?.avatar_url }} px={24} />
              <span><b>{u.value}%</b> · {who?.name ?? "Someone"}{u.note && <>: {u.note}</>}</span><small {...sx(pm.time)}>{fmtDateTime(u.created_at, m.time_zone)}</small></li>
          )
        })}</ul></>}
        <p {...sx(kit.links)}><a href="/overview">See every project's status on the Overview</a></p>
      </Page>
    )
  }),

  // Webhooks: the hooks are in the copy, the delivery log comes from the server.
  page("/projects/:id/webhooks", () => {
    const p = useProject({ staff: true })
    const tz = me().time_zone
    const { data: deliveries, error } = useApi<Delivery[]>(`/projects/${p.id}/webhooks/deliveries`)
    const hooks = [...db.webhooks.values()].filter((h) => h.project_id === p.id).sort((a, b) => a.id - b.id)
    return (
      <Page title="Webhooks" crumbs={projectCrumbs(p)}>
        <h1>Webhooks for {p.name}</h1>
        <p {...sx(pm.intro)}>Send what happens in this project to another system.</p>
        {hooks.length ? <ul {...sx(kit.rows)}>{hooks.map((h) => (
          <li key={h.id} {...sx(pm.item)}><span {...sx(pm.itemTitle)}><span {...sx(pm.url)}>{h.url}</span> <small>({h.types.length ? h.types.join(", ") : "every event"})</small></span>
            <span {...sx(kit.actions)}><Form action={`/projects/${p.id}/webhooks/${h.id}/test`} style={{ display: "inline" }}><button {...sx(kit.toolbarControl)}>Send a test</button></Form>
              <Form action={`/projects/${p.id}/webhooks/${h.id}/delete`} style={{ display: "inline" }}><button {...sx(kit.toolbarControl)}>Delete</button></Form></span></li>
        ))}</ul> : <p {...sx(pm.intro)}>No webhooks yet.</p>}
        <section aria-labelledby="add-webhook" {...sx(pm.tile)}><h2 id="add-webhook" {...sx(pm.tileTitle)}>Add a webhook</h2>
          <Form action={`/projects/${p.id}/webhooks`}>
            <p><label>Payload URL<br /><input type="url" name="url" size={60} required placeholder="https://example.com/hook" /></label></p>
            <fieldset><legend>Which events? (none = all)</legend>
              <div {...sx(pm.events)}>{["created", "edited", "completed", "commented", "trashed", "moved", "archived"].map((t) => <label key={t}><input type="checkbox" name="types" value={t} /> {t}</label>)}</div>
            </fieldset>
            <button>Add webhook</button>
          </Form></section>
        <h2>Recent deliveries</h2>
        {error && <p role="alert">{error}</p>}
        {deliveries && (deliveries.length
          ? <ul>{deliveries.map((d, i) => <li key={i}>{fmtDateTime(d.created_at, tz)} · {d.event} · {d.status ?? "failed"}{d.error && <>: We couldn't reach that URL. {d.error}</>}</li>)}</ul>
          : <p {...sx(pm.intro)}>Nothing sent yet.</p>)}
      </Page>
    )
  }),
]
