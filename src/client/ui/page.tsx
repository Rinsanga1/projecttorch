// A page: its title, breadcrumb, the flash message and the white sheet. Every area page returns
// <Page title="…" crumbs={…}>…</Page>, the way the old handlers called render(c, title, body, crumbs).
// Routes are declared with `page(path, Component)`; a thrown NotFound/NoAccess/Deleted renders its edge page.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useContext, useEffect, type FC, type ReactNode } from "react"
import { isRouteErrorResponse, useRouteError, type RouteObject } from "react-router"
import { state } from "../store.ts"
import { projectUrl, toolName, toolUrl, TYPE_TOOL, type Project, type Recording, type ToolType } from "../../shared/domain.ts"
import { sx } from "./kit.tsx"
import { InWindow } from "./in-window.tsx"
import { color, media, radius, space, text } from "./tokens.stylex.ts"

const DESKTOP = "@media (min-width: 768px)"
const rise = stylex.keyframes({ from: { opacity: 0, transform: "translate(-50%, 8px)" } })
const s = stylex.create({
  crumbs: {
    display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: 2, fontSize: text.sm,
    color: color.muted, paddingInline: { default: space.s2, [DESKTOP]: space.s1 }, paddingBottom: space.s3,
  },
  crumb: { color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } }, textDecoration: "none" },
  crumbSep: { color: color.control },
  flash: {
    display: "flex", alignItems: "center", gap: space.s2, width: "fit-content", maxWidth: "100%", marginInline: "auto",
    marginBottom: space.s3, paddingBlock: 8, paddingInline: space.s4, borderRadius: radius.pill, backgroundColor: color.sheet,
    fontSize: text.sm,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: color.success, flexShrink: 0 },
  sheet: {
    backgroundColor: color.sheet, borderRadius: { default: radius.lg, [DESKTOP]: radius.xl },
    paddingBlock: { default: space.s5, [DESKTOP]: 40 }, paddingInline: { default: 20, [DESKTOP]: space.s7 }, minHeight: 280,
  },
  // The page draws its own card: the project page sets a white head over its desk, with the taskbar below the card.
  flush: { paddingBlock: 0, paddingInline: 0, backgroundColor: "transparent", borderRadius: 0 },
  // On a page that fits the screen, the flash floats just above the taskbar instead of pushing everything down.
  flashFloat: {
    position: "fixed", zIndex: 60, bottom: 76, left: "50%", transform: "translateX(-50%)", marginBottom: 0, boxShadow: "0 6px 20px -8px rgba(0,0,0,.25)",
    animationName: { default: rise, [media.reduce]: "none" }, animationDuration: "220ms", animationTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
  },
})

export type Crumb = readonly [label: string, href: string]

export const Page = observer(({ title, crumbs, flush, children }: { title: string; crumbs?: ReadonlyArray<Crumb>; flush?: boolean; children: ReactNode }) => {
  // In a project window the window is the frame: no crumbs, sheet or flash of its own, and the tab keeps the project's title.
  const inWindow = useContext(InWindow)
  useEffect(() => { if (!inWindow) document.title = `${title} · Saintsflow` }, [title, inWindow])
  const f = state.flash
  if (inWindow) return <>{children}</>
  return (
    <>
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" {...sx(s.crumbs)}>
          {crumbs.map(([l, h], i) => (
            <span key={h + i} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true" {...sx(s.crumbSep)}>/</span>}
              <a href={h} {...sx(s.crumb)}>{l}</a>
            </span>
          ))}
        </nav>
      ) : null}
      {f && (
        <p role="status" data-flash {...sx(s.flash, flush && s.flashFloat)}>
          <span {...sx(s.dot)} /><b>{f.msg}</b>{f.href && <> <a href={f.href}>{f.label ?? "Go there"}</a></>}
        </p>
      )}
      <main {...sx(s.sheet, flush && s.flush)}>{children}</main>
    </>
  )
})

/** Crumbs for anything inside a project: Project › Tool. */
export const projectCrumbs = (p: Pick<Project, "id" | "name" | "kind" | "tools">, tool?: ToolType): Crumb[] =>
  [[p.name, projectUrl(p)], ...(tool ? [[toolName(p, tool), toolUrl(p, tool)] as const] : [])]

/** Item page crumbs: Project › Tool (or Private chats › the chat). */
export const crumbsFor = (project: Pick<Project, "id" | "name" | "kind" | "tools">, r: Pick<Recording, "type">): Crumb[] =>
  project.kind === "ping" ? [["Private chats", "/chats"], [project.name || "Private chat", `/chats/${project.id}`]] : projectCrumbs(project, TYPE_TOOL[r.type])

type RouteOpts = {
  /** Works signed out (front door, public links, the dev inbox). */
  pub?: boolean
  /** Draws its own whole page, without the app chrome (marketing). */
  bare?: boolean
}
export type Handle = RouteOpts

/** Declare a route. The component is wrapped in `observer`, so it re-renders when the rows it read change. */
export const page = (path: string, Component: FC, opts: RouteOpts = {}): RouteObject => ({
  path,
  Component: observer(Component),
  handle: opts satisfies Handle,
  errorElement: <ErrorPage />,
})

/** The breadboard's "Edges" pages, for errors thrown while rendering (see data.ts). */
export const ErrorPage = () => {
  const e = useRouteError() as { _tag?: string; message?: string } | undefined
  const home = <p><a href="/">Go to Home</a></p>
  const tag = isRouteErrorResponse(e) && e.status === 404 ? "NotFound" : e?._tag
  if (tag === "NotFound") return <Page title="Page not found"><h1>Page not found</h1><p>That page doesn't exist, or it moved.</p>{home}</Page>
  if (tag === "NoAccess") return <Page title="No access"><h1>No access</h1><p>You don't have access to this. Ask someone on the project to add you.</p>{home}</Page>
  if (tag === "Deleted") return <Page title="Deleted"><h1>Deleted forever</h1><p>This was deleted, or you don't have access to it.</p>{home}</Page>
  console.error(e)
  return <Page title="Something went wrong"><h1>Something went wrong</h1><pre>{String(e?.message ?? e)}</pre>{home}</Page>
}
