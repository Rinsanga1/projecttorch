// The domain rules both sides need: synced row types, tool and type tables, URLs, titles, roles and access.
// Rows here are as the browser holds them: timestamps are ISO strings, dates are YYYY-MM-DD, jsonb is parsed.
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
  google?: boolean
  campfire_notify?: Record<string, "everything" | "mentions">
  recent_pages?: { href: string; title: string }[]
  recent_projects?: number[]
  /** Project id → when this person last opened it (ISO). The project page counts what's new since. */
  project_seen?: Record<string, string>
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
  }
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

export type Tool = { type: ToolType; name: string; enabled: boolean }
export type ToolType = "message_board" | "todos" | "vault" | "campfire" | "schedule" | "checkins" | "cardtable" | "forwards" | "timesheet"

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
  trashed_at: Stamp | null
  starts_on: string | null
  ends_on: string | null
  tools: Tool[]
  email_token: string | null
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
  created_at: Stamp
  updated_at: Stamp
}

export type ProjectPerson = { project_id: number; person_id: number; added_at: Stamp }
export type Pin = { person_id: number; project_id: number }
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
  action: string; summary: string; created_at: Stamp
}
export type Category = { id: number; account_id: number; emoji: string; name: string }
export type Marker = { id: number; account_id: number; name: string; on_date: string }
export type HillUpdate = { id: number; project_id: number; person_id: number | null; positions: Record<string, number>; note: string | null; created_at: Stamp }
export type GaugeUpdate = { id: number; project_id: number; person_id: number | null; value: number; note: string | null; created_at: Stamp }
export type TimeEntry = {
  id: number; account_id: number; project_id: number; recording_id: number | null; person_id: number | null
  on_date: string; minutes: number; description: string; created_at: Stamp
}
/** `token` only arrives for people who aren't clients. */
export type Chatbot = { id: number; account_id: number; name: string; command_url: string | null; token: string | null; created_at: Stamp }
export type Webhook = { id: number; project_id: number; url: string; types: string[]; created_at: Stamp }
export type PublicLink = { token: string; recording_id: number; created_at: Stamp }
export type Export = { id: number; account_id: number; person_id: number | null; status: "pending" | "ready"; file_path: string | null; created_at: Stamp }
export type ConnectedApp = { id: number; person_id: number; name: string; created_at: Stamp }

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
  hill_updates: HillUpdate
  gauge_updates: GaugeUpdate
  time_entries: TimeEntry
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
  hill_updates: ["id"], gauge_updates: ["id"], time_entries: ["id"], chatbots: ["id"], webhooks: ["id"],
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
  checkins: "questions",
  cardtable: "board",
  forwards: "forwards",
  timesheet: "timesheet",
}

export const defaultTools = (): Tool[] => [
  { type: "message_board", name: "Posts", enabled: true },
  { type: "todos", name: "Tasks", enabled: true },
  { type: "vault", name: "Files", enabled: true },
  { type: "campfire", name: "Chat", enabled: true },
  { type: "schedule", name: "Calendar", enabled: true },
  { type: "checkins", name: "Team questions", enabled: true },
  { type: "cardtable", name: "Board", enabled: false },
  { type: "forwards", name: "Forwarded emails", enabled: false },
  { type: "timesheet", name: "Timesheet", enabled: false },
]

type ProjectRef = Pick<Project, "id" | "kind">
export const toolName = (p: Pick<Project, "tools">, t: ToolType) => p.tools.find((x) => x.type === t)?.name ?? defaultTools().find((x) => x.type === t)!.name
export const toolUrl = (p: ProjectRef | number, t: ToolType) => `/projects/${typeof p === "number" ? p : p.id}/${TOOL_PATHS[t]}`
export const projectUrl = (p: ProjectRef | number) => {
  if (typeof p !== "number" && p.kind === "ping") return `/chats/${p.id}`
  return `/projects/${typeof p === "number" ? p : p.id}`
}

/** Which tool a recording type lives in (for breadcrumbs). */
export const TYPE_TOOL: Record<string, ToolType> = {
  message: "message_board",
  todolist: "todos", todogroup: "todos", todo: "todos",
  folder: "vault", doc: "vault", upload: "vault", cloudfile: "vault",
  line: "campfire",
  event: "schedule",
  question: "checkins", answer: "checkins",
  column: "cardtable", card: "cardtable", step: "cardtable",
  forward: "forwards",
}

export const TYPE_NAMES: Record<string, string> = {
  message: "post", todolist: "task list", todogroup: "group", todo: "task", folder: "folder", doc: "doc",
  upload: "file", cloudfile: "link", event: "event", question: "question", answer: "answer", column: "column",
  card: "card", step: "step", forward: "forwarded email", door: "link", line: "chat line", comment: "comment",
}

/** Where a recording lives. Groups, steps, columns, lines and comments point into their parent's page. */
export const urlFor = (r: Pick<Recording, "id" | "type" | "project_id" | "parent_id">): string => {
  const p = `/projects/${r.project_id}`
  switch (r.type) {
    case "message": return `${p}/posts/${r.id}`
    case "todolist": return `${p}/lists/${r.id}`
    case "todogroup": return `${p}/lists/${r.parent_id}#group-${r.id}`
    case "todo": return `${p}/tasks/${r.id}`
    case "folder": return `${p}/folders/${r.id}`
    case "doc": return `${p}/docs/${r.id}`
    case "upload": return `${p}/uploads/${r.id}`
    case "cloudfile": return `${p}/cloudfiles/${r.id}`
    case "event": return `${p}/events/${r.id}`
    case "question": return `${p}/questions/${r.id}`
    case "answer": return `${p}/answers/${r.id}`
    case "column": return `${p}/board#column-${r.id}`
    case "card": return `${p}/cards/${r.id}`
    case "step": return `${p}/cards/${r.parent_id}#step-${r.id}`
    case "forward": return `${p}/forwards/${r.id}`
    case "door": return `${p}/links/${r.id}`
    case "line": return `/r/${r.id}/line`
    case "comment": return `/r/${r.parent_id}/go#comment-${r.id}`
    default: return `/r/${r.id}/go`
  }
}

export const titleOf = (r: Pick<Recording, "type" | "title" | "body">) =>
  r.title || (r.body ? r.body.replace(/\s+/g, " ").slice(0, 60) : `Untitled ${TYPE_NAMES[r.type] ?? r.type}`)

/** Types a client sees whenever they see the parent (the flag on the child doesn't matter). */
export const CLIENT_INHERITS = ["comment", "line", "step", "todogroup", "answer", "column"]

// ---------- people & access ----------
type Who = Pick<Person, "role">
export const isAdmin = (p: Who) => p.role === "owner" || p.role === "admin"
export const isClient = (p: Who) => p.role === "client"

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
