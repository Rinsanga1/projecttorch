// Admin: account owners and admins only. Billing, roles and cancelling are owners only. Posts: src/areas/admin.ts.
import { useParams } from "react-router"
import { db } from "../store.ts"
import { me, account, accountPeople, personById, useApi, NoAccess, NotFound } from "../data.ts"
import { isAdmin, projectUrl, type Account, type Person } from "../../shared/domain.ts"
import { fmtDate, fmtDateTime, plural } from "../../shared/format.ts"
import { Form } from "../ui/forms.tsx"
import { Page, page, type Crumb } from "../ui/page.tsx"

const isOwner = (p: Pick<Person, "role">) => p.role === "owner"
const requireAdmin = () => { if (!isAdmin(me())) throw new NoAccess() }
const requireOwner = () => { if (!isOwner(me())) throw new NoAccess() }

const crumbs: Crumb[] = [["Admin", "/admin"]]

// ponytail: illustrative prices, no real payment processor. Wire Stripe in where the card is saved.
const PLANS = {
  standard: { name: "Saintsflow", price: (seats: number) => 15 * seats, label: "$15 per user per month" },
  pro_unlimited: { name: "Saintsflow Unlimited", price: (_: number) => 299, label: "$299 a month for any number of users" },
} as const
type PlanKey = keyof typeof PLANS
const plan = (a: Account) => PLANS[(a.plan in PLANS ? a.plan : "standard") as PlanKey]

/** Joined, not removed, not a client. */
const seats = () => accountPeople({ includeClients: false }).length

/** The person being managed, in this account. Admins can't touch owners. */
const managed = (id: string | undefined) => {
  const p = db.people.get(String(Number(id) || 0))
  if (!p || p.account_id !== me().account_id || p.removed_at) throw new NotFound()
  if (isOwner(p) && !isOwner(me())) throw new NoAccess()
  return p
}

const daysLeft = (d: string | null) => Math.max(0, 30 - Math.floor((Date.now() - new Date(d ?? Date.now()).getTime()) / 86_400_000))

export const routes = [
  page("/admin", () => {
    requireAdmin()
    const owner = isOwner(me())
    return (
      <Page title="Admin">
        <h1>Admin</h1>
        <p>Account owners and admins only.{owner ? "" : " Some settings are for owners only."}</p>
        <ul>
          <li><a href="/admin/account">Account name & logo</a></li>
          <li><a href="/admin/roles">Administrators & owners</a></li>
          <li><a href="/admin/people">Manage people</a></li>
          <li><a href="/admin/permissions">Who can do what</a></li>
          {owner && <li><a href="/admin/billing">Plan & billing</a></li>}
          <li><a href="/admin/export">Export your data</a></li>
          <li><a href="/admin/projects">Archived & trashed projects</a></li>
          <li><a href="/admin/integrations">Integrations</a></li>
          <li><a href="/admin/security">Security</a></li>
          {owner && <li><a href="/admin/cancel">Cancel this account</a></li>}
        </ul>
      </Page>
    )
  }),

  // Account name & logo
  page("/admin/account", () => {
    requireAdmin()
    const a = account()
    return (
      <Page title="Account name & logo" crumbs={crumbs}>
        <h1>Account name & logo</h1>
        <Form action="/admin/account">
          <p><label>Account name<br /><input name="name" defaultValue={a.name} required /></label></p>
          <p><label>Logo (link to an image)<br /><input type="url" name="logo_url" defaultValue={a.logo_url ?? ""} size={60} placeholder="https://…" /></label></p>
          {a.logo_url && <p><img src={a.logo_url} alt="Current logo" height={48} /></p>}
          <p><button>Save changes</button> <a href="/admin">Cancel</a></p>
        </Form>
      </Page>
    )
  }),

  // Administrators & owners
  page("/admin/roles", () => {
    requireAdmin()
    const people = accountPeople()
    const owners = people.filter(isOwner)
    const admins = people.filter((p) => p.role === "admin")
    const others = people.filter((p) => p.role === "member")
    const owner = isOwner(me())
    const remove = (p: Person) => owner && <> <Form action={`/admin/roles/${p.id}/remove`} style={{ display: "inline" }}><button>Remove</button></Form></>
    return (
      <Page title="Administrators & owners" crumbs={crumbs}>
        <h1>Administrators & owners</h1>
        <h2>Owners</h2>
        <p>Owners can do everything, including billing.</p>
        <ul>{owners.map((p) => <li key={p.id}><a href={`/people/${p.id}`}>{p.name}</a>{remove(p)}</li>)}</ul>
        <h2>Admins</h2>
        <p>Admins can manage people and projects.</p>
        {admins.length
          ? <ul>{admins.map((p) => <li key={p.id}><a href={`/people/${p.id}`}>{p.name}</a>{remove(p)}</li>)}</ul>
          : <p>No admins yet.</p>}
        {owner ? (
          <>
            <h2>Add an admin or owner</h2>
            <Form action="/admin/roles">
              <p>
                <label>Person <select name="person_id">{[...others, ...admins].map((p) => <option key={p.id} value={p.id}>{p.name}{p.role === "admin" ? " (admin)" : ""}</option>)}</select></label>{" "}
                <label>as <select name="role"><option value="admin">Admin</option><option value="owner">Owner</option></select></label>
              </p>
              <button>Add</button>
            </Form>
          </>
        ) : <p>Only owners can change who's an admin or owner.</p>}
      </Page>
    )
  }),

  // Manage people
  page("/admin/people", () => {
    requireAdmin()
    const m = me()
    return (
      <Page title="Manage people" crumbs={crumbs}>
        <h1>Manage people</h1>
        <p><a href="/people/invite">Invite people</a> · <a href="/people/pending">Pending invitations</a></p>
        <table>
          <thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Last active</th><th></th></tr></thead>
          <tbody>
            {accountPeople().map((p) => (
              <tr key={p.id}>
                <td><a href={`/people/${p.id}`}>{p.name}</a></td><td>{p.company_name ?? ""}</td><td>{p.role}</td>
                <td>{p.last_active_at ? fmtDateTime(p.last_active_at, m.time_zone) : "never"}</td>
                <td>{isOwner(p) && !isOwner(m) ? "" : <a href={`/admin/people/${p.id}`}>Manage</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Page>
    )
  }),

  page("/admin/people/:id", () => {
    requireAdmin()
    const p = managed(useParams().id)
    const m = me()
    const cos = [...db.companies.values()].filter((k) => k.account_id === m.account_id).sort((a, b) => a.name.localeCompare(b.name))
    const roles = isOwner(m) ? ["member", "client", "admin", "owner"] : ["member", "client", "admin"]
    return (
      <Page title={`Manage ${p.name}`} crumbs={[...crumbs, ["Manage people", "/admin/people"]]}>
        <h1>{p.name}</h1>
        <p>{p.email}{p.joined_at ? "" : " (hasn't accepted the invitation yet)"}</p>
        <Form action={`/admin/people/${p.id}`} key={`${p.role}:${p.company_id}`}>
          <p><label>Role <select name="role" defaultValue={p.role}>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label></p>
          <p>
            <label>Company <select name="company_id" defaultValue={p.company_id ?? ""}><option value="">None</option>{cos.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>{" "}
            <label>or move them to a new company: <input name="new_company" /></label>
          </p>
          <p><button>Save changes</button> <a href="/admin/people">Cancel</a></p>
        </Form>
        {p.id !== m.id && <p><a href={`/admin/people/${p.id}/remove`}>Remove from account</a></p>}
      </Page>
    )
  }),

  page("/admin/people/:id/remove", () => {
    requireAdmin()
    const p = managed(useParams().id)
    return (
      <Page title={`Remove ${p.name}?`} crumbs={[...crumbs, ["Manage people", "/admin/people"]]}>
        <h1>Remove {p.name} from {account().name}?</h1>
        <p>Their posts and comments stay. They lose access right away.</p>
        <Form action={`/admin/people/${p.id}/remove`}><button>Yes, remove {p.name}</button> <a href={`/admin/people/${p.id}`}>Never mind</a></Form>
      </Page>
    )
  }),

  // Who can do what
  page("/admin/permissions", () => {
    requireAdmin()
    const a = account()
    const s = a.settings
    const radio = (name: string, value: string, label: string, on: boolean) =>
      <><label><input type="radio" name={name} value={value} defaultChecked={on} /> {label}</label><br /></>
    return (
      <Page title="Who can do what" crumbs={crumbs}>
        <h1>Who can do what</h1>
        <Form action="/admin/permissions" key={JSON.stringify(s)}>
          <fieldset><legend>Who can make new projects?</legend>
            {radio("who_can_create_projects", "everyone", "Everyone except clients", s.who_can_create_projects !== "admins")}
            {radio("who_can_create_projects", "admins", "Only admins and owners", s.who_can_create_projects === "admins")}
          </fieldset>
          <fieldset><legend>Who can invite people?</legend>
            {radio("who_can_invite", "everyone", "Everyone except clients", s.who_can_invite !== "admins")}
            {radio("who_can_invite", "admins", "Only admins and owners", s.who_can_invite === "admins")}
          </fieldset>
          <fieldset><legend>Who can start private chats?</legend>
            <label><input type="checkbox" name="clients_can_ping" defaultChecked={!!s.clients_can_ping} /> Clients can start a private chat with anyone at {a.name}, not just people on their projects</label>
          </fieldset>
          <p><button>Save changes</button></p>
        </Form>
      </Page>
    )
  }),

  // Plan & billing (owners)
  page("/admin/billing", () => {
    requireOwner()
    const a = account()
    const n = seats()
    const { data: storage } = useApi<{ bytes: number }>("/admin/billing/storage")
    const pl = plan(a)
    const created = new Date(a.created_at)
    const months: Date[] = []
    for (let d = new Date(created.getFullYear(), created.getMonth(), 1); d <= new Date(); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.unshift(d)
    return (
      <Page title="Plan & billing" crumbs={crumbs}>
        <h1>Plan & billing</h1>
        {a.status === "on_hold" && <div role="alert"><p><b>This account is on hold.</b> Your card was declined. Update it to keep the account active.</p></div>}
        {a.status === "cancelled" && (
          <div role="alert">
            <p><b>This account is cancelled.</b> Everything will be deleted for good on {fmtDate(new Date(new Date(a.cancelled_at!).getTime() + 30 * 86400_000))}.</p>
            <Form action="/admin/billing/reactivate"><button>Reactivate this account</button></Form>
          </div>
        )}
        {a.status === "trial" && <p>You're on a free trial{a.trial_ends_on ? ` until ${fmtDate(a.trial_ends_on)}` : ""}. Add a card to keep going after that.</p>}
        <h2>Your plan</h2>
        <p><b>{pl.name}</b>: {pl.label}. {plural(n, "user")} right now, so <b>${pl.price(n)}/month</b>.</p>
        <p><small>Prices here are illustrative. No real payments are taken.</small></p>
        {storage && <p>Storage used: {(storage.bytes / 1024 / 1024).toFixed(1)} MB</p>}
        <Form action="/admin/billing/plan" key={a.plan}>
          <p>
            <label>Change plan <select name="plan" defaultValue={a.plan}>{Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v.name}: {v.label}</option>)}</select></label>{" "}
            <button>Change plan</button>
          </p>
        </Form>
        <h2>Payment method</h2>
        <p>{a.card_last4 ? `Card ending in ${a.card_last4}` : "No card on file."}</p>
        <Form action="/admin/billing/card" key={a.card_last4 ?? ""}>
          <p><label>Card number (only the last 4 digits are kept)<br /><input name="card" inputMode="numeric" autoComplete="cc-number" size={22} required /></label></p>
          <button>Update card</button>
        </Form>
        <Form action="/admin/billing/decline"><p><button data-quiet>Simulate a declined card</button> <small>(for trying the on-hold flow)</small></p></Form>
        <h2>Billing contact</h2>
        <Form action="/admin/billing/contact" key={a.billing_email ?? ""}>
          <p><label>Receipts go to <input type="email" name="billing_email" defaultValue={a.billing_email ?? ""} required /></label> <button>Save</button></p>
        </Form>
        <h2>Receipts</h2>
        {a.status === "trial" || !a.card_last4 ? <p>No receipts yet.</p> : (
          <ul>{months.map((d) => {
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
            return <li key={ym}><a href={`/admin/billing/receipts/${ym}`}>{fmtDate(d)}</a>: ${pl.price(n)}, paid</li>
          })}</ul>
        )}
      </Page>
    )
  }),

  page("/admin/billing/receipts/:ym", () => {
    requireOwner()
    const { ym } = useParams()
    if (!/^\d{4}-\d{2}$/.test(ym ?? "")) throw new NotFound()
    const a = account()
    const n = seats()
    const pl = plan(a)
    return (
      <Page title="Receipt" crumbs={[...crumbs, ["Plan & billing", "/admin/billing"]]}>
        <h1>Receipt for {ym}</h1>
        <p>{a.name}</p>
        <table><tbody>
          <tr><th>Plan</th><td>{pl.name}</td></tr>
          <tr><th>Users</th><td>{n}</td></tr>
          <tr><th>Charged</th><td>${pl.price(n)}{a.card_last4 ? ` to the card ending in ${a.card_last4}` : ""}</td></tr>
        </tbody></table>
        <p><small>Illustrative receipt. No real payment was taken.</small></p>
      </Page>
    )
  }),

  // Export your data
  page("/admin/export", () => {
    requireAdmin()
    const m = me()
    const ex = [...db.exports.values()].filter((e) => e.account_id === m.account_id).sort((a, b) => b.id - a.id)
    return (
      <Page title="Export your data" crumbs={crumbs}>
        <h1>Export your data</h1>
        <Form action="/admin/export"><button>Export everything</button></Form>
        <p>We'll email you when your export is ready. Big accounts can take a while.</p>
        <h2>Past exports</h2>
        {ex.length ? (
          <ul>{ex.map((e) => {
            const name = personById(e.person_id)?.name
            return <li key={e.id}>{fmtDateTime(e.created_at, m.time_zone)}{name ? ` by ${name}` : ""}: {e.status === "ready" ? <a href={`/api/admin/export/${e.id}/download`}>Download</a> : "being prepared…"}</li>
          })}</ul>
        ) : <p>No exports yet.</p>}
      </Page>
    )
  }),

  // Archived & trashed projects
  page("/admin/projects", () => {
    requireAdmin()
    const ps = [...db.projects.values()]
      .filter((p) => p.account_id === me().account_id && p.kind !== "ping" && (p.status === "archived" || p.status === "trashed"))
      .sort((a, b) => a.name.localeCompare(b.name))
    const archived = ps.filter((p) => p.status === "archived")
    const trashed = ps.filter((p) => p.status === "trashed")
    return (
      <Page title="Archived & trashed projects" crumbs={crumbs}>
        <h1>Archived & trashed projects</h1>
        <h2>Archived</h2>
        {archived.length ? (
          <ul>{archived.map((p) => (
            <li key={p.id}><a href={projectUrl(p)}>{p.name}</a>{" "}
              <Form action={`/admin/projects/${p.id}/restore`} style={{ display: "inline" }}><button>Unarchive</button></Form></li>
          ))}</ul>
        ) : <p>Nothing's archived.</p>}
        <p><a href="/projects/archived">All archived projects</a></p>
        <h2>In the trash</h2>
        <p>Trashed projects are deleted forever after 30 days.</p>
        {trashed.length ? (
          <ul>{trashed.map((p) => (
            <li key={p.id}><a href={projectUrl(p)}>{p.name}</a> <small>(trashed {fmtDate(p.trashed_at)}, {plural(daysLeft(p.trashed_at), "day")} left)</small>{" "}
              <Form action={`/admin/projects/${p.id}/restore`} style={{ display: "inline" }}><button>Put it back</button></Form></li>
          ))}</ul>
        ) : <p>The trash is empty.</p>}
      </Page>
    )
  }),

  // Integrations
  page("/admin/integrations", () => {
    requireAdmin()
    const m = me()
    const bots = [...db.chatbots.values()].filter((b) => b.account_id === m.account_id).sort((a, b) => a.name.localeCompare(b.name))
    const hooks = [...db.webhooks.values()]
      .map((h) => ({ ...h, project: db.projects.get(String(h.project_id)) }))
      .filter((h) => h.project?.account_id === m.account_id)
      .sort((a, b) => a.project!.name.localeCompare(b.project!.name))
    const { data: apps, reload } = useApi<Array<{ id: number; name: string; person: string; created_at: string }>>("/admin/integrations/apps")
    return (
      <Page title="Integrations" crumbs={crumbs}>
        <h1>Integrations</h1>
        <h2>Bots</h2>
        {bots.length ? <ul>{bots.map((b) => <li key={b.id}>{b.name}</li>)}</ul> : <p>No bots yet.</p>}
        <p><a href="/bots">Manage bots</a></p>
        <h2>Webhooks</h2>
        {hooks.length
          ? <ul>{hooks.map((h) => <li key={h.id}><a href={`/projects/${h.project_id}/webhooks`}>{h.project!.name}</a>: {h.url}</li>)}</ul>
          : <p>No webhooks. Add them from a project's ••• menu.</p>}
        <h2>Apps people have connected</h2>
        {apps && (apps.length ? (
          <ul>{apps.map((a) => (
            <li key={a.id}>{a.name} <small>(connected by {a.person}, {fmtDate(a.created_at)})</small>{" "}
              <Form action={`/admin/integrations/apps/${a.id}/disconnect`} onDone={reload} style={{ display: "inline" }}><button>Disconnect</button></Form></li>
          ))}</ul>
        ) : <p>No connected apps.</p>)}
        <p>Looking for more? Apps that work with Saintsflow connect through its API. A directory is coming later.</p>
      </Page>
    )
  }),

  // Security
  page("/admin/security", () => {
    requireAdmin()
    const a = account()
    const { data: people } = useApi<Array<{ id: number; name: string }>>("/admin/security/missing")
    return (
      <Page title="Security" crumbs={crumbs}>
        <h1>Security</h1>
        <Form action="/admin/security" key={String(!!a.settings.require_2fa)}>
          <p><label><input type="checkbox" name="require_2fa" defaultChecked={!!a.settings.require_2fa} /> Require two-step verification for everyone</label></p>
          <button>Save</button>
        </Form>
        <h2>Who hasn't set it up yet</h2>
        {people && (people.length
          ? <ul>{people.map((p) => <li key={p.id}><a href={`/people/${p.id}`}>{p.name}</a></li>)}</ul>
          : <p>Everyone has two-step verification on.</p>)}
        <p><small>People set it up from <a href="/my/security">Login & security</a>.</small></p>
      </Page>
    )
  }),

  // Cancel
  page("/admin/cancel", () => {
    requireOwner()
    const a = account()
    return (
      <Page title="Cancel this account" crumbs={crumbs}>
        <h1>Cancel {a.name}</h1>
        <p>Cancelling deletes everything in {a.name} for good after 30 days. <a href="/admin/export">Export first</a> if you want a copy.</p>
        <Form action="/admin/cancel"><button>Cancel my account</button> <a href="/admin">Never mind</a></Form>
        <p>Changed your mind? Reactivate any time in the next 30 days from <a href="/admin/billing">Plan & billing</a>.</p>
      </Page>
    )
  }),
]
