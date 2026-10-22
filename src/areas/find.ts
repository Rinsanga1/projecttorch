// Find: Search, Go to and the keyboard shortcuts sheet.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, esc, fmtDate } from "../lib/html.ts"
import { get, render, isClient, type Ctx } from "../lib/web.ts"
import { accountPeople, projectUrl, toolUrl, urlFor, titleOf, TYPE_NAMES, visibleProjects, type Recording } from "../lib/core.ts"
import { scope, inIds, clientSees } from "./reports.ts"

const TYPES: Record<string, { label: string; types: string[] }> = {
  messages: { label: "Posts", types: ["message"] },
  todos: { label: "Tasks", types: ["todolist", "todo"] },
  files: { label: "Files", types: ["folder", "doc", "upload", "cloudfile"] },
  chats: { label: "Chats", types: ["line"] },
  comments: { label: "Comments", types: ["comment"] },
  cards: { label: "Cards", types: ["card", "step"] },
  checkins: { label: "Team questions", types: ["question", "answer"] },
  events: { label: "Events", types: ["event"] },
  forwards: { label: "Forwarded emails", types: ["forward"] },
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Escape `text` and wrap every case-insensitive match of `q` in <mark>. */
const highlight = (text: string, q: string) =>
  raw(esc(text).replace(new RegExp(reEscape(esc(q)), "gi"), (m) => `<mark>${m}</mark>`))

/** ~160 characters of `text` around the first match. */
const snippet = (text: string, q: string) => {
  const t = text.replace(/\s+/g, " ").trim()
  const i = t.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return t.slice(0, 160) + (t.length > 160 ? "…" : "")
  const from = Math.max(0, i - 70)
  return (from ? "…" : "") + t.slice(from, from + 160) + (from + 160 < t.length ? "…" : "")
}

const saveSearch = (c: Ctx, q: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const recent = [q, ...(c.me.prefs.recent_searches ?? []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)
    yield* sql`update people set prefs = prefs || ${JSON.stringify({ recent_searches: recent })}::jsonb where id = ${c.me.id}`
    return recent
  })

export const routes = [
  get("/find", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const q = (c.query.get("q") ?? "").trim()
      const type = TYPES[c.query.get("type") ?? ""] ? c.query.get("type")! : ""
      const projectId = Number(c.query.get("project")) || null
      const personId = Number(c.query.get("person")) || null
      const { projects, ids, pingIds } = yield* scope(c)
      const people = yield* accountPeople(c.me.account_id)
      const searchable = projectId ? [...ids, ...pingIds].filter((id) => id === projectId) : [...ids, ...pingIds]
      // ponytail: ILIKE scan; switch to a tsvector column + GIN index when search gets slow
      const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`
      const rows = q
        ? yield* sql<Recording & { project_name: string; project_kind: string; creator_name: string | null }>`
            select r.*, p.name as project_name, p.kind as project_kind, pe.name as creator_name from recordings r
              join projects p on p.id = r.project_id left join people pe on pe.id = r.creator_id
            where r.status = 'active' and r.project_id in ${inIds(sql, searchable)}
              and (r.title ilike ${pattern} escape '\\' or r.body ilike ${pattern} escape '\\')
              ${type ? sql`and r.type in ${sql.in(TYPES[type]!.types)}` : sql``}
              ${personId ? sql`and r.creator_id = ${personId}` : sql``}
              ${clientSees(sql, c.me, "r.id")}
            order by r.updated_at desc limit 100`
        : []
      const recent = q ? yield* saveSearch(c, q) : c.me.prefs.recent_searches ?? []
      return yield* render(c, q ? `Search: ${q}` : "Search", html`
<h1>Search</h1>
<form method="get" action="/find">
  <p><label>Search for… <input type="search" name="q" value="${q}" size="40" autofocus></label></p>
  <p>
    <label>Type <select name="type"><option value="">Everything</option>
      ${Object.entries(TYPES).map(([k, v]) => html`<option value="${k}"${k === type ? raw(" selected") : ""}>${v.label}</option>`)}</select></label>
    <label>In project <select name="project"><option value="">All projects</option>
      ${projects.map((p) => html`<option value="${p.id}"${p.id === projectId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
    <label>By person <select name="person"><option value="">Anyone</option>
      ${people.map((p) => html`<option value="${p.id}"${p.id === personId ? raw(" selected") : ""}>${p.name}</option>`)}</select></label>
    <button>Search</button>
  </p>
</form>
${!q
  ? html`<p>Search every project, post, task, file, chat and comment.</p>`
  : rows.length === 0
    ? html`<p>No results for “${q}”. Try fewer words, or remove a filter.</p>`
    : html`<p>${rows.length === 100 ? "The 100 most recent matches" : `${rows.length} result${rows.length === 1 ? "" : "s"}`} for “${q}”.</p>
<ol>${rows.map((r) => html`<li>
  ${TYPE_NAMES[r.type] ?? r.type}: <a href="${urlFor(r)}">${highlight(titleOf(r), q)}</a>
  <br><small>${r.creator_name ?? "Someone"} · ${r.project_kind === "ping" ? "a private chat" : r.project_name} · ${fmtDate(r.updated_at, c.me.time_zone)}</small>
  ${r.body ? html`<br>${highlight(snippet(r.body, q), q)}` : ""}
</li>`)}</ol>`}
${recent.length ? html`<h2>Recent searches</h2><ul>${recent.map((s) => html`<li><a href="/find?q=${encodeURIComponent(s)}">${s}</a></li>`)}</ul>` : ""}
<p><a href="/people">Everyone at ${c.account.name}</a> (the people directory) · <a href="/everything">Everything, by type</a></p>`)
    })),

  get("/goto", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const q = (c.query.get("q") ?? "").trim()
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const hits = (label: string) => words.every((w) => label.toLowerCase().includes(w))
      let matches: { href: string; label: string }[] = []
      if (q) {
        const projects = [...(yield* visibleProjects(c)), ...(yield* visibleProjects(c, { kind: "template" }))]
        for (const p of projects) {
          if (hits(p.name)) matches.push({ href: projectUrl(p), label: `${p.name}${p.kind === "template" ? " (template)" : ""}` })
          for (const t of p.tools.filter((t) => t.enabled && !(isClient(c.me) && t.type === "timesheet")))
            if (hits(`${p.name} ${t.name}`) && !hits(p.name)) matches.push({ href: toolUrl(p, t.type), label: `${p.name}: ${t.name}` })
        }
        // Clients only find people they share a project with.
        const shared = isClient(c.me)
          ? (yield* sql<{ person_id: number }>`select distinct person_id from project_people where project_id in ${inIds(sql, projects.map((p) => p.id))}`).map((r) => r.person_id)
          : null
        for (const p of yield* accountPeople(c.me.account_id))
          if (hits(p.name) && (!shared || shared.includes(p.id))) matches.push({ href: `/people/${p.id}`, label: `${p.name}${p.title ? `, ${p.title}` : ""}` })
        matches = matches.slice(0, 20)
      }
      const recent = c.me.prefs.recent_pages ?? []
      return yield* render(c, "Go to", html`
<h1>Go to</h1>
<form method="get" action="/goto">
  <p><label>Go to a project, person, or recent page… <input type="search" name="q" value="${q}" size="40" autofocus></label> <button>Go</button></p>
</form>
<p><small>Press ↑ ↓ (or Tab) to move, Enter to go. Ctrl/⌘ + K opens this from anywhere.</small></p>
${!q
  ? recent.length
    ? html`<h2>Recently visited</h2><ul>${recent.map((p) => html`<li><a href="${p.href}">${p.title}</a></li>`)}</ul>`
    : html`<p>Pages you visit show up here so you can get back to them fast.</p>`
  : matches.length
    ? html`<ul>${matches.map((m) => html`<li><a href="${m.href}">${highlight(m.label, words[0] ?? "")}</a></li>`)}</ul>
      <p><a href="/find?q=${encodeURIComponent(q)}">Search everything for “${q}”</a></p>`
    : html`<p>Nothing here matches “${q}”. <a href="/find?q=${encodeURIComponent(q)}">Search everything instead?</a></p>`}
<script>
// ↑ ↓ move between results; Enter follows the focused link (native).
document.addEventListener("keydown", e => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
  const links = [...document.querySelectorAll("main ul a")]
  if (!links.length) return
  e.preventDefault()
  const i = links.indexOf(document.activeElement)
  links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length].focus()
})
</script>`)
    })),

  get("/shortcuts", (c) =>
    render(c, "Keyboard shortcuts", html`
<h1>Keyboard shortcuts</h1>
<table>
  <thead><tr><th>Keys</th><th>What it does</th></tr></thead>
  <tbody>
    <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd></td><td>Open Go to</td></tr>
    <tr><td><kbd>?</kbd></td><td>Show this sheet (when you're not typing)</td></tr>
    <tr><td><kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Enter</kbd></td><td>Move through Go to results and open one</td></tr>
    <tr><td><kbd>Tab</kbd>, <kbd>Enter</kbd></td><td>Move between links and buttons, and press them</td></tr>
  </tbody>
</table>
<p><a href="/help">All help guides</a></p>`)),
]
