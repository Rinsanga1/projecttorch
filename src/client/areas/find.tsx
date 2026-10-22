// Find: Search, Go to and the keyboard shortcuts sheet. Search runs over the local copy (instant, works offline);
// the copy only holds what this person may see. Posts: src/areas/find.ts (remembering recent searches).
import { useEffect } from "react"
import { Form as GetForm, useSearchParams } from "react-router"
import { db, submit } from "../store.ts"
import { me, account, accountPeople, visibleProjects, recordings, memberIds } from "../data.ts"
import { isClient, projectUrl, toolUrl, urlFor, titleOf, TYPE_NAMES } from "../../shared/domain.ts"
import { fmtDate, ms } from "../../shared/format.ts"
import { Page, page } from "../ui/page.tsx"
import { scope, personName } from "./reports.tsx"

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

/** `text` with every case-insensitive match of `q` wrapped in <mark>. */
const Hi = ({ text, q }: { text: string; q: string }) => {
  if (!q) return <>{text}</>
  // Splitting on a capture group alternates: odd parts are the matches.
  return <>{text.split(new RegExp(`(${reEscape(q)})`, "gi")).map((s, i) => (i % 2 ? <mark key={i}>{s}</mark> : s))}</>
}

/** ~160 characters of `text` around the first match. */
const snippet = (text: string, q: string) => {
  const t = text.replace(/\s+/g, " ").trim()
  const i = t.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return t.slice(0, 160) + (t.length > 160 ? "…" : "")
  const from = Math.max(0, i - 70)
  return (from ? "…" : "") + t.slice(from, from + 160) + (from + 160 < t.length ? "…" : "")
}

/** Remember `q` in Recent searches (here right away, on the server when it's reachable). */
const saveSearch = (q: string) => {
  const fd = new FormData()
  fd.set("q", q)
  submit("/find/recent", fd, () => {
    const m = me()
    const recent = [q, ...(m.prefs.recent_searches ?? []).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)
    db.people.set(String(m.id), { ...m, prefs: { ...m.prefs, recent_searches: recent } })
  }).catch(() => {})
}

export const routes = [
  page("/find", () => {
    const [params] = useSearchParams()
    const m = me()
    const q = (params.get("q") ?? "").trim()
    const type = TYPES[params.get("type") ?? ""] ? params.get("type")! : ""
    const projectId = Number(params.get("project")) || null
    const personId = Number(params.get("person")) || null
    // Each search lands in Recent searches once, like the old GET /find did.
    useEffect(() => { if (q) saveSearch(q) }, [q])
    const { projects, ids, pingIds } = scope()
    const people = accountPeople()
    const searchable = new Set([...ids, ...pingIds].filter((id) => !projectId || id === projectId))
    const needle = q.toLowerCase()
    const rows = q
      ? recordings((r) => r.status === "active" && searchable.has(r.project_id)
          && (r.title.toLowerCase().includes(needle) || r.body.toLowerCase().includes(needle))
          && (!type || TYPES[type]!.types.includes(r.type)) && (!personId || r.creator_id === personId))
          .sort((a, b) => ms(b.updated_at) - ms(a.updated_at))
          .slice(0, 100)
      : []
    const recent = m.prefs.recent_searches ?? []
    return (
      <Page title={q ? `Search: ${q}` : "Search"}>
        <h1>Search</h1>
        <GetForm method="get" action="/find" key={params.toString()}>
          <p><label>Search for… <input type="search" name="q" defaultValue={q} size={40} autoFocus /></label></p>
          <p>
            <label>Type <select name="type" defaultValue={type}><option value="">Everything</option>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            {" "}<label>In project <select name="project" defaultValue={projectId ?? ""}><option value="">All projects</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {" "}<label>By person <select name="person" defaultValue={personId ?? ""}><option value="">Anyone</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {" "}<button>Search</button>
          </p>
        </GetForm>
        {!q
          ? <p>Search every project, post, task, file, chat and comment.</p>
          : rows.length === 0
            ? <p>No results for “{q}”. Try fewer words, or remove a filter.</p>
            : <>
              <p>{rows.length === 100 ? "The 100 most recent matches" : `${rows.length} result${rows.length === 1 ? "" : "s"}`} for “{q}”.</p>
              <ol>{rows.map((r) => {
                const p = db.projects.get(String(r.project_id))
                return (
                  <li key={r.id}>
                    {TYPE_NAMES[r.type] ?? r.type}: <a href={urlFor(r)}><Hi text={titleOf(r)} q={q} /></a>
                    <br /><small>{personName(r.creator_id) ?? "Someone"} · {p?.kind === "ping" ? "a private chat" : p?.name} · {fmtDate(r.updated_at, m.time_zone)}</small>
                    {r.body && <><br /><Hi text={snippet(r.body, q)} q={q} /></>}
                  </li>
                )
              })}</ol>
            </>}
        {recent.length > 0 && <><h2>Recent searches</h2><ul>{recent.map((s) => <li key={s}><a href={`/find?q=${encodeURIComponent(s)}`}>{s}</a></li>)}</ul></>}
        <p><a href="/people">Everyone at {account().name}</a> (the people directory) · <a href="/everything">Everything, by type</a></p>
      </Page>
    )
  }),

  page("/goto", () => {
    const [params] = useSearchParams()
    const m = me()
    const q = (params.get("q") ?? "").trim()
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = (label: string) => words.every((w) => label.toLowerCase().includes(w))
    // ↑ ↓ move between results; Enter follows the focused link (native).
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        const links = [...document.querySelectorAll<HTMLAnchorElement>("main ul a")]
        if (!links.length) return
        e.preventDefault()
        const i = links.indexOf(document.activeElement as HTMLAnchorElement)
        links[(i + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]!.focus()
      }
      document.addEventListener("keydown", onKey)
      return () => document.removeEventListener("keydown", onKey)
    }, [])
    let matches: { href: string; label: string }[] = []
    if (q) {
      const projects = [...visibleProjects(), ...visibleProjects({ kind: "template" })]
      for (const p of projects) {
        if (hits(p.name)) matches.push({ href: projectUrl(p), label: `${p.name}${p.kind === "template" ? " (template)" : ""}` })
        for (const t of p.tools.filter((t) => t.enabled && !(isClient(m) && t.type === "timesheet")))
          if (hits(`${p.name} ${t.name}`) && !hits(p.name)) matches.push({ href: toolUrl(p, t.type), label: `${p.name}: ${t.name}` })
      }
      // Clients only find people they share a project with.
      const shared = isClient(m) ? new Set(projects.flatMap((p) => memberIds(p.id))) : null
      for (const p of accountPeople())
        if (hits(p.name) && (!shared || shared.has(p.id))) matches.push({ href: `/people/${p.id}`, label: `${p.name}${p.title ? `, ${p.title}` : ""}` })
      matches = matches.slice(0, 20)
    }
    const recent = m.prefs.recent_pages ?? []
    return (
      <Page title="Go to">
        <h1>Go to</h1>
        <GetForm method="get" action="/goto" key={q}>
          <p><label>Go to a project, person, or recent page… <input type="search" name="q" defaultValue={q} size={40} autoFocus /></label> <button>Go</button></p>
        </GetForm>
        <p><small>Press ↑ ↓ (or Tab) to move, Enter to go. Ctrl/⌘ + K opens this from anywhere.</small></p>
        {!q
          ? recent.length
            ? <><h2>Recently visited</h2><ul>{recent.map((p) => <li key={p.href}><a href={p.href}>{p.title}</a></li>)}</ul></>
            : <p>Pages you visit show up here so you can get back to them fast.</p>
          : matches.length
            ? <>
              <ul>{matches.map((x) => <li key={x.href}><a href={x.href}><Hi text={x.label} q={words[0] ?? ""} /></a></li>)}</ul>
              <p><a href={`/find?q=${encodeURIComponent(q)}`}>Search everything for “{q}”</a></p>
            </>
            : <p>Nothing here matches “{q}”. <a href={`/find?q=${encodeURIComponent(q)}`}>Search everything instead?</a></p>}
      </Page>
    )
  }),

  page("/shortcuts", () => (
    <Page title="Keyboard shortcuts">
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
      <p><a href="/help">All help guides</a></p>
    </Page>
  )),
]
