// The React app. Every module in ./areas exports `routes` (declared with `page()` from ui/page.tsx).
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router"
import { App } from "./app.tsx"
import { start } from "./store.ts"
import { injectBase } from "./ui/base.ts"
import { ErrorPage, page, Page } from "./ui/page.tsx"
import { ProjectLayout } from "./areas/project.tsx"
import { WINDOW_SEGMENT_NAMES } from "../shared/domain.ts"

const areas = import.meta.glob<{ routes: RouteObject[] }>("./areas/*.tsx", { eager: true })

const NotFoundPage = () => (
  <Page title="Page not found"><h1>Page not found</h1><p>That page doesn't exist, or it moved.</p><p><a href="/">Go to Home</a></p></Page>
)

// Every page that belongs to a project window (/projects/:id/posts, /projects/:id/docs/:did…) is a child of the
// project page, which shows it in its main window. The project's own pages (menu, people, settings…) stay top-level.
const PREFIX = "/projects/:id/"
const inWindow = (r: RouteObject) => !!r.path?.startsWith(PREFIX) && WINDOW_SEGMENT_NAMES.includes(r.path.slice(PREFIX.length).split("/")[0]!)
const pages = Object.values(areas).flatMap((m) => m.routes)

const router = createBrowserRouter([
  {
    Component: App,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "/projects/:id", Component: ProjectLayout, errorElement: <ErrorPage />,
        children: [{ index: true }, ...pages.filter(inWindow).map((r) => ({ ...r, path: r.path!.slice(PREFIX.length) }))],
      },
      ...pages.filter((r) => !inWindow(r)),
      page("*", NotFoundPage, { pub: true }),
    ],
  },
])

injectBase()
start()
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
