// What's new in a project since you last opened it, and what's late: one source for the project page's window row and
// Home's project cards, so the two never disagree. "Last opened" is prefs.project_seen, set by each visit (core.ts).
import { db } from "./store.ts"
import { recordings } from "./data.ts"
import { TYPE_TOOL } from "../shared/domain.ts"
import { daysFromToday, fmtDate, today } from "../shared/format.ts"

/** Structure isn't news: a new board column, task group or card step is nothing to catch up on. */
const NOT_NEWS = new Set(["column", "todogroup", "step"])

/** What other people added to each window (by tool type) since `since`. Comments count in the window of what they
 * comment on. Nothing is new before a first visit (`since` null). */
export const newsSince = (projectId: number, since: string | null, meId: number) => {
  const n = new Map<string, number>()
  if (!since) return n
  for (const r of recordings((r) => r.project_id === projectId && r.status === "active" && r.created_at > since && r.creator_id !== meId && !NOT_NEWS.has(r.type))) {
    const on = r.type === "comment" ? db.recordings.get(String(r.parent_id))?.type : r.type
    const tool = on && TYPE_TOOL[on]
    if (tool) n.set(tool, (n.get(tool) ?? 0) + 1)
  }
  return n
}

/** Open tasks in the project past their due date. */
export const lateTasks = (projectId: number) =>
  recordings((r) => r.project_id === projectId && r.type === "todo" && r.status === "active" && !r.data.completed_at && !!r.data.due_on && r.data.due_on < today()).length

/** When you last opened a project, in words: "Since yesterday", "Since Tuesday", "Since Oct 12". */
export const sinceLabel = (iso: string) => {
  const ago = -daysFromToday(iso)
  if (ago <= 0) return "Since earlier today"
  if (ago === 1) return "Since yesterday"
  if (ago < 7) return `Since ${new Date(iso).toLocaleDateString("en-US", { weekday: "long" })}`
  return `Since ${fmtDate(iso)}`
}
