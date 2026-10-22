// Reads over the local copy: the client side of src/lib/core.ts. Everything here is synchronous and observable,
// so a page wrapped in `observer` re-renders when the rows it read change. The copy only ever holds what this
// person may see (the server decides), so these don't re-check access, except where the old pages did (trash, drafts).
import { useEffect, useState } from "react"
import { db, state, submit } from "./store.ts"
import { CLIENT_INHERITS, canSeeProject, isAdmin, isClient, type Account, type Person, type Project, type Recording } from "../shared/domain.ts"

// ---------- errors (rendered by the route's error page, see ui/page.tsx) ----------
export class NotFound extends Error { readonly _tag = "NotFound" }
export class NoAccess extends Error { readonly _tag = "NoAccess" }
export class Deleted extends Error { readonly _tag = "Deleted" }

// ---------- who's acting ----------
/** The signed-in person. Pages only render signed in (the layout sends everyone else to /signin). */
export const me = (): Person => {
  const p = state.meId === null ? undefined : db.people.get(String(state.meId))
  if (!p) throw new NoAccess()
  return p
}
export const meOrNull = (): Person | null => (state.meId === null ? null : db.people.get(String(state.meId)) ?? null)
export const account = (): Account => {
  const a = db.accounts.get(String(me().account_id))
  if (!a) throw new NoAccess()
  return a
}

// ---------- people ----------
export type PersonWithCompany = Person & { company_name: string | null }
const withCompany = (p: Person): PersonWithCompany => ({ ...p, company_name: p.company_id ? db.companies.get(String(p.company_id))?.name ?? null : null })
const byCompanyThenName = (a: PersonWithCompany, b: PersonWithCompany) =>
  a.company_name === b.company_name ? a.name.localeCompare(b.name) : a.company_name === null ? -1 : b.company_name === null ? 1 : a.company_name.localeCompare(b.company_name)

export const personById = (id: number | null | undefined): Person | null => (id ? db.people.get(String(id)) ?? null : null)

/** People who've joined and haven't been removed, grouped by company. */
export const accountPeople = (opts: { includeClients?: boolean } = {}) =>
  [...db.people.values()]
    .filter((p) => p.account_id === me().account_id && !p.removed_at && p.joined_at && (opts.includeClients !== false || !isClient(p)))
    .map(withCompany)
    .sort(byCompanyThenName)

export const memberIds = (projectId: number) => [...db.project_people.values()].filter((pp) => pp.project_id === projectId).map((pp) => pp.person_id)

/** Everyone who can see a project: members, plus all non-clients when it's all-access. */
export const projectPeople = (p: Pick<Project, "id" | "all_access" | "account_id">) => {
  const members = new Set(memberIds(p.id))
  return [...db.people.values()]
    .filter((x) => x.account_id === p.account_id && !x.removed_at && x.joined_at && (members.has(x.id) || (p.all_access && !isClient(x))))
    .map(withCompany)
    .sort(byCompanyThenName)
}

export const peopleByIds = (ids: ReadonlyArray<number>) =>
  ids.map((id) => db.people.get(String(id))).filter((p): p is Person => !!p).sort((a, b) => a.name.localeCompare(b.name))

// ---------- projects ----------
export type ProjectRow = Project & { member_names: string | null; pinned: boolean }

/** Projects this person can see, by status and kind; HQ first, then by name. Mirrors core.ts visibleProjects. */
export const visibleProjects = (opts: { status?: Project["status"]; kind?: Project["kind"] } = {}): ProjectRow[] => {
  const m = me()
  return [...db.projects.values()]
    .filter((p) => p.status === (opts.status ?? "active") && p.kind === (opts.kind ?? "project") && canSeeProject(m, p, memberIds(p.id)))
    .map((p) => ({
      ...p,
      member_names: peopleByIds(memberIds(p.id)).filter((x) => !x.removed_at).map((x) => x.name).join(", ") || null,
      pinned: db.pins.has(`${m.id}:${p.id}`),
    }))
    .sort((a, b) => Number(b.is_hq) - Number(a.is_hq) || a.name.localeCompare(b.name))
}

/** A project this person can see, or throw NotFound. Trashed projects only for admins unless `allowTrashed`. */
export const findProject = (id: number | string | undefined, opts: { allowTrashed?: boolean } = {}): Project => {
  const p = db.projects.get(String(Number(id) || 0))
  if (!p) throw new NotFound()
  if (p.status === "trashed" && !opts.allowTrashed && !isAdmin(me())) throw new NotFound()
  return p
}

export const canCreateProjects = () => !isClient(me()) && (account().settings.who_can_create_projects !== "admins" || isAdmin(me()))
export const canInvite = () => !isClient(me()) && (account().settings.who_can_invite !== "admins" || isAdmin(me()))

// ---------- recordings ----------
const recs = () => [...db.recordings.values()]
const byPosition = (a: Recording, b: Recording) => a.position - b.position || a.id - b.id

/** A recording this person can see, and its project. Missing = Deleted (or never yours); wrong type = NotFound. */
export const findRecording = (id: number | string | undefined, type?: string | ReadonlyArray<string>) => {
  const r = db.recordings.get(String(Number(id) || 0))
  if (!r) throw new Deleted()
  const types = type === undefined ? null : typeof type === "string" ? [type] : type
  if (types && !types.includes(r.type)) throw new NotFound()
  if (r.status === "drafted" && r.creator_id !== me().id) throw new NotFound()
  return { r, project: findProject(r.project_id, { allowTrashed: true }) }
}

/** Children of a recording, by position. */
export const children = (parentId: number, type?: string, status: Recording["status"] = "active") =>
  recs().filter((r) => r.parent_id === parentId && r.status === status && (!type || r.type === type)).sort(byPosition)

/** Top-level recordings of a type in a project (e.g. all posts). */
export const topLevel = (projectId: number, type: string, status: Recording["status"] = "active") =>
  recs().filter((r) => r.project_id === projectId && r.type === type && r.parent_id === null && r.status === status).sort(byPosition)

/** Every recording matching `f` (use for anything the helpers above don't cover). */
export const recordings = (f: (r: Recording) => boolean) => recs().filter(f)

export const comments = (recordingId: number) =>
  recs().filter((r) => r.parent_id === recordingId && r.type === "comment" && r.status === "active").sort((a, b) => a.created_at.localeCompare(b.created_at))
export const commentCount = (recordingId: number) => comments(recordingId).length

export const subscriberIds = (recordingId: number) => [...db.subscriptions.values()].filter((s) => s.recording_id === recordingId).map((s) => s.person_id)

export const boostsOn = (recordingId: number) => [...db.boosts.values()].filter((b) => b.recording_id === recordingId).sort((a, b) => a.id - b.id)

/** Would a client see this? The recording and every ancestor must be client-visible (some types inherit). */
export const clientVisible = (r: Recording): boolean =>
  (r.visible_to_clients || CLIENT_INHERITS.includes(r.type)) && (r.parent_id === null || (() => {
    const parent = db.recordings.get(String(r.parent_id))
    return !!parent && clientVisible(parent)
  })())

// ---------- server data that isn't in the copy ----------

/** GET a JSON reply from /api (history, the dev inbox, public links…). `data` is the reply's `data`. */
export const useApi = <T,>(path: string | null) => {
  const [res, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true })
  const [n, reload] = useState(0)
  useEffect(() => {
    if (!path) return
    let live = true
    set((r) => ({ ...r, loading: true }))
    fetch(`/api${path}`)
      .then(async (x) => {
        const body = await x.json()
        if (live) set(x.ok ? { data: body.data as T, loading: false } : { error: body.data?.error ?? body.errors?.[0] ?? `HTTP ${x.status}`, loading: false })
      })
      .catch(() => live && set({ error: "You're offline.", loading: false }))
    return () => { live = false }
  }, [path, n])
  return { ...res, reload: () => reload((x) => x + 1) }
}

/** Remember this page in the Jump menu and Home's "recently visited". */
export const useVisit = (href: string, title: string, projectId?: number) =>
  useEffect(() => {
    const fd = new FormData()
    fd.set("href", href)
    fd.set("title", title)
    if (projectId) fd.set("project_id", String(projectId))
    submit("/visits", fd).catch(() => {})
  }, [href, title, projectId])
