// Dev-only helpers while there's no sign-in: switch who you're acting as.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { html } from "../lib/html.ts"
import { pubGet, pubPost, back, num, str, render } from "../lib/web.ts"

export const routes = [
  pubPost("/dev/act-as", (c) =>
    Effect.gen(function* () {
      const id = num(str(yield* c.form, "person_id"))
      return back(c, "/").pipe(HttpServerResponse.setCookieUnsafe("pid", String(id ?? ""), { path: "/" }))
    })),

  /** Used by scripts/smoke.ts to crawl as everyone. */
  pubGet("/dev/people", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ps = yield* sql<{ id: number; name: string }>`select id, name from people where removed_at is null and joined_at is not null order by id`
      return HttpServerResponse.html(html`<ul>${ps.map((p) => html`<li data-person="${p.id}">${p.name}</li>`)}</ul>`.s)
    })),
]

// Anything no other route matched. server.ts registers this after every area: registered earlier, "/*" shadows "/".
export const notFound =
  pubGet("/*", (c) => render(c, "Page not found", html`<h1>Page not found</h1><p>That page doesn't exist, or it moved.</p><p><a href="/">Go to Home</a></p>`, undefined, 404))
