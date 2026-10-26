// Sample data: two accounts, a handful of people (one a client), and a few projects.
// Each area adds its own content through its `seed` export.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import type { Account, Ctx, Person } from "./lib/web.ts"
import { defaultTools, type Project } from "./lib/core.ts"

export type Seed = {
  account: Account
  other: Account
  people: { maya: Person; ann: Person; bob: Person; cara: Person; dan: Person }
  projects: { website: Project; marketing: Project; offsite: Project; template: Project }
  /** A request-less context for acting as someone in seeds. */
  as: (p: Person) => Ctx
}

export const seedCtx = (me: Person, account: Account): Ctx => ({
  req: undefined as never,
  url: new URL("http://localhost/"),
  params: {},
  query: new URLSearchParams(),
  me,
  account,
  form: Effect.succeed(new FormData()),
})

export const baseSeed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [account] = yield* sql<Account>`insert into accounts ${sql.insert({ name: "Acme", plan: "standard", status: "active", billing_email: "maya@acme.test", card_last4: "4242", settings: JSON.stringify({ who_can_create_projects: "everyone", who_can_invite: "everyone", clients_can_ping: false }) })} returning *`
  const [other] = yield* sql<Account>`insert into accounts ${sql.insert({ name: "Side Project Co", plan: "standard", status: "trial", trial_ends_on: new Date(Date.now() + 20 * 86400_000).toISOString().slice(0, 10) })} returning *`
  const [acme] = yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: account!.id, name: "Acme" })} returning id`
  const [northwind] = yield* sql<{ id: number }>`insert into companies ${sql.insert({ account_id: account!.id, name: "Northwind (client)" })} returning id`

  const person = (p: Partial<Person> & { name: string; email: string }, accountId = account!.id) =>
    sql<Person>`insert into people ${sql.insert({
      account_id: accountId, company_id: p.company_id ?? acme!.id, name: p.name, email: p.email, title: p.title ?? null,
      role: p.role ?? "member", time_zone: p.time_zone ?? "America/Chicago", joined_at: new Date(),
      prefs: JSON.stringify({ notify_email: true, ...(p.prefs ?? {}) }), bio: p.bio ?? null, location: p.location ?? null,
    })} returning *`.pipe(Effect.map((r) => r[0]!))

  const maya = yield* person({ name: "Maya Ortiz", email: "maya@acme.test", title: "CEO", role: "owner", location: "Chicago", bio: "Keeps the team pointed the same way." })
  const ann = yield* person({ name: "Ann Lee", email: "ann@acme.test", title: "Designer", role: "admin", time_zone: "America/New_York" })
  const bob = yield* person({ name: "Bob Diaz", email: "bob@acme.test", title: "Programmer", time_zone: "Europe/London" })
  const cara = yield* person({ name: "Cara Wu", email: "cara@acme.test", title: "Support", prefs: { wcw: { on: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" } } })
  const dan = yield* person({ name: "Dan Client", email: "dan@northwind.test", title: "Marketing Director", role: "client", company_id: northwind!.id })
  // Maya is in a second account too, so the account chooser has something to choose.
  yield* person({ name: "Maya Ortiz", email: "maya@acme.test", role: "owner", company_id: null }, other!.id)
  yield* sql`update people set invited_by = ${maya.id} where account_id = ${account!.id} and id <> ${maya.id}`

  const project = (p: Partial<Project> & { name: string }, members: Person[]) =>
    Effect.gen(function* () {
      const [row] = yield* sql<Project>`insert into projects ${sql.insert({
        account_id: account!.id, kind: p.kind ?? "project", name: p.name, description: p.description ?? null,
        all_access: p.all_access ?? false, status: p.status ?? "active", starts_on: p.starts_on ?? null, ends_on: p.ends_on ?? null,
        tools: JSON.stringify(p.tools ?? defaultTools()), created_by: maya.id,
      })} returning *`
      for (const m of members) yield* sql`insert into project_people (project_id, person_id) values (${row!.id}, ${m.id})`
      return row!
    })

  const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10)
  const website = yield* project({ name: "Website Redesign", description: "New marketing site for Northwind.", starts_on: day(-20), ends_on: day(25),
    tools: [...defaultTools().map((t) => ({ ...t, enabled: true })), { id: "vault-2", type: "vault" as const, name: "Client files", enabled: true }] }, [maya, ann, bob, dan])
  const marketing = yield* project({ name: "Marketing Plan", description: "Q4 campaigns.", starts_on: day(-5), ends_on: day(60) }, [maya, cara, bob])
  const offsite = yield* project({ name: "2025 Offsite", description: "Done and dusted.", status: "archived", starts_on: day(-300), ends_on: day(-290) }, [maya, ann])
  const template = yield* project({ name: "New Client Onboarding", description: "Copy this for every new client.", kind: "template" }, [maya, ann])
  yield* sql`insert into pins (person_id, project_id) values (${maya.id}, ${website.id})`
  yield* sql`insert into categories ${sql.insert([
    { account_id: account!.id, emoji: "📢", name: "Announcement" },
    { account_id: account!.id, emoji: "💡", name: "Idea" },
    { account_id: account!.id, emoji: "🔄", name: "Update" },
    { account_id: account!.id, emoji: "ℹ️", name: "FYI" },
    { account_id: account!.id, emoji: "❓", name: "Question" },
  ])}`

  const s: Seed = {
    account: account!, other: other!,
    people: { maya, ann, bob, cara, dan },
    projects: { website, marketing, offsite, template },
    as: (p) => seedCtx(p, account!),
  }
  return s
})
