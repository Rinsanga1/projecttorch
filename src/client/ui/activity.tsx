// The activity feed: events grouped by day, newest first as given. Project, Activity, reports and Me use it.
import * as stylex from "@stylexjs/stylex"
import { useSearchParams } from "react-router"
import { fmtDate } from "../../shared/format.ts"
import { Face, kit, sx } from "./kit.tsx"
import { space } from "./tokens.stylex.ts"

const pm = stylex.create({
  row: { display: "grid", gridTemplateColumns: "24px 1fr auto", columnGap: space.s3, alignItems: "start", paddingBlock: 10 },
  time: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
})

export type ActivityItem = {
  id: number
  summary: string
  created_at: string
  name: string | null
  avatar_url?: string | null
  recording_id: number | null
  project_name?: string
  project_id?: number | null
  /** The agent that did it for this person. */
  via?: string | null
}

/** ?by=agents: only what agents did. */
export const useJustAgents = () => useSearchParams()[0].get("by") === "agents"

/** "Everyone · Just agents", above an activity list. */
export const AgentsFilter = () => {
  const [q] = useSearchParams()
  const on = q.get("by") === "agents"
  const to = (agents: boolean) => {
    const n = new URLSearchParams(q)
    if (agents) n.set("by", "agents")
    else n.delete("by")
    n.delete("page")
    return n.size ? `?${n}` : "?"
  }
  return <p>{on ? <a href={to(false)}>Everyone</a> : <b>Everyone</b>} · {on ? <b>Just agents</b> : <a href={to(true)}>Just agents</a>}</p>
}

export const ActivityList = ({ events, tz }: { events: ReadonlyArray<ActivityItem>; tz: string }) => {
  const days = new Map<string, ActivityItem[]>()
  for (const e of events) {
    const d = fmtDate(e.created_at, tz)
    days.set(d, [...(days.get(d) ?? []), e])
  }
  return (
    <>
      {[...days].map(([d, es]) => (
        <div key={d}>
          <h2 {...sx(kit.day)}><span>{d}</span><span {...sx(kit.dayRule)} /></h2>
          <ul {...sx(kit.rows)}>
            {es.map((e) => (
              <li key={e.id} {...sx(pm.row)}>
                <Face p={{ name: e.name ?? "Someone", avatar_url: e.avatar_url }} px={24} />
                <span>
                  <b>{e.name ?? "Someone"}</b>{e.via && <small> via {e.via}</small>} {e.recording_id ? <a href={`/r/${e.recording_id}/go`}>{e.summary}</a> : e.summary}
                  {e.project_name && <> <small>in <a href={`/projects/${e.project_id}`}>{e.project_name}</a></small></>}
                </span>
                <small {...sx(pm.time)}>{new Date(e.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })}</small>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}
