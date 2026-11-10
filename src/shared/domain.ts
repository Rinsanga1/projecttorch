// The domain rules both sides need: synced row types, tool and type tables, URLs, titles, roles and access.
// Rows here are as the browser holds them: timestamps are ISO strings, dates are YYYY-MM-DD, jsonb is parsed.
//
// recordings.data by type (all optional):
//   message:   category_id, pinned
//   todo:      assignee_ids[], notify_ids[], due_on, starts_on, completed_at, completer_id (a Compass goal at the top level,
//              a subgoal when its parent is a goal; a goal with subgoals is done when they all are)
//   folder:    color
//   upload:    path, filename, size, content_type, versions[{path, filename, size, at, person_id}]
//   cloudfile: url
//   event:     starts_at, ends_at, all_day, repeat, participant_ids[]
//   column:    kind (triage = "Triage" | custom | review | not_now = "Not now" | done), color, note (what it's for), watcher_ids[]
//   card:      assignee_ids[], due_on, golden (pinned to the top of its column), completed_at
//   step:      assignee_ids[], due_on, completed_at
//   line:      (body only)
//   comment:   (body only)

export type Stamp = string

export type Prefs = {
  notify_email?: boolean
  notify_desktop?: boolean
  notify_push?: boolean
  wcw?: { on?: boolean; days?: number[]; start?: string; end?: string }
  snooze_until?: string
  ooo?: { from?: string; until?: string; message?: string }
  recent_searches?: string[]
  two_factor?: boolean
  campfire_notify?: Record<string, "everything" | "mentions">
  recent_pages?: { href: string; title: string }[]
  recent_projects?: number[]
  /** Project id → when this person last opened it (ISO). The project page counts what's new since. */
  project_seen?: Record<string, string>
  /** "projectId:window" → when this person last opened that window (ISO). Each window's news counts since then. */
  window_seen?: Record<string, string>
}

export type Role = "owner" | "admin" | "member" | "client"

export type Account = {
  id: number
  name: string
  logo_url: string | null
  plan: string
  status: "trial" | "active" | "on_hold" | "cancelled"
  trial_ends_on: string | null
  cancelled_at: Stamp | null
  billing_email: string | null
  card_last4: string | null
  settings: {
    who_can_create_projects?: "everyone" | "admins"
    who_can_invite?: "everyone" | "admins"
    clients_can_ping?: boolean
    require_2fa?: boolean
    /** The template agents start new projects from (areas/home.ts). */
    agent_template_id?: number
  }
  /** The team link's code (/join/<code>). Only arrives for people who may invite. */
  join_code: string | null
  created_at: Stamp
}

export type Company = { id: number; account_id: number; name: string }

/** Other people's `prefs` arrive trimmed to what's public (ooo, wcw, snooze_until); `invite_token` never arrives. */
export type Person = {
  id: number
  account_id: number
  company_id: number | null
  name: string
  email: string
  title: string | null
  bio: string | null
  location: string | null
  time_zone: string
  avatar_url: string | null
  role: Role
  appearance: string
  prefs: Prefs
  invited_by: number | null
  invited_at: Stamp | null
  joined_at: Stamp | null
  removed_at: Stamp | null
  last_active_at: Stamp | null
  created_at: Stamp
}

/** One of a project's windows. A project can have several of a type: the first one's id is its type ("vault"), copies
 * get their own ("vault-2"). Things made in a copy carry its id in `data.tool` on the top-level recording. */
export type Tool = { id: string; type: ToolType; name: string; enabled: boolean }
export type ToolType = "message_board" | "todos" | "vault" | "campfire" | "schedule" | "cardtable"

export type Project = {
  id: number
  account_id: number
  kind: "project" | "template" | "ping"
  name: string
  description: string | null
  all_access: boolean
  clients_see_new: boolean
  status: "active" | "archived" | "trashed"
  trashed_at: Stamp | null
  starts_on: string | null
  ends_on: string | null
  tools: Tool[]
  created_by: number | null
  created_at: Stamp
}

export type RecordingStatus = "active" | "drafted" | "archived" | "trashed"
export type Recording = {
  id: number
  account_id: number
  project_id: number
  parent_id: number | null
  type: string
  title: string
  body: string
  data: Record<string, any>
  status: RecordingStatus
  trashed_at: Stamp | null
  position: number
  visible_to_clients: boolean
  creator_id: number | null
  /** The agent that made it for the creator (its connection's name), or null. */
  via?: string | null
  created_at: Stamp
  updated_at: Stamp
}

export type ProjectPerson = { project_id: number; person_id: number; added_at: Stamp }
export type Pin = { person_id: number; project_id: number; position: number }
export type Subscription = { recording_id: number; person_id: number }
export type Boost = { id: number; recording_id: number; person_id: number; content: string; created_at: Stamp }
export type Bookmark = { id: number; person_id: number; project_id: number | null; recording_id: number | null; created_at: Stamp }
export type BubbleUp = { id: number; person_id: number; recording_id: number; bubble_at: Stamp; surfaced_at: Stamp | null; cancelled_at: Stamp | null }
export type Notification = {
  id: number; person_id: number; recording_id: number | null; project_id: number | null; actor_id: number | null
  kind: string; summary: string; read_at: Stamp | null; created_at: Stamp
}
export type Event = {
  id: number; account_id: number; project_id: number | null; recording_id: number | null; person_id: number | null
  action: string; summary: string; via: string | null; created_at: Stamp
}
export type Category = { id: number; account_id: number; emoji: string; name: string }
export type Marker = { id: number; account_id: number; name: string; on_date: string }
/** `token` only arrives for people who aren't clients. */
export type Chatbot = { id: number; account_id: number; name: string; command_url: string | null; token: string | null; created_at: Stamp }
export type Webhook = { id: number; project_id: number; url: string; types: string[]; created_at: Stamp }
export type PublicLink = { token: string; recording_id: number; created_at: Stamp }
export type Export = { id: number; account_id: number; person_id: number | null; status: "pending" | "ready"; file_path: string | null; created_at: Stamp }
/** An agent or app working as this person: approved from the app (`client_id`), or a key made on /my/agents. */
export type ConnectedApp = { id: number; person_id: number; name: string; client_id: string | null; scope: "full" | "read"; last_used_at: Stamp | null; created_at: Stamp }

/** Every table the browser holds a copy of, with its row type. */
export type Tables = {
  accounts: Account
  companies: Company
  people: Person
  projects: Project
  project_people: ProjectPerson
  pins: Pin
  recordings: Recording
  subscriptions: Subscription
  boosts: Boost
  bookmarks: Bookmark
  bubble_ups: BubbleUp
  notifications: Notification
  events: Event
  categories: Category
  markers: Marker
  chatbots: Chatbot
  webhooks: Webhook
  public_links: PublicLink
  exports: Export
  connected_apps: ConnectedApp
}
export type Table = keyof Tables

/** Primary key columns per table (most are `id`). */
export const KEYS: { [T in Table]: ReadonlyArray<keyof Tables[T] & string> } = {
  accounts: ["id"], companies: ["id"], people: ["id"], projects: ["id"], project_people: ["project_id", "person_id"],
  pins: ["person_id", "project_id"], recordings: ["id"], subscriptions: ["recording_id", "person_id"], boosts: ["id"],
  bookmarks: ["id"], bubble_ups: ["id"], notifications: ["id"], events: ["id"], categories: ["id"], markers: ["id"],
  chatbots: ["id"], webhooks: ["id"],
  public_links: ["token"], exports: ["id"], connected_apps: ["id"],
}
export const TABLES = Object.keys(KEYS) as Table[]
export const keyOf = (t: Table, row: any) => KEYS[t].map((k) => row[k]).join(":")

// ---------- tools ----------
export const TOOL_PATHS: Record<ToolType, string> = {
  message_board: "posts",
  todos: "tasks",
  vault: "files",
  campfire: "chat",
  schedule: "calendar",
  cardtable: "board",
}

/** Every page inside a project that belongs to one of its windows, by its first path segment. The project's own pages
 * (menu, people, settings, activity, trash…) aren't in here: they stay pages of their own. */
const WINDOW_SEGMENTS: Record<string, ToolType> = {
  posts: "message_board",
  tasks: "todos",
  files: "vault", folders: "vault", docs: "vault", uploads: "vault", cloudfiles: "vault",
  chat: "campfire",
  calendar: "schedule", events: "schedule",
  board: "cardtable", cards: "cardtable", columns: "cardtable",
}
export const WINDOW_SEGMENT_NAMES = Object.keys(WINDOW_SEGMENTS)
/** Which type of window a path belongs to: "/projects/2/docs/5" → "vault"; null for anything else. Which window of that
 * type it is comes from its ?w= or the recording it shows (see windowIdOf). */
export const windowOfPath = (path: string): ToolType | null => {
  const m = /^\/projects\/\d+\/([^/?#]+)/.exec(path)
  return (m && WINDOW_SEGMENTS[m[1]!]) || null
}

export const defaultTools = (): Tool[] => [
  { id: "message_board", type: "message_board", name: "Posts", enabled: true },
  { id: "todos", type: "todos", name: "Compass", enabled: true },
  { id: "vault", type: "vault", name: "Files", enabled: true },
  { id: "campfire", type: "campfire", name: "Chat", enabled: true },
  { id: "schedule", type: "schedule", name: "Calendar", enabled: true },
  { id: "cardtable", type: "cardtable", name: "Board", enabled: false },
]

type ProjectRef = Pick<Project, "id" | "kind">
export const toolName = (p: Pick<Project, "tools">, t: ToolType) => (p.tools.find((x) => x.id === t) ?? p.tools.find((x) => x.type === t))?.name ?? defaultTools().find((x) => x.type === t)!.name
export const toolUrl = (p: ProjectRef | number, t: ToolType) => `/projects/${typeof p === "number" ? p : p.id}/${TOOL_PATHS[t]}`
export const projectUrl = (p: ProjectRef | number) => {
  if (typeof p !== "number" && p.kind === "ping") return `/chats/${p.id}`
  return `/projects/${typeof p === "number" ? p : p.id}`
}

/** Which tool a recording type lives in (for breadcrumbs). */
export const TYPE_TOOL: Record<string, ToolType> = {
  message: "message_board",
  todo: "todos",
  folder: "vault", doc: "vault", upload: "vault", cloudfile: "vault",
  line: "campfire",
  event: "schedule",
  column: "cardtable", card: "cardtable", step: "cardtable",
}

/** A window's start page: the first of its type at the plain address, a copy with ?w= its id. */
export const windowQuery = (t: Pick<Tool, "id" | "type">) => (t.id === t.type ? "" : `?w=${encodeURIComponent(t.id)}`)
export const windowUrl = (p: ProjectRef | number, t: Pick<Tool, "id" | "type">) => toolUrl(p, t.type) + windowQuery(t)
/** Which window a top-level recording is in: the copy named in its `data.tool` while the project still has it, else the
 * first of its type. Children are in their top-level ancestor's window. */
export const windowIdOf = (p: Pick<Project, "tools">, top: Pick<Recording, "type" | "data">): string | null => {
  const type = TYPE_TOOL[top.type]
  const id = top.data?.tool
  return id && p.tools.some((t) => t.id === id && t.type === type) ? String(id) : type ?? null
}

export const TYPE_NAMES: Record<string, string> = {
  message: "post", todo: "goal", folder: "folder", doc: "doc",
  upload: "file", cloudfile: "link", event: "event", column: "column",
  card: "card", step: "step", line: "chat line", comment: "comment",
}

/** Where a recording lives. Groups, steps, columns, lines and comments point into their parent's page. */
export const urlFor = (r: Pick<Recording, "id" | "type" | "project_id" | "parent_id">): string => {
  const p = `/projects/${r.project_id}`
  switch (r.type) {
    case "message": return `${p}/posts/${r.id}`
    case "todo": return `${p}/tasks/${r.id}`
    case "folder": return `${p}/folders/${r.id}`
    case "doc": return `${p}/docs/${r.id}`
    case "upload": return `${p}/uploads/${r.id}`
    case "cloudfile": return `${p}/cloudfiles/${r.id}`
    case "event": return `${p}/events/${r.id}`
    case "column": return `${p}/board#column-${r.id}`
    case "card": return `${p}/cards/${r.id}`
    case "step": return `${p}/cards/${r.parent_id}#step-${r.id}`
    case "line": return `/r/${r.id}/line`
    case "comment": return `/r/${r.parent_id}/go#comment-${r.id}`
    default: return `/r/${r.id}/go`
  }
}

export const titleOf = (r: Pick<Recording, "type" | "title" | "body">) =>
  r.title || (r.body ? r.body.replace(/\s+/g, " ").slice(0, 60) : `Untitled ${TYPE_NAMES[r.type] ?? r.type}`)

/** Types a client sees whenever they see the parent (the flag on the child doesn't matter). */
export const CLIENT_INHERITS = ["comment", "line", "step", "column"]

// ---------- people & access ----------
type Who = Pick<Person, "role">
export const isAdmin = (p: Who) => p.role === "owner" || p.role === "admin"
export const isClient = (p: Who) => p.role === "client"
/** Can this person invite people (and see the team link)? */
export const mayInvite = (p: Who, a: Pick<Account, "settings">) => !isClient(p) && (a.settings.who_can_invite !== "admins" || isAdmin(p))

/** Work Can Wait: true when notifications should be held for this person right now. */
export const isQuiet = (p: Pick<Person, "prefs" | "time_zone">, now = new Date()) => {
  if (p.prefs.snooze_until && new Date(p.prefs.snooze_until) > now) return true
  const w = p.prefs.wcw
  if (!w?.on) return false
  const local = new Date(now.toLocaleString("en-US", { timeZone: p.time_zone }))
  const hhmm = local.toTimeString().slice(0, 5)
  const workDay = (w.days ?? [1, 2, 3, 4, 5]).includes(local.getDay())
  return !(workDay && hhmm >= (w.start ?? "09:00") && hhmm < (w.end ?? "17:00"))
}

export const isOutOfOffice = (p: Pick<Person, "prefs">, day = new Date().toISOString().slice(0, 10)) =>
  !!p.prefs.ooo?.until && (p.prefs.ooo.from ?? "") <= day && day <= p.prefs.ooo.until

/** Can `me` see project `p`? Members always; non-clients on all-access projects; admins on everything but pings. */
export const canSeeProject = (me: Pick<Person, "id" | "account_id" | "role">, p: Pick<Project, "account_id" | "all_access" | "kind">, memberIds: ReadonlyArray<number>) =>
  p.account_id === me.account_id && (memberIds.includes(me.id) || (p.all_access && !isClient(me)) || (isAdmin(me) && p.kind !== "ping"))

/** People @mentioned in `text` (by first name or full name, no spaces), limited to `pool`. */
export const mentionedIds = (text: string, pool: ReadonlyArray<Pick<Person, "id" | "name">>) => {
  const handles = new Set([...text.matchAll(/(?:^|\s)@(\w+)/g)].map((m) => m[1]!.toLowerCase()))
  return pool.filter((p) => handles.has(p.name.split(" ")[0]!.toLowerCase()) || handles.has(p.name.replace(/\s+/g, "").toLowerCase())).map((p) => p.id)
}
