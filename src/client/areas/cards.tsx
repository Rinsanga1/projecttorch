// Board: the board, new column, column ••• menu, new card, card (with steps), edit card. Posts: src/areas/cards.ts.
// Moving a card, putting it on hold, checking off a step and reordering columns change the copy right away.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useLocation, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, findProject, findRecording, projectPeople, children, recordings, personById, useVisit, NoAccess, NotFound, type PersonWithCompany } from "../data.ts"
import { isClient, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { fmtDate, isoDate } from "../../shared/format.ts"
import { ByLine, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, PeopleCheckboxes, PostOnOpen, submitOwnForm, TextArea, TextField } from "../ui/forms.tsx"
import { Page, page, projectCrumbs } from "../ui/page.tsx"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"
import { reorderLocal } from "./todos.tsx"
import { color, media, radius, space, text } from "../ui/tokens.stylex.ts"

// The table: columns side by side (scrolling sideways when they don't fit), cards as white cards in each column.
const DOT: Record<string, string> = { red: "#e5484d", orange: "#f99c00", yellow: "#f5c518", green: "#30a46c", blue: "#3e7bfa", purple: "#8e4ec6", gray: "#8b8d98" }
const ks = stylex.create({
  board: {
    display: "grid", gridAutoFlow: "column", gridAutoColumns: "min(256px, 82vw)", gap: space.s3, alignItems: "start",
    overflowX: "auto", overscrollBehaviorX: "contain", scrollSnapType: "x proximity", paddingBottom: space.s3, marginBottom: space.s5,
  },
  column: { scrollSnapAlign: "start", backgroundColor: color.tile, borderRadius: radius.xl, padding: space.s3, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: space.s2 },
  colHead: { display: "flex", alignItems: "center", gap: space.s2, paddingInline: 6, paddingTop: 4, margin: 0, fontSize: text.base },
  dot: (bg: string) => ({ backgroundColor: bg }),
  dotBox: { width: 9, height: 9, borderRadius: radius.pill, flexShrink: 0 },
  count: {
    marginLeft: "auto", minWidth: 22, paddingBlock: 3, paddingInline: 7, borderRadius: radius.pill, backgroundColor: color.sheet,
    fontSize: text.xs, fontWeight: 700, textAlign: "center", fontVariantNumeric: "tabular-nums",
  },
  colMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s3, paddingInline: 6, margin: 0, fontSize: text.xs, color: color.muted },
  cards: { margin: 0, display: "grid", gap: space.s2 },
  card: { borderTopWidth: 0, padding: space.s3, borderRadius: radius.lg, backgroundColor: color.sheet, display: "grid", gap: 6 },
  cardTitle: { fontWeight: 600, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  cardMeta: { display: "flex", flexWrap: "wrap", columnGap: space.s2, fontSize: text.xs, color: color.muted },
  cardActions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  small: { minHeight: 28, paddingBlock: 2, fontSize: text.xs, whiteSpace: "nowrap" },
  // A plain button on a Tile Gray column: it takes the sheet's white so it doesn't vanish into the column.
  onTile: { backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tileHover } } },
  none: { margin: 0, paddingInline: 6, paddingBlock: space.s2, fontSize: text.sm, color: color.muted },
  held: { margin: 0, marginTop: space.s2, paddingInline: 6, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  add: { display: "flex", gap: 6, margin: 0 },
  addInput: { flexGrow: 1, minWidth: 0, width: "auto", minHeight: 32, paddingBlock: 3, fontSize: text.sm, margin: 0, backgroundColor: color.sheet },
})

const COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple", "gray"]
const KIND_ORDER: Record<string, number> = { triage: 0, custom: 1, not_now: 2, done: 3 }

/** A project's active columns in display order: New, your columns, Later, Done. */
const columnsOf = (projectId: number) =>
  recordings((r) => r.project_id === projectId && r.type === "column" && r.status === "active")
    .sort((a, b) => (KIND_ORDER[a.data.kind ?? "custom"]! - KIND_ORDER[b.data.kind ?? "custom"]!) || a.position - b.position || a.id - b.id)

/** Every board starts with New, Later and Done; the server makes any that are missing. */
const EnsureColumns = ({ p, cols }: { p: Project; cols: ReadonlyArray<Recording> }) =>
  ["triage", "not_now", "done"].every((k) => cols.some((col) => col.data.kind === k)) ? null : <PostOnOpen action={`/projects/${p.id}/board/setup`} />

const findColumn = (p: Project, id: string | undefined) => {
  const col = db.recordings.get(String(Number(id) || 0))
  if (!col || col.project_id !== p.id || col.type !== "column" || col.status !== "active") throw new NotFound()
  return col
}

const names = (people: ReadonlyArray<PersonWithCompany>, idList: ReadonlyArray<number> | undefined) =>
  (idList ?? []).map((id) => people.find((p) => p.id === id)?.name).filter(Boolean).join(", ")

const crumbs = (p: Project) => projectCrumbs(p, "cardtable")

// ---------- optimistic changes (mirror the posts in src/areas/cards.ts) ----------

/** moveCard: Done stamps it completed, leaving Done clears that, and it comes off hold. */
const moveLocal = (card: Recording, colId: unknown) => {
  const cur = db.recordings.get(String(card.id)) ?? card
  const col = db.recordings.get(String(Number(colId) || 0))
  if (!col || col.type !== "column" || col.project_id !== cur.project_id || cur.parent_id === col.id) return
  const now = new Date().toISOString()
  const done = col.data.kind === "done"
  db.recordings.set(String(cur.id), { ...cur, parent_id: col.id, data: { ...cur.data, completed_at: done ? cur.data.completed_at ?? now : null, on_hold: false }, updated_at: now })
}

/** Flip a data flag the way updateRecording merges it. */
const flipLocal = (r: Recording, change: (d: Record<string, any>) => Record<string, any>) => {
  const cur = db.recordings.get(String(r.id)) ?? r
  db.recordings.set(String(cur.id), { ...cur, data: { ...cur.data, ...change(cur.data) }, updated_at: new Date().toISOString() })
}

// ---------- pieces ----------

const ColumnSelect = ({ cols, current, name = "column_id", onChange }: { cols: ReadonlyArray<Recording>; current: number | null; name?: string; onChange?: typeof submitOwnForm }) => (
  <select name={name} defaultValue={current ?? undefined} onChange={onChange}>{cols.map((col) => <option key={col.id} value={col.id}>{col.title}</option>)}</select>
)

const ColorSelect = ({ current }: { current: string }) => (
  <select name="color" defaultValue={current}>{COLORS.map((col) => <option key={col} value={col}>{col || "No color"}</option>)}</select>
)

const CardItem = observer(({ p, k, col, cols, people, active }: { p: Project; k: Recording; col: Recording; cols: ReadonlyArray<Recording>; people: ReadonlyArray<PersonWithCompany>; active: boolean }) => {
  const steps = children(k.id, "step")
  const stepsDone = steps.filter((s) => s.data.completed_at).length
  return (
    <li {...sx(ks.card)}>
      <a href={urlFor(k)} {...sx(ks.cardTitle)}>{k.title}</a>
      {(k.data.assignee_ids?.length || k.data.due_on || steps.length > 0) && (
        <span {...sx(ks.cardMeta)}>
          {k.data.assignee_ids?.length > 0 && <span>{names(people, k.data.assignee_ids)}</span>}
          {k.data.due_on && <span>due {fmtDate(k.data.due_on)}</span>}
          {steps.length > 0 && <span>steps {stepsDone}/{steps.length}</span>}
        </span>
      )}
      {active && (
        <span {...sx(ks.cardActions)}>
          <Form action={`/projects/${p.id}/cards/${k.id}/move`} style={{ display: "inline" }} optimistic={(fd) => moveLocal(k, fd.get("column_id"))}>
            <select name="column_id" defaultValue="" onChange={submitOwnForm} aria-label={`Move “${k.title}” to…`} data-row-action {...sx(kit.quietSelect)}>
              <option value="" disabled hidden>Move to…</option>
              {cols.filter((c) => c.id !== col.id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Form>
          {col.data.on_hold && (
            <Form action={`/projects/${p.id}/cards/${k.id}/hold`} style={{ display: "inline" }} optimistic={() => flipLocal(k, (d) => ({ on_hold: !d.on_hold }))}>
              <button {...sx(ks.small)}>{k.data.on_hold ? "Take off hold" : "Put on hold"}</button>
            </Form>
          )}
        </span>
      )}
    </li>
  )
})

const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id

// ---------- pages ----------
export const routes = [
  page("/projects/:id/board", () => {
    const [q] = useSearchParams()
    const loc = useLocation()
    const p = findProject(useParams().id)
    const m = me()
    useVisit(toolUrl(p, "cardtable"), `${p.name}: Board`, p.id)
    const cols = columnsOf(p.id)
    const people = projectPeople(p)
    const cards = recordings((r) => r.project_id === p.id && r.type === "card" && r.status === "active").sort(byPosition)
    const collapsed = (q.get("collapsed") ?? "").split(",").map(Number).filter(Boolean)
    const toggle = (id: number) => {
      const next = collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]
      return next.length ? `?collapsed=${next.join(",")}` : "?"
    }
    const active = p.status === "active"
    const item = (k: Recording, col: Recording) => <CardItem key={k.id} p={p} k={k} col={col} cols={cols} people={people} active={active} />
    return (
      <Page title="Board" crumbs={projectCrumbs(p)}>
        <EnsureColumns p={p} cols={cols} />
        <PageHead title="Board" actions={[active && !isClient(m) && <a key="add" href={`/projects/${p.id}/columns/new`} data-button>Add a column</a>]} />
        {cards.length === 0 && <p>Move cards from column to column as work gets done. Add your first card to New, or set up your columns first.</p>}
        <div {...sx(ks.board)}>
          {cols.map((col) => {
            const inCol = cards.filter((k) => k.parent_id === col.id)
            const held = col.data.on_hold ? inCol.filter((k) => k.data.on_hold) : []
            const moving = inCol.filter((k) => !held.includes(k))
            return (
              <section key={col.id} id={`column-${col.id}`} aria-label={col.title} {...sx(ks.column)}>
                <h2 {...sx(ks.colHead)}>{col.data.color && <span title={col.data.color} {...sx(ks.dotBox, ks.dot(DOT[col.data.color] ?? DOT.gray!))} />}{col.title}<span {...sx(ks.count)}>{inCol.length}</span></h2>
                <p {...sx(ks.colMeta)}>
                  {col.data.watcher_ids?.length > 0 && <span>Watching: {names(people, col.data.watcher_ids)}</span>}
                  <a href={`${toggle(col.id)}#column-${col.id}`}>{collapsed.includes(col.id) ? "Expand" : "Collapse"}</a>
                  {!isClient(m) && <a href={`/projects/${p.id}/columns/${col.id}`} aria-label={`${col.title} column options`}>•••</a>}
                </p>
                {!collapsed.includes(col.id) && (
                  <>
                    {moving.length ? <ul {...sx(ks.cards)}>{moving.map((k) => item(k, col))}</ul> : <p {...sx(ks.none)}>No cards here.</p>}
                    {col.data.on_hold && <><h3 {...sx(ks.held)}>On hold</h3>{held.length ? <ul {...sx(ks.cards)}>{held.map((k) => item(k, col))}</ul> : <p {...sx(ks.none)}>Nothing on hold.</p>}</>}
                    {active && col.data.kind !== "done" && (
                      <Form key={loc.key} action={`/projects/${p.id}/cards`} {...sx(ks.add)}>
                        <input type="hidden" name="column_id" value={col.id} />
                        <input name="title" required placeholder="Card title" aria-label="Card title" {...sx(ks.addInput)} /> <button data-quiet {...sx(ks.small, ks.onTile)}>Add a card</button>
                      </Form>
                    )}
                  </>
                )}
              </section>
            )
          })}
        </div>
        {/* Reordering takes two of your own columns; folded away until wanted. */}
        {active && !isClient(m) && cols.filter((col) => col.data.kind === "custom").length > 1 && (
          <details>
            <summary>Reorder columns</summary>
            <Form key={loc.key} action={`/projects/${p.id}/columns/order`} optimistic={reorderLocal}>
              {cols.filter((col) => col.data.kind === "custom").map((col, i) => <span key={col.id}><label>{col.title} <input type="number" name={`pos_${col.id}`} defaultValue={i + 1} min={1} size={3} /></label><br /></span>)}
              <button>Save order</button>
            </Form>
          </details>
        )}
      </Page>
    )
  }),

  // Columns
  page("/projects/:id/columns/new", () => {
    const p = findProject(useParams().id)
    if (isClient(me())) throw new NoAccess()
    return (
      <Page title="New column" crumbs={crumbs(p)}>
        <h1>New column</h1>
        <Form action={`/projects/${p.id}/columns`}>
          <TextField label="Name this column" name="name" required />
          <p><label>Color <ColorSelect current="" /></label></p>
          <p><button>Add column</button> <a href={toolUrl(p, "cardtable")}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  page("/projects/:id/columns/:colid", () => {
    const params = useParams()
    const p = findProject(params.id)
    const m = me()
    if (isClient(m)) throw new NoAccess()
    const cols = columnsOf(p.id)
    const col = findColumn(p, params.colid)
    const watching = (col.data.watcher_ids ?? []).includes(m.id)
    const others = cols.filter((x) => x.id !== col.id)
    return (
      <Page title={`${col.title} column`} crumbs={crumbs(p)}>
        <EnsureColumns p={p} cols={cols} />
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
        <Form action={`/projects/${p.id}/columns/${col.id}/hold`}>
          <p><button>{col.data.on_hold ? "Remove the On hold section" : "Add an On hold section to the column"}</button></p>
        </Form>
        <Form action={`/projects/${p.id}/columns/${col.id}/move-all`}>
          <p><label>Move all cards to… <ColumnSelect cols={others} current={null} /></label> <button>Move all cards</button></p>
        </Form>
        {col.data.kind === "custom"
          ? <Form action={`/projects/${p.id}/columns/${col.id}/delete`}><p><button>Delete this column</button></p></Form>
          : <p><small>{col.title} comes with every board, so it can't be deleted.</small></p>}
        <p><a href={`${toolUrl(p, "cardtable")}#column-${col.id}`}>Back to the board</a></p>
      </Page>
    )
  }),

  // Cards
  page("/projects/:id/cards/:cid", () => {
    const loc = useLocation()
    const { r, project } = findRecording(useParams().cid, "card")
    const m = me()
    useVisit(urlFor(r), r.title, project.id)
    const cols = columnsOf(project.id)
    const col = cols.find((x) => x.id === r.parent_id)
    const people = projectPeople(project)
    const steps = children(r.id, "step")
    const author = personById(r.creator_id)
    const live = r.status === "active" && project.status === "active"
    const doneCol = cols.find((x) => x.data.kind === "done")
    return (
      <Page title={r.title} crumbs={crumbs(project)}>
        <EnsureColumns p={project} cols={cols} />
        <StatusBanner r={r} />
        <ClientBanner r={r} hasClients={people.some(isClient)} />
        <article>
          {live
            ? <Form key={r.parent_id} action={`/projects/${project.id}/cards/${r.id}/move`} optimistic={(fd) => moveLocal(r, fd.get("column_id"))}><label>In column <ColumnSelect cols={cols} current={r.parent_id} onChange={submitOwnForm} /></label></Form>
            : <p>In column: {col?.title ?? "?"}</p>}
          {r.data.on_hold && <p>⏸ On hold</p>}
          {r.data.completed_at && <p>✓ Done {fmtDate(r.data.completed_at, m.time_zone)}</p>}
          <h1>{r.title}</h1>
          <ByLine who={author} when={r.created_at} tz={m.time_zone} />
          <p>Assigned to: {names(people, r.data.assignee_ids) || "Nobody"}</p>
          <p>Due on: {r.data.due_on ? fmtDate(r.data.due_on) : "No due date"}</p>
          {r.body ? <Fmt text={r.body} {...sx(kit.prose)} /> : <p><small>No notes.</small></p>}
          {live && (
            <>
              <p><a href={`/projects/${project.id}/cards/${r.id}/edit`}>Edit</a></p>
              {col?.data.kind !== "done" && <Form action={`/projects/${project.id}/cards/${r.id}/done`} optimistic={() => doneCol && moveLocal(r, doneCol.id)}><button data-primary>Mark as done</button></Form>}
              {col?.data.on_hold && (
                <Form action={`/projects/${project.id}/cards/${r.id}/hold`} optimistic={() => flipLocal(r, (d) => ({ on_hold: !d.on_hold }))}>
                  <button>{r.data.on_hold ? "Take off hold" : "Put on hold"}</button>
                </Form>
              )}
            </>
          )}
        </article>
        <section aria-label="Steps">
          <h2>Steps</h2>
          {steps.length ? (
            <ul>{steps.map((s) => (
              <li key={s.id} id={`step-${s.id}`}>
                <Form action={`/projects/${project.id}/steps/${s.id}/toggle`} style={{ display: "inline" }} optimistic={() => flipLocal(s, (d) => ({ completed_at: d.completed_at ? null : new Date().toISOString() }))}>
                  <button aria-label={`${s.data.completed_at ? "Uncheck" : "Check off"} ${s.title}`}>{s.data.completed_at ? "☑" : "☐"}</button>
                </Form>{" "}
                {s.data.completed_at ? <s>{s.title}</s> : s.title}
                {s.data.assignee_ids?.length > 0 && ` · ${names(people, s.data.assignee_ids)}`}
                {s.data.due_on && ` · due ${fmtDate(s.data.due_on)}`}
                {live && <> <small><a href={`/r/${s.id}/trash`}>Remove</a></small></>}
              </li>
            ))}</ul>
          ) : <p><small>No steps yet. Break the card into steps, each with its own assignee and due date.</small></p>}
          {live && (
            <Form key={loc.key} action={`/projects/${project.id}/cards/${r.id}/steps`}>
              <label>Step <input name="title" required /></label>{" "}
              <label>Assign to <select name="assignee_id"><option value="">Nobody</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{" "}
              <label>Due on <input type="date" name="due_on" /></label>{" "}
              <button>Add a step</button>
            </Form>
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
