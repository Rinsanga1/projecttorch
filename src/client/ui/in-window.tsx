// A page shown inside a project window (the main window on the project page) knows two things: that it's in a window
// (so it drops its own frame: see Page), and since when you last looked at that window (so it can mark what's new).
// The window itself is just a route: /projects/2/docs/5 is the project page with Files in front at that doc.
import { createContext, useContext } from "react"
import { me } from "../data.ts"
import { kit, sx } from "./kit.tsx"
import { defaultTools, type Project, type Tool, type ToolType } from "../../shared/domain.ts"

/** True inside a project window: pages there drop their own frame (see Page). */
export const InWindow = createContext(false)

/** When you last opened this window, so it can mark what's new: `at` (ISO) and `label` ("Since Tuesday"). */
export type Since = { at: string; label: string }
export const WindowSince = createContext<Since | null>(null)
/** The window's "since": `isNew(r)` is true for what someone else added after it. Outside a window, nothing is new. */
export const useSince = () => {
  const since = useContext(WindowSince)
  return { since, isNew: (r: { created_at: string; creator_id: number | null }) => !!since && r.created_at > since.at && r.creator_id !== me().id }
}

/** "New" beside something someone else added since you last opened its window; nothing outside a window. */
export const NewTag = ({ r }: { r: { created_at: string; creator_id: number | null } }) =>
  useSince().isNew(r) ? <span {...sx(kit.tag, kit.tagNew)}>New</span> : null

/** Which window a page is shown in ("vault-2"): a project can have several of a kind. Null outside a window. */
export const WindowId = createContext<string | null>(null)
/** The window of this kind a page works in: the one it's shown in, else the project's first of that kind. Lists filter
 * by its id, "new" links carry its `windowQuery`, and forms send it as `tool`. */
export const useWindow = (p: Pick<Project, "tools">, type: ToolType): Tool => {
  const id = useContext(WindowId)
  return p.tools.find((t) => t.id === id && t.type === type) ?? p.tools.find((t) => t.id === type) ?? defaultTools().find((t) => t.type === type)!
}
/** The hidden field that tells a "new" form which window it's in. */
export const WindowField = ({ w }: { w: Tool }) => <input type="hidden" name="tool" value={w.id} />
