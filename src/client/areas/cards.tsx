// Board, after Fizzy: drag cards across Not now · To do · your columns · Done. New cards land in To do; a Golden
// Ticket keeps a card at the top of its column; cards nobody touches for 30 days move to Not now on their own (a job in
// src/areas/cards.ts). The board, new column, column ••• menu, card (with steps), edit card. Posts: src/areas/cards.ts.
// Moving a card, adding one, a Golden Ticket, checking off a step and reordering columns change the copy right away.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useRef, useState, type DragEvent, type PointerEvent } from "react"
import { useLocation, useParams } from "react-router"
import { db, temp } from "../store.ts"
import { me, findProject, findRecording, projectPeople, children, recordings, personById, topOf, useVisit, NoAccess, NotFound, type PersonWithCompany } from "../data.ts"
import { isClient, urlFor, windowIdOf, windowUrl, type Project, type Recording, type Tool } from "../../shared/domain.ts"
import { useWindow, WindowField } from "../ui/in-window.tsx"
import { ago, fmtDate, isoDate } from "../../shared/format.ts"
import { ByLine, fadeOverflow, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, PeopleCheckboxes, PostOnOpen, submitOwnForm, usePost, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"
import { reorderLocal } from "./todos.tsx"
import { color, media, motion, radius, space, text } from "../ui/tokens.stylex.ts"

// The table: columns side by side (scrolling sideways when they don't fit), cards as white cards in each column.
/** Label colors for board columns and folders, drawn as dots. */
export const DOT: Record<string, string> = { red: "#e5484d", orange: "#f99c00", yellow: "#f5c518", green: "#30a46c", blue: "#3e7bfa", purple: "#8e4ec6", gray: "#8b8d98" }
const ks = stylex.create({
  board: {
    // Columns share the width when they fit (a window with two or three columns has no empty gap); past that the
    // board scrolls sideways, its end fading while there are more columns to see.
    display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(min(240px, 82vw), 1fr)", gap: space.s3, alignItems: "start",
    overflowX: "auto", overscrollBehaviorX: "contain", scrollSnapType: "x proximity", marginBottom: space.s5,
    // No scrollbar: the faded end says there are more columns, and you get there by dragging the background, Shift+wheel
    // or a trackpad swipe.
    scrollbarWidth: "none",
    // Dragging on the board moves cards and columns; it never selects their text.
    userSelect: "none",
  },
  // One of your columns, dragged by its head: it fades, and a 3px orange edge shows where it will land.
  colGrab: { cursor: "grab" },
  colDragging: { opacity: 0.45 },
  colDropBefore: { boxShadow: `inset 3px 0 0 ${color.accent}` },
  colDropAfter: { boxShadow: `inset -3px 0 0 ${color.accent}` },
  // The last thing on the board, after Done: a dashed tile that adds a column (its own one-line field once opened).
  addCol: {
    alignSelf: "start", display: "flex", alignItems: "center", justifyContent: "center", gap: space.s2, minHeight: 52, width: "100%",
    borderRadius: radius.xl, borderWidth: 1.5, borderStyle: "dashed", fontSize: text.sm, fontWeight: 600,
    borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.ink } },
    color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
    transitionProperty: "border-color, color, background-color", transitionDuration: "150ms", transitionTimingFunction: "ease",
  },
  addColForm: { alignSelf: "start", display: "flex", gap: 6, padding: space.s3, borderRadius: radius.xl, backgroundColor: color.tile, margin: 0 },
  column: {
    scrollSnapAlign: "start", backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s3, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: space.s2,
    transitionProperty: "box-shadow, background-color", transitionDuration: "120ms", transitionTimingFunction: "ease",
  },
  // The column a dragged card would land in.
  columnOver: { backgroundColor: color.tileHover, boxShadow: `inset 0 0 0 2px ${color.accent}` },
  colHead: { display: "flex", alignItems: "center", gap: space.s2, paddingInline: 6, paddingTop: 4, margin: 0, fontSize: text.base },
  dot: (bg: string) => ({ backgroundColor: bg }),
  dotBox: { width: 9, height: 9, borderRadius: radius.pill, flexShrink: 0 },
  count: {
    marginLeft: "auto", flexShrink: 0, minWidth: 22, paddingBlock: 3, paddingInline: 7, borderRadius: radius.pill, backgroundColor: color.sheet,
    fontSize: text.xs, fontWeight: 700, textAlign: "center", fontVariantNumeric: "tabular-nums",
  },
  colMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s3, paddingInline: 6, margin: 0, fontSize: text.xs, color: color.muted },
  cards: { margin: 0, display: "grid", gap: space.s2 },
  card: {
    position: "relative", borderTopWidth: 0, padding: space.s3, borderRadius: radius.lg, backgroundColor: color.sheet, display: "grid", gap: 6,
    transitionProperty: "opacity", transitionDuration: "120ms",
  },
  cardDraggable: { cursor: "grab" },
  cardDragging: { opacity: 0.45 },
  // A Golden Ticket: Peach Wash, the color kept for what's pinned, and a star before its title.
  golden: { backgroundColor: color.accentSoft },
  star: { color: color.accentText, marginRight: 4 },
  addCard: { justifySelf: "start", minHeight: 30, paddingBlock: 2, paddingInline: 10, fontSize: text.sm, color: color.muted, backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.sheet } } },
  cardTitle: { fontWeight: 600, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  cardMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s2, fontSize: text.xs, color: color.muted },
  // Where a dragged card will land: a short orange line between cards.
  dropLine: { height: 3, marginBlock: -1, borderRadius: radius.pill, backgroundColor: color.accent, borderTopWidth: 0, padding: 0 },
  // The column's ••• sits in its head, after the count.
  colMore: { marginLeft: 2, paddingInline: 4, fontSize: text.sm, fontWeight: 400, color: color.muted, textDecoration: "none" },
  small: { minHeight: 28, paddingBlock: 2, fontSize: text.xs, whiteSpace: "nowrap" },
  // A plain button on a Tile Gray column: it takes the sheet's white so it doesn't vanish into the column.
  onTile: { backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tileHover } } },
  none: { margin: 0, paddingInline: 6, paddingBlock: space.s2, fontSize: text.sm, color: color.muted },
  add: { display: "flex", gap: 6, margin: 0 },
  addInput: { flexGrow: 1, minWidth: 0, width: "auto", minHeight: 32, paddingBlock: 3, fontSize: text.sm, margin: 0, backgroundColor: color.sheet },
  // The card page: title, one line of facts, what to do; steps with real checkboxes, like tasks.
  facts: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, rowGap: space.s1, marginTop: space.s1, color: color.muted, fontSize: text.sm, maxWidth: "none" },
  // At least as wide as its longest column name (the browser's own measure cuts the name short).
  columnPick: { color: color.ink, paddingLeft: 8, marginLeft: -8, minWidth: "max-content" },
  cardDo: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s4, marginTop: space.s5 },
  // The sweep: a card waiting in Review, and its three answers.
  sweep: { marginTop: space.s5, padding: space.s5, borderRadius: radius.xl, backgroundColor: color.tile },
  sweepHead: { margin: 0 },
  sweepDo: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s3, marginTop: space.s3 },
  steps: { marginTop: space.s7 },
  stepList: { margin: 0, marginBottom: space.s4 },
  step: { display: "flex", alignItems: "flex-start", gap: space.s3, paddingBlock: 8 },
  check: {
    width: 22, height: 22, minHeight: 22, padding: 0, flexShrink: 0, borderRadius: 7, color: color.onAccent,
    borderWidth: 1.5, borderStyle: "solid", borderColor: { default: color.control, ":hover": { default: null, [media.hover]: color.focus } },
    backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.accentSoft } },
    transitionProperty: "background-color, border-color", transitionDuration: motion.fast,
  },
  checkDone: { backgroundColor: color.accent, borderColor: { default: color.accent, ":hover": { default: null, [media.hover]: color.focus } } },
  stepDone: { color: color.muted, textDecoration: "line-through", textDecorationColor: color.accent, textDecorationThickness: 2 },
  stepMeta: { display: "block", fontSize: text.xs, color: color.muted },
  stepRemove: { marginLeft: "auto", fontSize: text.sm, color: color.muted },
})

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const KIND_ORDER: Record<string, number> = { not_now: 0, triage: 1, custom: 2, review: 3, done: 4 }
/** What an empty column says. */
const EMPTY: Record<string, string> = {
  not_now: "Cards nobody touches for 30 days end up here.", triage: "New cards start here.", custom: "No cards here.", review: "Finished work waits here for someone to look at it.", done: "Done cards land here.",
}
/** Cards in a column: Golden Tickets first, then the one that arrived last on top. */
const cardOrder = (a: Recording, b: Recording) => Number(!!b.data.golden) - Number(!!a.data.golden) || b.position - a.position || b.id - a.id

/** A board's active columns in display order: Not now, To do, your columns, Review, Done. A project can have several boards. */
const columnsOf = (p: Project, boardId: string) =>
  recordings((r) => r.project_id === p.id && r.type === "column" && r.status === "active" && windowIdOf(p, r) === boardId)
    .sort((a, b) => (KIND_ORDER[a.data.kind ?? "custom"]! - KIND_ORDER[b.data.kind ?? "custom"]!) || a.position - b.position || a.id - b.id)

/** Every board has Not now, To do, Review and Done; the server makes any that are missing. */
const EnsureColumns = ({ p, boardId, cols }: { p: Project; boardId: string; cols: ReadonlyArray<Recording> }) =>
  ["triage", "not_now", "review", "done"].every((k) => cols.some((col) => col.data.kind === k)) ? null : <PostOnOpen action={`/projects/${p.id}/board/setup`} fields={{ tool: boardId }} />

/** The sweep, on a card waiting in Review: Ship it, Send it back (with what should change), or Kill it. Posts to
 * /cards/:cid/review, which also says when someone got there first. `then`: where to go after, when it isn't the board. */
const Sweep = ({ p, r, then, tz }: { p: Project; r: Recording; then: string; tz: string }) => {
  const action = `/projects/${p.id}/cards/${r.id}/review`
  const rv = r.data.review as { at?: string; by?: number; via?: string | null } | undefined
  const by = rv?.by ? personById(rv.by) : null
  const fields = (verdict: string) => <><input type="hidden" name="verdict" value={verdict} />{then && <input type="hidden" name="then" value={then} />}</>
  return (
    <section aria-label="Review" {...sx(ks.sweep)}>
      <p {...sx(ks.sweepHead)}><b>Ready for you.</b>{rv?.at && <> {by?.name ?? "Someone"}{rv.via ? ` via ${rv.via}` : ""} moved it here {ago(rv.at, tz)}.</>}</p>
      <div {...sx(ks.sweepDo)}>
        <Form action={action} style={{ display: "inline" }}>{fields("ship")}<button data-primary>Ship it</button></Form>
        <Form action={action} style={{ display: "inline" }}>{fields("kill")}<button>Kill it</button></Form>
      </div>
      <details>
        <summary>Send it back</summary>
        <Form action={action}>
          {fields("back")}
          <p><label>What should change?<br /><textarea name="body" rows={3} cols={60} required /></label></p>
          <p><button>Send back</button></p>
        </Form>
      </details>
    </section>
  )
}

/** The address of the board a column is on. */
const boardOf = (p: Project, col: Recording) => windowUrl(p, { id: windowIdOf(p, col) ?? "cardtable", type: "cardtable" })

const findColumn = (p: Project, id: string | undefined) => {
  const col = db.recordings.get(String(Number(id) || 0))
  if (!col || col.project_id !== p.id || col.type !== "column" || col.status !== "active") throw new NotFound()
  return col
}

const names = (people: ReadonlyArray<PersonWithCompany>, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const crumbs = (p: Project) => projectCrumbs(p, "cardtable")

// ---------- optimistic changes (mirror the posts in src/areas/cards.ts) ----------

/** moveCard: it lands on top of the column; Done stamps it completed, leaving Done clears that. */
const moveLocal = (card: Recording, colId: unknown) => {
  const cur = db.recordings.get(String(card.id)) ?? card
  const col = db.recordings.get(String(Number(colId) || 0))
  if (!col || col.type !== "column" || col.project_id !== cur.project_id || cur.parent_id === col.id) return
  const now = new Date().toISOString()
  const done = col.data.kind === "done"
  db.recordings.set(String(cur.id), { ...cur, parent_id: col.id, position: Date.now(), data: { ...cur.data, completed_at: done ? cur.data.completed_at ?? now : null }, updated_at: now })
}

/** Put a column's cards in this order (top first): the top card gets the highest position. */
const orderLocal = (order: ReadonlyArray<number>) =>
  order.forEach((id, i) => { const r = db.recordings.get(String(id)); if (r) db.recordings.set(String(id), { ...r, position: order.length - i }) })

/** A new column shows at once, last of your columns (before Done), until the server's row replaces it. */
const addColumnLocal = (p: Project, w: Tool, title: string) => {
  const now = new Date().toISOString()
  temp("recordings", {
    account_id: p.account_id, project_id: p.id, parent_id: null, type: "column", title, body: "", status: "active", trashed_at: null,
    data: { kind: "custom", color: "", watcher_ids: [], ...(w.id !== w.type ? { tool: w.id } : {}) }, position: Number.MAX_SAFE_INTEGER,
    visible_to_clients: true, creator_id: me().id, created_at: now, updated_at: now,
  })
}

/** A new card shows at once, on top of To do, until the server's row replaces it. */
const addLocal = (p: Project, col: Recording, title: string) => {
  const now = new Date().toISOString()
  temp("recordings", {
    account_id: p.account_id, project_id: p.id, parent_id: col.id, type: "card", title, body: "", status: "active", trashed_at: null,
    data: { assignee_ids: [], due_on: null, golden: false, completed_at: null }, position: Number.MAX_SAFE_INTEGER,
    visible_to_clients: p.clients_see_new, creator_id: me().id, created_at: now, updated_at: now,
  })
}

/** Flip a data flag the way updateRecording merges it. */
const flipLocal = (r: Recording, change: (d: Record<string, any>) => Record<string, any>) => {
  const cur = db.recordings.get(String(r.id)) ?? r
  db.recordings.set(String(cur.id), { ...cur, data: { ...cur.data, ...change(cur.data) }, updated_at: new Date().toISOString() })
}

// ---------- pieces ----------

const ColumnSelect = ({ cols, current, name = "column_id", onChange, label, quiet }: { cols: ReadonlyArray<Recording>; current: number | null; name?: string; onChange?: typeof submitOwnForm; label?: string; quiet?: boolean }) => (
  <select name={name} defaultValue={current ?? undefined} onChange={onChange} aria-label={label} {...(quiet ? sx(kit.quietSelect, ks.columnPick) : {})}>{cols.map((col) => <option key={col.id} value={col.id}>{col.title}</option>)}</select>
)

const Tick = () => (
  <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
)

const ColorSelect = ({ current }: { current: string }) => (
  <select name="color" defaultValue={current}>{COLORS.map((col) => <option key={col} value={col}>{col || "No color"}</option>)}</select>
)

/** A card on the board. Drag it up or down its column, or into another one. (On a phone, its page moves it.) */
const CardItem = observer(({ k, people, active, dragging, onDrag }: {
  k: Recording; people: ReadonlyArray<PersonWithCompany>; active: boolean; dragging: boolean; onDrag: (k: Recording | null) => void
}) => {
  const steps = children(k.id, "step")
  const stepsDone = steps.filter((s) => s.data.completed_at).length
  const drag = active ? {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(k.id)); onDrag(k) },
    onDragEnd: () => onDrag(null),
  } : {}
  return (
    <li data-card data-dragging={dragging || undefined} {...drag} {...sx(ks.card, active && ks.cardDraggable, !!k.data.golden && ks.golden, dragging && ks.cardDragging)}>
      <a href={urlFor(k)} {...sx(ks.cardTitle)}>{k.data.golden && <span role="img" aria-label="Golden Ticket" title="Golden Ticket" {...sx(ks.star)}>★</span>}{k.title}</a>
      {(k.data.assignee_ids?.length || k.data.due_on || steps.length > 0) && (
        <span {...sx(ks.cardMeta)}>
          {k.data.assignee_ids?.length > 0 && <span>{names(people, k.data.assignee_ids)}</span>}
          {k.data.due_on && <span>due {fmtDate(k.data.due_on)}</span>}
          {steps.length > 0 && <span>steps {stepsDone}/{steps.length}</span>}
        </span>
      )}
    </li>
  )
})


/** After Done, like Fizzy: "+ Add a column", then a one-line name. Enter adds it (before Done) and it's ready for the next. */
const AddColumn = ({ p, w }: { p: Project; w: Tool }) => {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  return open
    ? <Form key={loc.key} action={`/projects/${p.id}/columns`} optimistic={(fd) => addColumnLocal(p, w, String(fd.get("name") ?? "").trim())} {...sx(ks.addColForm)}>
        <WindowField w={w} />
        <input name="name" required autoFocus autoComplete="off" placeholder="Name the column" aria-label="Column name" {...sx(ks.addInput)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false) } }} />
        <button data-quiet {...sx(ks.small, ks.onTile)}>Add</button>
      </Form>
    : <button type="button" data-quiet onClick={() => setOpen(true)} {...sx(ks.addCol)}>+ Add a column</button>
}

/** Add a card to To do: one line, Enter, and it's ready for the next. Escape closes it. */
const AddCard = ({ p, col, onClose }: { p: Project; col: Recording; onClose: () => void }) => (
  <Form action={`/projects/${p.id}/cards`} optimistic={(fd) => addLocal(p, col, String(fd.get("title") ?? "").trim())} {...sx(ks.add)}>
    <input type="hidden" name="column_id" value={col.id} />
    <input name="title" required autoFocus autoComplete="off" placeholder="Card title" aria-label="Card title" {...sx(ks.addInput)}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose() } }} />
    <button data-quiet {...sx(ks.small, ks.onTile)}>Add</button>
  </Form>
)

// ---------- pages ----------
export const routes = [
  page("/projects/:id/board", () => {
    const loc = useLocation()
    const p = findProject(useParams().id)
    const m = me()
    const w = useWindow(p, "cardtable")
    useVisit(windowUrl(p, w), `${p.name}: ${w.name}`, p.id)
    const cols = columnsOf(p, w.id)
    const people = projectPeople(p)
    const onBoard = new Set(cols.map((col) => col.id))
    const cards = recordings((r) => r.project_id === p.id && r.type === "card" && r.status === "active" && onBoard.has(r.parent_id!)).sort(cardOrder)
    const active = p.status === "active"
    const [adding, setAdding] = useState(false)

    // Dragging a card: an orange line shows where it will land (between two cards, in its own column or another), the
    // column under it lights up when it's another, and dropping puts it there at once.
    const post = usePost()
    const [dragged, setDragged] = useState<Recording | null>(null)
    const [over, setOver] = useState<{ col: number; at: number } | null>(null)
    const others = (col: Recording) => cards.filter((k) => k.parent_id === col.id && k.id !== dragged?.id)
    const dropZone = (col: Recording) => !active ? {} : {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!dragged) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        // The spot: before the first card (other than the dragged one) whose middle is below the pointer.
        const spots = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-card]")].filter((el) => !el.hasAttribute("data-dragging"))
        const at = spots.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 })
        const next = { col: col.id, at: at < 0 ? spots.length : at }
        if (over?.col !== next.col || over.at !== next.at) setOver(next)
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.col === col.id ? null : o)) },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (dragged && over?.col === col.id) {
          const order = others(col).map((k) => k.id)
          order.splice(over.at, 0, dragged.id)
          const same = dragged.parent_id === col.id
          const before = cards.filter((k) => k.parent_id === col.id).map((k) => k.id)
          if (!same || order.join() !== before.join())
            post(`/projects/${p.id}/cards/${dragged.id}/move`, { column_id: String(col.id), order: order.join(",") }, () => { if (!same) moveLocal(dragged, col.id); orderLocal(order) })
        }
        setDragged(null); setOver(null)
      },
    }
    const onDrag = (k: Recording | null) => { setDragged(k); if (!k) setOver(null) }

    // Trello-style panning: press the board's background (anywhere that isn't a card, a column head, a button or a
    // field) and drag sideways; the board follows the mouse. Touch scrolls by itself, so this is for a mouse only. While
    // panning, snapping waits; on release the board settles on the nearest column.
    const pan = useRef<{ x: number; left: number; id: number } | null>(null)
    const NOT_PAN = "a, button, input, select, textarea, label, summary, [draggable='true'], [data-card]"
    const panning = {
      onPointerEnter: (e: PointerEvent<HTMLElement>) => { const el = e.currentTarget; el.style.cursor = el.scrollWidth > el.clientWidth ? "grab" : "" },
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        const el = e.currentTarget
        if (e.pointerType !== "mouse" || e.button !== 0 || el.scrollWidth <= el.clientWidth || (e.target as HTMLElement).closest(NOT_PAN)) return
        pan.current = { x: e.clientX, left: el.scrollLeft, id: e.pointerId }
        el.setPointerCapture(e.pointerId)
        el.style.cursor = "grabbing"
        el.style.scrollSnapType = "none"
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const p = pan.current
        if (p && p.id === e.pointerId) e.currentTarget.scrollLeft = p.left - (e.clientX - p.x)
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        if (!pan.current) return
        pan.current = null
        const el = e.currentTarget
        el.style.cursor = "grab"
        el.style.scrollSnapType = ""
      },
    }

    // Dragging one of your columns by its head (Not now, To do and Done stay where they are): the spot is before the
    // first of your other columns whose middle is right of the pointer; dropping saves the new order at once.
    const yours = cols.filter((col) => col.data.kind === "custom")
    const [draggedCol, setDraggedCol] = useState<Recording | null>(null)
    const [colAt, setColAt] = useState<number | null>(null)
    const canOrder = active && !isClient(m) && yours.length > 1
    const colDrag = (col: Recording) => !canOrder || col.data.kind !== "custom" ? {} : {
      draggable: true,
      onDragStart: (e: DragEvent) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", `column-${col.id}`); setDraggedCol(col) },
      onDragEnd: () => { setDraggedCol(null); setColAt(null) },
    }
    const boardDrop = !canOrder ? {} : {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!draggedCol) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        const spots = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-your-column]")].filter((el) => el.id !== `column-${draggedCol.id}`)
        const at = spots.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2 })
        const next = at < 0 ? spots.length : at
        if (next !== colAt) setColAt(next)
      },
      onDrop: (e: DragEvent) => {
        if (!draggedCol || colAt === null) return
        e.preventDefault()
        const order = yours.filter((col) => col.id !== draggedCol.id).map((col) => col.id)
        order.splice(colAt, 0, draggedCol.id)
        if (order.join() !== yours.map((col) => col.id).join()) {
          const fd = new FormData()
          fd.set("tool", w.id)
          order.forEach((id, i) => fd.set(`pos_${id}`, String(i + 1)))
          post(`/projects/${p.id}/columns/order`, fd, () => reorderLocal(fd))
        }
        setDraggedCol(null); setColAt(null)
      },
    }
    // Where the orange edge goes while a column is dragged: left of the column it would go before, or right of the last.
    const rest = yours.filter((col) => col.id !== draggedCol?.id)
    const edgeBefore = draggedCol && colAt !== null ? rest[colAt]?.id : undefined
    const edgeAfter = draggedCol && colAt !== null && colAt >= rest.length ? rest.at(-1)?.id : undefined
    return (
      <Page title={w.name} crumbs={projectCrumbs(p)}>
        <EnsureColumns p={p} boardId={w.id} cols={cols} />
        <PageHead title={w.name} />
        <div ref={fadeOverflow} data-board {...boardDrop} {...panning} onPointerCancel={panning.onPointerUp} {...sx(ks.board)}>
          {cols.map((col) => {
            const inCol = cards.filter((k) => k.parent_id === col.id)
            return (
              <section key={col.id} id={`column-${col.id}`} aria-label={col.title} data-your-column={col.data.kind === "custom" || undefined} {...dropZone(col)}
                {...sx(ks.column, over?.col === col.id && dragged?.parent_id !== col.id && ks.columnOver, draggedCol?.id === col.id && ks.colDragging,
                  edgeBefore === col.id && ks.colDropBefore, edgeAfter === col.id && ks.colDropAfter)}>
                <h2 {...colDrag(col)} title={canOrder && col.data.kind === "custom" ? "Drag to move this column" : undefined} {...sx(ks.colHead, canOrder && col.data.kind === "custom" && ks.colGrab)}>
                  {col.data.color && <span title={col.data.color} {...sx(ks.dotBox, ks.dot(DOT[col.data.color] ?? DOT.gray!))} />}{col.title}<span {...sx(ks.count)}>{inCol.length}</span>
                  {!isClient(m) && <a href={`/projects/${p.id}/columns/${col.id}`} aria-label={`${col.title} column options`} title="Column options" {...sx(ks.colMore)}>•••</a>}
                </h2>
                {col.data.watcher_ids?.length > 0 && <p {...sx(ks.colMeta)}><span>Watching: {names(people, col.data.watcher_ids)}</span></p>}
                {/* New cards start in To do, like Fizzy: one quiet "+ Add a card" that opens a one-line field. */}
                {active && col.data.kind === "triage" && (adding
                  ? <AddCard key={loc.key} p={p} col={col} onClose={() => setAdding(false)} />
                  : <button type="button" data-quiet onClick={() => setAdding(true)} {...sx(ks.addCard)}>+ Add a card</button>)}
                {/* An empty column keeps its sentence while a card is over it (the line goes above it): swapping out the
                    element under the pointer would make the browser drop the drop. */}
                {inCol.length
                  ? <ul {...sx(ks.cards)}>{(() => {
                      // The line goes at the spot among the other cards; the dragged one keeps its place (faded) meanwhile.
                      const rest = others(col)
                      const line = over?.col === col.id ? <li key="drop" aria-hidden="true" {...sx(ks.dropLine)} /> : null
                      const items = inCol.map((k) => <CardItem key={k.id} k={k} people={people} active={active} dragging={dragged?.id === k.id} onDrag={onDrag} />)
                      if (!line) return items
                      const anchor = rest[over!.at]
                      const idx = anchor ? inCol.findIndex((k) => k.id === anchor.id) : inCol.length
                      return [...items.slice(0, idx), line, ...items.slice(idx)]
                    })()}</ul>
                  : <>{over?.col === col.id && <div aria-hidden="true" {...sx(ks.dropLine)} />}<p {...sx(ks.none)}>{EMPTY[col.data.kind ?? "custom"]}</p></>}
              </section>
            )
          })}
          {active && !isClient(m) && <AddColumn p={p} w={w} />}
        </div>
      </Page>
    )
  }),

  // Columns
  page("/projects/:id/columns/:colid", () => {
    const params = useParams()
    const p = findProject(params.id)
    const m = me()
    if (isClient(m)) throw new NoAccess()
    const col = findColumn(p, params.colid)
    const cols = columnsOf(p, windowIdOf(p, col) ?? "cardtable")
    const watching = (col.data.watcher_ids ?? []).includes(m.id)
    const others = cols.filter((x) => x.id !== col.id)
    return (
      <Page title={`${col.title} column`} crumbs={crumbs(p)}>
        <EnsureColumns p={p} boardId={windowIdOf(p, col) ?? "cardtable"} cols={cols} />
        <h1>{col.title} column</h1>
        <Form action={`/projects/${p.id}/columns/${col.id}`}>
          <p><label>Rename <input name="name" defaultValue={col.title} required /></label></p>
          <p><label>Color <ColorSelect current={col.data.color ?? ""} /></label></p>
          <button>Save changes</button>
        </Form>
        <Form action={`/projects/${p.id}/columns/${col.id}/watch`}>
          <p>{watching ? "You're watching this column. You get notified when cards land in it." : "Watch this column to get notified when cards land in it."}</p>
          <button>{watching ? "Stop watching this column" : "Watch this column"}</button>
        </Form>
        <Form action={`/projects/${p.id}/columns/${col.id}/move-all`}>
          <p><label>Move all cards to… <ColumnSelect cols={others} current={null} /></label> <button>Move all cards</button></p>
        </Form>
        {col.data.kind === "custom"
          ? <Form action={`/projects/${p.id}/columns/${col.id}/delete`}><p><button>Delete this column</button></p></Form>
          : <p><small>{col.title} comes with every board, so it can't be deleted.</small></p>}
        <p><a href={`${boardOf(p, col)}#column-${col.id}`}>Back to the board</a></p>
      </Page>
    )
  }),

  // Cards
  page("/projects/:id/cards/:cid", () => {
    const loc = useLocation()
    const { r, project } = findRecording(useParams().cid, "card")
    const m = me()
    useVisit(urlFor(r), r.title, project.id)
    const boardId = windowIdOf(project, topOf(r)) ?? "cardtable"
    const cols = columnsOf(project, boardId)
    const col = cols.find((x) => x.id === r.parent_id)
    const people = projectPeople(project)
    const steps = children(r.id, "step")
    const author = personById(r.creator_id)
    const live = r.status === "active" && project.status === "active"
    const doneCol = cols.find((x) => x.data.kind === "done")
    const from = new URLSearchParams(loc.search).get("from")
    return (
      <Page title={r.title} crumbs={crumbs(project)}>
        <EnsureColumns p={project} boardId={boardId} cols={cols} />
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={people.some(isClient)} />
        {/* The card first, then one line of facts (its column is a quiet "move" dropdown), then what to do with it. */}
        <article>
          <h1>{r.title}</h1>
          <p {...sx(ks.facts)}>
            {live
              ? <Form key={r.parent_id} action={`/projects/${project.id}/cards/${r.id}/move`} style={{ display: "inline" }} optimistic={(fd) => moveLocal(r, fd.get("column_id"))}>
                  <ColumnSelect cols={cols} current={r.parent_id} onChange={submitOwnForm} label="Column" quiet />
                </Form>
              : <span>{col?.title ?? "?"}</span>}
            {r.data.golden && <span><span {...sx(ks.star)}>★</span>Golden Ticket</span>}
            {r.data.completed_at && <span>Done {fmtDate(r.data.completed_at, m.time_zone)}</span>}
            <span>{names(people, r.data.assignee_ids) || "Nobody's on it"}</span>
            {r.data.due_on && <span>due {fmtDate(r.data.due_on)}</span>}
          </p>
          <ByLine who={author} when={r.created_at} tz={m.time_zone} via={r.via} />
          {r.body && <Fmt text={r.body} {...sx(kit.prose)} />}
          {live && col?.data.kind === "review" && <Sweep p={project} r={r} then={from === "home" ? "/" : ""} tz={m.time_zone} />}
          {live && (
            <p {...sx(ks.cardDo)}>
              {col?.data.kind !== "done" && col?.data.kind !== "review" && <Form action={`/projects/${project.id}/cards/${r.id}/done`} style={{ display: "inline" }} optimistic={() => doneCol && moveLocal(r, doneCol.id)}><button data-primary>Mark as done</button></Form>}
              <a href={`/projects/${project.id}/cards/${r.id}/edit`}>Edit</a>
              <Form action={`/projects/${project.id}/cards/${r.id}/golden`} style={{ display: "inline" }} optimistic={() => flipLocal(r, (d) => ({ golden: !d.golden }))}>
                <button data-quiet title="A Golden Ticket keeps a card at the top of its column" {...sx(kit.linkButton)}>{r.data.golden ? "Take the Golden Ticket away" : "Give it a Golden Ticket"}</button>
              </Form>
            </p>
          )}
        </article>
        <section aria-label="Steps" {...sx(ks.steps)}>
          <h2>Steps</h2>
          {steps.length ? (
            <ul {...sx(ks.stepList)}>{steps.map((s) => (
              <li key={s.id} id={`step-${s.id}`} {...sx(ks.step)}>
                <Form action={`/projects/${project.id}/steps/${s.id}/toggle`} style={{ display: "inline" }} optimistic={() => flipLocal(s, (d) => ({ completed_at: d.completed_at ? null : new Date().toISOString() }))}>
                  <button aria-label={`${s.data.completed_at ? "Uncheck" : "Check off"} ${s.title}`} {...sx(ks.check, !!s.data.completed_at && ks.checkDone)}>{s.data.completed_at && <Tick />}</button>
                </Form>
                <span>
                  <span {...sx(!!s.data.completed_at && ks.stepDone)}>{s.title}</span>
                  {(s.data.assignee_ids?.length > 0 || s.data.due_on) && <small {...sx(ks.stepMeta)}>{[names(people, s.data.assignee_ids), s.data.due_on && `due ${fmtDate(s.data.due_on)}`].filter(Boolean).join(" · ")}</small>}
                </span>
                {live && <a href={`/r/${s.id}/trash`} data-row-action {...sx(ks.stepRemove)}>Remove</a>}
              </li>
            ))}</ul>
          ) : <p><small>No steps yet. Break the card into steps, each with its own person and date.</small></p>}
          {live && (
            <details>
              <summary>Add a step</summary>
              <Form key={loc.key} action={`/projects/${project.id}/cards/${r.id}/steps`}>
                <p><label>Step<br /><input name="title" required autoFocus /></label></p>
                <p><label>Who's doing it<br /><select name="assignee_id"><option value="">Nobody yet</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{" "}
                  <label>Due on<br /><input type="date" name="due_on" /></label></p>
                <button>Add this step</button>
              </Form>
            </details>
          )}
        </section>
        <ItemFooter r={r} project={project} />
      </Page>
    )
  }),

  page("/projects/:id/cards/:cid/edit", () => {
    const { r, project } = findRecording(useParams().cid, "card")
    const people = projectPeople(project)
    return (
      <Page title="Edit card" crumbs={crumbs(project)}>
        <h1>Edit card</h1>
        <Form action={`/projects/${project.id}/cards/${r.id}/edit`}>
          <TextField label="Card title" name="title" value={r.title} required />
          <p>Assigned to</p>
          <PeopleCheckboxes name="assignee_ids" people={people} checked={r.data.assignee_ids ?? []} />
          <p><label>Due on <input type="date" name="due_on" defaultValue={isoDate(r.data.due_on)} /></label></p>
          <TextArea label="Notes" name="body" value={r.body} />
          <ClientSwitch project={project} people={people} current={r.visible_to_clients} />
          <p><button>Save changes</button> <a href={urlFor(r)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),
]
