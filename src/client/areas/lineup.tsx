// Timeline: every dated project on one timeline, plus markers (holidays, launches). Posts: src/areas/lineup.ts.
// The reference area: pages read the local copy (data.ts / db), forms post to the old routes.
import { useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, visibleProjects, NoAccess, NotFound } from "../data.ts"
import { isClient, projectUrl, type Marker } from "../../shared/domain.ts"
import { addDays, fmtDate, isoDate, today } from "../../shared/format.ts"
import { Form } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"

const WEEKS = 12

/** The Monday on or before `d`. */
const monday = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7))

const markers = () => [...db.markers.values()].filter((m) => m.account_id === me().account_id).sort((a, b) => a.on_date.localeCompare(b.on_date))

const MarkerForm = ({ m }: { m: Partial<Marker> }) => (
  <>
    <Form action={m.id ? `/timeline/markers/${m.id}/edit` : "/timeline/markers"}>
      <p><label>Name<br /><input name="name" defaultValue={m.name ?? ""} required placeholder="Product launch, Company holiday…" /></label></p>
      <p><label>Date<br /><input type="date" name="on_date" defaultValue={m.on_date ?? ""} required /></label></p>
      <p><button>{m.id ? "Save changes" : "Add marker"}</button> <a href="/timeline">Cancel</a></p>
    </Form>
    {m.id && <Form action={`/timeline/markers/${m.id}/delete`}><button>Delete this marker</button></Form>}
  </>
)

const findMarker = (id: string | undefined) => {
  if (isClient(me())) throw new NoAccess()
  const m = db.markers.get(String(Number(id) || 0))
  if (!m) throw new NotFound()
  return m
}

export const routes = [
  page("/timeline", () => {
    const [q] = useSearchParams()
    const m = me()
    // Earlier/Later stop a year either side of today, so the pages (and the crawler) end somewhere.
    const asked = /^\d{4}-\d{2}-\d{2}$/.test(q.get("from") ?? "") ? q.get("from")! : today()
    const from = asked < addDays(today(), -365) ? addDays(today(), -365) : asked > addDays(today(), 365) ? addDays(today(), 365) : asked
    const start = addDays(monday(from), -7)
    const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(start, i * 7))
    const end = addDays(start, WEEKS * 7 - 1)
    const ps = visibleProjects()
    const dated = ps.filter((p) => p.starts_on && p.ends_on).map((p) => ({ p, s: isoDate(p.starts_on), e: isoDate(p.ends_on) }))
    const undated = ps.filter((p) => !p.starts_on || !p.ends_on)
    const ms = markers()
    const thisWeek = monday(today())
    const inWeek = (w: string, d: string) => d >= w && d <= addDays(w, 6)
    const shown = dated.filter(({ s, e }) => s <= end && e >= start)
    return (
      <Page title="Timeline">
        <h1>Timeline</h1>
        <p>
          {from > addDays(today(), -365) && <><a href={`/timeline?from=${addDays(from, -28)}`}>← Earlier</a> · </>}
          <a href="/timeline">Today</a>
          {from < addDays(today(), 365) && <> · <a href={`/timeline?from=${addDays(from, 28)}`}>Later →</a></>}
        </p>
        {dated.length === 0 ? (
          <p>The Timeline shows projects that have start and end dates. Add dates to a project to put it here.</p>
        ) : (
          <>
            <table>
              <caption>Weeks of {fmtDate(start)} to {fmtDate(end)}. ■ = the project is running that week.</caption>
              <thead><tr><th scope="col">Project</th>{weeks.map((w) => <th key={w} scope="col">{w === thisWeek && <><mark>Today ▼</mark><br /></>}{fmtDate(w)}</th>)}</tr></thead>
              <tbody>
                {ms.some((x) => x.on_date >= start && x.on_date <= end) && (
                  <tr><th scope="row">Markers</th>{weeks.map((w) => <td key={w}>{ms.filter((x) => inWeek(w, x.on_date)).map((x) => <a key={x.id} href={`/timeline/markers/${x.id}/edit`}>◆ {x.name} </a>)}</td>)}</tr>
                )}
                {shown.map(({ p, s, e }) => (
                  <tr key={p.id}>
                    <th scope="row"><a href={projectUrl(p)}>{p.name}</a><br /><small>{fmtDate(s)} → {fmtDate(e)}</small></th>
                    {weeks.map((w) => <td key={w}>{s <= addDays(w, 6) && e >= w ? "■" : ""}{w === thisWeek ? " |" : ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p>No projects run during these weeks. Try earlier or later.</p>}
          </>
        )}
        <h2>Markers</h2>
        {ms.length
          ? <ul>{ms.map((x) => <li key={x.id}>{fmtDate(x.on_date)}: {x.name}{!isClient(m) && <> <a href={`/timeline/markers/${x.id}/edit`}>Edit</a></>}</li>)}</ul>
          : <p>No markers yet. Markers flag dates everyone should know about, like holidays and launches.</p>}
        {!isClient(m) && <p><a href="/timeline/markers/new" data-button>Add a marker</a></p>}
        {undated.length > 0 && !isClient(m) && (
          <>
            <h2>Projects without dates</h2>
            <p>Add start and end dates to put these on the Timeline.</p>
            <ul>{undated.map((p) => <li key={p.id}>{p.name} · <a href={`/projects/${p.id}/edit`}>Add dates</a></li>)}</ul>
          </>
        )}
      </Page>
    )
  }),

  page("/timeline/markers/new", () => {
    const [q] = useSearchParams()
    if (isClient(me())) throw new NoAccess()
    return <Page title="Add a marker" crumbs={[["Timeline", "/timeline"]]}><h1>Add a marker</h1><MarkerForm m={{ on_date: q.get("on") ?? "" }} /></Page>
  }),

  page("/timeline/markers/:mid/edit", () => {
    const m = findMarker(useParams().mid)
    return <Page title="Edit marker" crumbs={[["Timeline", "/timeline"]]}><h1>Edit marker</h1><MarkerForm m={m} /></Page>
  }),
]
