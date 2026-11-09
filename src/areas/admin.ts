// Admin: account owners and admins only. Billing, roles and cancelling are owners only.
// Pages: client/areas/admin.tsx. This file is what their forms post to, the export download, and JSON for what isn't synced.
//
//   POST /admin/account                          name and logo                       (admins)
//   POST /admin/roles                            make someone an admin or owner      (owners)
//   POST /admin/roles/:id/remove                                                     (owners)
//   POST /admin/people/:id                       role and company                    (admins; only owners touch owners)
//   POST /admin/people/:id/remove                take someone out of the account     (admins)
//   POST /admin/permissions                      who can make projects, invite, Ping (admins)
//   GET  /admin/billing/storage                  bytes used                          (owners)
//   POST /admin/billing/plan | card | decline | contact | reactivate                 (owners)
//   POST /admin/export                           start an export                     (admins)
//   GET  /admin/export/:id/download                                                  (admins)
//   POST /admin/projects/:id/restore             bring back an archived or trashed project (admins)
//   GET  /admin/integrations/apps                every connected app in the account  (admins)
//   POST /admin/integrations/apps/:id/disconnect                                     (admins)
//   GET  /admin/security/missing                 who hasn't set up two-step          (admins)
//   POST /admin/security                         require two-step or not             (admins)
//   POST /admin/cancel                           cancel the account                  (owners)
//
// Every account always has at least one owner: each way of losing one checks ownerCount first.
// Job, every minute: build pending exports.

import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdirSync } from "node:fs"
import { get, post, redirect, invalid, json, str, isAdmin, NoAccess, NotFound, type Ctx, type Person } from "../lib/web.ts"
import { sendEmail, logEvent, projectUrl, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DAY   = 86_400_000

// ponytail: illustrative plans, no real payment processor. Prices live with the page (client/areas/admin.tsx).
const PLANS = { standard: { name: "ProjectTorch" }, pro_unlimited: { name: "ProjectTorch Unlimited" } } as const
type PlanKey = keyof typeof PLANS

// ─── Who may ───────────────────────────────────────────────────────────────

const isOwner      = (p: Pick<Person, "role">) => p.role === "owner"
const requireAdmin = (c: Ctx) => (isAdmin(c.me) ? Effect.void : Effect.fail(new NoAccess()))
const requireOwner = (c: Ctx) => (isOwner(c.me) ? Effect.void : Effect.fail(new NoAccess()))

const ownerCount = (accountId: number) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ n: number }>`select count(*)::int as n from people
                                          where account_id = ${accountId} and role = 'owner' and removed_at is null and joined_at is not null`
  return row!.n
})

/** Is `p` the account's only owner? Then they can't stop being one. */
const isLastOwner = (c: Ctx, p: Person) => Effect.gen(function* () {
  if (!isOwner(p)) return false
  return (yield* ownerCount(c.me.account_id)) <= 1
})

/** The person being managed (:id), in this account. Admins can't touch owners. */
const managed = (c: Ctx) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [p] = yield* sql<Person>`select * from people where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} and removed_at is null`
  if (!p) return yield* new NotFound()
  if (isOwner(p) && !isOwner(c.me)) return yield* new NoAccess()
  return p
})

/** Days left to reactivate a cancelled account (30 from cancelling). */
const daysLeft = (cancelledAt: Date | null) => {
  const since = Date.now() - new Date(cancelledAt ?? Date.now()).getTime()
  return Math.max(0, 30 - Math.floor(since / DAY))
}

// ─── Job: exports ──────────────────────────────────────────────────────────

/** Turn pending exports into a JSON file and email whoever asked. */
const buildExports = Effect.gen(function* () {
  const sql     = yield* SqlClient.SqlClient
  const pending = yield* sql<{ id: number; account_id: number; person_id: number | null }>`select * from exports where status = 'pending' order by id`

  for (const e of pending) {
    // ponytail: one JSON file with the database rows, no uploaded files. Zip in the files when someone needs them.
    const dump = {
      account:    (yield* sql`select * from accounts where id = ${e.account_id}`)[0],
      people:     yield* sql`select id, name, email, title, role, company_id, created_at from people where account_id = ${e.account_id}`,
      projects:   yield* sql`select * from projects where account_id = ${e.account_id}`,
      recordings: yield* sql`select * from recordings where account_id = ${e.account_id}`,
    }
    mkdirSync("storage/exports", { recursive: true })
    const path = `storage/exports/${e.id}.json`
    yield* Effect.promise(() => Bun.write(path, JSON.stringify(dump, null, 2)))
    yield* sql`update exports set status = 'ready', file_path = ${path} where id = ${e.id}`

    if (!e.person_id) continue
    const [who] = yield* sql<Person>`select * from people where id = ${e.person_id}`
    if (who) yield* sendEmail(who, { subject: "Your export is ready", body: "Everything in your account is ready to download.", kind: "export", link: `/api/admin/export/${e.id}/download` }, true)
  }
})

export const jobs = [buildExports]

// ─── Account ───────────────────────────────────────────────────────────────

const saveAccount = post("/admin/account", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql  = yield* SqlClient.SqlClient
  const fd   = yield* c.form
  const name = str(fd, "name")
  const logo = str(fd, "logo_url")

  const errors: string[] = []
  if (!name)                                errors.push("Your account needs a name.")
  if (logo && !/^https?:\/\//.test(logo))   errors.push("The logo has to be a link to an image (https://…).")
  if (errors.length) return invalid(errors)

  yield* sql`update accounts set name = ${name}, logo_url = ${logo || null} where id = ${c.me.account_id}`
  return redirect("/admin/account", "Saved.")
}))

// ─── Roles ─────────────────────────────────────────────────────────────────

const grantRole = post("/admin/roles", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql  = yield* SqlClient.SqlClient
  const fd   = yield* c.form
  const role = str(fd, "role") === "owner" ? "owner" : "admin"

  const [p] = yield* sql<Person>`select * from people where id = ${Number(str(fd, "person_id")) || 0} and account_id = ${c.me.account_id}
                                 and removed_at is null and joined_at is not null`
  if (!p)                  return yield* new NotFound()
  if (p.role === "client") return redirect("/admin/roles", "Clients can't be admins or owners.")

  yield* sql`update people set role = ${role} where id = ${p.id}`
  return redirect("/admin/roles", `${p.name} is now ${role === "owner" ? "an owner" : "an admin"}.`)
}))

const revokeRole = post("/admin/roles/:id/remove", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql = yield* SqlClient.SqlClient
  const p   = yield* managed(c)
  if (yield* isLastOwner(c, p)) return redirect("/admin/roles", "Every account needs at least one owner.")

  yield* sql`update people set role = 'member' where id = ${p.id}`
  return redirect("/admin/roles", `${p.name} isn't ${isOwner(p) ? "an owner" : "an admin"} anymore.`)
}))

// ─── People ────────────────────────────────────────────────────────────────

// Role (owners can also make owners) and company: one picked from this account, or a new one.
const savePerson = post("/admin/people/:id", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const p   = yield* managed(c)
  const fd  = yield* c.form

  const allowed = isOwner(c.me) ? ["member", "client", "admin", "owner"] : ["member", "client", "admin"]
  const role    = allowed.includes(str(fd, "role")) ? str(fd, "role") : p.role
  if (role !== "owner" && (yield* isLastOwner(c, p))) return redirect(`/admin/people/${p.id}`, "Every account needs at least one owner.")

  let companyId: number | null = Number(str(fd, "company_id")) || null
  if (companyId) {
    const [inAccount] = yield* sql`select 1 from companies where id = ${companyId} and account_id = ${c.me.account_id}`
    if (!inAccount) companyId = null
  }
  const newCompany = str(fd, "new_company")
  if (newCompany) companyId = (yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: c.me.account_id, name: newCompany })} returning id`)[0]!.id

  yield* sql`update people set role = ${role}, company_id = ${companyId} where id = ${p.id}`
  return redirect("/admin/people", `Saved ${p.name}.`)
}))

// They stop being able to sign in (loadMe skips removed people), and come off every project and pin.
const removePerson = post("/admin/people/:id/remove", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const p   = yield* managed(c)
  if (p.id === c.me.id)          return redirect(`/admin/people/${p.id}`, "You can't remove yourself. Ask another admin.")
  if (yield* isLastOwner(c, p)) return redirect(`/admin/people/${p.id}`, "Every account needs at least one owner.")

  yield* sql.withTransaction(Effect.gen(function* () {
    yield* sql`update people set removed_at = now() where id = ${p.id}`
    yield* sql`delete from project_people where person_id = ${p.id}`
    yield* sql`delete from pins where person_id = ${p.id}`
  }))
  yield* logEvent(c, { project_id: null, action: "removed", summary: `removed ${p.name} from the account` })
  return redirect("/admin/people", `Removed ${p.name}.`)
}))

const savePermissions = post("/admin/permissions", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const fd  = yield* c.form
  const settings = {
    ...c.account.settings,
    who_can_create_projects: str(fd, "who_can_create_projects") === "admins" ? "admins" : "everyone",
    who_can_invite:          str(fd, "who_can_invite")          === "admins" ? "admins" : "everyone",
    clients_can_ping:        fd.get("clients_can_ping") === "on",
  }
  yield* sql`update accounts set settings = ${JSON.stringify(settings)} where id = ${c.me.account_id}`
  return redirect("/admin/permissions", "Saved.")
}))

// ─── Plan & billing (owners) ───────────────────────────────────────────────

// Storage counts every upload in the account (private chats too), so it comes from here, not the synced copy.
const storageUsed = get("/admin/billing/storage", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql = yield* SqlClient.SqlClient
  const [storage] = yield* sql<{ bytes: number }>`select coalesce(sum((data->>'size')::bigint), 0)::float8 as bytes from recordings
                                                  where account_id = ${c.me.account_id} and type = 'upload'`
  return json({ bytes: storage!.bytes })
}))

const changePlan = post("/admin/billing/plan", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql  = yield* SqlClient.SqlClient
  const plan = str(yield* c.form, "plan")
  if (!(plan in PLANS)) return redirect("/admin/billing", "Pick a plan.")

  yield* sql`update accounts set plan = ${plan} where id = ${c.me.account_id}`
  return redirect("/admin/billing", `You're on ${PLANS[plan as PlanKey].name} now.`)
}))

// Only the last four digits are kept. A card brings an on-hold account back; a cancelled one stays cancelled.
const updateCard = post("/admin/billing/card", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql    = yield* SqlClient.SqlClient
  const digits = str(yield* c.form, "card").replace(/\D/g, "")
  if (digits.length < 12 || digits.length > 19) return redirect("/admin/billing", "That card number doesn't look right. Check it and try again.")

  yield* sql`update accounts set card_last4 = ${digits.slice(-4)}, status = case when status = 'cancelled' then status else 'active' end
             where id = ${c.me.account_id}`
  return redirect("/admin/billing", "Card updated. Thanks!")
}))

// Pretend the card was declined: the account goes on hold.
const declineCard = post("/admin/billing/decline", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql = yield* SqlClient.SqlClient
  yield* sql`update accounts set status = 'on_hold' where id = ${c.me.account_id} and status <> 'cancelled'`
  return redirect("/lockout")
}))

const saveBillingContact = post("/admin/billing/contact", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql   = yield* SqlClient.SqlClient
  const email = str(yield* c.form, "billing_email")
  if (!EMAIL.test(email)) return redirect("/admin/billing", "That doesn't look like an email address.")

  yield* sql`update accounts set billing_email = ${email} where id = ${c.me.account_id}`
  return redirect("/admin/billing", "Saved.")
}))

const reactivate = post("/admin/billing/reactivate", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql     = yield* SqlClient.SqlClient
  const account = c.account
  if (account.status === "cancelled" && daysLeft(account.cancelled_at) === 0)
    return redirect("/admin/billing", "It's been more than 30 days, so this account can't be reactivated.")

  yield* sql`update accounts set status = 'active', cancelled_at = null where id = ${account.id}`
  return redirect("/", "Welcome back! Everything is right where you left it.")
}))

// ─── Export ────────────────────────────────────────────────────────────────

// The job above builds it within a minute and emails a link.
const startExport = post("/admin/export", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  yield* sql`insert into exports ${sql.insert({ account_id: c.me.account_id, person_id: c.me.id })}`
  return redirect("/admin/export", "Export started. We'll email you when it's ready.")
}))

const downloadExport = get("/admin/export/:id/download", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const [e] = yield* sql<{ id: number; file_path: string | null }>`select * from exports
                                                                   where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} and status = 'ready'`
  if (!e?.file_path) return yield* new NotFound()

  const file = Bun.file(e.file_path)
  if (!(yield* Effect.promise(() => file.exists()))) return yield* new NotFound()
  const body = yield* Effect.promise(() => file.bytes())
  return HttpServerResponse.uint8Array(body, { contentType: "application/json", headers: { "content-disposition": `attachment; filename="export-${e.id}.json"` } })
}))

// ─── Projects, integrations, security ──────────────────────────────────────

const restoreProject = post("/admin/projects/:id/restore", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const [p] = yield* sql<Project>`update projects set status = 'active', trashed_at = null
                                  where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} returning *`
  if (!p) return yield* new NotFound()

  yield* logEvent(c, { project_id: p.id, action: "restored", summary: `put the project ${p.name} back` })
  return redirect("/admin/projects", { msg: `${p.name} is back.`, href: projectUrl(p), label: "Go there" })
}))

// Connected apps only sync to the person who connected them, so the account's list comes from here.
const connectedApps = get("/admin/integrations/apps", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  return json(yield* sql<{ id: number; name: string; person: string; created_at: Date }>`
    select a.id, a.name, p.name as person, a.created_at from connected_apps a join people p on p.id = a.person_id
    where p.account_id = ${c.me.account_id} order by a.name`)
}))

const disconnectApp = post("/admin/integrations/apps/:id/disconnect", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const removed = yield* sql`delete from connected_apps a using people p
                             where a.id = ${Number(c.params.id) || 0} and p.id = a.person_id and p.account_id = ${c.me.account_id} returning a.id`
  if (!removed.length) return yield* new NotFound()
  return redirect("/admin/integrations", "Disconnected.")
}))

// Other people's two_factor pref doesn't sync, so who hasn't set it up comes from here.
const missingTwoFactor = get("/admin/security/missing", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  return json(yield* sql<{ id: number; name: string }>`
    select p.id, p.name from people p left join companies k on k.id = p.company_id
    where p.account_id = ${c.me.account_id} and p.removed_at is null and p.joined_at is not null
      and coalesce((p.prefs->>'two_factor')::boolean, false) = false
    order by k.name nulls first, p.name`)
}))

const saveSecurity = post("/admin/security", (c) => Effect.gen(function* () {
  yield* requireAdmin(c)
  const sql = yield* SqlClient.SqlClient
  const on  = (yield* c.form).get("require_2fa") === "on"

  yield* sql`update accounts set settings = settings || ${JSON.stringify({ require_2fa: on })}::jsonb where id = ${c.me.account_id}`
  if (on) return redirect("/admin/security", "Two-step verification is required now.")
  return redirect("/admin/security", "Two-step verification is optional now.")
}))

// ─── Cancel (owners) ───────────────────────────────────────────────────────

// Nothing is deleted: the account locks, and an owner can reactivate it for 30 days.
const cancelAccount = post("/admin/cancel", (c) => Effect.gen(function* () {
  yield* requireOwner(c)
  const sql = yield* SqlClient.SqlClient
  yield* sql`update accounts set status = 'cancelled', cancelled_at = now() where id = ${c.me.account_id}`
  yield* logEvent(c, { project_id: null, action: "cancelled", summary: "cancelled the account" })
  return redirect("/lockout", "Your account is cancelled. You can reactivate it for 30 days.")
}))

export const routes = [
  saveAccount,
  grantRole,
  revokeRole,
  savePerson,
  removePerson,
  savePermissions,
  storageUsed,
  changePlan,
  updateCard,
  declineCard,
  saveBillingContact,
  reactivate,
  startExport,
  downloadExport,
  restoreProject,
  connectedApps,
  disconnectApp,
  missingTwoFactor,
  saveSecurity,
  cancelAccount,
]

// ─── Sample data ───────────────────────────────────────────────────────────

// Ann has a connected app, and Maya has an export from last week.
export const seed = (s: Seed) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`insert into connected_apps ${sql.insert({ person_id: s.people.ann.id, name: "Calendar Sync" })}`

  const [e] = yield* sql<{ id: number }>`insert into exports ${sql.insert({ account_id: s.account.id, person_id: s.people.maya.id, status: "ready" })} returning id`
  mkdirSync("storage/exports", { recursive: true })
  const path = `storage/exports/${e!.id}.json`
  yield* Effect.promise(() => Bun.write(path, JSON.stringify({ account: s.account.name, note: "Sample export from the seed data." }, null, 2)))
  yield* sql`update exports set file_path = ${path}, created_at = now() - interval '7 days' where id = ${e!.id}`
})
