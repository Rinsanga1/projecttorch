// What's new in each of a project's windows since you last opened that window, and what's late: one source for the
// project page's window row and Home's project cards, so the two never disagree. Opening a window is reading it:
// prefs.window_seen holds when you last opened each one, set by each visit (core.ts).
import { db } from "./store.ts"
import { recordings } from "./data.ts"
import { TYPE_TOOL, type Prefs } from "../shared/domain.ts"
import { daysFromToday, fmtDate, today } from "../shared/format.ts"

/** Structure isn't news: a new board column, task group or card step is nothing to catch up on. */
const NOT_NEWS = new Set(["column", "todogroup", "step"])

/** When you last opened each window of a project (its key, like "campfire"): its own time, else your last visit to the
 * project; null before a first visit, when nothing counts as new. */
export const seenOf = (prefs: Prefs, projectId: number) => (key: string): string | null =>
  prefs.window_seen?.[`${projectId}:${key}`] ?? prefs.project_seen?.[String(projectId)] ?? null

/** What other people added to each window since you last opened it. Comments count in the window of what they comment
 * on. `oldest` is the earliest of those "last opened" times among the windows with news, for "Since Tuesday". */
export const windowNews = (projectId: number, meId: number, seen: (key: string) => string | null) => {
  const counts = new Map<string, number>()
  let oldest: string | null = null
  for (const r of recordings((r) => r.project_id === projectId && r.status === "active" && r.creator_id !== meId && !NOT_NEWS.has(r.type))) {
    const on = r.type === "comment" ? db.recordings.get(String(r.parent_id))?.type : r.type
    const tool = on && TYPE_TOOL[on]
    const since = tool && seen(tool)
    if (!tool || !since || r.created_at <= since) continue
    counts.set(tool, (counts.get(tool) ?? 0) + 1)
    if (!oldest || since < oldest) oldest = since
  }
  return { counts, oldest }
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
