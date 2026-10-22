// The shared domain: projects, recordings, access, subscriptions, notifications, activity.
//
// recordings.data by type (all optional):
//   message:   category_id, pinned
//   todolist:  tracked (on the progress hill)
//   todo:      assignee_ids[], notify_ids[], due_on, starts_on, completed_at, completer_id
//   folder:    color
//   upload:    path, filename, size, content_type, versions[{path, filename, size, at, person_id}]
//   cloudfile: url
//   event:     starts_at, ends_at, all_day, repeat, participant_ids[]
//   question:  frequency (daily|weekly|biweekly|monthly), days[0-6], time "HH:MM", asked_ids[], paused, last_asked_on
//   column:    kind (triage|custom|not_now|done), color, watcher_ids[], on_hold
//   card:      assignee_ids[], due_on, on_hold, completed_at
//   step:      assignee_ids[], due_on, completed_at
//   forward:   from, to, original_subject
//   door:      url, description
//   line:      (body only)
//   comment:   (body only)
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { fmtDate, esc } from "../shared/format.ts"
import { CLIENT_INHERITS, TYPE_NAMES, titleOf, urlFor, mentionedIds, canSeeProject, type Tool } from "../shared/domain.ts"
import { NotFound, NoAccess, Deleted, isAdmin, isClient, isQuiet, type Ctx, type Person } from "./web.ts"

export {
  TOOL_PATHS, defaultTools, toolName, toolUrl, projectUrl, TYPE_TOOL, TYPE_NAMES, urlFor, titleOf, canSeeProject, mentionedIds, CLIENT_INHERITS,
} from "../shared/domain.ts"
export type { Tool, ToolType } from "../shared/domain.ts"

export type Project = {
  id: number
  account_id: number
  kind: "project" | "template" | "ping"
  is_hq: boolean
  name: string
  description: string | null
  all_access: boolean
  clients_see_new: boolean
  status: "active" | "archived" | "trashed"
  trashed_at: Date | null
  starts_on: string | null
  ends_on: string | null
  tools: Tool[]
  email_token: string | null
  created_by: number | null
  created_at: Date
}

export type Recording = {
  id: number
  account_id: number
  project_id: number
  parent_id: number | null
  type: string
  title: string
  body: string
  data: Record<string, any>
  status: "active" | "drafted" | "archived" | "trashed"
  trashed_at: Date | null
  position: number
  visible_to_clients: boolean
  creator_id: number | null
  created_at: Date
  updated_at: Date
}

// ---------- people ----------
export const personById = (id: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where id = ${id}`
    return p ?? null
  })

export const accountPeople = (accountId: number, opts: { includeClients?: boolean } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Person & { company_name: string | null }>`
      select p.*, c.name as company_name from people p left join companies c on c.id = p.company_id
      where p.account_id = ${accountId} and p.removed_at is null and p.joined_at is not null
      ${opts.includeClients === false ? sql`and p.role <> 'client'` : sql``}
      order by c.name nulls first, p.name`
  })

/** Everyone who can see a project: members, plus all non-clients when it's all-access. */
export const projectPeople = (project: Project) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Person & { company_name: string | null }>`
      select distinct p.*, c.name as company_name from people p left join companies c on c.id = p.company_id
      where p.removed_at is null and p.joined_at is not null and p.account_id = ${project.account_id}
        and (p.id in (select person_id from project_people where project_id = ${project.id})
             ${project.all_access ? sql`or p.role <> 'client'` : sql``})
      order by c.name nulls first, p.name`
  })

// ---------- access ----------
/** Load a project the current person can see, or fail with NotFound/NoAccess/Deleted. */
export const findProject = (c: Ctx, id: number | string | undefined, opts: { allowTrashed?: boolean } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Project>`select * from projects where id = ${Number(id) || 0}`
    if (!p || p.account_id !== c.me.account_id) return yield* new NotFound()
    if (p.status === "trashed" && !opts.allowTrashed && !isAdmin(c.me)) return yield* new NotFound()
    const members = (yield* sql<{ person_id: number }>`select person_id from project_people where project_id = ${p.id}`).map((r) => r.person_id)
    if (!canSeeProject(c.me, p, members)) return yield* new NoAccess()
    return p
  })

/** Load a recording the current person can see. Clients only see client-visible things. */
export const findRecording = (c: Ctx, id: number | string | undefined, type?: string | ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [r] = yield* sql<Recording>`select * from recordings where id = ${Number(id) || 0}`
    if (!r) return yield* new Deleted()
    const types = type === undefined ? null : typeof type === "string" ? [type] : type
    if (types && !types.includes(r.type)) return yield* new NotFound()
    const project = yield* findProject(c, r.project_id, { allowTrashed: true })
    if (isClient(c.me) && !(yield* clientVisible(r))) return yield* new NoAccess()
    if (r.status === "drafted" && r.creator_id !== c.me.id) return yield* new NotFound()
    return { r, project }
  })

/** A client sees a recording only if it and every ancestor is marked visible. */
export const clientVisible = (r: Recording) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ ok: boolean }>`
      with recursive chain as (
        select id, parent_id, visible_to_clients, type from recordings where id = ${r.id}
        union all select x.id, x.parent_id, x.visible_to_clients, x.type from recordings x join chain on x.id = chain.parent_id)
      select bool_and(visible_to_clients or type in ${sql.in(CLIENT_INHERITS)}) as ok from chain`
    return !!row?.ok
  })

/** SQL fragment that hides non-client-visible recordings from clients. Use as ${clientFilter(sql, c.me)}. */
export const clientFilter = (sql: SqlClient.SqlClient, me: Person, alias = "recordings") =>
  isClient(me) ? sql`and ${sql(alias)}.visible_to_clients` : sql``

// ---------- activity ----------
export const logEvent = (c: Ctx, e: { project_id: number | null; recording_id?: number | null; action: string; summary: string }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`insert into events ${sql.insert({ account_id: c.me.account_id, project_id: e.project_id, recording_id: e.recording_id ?? null, person_id: c.me.id, action: e.action, summary: e.summary })}`
    if (e.project_id) yield* fireWebhooks(e.project_id, e.action, { ...e, person: c.me.name })
  })

/** POST event JSON to project webhooks in the background, recording each delivery. */
const fireWebhooks = (projectId: number, action: string, payload: unknown) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const hooks = yield* sql<{ id: number; url: string; types: string[] }>`select id, url, types from webhooks where project_id = ${projectId}`
    for (const h of hooks) {
      if (h.types.length && !h.types.includes(action)) continue
      yield* Effect.forkDetach(
        Effect.gen(function* () {
          const res = yield* Effect.tryPromise(() => fetch(h.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, payload }), signal: AbortSignal.timeout(5000) }))
            .pipe(Effect.map((r) => ({ status: r.status, error: null as string | null })), Effect.catchCause((cause) => Effect.succeed({ status: null, error: String((cause as any)?.reasons?.[0]?.error?.message ?? "Couldn't reach that URL") })))
          yield* sql`insert into webhook_deliveries ${sql.insert({ webhook_id: h.id, event: action, status: res.status, error: res.error })}`
        }).pipe(Effect.ignore),
      )
    }
  })

// ---------- subscriptions & notifications ----------
export const subscribe = (recordingId: number, personIds: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const pid of new Set(personIds))
      yield* sql`insert into subscriptions (recording_id, person_id) values (${recordingId}, ${pid}) on conflict do nothing`
  })

export const subscriberIds = (recordingId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ person_id: number }>`select person_id from subscriptions where recording_id = ${recordingId}`).map((r) => r.person_id)
  })

/** Send email to someone, as long as they want email and aren't in quiet hours. Lands in /inbox. */
export const sendEmail = (to: Person, e: { subject: string; body: string; kind: string; link?: string; reply_to_recording_id?: number | null }, force = false) =>
  Effect.gen(function* () {
    if (!force && (to.prefs.notify_email === false || isQuiet(to))) return
    const sql = yield* SqlClient.SqlClient
    yield* sql`insert into emails ${sql.insert({ to_email: to.email, subject: e.subject, body: e.body, kind: e.kind, link: e.link ?? null, reply_to_recording_id: e.reply_to_recording_id ?? null, reply_person_id: to.id })}`
  })

/**
 * Tell people about something: an Updates notification, plus an email they can reply to.
 * Never notifies the actor. Clients aren't told about things they can't see.
 */
export const notify = (c: Ctx, n: { personIds: ReadonlyArray<number>; recording?: Recording | null; project_id?: number | null; kind: string; summary: string; email?: boolean }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const targets = [...new Set(n.personIds)].filter((id) => id !== c.me.id)
    if (!targets.length) return
    const people = yield* sql<Person>`select * from people where id in ${sql.in(targets)} and removed_at is null`
    const visible = n.recording ? yield* clientVisible(n.recording) : true
    for (const p of people) {
      if (isClient(p) && !visible) continue
      yield* sql`insert into notifications ${sql.insert({ person_id: p.id, recording_id: n.recording?.id ?? null, project_id: n.project_id ?? n.recording?.project_id ?? null, actor_id: c.me.id, kind: n.kind, summary: n.summary })}`
      if (n.email !== false && n.recording)
        yield* sendEmail(p, {
          subject: n.summary,
          body: `${n.summary}\n\n${n.recording.body ?? ""}\n\nReply to this email to comment.`,
          kind: "notification",
          link: urlFor(n.recording),
          reply_to_recording_id: n.recording.type === "comment" ? n.recording.parent_id : n.recording.id,
        })
    }
  })

// ---------- recordings ----------
export type NewRecording = {
  project: Project
  type: string
  parent_id?: number | null
  title?: string
  body?: string
  data?: Record<string, any>
  status?: "active" | "drafted"
  visible_to_clients?: boolean
  position?: number
  /** Who hears about this now. Subscribed too. */
  notifyIds?: ReadonlyArray<number>
  notifyKind?: string
  /** Summary for the activity feed, e.g. "shared a post". Defaults by type. */
  verb?: string
  /** Skip the activity event (e.g. chat lines). */
  quiet?: boolean
}

export const createRecording = (c: Ctx, n: NewRecording) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const position = n.position ?? (yield* sql<{ p: number }>`
      select coalesce(max(position), 0) + 1 as p from recordings where project_id = ${n.project.id} and type = ${n.type}
      and parent_id is not distinct from ${n.parent_id ?? null}`)[0]!.p
    const [r] = yield* sql<Recording>`insert into recordings ${sql.insert({
      account_id: c.me.account_id,
      project_id: n.project.id,
      parent_id: n.parent_id ?? null,
      type: n.type,
      title: n.title ?? "",
      body: n.body ?? "",
      data: JSON.stringify(n.data ?? {}),
      status: n.status ?? "active",
      visible_to_clients: n.visible_to_clients ?? (isClient(c.me) ? true : n.project.clients_see_new),
      creator_id: c.me.id,
      position,
    })} returning *`
    yield* sql`insert into versions ${sql.insert({ recording_id: r!.id, title: r!.title, body: r!.body, data: JSON.stringify(r!.data), person_id: c.me.id })}`
    if (r!.status === "drafted") return r!
    const pool = yield* projectPeople(n.project)
    const mentions = mentionedIds(`${r!.title} ${r!.body}`, pool)
    yield* subscribe(r!.id, [c.me.id, ...(n.notifyIds ?? []), ...mentions])
    if (!n.quiet)
      yield* logEvent(c, { project_id: n.project.id, recording_id: r!.id, action: "created", summary: `${n.verb ?? `added a ${TYPE_NAMES[n.type] ?? n.type}`}: ${titleOf(r!)}` })
    if (n.notifyIds?.length)
      yield* notify(c, { personIds: n.notifyIds, recording: r!, kind: n.notifyKind ?? n.type, summary: `${c.me.name} ${n.verb ?? "posted"}: ${titleOf(r!)}` })
    const extra = mentions.filter((id) => !(n.notifyIds ?? []).includes(id))
    if (extra.length) yield* notify(c, { personIds: extra, recording: r!, kind: "mention", summary: `${c.me.name} mentioned you in ${titleOf(r!)}` })
    return r!
  })

/** Save changes and keep the old version in history. `data` is merged. */
export const updateRecording = (c: Ctx, r: Recording, ch: { title?: string; body?: string; data?: Record<string, any>; visible_to_clients?: boolean }, opts: { quiet?: boolean; summary?: string } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const data = { ...r.data, ...(ch.data ?? {}) }
    const [u] = yield* sql<Recording>`update recordings set
      title = ${ch.title ?? r.title}, body = ${ch.body ?? r.body}, data = ${JSON.stringify(data)},
      visible_to_clients = ${ch.visible_to_clients ?? r.visible_to_clients}, updated_at = now()
      where id = ${r.id} returning *`
    if (ch.title !== undefined || ch.body !== undefined)
      yield* sql`insert into versions ${sql.insert({ recording_id: r.id, title: u!.title, body: u!.body, data: JSON.stringify(u!.data), person_id: c.me.id })}`
    if (!opts.quiet) yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "edited", summary: opts.summary ?? `edited ${titleOf(u!)}` })
    return u!
  })

/** Children of a recording, active ones by position. Clients only see client-visible ones. */
export const children = (c: Ctx, parentId: number, type?: string, status: string = "active") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Recording>`select * from recordings where parent_id = ${parentId} and status = ${status}
      ${type ? sql`and type = ${type}` : sql``} ${clientFilter(sql, c.me)} order by position, id`
  })

/** Top-level recordings of a type in a project (e.g. all messages). */
export const topLevel = (c: Ctx, projectId: number, type: string, status: string = "active") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Recording>`select * from recordings where project_id = ${projectId} and type = ${type} and parent_id is null and status = ${status}
      ${clientFilter(sql, c.me)} order by position, id`
  })

export const peopleByIds = (ids: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    if (!ids.length) return [] as Person[]
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Person>`select * from people where id in ${sql.in([...ids])} order by name`
  })

export const commentCount = (recordingId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ n: number }>`select count(*)::int as n from recordings where parent_id = ${recordingId} and type = 'comment' and status = 'active'`)[0]!.n
  })

// ---------- forms ----------

/** Read the notify picker's answer. */
export const notifyIdsFrom = (fd: FormData, people: ReadonlyArray<Person>, me: Person) => {
  const mode = String(fd.get("notify") ?? "everyone")
  if (mode === "nobody") return []
  if (mode === "selected") return fd.getAll("notify_ids").map(Number)
  return people.filter((p) => p.id !== me.id).map((p) => p.id)
}

export { NotFound, NoAccess, Deleted, fmtDate, esc }

// ---------- project lists ----------

/** Projects this person can see, by status and kind. */
export const visibleProjects = (c: Ctx, opts: { status?: string; kind?: string } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Project & { member_names: string | null; pinned: boolean }>`
      select p.*,
        (select string_agg(pe.name, ', ' order by pe.name) from project_people pp join people pe on pe.id = pp.person_id where pp.project_id = p.id and pe.removed_at is null) as member_names,
        exists (select 1 from pins where pins.project_id = p.id and pins.person_id = ${c.me.id}) as pinned
      from projects p
      where p.account_id = ${c.me.account_id} and p.status = ${opts.status ?? "active"} and p.kind = ${opts.kind ?? "project"}
        and (exists (select 1 from project_people pp where pp.project_id = p.id and pp.person_id = ${c.me.id})
             ${isClient(c.me) ? sql`` : sql`or p.all_access`}
             ${isAdmin(c.me) && (opts.kind ?? "project") !== "ping" ? sql`or true` : sql``})
      order by p.is_hq desc, p.name`
  })

/** Remember the last pages someone visited (Go to, Home's "recently visited"). */
export const trackVisit = (c: Ctx, href: string, title: string, projectId?: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const pages = [{ href, title }, ...((c.me.prefs as any).recent_pages ?? []).filter((p: any) => p.href !== href)].slice(0, 12)
    const projects = projectId ? [projectId, ...((c.me.prefs as any).recent_projects ?? []).filter((id: number) => id !== projectId)].slice(0, 8) : (c.me.prefs as any).recent_projects ?? []
    yield* sql`update people set prefs = prefs || ${JSON.stringify({ recent_pages: pages, recent_projects: projects })}::jsonb, last_active_at = now() where id = ${c.me.id}`
  })

/** Can this person make new projects? */
export const canCreateProjects = (c: Ctx) =>
  !isClient(c.me) && (c.account.settings.who_can_create_projects !== "admins" || isAdmin(c.me))

/** Can this person invite people? */
export const canInvite = (c: Ctx) =>
  !isClient(c.me) && (c.account.settings.who_can_invite !== "admins" || isAdmin(c.me))
