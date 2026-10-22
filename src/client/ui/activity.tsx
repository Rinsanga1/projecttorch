// The activity feed: events grouped by day, newest first as given. Project, Activity, reports and Me use it.
import * as stylex from "@stylexjs/stylex"
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
                  <b>{e.name ?? "Someone"}</b> {e.recording_id ? <a href={`/r/${e.recording_id}/go`}>{e.summary}</a> : e.summary}
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
