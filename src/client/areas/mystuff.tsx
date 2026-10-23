// Me: the menu, assignments, calendar, bookmarks, drafts, activity, reactions, reminders,
// profile, appearance, login & security, apps, help. Posts: src/areas/mystuff.ts (and hey.ts for notification settings).
import { useState } from "react"
import { useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, recordings } from "../data.ts"
import { isAdmin, isOutOfOffice, isQuiet, titleOf, urlFor, TYPE_NAMES, type Recording } from "../../shared/domain.ts"
import { excerpt, fmtDate, fmtDateTime, ms } from "../../shared/format.ts"
import { ActivityList, AgentsFilter, useJustAgents } from "../ui/activity.tsx"
import { Form } from "../ui/forms.tsx"
import { Page, page } from "../ui/page.tsx"

const MY = [["Me", "/my"]] as const
const DAY = 86_400_000

/** A date (YYYY-MM-DD) in a time zone, `offset` days from today. */
const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * DAY).toLocaleDateString("en-CA", { timeZone: tz })

const projectName = (id: number) => db.projects.get(String(id))?.name

type Assigned = Recording & { project_name: string; parent_title: string | null }

/** Tasks, cards and steps assigned to me in active projects. */
const assigned = (): Assigned[] => {
  const m = me()
  return recordings((r) => r.account_id === m.account_id && ["todo", "card", "step"].includes(r.type) && r.status === "active"
    && db.projects.get(String(r.project_id))?.status === "active" && (r.data.assignee_ids ?? []).includes(m.id))
    .map((r) => ({
      ...r,
      project_name: projectName(r.project_id)!,
      parent_title: r.type === "step" ? db.recordings.get(String(r.parent_id))?.title ?? null : null,
    }))
}

const AssignmentItem = ({ r, done, tz }: { r: Assigned; done: boolean; tz: string }) => (
  <li>
    {done ? "✓ " : (
      <>
        <Form
          action={`/my/assignments/${r.id}/complete`} style={{ display: "inline" }}
          optimistic={() => db.recordings.set(String(r.id), { ...r, data: { ...r.data, completed_at: new Date().toISOString(), completer_id: me().id } })}
        >
          <button title="Mark done">☐</button>
        </Form>{" "}
      </>
    )}
    <a href={urlFor(r)}>{titleOf(r)}</a>{" "}
    <small>({TYPE_NAMES[r.type]}{r.parent_title ? ` on ${r.parent_title}` : ""} · {r.project_name}{r.data.due_on ? ` · due ${fmtDate(r.data.due_on)}` : ""}{done && r.data.completed_at ? ` · done ${fmtDate(r.data.completed_at, tz)}` : ""})</small>
  </li>
)

/** Where "Continue editing" goes for a draft. */
const draftEditPath = (r: Recording) =>
  r.type === "message" ? `/projects/${r.project_id}/posts/${r.id}/edit`
  : r.type === "doc" ? `/projects/${r.project_id}/docs/${r.id}/edit`
  : `/r/${r.id}/go`

/** Mirrors src/areas/mystuff.ts. */
const TIME_ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")]

export const routes = [
  page("/my", () => {
    const m = me()
    return (
      <Page title="Me">
        <h1>Me</h1>
        <p><b>{m.name}</b>{m.title ? `, ${m.title}` : ""}{isQuiet(m) ? " · ☾ notifications paused" : ""}{isOutOfOffice(m) ? ` · out of office until ${fmtDate(m.prefs.ooo!.until)}` : ""}</p>
        <ul>
          <li><a href="/my/assignments">My Assignments</a></li>
          <li><a href="/my/calendar">My Calendar</a></li>
          <li><a href="/my/bookmarks">My Bookmarks</a></li>
          <li><a href="/my/drafts">My Drafts</a></li>
          <li><a href="/my/activity">My Activity</a></li>
          <li><a href="/my/reactions">My Reactions</a></li>
          <li><a href="/my/reminders">My Reminders</a></li>
        </ul>
        <ul>
          <li><a href="/my/profile">Profile</a></li>
          <li><a href="/my/notifications">Notification settings</a></li>
          <li><a href="/my/out-of-office">Out of office</a></li>
          <li><a href="/my/appearance">Appearance</a></li>
          <li><a href="/my/security">Login & security</a></li>
          <li><a href="/my/agents">Agents</a></li>
          <li><a href="/my/apps">Get the apps</a></li>
          {isAdmin(m) && <li><a href="/admin">Admin</a></li>}
          <li><a href="/help">Help</a></li>
          <li><a href="/accounts">Switch accounts</a></li>
        </ul>
        <Form action="/signout"><button>Sign out</button></Form>
      </Page>
    )
  }),

  page("/my/assignments", () => {
    const [q] = useSearchParams()
    const m = me()
    const done = q.get("completed") === "1"
    const byProject = q.get("group") === "project"
    const rows = assigned()
      .filter((r) => (done ? !!r.data.completed_at && ms(r.data.completed_at) > Date.now() - 30 * DAY : !r.data.completed_at))
      .sort(done
        ? (a, b) => String(b.data.completed_at).localeCompare(String(a.data.completed_at))
        : (a, b) => (a.data.due_on ? (b.data.due_on ? a.data.due_on.localeCompare(b.data.due_on) : -1) : b.data.due_on ? 1 : 0) || a.id - b.id)
    const today = dayIn(m.time_zone)
    const soon = dayIn(m.time_zone, 7)
    const groups: [string, ReadonlyArray<Assigned>][] = done
      ? [["Completed in the last 30 days", rows]]
      : byProject
        ? [...rows.reduce((g, r) => g.set(r.project_name, [...(g.get(r.project_name) ?? []), r]), new Map<string, Assigned[]>())]
        : [
            ["Overdue", rows.filter((r) => r.data.due_on && r.data.due_on < today)],
            ["Due soon", rows.filter((r) => r.data.due_on && r.data.due_on >= today && r.data.due_on <= soon)],
            ["No due date", rows.filter((r) => !r.data.due_on)],
            ["Later", rows.filter((r) => r.data.due_on && r.data.due_on > soon)],
          ]
    return (
      <Page title="My Assignments" crumbs={MY}>
        <h1>My Assignments</h1>
        <p>Everything on your plate, across every project.</p>
        <p>
          {done
            ? <a href="/my/assignments">Back to what's open</a>
            : <>Group by: {byProject ? <><a href="/my/assignments">date</a> · <b>project</b></> : <><b>date</b> · <a href="/my/assignments?group=project">project</a></>} · <a href="/my/assignments?completed=1">Completed recently</a></>}
        </p>
        {rows.length === 0
          ? <p>{done ? "Nothing completed in the last 30 days." : "Nothing's assigned to you right now."}</p>
          : groups.filter(([, rs]) => rs.length).map(([label, rs]) => (
              <div key={label}>
                <h2>{label}</h2>
                <ul>{rs.map((r) => <AssignmentItem key={r.id} r={r} done={done} tz={m.time_zone} />)}</ul>
              </div>
            ))}
      </Page>
    )
  }),

  page("/my/calendar", () => {
    const m = me()
    const today = dayIn(m.time_zone)
    const rows = recordings((r) => {
      if (r.account_id !== m.account_id || r.status !== "active" || db.projects.get(String(r.project_id))?.status !== "active") return false
      if (r.type === "event")
        return ((r.data.participant_ids ?? []).includes(m.id) || r.creator_id === m.id) && String(r.data.ends_at ?? r.data.starts_at ?? "").slice(0, 10) >= today
      return ["todo", "card", "step"].includes(r.type) && (r.data.assignee_ids ?? []).includes(m.id) && !r.data.completed_at && !!r.data.due_on && r.data.due_on >= today
    })
      .map((r) => ({ ...r, project_name: projectName(r.project_id)!, on_date: String(r.data.starts_at ?? r.data.due_on).slice(0, 10) }))
      .sort((a, b) => a.on_date.localeCompare(b.on_date) || a.id - b.id)
      .slice(0, 200)
    const days = rows.reduce((g, r) => g.set(r.on_date, [...(g.get(r.on_date) ?? []), r]), new Map<string, typeof rows>())
    return (
      <Page title="My Calendar" crumbs={MY}>
        <h1>My Calendar</h1>
        <p>Your events and due dates, across every project.</p>
        {rows.length === 0
          ? <p>No upcoming dates for you.</p>
          : [...days].map(([d, rs]) => (
              <div key={d}>
                <h2>{d === today ? "Today" : fmtDate(d)}</h2>
                <ul>{rs.map((r) => <li key={r.id}>{r.type === "event" ? "📅 " : "☐ "}<a href={urlFor(r)}>{titleOf(r)}</a> <small>({r.type === "event" ? "event" : `${TYPE_NAMES[r.type]} due`} · {r.project_name})</small></li>)}</ul>
              </div>
            ))}
        <p><a href="/my/calendar/feed">Add these dates to your own calendar app</a></p>
      </Page>
    )
  }),

  page("/my/bookmarks", () => {
    const m = me()
    const rows = [...db.bookmarks.values()].filter((b) => b.person_id === m.id).sort((a, b) => b.created_at.localeCompare(a.created_at))
    return (
      <Page title="My Bookmarks" crumbs={MY}>
        <h1>My Bookmarks</h1>
        {rows.length === 0
          ? <p>Bookmark anything with the ribbon icon and it'll be waiting here.</p>
          : (
            <ul>
              {rows.map((b) => {
                const r = b.recording_id ? db.recordings.get(String(b.recording_id)) : undefined
                return (
                  <li key={b.id}>
                    {b.recording_id
                      ? <><a href={`/r/${b.recording_id}/go`}>{titleOf({ type: r?.type ?? "", title: r?.title ?? "", body: r?.body ?? "" })}</a> <small>({TYPE_NAMES[r?.type ?? ""] ?? "item"} · {r ? projectName(r.project_id) : ""})</small></>
                      : <><a href={`/projects/${b.project_id}`}>{b.project_id ? projectName(b.project_id) : ""}</a> <small>(project)</small></>}{" "}
                    <Form action={`/my/bookmarks/${b.id}/delete`} style={{ display: "inline" }} optimistic={() => db.bookmarks.delete(String(b.id))}><button>Remove</button></Form>
                  </li>
                )
              })}
            </ul>
          )}
      </Page>
    )
  }),

  page("/my/drafts", () => {
    const m = me()
    const drafts = recordings((r) => r.creator_id === m.id && r.status === "drafted" && db.projects.has(String(r.project_id)))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return (
      <Page title="My Drafts" crumbs={MY}>
        <h1>My Drafts</h1>
        {drafts.length === 0
          ? <p>No drafts. Anything you save as a draft shows up here.</p>
          : (
            <ul>
              {drafts.map((r) => (
                <li key={r.id}>
                  <b>{titleOf(r)}</b> <small>({TYPE_NAMES[r.type]} · {projectName(r.project_id)} · saved {fmtDateTime(r.updated_at, m.time_zone)})</small>
                  {r.body && <><br />{excerpt(r.body, 100)}</>}
                  <br /><a href={draftEditPath(r)}>Continue editing</a>{" "}
                  <Form action={`/my/drafts/${r.id}/discard`} style={{ display: "inline" }} optimistic={() => db.recordings.delete(String(r.id))}><button>Discard</button></Form>
                </li>
              ))}
            </ul>
          )}
      </Page>
    )
  }),

  page("/my/activity", () => {
    const [q] = useSearchParams()
    const m = me()
    const pageN = Math.max(1, Number(q.get("page")) || 1)
    const agents = useJustAgents()
    const evs = [...db.events.values()]
      .filter((e) => e.person_id === m.id && (!agents || !!e.via))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice((pageN - 1) * 50, pageN * 50 + 1)
      .map((e) => ({ ...e, name: m.name, avatar_url: m.avatar_url, project_name: e.project_id ? projectName(e.project_id) : undefined }))
    return (
      <Page title="My Activity" crumbs={MY}>
        <h1>My Activity</h1>
        <AgentsFilter />
        {evs.length ? <ActivityList events={evs.slice(0, 50)} tz={m.time_zone} /> : <p>{agents ? "Your agents haven't done anything yet. What they do for you shows up here." : "You haven't done anything yet. Your posts, comments and check-offs show up here."}</p>}
        {evs.length > 50 && <p><a href={`/my/activity?page=${pageN + 1}${agents ? "&by=agents" : ""}`}>Show more</a></p>}
      </Page>
    )
  }),

  page("/my/reactions", () => {
    const m = me()
    const tz = m.time_zone
    type B = { id: number; content: string; created_at: string; recording_id: number; name: string; r: Recording }
    const all = [...db.boosts.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
    const withRec = all.flatMap((b) => { const r = db.recordings.get(String(b.recording_id)); return r ? [{ ...b, r }] : [] })
    const got: B[] = withRec
      .filter((b) => b.r.creator_id === m.id && b.person_id !== m.id && db.people.has(String(b.person_id)))
      .slice(0, 100)
      .map((b) => ({ ...b, name: db.people.get(String(b.person_id))!.name }))
    const gave: B[] = withRec
      .filter((b) => b.person_id === m.id)
      .slice(0, 100)
      .map((b) => ({ ...b, name: db.people.get(String(b.r.creator_id))?.name ?? "someone" }))
    const list = (bs: ReadonlyArray<B>, who: (b: B) => string) => (
      <ul>{bs.map((b) => <li key={b.id}>{b.content} · {who(b)} · <a href={`/r/${b.recording_id}/go`}>{titleOf(b.r)}</a> <small>{fmtDate(b.created_at, tz)}</small></li>)}</ul>
    )
    return (
      <Page title="My Reactions" crumbs={MY}>
        <h1>My Reactions</h1>
        {!got.length && !gave.length && <p>No reactions yet.</p>}
        <h2>Reactions you got</h2>
        {got.length ? list(got, (b) => `from ${b.name}`) : <p>None yet.</p>}
        <h2>Reactions you gave</h2>
        {gave.length ? list(gave, (b) => `to ${b.name}`) : <p>None yet.</p>}
      </Page>
    )
  }),

  page("/my/reminders", () => {
    const m = me()
    const rows = [...db.bubble_ups.values()]
      .filter((u) => u.person_id === m.id && !u.cancelled_at && db.recordings.has(String(u.recording_id)))
      .sort((a, b) => a.bubble_at.localeCompare(b.bubble_at))
      .map((u) => ({ ...u, r: db.recordings.get(String(u.recording_id))! }))
    const upcoming = rows.filter((u) => !u.surfaced_at)
    const past = rows.filter((u) => u.surfaced_at).reverse().slice(0, 30)
    return (
      <Page title="My Reminders" crumbs={MY}>
        <h1>My Reminders</h1>
        {!rows.length && <p>No reminders yet. Pick “Remind me later” in any item's ••• menu. We'll bring it back to you.</p>}
        <h2>Coming up</h2>
        {upcoming.length
          ? (
            <ul>
              {upcoming.map((u) => (
                <li key={u.id}>
                  <a href={`/r/${u.recording_id}/go`}>{titleOf(u.r)}</a> <small>{fmtDateTime(u.bubble_at, m.time_zone)}</small>{" "}
                  <Form
                    action={`/my/reminders/${u.id}/cancel`} style={{ display: "inline" }}
                    optimistic={() => { const { r: _, ...row } = u; db.bubble_ups.set(String(u.id), { ...row, cancelled_at: new Date().toISOString() }) }}
                  >
                    <button>Cancel</button>
                  </Form>
                </li>
              ))}
            </ul>
          )
          : <p>Nothing coming up.</p>}
        {past.length > 0 && (
          <>
            <h2>Already sent</h2>
            <ul>{past.map((u) => <li key={u.id}><a href={`/r/${u.recording_id}/go`}>{titleOf(u.r)}</a> <small>{fmtDateTime(u.surfaced_at, m.time_zone)}</small></li>)}</ul>
          </>
        )}
      </Page>
    )
  }),

  page("/my/profile", () => {
    const m = me()
    return (
      <Page title="Profile" crumbs={MY}>
        <h1>Profile</h1>
        <Form action="/my/profile">
          {m.avatar_url && <p><img src={m.avatar_url} alt="Your photo" width={64} height={64} /></p>}
          <p><label>Photo (a link to a JPG, PNG or GIF)<br /><input type="url" name="avatar_url" defaultValue={m.avatar_url ?? ""} size={60} placeholder="https://…/me.jpg" /></label></p>
          <p><label>Name<br /><input name="name" defaultValue={m.name} required /></label></p>
          <p><label>Title<br /><input name="title" defaultValue={m.title ?? ""} placeholder="Designer" /></label></p>
          <p><label>About you<br /><textarea name="bio" rows={3} cols={60} defaultValue={m.bio ?? ""} /></label></p>
          <p><label>Location<br /><input name="location" defaultValue={m.location ?? ""} /></label></p>
          <p><label>Time zone<br /><select name="time_zone" defaultValue={m.time_zone}>{TIME_ZONES.map((z) => <option key={z}>{z}</option>)}</select></label></p>
          <p><button>Save changes</button></p>
        </Form>
        <p><small>ponytail: photo is a link for now; upload and crop come with file storage.</small></p>
        <p><a href={`/people/${m.id}`}>See your profile as others do</a></p>
      </Page>
    )
  }),

  page("/my/appearance", () => {
    const m = me()
    const a = m.appearance
    return (
      <Page title="Appearance" crumbs={MY}>
        <h1>Appearance</h1>
        {/* Re-themes right away: the layout reads me().appearance. */}
        <Form action="/my/appearance" optimistic={(fd) => {
          const v = String(fd.get("appearance") ?? "")
          db.people.set(String(m.id), { ...m, appearance: ["light", "dark"].includes(v) ? v : "system" })
        }}>
          <p>
            <label><input type="radio" name="appearance" value="light" defaultChecked={a === "light"} /> Light</label><br />
            <label><input type="radio" name="appearance" value="dark" defaultChecked={a === "dark"} /> Dark</label><br />
            <label><input type="radio" name="appearance" value="system" defaultChecked={a !== "light" && a !== "dark"} /> Match my system</label>
          </p>
          <button>Save</button>
        </Form>
      </Page>
    )
  }),

  page("/my/security", () => {
    const m = me()
    // Turning two-step on answers with backup codes, shown once.
    const [codes, setCodes] = useState<string[] | undefined>()
    return (
      <Page title="Login & security" crumbs={MY}>
        <h1>Login & security</h1>
        <p><small>ponytail: there's no sign-in yet, so passwords aren't stored. These forms validate and record your choices.</small></p>
        <h2>Email address</h2>
        <Form action="/my/security/email">
          <p><label>Email <input type="email" name="email" defaultValue={m.email} required /></label> <button>Change email</button></p>
        </Form>
        <h2>Change password</h2>
        <Form action="/my/security/password">
          <p><label>Current password<br /><input type="password" name="current" autoComplete="current-password" /></label></p>
          <p><label>New password<br /><input type="password" name="new" autoComplete="new-password" minLength={8} /></label></p>
          <p><label>New password again<br /><input type="password" name="confirm" autoComplete="new-password" /></label></p>
          <button>Change password</button>
        </Form>
        <h2>Two-step verification</h2>
        {m.prefs.two_factor ? (
          <>
            <p>Two-step verification is on.</p>
            {codes && <><p><b>Save these backup codes somewhere safe.</b> Each one works once if you lose your phone.</p><ul>{codes.map((k) => <li key={k}><code>{k}</code></li>)}</ul></>}
            <Form action="/my/security/two-factor" onDone={(r) => setCodes(r.data?.codes)}><button>Turn off two-step verification</button></Form>
          </>
        ) : (
          <>
            <p>Add a code from an authenticator app on top of your password.</p>
            <Form action="/my/security/two-factor" onDone={(r) => setCodes(r.data?.codes)}><button>Set up two-step verification</button></Form>
          </>
        )}
        <h2>Sign in with Google</h2>
        <Form action="/my/security/google"><button>{m.prefs.google ? "Turn off Sign in with Google" : "Turn on Sign in with Google"}</button></Form>
        <h2>Where you're signed in</h2>
        <ul><li>This browser (now)</li></ul>
        <Form action="/my/security/sign-out-others"><button>Sign out everywhere else</button></Form>
      </Page>
    )
  }),

  page("/my/apps", () => (
    <Page title="Get the apps" crumbs={MY}>
      <h1>Get the apps</h1>
      <p>Everything here is in the apps too, plus push notifications. <a href="/my/notifications">Notification settings</a></p>
      <ul>
        <li>iPhone & iPad</li>
        <li>Android</li>
        <li>Mac</li>
        <li>Windows</li>
      </ul>
      <p><small>ponytail: no native apps yet. This page is where the download links go.</small></p>
    </Page>
  )),

  page("/help", () => (
    <Page title="Help">
      <h1>Help</h1>
      <h2>Guides and how-tos</h2>
      <ul>
        <li><a href="/projects/new">Start a project</a>, then add people from its page.</li>
        <li><a href="/people/invite">Invite people</a> to your account, or clients to a project.</li>
        <li>Every item has a ••• menu: move, copy, bookmark, remind me later, trash.</li>
        <li><a href="/my/quiet-hours">Quiet hours</a> keep notifications to work hours.</li>
        <li><a href="/shortcuts">Keyboard shortcuts</a>: press ? anywhere, Ctrl/⌘ + K to go to any page.</li>
      </ul>
      <h2>What's new</h2>
      <ul>
        <li>Out of office: say when you're away and when you're back. <a href="/my/out-of-office">Turn it on</a></li>
        <li>Reminders: bring anything back to your Updates later. <a href="/my/reminders">Your reminders</a></li>
      </ul>
      <h2>Contact support</h2>
      <Form action="/help/support">
        <p><label>What's going on?<br /><textarea name="body" rows={5} cols={60} required /></label></p>
        <button>Send to support</button>
      </Form>
    </Page>
  )),
]
