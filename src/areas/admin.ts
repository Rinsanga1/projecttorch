// Admin: account owners and admins only. Billing, roles and cancelling are owners only.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { HttpServerResponse } from "effect/http"
import { mkdirSync } from "node:fs"
import { html, raw, fmtDate, fmtDateTime, plural } from "../lib/html.ts"
import { get, post, redirect, render, str, errors, isAdmin, isClient, NoAccess, NotFound, type Ctx, type Person, type Account } from "../lib/web.ts"
import { sendEmail, logEvent, projectUrl, type Project } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const isOwner = (p: Person) => p.role === "owner"
const requireAdmin = (c: Ctx) => (isAdmin(c.me) ? Effect.void : Effect.fail(new NoAccess()))
const requireOwner = (c: Ctx) => (isOwner(c.me) ? Effect.void : Effect.fail(new NoAccess()))

const crumbs = [["Admin", "/admin"]] as const

// ponytail: illustrative prices, no real payment processor. Wire Stripe in where the card is saved.
const PLANS = {
  standard: { name: "Saintsflow", price: (seats: number) => 15 * seats, label: "$15 per user per month" },
  pro_unlimited: { name: "Saintsflow Unlimited", price: (_: number) => 299, label: "$299 a month for any number of users" },
} as const
type PlanKey = keyof typeof PLANS
const plan = (a: Account) => PLANS[(a.plan in PLANS ? a.plan : "standard") as PlanKey]

const seats = (accountId: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return (yield* sql<{ n: number }>`select count(*)::int as n from people where account_id = ${accountId} and role <> 'client' and removed_at is null and joined_at is not null`)[0]!.n
  })

const accountPeopleAll = (c: Ctx) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<Person & { company_name: string | null }>`
      select p.*, k.name as company_name from people p left join companies k on k.id = p.company_id
      where p.account_id = ${c.me.account_id} and p.removed_at is null and p.joined_at is not null order by k.name nulls first, p.name`
  })

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
    if (who) yield* sendEmail(who, { subject: "Your export is ready", body: "Everything in your account is ready to download.", kind: "export", link: `/admin/export/${e.id}/download` }, true)
  }
})

export const jobs = [buildExports]

// ---------- routes ----------

export const routes = [
  get("/admin", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const owner = isOwner(c.me)
      return yield* render(c, "Admin", html`
<h1>Admin</h1>
<p>Account owners and admins only.${owner ? "" : " Some settings are for owners only."}</p>
<ul>
  <li><a href="/admin/account">Account name & logo</a></li>
  <li><a href="/admin/roles">Administrators & owners</a></li>
  <li><a href="/admin/people">Manage people</a></li>
  <li><a href="/admin/permissions">Who can do what</a></li>
  ${owner ? html`<li><a href="/admin/billing">Plan & billing</a></li>` : ""}
  <li><a href="/admin/export">Export your data</a></li>
  <li><a href="/admin/projects">Archived & trashed projects</a></li>
  <li><a href="/admin/integrations">Integrations</a></li>
  <li><a href="/admin/security">Security</a></li>
  ${owner ? html`<li><a href="/admin/cancel">Cancel this account</a></li>` : ""}
</ul>`)
    })),

  // Account name & logo
  get("/admin/account", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      return yield* render(c, "Account name & logo", accountForm(c.account.name, c.account.logo_url ?? "", []), crumbs)
    })),

  post("/admin/account", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const name = str(fd, "name")
      const logo = str(fd, "logo_url")
      const errs = [...(name ? [] : ["Your account needs a name."]), ...(logo && !/^https?:\/\//.test(logo) ? ["The logo has to be a link to an image (https://…)."] : [])]
      if (errs.length) return yield* render(c, "Account name & logo", accountForm(name, logo, errs), crumbs, 422)
      yield* sql`update accounts set name = ${name}, logo_url = ${logo || null} where id = ${c.me.account_id}`
      return redirect("/admin/account", "Saved.")
    })),

  // Administrators & owners
  get("/admin/roles", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const people = yield* accountPeopleAll(c)
      const owners = people.filter(isOwner)
      const admins = people.filter((p) => p.role === "admin")
      const others = people.filter((p) => p.role === "member")
      const owner = isOwner(c.me)
      const remove = (p: Person) => owner ? html` <form method="post" action="/admin/roles/${p.id}/remove" style="display:inline"><button>Remove</button></form>` : ""
      return yield* render(c, "Administrators & owners", html`
<h1>Administrators & owners</h1>
<h2>Owners</h2>
<p>Owners can do everything, including billing.</p>
<ul>${owners.map((p) => html`<li><a href="/people/${p.id}">${p.name}</a>${remove(p)}</li>`)}</ul>
<h2>Admins</h2>
<p>Admins can manage people and projects.</p>
${admins.length ? html`<ul>${admins.map((p) => html`<li><a href="/people/${p.id}">${p.name}</a>${remove(p)}</li>`)}</ul>` : html`<p>No admins yet.</p>`}
${owner ? html`<h2>Add an admin or owner</h2>
<form method="post" action="/admin/roles">
  <p><label>Person <select name="person_id">${[...others, ...admins].map((p) => html`<option value="${p.id}">${p.name}${p.role === "admin" ? " (admin)" : ""}</option>`)}</select></label>
  <label>as <select name="role"><option value="admin">Admin</option><option value="owner">Owner</option></select></label></p>
  <button>Add</button>
</form>` : html`<p>Only owners can change who's an admin or owner.</p>`}`, crumbs)
    })),

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
  get("/admin/people", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const people = yield* accountPeopleAll(c)
      return yield* render(c, "Manage people", html`
<h1>Manage people</h1>
<p><a href="/people/invite">Invite people</a> · <a href="/people/pending">Pending invitations</a></p>
<table>
  <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Last active</th><th></th></tr></thead>
  <tbody>${people.map((p) => html`<tr>
    <td><a href="/people/${p.id}">${p.name}</a></td><td>${p.company_name ?? ""}</td><td>${p.role}</td>
    <td>${(p as any).last_active_at ? fmtDateTime((p as any).last_active_at, c.me.time_zone) : "never"}</td>
    <td>${isOwner(p) && !isOwner(c.me) ? "" : html`<a href="/admin/people/${p.id}">Manage</a>`}</td></tr>`)}</tbody>
</table>`, crumbs)
    })),

  get("/admin/people/:id", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const p = yield* managed(c)
      const cos = yield* sql<{ id: number; name: string }>`select id, name from companies where account_id = ${c.me.account_id} order by name`
      const roles = isOwner(c.me) ? ["member", "client", "admin", "owner"] : ["member", "client", "admin"]
      return yield* render(c, `Manage ${p.name}`, html`
<h1>${p.name}</h1>
<p>${p.email}${p.joined_at ? "" : " (hasn't accepted the invitation yet)"}</p>
<form method="post" action="/admin/people/${p.id}">
  <p><label>Role <select name="role">${roles.map((r) => html`<option value="${r}"${p.role === r ? raw(" selected") : ""}>${r}</option>`)}</select></label></p>
  <p><label>Company <select name="company_id"><option value="">None</option>${cos.map((k) => html`<option value="${k.id}"${p.company_id === k.id ? raw(" selected") : ""}>${k.name}</option>`)}</select></label>
  <label>or move them to a new company: <input name="new_company"></label></p>
  <p><button>Save changes</button> <a href="/admin/people">Cancel</a></p>
</form>
${p.id !== c.me.id ? html`<p><a href="/admin/people/${p.id}/remove">Remove from account</a></p>` : ""}`, [...crumbs, ["Manage people", "/admin/people"]])
    })),

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

  get("/admin/people/:id/remove", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const p = yield* managed(c)
      return yield* render(c, `Remove ${p.name}?`, html`
<h1>Remove ${p.name} from ${c.account.name}?</h1>
<p>Their posts and comments stay. They lose access right away.</p>
<form method="post" action="/admin/people/${p.id}/remove"><button>Yes, remove ${p.name}</button> <a href="/admin/people/${p.id}">Never mind</a></form>`, [...crumbs, ["Manage people", "/admin/people"]])
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
  get("/admin/permissions", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const s = c.account.settings
      const radio = (name: string, value: string, label: string, on: boolean) =>
        html`<label><input type="radio" name="${name}" value="${value}"${on ? raw(" checked") : ""}> ${label}</label><br>`
      return yield* render(c, "Who can do what", html`
<h1>Who can do what</h1>
<form method="post" action="/admin/permissions">
  <fieldset><legend>Who can make new projects?</legend>
    ${radio("who_can_create_projects", "everyone", "Everyone except clients", s.who_can_create_projects !== "admins")}
    ${radio("who_can_create_projects", "admins", "Only admins and owners", s.who_can_create_projects === "admins")}
  </fieldset>
  <fieldset><legend>Who can invite people?</legend>
    ${radio("who_can_invite", "everyone", "Everyone except clients", s.who_can_invite !== "admins")}
    ${radio("who_can_invite", "admins", "Only admins and owners", s.who_can_invite === "admins")}
  </fieldset>
  <fieldset><legend>Who can start private chats?</legend>
    <label><input type="checkbox" name="clients_can_ping"${s.clients_can_ping ? raw(" checked") : ""}> Clients can start a private chat with anyone at ${c.account.name}, not just people on their projects</label>
  </fieldset>
  <p><button>Save changes</button></p>
</form>`, crumbs)
    })),

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

  // Plan & billing (owners)
  get("/admin/billing", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      const a = c.account
      const n = yield* seats(a.id)
      const [storage] = yield* sql<{ bytes: number }>`select coalesce(sum((data->>'size')::bigint), 0)::float8 as bytes from recordings where account_id = ${a.id} and type = 'upload'`
      const pl = plan(a)
      const months: Date[] = []
      for (let d = new Date(a.created_at.getFullYear(), a.created_at.getMonth(), 1); d <= new Date(); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.unshift(d)
      return yield* render(c, "Plan & billing", html`
<h1>Plan & billing</h1>
${a.status === "on_hold" ? html`<div role="alert"><p><b>This account is on hold.</b> Your card was declined. Update it to keep the account active.</p></div>` : ""}
${a.status === "cancelled" ? html`<div role="alert"><p><b>This account is cancelled.</b> Everything will be deleted for good on ${fmtDate(new Date(new Date(a.cancelled_at!).getTime() + 30 * 86400_000))}.</p>
  <form method="post" action="/admin/billing/reactivate"><button>Reactivate this account</button></form></div>` : ""}
${a.status === "trial" ? html`<p>You're on a free trial${a.trial_ends_on ? ` until ${fmtDate(a.trial_ends_on)}` : ""}. Add a card to keep going after that.</p>` : ""}
<h2>Your plan</h2>
<p><b>${pl.name}</b>: ${pl.label}. ${plural(n, "user")} right now, so <b>$${pl.price(n)}/month</b>.</p>
<p><small>Prices here are illustrative. No real payments are taken.</small></p>
<p>Storage used: ${(storage!.bytes / 1024 / 1024).toFixed(1)} MB</p>
<form method="post" action="/admin/billing/plan">
  <p><label>Change plan <select name="plan">${Object.entries(PLANS).map(([k, v]) => html`<option value="${k}"${a.plan === k ? raw(" selected") : ""}>${v.name}: ${v.label}</option>`)}</select></label>
  <button>Change plan</button></p>
</form>
<h2>Payment method</h2>
<p>${a.card_last4 ? `Card ending in ${a.card_last4}` : "No card on file."}</p>
<form method="post" action="/admin/billing/card">
  <p><label>Card number (only the last 4 digits are kept)<br><input name="card" inputmode="numeric" autocomplete="cc-number" size="22" required></label></p>
  <button>Update card</button>
</form>
<form method="post" action="/admin/billing/decline"><p><button>Simulate a declined card</button> <small>(for trying the on-hold flow)</small></p></form>
<h2>Billing contact</h2>
<form method="post" action="/admin/billing/contact">
  <p><label>Receipts go to <input type="email" name="billing_email" value="${a.billing_email ?? ""}" required></label> <button>Save</button></p>
</form>
<h2>Receipts</h2>
${a.status === "trial" || !a.card_last4 ? html`<p>No receipts yet.</p>` : html`<ul>${months.map((d) => {
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  return html`<li><a href="/admin/billing/receipts/${ym}">${fmtDate(d)}</a>: $${pl.price(n)}, paid</li>`
})}</ul>`}`, crumbs)
    })),

  get("/admin/billing/receipts/:ym", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      if (!/^\d{4}-\d{2}$/.test(c.params.ym ?? "")) return yield* new NotFound()
      const n = yield* seats(c.account.id)
      const pl = plan(c.account)
      return yield* render(c, "Receipt", html`
<h1>Receipt for ${c.params.ym}</h1>
<p>${c.account.name}</p>
<table><tbody>
  <tr><th>Plan</th><td>${pl.name}</td></tr>
  <tr><th>Users</th><td>${n}</td></tr>
  <tr><th>Charged</th><td>$${pl.price(n)}${c.account.card_last4 ? ` to the card ending in ${c.account.card_last4}` : ""}</td></tr>
</tbody></table>
<p><small>Illustrative receipt. No real payment was taken.</small></p>`, [...crumbs, ["Plan & billing", "/admin/billing"]])
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
  get("/admin/export", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const ex = yield* sql<{ id: number; status: string; created_at: Date; name: string | null }>`
        select e.*, p.name from exports e left join people p on p.id = e.person_id where e.account_id = ${c.me.account_id} order by e.id desc`
      return yield* render(c, "Export your data", html`
<h1>Export your data</h1>
<form method="post" action="/admin/export"><button>Export everything</button></form>
<p>We'll email you when your export is ready. Big accounts can take a while.</p>
<h2>Past exports</h2>
${ex.length ? html`<ul>${ex.map((e) => html`<li>${fmtDateTime(e.created_at, c.me.time_zone)}${e.name ? ` by ${e.name}` : ""}: ${e.status === "ready"
  ? html`<a href="/admin/export/${e.id}/download">Download</a>` : "being prepared…"}</li>`)}</ul>` : html`<p>No exports yet.</p>`}`, crumbs)
    })),

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
  get("/admin/projects", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const ps = yield* sql<Project>`select * from projects where account_id = ${c.me.account_id} and kind <> 'ping' and status in ('archived','trashed') order by name`
      const archived = ps.filter((p) => p.status === "archived")
      const trashed = ps.filter((p) => p.status === "trashed")
      return yield* render(c, "Archived & trashed projects", html`
<h1>Archived & trashed projects</h1>
<h2>Archived</h2>
${archived.length ? html`<ul>${archived.map((p) => html`<li><a href="${projectUrl(p)}">${p.name}</a>
  <form method="post" action="/admin/projects/${p.id}/restore" style="display:inline"><button>Unarchive</button></form></li>`)}</ul>` : html`<p>Nothing's archived.</p>`}
<p><a href="/projects/archived">All archived projects</a></p>
<h2>In the trash</h2>
<p>Trashed projects are deleted forever after 30 days.</p>
${trashed.length ? html`<ul>${trashed.map((p) => html`<li><a href="${projectUrl(p)}">${p.name}</a> <small>(trashed ${fmtDate(p.trashed_at)}, ${plural(daysLeft(p.trashed_at), "day")} left)</small>
  <form method="post" action="/admin/projects/${p.id}/restore" style="display:inline"><button>Put it back</button></form></li>`)}</ul>` : html`<p>The trash is empty.</p>`}`, crumbs)
    })),

  post("/admin/projects/:id/restore", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const [p] = yield* sql<Project>`update projects set status = 'active', trashed_at = null where id = ${Number(c.params.id) || 0} and account_id = ${c.me.account_id} returning *`
      if (!p) return yield* new NotFound()
      yield* logEvent(c, { project_id: p.id, action: "restored", summary: `put the project ${p.name} back` })
      return redirect("/admin/projects", { msg: `${p.name} is back.`, href: projectUrl(p), label: "Go there" })
    })),

  // Integrations
  get("/admin/integrations", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const bots = yield* sql<{ id: number; name: string }>`select id, name from chatbots where account_id = ${c.me.account_id} order by name`
      const hooks = yield* sql<{ id: number; url: string; project_id: number; project_name: string }>`
        select w.id, w.url, w.project_id, p.name as project_name from webhooks w join projects p on p.id = w.project_id where p.account_id = ${c.me.account_id} order by p.name`
      const apps = yield* sql<{ id: number; name: string; person: string; created_at: Date }>`
        select a.id, a.name, p.name as person, a.created_at from connected_apps a join people p on p.id = a.person_id where p.account_id = ${c.me.account_id} order by a.name`
      return yield* render(c, "Integrations", html`
<h1>Integrations</h1>
<h2>Bots</h2>
${bots.length ? html`<ul>${bots.map((b) => html`<li>${b.name}</li>`)}</ul>` : html`<p>No bots yet.</p>`}
<p><a href="/bots">Manage bots</a></p>
<h2>Webhooks</h2>
${hooks.length ? html`<ul>${hooks.map((h) => html`<li><a href="/projects/${h.project_id}/webhooks">${h.project_name}</a>: ${h.url}</li>`)}</ul>` : html`<p>No webhooks. Add them from a project's ••• menu.</p>`}
<h2>Apps people have connected</h2>
${apps.length ? html`<ul>${apps.map((a) => html`<li>${a.name} <small>(connected by ${a.person}, ${fmtDate(a.created_at)})</small>
  <form method="post" action="/admin/integrations/apps/${a.id}/disconnect" style="display:inline"><button>Disconnect</button></form></li>`)}</ul>` : html`<p>No connected apps.</p>`}
<p>Looking for more? Apps that work with Saintsflow connect through its API. A directory is coming later.</p>`, crumbs)
    })),

  post("/admin/integrations/apps/:id/disconnect", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const sql = yield* SqlClient.SqlClient
      const del = yield* sql`delete from connected_apps a using people p where a.id = ${Number(c.params.id) || 0} and p.id = a.person_id and p.account_id = ${c.me.account_id} returning a.id`
      if (!del.length) return yield* new NotFound()
      return redirect("/admin/integrations", "Disconnected.")
    })),

  // Security
  get("/admin/security", (c) =>
    Effect.gen(function* () {
      yield* requireAdmin(c)
      const people = (yield* accountPeopleAll(c)).filter((p) => !p.prefs.two_factor)
      return yield* render(c, "Security", html`
<h1>Security</h1>
<form method="post" action="/admin/security">
  <p><label><input type="checkbox" name="require_2fa"${c.account.settings.require_2fa ? raw(" checked") : ""}> Require two-step verification for everyone</label></p>
  <button>Save</button>
</form>
<h2>Who hasn't set it up yet</h2>
${people.length ? html`<ul>${people.map((p) => html`<li><a href="/people/${p.id}">${p.name}</a></li>`)}</ul>` : html`<p>Everyone has two-step verification on.</p>`}
<p><small>People set it up from <a href="/my/security">Login & security</a>.</small></p>`, crumbs)
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
  get("/admin/cancel", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      return yield* render(c, "Cancel this account", html`
<h1>Cancel ${c.account.name}</h1>
<p>Cancelling deletes everything in ${c.account.name} for good after 30 days. <a href="/admin/export">Export first</a> if you want a copy.</p>
<form method="post" action="/admin/cancel"><button>Cancel my account</button> <a href="/admin">Never mind</a></form>
<p>Changed your mind? Reactivate any time in the next 30 days from <a href="/admin/billing">Plan & billing</a>.</p>`, crumbs)
    })),

  post("/admin/cancel", (c) =>
    Effect.gen(function* () {
      yield* requireOwner(c)
      const sql = yield* SqlClient.SqlClient
      yield* sql`update accounts set status = 'cancelled', cancelled_at = now() where id = ${c.me.account_id}`
      yield* logEvent(c, { project_id: null, action: "cancelled", summary: "cancelled the account" })
      return redirect("/lockout", "Your account is cancelled. You can reactivate it for 30 days.")
    })),
]

const accountForm = (name: string, logo: string, errs: string[]) => html`
<h1>Account name & logo</h1>
${errors(errs)}
<form method="post" action="/admin/account">
  <p><label>Account name<br><input name="name" value="${name}" required></label></p>
  <p><label>Logo (link to an image)<br><input type="url" name="logo_url" value="${logo}" size="60" placeholder="https://…"></label></p>
  ${logo ? html`<p><img src="${logo}" alt="Current logo" height="48"></p>` : ""}
  <p><button>Save changes</button> <a href="/admin">Cancel</a></p>
</form>`

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
