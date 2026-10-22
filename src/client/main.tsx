// The React app. Every module in ./areas exports `routes` (declared with `page()` from ui/page.tsx).
import "./app.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router"
import { App } from "./app.tsx"
import { start } from "./store.ts"
import { injectBase } from "./ui/base.ts"
import { ErrorPage, page, Page } from "./ui/page.tsx"
import { windowRoutes } from "./ui/window-router.tsx"

const areas = import.meta.glob<{ routes: RouteObject[] }>("./areas/*.tsx", { eager: true })

const NotFoundPage = () => (
  <Page title="Page not found"><h1>Page not found</h1><p>That page doesn't exist, or it moved.</p><p><a href="/">Go to Home</a></p></Page>
)

const pages = [...Object.values(areas).flatMap((m) => m.routes), page("*", NotFoundPage, { pub: true })]
// The project page's windows show these same pages, each window on its own router (ui/window-router.tsx).
windowRoutes.push(...pages)

const router = createBrowserRouter([
  {
    Component: App,
    errorElement: <ErrorPage />,
    children: pages,
  },
])

injectBase()
start()
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
