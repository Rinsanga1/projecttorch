// What's new in each of a project's windows since you last opened that window, and what's late: one source for the
// project page's window row and Home's project cards, so the two never disagree; and how far along a project is (its
// tasks). Opening a window is reading it:
// prefs.window_seen holds when you last opened each one, set by each visit (core.ts).
import { db } from "./store.ts"
import { inWindow, recordings, topOf } from "./data.ts"
import { windowIdOf, type Prefs, type Project, type Recording } from "../shared/domain.ts"
import { daysFromToday, fmtDate, today } from "../shared/format.ts"

/** Structure isn't news: a new board column or card step is nothing to catch up on. */
const NOT_NEWS = new Set(["column", "step"])

/** When you last opened each window of a project (its id, like "campfire" or "vault-2"): its own time, else your last visit to the
 * project; null before a first visit, when nothing counts as new. */
export const seenOf = (prefs: Prefs, projectId: number) => (key: string): string | null =>
  prefs.window_seen?.[`${projectId}:${key}`] ?? prefs.project_seen?.[String(projectId)] ?? null

/** What other people added to each window since you last opened it. Comments count in the window of what they comment
 * on. What an agent made (`via`) isn't news: its finished work reaches you through Review, and counting its work in
 * progress would pull you in between sweeps. `oldest` is the earliest of those "last opened" times among the windows
 * with news, for "Since Tuesday". */
export const windowNews = (projectId: number, meId: number, seen: (key: string) => string | null) => {
  const counts = new Map<string, number>()
  let oldest: string | null = null
  const p = db.projects.get(String(projectId))
  if (!p) return { counts, oldest }
  for (const r of recordings((r) => r.project_id === projectId && r.status === "active" && r.creator_id !== meId && !r.via && !NOT_NEWS.has(r.type))) {
    const on = r.type === "comment" ? db.recordings.get(String(r.parent_id)) : r
    const tool = on && windowIdOf(p, topOf(on))
    const since = tool && seen(tool)
    if (!tool || !since || r.created_at <= since) continue
    counts.set(tool, (counts.get(tool) ?? 0) + 1)
    if (!oldest || since < oldest) oldest = since
  }
  return { counts, oldest }
}

// ---------- progress ----------
// Progress is never set by hand: it's the share of the work that's done. The work is every Compass goal, except that a
// goal with subgoals counts as its subgoals (it's done when they all are), so splitting a goal up doesn't skew the bar.

/** A Compass window's goals (`tasks`; or every shown one's, for the project), their subgoals (`subtasks`) by goal, and how far along it is. */
export const progressOf = (p: Project, windowId?: string) => {
  const shown = new Set(p.tools.filter((t) => t.enabled && t.type === "todos").map((t) => t.id))
  const all = recordings((r) => r.project_id === p.id && r.type === "todo" && r.status === "active")
  const tasks = all.filter((t) => !t.parent_id && (windowId ? windowIdOf(p, t) === windowId : shown.has(windowIdOf(p, t) ?? "")))
  const ids = new Set(tasks.map((t) => t.id))
  const subtasks = new Map<number, Recording[]>()
  for (const s of all) if (s.parent_id && ids.has(s.parent_id)) subtasks.set(s.parent_id, [...(subtasks.get(s.parent_id) ?? []), s])
  const work = [...tasks.filter((t) => !subtasks.has(t.id)), ...[...subtasks.values()].flat()]
  const done = work.filter((t) => t.data.completed_at).length
  return { tasks, subtasks, done, total: work.length, pct: work.length ? Math.round((done / work.length) * 100) : 0 }
}

/** Open tasks past their due date: in the project, or in one of its Tasks windows. */
export const lateTasks = (projectId: number, windowId?: string) => {
  const p = db.projects.get(String(projectId))
  const here = p && windowId ? inWindow(p, windowId) : () => true
  return recordings((r) => r.project_id === projectId && r.type === "todo" && r.status === "active" && !r.data.completed_at && !!r.data.due_on && r.data.due_on < today() && here(r)).length
}

/** When you last opened a project, in words: "Since yesterday", "Since Tuesday", "Since Oct 12". */
export const sinceLabel = (iso: string) => {
  const ago = -daysFromToday(iso)
  if (ago <= 0) return "Since earlier today"
  if (ago === 1) return "Since yesterday"
  if (ago < 7) return `Since ${new Date(iso).toLocaleDateString("en-US", { weekday: "long" })}`
  return `Since ${fmtDate(iso)}`
}
