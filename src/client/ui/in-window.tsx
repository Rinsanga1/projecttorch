// A page shown inside a project window (the main window on the project page) knows two things: that it's in a window
// (so it drops its own frame: see Page), and since when you last looked at that window (so it can mark what's new).
// The window itself is just a route: /projects/2/docs/5 is the project page with Files in front at that doc.
import { createContext, useContext } from "react"
import { me } from "../data.ts"
import { kit, sx } from "./kit.tsx"

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
