// Compass: one bar for how far along the work is, then the goals. A goal can be split into subgoals (one level), shown
// under it; it's done when they all are. Adding is one line: type, Enter, the next. Dates and people go on the goal's
// page. In the code below a goal is a "task" and a subgoal a "subtask" (old names). Posts: src/areas/todos.ts. Adding, completing and reordering change the copy right away.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useState, type DragEvent, type KeyboardEvent } from "react"
import { useParams } from "react-router"
import { db, temp } from "../store.ts"
import { me, findProject, findRecording, projectPeople, recordings, commentCount, personById, useVisit, type PersonWithCompany } from "../data.ts"
import { isClient, urlFor, windowUrl, type Project, type Recording, type Tool } from "../../shared/domain.ts"
import { useWindow, WindowField } from "../ui/in-window.tsx"
import { daysFromToday, fmtDate, fmtDateTime, isoDate, plural } from "../../shared/format.ts"
import { Fmt, kit, sx, useTween } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes, PostOnOpen, usePost, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"
import { progressOf } from "../news.ts"

const ts = stylex.create({
  // The bar on top: the share done in big type, the count, the bar.
  overall: { display: "grid", gap: space.s2, marginBottom: space.s4 },
  overallLine: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, margin: 0, maxWidth: "none" },
  overallPct: { fontSize: text.xl, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", lineHeight: 1 },
  overallText: { color: color.muted, fontSize: text.sm },
  bar: { display: "block", height: 6, borderRadius: radius.pill, backgroundColor: color.tile, overflow: "hidden" },
  // The fill slides in from the left (transform only, like the marketing demo), so its round end stays round at any width.
  fill: {
    display: "block", height: "100%", borderRadius: radius.pill, backgroundColor: color.accent,
    transitionProperty: "transform, background-color", transitionDuration: { default: "600ms", [media.reduce]: "0s" }, transitionTimingFunction: motion.out,
  },
  fillDone: { backgroundColor: color.control },
  shift: (pct: number) => ({ transform: `translateX(${pct - 100}%)` }),

  list: { display: "grid", margin: 0, padding: 0, listStyle: "none" },
  // A task: its row, then its subtasks indented under it. Rows are hairline-split; drag a task to reorder.
  task: { borderTopWidth: 0, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line, paddingBlock: 2, transitionProperty: "opacity", transitionDuration: "120ms" },
  dragging: { opacity: 0.45 },
  dropBefore: { boxShadow: `inset 0 2px 0 ${color.accent}` },
  dropAfter: { boxShadow: `inset 0 -2px 0 ${color.accent}` },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: 2, paddingBlock: 8 },
  title: { fontWeight: 500, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  done: { color: color.muted },
  // Ticked, a line draws through the title from the left, a beat behind the box; unticked, it pulls back quicker.
  strike: {
    backgroundImage: "linear-gradient(currentColor, currentColor)", backgroundRepeat: "no-repeat", backgroundPosition: "0 55%", backgroundSize: "0% 1.5px",
    transitionProperty: "background-size, color", transitionDuration: "150ms", transitionTimingFunction: motion.out,
  },
  struck: { backgroundSize: "100% 1.5px", transitionDuration: "300ms", transitionDelay: "120ms" },
  meta: { display: "inline-flex", flexWrap: "wrap", columnGap: space.s3, fontSize: text.sm, color: color.muted },
  count: { fontVariantNumeric: "tabular-nums" },
  // Late is the case orange is kept for: it needs attention now.
  late: { color: color.accentText, fontWeight: 600 },
  rowAction: { marginLeft: "auto", fontSize: text.sm },
  subs: { display: "grid", margin: 0, padding: 0, paddingLeft: 34, paddingBottom: 6, listStyle: "none" },
  sub: { borderTopWidth: 0, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, paddingBlock: 4 },
  subTitle: { fontSize: text.sm, fontWeight: 500, textDecoration: "none", ":hover": { textDecoration: "underline" } },

  // The one-line add: a field and a quiet Add, on its own or under a task.
  quick: { display: "flex", gap: space.s2, alignItems: "center", margin: 0, marginTop: space.s2, maxWidth: 560 },
  quickSub: { marginTop: 2, maxWidth: 480 },
  quickField: { flexGrow: 1, minWidth: 0, width: "auto", minHeight: 36, paddingBlock: 6 },
  quickBtn: { minHeight: 36 },
  showDone: { marginTop: space.s4 },
  empty: { padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  emptyText: { margin: 0, color: color.muted, maxWidth: "60ch" },

  check: {
    width: 22, height: 22, minHeight: 22, padding: 0, flexShrink: 0, borderRadius: 7, backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.accentSoft } },
    borderWidth: 1.5, borderStyle: "solid", borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.focus } }, color: color.onAccent,
    transitionProperty: "background-color, border-color, transform", transitionDuration: motion.fast,
  },
  checkSmall: { width: 18, height: 18, minHeight: 18, borderRadius: 6 },
  checkDone: { backgroundColor: color.accent, borderColor: { default: color.accent, ":hover": { default: null, [media.hover]: color.focus } } },
  checkLarge: { width: 28, height: 28, minHeight: 28, borderRadius: 9, verticalAlign: "-3px", marginRight: space.s2 },
  static: { display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" },
  // The check is always there, clipped away until ticked: then it wipes in from the left as the box fills.
  tick: { display: "flex", clipPath: "inset(0 100% 0 0)", transitionProperty: "clip-path", transitionDuration: "120ms", transitionTimingFunction: motion.out },
  ticked: { clipPath: "inset(0 0 0 0)", transitionDuration: "350ms", transitionDelay: "80ms" },
  // On a task's page: its subtasks under a small bar.
  subsHead: { display: "grid", gap: space.s2, maxWidth: 480, marginTop: space.s4, marginBottom: space.s2 },
  details: { marginTop: space.s6 },
})

const Tick = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)
/** The same box, not clickable, for read-only tasks. */
const CheckMark = ({ t, small = false }: { t: Recording; small?: boolean }) => (
  <span role="img" aria-label={t.data.completed_at ? "Done" : "Not done"} {...sx(ts.check, ts.static, small && ts.checkSmall, !!t.data.completed_at && ts.checkDone)}>{t.data.completed_at ? <Tick size={small ? 10 : 12} /> : null}</span>
)

// ---------- optimistic changes (mirror the posts in src/areas/todos.ts) ----------

/** /tasks/:tid/complete: a task takes its subtasks with it; a subtask settles its task (done when all of them are). */
const toggleDone = (t: Recording) => {
  const cur = db.recordings.get(String(t.id)) ?? t
  const now = new Date().toISOString()
  const mark = (r: Recording, done: boolean) =>
    db.recordings.set(String(r.id), { ...r, data: { ...r.data, completed_at: done ? now : null, completer_id: done ? me().id : null }, updated_at: now })
  const done = !cur.data.completed_at
  mark(cur, done)
  if (!cur.parent_id) for (const s of subtasksOf(cur.id)) mark(s, done)
  else {
    const task = db.recordings.get(String(cur.parent_id))
    if (task) mark(task, subtasksOf(task.id).every((s) => !!s.data.completed_at))
  }
}

/** The reorder posts: every `pos_<id>` field becomes that recording's position. Cards' column order uses it too. */
export const reorderLocal = (fd: FormData) => {
  for (const [k, v] of fd.entries()) {
    const r = k.startsWith("pos_") ? db.recordings.get(k.slice(4)) : undefined
    if (r) db.recordings.set(String(r.id), { ...r, position: Number(v) || 0 })
  }
}

/** A new task or subtask shows at once, at the end, until the server's row replaces it. */
const addLocal = (p: Project, title: string, parent: Recording | null, w?: Tool) => {
  const now = new Date().toISOString()
  temp("recordings", {
    account_id: p.account_id, project_id: p.id, parent_id: parent?.id ?? null, type: "todo", title, body: "", status: "active", trashed_at: null,
    data: { assignee_ids: [], notify_ids: [], completed_at: null, ...(w && w.id !== w.type ? { tool: w.id } : {}) },
    position: Number.MAX_SAFE_INTEGER, visible_to_clients: parent?.visible_to_clients ?? true, creator_id: me().id, created_at: now, updated_at: now,
  })
}

// ---------- reads ----------

const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id
const subtasksOf = (taskId: number) => recordings((s) => s.type === "todo" && s.status === "active" && s.parent_id === taskId).sort(byPosition)

type People = ReadonlyArray<PersonWithCompany>
const names = (people: People, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const isLate = (t: Recording) => !t.data.completed_at && !!t.data.due_on && daysFromToday(t.data.due_on) < 0
const dueText = (t: Recording) => {
  const d = t.data
  if (!d.due_on) return ""
  const when = d.starts_on ? `${fmtDate(d.starts_on)} – ${fmtDate(d.due_on)}` : fmtDate(d.due_on)
  return isLate(t) ? `${when} (${plural(-daysFromToday(d.due_on), "day")} late)` : when
}

const Bar = ({ pct, done = false }: { pct: number; done?: boolean }) => (
  <span aria-hidden="true" {...sx(ts.bar)}><span {...sx(ts.fill, done && ts.fillDone, ts.shift(pct))} /></span>
)

/** A title that's struck through once done. The line is always there, drawn to nothing, so ticking draws it. */
const Struck = ({ done, children }: { done: boolean; children: string }) => <span {...sx(ts.strike, done && ts.struck)}>{children}</span>

// ---------- pieces ----------

/** The round-trip "done" toggle: a box that fills orange with a check. */
const CheckButton = ({ p, t, large = false, small = false }: { p: Project; t: Recording; large?: boolean; small?: boolean }) => {
  const label = t.data.completed_at ? `Mark “${t.title}” as not done` : `Mark “${t.title}” as done`
  return (
    <Form action={`/projects/${p.id}/tasks/${t.id}/complete`} style={{ display: "inline" }} optimistic={() => toggleDone(t)}>
      <button aria-label={label} title={t.data.completed_at ? "Mark as not done" : "Mark as done"} {...sx(ts.check, small && ts.checkSmall, !!t.data.completed_at && ts.checkDone, large && ts.checkLarge)}>
        <span {...sx(ts.tick, !!t.data.completed_at && ts.ticked)}><Tick size={large ? 16 : small ? 10 : 12} /></span>
      </button>
    </Form>
  )
}

/** Who and when, quietly: "Ann · Oct 21 (2 days late)". */
const Meta = ({ t, people }: { t: Recording; people: People }) => {
  const n = commentCount(t.id)
  return (
    <span {...sx(ts.meta)}>
      {t.data.assignee_ids?.length > 0 && <span>{names(people, t.data.assignee_ids)}</span>}
      {t.data.due_on && <span {...sx(isLate(t) && ts.late)}>{dueText(t)}</span>}
      {n > 0 && <span>{plural(n, "comment")}</span>}
      {t.body && <span>📝</span>}
    </span>
  )
}

/** The one-line add: type, Enter, and it's ready for the next. Escape closes it when it was opened for a subtask. */
const QuickAdd = ({ p, action, placeholder, parent = null, w, autoFocus = false, onClose }: {
  p: Project; action: string; placeholder: string; parent?: Recording | null; w?: Tool; autoFocus?: boolean; onClose?: () => void
}) => (
  <Form action={action} optimistic={(fd) => addLocal(p, String(fd.get("title") ?? "").trim(), parent, w)} {...sx(ts.quick, !!parent && ts.quickSub)}>
    {w && <WindowField w={w} />}
    <input name="title" required autoFocus={autoFocus} placeholder={placeholder} aria-label={placeholder} autoComplete="off" {...sx(ts.quickField)}
      onKeyDown={(e) => { if (e.key === "Escape" && onClose) { e.preventDefault(); onClose() } }} />
    <button data-quiet {...sx(ts.quickBtn)}>Add</button>
  </Form>
)

/** A task on the list: its row, then its subtasks, and a one-line add for one more when asked. */
const TaskItem = observer(({ p, t, people, active, adding, onAdd }: { p: Project; t: Recording; people: People; active: boolean; adding: boolean; onAdd: (on: boolean) => void }) => {
  const subs = subtasksOf(t.id)
  const done = subs.filter((s) => s.data.completed_at).length
  return (
    <>
      <div {...sx(ts.row)}>
        {active ? <CheckButton p={p} t={t} /> : <CheckMark t={t} />}
        <a href={urlFor(t)} {...sx(ts.title, !!t.data.completed_at && ts.done)}><Struck done={!!t.data.completed_at}>{t.title}</Struck></a>
        {subs.length > 0 && <span {...sx(ts.meta, ts.count)}>{done}/{subs.length}</span>}
        <Meta t={t} people={people} />
        {active && !adding && <button type="button" data-quiet data-row-action onClick={() => onAdd(true)} {...sx(kit.linkButton, ts.rowAction)}>+ Subgoal</button>}
      </div>
      {(subs.length > 0 || adding) && (
        <ul {...sx(ts.subs)} aria-label={`Subgoals of ${t.title}`}>
          {subs.map((s) => (
            <li key={s.id} {...sx(ts.sub)}>
              {active ? <CheckButton p={p} t={s} small /> : <CheckMark t={s} small />}
              <a href={urlFor(s)} {...sx(ts.subTitle, !!s.data.completed_at && ts.done)}><Struck done={!!s.data.completed_at}>{s.title}</Struck></a>
              <Meta t={s} people={people} />
            </li>
          ))}
          {adding && <li {...sx(ts.sub)}><QuickAdd p={p} action={`/projects/${p.id}/tasks/${t.id}/subtasks`} placeholder="Add a subgoal…" parent={t} autoFocus onClose={() => onAdd(false)} /></li>}
        </ul>
      )}
    </>
  )
})

/** Fields for editing a task. */
const TodoFields = ({ people, t }: { people: People; t: Partial<Recording> }) => {
  const d = t.data ?? {}
  const mode = d.starts_on ? "range" : d.due_on ? "day" : "none"
  return (
    <>
      <TextField label="Goal" name="title" value={t.title ?? ""} placeholder="What does the project need to reach?" />
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

const crumbs = (p: Project, t: Recording) => {
  const task = t.parent_id ? db.recordings.get(String(t.parent_id)) : undefined
  return [...projectCrumbs(p, "todos"), ...(task ? [[task.title, urlFor(task)] as const] : [])]
}

// ---------- pages ----------
export const routes = [
  page("/projects/:id/tasks", () => {
    const p = findProject(useParams().id)
    const m = me()
    const w = useWindow(p, "todos")
    useVisit(windowUrl(p, w), `${p.name}: ${w.name}`, p.id)
    const pr = progressOf(p, w.id)
    const people = projectPeople(p)
    const active = p.status === "active"
    // A goal ticked while you're here stays in its place, struck through, so you see it happen; it joins the done goals
    // next time you open Compass.
    // ponytail: compares server stamps with this browser's clock; a clock far ahead could fold a fresh tick away at once.
    const [openedAt] = useState(() => new Date().toISOString())
    const stays = (t: Recording) => !t.data.completed_at || t.data.completed_at >= openedAt
    const open = pr.tasks.filter(stays).sort(byPosition)
    const finished = pr.tasks.filter((t) => !stays(t)).sort((a, b) => String(b.data.completed_at).localeCompare(String(a.data.completed_at)))
    const late = pr.tasks.flatMap((t) => [t, ...(pr.subtasks.get(t.id) ?? [])]).filter(isLate).length
    const shownPct = useTween(pr.pct)
    const [showDone, setShowDone] = useState(true)
    const [adding, setAdding] = useState<number | null>(null)

    // Reordering: drag a task (with its subtasks), or Alt+↑/↓ on it. The order saves at once.
    const post = usePost()
    const canOrder = active && !isClient(m) && open.length > 1
    const [dragId, setDragId] = useState<number | null>(null)
    const [drop, setDrop] = useState<number | null>(null)
    const ids = open.map((t) => t.id)
    const moveTo = (id: number, to: number) => {
      const next = ids.filter((x) => x !== id)
      next.splice(to, 0, id)
      if (next.join() === ids.join()) return
      const fd = new FormData()
      fd.set("tool", w.id)
      next.forEach((x, i) => fd.set(`pos_${x}`, String(i + 1)))
      post(`/projects/${p.id}/tasks/reorder`, fd, () => reorderLocal(fd))
    }
    const dragProps = (id: number, i: number) => !canOrder ? {} : {
      draggable: true,
      tabIndex: 0,
      "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
      onDragStart: (e: DragEvent) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(id)) },
      onDragOver: (e: DragEvent<HTMLLIElement>) => {
        if (dragId === null) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        setDrop(e.clientY < r.top + r.height / 2 ? i : i + 1)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (dragId !== null && drop !== null) moveTo(dragId, drop > ids.indexOf(dragId) ? drop - 1 : drop)
        setDragId(null); setDrop(null)
      },
      onDragEnd: () => { setDragId(null); setDrop(null) },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.target !== e.currentTarget || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return
        e.preventDefault()
        const to = i + (e.key === "ArrowUp" ? -1 : 1)
        if (to >= 0 && to < ids.length) moveTo(id, to)
      },
    }
    const addTask = active && <QuickAdd p={p} w={w} action={`/projects/${p.id}/tasks`} placeholder="Add a goal…" />

    return (
      <Page title={w.name} crumbs={projectCrumbs(p)}>
        <h1>{w.name}</h1>
        {pr.tasks.length === 0 ? (
          <div {...sx(ts.empty)}>
            <p {...sx(ts.emptyText)}>List the goals this project has to reach. Split a goal into subgoals: the detail people and agents work from. The bar fills as they get done.</p>
            {addTask}
          </div>
        ) : (
          <>
            <div {...sx(ts.overall)}>
              <p {...sx(ts.overallLine)}>
                <span {...sx(ts.overallPct)}>{shownPct}%</span>
                <span {...sx(ts.overallText)}>done · {pr.done} of {pr.total}{late > 0 && <span {...sx(ts.late)}> · {late} late</span>}</span>
              </p>
              <Bar pct={pr.pct} done={pr.total > 0 && pr.done === pr.total} />
            </div>
            {open.length > 0
              ? <ol {...sx(ts.list)} aria-label="Goals">
                  {open.map((t, i) => (
                    <li key={t.id} {...dragProps(t.id, i)} title={canOrder ? "Drag to reorder (or Alt+↑/↓)" : undefined}
                      {...sx(ts.task, dragId === t.id && ts.dragging, dragId !== null && drop === i && ts.dropBefore, dragId !== null && drop === i + 1 && i === ids.length - 1 && ts.dropAfter)}>
                      <TaskItem p={p} t={t} people={people} active={active} adding={adding === t.id} onAdd={(on) => setAdding(on ? t.id : null)} />
                    </li>
                  ))}
                </ol>
              : <p {...sx(ts.emptyText)}>Everything's done. 🎉</p>}
            {addTask}
            {finished.length > 0 && (
              <div {...sx(ts.showDone)}>
                <button type="button" data-quiet aria-expanded={showDone} onClick={() => setShowDone(!showDone)} {...sx(kit.linkButton)}>
                  {showDone ? "Hide done goals" : `Show ${plural(finished.length, "done goal")}`}
                </button>
                {showDone && <ul {...sx(ts.list)}>{finished.map((t) => <li key={t.id} {...sx(ts.task)}><TaskItem p={p} t={t} people={people} active={active} adding={false} onAdd={() => {}} /></li>)}</ul>}
              </div>
            )}
          </>
        )}
        <p {...sx(kit.links)}><a href={`/projects/${p.id}/trash`}>Archived & trashed goals</a></p>
      </Page>
    )
  }),

  page("/projects/:id/tasks/:tid", () => {
    const { r: t, project: p } = findRecording(useParams().tid, "todo")
    const m = me()
    useVisit(urlFor(t), t.title, p.id)
    const people = projectPeople(p)
    const author = personById(t.creator_id)
    const completer = personById(t.data.completer_id)
    const readOnly = t.status !== "active" || p.status !== "active"
    const parent = t.parent_id ? db.recordings.get(String(t.parent_id)) : undefined
    const subs = parent ? [] : subtasksOf(t.id)
    const done = subs.filter((s) => s.data.completed_at).length
    const pct = subs.length ? Math.round((done / subs.length) * 100) : 0
    return (
      <Page title={t.title} crumbs={crumbs(p, t)}>
        <StatusBanner r={t} />
        <ClientBanner r={parent ?? t} hasClients={people.some(isClient)} />
        <article>
          {parent && <p>A subgoal of <a href={urlFor(parent)}>{parent.title}</a></p>}
          <h1>
            {!readOnly && <CheckButton p={p} t={t} large />}
            <Struck done={!!t.data.completed_at}>{t.title}</Struck>
          </h1>
          {t.data.completed_at && <p>Completed by {completer?.name ?? "someone"} on {fmtDate(t.data.completed_at, m.time_zone)}</p>}
          {/* A task's subtasks come first: for a split task they're the work. Its details follow. */}
          {!parent && (subs.length > 0 || !readOnly) && (
            <section aria-label="Subgoals">
              <div {...sx(ts.subsHead)}>
                <h2 style={{ margin: 0 }}>Subgoals</h2>
                {subs.length > 0 ? <><Bar pct={pct} done={done === subs.length} /><small>{done} of {subs.length} done · this goal is done when they all are</small></>
                  : <small>Split this goal into subgoals. It's done when they all are.</small>}
              </div>
              <ul {...sx(ts.list)}>
                {subs.map((s) => (
                  <li key={s.id} {...sx(ts.sub)}>
                    {readOnly ? <CheckMark t={s} small /> : <CheckButton p={p} t={s} small />}
                    <a href={urlFor(s)} {...sx(ts.subTitle, !!s.data.completed_at && ts.done)}><Struck done={!!s.data.completed_at}>{s.title}</Struck></a>
                    <Meta t={s} people={people} />
                  </li>
                ))}
              </ul>
              {!readOnly && <QuickAdd p={p} action={`/projects/${p.id}/tasks/${t.id}/subtasks`} placeholder="Add a subgoal…" parent={t} />}
            </section>
          )}
          <dl {...sx(ts.details)}>
            <dt>Assigned to</dt><dd>{names(people, t.data.assignee_ids) || "Unassigned"}</dd>
            <dt>When done, notify</dt><dd>{names(people, t.data.notify_ids) || "Nobody"}</dd>
            <dt>Due on</dt><dd>{dueText(t) || "No due date"}</dd>
            <dt>Notes</dt><dd>{t.body ? <Fmt text={t.body} {...sx(kit.prose)} /> : "None"}</dd>
            <dt>Added by</dt><dd>{author?.name ?? "Someone"}{t.via ? ` via ${t.via}` : ""} on {fmtDateTime(t.created_at, m.time_zone)}</dd>
          </dl>
          <p>{!readOnly && <a href={`/projects/${p.id}/tasks/${t.id}/edit`}>Edit</a>}</p>
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
    return (
      <Page title="Edit goal" crumbs={crumbs(p, t)}>
        <h1>Edit goal</h1>
        <Form action={`/projects/${p.id}/tasks/${t.id}/edit`}>
          <TodoFields people={projectPeople(p)} t={t} />
          <p><button>Save changes</button> <a href={urlFor(t)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),
]
