// A tool's real pages, inside a window on the project page. Each window runs its own memory router over the app's
// routes, so its links, forms and redirects move the window, not the page: you work in the window. Anything that
// leaves the project opens as a page as usual; the project's own home sends the window back to the tool's start.
import { observable, reaction, runInAction } from "mobx"
import { observer } from "mobx-react-lite"
import { createContext, useContext, useEffect, useRef, type MouseEvent } from "react"
import { createMemoryRouter, RouterProvider, UNSAFE_LocationContext, UNSAFE_RouteContext, useNavigate, type RouteObject } from "react-router"
import { state } from "../store.ts"
import { me } from "../data.ts"
import { kit, sx } from "./kit.tsx"

/** The app's routes, filled once by main.tsx (an area importing main would be a cycle). */
export const windowRoutes: RouteObject[] = []

/** True inside a project window: pages there drop their own frame (see Page). */
export const InWindow = createContext(false)
/** When you last opened the project, so its windows can mark what's new: `at` (ISO) and `label` ("Since Tuesday"). */
export type Since = { at: string; label: string }
const WindowSince = createContext<Since | null>(null)
/** The project's "since" inside a window: `isNew(r)` is true for what someone else added after it. Outside a window, nothing is new. */
export const useSince = () => {
  const since = useContext(WindowSince)
  return { since, isNew: (r: { created_at: string; creator_id: number | null }) => !!since && r.created_at > since.at && r.creator_id !== me().id }
}

type Router = ReturnType<typeof createMemoryRouter>
// One router per window start, kept while the app runs, so a window sent to the stack comes back where you left it.
const routers = new Map<string, Router>()
const where = observable.map<string, { path: string; depth: number }>()

/** Where a window is now (its full path) and how many steps it can go back. Observable: title bars follow it. */
export const windowAt = (start: string) => where.get(start) ?? { path: start, depth: 0 }
export const windowBack = (start: string) => { if (windowAt(start).depth > 0) routers.get(start)?.navigate(-1) }
/** Move a window to a path (a flash's Undo raised inside it). False when there's no such window. */
export const windowGo = (start: string, path: string) => { const r = routers.get(start); r?.navigate(path); return !!r }

const routerFor = (start: string) => {
  let r = routers.get(start)
  if (!r) routers.set(start, (r = createMemoryRouter(windowRoutes, { initialEntries: [start] })))
  return r
}

// The window's router is a fresh one, not nested in the page's: React Router refuses a router inside a router, and
// would match the window's paths under the project page's route.
const NO_ROUTE = { outlet: null, matches: [], isDataRoute: false }

export const ToolWindow = observer(({ start, home, since = null }: { start: string; home: string; since?: Since | null }) => {
  const router = routerFor(start)
  const page = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const inScope = (path: string) => path.startsWith(`${home}/`)

  // A flash raised while this is the big window came from working in it: its link belongs to the window.
  useEffect(() => reaction(() => state.flash, (f) => { if (f && !f.win) state.flash = { ...f, win: start } }), [start])

  useEffect(() => router.subscribe((s) => {
    const { pathname, search, hash, key } = s.location
    const at = pathname + search + hash
    if (at === where.get(start)?.path) return
    // The project's home is the page this window lives on; anything outside the project opens as a page.
    if (pathname === home || !inScope(pathname)) {
      if (pathname !== home) page(at)
      router.navigate(start, { replace: true })
      return
    }
    const prev = windowAt(start)
    const depth = s.historyAction === "PUSH" ? prev.depth + 1 : s.historyAction === "POP" ? Math.max(0, prev.depth - 1) : prev.depth
    runInAction(() => {
      where.set(start, { path: at, depth })
      // A flash lives for the window page it arrives on, the way it does for pages (see app.tsx).
      const f = state.flash
      if (f && f.at === undefined) state.flash = { ...f, at: `win:${key}` }
      else if (f && f.at !== `win:${key}`) state.flash = null
    })
    // A new window page starts at its top, or at its #anchor.
    requestAnimationFrame(() => {
      const target = hash && box.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(hash.slice(1)))}"]`)
      if (target) target.scrollIntoView({ block: "start" })
      else box.current?.closest("[data-window-body]")?.scrollTo(0, 0)
    })
  }), [router, start, home])

  // Plain <a href> links into this project move the window. The app's own link handler skips a handled click.
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as Element).closest("a")
    const raw = a?.getAttribute("href")
    if (!a || !raw || (a.target && a.target !== "_self") || a.hasAttribute("download")) return
    // A relative link ("?completed=1") is relative to the window's page, not the project page the browser sees.
    const url = new URL(raw, location.origin + windowAt(start).path)
    if (url.origin !== location.origin || !inScope(url.pathname)) return
    e.preventDefault()
    router.navigate(url.pathname + url.search + url.hash)
  }

  return (
    // At the tool's start the window's title bar already names it, so the page heading is kept for screen readers only.
    <div ref={box} onClickCapture={onClick} data-window-root={windowAt(start).path === start || undefined}>
      <UNSAFE_LocationContext.Provider value={null as never}>
        <UNSAFE_RouteContext.Provider value={NO_ROUTE}>
          <InWindow.Provider value={true}><WindowSince.Provider value={since}>
            <RouterProvider router={router} />
          </WindowSince.Provider></InWindow.Provider>
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </div>
  )
})

/** "New" beside something someone else added since your last visit to the project; nothing outside a window. */
export const NewTag = ({ r }: { r: { created_at: string; creator_id: number | null } }) =>
  useSince().isNew(r) ? <span {...sx(kit.tag, kit.tagNew)}>New</span> : null
