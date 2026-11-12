// `bun run check:join`, with the app running (`bun run dev`): the team link (/join/<code>) on the sample Acme account.
// Who sees the code, joining, joining twice, a removed person, a pending invitation, and making a new link.
// Cleans up the people it makes; Acme ends up with a new team link.
import { DATABASE_URL } from "../src/db.ts"

const BASE = process.env.BASE ?? "http://localhost:3000"
const db = new Bun.SQL(DATABASE_URL)
let failed = 0
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); if (!cond) failed++ }

const call = async (path: string, fields?: Record<string, string>, sid = "") => {
  const res = await fetch(`${BASE}/api${path}`, { method: fields ? "POST" : "GET", headers: { cookie: sid }, body: fields ? new URLSearchParams(fields) : undefined })
  const sidOut = res.headers.getSetCookie().find((c) => c.startsWith("sid="))?.split(";")[0] ?? ""
  return { status: res.status, text: await res.text(), sid: sidOut }
}
const signIn = async (email: string) => (await call("/signin", { email, password: "projecttorch" })).sid
const codeOf = async () => (await db`select join_code from accounts where name = 'Acme'`)[0].join_code as string
const stamp = Date.now()
const made = [`new-${stamp}@example.test`, `removed-${stamp}@example.test`, `pending-${stamp}@example.test`]

try {
  const code = await codeOf()
  const join = (fields: Record<string, string>) => call(`/join/${code}`, { password: "projecttorch", time_zone: "Europe/Paris", ...fields })

  // Who sees the code: people who may invite, never clients.
  ok((await call("/bootstrap", undefined, await signIn("bob@acme.test"))).text.includes(code), "a member's copy has the team link")
  ok(!(await call("/bootstrap", undefined, await signIn("dan@northwind.test"))).text.includes(code), "a client's copy doesn't")

  ok(JSON.parse((await call(`/join/${code}`)).text).data.state === "team", "the link opens the team sign-up")
  ok((await join({ name: "", email: "nope" })).status === 422, "a missing name and a bad email are refused")

  const first = await join({ name: "New Person", email: made[0]! })
  const [np] = await db`select role, joined_at, time_zone from people where email = ${made[0]}`
  ok(first.sid && np?.role === "member" && np.joined_at && np.time_zone === "Europe/Paris", "joining makes a member and signs them in")
  ok((await join({ name: "New Person", email: made[0]! })).text.includes("already in Acme"), "joining twice says they're already in")

  const [acme] = await db`select id from accounts where name = 'Acme'`
  await db`insert into people (account_id, name, email, role, joined_at, removed_at) values (${acme.id}, 'Gone', ${made[1]}, 'member', now(), now())`
  ok((await join({ name: "Gone", email: made[1]! })).text.includes("can't join"), "someone removed can't come back through the link")

  await db`insert into people (account_id, name, email, role, invite_token, invited_at) values (${acme.id}, 'Pending', ${made[2]}, 'client', ${"tok-" + stamp}, now())`
  const claim = await join({ name: "Pending", email: made[2]! })
  const [pend] = await db`select joined_at from people where email = ${made[2]}`
  ok(claim.text.includes("invitation waiting") && !pend?.joined_at, "a pending invitation can't be claimed through the link, only from its email")

  ok((await call("/people/join-link", {}, await signIn("bob@acme.test"))).status === 403, "a member can't make a new link")
  await call("/people/join-link", {}, await signIn("maya@acme.test"))
  const fresh = await codeOf()
  ok(fresh !== code && JSON.parse((await call(`/join/${code}`)).text).data.state === "gone", "an admin's new link kills the old one")
  ok(JSON.parse((await call(`/join/${fresh}`)).text).data.state === "team", "and the new one works")
} finally {
  await db`delete from people where email in ${db(made)}`
  await db`delete from logins where email in ${db(made)}`
}
console.log(failed ? `${failed} failed` : "All good.")
process.exit(failed ? 1 : 0)
