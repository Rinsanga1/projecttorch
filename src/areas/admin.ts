// Admin: account owners and admins only. Billing, roles and cancelling are owners only.
// The pages are client/areas/admin.tsx; these are their posts, the export download, and JSON for what isn't synced.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdirSync } from "node:fs"
import { get, post, redirect, invalid, json, str, isAdmin, NoAccess, NotFound, type Ctx, type Person } from "../lib/web.ts"
import { sendEmail, logEvent, projectUrl, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const isOwner = (p: Pick<Person, "role">) => p.role === "owner"
const requireAdmin = (c: Ctx) => (isAdmin(c.me) ? Effect.void : Effect.fail(new NoAccess()))
const requireOwner = (c: Ctx) => (isOwner(c.me) ? Effect.void : Effect.fail(new NoAccess()))

// ponytail: illustrative plans, no real payment processor. Prices live with the page (client/areas/admin.tsx).
const PLANS = { standard: { name: "ProjectTorch" }, pro_unlimited: { name: "ProjectTorch Unlimited" } } as const
type PlanKey = keyof typeof PLANS

const ownerCount = (accountId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ n: number }>`select count(*)::int as n from people where account_id = ${accountId} and role = 'owner' and removed_at is null and joined_at is not null`)[0]!.n
  })

/** The person being managed, in this account. Admins can't touch owners. */
const managed = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [p] = yield* sql<Person>`select * from people where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} and removed_at is null`
    if (!p) return yield* new NotFound()
    if (isOwner(p) && !isOwner(c.me)) return yield* new NoAccess()
    return p
  })

const daysLeft = (d: Date | null) => Math.max(0, 30 - Math.floor((Date.now() - new Date(d ?? Date.now()).getTime()) / 86_400_000))

// ---------- the export job ----------

/** Turn pending exports into a JSON file and email whoever asked. */
const buildExports = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const pending = yield* sql<{ id: number; account_id: number; person_id: number | null }>`select * from exports where status = 'pending' order by id`
  for (const e of pending) {
    const dump = {
      account: (yield* sql`select * from accounts where id = ${e.account_id}`)[0],
      people: yield* sql`select id, name, email, title, role, company_id, created_at from people where account_id = ${e.account_id}`,
      projects: yield* sql`select * from projects where account_id = ${e.account_id}`,
      recordings: yield* sql`select * from recordings where account_id = ${e.account_id}`,
    }
    // ponytail: one JSON file with the database rows, no uploaded files. Zip in the files when someone needs them.
    mkdirSync("storage/exports", { recursive: true })
    const path = `storage/exports/${e.id}.json`
    yield* Effect.promise(() => Bun.write(path, JSON.stringify(dump, null, 2)))
    yield* sql`update exports set status = 'ready', file_path = ${path} where id = ${e.id}`
    const [who] = e.person_id ? yield* sql<Person>`select * from people where id = ${e.person_id}` : []
    if (who) yield* sendEmail(who, { subject: "Your export is ready", body: "Everything in your account is ready to download.", kind: "export", link: `/api/admin/export/${e.id}/download` }, true)
  }
})

export const jobs = [buildExports]

// ---------- routes ----------

export const routes = [
  // Account name & logo
  post("/admin/account", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const name = str(fd, "name")
      const logo = str(fd, "logo_url")
      const errs = [...(name ? [] : ["Your account needs a name."]), ...(logo && !/^https?:\/\//.test(logo) ? ["The logo has to be a link to an image (https://…)."] : [])]
      if (errs.length) return invalid(errs)
      yield* sql`update accounts set name = ${name}, logo_url = ${logo || null} where id = ${c.me.account_id}`
      return redirect("/admin/account", "Saved.")
    })),

  // Administrators & owners
  post("/admin/roles", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const role = str(fd, "role") === "owner" ? "owner" : "admin"
      const [p] = yield* sql<Person>`select * from people where id = ${Number(str(fd, "person_id")) || 0} and account_id = ${c.me.account_id} and removed_at is null and joined_at is not null`
      if (!p) return yield* new NotFound()
      if (p.role === "client") return redirect("/admin/roles", "Clients can't be admins or owners.")
      yield* sql`update people set role = ${role} where id = ${p.id}`
      return redirect("/admin/roles", `${p.name} is now ${role === "owner" ? "an owner" : "an admin"}.`)
    })),

  post("/admin/roles/:id/remove", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const p = yield* managed(c)
      if (isOwner(p) && (yield* ownerCount(c.me.account_id)) <= 1) return redirect("/admin/roles", "Every account needs at least one owner.")
      yield* sql`update people set role = 'member' where id = ${p.id}`
      return redirect("/admin/roles", `${p.name} isn't ${isOwner(p) ? "an owner" : "an admin"} anymore.`)
    })),

  // Manage people
  post("/admin/people/:id", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const p = yield* managed(c)
      const fd = yield* c.form
      const allowed = isOwner(c.me) ? ["member", "client", "admin", "owner"] : ["member", "client", "admin"]
      const role = allowed.includes(str(fd, "role")) ? str(fd, "role") : p.role
      if (isOwner(p) && role !== "owner" && (yield* ownerCount(c.me.account_id)) <= 1) return redirect(`/admin/people/${p.id}`, "Every account needs at least one owner.")
      let companyId: number | null = Number(str(fd, "company_id")) || null
      if (companyId) {
        const [k] = yield* sql`select 1 from companies where id = ${companyId} and account_id = ${c.me.account_id}`
        if (!k) companyId = null
      }
      const newCompany = str(fd, "new_company")
      if (newCompany) companyId = (yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: c.me.account_id, name: newCompany })} returning id`)[0]!.id
      yield* sql`update people set role = ${role}, company_id = ${companyId} where id = ${p.id}`
      return redirect("/admin/people", `Saved ${p.name}.`)
    })),

  post("/admin/people/:id/remove", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const p = yield* managed(c)
      if (p.id === c.me.id) return redirect(`/admin/people/${p.id}`, "You can't remove yourself. Ask another admin.")
      if (isOwner(p) && (yield* ownerCount(c.me.account_id)) <= 1) return redirect(`/admin/people/${p.id}`, "Every account needs at least one owner.")
      yield* sql`update people set removed_at = now() where id = ${p.id}`
      yield* sql`delete from project_people where person_id = ${p.id}`
      yield* sql`delete from pins where person_id = ${p.id}`
      yield* logEvent(c, { project_id: null, action: "removed", summary: `removed ${p.name} from the account` })
      return redirect("/admin/people", `Removed ${p.name}.`)
    })),

  // Who can do what
  post("/admin/permissions", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const settings = {
        ...c.account.settings,
        who_can_create_projects: str(fd, "who_can_create_projects") === "admins" ? "admins" : "everyone",
        who_can_invite: str(fd, "who_can_invite") === "admins" ? "admins" : "everyone",
        clients_can_ping: fd.get("clients_can_ping") === "on",
      }
      yield* sql`update accounts set settings = ${JSON.stringify(settings)} where id = ${c.me.account_id}`
      return redirect("/admin/permissions", "Saved.")
    })),

  // Plan & billing (owners). Storage counts every upload in the account (private chats too), so it comes from here.
  get("/admin/billing/storage", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const [storage] = yield* sql<{ bytes: number }>`select coalesce(sum((data->>'size')::bigint), 0)::float8 as bytes from recordings where account_id = ${c.me.account_id} and type = 'upload'`
      return json({ bytes: storage!.bytes })
    })),

  post("/admin/billing/plan", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const p = str(yield* c.form, "plan")
      if (!(p in PLANS)) return redirect("/admin/billing", "Pick a plan.")
      yield* sql`update accounts set plan = ${p} where id = ${c.me.account_id}`
      return redirect("/admin/billing", `You're on ${PLANS[p as PlanKey].name} now.`)
    })),

  post("/admin/billing/card", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const digits = str(yield* c.form, "card").replace(/\D/g, "")
      if (digits.length < 12 || digits.length > 19) return redirect("/admin/billing", "That card number doesn't look right. Check it and try again.")
      yield* sql`update accounts set card_last4 = ${digits.slice(-4)}, status = case when status = 'cancelled' then status else 'active' end where id = ${c.me.account_id}`
      return redirect("/admin/billing", "Card updated. Thanks!")
    })),

  post("/admin/billing/decline", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`update accounts set status = 'on_hold' where id = ${c.me.account_id} and status <> 'cancelled'`
      return redirect("/lockout")
    })),

  post("/admin/billing/contact", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const email = str(yield* c.form, "billing_email")
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect("/admin/billing", "That doesn't look like an email address.")
      yield* sql`update accounts set billing_email = ${email} where id = ${c.me.account_id}`
      return redirect("/admin/billing", "Saved.")
    })),

  post("/admin/billing/reactivate", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const a = c.account
      if (a.status === "cancelled" && daysLeft(a.cancelled_at) === 0) return redirect("/admin/billing", "It's been more than 30 days, so this account can't be reactivated.")
      yield* sql`update accounts set status = 'active', cancelled_at = null where id = ${a.id}`
      return redirect("/", "Welcome back! Everything is right where you left it.")
    })),

  // Export your data
  post("/admin/export", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`insert into exports ${sql.insert({ account_id: c.me.account_id, person_id: c.me.id })}`
      return redirect("/admin/export", "Export started. We'll email you when it's ready.")
    })),

  get("/admin/export/:id/download", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const [e] = yield* sql<{ id: number; file_path: string | null }>`select * from exports where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} and status = 'ready'`
      if (!e?.file_path || !(yield* Effect.promise(() => Bun.file(e.file_path!).exists()))) return yield* new NotFound()
      const body = yield* Effect.promise(() => Bun.file(e.file_path!).bytes())
      return HttpServerResponse.uint8Array(body, { contentType: "application/json", headers: { "content-disposition": `attachment; filename="export-${e.id}.json"` } })
    })),

  // Archived & trashed projects
  post("/admin/projects/:id/restore", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const [p] = yield* sql<Project>`update projects set status = 'active', trashed_at = null where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} returning *`
      if (!p) return yield* new NotFound()
      yield* logEvent(c, { project_id: p.id, action: "restored", summary: `put the project ${p.name} back` })
      return redirect("/admin/projects", { msg: `${p.name} is back.`, href: projectUrl(p), label: "Go there" })
    })),

  // Integrations. Connected apps only sync to the person who connected them, so the account's list comes from here.
  get("/admin/integrations/apps", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      return json(yield* sql<{ id: number; name: string; person: string; created_at: Date }>`
        select a.id, a.name, p.name as person, a.created_at from connected_apps a join people p on p.id = a.person_id where p.account_id = ${c.me.account_id} order by a.name`)
    })),

  post("/admin/integrations/apps/:id/disconnect", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const del = yield* sql`delete from connected_apps a using people p where a.id = ${Number(c.params.id) || 0} and p.id = a.person_id and p.account_id = ${c.me.account_id} returning a.id`
      if (!del.length) return yield* new NotFound()
      return redirect("/admin/integrations", "Disconnected.")
    })),

  // Security. Other people's two_factor pref doesn't sync, so who hasn't set it up comes from here.
  get("/admin/security/missing", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      return json(yield* sql<{ id: number; name: string }>`
        select p.id, p.name from people p left join companies k on k.id = p.company_id
        where p.account_id = ${c.me.account_id} and p.removed_at is null and p.joined_at is not null and coalesce((p.prefs->>'two_factor')::boolean, false) = false
        order by k.name nulls first, p.name`)
    })),

  post("/admin/security", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const on = (yield* c.form).get("require_2fa") === "on"
      yield* sql`update accounts set settings = settings || ${JSON.stringify({ require_2fa: on })}::jsonb where id = ${c.me.account_id}`
      return redirect("/admin/security", on ? "Two-step verification is required now." : "Two-step verification is optional now.")
    })),

  // Cancel
  post("/admin/cancel", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`update accounts set status = 'cancelled', cancelled_at = now() where id = ${c.me.account_id}`
      yield* logEvent(c, { project_id: null, action: "cancelled", summary: "cancelled the account" })
      return redirect("/lockout", "Your account is cancelled. You can reactivate it for 30 days.")
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`insert into connected_apps ${sql.insert({ person_id: s.people.ann.id, name: "Calendar Sync" })}`
    const [e] = yield* sql<{ id: number }>`insert into exports ${sql.insert({ account_id: s.account.id, person_id: s.people.maya.id, status: "ready" })} returning id`
    mkdirSync("storage/exports", { recursive: true })
    const path = `storage/exports/${e!.id}.json`
    yield* Effect.promise(() => Bun.write(path, JSON.stringify({ account: s.account.name, note: "Sample export from the seed data." }, null, 2)))
    yield* sql`update exports set file_path = ${path}, created_at = now() - interval '7 days' where id = ${e!.id}`
  })
