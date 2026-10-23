// The project: project home and its windows, edit, ••• menu, people, activity, archived & trashed items, webhooks.
// Posts: src/areas/project.ts.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useEffect, useState, type ReactNode } from "react"
import { Form as GetForm, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router"
import { db, temp } from "../store.ts"
import { me, findProject, projectPeople, accountPeople, memberIds, recordings, commentCount, inWindow, topOf, useApi, useVisit, canInvite, NoAccess } from "../data.ts"
import { closeWindowsMenu, Desk, type DeskWindow } from "../ui/desk.tsx"
import { Icon } from "../ui/icons.tsx"
import { InWindow, WindowId, WindowSince } from "../ui/in-window.tsx"
import { defaultTools, isClient, projectUrl, toolUrl, urlFor, titleOf, TYPE_NAMES, windowIdOf, windowOfPath, windowUrl, type Project, type Recording, type Tool, type ToolType } from "../../shared/domain.ts"
import { fmtDate, fmtDateTime, excerpt, plural, isoDate, ms, today } from "../../shared/format.ts"
import { ActivityList, AgentsFilter, useJustAgents } from "../ui/activity.tsx"
import { Face, Fmt, kit, menu, ProgressBar, sx } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes, PostOnOpen, submitOnChange, usePost } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { color, font, radius, space, text } from "../ui/tokens.stylex.ts"
import { togglePin } from "./home.tsx"
import { lateTasks, progressOf, seenOf, sinceLabel, windowNews } from "../news.ts"

// The pages off the project menu: activity as rows led by a face, trashed and archived items as
// rows with their action at the end, a tile around the forms that add something (a webhook).
const pm = stylex.create({
  row: { display: "grid", gridTemplateColumns: "24px 1fr auto", columnGap: space.s3, alignItems: "start", paddingBlock: 10 },
  time: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  intro: { color: color.muted },
  item: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, justifyContent: "space-between" },
  itemTitle: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: 2, minWidth: 0 },
  tile: { marginTop: space.s6, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  tileTitle: { marginTop: 0 },
  url: { fontFamily: font.mono, fontSize: text.sm, overflowWrap: "anywhere" },
  events: { display: "flex", flexWrap: "wrap", rowGap: space.s2 },
})

const PITCH: Record<ToolType, string> = {
  message_board: "Share news and ideas with the team. Talk them over in one place.",
  todos: "Make a list of what needs doing. Split a big task into subtasks. The bar fills up as things get done.",
  vault: "Keep docs, files, and images here. Sort them into folders.",
  campfire: "Chat with the team about anything.",
  schedule: "Add events and dates. Tasks and cards with due dates show up here too.",
  cardtable: "Move cards from column to column as work gets done. Add your first card to New, or set up columns first.",
}

/** What each kind of window is for, in a few words, for the + menu. */
const MENU_PITCH: Record<ToolType, string> = {
  message_board: "Announcements and write-ups",
  todos: "The tasks that finish the project, with one progress bar",
  vault: "Docs, files and folders",
  campfire: "Quick back-and-forth",
  schedule: "Events and deadlines",
  cardtable: "Cards that move across columns",
}

/** Which window an address is in: the kind from its path, then which one of that kind from its ?w= or the thing it
 * shows (/projects/2/docs/5 is in whichever Files window doc 5 was made in). Null outside every window. */
const windowAt = (p: Project, path: string, search: string): string | null => {
  const type = windowOfPath(path)
  if (!type) return null
  const w = new URLSearchParams(search).get("w")
  if (w && p.tools.some((t) => t.id === w && t.type === type)) return w
  const id = path.split("/").slice(3).find((s) => /^\d+$/.test(s))
  const r = id ? db.recordings.get(id) : undefined
  return (r && r.project_id === p.id && windowIdOf(p, topOf(r))) || type
}

// The + menu: rows of icon, name and one action, in three groups. Adding makes a new window (a second Files is
// "Files 2", renamed in its title bar); hiding keeps everything in it, so it can come back from Hidden.
const wm = stylex.create({
  group: { display: "grid", gap: 2, paddingBlock: 4 },
  rule: { height: 1, marginBlock: 4, marginInline: 8, backgroundColor: color.line },
  label: { margin: 0, paddingInline: 10, paddingTop: 6, paddingBottom: 4, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  row: { display: "flex", alignItems: "center", gap: 10, minHeight: 44, paddingBlock: 6, paddingInline: 10, borderRadius: 10 },
  // A kind to add: the whole row is the button.
  pick: {
    width: "100%", justifyContent: "flex-start", textAlign: "left", fontWeight: 400, color: color.ink,
    backgroundColor: { default: "transparent", ":hover": { default: null, "@media (hover: hover) and (pointer: fine)": color.tile } },
  },
  icon: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, flexShrink: 0, borderRadius: 8, backgroundColor: color.tile, color: color.ink },
  text: { display: "grid", minWidth: 0, flexGrow: 1 },
  name: { fontSize: text.sm, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pitch: { fontSize: text.xs, color: color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  plus: { color: color.muted, flexShrink: 0 },
  act: { minHeight: 28, paddingBlock: 0, paddingInline: 10, fontSize: text.xs, flexShrink: 0 },
})

const WindowsMenu = observer(({ p, onAdd, onHide, onShow }: { p: Project; onAdd: (type: ToolType) => void; onHide: (id: string) => void; onShow: (id: string) => void }) => {
  const shown = p.tools.filter((t) => t.enabled)
  const hidden = p.tools.filter((t) => !t.enabled)
  const row = (t: Tool, action: ReactNode) => (
    <div key={t.id} {...sx(wm.row)}>
      <span aria-hidden="true" {...sx(wm.icon)}><Icon name={t.type} size={16} /></span>
      <span {...sx(wm.text)}><span {...sx(wm.name)}>{t.name}</span></span>
      {action}
    </div>
  )
  return (
    <>
      <div role="group" aria-labelledby="wm-add" {...sx(wm.group)}>
        <p id="wm-add" {...sx(wm.label)}>Add a window</p>
        {defaultTools().map((d) => (
          <button key={d.type} type="button" data-quiet onClick={() => onAdd(d.type)} {...sx(wm.row, wm.pick)}>
            <span aria-hidden="true" {...sx(wm.icon)}><Icon name={d.type} size={16} /></span>
            <span {...sx(wm.text)}><span {...sx(wm.name)}>{d.name}</span><span {...sx(wm.pitch)}>{MENU_PITCH[d.type]}</span></span>
            <span aria-hidden="true" {...sx(wm.plus)}><Icon name="plus" size={14} /></span>
          </button>
        ))}
      </div>
      {shown.length > 0 && <>
        <div {...sx(wm.rule)} />
        <div role="group" aria-labelledby="wm-on" {...sx(wm.group)}>
          <p id="wm-on" {...sx(wm.label)}>On this project</p>
          {shown.map((t) => row(t, <button type="button" data-quiet onClick={() => onHide(t.id)} aria-label={`Hide ${t.name}`} {...sx(wm.act)}>Hide</button>))}
        </div>
      </>}
      {hidden.length > 0 && <>
        <div {...sx(wm.rule)} />
        <div role="group" aria-labelledby="wm-hidden" {...sx(wm.group)}>
          <p id="wm-hidden" {...sx(wm.label)}>Hidden</p>
          {hidden.map((t) => row(t, <button type="button" data-quiet onClick={() => onShow(t.id)} aria-label={`Show ${t.name}`} {...sx(wm.act)}>Show</button>))}
        </div>
      </>}
    </>
  )
})

// Project home: a compact head (title, description, one line of facts), then the project's tools as windows (master
// and stack) running to the sheet's edges, with the taskbar below them. The head stays short so the windows get the
// screen. See docs/project_ui_explore.
const ps = stylex.create({
  // The top of the page's card (the desk is its bottom half): the sheet's white and its top corners.
  top: {
    backgroundColor: color.sheet, borderTopLeftRadius: { default: radius.lg, "@media (min-width: 768px)": radius.xl }, borderTopRightRadius: { default: radius.lg, "@media (min-width: 768px)": radius.xl },
    paddingBlock: { default: "20px 16px", "@media (min-width: 768px)": "24px 18px" }, paddingInline: { default: 20, "@media (min-width: 768px)": 28 },
  },
  head: { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: space.s4 },
  title: { fontSize: "1.625rem", lineHeight: 1.15, letterSpacing: "-0.03em", marginBottom: space.s1 },
  lede: { fontSize: text.base, color: color.muted, marginBottom: 0 },
  actions: { display: "flex", alignItems: "center", gap: space.s2, flexShrink: 0 },
  faces: { display: "flex", paddingLeft: 4, marginRight: space.s1, textDecoration: "none" },
  face: { marginLeft: -4, borderRadius: radius.pill, boxShadow: `0 0 0 2px ${color.sheet}`, display: "inline-flex" },
  facts: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s4, rowGap: space.s1, maxWidth: "none", marginTop: space.s1, marginBottom: 0, fontSize: text.sm, color: color.muted },
  fact: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  factInk: { color: color.ink },
  pitch: { margin: 0, fontSize: text.sm, color: color.muted, maxWidth: "48ch" },
  progressLine: { margin: 0, marginBottom: space.s2, fontSize: text.sm, color: color.muted },
  itemLink: { textDecoration: "none", ":hover": { textDecoration: "underline" } },
  // Inside a window: rows of title, a muted line of facts, and sometimes an excerpt or the next tasks.
  rows: { margin: 0, fontSize: text.base },
  rowTitle: { fontWeight: 600, letterSpacing: "-0.01em" },
  tag: { marginLeft: space.s2, verticalAlign: 2 },
  meta: { display: "block", marginTop: 2 },
  excerpt: { display: "block", marginTop: space.s1, fontSize: text.sm, color: color.muted, maxWidth: "72ch" },
  meter: { display: "block", width: "min(100%, 280px)", height: 6, marginTop: space.s2, borderRadius: radius.pill, backgroundColor: color.tile, overflow: "hidden" },
  fill: (w: string) => ({ display: "block", height: "100%", width: w, borderRadius: radius.pill, backgroundColor: color.accent }),
  todo: { display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: space.s2, marginTop: space.s2, fontSize: text.sm },
  todoMeta: { fontSize: text.xs },
  // Late is the case orange is kept for: it needs attention now.
  late: { color: color.accentText, fontWeight: 650 },
})

const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id
const newestFirst = (a: Recording, b: Recording) => b.created_at.localeCompare(a.created_at)

/** What's active of `type` in one window of the project. */
const activeIn = (p: Project, t: Tool, type: string | string[]) => {
  const here = inWindow(p, t.id)
  return recordings((r) => r.project_id === p.id && r.status === "active" && (typeof type === "string" ? r.type === type : type.includes(r.type)) && here(r))
}

const who = (id: number | null) => db.people.get(String(id))?.name ?? "Someone"
/** "2026-11-03T14:00" → "2 pm"; "…T10:30" → "10:30 am". */
const clock = (at: string) => {
  const [h = 0, m = 0] = at.slice(11, 16).split(":").map(Number)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`
}
const KIND: Record<string, string> = { folder: "Folder", doc: "Doc", upload: "File", cloudfile: "Link" }
const COLUMN_ORDER: Record<string, number> = { not_now: 0, triage: 1, custom: 2, done: 3 }

/** What a tool's window shows: its latest things, enough to work from; null shows the tool's pitch instead. */
const windowBody = (p: Project, t: Tool): ReactNode => {
  const tz = me().time_zone
  const list = (items: ReactNode[]) => (items.length ? <ul {...sx(ps.rows)}>{items}</ul> : null)
  const row = (key: number, title: ReactNode, meta: ReactNode, more?: ReactNode) =>
    <li key={key}><span {...sx(ps.rowTitle)}>{title}</span><small {...sx(ps.meta)}>{meta}</small>{more}</li>
  const link = (r: Recording, label = titleOf(r)) => <a href={urlFor(r)} {...sx(ps.itemLink)}>{label}</a>
  switch (t.type) {
    case "message_board":
      return list(activeIn(p, t, "message").sort((a, b) => Number(!!b.data.pinned) - Number(!!a.data.pinned) || newestFirst(a, b)).slice(0, 8).map((r) =>
        row(r.id, <>{link(r)}{r.data.pinned && <span {...sx(kit.tag, kit.tagAccent, ps.tag)}>Pinned</span>}</>,
          `${who(r.creator_id)} · ${fmtDate(r.created_at, tz)} · ${plural(commentCount(r.id), "comment")}`,
          r.body && <span {...sx(ps.excerpt)}>{excerpt(r.body, 150)}</span>)))
    case "todos": {
      // The bar, then the next open tasks in order, each with who, when and its subtasks' count.
      const pr = progressOf(p, t.id)
      if (!pr.tasks.length) return null
      const firstNames = (x: Recording) => (x.data.assignee_ids ?? []).map((id: number) => who(id).split(" ")[0]).join(", ")
      const late = (k: Recording) => !!k.data.due_on && k.data.due_on < today()
      const open = pr.tasks.filter((k) => !k.data.completed_at).sort(byPosition).slice(0, 8)
      return <>
        <p {...sx(ps.progressLine)}><b>{pr.pct}% done</b> · {pr.done} of {pr.total}</p>
        <span {...sx(ps.meter)}><span {...sx(ps.fill(`${pr.pct}%`))} /></span>
        {list(open.map((k) => {
          const subs = pr.subtasks.get(k.id) ?? []
          const meta = [subs.length ? `${subs.filter((s) => s.data.completed_at).length}/${subs.length}` : "", firstNames(k), k.data.due_on ? fmtDate(k.data.due_on) : ""].filter(Boolean).join(" · ")
          return row(k.id, link(k), <span {...sx(late(k) && ps.late)}>{meta}</span>)
        }))}
      </>
    }
    case "vault":
      return list(activeIn(p, t, ["folder", "doc", "upload", "cloudfile"]).filter((r) => r.parent_id === null).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8).map((r) =>
        row(r.id, link(r), `${KIND[r.type]} · ${who(r.creator_id)} · ${fmtDate(r.updated_at, tz)}`)))
    case "campfire":
      return list(activeIn(p, t, "line").sort(newestFirst).slice(0, 8).reverse().map((l) =>
        <li key={l.id}><b>{l.creator_id ? who(l.creator_id) : `${l.data.chatbot_name ?? "Someone"} (bot)`}:</b> {excerpt(l.body, 140)}</li>))
    case "schedule":
      return list(upcoming(p, t).slice(0, 8).map((r) =>
        row(r.id, link(r), `${fmtDate(r.data.starts_at)} · ${r.data.all_day ? "All day" : clock(r.data.starts_at)}${r.data.repeat && r.data.repeat !== "never" ? ` · every ${r.data.repeat === "weekly" ? "week" : r.data.repeat.replace(/ly$/, "")}` : ""}`)))
    case "cardtable":
      // Fizzy's order: Not now, To do, your columns, Done; Golden Tickets first in each.
      return list(activeIn(p, t, "column").sort((a, b) => (COLUMN_ORDER[a.data.kind ?? "custom"] ?? 2) - (COLUMN_ORDER[b.data.kind ?? "custom"] ?? 2) || byPosition(a, b)).map((c) => {
        const cards = recordings((k) => k.parent_id === c.id && k.type === "card" && k.status === "active").sort((a, b) => Number(!!b.data.golden) - Number(!!a.data.golden) || b.position - a.position)
        return row(c.id, c.title, plural(cards.length, "card"), cards.length > 0 && <span {...sx(ps.excerpt)}>{cards.slice(0, 3).map((k, i) => <span key={k.id}>{i ? " · " : ""}{link(k)}</span>)}{cards.length > 3 ? " …" : ""}</span>)
      }))
  }
}

const upcoming = (p: Project, t: Tool) =>
  activeIn(p, t, "event").filter((r) => r.data.starts_at >= isoDate(new Date())).sort((a, b) => String(a.data.starts_at).localeCompare(b.data.starts_at))

/** One line about what's new in a tool, for its window's title bar and its taskbar tip. */
const summary = (p: Project, t: Tool): string => {
  switch (t.type) {
    case "message_board": {
      const posts = activeIn(p, t, "message").sort(newestFirst)
      return posts.length ? `Newest: ${titleOf(posts[0]!)}` : "No posts yet"
    }
    case "todos": {
      const pr = progressOf(p, t.id)
      const late = lateTasks(p.id, t.id)
      return pr.total ? `${pr.pct}% done${late ? ` · ${late} late` : ""}` : "No tasks yet"
    }
    case "vault": {
      const n = activeIn(p, t, ["doc", "upload", "cloudfile"]).length
      return n ? plural(n, "file") : "No files yet"
    }
    case "campfire": {
      const last = activeIn(p, t, "line").sort(newestFirst)[0]
      if (!last) return "No messages yet"
      const who = db.people.get(String(last.creator_id))?.name.split(" ")[0] ?? last.data.chatbot_name ?? "Someone"
      return `${who}: ${excerpt(last.body, 60)}`
    }
    case "schedule": {
      const next = upcoming(p, t)[0]
      return next ? `Next: ${next.title} · ${fmtDate(next.data.starts_at)}` : "Nothing coming up"
    }
    case "cardtable": {
      const cols = new Set(activeIn(p, t, "column").map((c) => c.id))
      const cards = recordings((k) => k.type === "card" && k.status === "active" && cols.has(k.parent_id!)).length
      return cards ? `${plural(cards, "card")} in ${plural(cols.size, "column")}` : "No cards yet"
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

/** Where you last were in each window ("2:vault" → "/projects/2/docs/5"), so picking a window takes you back there. */
const lastIn = new Map<string, string>()
const frontKey = (id: number) => `saintsflow:front:${id}`
const loadFront = (id: number) => { try { return localStorage.getItem(frontKey(id)) } catch { return null } }

/** /projects/:id and every page inside one of its windows: the project head and its desk. The page the address names
 * is the main window (/projects/2/docs/5 is Files, at that doc), so links, Back, refresh and bookmarks all just work.
 * A bare /projects/2 goes to the window you had in front last time. */
export const ProjectLayout = observer(() => {
  const p = useProject()
  if (p.kind === "ping") return <Navigate replace to={`/chats/${p.id}`} />
  // Keyed by project: what's "new" is measured from when this project's page opened.
  return <ProjectHome key={p.id} p={p} />
})

const ProjectHome = observer(({ p }: { p: Project }) => {
  const m = me()
  const loc = useLocation()
  const navigate = useNavigate()
  // When you last opened this project and each of its windows, taken once as the page opens (visits move them to now).
  const [seenAtOpen] = useState(() => seenOf(m.prefs, p.id))
  const [projectSince] = useState(() => m.prefs.project_seen?.[String(p.id)] ?? null)
  const people = projectPeople(p)
  const clients = people.filter(isClient)
  const tools = enabledTools(p)
  // How far along it is: the share of its tasks done (subtasks counted in their task's place).
  const pr = progressOf(p)
  const tasksWindow = tools.find((t) => t.type === "todos")
  const keys = tools.map((t) => t.id)

  // The window in front is the one the address is in; with none (a bare /projects/2), the one you had last.
  const cur = windowAt(p, loc.pathname, loc.search)
  const front = cur && keys.includes(cur) ? cur : keys.find((k) => k === loadFront(p.id)) ?? keys[0]
  useVisit(projectUrl(p), p.name, p.id, keys, cur ?? undefined)
  const toolOf = (k: string) => p.tools.find((t) => t.id === k) ?? { id: k, type: k as ToolType }
  const rootOf = (k: string) => windowUrl(p, toolOf(k))
  const atRoot = (k: string) => loc.pathname === toolUrl(p, toolOf(k).type)
  const here = loc.pathname + loc.search + loc.hash
  useEffect(() => {
    if (!cur) return
    lastIn.set(`${p.id}:${cur}`, here)
    try { localStorage.setItem(frontKey(p.id), cur) } catch {}
  }, [cur, here])
  // Picking a window goes back to where you were in it. By pointer it glides; by keyboard it's instant.
  const bring = (k: string, e?: MouseEvent) => {
    const glide = (!e || e.detail > 0) && !matchMedia("(prefers-reduced-motion: reduce)").matches
    navigate(lastIn.get(`${p.id}:${k}`) ?? rootOf(k), { viewTransition: glide })
  }

  // Changing the windows: drag them into order on the rail; rename in the big window's title bar; add, hide and show
  // from the + menu. The copy changes at once (the server's reply replaces it), except adding, which waits for the new
  // window's id.
  const post = usePost()
  const canChange = !isClient(m) && p.status === "active"
  const setTools = (next: Tool[]) => () => { db.projects.set(String(p.id), { ...p, tools: next }) }
  const rename = (k: string, name: string) => post(`/projects/${p.id}/windows/${k}/rename`, { name }, setTools(p.tools.map((t) => (t.id === k ? { ...t, name } : t))))
  const hide = (k: string) => {
    post(`/projects/${p.id}/windows/${k}/hide`, {}, setTools(p.tools.map((t) => (t.id === k ? { ...t, enabled: false } : t))))
    // Hiding the window you're in moves you to the next one.
    const next = keys.find((x) => x !== k)
    if (k === front) navigate(next ? lastIn.get(`${p.id}:${next}`) ?? rootOf(next) : projectUrl(p))
  }
  const show = (k: string) => { closeWindowsMenu(); post(`/projects/${p.id}/windows/${k}/show`, {}, setTools(p.tools.map((t) => (t.id === k ? { ...t, enabled: true } : t)))) }
  const add = (type: ToolType) => { closeWindowsMenu(); post(`/projects/${p.id}/windows`, { type }) }
  const reorder = (ids: string[]) => post(`/projects/${p.id}/windows/order`, { ids: ids.join(",") }, setTools([...ids.flatMap((id) => p.tools.filter((t) => t.id === id)), ...p.tools.filter((t) => !ids.includes(t.id))]))

  const { counts: news, oldest } = windowNews(p.id, m.id, seenAtOpen)
  const sinceFor = (k: string) => { const at = seenAtOpen(k); return at ? { at, label: sinceLabel(at) } : null }
  // The main window shows the page the address names (Outlet); the stack shows the previews.
  const work = (k: string) => k === front && cur === front
    // At the window's start page its title bar already names it: the page heading is kept for screen readers (app.css).
    ? <InWindow.Provider value={true}><WindowId.Provider value={k}><WindowSince.Provider value={sinceFor(k)}><div data-window-root={atRoot(k) || undefined}><Outlet /></div></WindowSince.Provider></WindowId.Provider></InWindow.Provider>
    : undefined
  const back = (k: string) => (k === front && cur === front && !atRoot(k) ? () => navigate(rootOf(k)) : undefined)
  const windows: DeskWindow[] = tools.map((t) => {
    const body = windowBody(p, t)
    return {
      key: t.id, name: t.name, icon: t.type, summary: summary(p, t),
      body: body ?? <p {...sx(ps.pitch)}>{PITCH[t.type]}</p>, empty: !body, news: news.get(t.id) ?? 0, late: t.type === "todos" ? lateTasks(p.id, t.id) : 0,
      work: work(t.id), back: back(t.id), place: here,
    }
  })
  if (!cur && front) return <Navigate replace to={lastIn.get(`${p.id}:${front}`) ?? rootOf(front)} />
  return (
    <Page title={p.name} crumbs={p.kind === "template" ? [["Templates", "/templates"]] : undefined} flush>
      <div {...sx(ps.top)}>
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
            <p {...sx(ps.facts)}>
              {(p.starts_on || p.ends_on) && <span {...sx(ps.fact, ps.factInk)}>{fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}</span>}
              {tasksWindow && pr.total > 0 && (
                <a href={rootOf(tasksWindow.id)} title={`${pr.done} of ${pr.total} done`} {...sx(ps.fact)}>
                  <ProgressBar pct={pr.pct} /> <span {...sx(ps.factInk)}>{pr.pct}% done</span>
                </a>
              )}
              {clients.length > 0 && !isClient(m) && <span>Clients see only what you share. <a href={`/projects/${p.id}/clients`}>Client access</a></span>}
            </p>
          </div>
          <div {...sx(ps.actions)}>
            <a href={isClient(m) ? `/people` : `/projects/${p.id}/people`} aria-label={`People on this project: ${people.map((x) => x.name).join(", ")}`} title={people.map((x) => x.name).join(", ")} {...sx(ps.faces)}>
              {people.slice(0, 5).map((x) => <span key={x.id} {...sx(ps.face)}><Face p={x} px={30} /></span>)}
            </a>
            {canInvite() && <a href={`/people/invite?project_id=${p.id}`} data-button>Invite</a>}
            <a href={`/projects/${p.id}/menu`} data-button aria-label="Project menu" title="Project menu">•••</a>
          </div>
        </div>
      </div>
      <Desk windows={windows} project={p.name} master={front ?? ""} onBring={bring} since={oldest ? sinceLabel(oldest) : projectSince ? sinceLabel(projectSince) : undefined}
        note={!windows.length ? "A fresh start. Add the windows this project needs, then invite the people on it."
          : windows.every((w) => w.empty) ? "A fresh start. Invite the people on it, then post what this project is about." : undefined}
        menu={canChange ? <WindowsMenu p={p} onAdd={add} onHide={hide} onShow={show} /> : undefined} onRename={canChange ? rename : undefined} onReorder={canChange ? reorder : undefined} />
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

type Delivery = { webhook_id: number; event: string; status: number | null; error: string | null; created_at: string }

export const routes = [

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

  // The flash's "Undo" after hiding a window.
  page("/projects/:id/windows/:wid/show", () => {
    const { id, wid } = useParams()
    return <Page title="Bringing it back"><p>Bringing it back…</p><PostOnOpen action={`/projects/${id}/windows/${wid}/show`} /></Page>
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
    const agents = useJustAgents()
    const evs = [...db.events.values()]
      .filter((e) => e.project_id === p.id && (!personId || e.person_id === personId) && (!agents || !!e.via))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice((pageN - 1) * 50, pageN * 50 + 1)
      .map((e) => {
        const who = db.people.get(String(e.person_id))
        return { ...e, name: who?.name ?? null, avatar_url: who?.avatar_url ?? null }
      })
    return (
      <Page title="Project activity" crumbs={projectCrumbs(p)}>
        <h1>Activity on {p.name}</h1>
        <GetForm method="get" ref={submitOnChange} {...sx(kit.toolbar)}><label>Show only what <select name="person" defaultValue={personId ?? ""} {...sx(kit.toolbarControl)}><option value="">everyone</option>
          {projectPeople(p).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select> did</label>{agents && <input type="hidden" name="by" value="agents" />}</GetForm>
        <AgentsFilter />
        {evs.length ? <ActivityList events={evs.slice(0, 50)} tz={me().time_zone} /> : <p {...sx(kit.empty)}>{agents ? "No agent work here yet. What agents do for people on this project shows up here." : "Nothing's happened yet. Activity shows up here as people post, comment, and check things off."}</p>}
        {evs.length > 50 && <p><a href={`?page=${pageN + 1}${personId ? `&person=${personId}` : ""}${agents ? "&by=agents" : ""}`}>Show more</a></p>}
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
