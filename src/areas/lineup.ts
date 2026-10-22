// Timeline: every dated project on one timeline, plus markers (holidays, launches).
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, fmtDate, isoDate, today } from "../lib/html.ts"
import { get, post, redirect, render, str, errors, isClient, NoAccess, NotFound, type Ctx } from "../lib/web.ts"
import { visibleProjects, projectUrl } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

type Marker = { id: number; name: string; on_date: string }

const WEEKS = 12
const DAY = 86_400_000

const addDays = (d: string, n: number) => isoDate(new Date(Date.parse(d + "T00:00:00Z") + n * DAY))
/** The Monday on or before `d`. */
const monday = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7))

const markers = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Marker>`select id, name, to_char(on_date, 'YYYY-MM-DD') as on_date from markers where account_id = ${c.me.account_id} order by on_date`
  })

const markerForm = (m: Partial<Marker>, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${m.id ? `/timeline/markers/${m.id}/edit` : "/timeline/markers"}">
  <p><label>Name<br><input name="name" value="${m.name ?? ""}" required placeholder="Product launch, Company holiday…"></label></p>
  <p><label>Date<br><input type="date" name="on_date" value="${m.on_date ?? ""}" required></label></p>
  <p><button>${m.id ? "Save changes" : "Add marker"}</button> <a href="/timeline">Cancel</a></p>
</form>
${m.id ? html`<form method="post" action="/timeline/markers/${m.id}/delete"><button>Delete this marker</button></form>` : ""}`

const readMarker = (fd: FormData) => {
  const m = { name: str(fd, "name"), on_date: str(fd, "on_date") }
  const errs = [...(m.name ? [] : ["Your marker needs a name."]), ...(/^\d{4}-\d{2}-\d{2}$/.test(m.on_date) ? [] : ["Pick a date."])]
  return { m, errs }
}

const findMarker = (c: Ctx) =>
  Effect.gen(function* () {
    if (isClient(c.me)) return yield* new NoAccess()
    const m = (yield* markers(c)).find((x) => x.id === Number(c.params.mid))
    if (!m) return yield* new NotFound()
    return m
  })

export const routes = [
  get("/timeline", (c) =>
    Effect.gen(function* () {
      // Earlier/Later stop a year either side of today, so the pages (and the crawler) end somewhere.
      const asked = /^\d{4}-\d{2}-\d{2}$/.test(c.query.get("from") ?? "") ? c.query.get("from")! : today()
      const from = asked < addDays(today(), -365) ? addDays(today(), -365) : asked > addDays(today(), 365) ? addDays(today(), 365) : asked
      const start = addDays(monday(from), -7)
      const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(start, i * 7))
      const end = addDays(start, WEEKS * 7 - 1)
      const ps = (yield* visibleProjects(c)).filter((p) => p.kind === "project")
      const dated = ps.filter((p) => p.starts_on && p.ends_on).map((p) => ({ p, s: isoDate(p.starts_on), e: isoDate(p.ends_on) }))
      const undated = ps.filter((p) => !p.starts_on || !p.ends_on)
      const ms = yield* markers(c)
      const thisWeek = monday(today())
      const inWeek = (w: string, d: string) => d >= w && d <= addDays(w, 6)
      const shown = dated.filter(({ s, e }) => s <= end && e >= start)
      return yield* render(c, "Timeline", html`
<h1>Timeline</h1>
<p>${from > addDays(today(), -365) ? html`<a href="/timeline?from=${addDays(from, -28)}">← Earlier</a> · ` : ""}<a href="/timeline">Today</a>${from < addDays(today(), 365) ? html` · <a href="/timeline?from=${addDays(from, 28)}">Later →</a>` : ""}</p>
${dated.length === 0
  ? html`<p>The Timeline shows projects that have start and end dates. Add dates to a project to put it here.</p>`
  : html`
<table>
  <caption>Weeks of ${fmtDate(start)} to ${fmtDate(end)}. ■ = the project is running that week.</caption>
  <thead><tr><th scope="col">Project</th>${weeks.map((w) => html`<th scope="col">${w === thisWeek ? html`<mark>Today ▼</mark><br>` : ""}${fmtDate(w)}</th>`)}</tr></thead>
  <tbody>
  ${ms.some((m) => m.on_date >= start && m.on_date <= end) ? html`<tr><th scope="row">Markers</th>${weeks.map((w) => html`<td>${ms.filter((m) => inWeek(w, m.on_date)).map((m) => html`<a href="/timeline/markers/${m.id}/edit">◆ ${m.name}</a> `)}</td>`)}</tr>` : ""}
  ${shown.map(({ p, s, e }) => html`<tr>
    <th scope="row"><a href="${projectUrl(p)}">${p.name}</a><br><small>${fmtDate(s)} → ${fmtDate(e)}</small></th>
    ${weeks.map((w) => html`<td>${s <= addDays(w, 6) && e >= w ? "■" : ""}${w === thisWeek ? " |" : ""}</td>`)}</tr>`)}
  </tbody>
</table>
${shown.length === 0 ? html`<p>No projects run during these weeks. Try earlier or later.</p>` : ""}`}
<h2>Markers</h2>
${ms.length ? html`<ul>${ms.map((m) => html`<li>${fmtDate(m.on_date)}: ${m.name}${!isClient(c.me) ? html` <a href="/timeline/markers/${m.id}/edit">Edit</a>` : ""}</li>`)}</ul>` : html`<p>No markers yet. Markers flag dates everyone should know about, like holidays and launches.</p>`}
${!isClient(c.me) ? html`<p><a href="/timeline/markers/new" data-button>Add a marker</a></p>` : ""}
${undated.length && !isClient(c.me) ? html`<h2>Projects without dates</h2>
<p>Add start and end dates to put these on the Timeline.</p>
<ul>${undated.map((p) => html`<li>${p.name} · <a href="/projects/${p.id}/edit">Add dates</a></li>`)}</ul>` : ""}`)
    })),

  get("/timeline/markers/new", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      return yield* render(c, "Add a marker", html`<h1>Add a marker</h1>${markerForm({ on_date: c.query.get("on") ?? "" }, [])}`, [["Timeline", "/timeline"]])
    })),

  post("/timeline/markers", (c) =>
    Effect.gen(function* () {
      if (isClient(c.me)) return yield* new NoAccess()
      const sql = yield* SqlClient.SqlClient
      const { m, errs } = readMarker(yield* c.form)
      if (errs.length) return yield* render(c, "Add a marker", html`<h1>Add a marker</h1>${markerForm(m, errs)}`, [["Timeline", "/timeline"]], 422)
      yield* sql`insert into markers ${sql.insert({ account_id: c.me.account_id, name: m.name, on_date: m.on_date })}`
      return redirect(`/timeline?from=${m.on_date}`, `Added the marker “${m.name}”.`)
    })),

  get("/timeline/markers/:mid/edit", (c) =>
    Effect.gen(function* () {
      const m = yield* findMarker(c)
      return yield* render(c, "Edit marker", html`<h1>Edit marker</h1>${markerForm(m, [])}`, [["Timeline", "/timeline"]])
    })),

  post("/timeline/markers/:mid/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const old = yield* findMarker(c)
      const { m, errs } = readMarker(yield* c.form)
      if (errs.length) return yield* render(c, "Edit marker", html`<h1>Edit marker</h1>${markerForm({ ...m, id: old.id }, errs)}`, [["Timeline", "/timeline"]], 422)
      yield* sql`update markers set name = ${m.name}, on_date = ${m.on_date} where id = ${old.id}`
      return redirect(`/timeline?from=${m.on_date}`, "Saved.")
    })),

  post("/timeline/markers/:mid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const m = yield* findMarker(c)
      yield* sql`delete from markers where id = ${m.id}`
      return redirect("/timeline", `Deleted the marker “${m.name}”.`)
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const day = (n: number) => isoDate(new Date(Date.now() + n * DAY))
    yield* sql`insert into markers ${sql.insert([
      { account_id: s.account.id, name: "Northwind site launch", on_date: day(24) },
      { account_id: s.account.id, name: "Company holiday", on_date: day(37) },
    ])}`
  })
