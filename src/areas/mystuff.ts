// Me: the menu, assignments, calendar, bookmarks, drafts, activity, reactions, reminders,
// profile, appearance, login & security, apps, help.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, fmtDate, fmtDateTime, excerpt, checked, selected } from "../lib/html.ts"
import { get, post, redirect, render, str, errors, isAdmin, isOutOfOffice, isQuiet, type Ctx } from "../lib/web.ts"
import { findRecording, updateRecording, logEvent, notify, titleOf, urlFor, TYPE_NAMES, type Recording } from "../lib/core.ts"
import { activityList } from "./project.ts"
import { savePrefs } from "./hey.ts"
import type { Seed } from "../seed.ts"

const MY = [["Me", "/my"]] as const

/** A date (YYYY-MM-DD) in a time zone, `offset` days from today. */
const dayIn = (tz: string, offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: tz })

type Assigned = Recording & { project_name: string; parent_title: string | null }

const assignmentItem = (c: Ctx, r: Assigned, done: boolean) => html`<li>
  ${done ? "✓ " : html`<form method="post" action="/my/assignments/${r.id}/complete" style="display:inline"><button title="Mark done">☐</button></form> `}
  <a href="${urlFor(r)}">${titleOf(r)}</a>
  <small>(${TYPE_NAMES[r.type]}${r.parent_title ? ` on ${r.parent_title}` : ""} · ${r.project_name}${r.data.due_on ? ` · due ${fmtDate(r.data.due_on)}` : ""}${done && r.data.completed_at ? ` · done ${fmtDate(r.data.completed_at, c.me.time_zone)}` : ""})</small>
</li>`

/** Where "Continue editing" goes for a draft. */
const draftEditPath = (r: Recording) =>
  r.type === "message" ? `/projects/${r.project_id}/posts/${r.id}/edit`
  : r.type === "doc" ? `/projects/${r.project_id}/docs/${r.id}/edit`
  : `/r/${r.id}/go`

const TIME_ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((z) => z !== "UTC")]

const profileForm = (c: Ctx, p: { name: string; title: string; bio: string; location: string; time_zone: string; avatar_url: string }, errs: string[]) => html`
${errors(errs)}
<form method="post" action="/my/profile">
  ${p.avatar_url ? html`<p><img src="${p.avatar_url}" alt="Your photo" width="64" height="64"></p>` : ""}
  <p><label>Photo (a link to a JPG, PNG or GIF)<br><input type="url" name="avatar_url" value="${p.avatar_url}" size="60" placeholder="https://…/me.jpg"></label></p>
  <p><label>Name<br><input name="name" value="${p.name}" required></label></p>
  <p><label>Title<br><input name="title" value="${p.title}" placeholder="Designer"></label></p>
  <p><label>About you<br><textarea name="bio" rows="3" cols="60">${p.bio}</textarea></label></p>
  <p><label>Location<br><input name="location" value="${p.location}"></label></p>
  <p><label>Time zone<br><select name="time_zone">${TIME_ZONES.map((z) => html`<option${selected(z === p.time_zone)}>${z}</option>`)}</select></label></p>
  <p><button>Save changes</button></p>
</form>
<p><small>ponytail: photo is a link for now; upload and crop come with file storage.</small></p>
<p><a href="/people/${c.me.id}">See your profile as others do</a></p>`

const securityPage = (c: Ctx, errs: string[], codes?: string[]) => html`
<h1>Login & security</h1>
${errors(errs)}
<p><small>ponytail: there's no sign-in yet, so passwords aren't stored. These forms validate and record your choices.</small></p>
<h2>Email address</h2>
<form method="post" action="/my/security/email">
  <p><label>Email <input type="email" name="email" value="${c.me.email}" required></label> <button>Change email</button></p>
</form>
<h2>Change password</h2>
<form method="post" action="/my/security/password">
  <p><label>Current password<br><input type="password" name="current" autocomplete="current-password"></label></p>
  <p><label>New password<br><input type="password" name="new" autocomplete="new-password" minlength="8"></label></p>
  <p><label>New password again<br><input type="password" name="confirm" autocomplete="new-password"></label></p>
  <button>Change password</button>
</form>
<h2>Two-step verification</h2>
${c.me.prefs.two_factor
  ? html`<p>Two-step verification is on.</p>
  ${codes ? html`<p><b>Save these backup codes somewhere safe.</b> Each one works once if you lose your phone.</p><ul>${codes.map((k) => html`<li><code>${k}</code></li>`)}</ul>` : ""}
  <form method="post" action="/my/security/two-factor"><button>Turn off two-step verification</button></form>`
  : html`<p>Add a code from an authenticator app on top of your password.</p>
  <form method="post" action="/my/security/two-factor"><button>Set up two-step verification</button></form>`}
<h2>Sign in with Google</h2>
<form method="post" action="/my/security/google"><button>${c.me.prefs.google ? "Turn off Sign in with Google" : "Turn on Sign in with Google"}</button></form>
<h2>Where you're signed in</h2>
<ul><li>This browser (now)</li></ul>
<form method="post" action="/my/security/sign-out-others"><button>Sign out everywhere else</button></form>`

export const routes = [
  get("/my", (c) =>
    Effect.gen(function* () {
      return yield* render(c, "Me", html`
<h1>Me</h1>
<p><b>${c.me.name}</b>${c.me.title ? `, ${c.me.title}` : ""}${isQuiet(c.me) ? " · ☾ notifications paused" : ""}${isOutOfOffice(c.me) ? ` · out of office until ${fmtDate(c.me.prefs.ooo!.until)}` : ""}</p>
<ul>
  <li><a href="/my/assignments">My Assignments</a></li>
  <li><a href="/my/calendar">My Calendar</a></li>
  <li><a href="/my/bookmarks">My Bookmarks</a></li>
  <li><a href="/my/drafts">My Drafts</a></li>
  <li><a href="/my/activity">My Activity</a></li>
  <li><a href="/my/reactions">My Reactions</a></li>
  <li><a href="/my/reminders">My Reminders</a></li>
</ul>
<ul>
  <li><a href="/my/profile">Profile</a></li>
  <li><a href="/my/notifications">Notification settings</a></li>
  <li><a href="/my/out-of-office">Out of office</a></li>
  <li><a href="/my/appearance">Appearance</a></li>
  <li><a href="/my/security">Login & security</a></li>
  <li><a href="/my/apps">Get the apps</a></li>
  ${isAdmin(c.me) ? html`<li><a href="/admin">Admin</a></li>` : ""}
  <li><a href="/help">Help</a></li>
  <li><a href="/accounts">Switch accounts</a></li>
</ul>
<form method="post" action="/signout"><button>Sign out</button></form>`)
    })),

  get("/my/assignments", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const done = c.query.get("completed") === "1"
      const byProject = c.query.get("group") === "project"
      const rows = yield* sql<Assigned>`
        select r.*, p.name as project_name, parent.title as parent_title from recordings r
        join projects p on p.id = r.project_id left join recordings parent on parent.id = r.parent_id and r.type = 'step'
        where r.account_id = ${c.me.account_id} and r.type in ('todo','card','step') and r.status = 'active' and p.status = 'active'
          and r.data->'assignee_ids' @> ${JSON.stringify([c.me.id])}::jsonb
          and ${done ? sql`(r.data->>'completed_at') is not null and (r.data->>'completed_at')::timestamptz > now() - interval '30 days'` : sql`(r.data->>'completed_at') is null`}
        order by ${done ? sql`r.data->>'completed_at' desc` : sql`r.data->>'due_on' nulls last, r.id`}`
      const today = dayIn(c.me.time_zone)
      const soon = dayIn(c.me.time_zone, 7)
      const groups: [string, ReadonlyArray<Assigned>][] = done
        ? [["Completed in the last 30 days", rows]]
        : byProject
          ? [...rows.reduce((m, r) => m.set(r.project_name, [...(m.get(r.project_name) ?? []), r]), new Map<string, Assigned[]>())]
          : [
              ["Overdue", rows.filter((r) => r.data.due_on && r.data.due_on < today)],
              ["Due soon", rows.filter((r) => r.data.due_on && r.data.due_on >= today && r.data.due_on <= soon)],
              ["No due date", rows.filter((r) => !r.data.due_on)],
              ["Later", rows.filter((r) => r.data.due_on && r.data.due_on > soon)],
            ]
      return yield* render(c, "My Assignments", html`
<h1>My Assignments</h1>
<p>Everything on your plate, across every project.</p>
<p>${done
  ? html`<a href="/my/assignments">Back to what's open</a>`
  : html`Group by: ${byProject ? html`<a href="/my/assignments">date</a> · <b>project</b>` : html`<b>date</b> · <a href="/my/assignments?group=project">project</a>`} · <a href="/my/assignments?completed=1">Completed recently</a>`}</p>
${rows.length === 0
  ? html`<p>${done ? "Nothing completed in the last 30 days." : "Nothing's assigned to you right now."}</p>`
  : groups.filter(([, rs]) => rs.length).map(([label, rs]) => html`<h2>${label}</h2><ul>${rs.map((r) => assignmentItem(c, r, done))}</ul>`)}`, MY)
    })),

  post("/my/assignments/:rid/complete", (c) =>
    Effect.gen(function* () {
      const { r } = yield* findRecording(c, c.params.rid, ["todo", "card", "step"])
      if (!(r.data.assignee_ids ?? []).includes(c.me.id)) return redirect("/my/assignments", "That isn't assigned to you.")
      if (r.data.completed_at) return redirect("/my/assignments", "That's already done.")
      const u = yield* updateRecording(c, r, { data: { completed_at: new Date().toISOString(), completer_id: c.me.id } }, { quiet: true })
      yield* logEvent(c, { project_id: r.project_id, recording_id: r.id, action: "completed", summary: `completed ${titleOf(r)}` })
      yield* notify(c, { personIds: r.data.notify_ids ?? [], recording: u, kind: "completed", summary: `${c.me.name} completed ${titleOf(r)}` })
      return redirect("/my/assignments", { msg: `Done: ${titleOf(r)}`, href: urlFor(r), label: "See it" })
    })),

  get("/my/calendar", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const today = dayIn(c.me.time_zone)
      const rows = yield* sql<Recording & { project_name: string; on_date: string }>`
        select r.*, p.name as project_name, left(coalesce(r.data->>'starts_at', r.data->>'due_on'), 10) as on_date
        from recordings r join projects p on p.id = r.project_id
        where r.account_id = ${c.me.account_id} and r.status = 'active' and p.status = 'active' and (
          (r.type = 'event' and (r.data->'participant_ids' @> ${JSON.stringify([c.me.id])}::jsonb or r.creator_id = ${c.me.id})
            and left(coalesce(r.data->>'ends_at', r.data->>'starts_at'), 10) >= ${today})
          or (r.type in ('todo','card','step') and r.data->'assignee_ids' @> ${JSON.stringify([c.me.id])}::jsonb
            and (r.data->>'completed_at') is null and (r.data->>'due_on') >= ${today}))
        order by on_date, r.id limit 200`
      const days = rows.reduce((m, r) => m.set(r.on_date, [...(m.get(r.on_date) ?? []), r]), new Map<string, typeof rows[number][]>())
      return yield* render(c, "My Calendar", html`
<h1>My Calendar</h1>
<p>Your events and due dates, across every project.</p>
${rows.length === 0
  ? html`<p>No upcoming dates for you.</p>`
  : [...days].map(([d, rs]) => html`<h2>${d === today ? "Today" : fmtDate(d)}</h2><ul>${rs.map((r) => html`<li>
      ${r.type === "event" ? "📅 " : "☐ "}<a href="${urlFor(r)}">${titleOf(r)}</a> <small>(${r.type === "event" ? "event" : `${TYPE_NAMES[r.type]} due`} · ${r.project_name})</small></li>`)}</ul>`)}
<p><a href="/my/calendar/feed">Add these dates to your own calendar app</a></p>`, MY)
    })),

  get("/my/bookmarks", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ id: number; project_id: number | null; recording_id: number | null; project_name: string | null; created_at: Date; title: string | null; body: string | null; type: string | null; rec_project: string | null }>`
        select b.id, b.project_id, b.recording_id, b.created_at, p.name as project_name, r.title, r.body, r.type, rp.name as rec_project
        from bookmarks b left join projects p on p.id = b.project_id left join recordings r on r.id = b.recording_id left join projects rp on rp.id = r.project_id
        where b.person_id = ${c.me.id} order by b.created_at desc`
      return yield* render(c, "My Bookmarks", html`
<h1>My Bookmarks</h1>
${rows.length === 0
  ? html`<p>Bookmark anything with the ribbon icon and it'll be waiting here.</p>`
  : html`<ul>${rows.map((b) => html`<li>
    ${b.recording_id
      ? html`<a href="/r/${b.recording_id}/go">${titleOf({ type: b.type ?? "", title: b.title ?? "", body: b.body ?? "" })}</a> <small>(${TYPE_NAMES[b.type ?? ""] ?? "item"} · ${b.rec_project})</small>`
      : html`<a href="/projects/${b.project_id}">${b.project_name}</a> <small>(project)</small>`}
    <form method="post" action="/my/bookmarks/${b.id}/delete" style="display:inline"><button>Remove</button></form></li>`)}</ul>`}`, MY)
    })),

  post("/my/bookmarks/:bid/delete", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from bookmarks where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id}`
      return redirect("/my/bookmarks", "Bookmark removed.")
    })),

  get("/my/drafts", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const drafts = yield* sql<Recording & { project_name: string }>`
        select r.*, p.name as project_name from recordings r join projects p on p.id = r.project_id
        where r.creator_id = ${c.me.id} and r.status = 'drafted' order by r.updated_at desc`
      return yield* render(c, "My Drafts", html`
<h1>My Drafts</h1>
${drafts.length === 0
  ? html`<p>No drafts. Anything you save as a draft shows up here.</p>`
  : html`<ul>${drafts.map((r) => html`<li>
    <b>${titleOf(r)}</b> <small>(${TYPE_NAMES[r.type]} · ${r.project_name} · saved ${fmtDateTime(r.updated_at, c.me.time_zone)})</small>
    ${r.body ? html`<br>${excerpt(r.body, 100)}` : ""}
    <br><a href="${draftEditPath(r)}">Continue editing</a>
    <form method="post" action="/my/drafts/${r.id}/discard" style="display:inline"><button>Discard</button></form></li>`)}</ul>`}`, MY)
    })),

  post("/my/drafts/:rid/discard", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`delete from recordings where id = ${Number(c.params.rid) || 0} and creator_id = ${c.me.id} and status = 'drafted'`
      return redirect("/my/drafts", "Draft discarded.")
    })),

  get("/my/activity", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const pageN = Math.max(1, Number(c.query.get("page")) || 1)
      const evs = yield* sql<{ summary: string; created_at: Date; name: string | null; recording_id: number | null; project_name: string; project_id: number | null }>`
        select e.summary, e.created_at, pe.name, pe.avatar_url, e.recording_id, p.name as project_name, e.project_id
        from events e left join people pe on pe.id = e.person_id left join projects p on p.id = e.project_id
        where e.person_id = ${c.me.id} order by e.created_at desc limit 51 offset ${(pageN - 1) * 50}`
      return yield* render(c, "My Activity", html`
<h1>My Activity</h1>
${evs.length ? activityList(evs.slice(0, 50), c.me.time_zone) : html`<p>You haven't done anything yet. Your posts, comments and check-offs show up here.</p>`}
${evs.length > 50 ? html`<p><a href="/my/activity?page=${pageN + 1}">Show more</a></p>` : ""}`, MY)
    })),

  get("/my/reactions", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      type B = { id: number; content: string; created_at: Date; recording_id: number; name: string; title: string; body: string; type: string }
      const got = yield* sql<B>`
        select b.id, b.content, b.created_at, b.recording_id, pe.name, r.title, r.body, r.type from boosts b
        join recordings r on r.id = b.recording_id join people pe on pe.id = b.person_id
        where r.creator_id = ${c.me.id} and b.person_id <> ${c.me.id} order by b.created_at desc limit 100`
      const gave = yield* sql<B>`
        select b.id, b.content, b.created_at, b.recording_id, coalesce(pe.name, 'someone') as name, r.title, r.body, r.type from boosts b
        join recordings r on r.id = b.recording_id left join people pe on pe.id = r.creator_id
        where b.person_id = ${c.me.id} order by b.created_at desc limit 100`
      const list = (bs: ReadonlyArray<B>, who: (b: B) => string) =>
        html`<ul>${bs.map((b) => html`<li>${b.content} · ${who(b)} · <a href="/r/${b.recording_id}/go">${titleOf(b)}</a> <small>${fmtDate(b.created_at, c.me.time_zone)}</small></li>`)}</ul>`
      return yield* render(c, "My Reactions", html`
<h1>My Reactions</h1>
${!got.length && !gave.length ? html`<p>No reactions yet.</p>` : ""}
<h2>Reactions you got</h2>
${got.length ? list(got, (b) => `from ${b.name}`) : html`<p>None yet.</p>`}
<h2>Reactions you gave</h2>
${gave.length ? list(gave, (b) => `to ${b.name}`) : html`<p>None yet.</p>`}`, MY)
    })),

  get("/my/reminders", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      type U = { id: number; bubble_at: Date; surfaced_at: Date | null; recording_id: number; title: string; body: string; type: string }
      const rows = yield* sql<U>`
        select u.id, u.bubble_at, u.surfaced_at, u.recording_id, r.title, r.body, r.type from bubble_ups u join recordings r on r.id = u.recording_id
        where u.person_id = ${c.me.id} and u.cancelled_at is null order by u.bubble_at`
      const upcoming = rows.filter((u) => !u.surfaced_at)
      const past = rows.filter((u) => u.surfaced_at).reverse().slice(0, 30)
      return yield* render(c, "My Reminders", html`
<h1>My Reminders</h1>
${!rows.length ? html`<p>No reminders yet. Pick “Remind me later” in any item's ••• menu. We'll bring it back to you.</p>` : ""}
<h2>Coming up</h2>
${upcoming.length
  ? html`<ul>${upcoming.map((u) => html`<li><a href="/r/${u.recording_id}/go">${titleOf(u)}</a> <small>${fmtDateTime(u.bubble_at, c.me.time_zone)}</small>
    <form method="post" action="/my/reminders/${u.id}/cancel" style="display:inline"><button>Cancel</button></form></li>`)}</ul>`
  : html`<p>Nothing coming up.</p>`}
${past.length ? html`<h2>Already sent</h2><ul>${past.map((u) => html`<li><a href="/r/${u.recording_id}/go">${titleOf(u)}</a> <small>${fmtDateTime(u.surfaced_at, c.me.time_zone)}</small></li>`)}</ul>` : ""}`, MY)
    })),

  post("/my/reminders/:bid/cancel", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`update bubble_ups set cancelled_at = now() where id = ${Number(c.params.bid) || 0} and person_id = ${c.me.id} and surfaced_at is null`
      return redirect("/my/reminders", "Canceled. We won't remind you.")
    })),

  get("/my/profile", (c) =>
    Effect.gen(function* () {
      const m = c.me
      return yield* render(c, "Profile", html`<h1>Profile</h1>${profileForm(c, { name: m.name, title: m.title ?? "", bio: m.bio ?? "", location: m.location ?? "", time_zone: m.time_zone, avatar_url: m.avatar_url ?? "" }, [])}`, MY)
    })),

  post("/my/profile", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const fd = yield* c.form
      const p = { name: str(fd, "name"), title: str(fd, "title"), bio: str(fd, "bio"), location: str(fd, "location"), time_zone: str(fd, "time_zone"), avatar_url: str(fd, "avatar_url") }
      const errs = [
        ...(p.name ? [] : ["Your name can't be blank."]),
        ...(p.avatar_url && !/^https?:\/\/\S+\.(jpe?g|png|gif)(\?\S*)?$/i.test(p.avatar_url) ? ["That image didn't work. Use a JPG, PNG or GIF."] : []),
        ...(TIME_ZONES.includes(p.time_zone) ? [] : ["Pick a time zone from the list."]),
      ]
      if (errs.length) return yield* render(c, "Profile", html`<h1>Profile</h1>${profileForm(c, p, errs)}`, MY, 422)
      yield* sql`update people set name = ${p.name}, title = ${p.title || null}, bio = ${p.bio || null}, location = ${p.location || null},
        time_zone = ${p.time_zone}, avatar_url = ${p.avatar_url || null} where id = ${c.me.id}`
      return redirect("/my/profile", "Saved.")
    })),

  get("/my/appearance", (c) =>
    Effect.gen(function* () {
      const a = c.me.appearance
      return yield* render(c, "Appearance", html`
<h1>Appearance</h1>
<form method="post" action="/my/appearance">
  <p><label><input type="radio" name="appearance" value="light"${checked(a === "light")}> Light</label><br>
  <label><input type="radio" name="appearance" value="dark"${checked(a === "dark")}> Dark</label><br>
  <label><input type="radio" name="appearance" value="system"${checked(a !== "light" && a !== "dark")}> Match my system</label></p>
  <button>Save</button>
</form>
`, MY)
    })),

  post("/my/appearance", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const a = str(yield* c.form, "appearance")
      yield* sql`update people set appearance = ${["light", "dark"].includes(a) ? a : "system"} where id = ${c.me.id}`
      return redirect("/my/appearance", "Saved.")
    })),

  get("/my/security", (c) => render(c, "Login & security", securityPage(c, []), MY)),

  post("/my/security/email", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const email = str(yield* c.form, "email")
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return yield* render(c, "Login & security", securityPage(c, ["That doesn't look like an email address."]), MY, 422)
      const [taken] = yield* sql`select 1 from people where account_id = ${c.me.account_id} and lower(email) = lower(${email}) and id <> ${c.me.id}`
      if (taken) return yield* render(c, "Login & security", securityPage(c, ["Someone else here already uses that email."]), MY, 422)
      yield* sql`update people set email = ${email} where id = ${c.me.id}`
      return redirect("/my/security", "Email changed.")
    })),

  post("/my/security/password", (c) =>
    Effect.gen(function* () {
      const fd = yield* c.form
      // ponytail: no auth yet, so nothing is checked or stored. Only the shape of the form is validated.
      const errs = [
        ...(str(fd, "current") ? [] : ["Your current password isn't right."]),
        ...(str(fd, "new").length >= 8 ? [] : ["Pick a longer password: at least 8 characters."]),
        ...(str(fd, "new") === str(fd, "confirm") ? [] : ["The new passwords don't match."]),
      ]
      if (errs.length) return yield* render(c, "Login & security", securityPage(c, errs), MY, 422)
      return redirect("/my/security", "Password changed.")
    })),

  post("/my/security/two-factor", (c) =>
    Effect.gen(function* () {
      const on = !c.me.prefs.two_factor
      yield* savePrefs(c, { two_factor: on })
      if (!on) return redirect("/my/security", "Two-step verification is off.")
      // ponytail: fake backup codes shown once; real TOTP secrets and codes come with auth.
      const codes = Array.from({ length: 8 }, () => crypto.randomUUID().slice(0, 8))
      return yield* render(c, "Login & security", securityPage({ ...c, me: { ...c.me, prefs: { ...c.me.prefs, two_factor: true } } }, [], codes), MY)
    })),

  post("/my/security/google", (c) =>
    Effect.gen(function* () {
      yield* savePrefs(c, { google: !c.me.prefs.google })
      return redirect("/my/security", c.me.prefs.google ? "Sign in with Google is off." : "Sign in with Google is on.")
    })),

  post("/my/security/sign-out-others", () => Effect.succeed(redirect("/my/security", "Signed out everywhere else."))),

  get("/my/apps", (c) =>
    render(c, "Get the apps", html`
<h1>Get the apps</h1>
<p>Everything here is in the apps too, plus push notifications. <a href="/my/notifications">Notification settings</a></p>
<ul>
  <li>iPhone & iPad</li>
  <li>Android</li>
  <li>Mac</li>
  <li>Windows</li>
</ul>
<p><small>ponytail: no native apps yet. This page is where the download links go.</small></p>`, MY)),

  get("/help", (c) =>
    render(c, "Help", html`
<h1>Help</h1>
<h2>Guides and how-tos</h2>
<ul>
  <li><a href="/projects/new">Start a project</a>, then add people from its page.</li>
  <li><a href="/people/invite">Invite people</a> to your account, or clients to a project.</li>
  <li>Every item has a ••• menu: move, copy, bookmark, remind me later, trash.</li>
  <li><a href="/my/quiet-hours">Quiet hours</a> keep notifications to work hours.</li>
  <li><a href="/shortcuts">Keyboard shortcuts</a>: press ? anywhere, Ctrl/⌘ + K to go to any page.</li>
</ul>
<h2>What's new</h2>
<ul>
  <li>Out of office: say when you're away and when you're back. <a href="/my/out-of-office">Turn it on</a></li>
  <li>Reminders: bring anything back to your Updates later. <a href="/my/reminders">Your reminders</a></li>
</ul>
<h2>Contact support</h2>
<form method="post" action="/help/support">
  <p><label>What's going on?<br><textarea name="body" rows="5" cols="60" required></textarea></label></p>
  <button>Send to support</button>
</form>`)),

  post("/help/support", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const body = str(yield* c.form, "body")
      if (!body) return redirect("/help", "Tell us what's going on first.")
      yield* sql`insert into support_requests ${sql.insert({ person_id: c.me.id, body })}`
      return redirect("/help", `Sent. We'll reply to ${c.me.email}.`)
    })),
]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann } = s.people
    const msgs = yield* sql<{ id: number; title: string; creator_id: number }>`
      select id, title, creator_id from recordings where account_id = ${s.account.id} and type = 'message' and status = 'active' order by id`
    const kickoff = msgs.find((m) => m.title.startsWith("Kickoff"))
    const pitch = msgs.find((m) => m.title.startsWith("Idea"))
    yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, project_id: s.projects.marketing.id })}`
    if (kickoff) {
      yield* sql`insert into bookmarks ${sql.insert({ person_id: maya.id, recording_id: kickoff.id })}`
      yield* sql`insert into boosts ${sql.insert({ recording_id: kickoff.id, person_id: ann.id, content: "🔥 let's go" })}`
    }
    if (pitch) yield* sql`insert into boosts ${sql.insert([
      { recording_id: pitch.id, person_id: maya.id, content: "+1" },
      { recording_id: pitch.id, person_id: ann.id, content: "yes please" },
    ])}`
  })

