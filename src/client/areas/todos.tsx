// To-dos: the lists index, new list, a list with its groups, add a to-do, a to-do, and the Hill Chart.
// Posts: src/areas/todos.ts. Completing, moving between groups and reordering change the copy right away.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useState } from "react"
import { useLocation, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import {
  me, findProject, findRecording, projectPeople, children, topLevel, recordings, commentCount, personById, useVisit, NoAccess,
  type PersonWithCompany,
} from "../data.ts"
import { isClient, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { daysFromToday, fmtDate, fmtDateTime, isoDate, plural } from "../../shared/format.ts"
import { Fmt, PageHead, hill, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, PeopleCheckboxes, PostOnOpen, submitOwnForm, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

const ts = stylex.create({
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, paddingBlock: 10 },
  title: { fontWeight: 500, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  meta: { display: "inline-flex", flexWrap: "wrap", columnGap: space.s3 },
  move: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: space.s2 },
  check: {
    width: 22, height: 22, minHeight: 22, padding: 0, flexShrink: 0, borderRadius: 7, backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.accentSoft } },
    borderWidth: 1.5, borderStyle: "solid", borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.focus } }, color: color.onAccent,
    transitionProperty: "background-color, border-color", transitionDuration: motion.fast,
  },
  checkDone: { backgroundColor: color.accent, borderColor: { default: color.accent, ":hover": { default: null, [media.hover]: color.focus } } },
  checkLarge: { width: 28, height: 28, minHeight: 28, borderRadius: 9, verticalAlign: "-3px", marginRight: space.s2 },
  done: { color: color.muted },
  static: { display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" },
})

const Tick = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
/** The same box, not clickable, for read-only lists. */
const CheckMark = ({ t }: { t: Recording }) => (
  <span role="img" aria-label={t.data.completed_at ? "Done" : "Not done"} {...sx(ts.check, ts.static, !!t.data.completed_at && ts.checkDone)}>{t.data.completed_at ? <Tick size={12} /> : null}</span>
)
// The lists as cards with a progress bar; the Hill Chart drawn as the hill, one orange dot per tracked list.
const ls = stylex.create({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  // A list on the Tasks start page: its title and progress, then its next open tasks to tick off in place.
  card: { borderTopWidth: 0, padding: space.s5, borderRadius: radius.xl, display: "grid", gap: space.s2, alignContent: "start", backgroundColor: color.tile },
  cardTitle: { fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none", ":hover": { textDecoration: "underline" } },
  cardText: { margin: 0, fontSize: text.sm, color: color.muted },
  bar: { height: 6, borderRadius: radius.pill, backgroundColor: color.sheet, overflow: "hidden" },
  tasks: { display: "grid", gap: space.s1, margin: 0, marginTop: space.s2 },
  task: { display: "flex", alignItems: "flex-start", gap: 10, borderTopWidth: 0, paddingBlock: 3 },
  taskTitle: { fontSize: text.sm, fontWeight: 500, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  taskMeta: { display: "block", fontSize: text.xs, color: color.muted },
  // Late is the case orange is kept for: it needs attention now.
  late: { color: color.accentText, fontWeight: 600 },
  more: { fontSize: text.sm, marginTop: space.s1 },
  fill: (w: string) => ({ width: w }),
  fillBox: { display: "block", height: "100%", borderRadius: radius.pill, backgroundColor: color.accent },
  count: { fontSize: text.xs, fontWeight: 600, color: color.muted, fontVariantNumeric: "tabular-nums" },
  hillCard: { padding: { default: space.s3, "@media (min-width: 768px)": space.s5 }, borderRadius: radius.xl, backgroundColor: color.tile, marginBottom: space.s5 },
  hillHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: space.s2 },
  hillTitle: { margin: 0, fontSize: text.md },
  svg: { display: "block", width: "100%", height: "auto", overflow: "visible" },
  line: { fill: "none", stroke: color.ink, strokeWidth: 2 },
  base: { stroke: color.line, strokeWidth: 1 },
  divide: { stroke: color.control, strokeWidth: 1, strokeDasharray: "3 5" },
  side: { fill: color.muted, fontSize: { default: 13, "@media (max-width: 640px)": 22 } },
  dot: { fill: color.accent, stroke: color.tile, strokeWidth: 3 },
  label: { fill: color.ink, fontSize: { default: 13, "@media (max-width: 640px)": 22 }, fontWeight: 600 },
  history: { margin: 0 },
})

const hillLabel = (v: number) => (v < 50 ? "Working it out" : v < 100 ? "Getting it done" : "Done")

/** The Hill Chart: each list's dot at its position, labelled on the side away from the top. */
// ponytail: labels stack by order to avoid overlap; dots at the same spot still sit on top of each other
const HillChart = ({ items }: { items: ReadonlyArray<{ label: string; value: number }> }) => (
  <svg viewBox="-150 0 900 262" role="img" aria-label={`Progress hill: ${items.map((i) => `${i.label} at ${i.value}, ${hillLabel(i.value).toLowerCase()}`).join("; ")}`} {...sx(ls.svg)}>
    <line x1="0" y1="210" x2="600" y2="210" {...sx(ls.base)} />
    <line x1="300" y1="30" x2="300" y2="210" {...sx(ls.divide)} />
    <path d={hill.curve([hill.UP, hill.DOWN])} {...sx(ls.line)} />
    <text x="150" y="246" textAnchor="middle" {...sx(ls.side)}>Working it out</text>
    <text x="450" y="246" textAnchor="middle" {...sx(ls.side)}>Getting it done</text>
    {items.map((i, n) => {
      const [x, y] = hill.at(i.value)
      const right = i.value > 50
      return <g key={n} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}><circle r="8" {...sx(ls.dot)} /><text x={right ? 14 : -14} y={-8 - (n % 3) * 16} textAnchor={right ? "start" : "end"} {...sx(ls.label)}>{i.label}</text></g>
    })}
  </svg>
)

// ---------- optimistic changes (mirror the posts in src/areas/todos.ts) ----------

/** /tasks/:tid/complete: flip completed_at and completer_id. */
const toggleDone = (t: Recording) => {
  const cur = db.recordings.get(String(t.id)) ?? t
  const done = !cur.data.completed_at
  const now = new Date().toISOString()
  db.recordings.set(String(t.id), { ...cur, data: { ...cur.data, completed_at: done ? now : null, completer_id: done ? me().id : null }, updated_at: now })
}

/** The reorder posts: every `pos_<id>` field becomes that recording's position. Cards' column order uses it too. */
export const reorderLocal = (fd: FormData) => {
  for (const [k, v] of fd.entries()) {
    const r = k.startsWith("pos_") ? db.recordings.get(k.slice(4)) : undefined
    if (r) db.recordings.set(String(r.id), { ...r, position: Number(v) || 0 })
  }
}

/** The round-trip "done" toggle: a box that fills orange with a check. */
const CheckButton = ({ p, t, large = false }: { p: Project; t: Recording; large?: boolean }) => {
  const label = t.data.completed_at ? "Mark as not done" : "Mark as done"
  return (
    <Form action={`/projects/${p.id}/tasks/${t.id}/complete`} style={{ display: "inline" }} optimistic={() => toggleDone(t)}>
      <button aria-label={label} title={label} {...sx(ts.check, !!t.data.completed_at && ts.checkDone, large && ts.checkLarge)}>{t.data.completed_at ? <Tick size={large ? 16 : 12} /> : null}</button>
    </Form>
  )
}

// ---------- reads ----------

const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id
/** Late and soonest due first, then the ones with no date in list order. */
const soonestFirst = (a: Recording, b: Recording) => String(a.data.due_on ?? "9").localeCompare(String(b.data.due_on ?? "9")) || byPosition(a, b)

/** Active to-dos on a list, counting to-dos inside its groups too, by position. */
const todosIn = (listId: number) => {
  const groupIds = children(listId, "todogroup").map((g) => g.id)
  return recordings((t) => t.type === "todo" && t.status === "active" && (t.parent_id === listId || groupIds.includes(t.parent_id ?? 0))).sort(byPosition)
}

/** The list a to-do or group belongs to. */
const listOf = (r: Recording) => {
  const { r: parent } = findRecording(r.parent_id ?? 0, ["todolist", "todogroup"])
  if (parent.type === "todolist") return { list: parent, group: null as Recording | null }
  return { list: findRecording(parent.parent_id ?? 0, "todolist").r, group: parent }
}

/** Latest hill position for each list, from the newest update that mentions it. */
const hillPositions = (projectId: number) => {
  const pos = new Map<number, number>()
  const ups = [...db.hill_updates.values()].filter((u) => u.project_id === projectId).sort((a, b) => a.id - b.id)
  for (const u of ups) for (const [k, v] of Object.entries(u.positions)) pos.set(Number(k), v)
  return pos
}

type People = ReadonlyArray<PersonWithCompany>

const names = (people: People, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const dueText = (t: Recording) => {
  const d = t.data
  if (!d.due_on) return ""
  const when = d.starts_on ? `${fmtDate(d.starts_on)} – ${fmtDate(d.due_on)}` : fmtDate(d.due_on)
  const late = !d.completed_at ? -daysFromToday(d.due_on) : 0
  return late > 0 ? `${when} (${plural(late, "day")} late)` : when
}

const listCrumbs = (p: Project, list: Recording) => [...projectCrumbs(p, "todos"), [list.title, urlFor(list)] as const]

// ---------- pieces ----------

/** One to-do row on a list: checkbox, title, who, when, comments, "Move to…". */
const TodoRow = observer(({ p, t, people, moveTargets, readOnly }: { p: Project; t: Recording; people: People; moveTargets: ReadonlyArray<{ id: number; label: string }>; readOnly: boolean }) => {
  const comments = commentCount(t.id)
  return (
    <li id={`todo-${t.id}`} {...sx(ts.row)}>
      {readOnly ? <CheckMark t={t} /> : <CheckButton p={p} t={t} />}
      <a href={urlFor(t)} {...sx(ts.title, !!t.data.completed_at && ts.done)}>{t.data.completed_at ? <s>{t.title}</s> : t.title}</a>
      <span {...sx(ts.meta)}>
        {t.data.assignee_ids?.length > 0 && <small>{names(people, t.data.assignee_ids)}</small>}
        {t.data.due_on && <small>{dueText(t)}</small>}
        {comments > 0 && <small>{plural(comments, "comment")}</small>}
        {t.body && <small>📝 notes</small>}
      </span>
      {!readOnly && !t.data.completed_at && moveTargets.length > 1 && (
        <Form
          action={`/projects/${p.id}/tasks/${t.id}/move-group`}
          optimistic={(fd) => db.recordings.set(String(t.id), { ...t, parent_id: Number(fd.get("parent_id")) || t.parent_id, updated_at: new Date().toISOString() })}
          {...sx(ts.move)}
          style={{ display: "inline" }}
        >
          {/* Picking a place moves it: no separate Move button. Quiet until the row is hovered or focused (app.css). */}
          <select name="parent_id" defaultValue="" onChange={submitOwnForm} aria-label={`Move “${t.title}” to…`} data-row-action {...sx(kit.quietSelect)}>
            <option value="" disabled hidden>Move to…</option>
            {moveTargets.filter((m) => m.id !== t.parent_id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Form>
      )}
    </li>
  )
})

/** Fields for adding or editing a to-do. */
const TodoFields = ({ people, t, groups = [], groupId }: { people: People; t: Partial<Recording>; groups?: ReadonlyArray<Recording>; groupId?: number | null }) => {
  const d = t.data ?? {}
  const mode = d.starts_on ? "range" : d.due_on ? "day" : "none"
  return (
    <>
      <TextField label="Task" name="title" value={t.title ?? ""} placeholder="What needs to be done?" />
      {groups.length > 0 && (
        <p><label>In group<br /><select name="group_id" defaultValue={groupId ?? ""}><option value="">No group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label></p>
      )}
      <fieldset><legend>Assigned to</legend><PeopleCheckboxes name="assignee_ids" people={people} checked={d.assignee_ids ?? []} /></fieldset>
      <fieldset><legend>When done, notify</legend><PeopleCheckboxes name="notify_ids" people={people} checked={d.notify_ids ?? []} /></fieldset>
      <fieldset><legend>Due on</legend>
        <label><input type="radio" name="due" value="none" defaultChecked={mode === "none"} /> No due date</label><br />
        <label><input type="radio" name="due" value="day" defaultChecked={mode === "day"} /> A specific day:</label>{" "}
        <input type="date" name="due_day" defaultValue={mode === "day" ? isoDate(d.due_on) : ""} aria-label="Due day" /><br />
        <label><input type="radio" name="due" value="range" defaultChecked={mode === "range"} /> Runs over multiple days:</label>{" "}
        <input type="date" name="range_start" defaultValue={isoDate(d.starts_on)} aria-label="Starts" /> to{" "}
        <input type="date" name="range_end" defaultValue={mode === "range" ? isoDate(d.due_on) : ""} aria-label="Ends" />
      </fieldset>
      <TextArea label="Notes" name="body" value={t.body ?? ""} placeholder="Add extra details or attach a file…" />
    </>
  )
}

const ListForm = ({ p, people, l }: { p: Project; people: People; l: Partial<Recording> }) => (
  <Form action={l.id ? `/projects/${p.id}/lists/${l.id}/edit` : `/projects/${p.id}/lists`}>
    <TextField label="Name this list…" name="title" value={l.title ?? ""} required />
    <TextArea label="Notes" name="body" value={l.body ?? ""} placeholder="Add extra details or attach a file…" />
    <ClientSwitch project={p} people={people} current={l.visible_to_clients} />
    <p><button>{l.id ? "Save changes" : "Add this list"}</button> <a href={l.id ? urlFor(l as Recording) : toolUrl(p, "todos")}>Cancel</a></p>
  </Form>
)

/** A slider with its number next to it. */
const Slider = ({ name, value }: { name: string; value: number }) => {
  const [v, setV] = useState(value)
  return <><input type="range" name={name} min={0} max={100} step={5} defaultValue={value} onInput={(e) => setV(Number(e.currentTarget.value))} /> <output>{v}</output></>
}

// ---------- pages ----------
export const routes = [
  page("/projects/:id/tasks", () => {
    const [q] = useSearchParams()
    const p = findProject(useParams().id)
    const m = me()
    useVisit(toolUrl(p, "todos"), `${p.name}: Tasks`, p.id)
    const lists = topLevel(p.id, "todolist")
    const tracked = lists.filter((l) => l.data.tracked)
    const pos = hillPositions(p.id)
    const reorder = q.get("reorder") === "1" && !isClient(m)
    const people = projectPeople(p)
    return (
      <Page title="Tasks" crumbs={projectCrumbs(p)}>
        <PageHead title="Tasks" actions={[p.status === "active" && <a key="new" href={`/projects/${p.id}/lists/new`} data-button>New list</a>]} />
        {lists.length === 0 ? (
          <p {...sx(kit.empty)}>Make lists of work. Give each task to someone and set a due date.</p>
        ) : reorder ? (
          <Form action={`/projects/${p.id}/lists/reorder`} optimistic={reorderLocal}>
            <ol>{lists.map((l, i) => <li key={l.id}><label>{l.title} <input type="number" name={`pos_${l.id}`} defaultValue={i + 1} min={1} size={3} aria-label="Position" /></label></li>)}</ol>
            <button>Save order</button> <a href={toolUrl(p, "todos")}>Cancel</a>
          </Form>
        ) : (
          // Each list shows its next open tasks, late ones first, to tick off right here; the list page has the rest.
          <ul {...sx(ls.grid)}>{lists.map((l) => {
            const all = todosIn(l.id)
            const s = { done: all.filter((t) => t.data.completed_at).length, total: all.length }
            const open = all.filter((t) => !t.data.completed_at).sort(soonestFirst)
            return (
              <li key={l.id} {...sx(ls.card)}>
                <a href={urlFor(l)} {...sx(ls.cardTitle)}>{l.title}</a>
                <span {...sx(ls.count)}>{s.done}/{s.total} completed</span>
                <span {...sx(ls.bar)} aria-hidden="true"><span {...sx(ls.fillBox, ls.fill(`${s.total ? Math.round((s.done / s.total) * 100) : 0}%`))} /></span>
                {open.length > 0 ? (
                  <ul {...sx(ls.tasks)}>{open.slice(0, 5).map((t) => {
                    const late = t.data.due_on && daysFromToday(t.data.due_on) < 0
                    return (
                      <li key={t.id} {...sx(ls.task)}>
                        {p.status === "active" ? <CheckButton p={p} t={t} /> : <CheckMark t={t} />}
                        <span>
                          <a href={urlFor(t)} {...sx(ls.taskTitle)}>{t.title}</a>
                          {(t.data.assignee_ids?.length > 0 || t.data.due_on) && (
                            <small {...sx(ls.taskMeta)}>
                              {names(people, t.data.assignee_ids)}{t.data.assignee_ids?.length > 0 && t.data.due_on && " · "}
                              {t.data.due_on && <span {...sx(late && ls.late)}>{dueText(t)}</span>}
                            </small>
                          )}
                        </span>
                      </li>
                    )
                  })}</ul>
                ) : <p {...sx(ls.cardText)}>{s.total ? "All done." : "No tasks yet."}</p>}
                {open.length > 5 && <a href={urlFor(l)} {...sx(ls.more)}>See all {open.length} open tasks</a>}
              </li>
            )
          })}</ul>
        )}
        {tracked.length > 0 && (
          <section aria-label="Progress" {...sx(ls.hillCard)}>
            <div {...sx(ls.hillHead)}><h2 {...sx(ls.hillTitle)}><a href={`/projects/${p.id}/progress`}>Progress</a></h2></div>
            <HillChart items={tracked.map((l) => ({ label: l.title, value: pos.get(l.id) ?? 0 }))} />
          </section>
        )}
        <p {...sx(kit.links)}>
          {lists.length > 1 && !isClient(m) && !reorder && <a href="?reorder=1">Reorder lists</a>}
          <a href={`/projects/${p.id}/progress`}>Progress</a><a href={`/projects/${p.id}/trash`}>Archived lists</a>
        </p>
      </Page>
    )
  }),

  page("/projects/:id/lists/new", () => {
    const p = findProject(useParams().id)
    return <Page title="New list" crumbs={projectCrumbs(p, "todos")}><h1>New list</h1><ListForm p={p} people={projectPeople(p)} l={{}} /></Page>
  }),

  page("/projects/:id/lists/:lid", () => {
    const [q] = useSearchParams()
    const loc = useLocation()
    const { r: list, project: p } = findRecording(useParams().lid, "todolist")
    const m = me()
    useVisit(urlFor(list), list.title, p.id)
    const people = projectPeople(p)
    const groups = children(list.id, "todogroup")
    const todos = todosIn(list.id)
    const open = todos.filter((t) => !t.data.completed_at)
    const done = todos.filter((t) => t.data.completed_at).sort((a, b) => String(b.data.completed_at).localeCompare(String(a.data.completed_at)))
    const showDone = q.get("completed") === "1"
    const reorder = q.get("reorder") === "1"
    const readOnly = list.status !== "active"
    const targets = [{ id: list.id, label: "No group" }, ...groups.map((g) => ({ id: g.id, label: g.title }))]
    const row = (t: Recording) => <TodoRow key={t.id} p={p} t={t} people={people} moveTargets={targets} readOnly={readOnly} />
    // Keyed by the location: after a post lands back here the fields start blank, as after the old page reload.
    const composer = (groupId: number | null) => (
      <details open={open.length === 0 && groups.length === 0}><summary>Add a task</summary>
        <Form key={loc.key} action={`/projects/${p.id}/lists/${list.id}/tasks`}>
          {groupId && <input type="hidden" name="group_id" value={groupId} />}
          <TodoFields people={people} t={{}} groups={groupId ? [] : groups} />
          <p><button>Add this task</button></p>
        </Form>
      </details>
    )
    return (
      <Page title={list.title} crumbs={projectCrumbs(p, "todos")}>
        <StatusBanner r={list} />
        <ClientBanner r={list} hasClients={people.some(isClient)} />
        <h1>{list.title}</h1>
        {list.body && <Fmt text={list.body} {...sx(kit.prose)} />}
        <p>{done.length}/{todos.length} completed{list.data.tracked ? " · On the progress hill" : ""}
          {!readOnly && !isClient(m) && <> · <a href={`/projects/${p.id}/lists/${list.id}/edit`}>Edit</a></>}</p>
        {!readOnly && !isClient(m) && (
          <Form action={`/projects/${p.id}/lists/${list.id}/track`}>
            <button data-quiet {...sx(kit.linkButton)}>{list.data.tracked ? "Take this list off the progress hill" : "Show this list on the progress hill"}</button>
            {list.data.tracked && <> <a href={`/projects/${p.id}/progress`}>See the hill</a></>}
          </Form>
        )}
        {reorder && !readOnly ? (
          <Form action={`/projects/${p.id}/lists/${list.id}/reorder`} optimistic={reorderLocal}>
            <ol>{open.map((t, i) => <li key={t.id}><label>{t.title} <input type="number" name={`pos_${t.id}`} defaultValue={i + 1} min={1} size={3} aria-label="Position" /></label></li>)}</ol>
            <button>Save order</button> <a href={urlFor(list)}>Cancel</a>
          </Form>
        ) : (
          <>
            <ul>{open.filter((t) => t.parent_id === list.id).map(row)}</ul>
            {!readOnly && composer(null)}
            {groups.map((g) => (
              <section key={g.id} id={`group-${g.id}`} aria-label={g.title}>
                <h2>{g.title}</h2>
                {!readOnly && (
                  <details><summary><small>Rename or remove this group</small></summary>
                    <Form action={`/projects/${p.id}/groups/${g.id}`}><input name="title" defaultValue={g.title} aria-label="Group name" required /> <button>Rename</button></Form>
                    <p><a href={`/r/${g.id}/trash`}>Put this group in the trash</a></p>
                  </details>
                )}
                <ul>{open.filter((t) => t.parent_id === g.id).map(row)}</ul>
                {!readOnly && composer(g.id)}
              </section>
            ))}
            {open.length === 0 && todos.length > 0 && <p>Everything on this list is done.</p>}
            {!readOnly && (
              <Form key={loc.key} action={`/projects/${p.id}/lists/${list.id}/groups`}>
                <p><label>Add a group <input name="title" placeholder="Name this group" required /></label> <button>Add this group</button></p>
              </Form>
            )}
            {open.length > 1 && !readOnly && <p><a href="?reorder=1">Reorder tasks</a></p>}
          </>
        )}
        {done.length > 0 && (showDone
          ? <><h2>Completed</h2><ul>{done.map(row)}</ul><p><a href={urlFor(list)}>Hide done tasks</a></p></>
          : <p><a href="?completed=1">Show {plural(done.length, "done task")}</a></p>)}
        <ItemFooter r={list} project={p} />
      </Page>
    )
  }),

  page("/projects/:id/lists/:lid/edit", () => {
    const { r: list, project: p } = findRecording(useParams().lid, "todolist")
    if (isClient(me()) && list.creator_id !== me().id) throw new NoAccess()
    return <Page title="Edit list" crumbs={listCrumbs(p, list)}><h1>Edit list</h1><ListForm p={p} people={projectPeople(p)} l={list} /></Page>
  }),

  page("/projects/:id/lists/:lid/tasks/new", () => {
    const [q] = useSearchParams()
    const { r: list, project: p } = findRecording(useParams().lid, "todolist")
    const groupId = Number(q.get("group_id")) || null
    return (
      <Page title="Add a task" crumbs={listCrumbs(p, list)}>
        <h1>Add a task to {list.title}</h1>
        <Form action={`/projects/${p.id}/lists/${list.id}/tasks`}>
          <TodoFields people={projectPeople(p)} t={{}} groups={children(list.id, "todogroup")} groupId={groupId} />
          <p><button>Add this task</button> <a href={urlFor(list)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  page("/projects/:id/tasks/:tid", () => {
    const { r: t, project: p } = findRecording(useParams().tid, "todo")
    const m = me()
    useVisit(urlFor(t), t.title, p.id)
    const { list, group } = listOf(t)
    const people = projectPeople(p)
    const author = personById(t.creator_id)
    const completer = personById(t.data.completer_id)
    const readOnly = t.status !== "active"
    return (
      <Page title={t.title} crumbs={listCrumbs(p, list)}>
        <StatusBanner r={t} />
        <ClientBanner r={list} hasClients={people.some(isClient)} />
        <article>
          <p>In <a href={urlFor(list)}>{list.title}</a>{group && <> › <a href={urlFor(group)}>{group.title}</a></>}</p>
          <h1>
            {!readOnly && <CheckButton p={p} t={t} large />}
            {t.data.completed_at ? <s>{t.title}</s> : t.title}
          </h1>
          {t.data.completed_at && <p>Completed by {completer?.name ?? "someone"} on {fmtDate(t.data.completed_at, m.time_zone)}</p>}
          <dl>
            <dt>Assigned to</dt><dd>{names(people, t.data.assignee_ids) || "Unassigned"}</dd>
            <dt>When done, notify</dt><dd>{names(people, t.data.notify_ids) || "Nobody"}</dd>
            <dt>Due on</dt><dd>{dueText(t) || "No due date"}</dd>
            <dt>Notes</dt><dd>{t.body ? <Fmt text={t.body} {...sx(kit.prose)} /> : "None"}</dd>
            <dt>Added by</dt><dd>{author?.name ?? "Someone"} on {fmtDateTime(t.created_at, m.time_zone)}</dd>
          </dl>
          <p>{!readOnly && <a href={`/projects/${p.id}/tasks/${t.id}/edit`}>Edit</a>}{!isClient(m) && <> · <a href={`/projects/${p.id}/tasks/${t.id}/time`}>Log time</a></>}</p>
        </article>
        <ItemFooter r={t} project={p} />
      </Page>
    )
  }),

  // Was a GET that changed things (the "Undo" in the flash); now it posts when opened.
  page("/projects/:id/tasks/:tid/undo-complete", () => {
    const { id, tid } = useParams()
    return <Page title="Marking as not done"><p>Marking it as not done…</p><PostOnOpen action={`/projects/${id}/tasks/${tid}/undo-complete`} /></Page>
  }),

  page("/projects/:id/tasks/:tid/edit", () => {
    const { r: t, project: p } = findRecording(useParams().tid, "todo")
    const { list } = listOf(t)
    return (
      <Page title="Edit task" crumbs={listCrumbs(p, list)}>
        <h1>Edit task</h1>
        <Form action={`/projects/${p.id}/tasks/${t.id}/edit`}>
          <TodoFields people={projectPeople(p)} t={t} />
          <p><button>Save changes</button> <a href={urlFor(t)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  // Hill Chart
  page("/projects/:id/progress", () => {
    const [q] = useSearchParams()
    const p = findProject(useParams().id)
    const m = me()
    const lists = topLevel(p.id, "todolist").filter((l) => l.data.tracked === true)
    const pos = hillPositions(p.id)
    const ups = [...db.hill_updates.values()].filter((u) => u.project_id === p.id).sort((a, b) => b.id - a.id).slice(0, 50)
    const listName = (id: string) => lists.find((l) => l.id === Number(id))?.title
    const editing = q.get("update") === "1" && !isClient(m)
    return (
      <Page title="Progress" crumbs={projectCrumbs(p, "todos")}>
        <PageHead title="Progress" actions={[lists.length > 0 && !editing && !isClient(m) && <a key="update" href="?update=1" data-button>Update the hill</a>]} />
        <p>Uphill (0–49): working it out. Downhill (50–100): getting it done.</p>
        {lists.length === 0 ? (
          <><p>No lists on the hill yet. Open a list and pick “Show this list on the progress hill.”</p><p><a href={toolUrl(p, "todos")}>Go to the lists</a></p></>
        ) : editing ? (
          <Form action={`/projects/${p.id}/progress`}>
            {lists.map((l) => <p key={l.id}><label>{l.title}<br /><Slider name={`pos_${l.id}`} value={pos.get(l.id) ?? 0} /></label></p>)}
            <p><label>Add a note to this update (optional)<br /><input name="note" size={60} /></label></p>
            <button>Save positions</button> <a href={`/projects/${p.id}/progress`}>Cancel</a>
          </Form>
        ) : (
          <>
            <div {...sx(ls.hillCard)}><HillChart items={lists.map((l) => ({ label: l.title, value: pos.get(l.id) ?? 0 }))} /></div>
            <ul>{lists.map((l) => <li key={l.id}><a href={urlFor(l)}>{l.title}</a> <small>{pos.get(l.id) ?? 0} · {hillLabel(pos.get(l.id) ?? 0)}</small></li>)}</ul>
          </>
        )}
        <section id="history" aria-label="Previous updates">
          <h2>See previous updates</h2>
          {ups.length ? (
            <ul>{ups.map((u) => (
              <li key={u.id}>{fmtDateTime(u.created_at, m.time_zone)} · {personById(u.person_id)?.name ?? "Someone"}:{" "}
                {Object.entries(u.positions).filter(([id]) => listName(id)).map(([id, v]) => `${listName(id)} at ${v}`).join("; ")}{u.note ? ` · “${u.note}”` : ""}</li>
            ))}</ul>
          ) : <p>No updates yet.</p>}
        </section>
      </Page>
    )
  }),
]
