// Team questions: questions, new question, question & its answers, answer, plus the job that asks.
// question data: frequency (daily|weekly|biweekly|monthly), days[0-6], time "HH:MM", asked_ids[], paused, last_asked{personId: "YYYY-MM-DD"}
import * as stylex from "@stylexjs/stylex"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { html, raw, fmt, fmtDate, plural } from "../lib/html.ts"
import { get, post, redirect, render, str, ids, bool, errors, isAdmin, isClient, NoAccess, type Ctx, type Person } from "../lib/web.ts"
import {
  findProject, findRecording, projectPeople, createRecording, updateRecording, projectCrumbs, toolUrl, urlFor,
  clientSwitch, textArea, byLine, clientFilter, trackVisit, personById, peopleCheckboxes, peopleByIds, personLink, sendEmail,
  type Project, type Recording,
} from "../lib/core.ts"
import { itemFooter, statusBanner, clientBanner } from "./items.ts"
import type { Seed } from "../seed.ts"
import { face, kit, pageHead, sx } from "../lib/ui.ts"
import { color, media, radius, space, text } from "../lib/tokens.stylex.ts"

// Questions as cards; on a question, its answers by day, each answer a card with the person's face.
const ck = stylex.create({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  card: {
    position: "relative", borderTopWidth: 0, padding: space.s5, borderRadius: radius.xl, display: "grid", gap: space.s2, alignContent: "start", minHeight: 132,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  cardTitle: { fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit" } },
  group: { fontSize: text.xs, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: color.muted, marginTop: space.s6, marginBottom: space.s3 },
  asked: { fontSize: text.md, color: color.muted, marginBottom: space.s5 },
  manage: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, marginBottom: space.s5, maxWidth: "none" },
  day: { display: "flex", alignItems: "center", gap: space.s3, marginTop: space.s6, marginBottom: space.s3, fontSize: text.xs, fontWeight: 600,
    letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  rule: { flexGrow: 1, height: 1, backgroundColor: color.line },
  answers: { display: "grid", gap: space.s3 },
  answer: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, padding: space.s4, borderRadius: radius.xl, backgroundColor: color.tile },
  answerHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, marginBottom: 2 },
  answerFoot: { marginTop: space.s2, marginBottom: 0, fontSize: text.sm },
})

const FREQUENCIES = { daily: "Every day", weekly: "Every week", biweekly: "Every other week", monthly: "Once a month" } as const
type Frequency = keyof typeof FREQUENCIES
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

type QData = { frequency: Frequency; days: number[]; time: string; asked_ids: number[]; paused?: boolean; last_asked?: Record<string, string> }
const qdata = (q: Recording) => q.data as QData

const fmtClock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number]
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`
}
const listing = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`)

/** "every weekday at 4:30pm", "every other week on Monday at 9am", "on the first Monday of each month at 9am". */
const when = (d: QData) => {
  const days = [...d.days].sort()
  const names = listing(days.map((x) => DAY_NAMES[x]!))
  const at = `at ${fmtClock(d.time)}`
  if (d.frequency === "monthly") return `on the first ${names} of each month ${at}`
  if (d.frequency === "biweekly") return `every other week on ${names} ${at}`
  if (d.frequency === "weekly") return `every week on ${names} ${at}`
  if (days.length === 7) return `every day ${at}`
  if (days.join() === "1,2,3,4,5") return `every weekday ${at}`
  return `every ${names} ${at}`
}
export const summary = (q: Recording) => {
  const d = qdata(q)
  return `Asking ${plural(d.asked_ids.length, "person", "people")} ${when(d)}`
}

/** Wall-clock now in a time zone. */
const localNow = (tz: string, now = new Date()) => {
  const l = new Date(now.toLocaleString("en-US", { timeZone: tz }))
  const date = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`
  return { date, hhmm: l.toTimeString().slice(0, 5), dow: l.getDay() }
}

/** Is this question asked on `date` (a local YYYY-MM-DD)? */
const askedOn = (q: Recording, date: string) => {
  const d = qdata(q)
  const day = new Date(date + "T12:00:00Z")
  if (!d.days.includes(day.getUTCDay())) return false
  if (d.frequency === "monthly") return day.getUTCDate() <= 7
  if (d.frequency === "biweekly") {
    const weeks = Math.floor((day.getTime() - new Date(q.created_at).getTime()) / (7 * 86_400_000))
    return weeks % 2 === 0
  }
  return true
}

/** "today at 4:30pm", "Monday at 4:30pm", "Oct 30 at 9am". */
const nextAsk = (q: Recording, tz: string) => {
  const d = qdata(q)
  const now = localNow(tz)
  for (let i = 0; i < 62; i++) {
    const date = new Date(Date.parse(now.date + "T12:00:00Z") + i * 86_400_000).toISOString().slice(0, 10)
    if (!askedOn(q, date) || (i === 0 && now.hhmm >= d.time)) continue
    const day = i === 0 ? "today" : i < 7 ? DAY_NAMES[new Date(date + "T12:00:00Z").getUTCDay()]! : fmtDate(date)
    return `${day} at ${fmtClock(d.time)}`
  }
  return null
}

/** Mark people as already asked today if today's time has passed, so a new question doesn't fire late. */
const skipToday = (q: { data: QData; created_at: Date } & Pick<Recording, "data">, people: ReadonlyArray<Person>) => {
  const last = { ...(q.data.last_asked ?? {}) }
  for (const p of people) {
    const now = localNow(p.time_zone)
    if (!last[p.id] && now.hhmm >= q.data.time) last[p.id] = now.date
  }
  return last
}

// ---------- the form ----------
type QInput = { title: string; frequency: Frequency; days: number[]; time: string; asked_ids: number[]; visible_to_clients?: boolean }

const readQuestion = (fd: FormData): QInput => ({
  title: str(fd, "title"),
  frequency: (str(fd, "frequency") in FREQUENCIES ? str(fd, "frequency") : "daily") as Frequency,
  days: fd.getAll("days").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  time: /^\d{2}:\d{2}$/.test(str(fd, "time")) ? str(fd, "time") : "",
  asked_ids: ids(fd, "asked_ids"),
  visible_to_clients: bool(fd, "visible_to_clients"),
})

const validate = (q: QInput) => [
  ...(q.title ? [] : ["Type the question you want to ask."]),
  ...(q.asked_ids.length ? [] : ["Pick at least one person to ask."]),
  ...(q.days.length ? [] : ["Pick at least one day."]),
  ...(q.time ? [] : ["Pick a time of day to ask."]),
]

const questionForm = (p: Project, people: ReadonlyArray<Person & { company_name?: string | null }>, q: QInput, action: string, cancel: string, errs: string[]) => html`
${errors(errs)}
<form method="post" action="${action}">
  <p><label>What do you want to ask?<br><input name="title" size="60" value="${q.title}" required placeholder="What did you get done today?"></label></p>
  <p><label>How often? <select name="frequency">${Object.entries(FREQUENCIES).map(([k, v]) => html`<option value="${k}"${q.frequency === k ? raw(" selected") : ""}>${v}</option>`)}</select></label></p>
  <fieldset><legend>On which days?</legend>
    ${DAY_NAMES.map((d, i) => html`<label><input type="checkbox" name="days" value="${i}"${q.days.includes(i) ? raw(" checked") : ""}> ${d}</label> `)}
    <p><small>“Once a month” asks on the first of these days each month. “Every other week” skips alternate weeks.</small></p>
  </fieldset>
  <p><label>At what time? <input type="time" name="time" value="${q.time}" required></label> <small>(in each person's own time zone)</small></p>
  <p>Who should answer?</p>
  ${peopleCheckboxes("asked_ids", people, q.asked_ids)}
  ${clientSwitch(p, people, q.visible_to_clients)}
  <p><button>${action.endsWith("/edit") ? "Save changes" : "Start asking this question"}</button> <a href="${cancel}">Cancel</a></p>
</form>`

const answerCrumbs = (p: Project, q: Recording) => [...projectCrumbs(p, "checkins"), [q.title, urlFor(q)] as const]

// ---------- routes ----------
export const routes = [
  get("/projects/:id/questions", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const p = yield* findProject(c, c.params.id)
      const questions = yield* sql<Recording>`select * from recordings r where project_id = ${p.id} and type = 'question' and status = 'active' ${clientFilter(sql, c.me, "r")} order by position, id`
      const active = questions.filter((q) => !q.data.paused)
      const paused = questions.filter((q) => q.data.paused)
      yield* trackVisit(c, toolUrl(p, "checkins"), `${p.name}: Team questions`, p.id)
      const item = (q: Recording) => html`<li${sx(ck.card)}><a href="${urlFor(q)}"${sx(ck.cardTitle)}>${q.title}</a><small>${summary(q)}</small></li>`
      return yield* render(c, "Team questions", html`
${pageHead("Team questions", p.status === "active" && !isClient(c.me) ? html`<a href="/projects/${p.id}/questions/new" data-button>Ask a new question</a>` : "")}
${!questions.length ? html`<p${sx(kit.empty)}>Ask your team the same question on a set day and time, like “What did you get done today?” Their answers all show up here.</p>` : ""}
${active.length ? html`<ul${sx(ck.grid)}>${active.map(item)}</ul>` : ""}
${paused.length ? html`<h2${sx(ck.group)}>Paused</h2><ul${sx(ck.grid)}>${paused.map(item)}</ul>` : ""}`, projectCrumbs(p))
    })),

  get("/projects/:id/questions/new", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(p)
      const blank: QInput = { title: "", frequency: "daily", days: [1, 2, 3, 4, 5], time: "16:30", asked_ids: [] }
      return yield* render(c, "New question", html`<h1>Ask a new question</h1>${questionForm(p, people, blank, `/projects/${p.id}/questions`, toolUrl(p, "checkins"), [])}`, projectCrumbs(p, "checkins"))
    })),

  post("/projects/:id/questions", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(p)
      const q = readQuestion(yield* c.form)
      q.asked_ids = q.asked_ids.filter((id) => people.some((x) => x.id === id))
      const errs = validate(q)
      if (errs.length)
        return yield* render(c, "New question", html`<h1>Ask a new question</h1>${questionForm(p, people, q, `/projects/${p.id}/questions`, toolUrl(p, "checkins"), errs)}`, projectCrumbs(p, "checkins"), 422)
      const data: QData = { frequency: q.frequency, days: q.days, time: q.time, asked_ids: q.asked_ids }
      data.last_asked = skipToday({ data, created_at: new Date() } as any, people.filter((x) => q.asked_ids.includes(x.id)))
      const r = yield* createRecording(c, { project: p, type: "question", title: q.title, data, visible_to_clients: q.visible_to_clients, verb: "started asking" })
      return redirect(urlFor(r), "Got it. We'll start asking.")
    })),

  get("/projects/:id/questions/:qid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      const people = yield* projectPeople(project)
      const d = qdata(q)
      const asked = yield* peopleByIds(d.asked_ids)
      const personId = Number(c.query.get("person")) || null
      const answers = yield* sql<Recording & { creator_name: string | null; creator_avatar: string | null; comments: number }>`
        select r.*, pe.name as creator_name, pe.avatar_url as creator_avatar,
          (select count(*) from recordings x where x.parent_id = r.id and x.type = 'comment' and x.status = 'active')::int as comments
        from recordings r left join people pe on pe.id = r.creator_id
        where r.parent_id = ${q.id} and r.type = 'answer' and r.status = 'active' ${personId ? sql`and r.creator_id = ${personId}` : sql``}
        order by r.created_at desc limit 200`
      const answerers = yield* sql<{ id: number; name: string }>`select distinct pe.id, pe.name from recordings r join people pe on pe.id = r.creator_id
        where r.parent_id = ${q.id} and r.type = 'answer' and r.status = 'active' order by pe.name`
      const days = new Map<string, typeof answers[number][]>()
      for (const a of answers) {
        const k = fmtDate(a.created_at, c.me.time_zone)
        days.set(k, [...(days.get(k) ?? []), a])
      }
      const next = d.paused ? null : nextAsk(q, c.me.time_zone)
      yield* trackVisit(c, urlFor(q), q.title, project.id)
      return yield* render(c, q.title, html`
${statusBanner(q)}
${clientBanner(c, q, people.some(isClient))}
${d.paused ? html`<div role="note"><p><b>This question is paused.</b> Nobody's being asked until it's resumed.</p></div>` : ""}
${pageHead(q.title, q.status === "active" && !d.paused && d.asked_ids.includes(c.me.id) ? html`<a href="/projects/${project.id}/questions/${q.id}/answers/new" data-button>Answer now</a>` : "")}
<p${sx(ck.asked)}>${summary(q)}: ${asked.map((x, i) => html`${i ? ", " : ""}${personLink(x)}`)}.</p>
${q.status === "active" && !isClient(c.me) ? html`<div${sx(ck.manage)}>
  <a href="/projects/${project.id}/questions/${q.id}/edit" data-button>Edit</a>
  <form method="post" action="/projects/${project.id}/questions/${q.id}/${d.paused ? "resume" : "pause"}" style="display:inline"><button>${d.paused ? "Resume" : "Pause"}</button></form>
  <a href="/r/${q.id}/trash">Trash</a></div>` : ""}
${answerers.length > 1 || personId ? html`<form method="get"${sx(kit.toolbar)}><label>Show answers from <select name="person"${sx(kit.toolbarControl)}><option value="">everyone</option>
  ${answerers.map((x) => html`<option value="${x.id}"${x.id === personId ? raw(" selected") : ""}>${x.name}</option>`)}</select></label> <button${sx(kit.toolbarControl)}>Filter</button></form>` : ""}
${!answers.length
  ? html`<p${sx(kit.empty)}>${personId ? "No answers from this person yet." : next ? `No answers yet. The first one gets asked ${next}.` : "No answers yet."}</p>`
  : html`${[...days].map(([day, as]) => html`<h2${sx(ck.day)}><span>${day}</span><span${sx(ck.rule)}></span></h2><div${sx(ck.answers)}>${as.map((a) => html`
<article id="answer-${a.id}"${sx(ck.answer)}>
  ${face({ name: a.creator_name ?? "Someone", avatar_url: a.creator_avatar })}
  <div>
    <p${sx(ck.answerHead)}><b>${a.creator_name ?? "Someone"}</b> <small>${new Date(a.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: c.me.time_zone })}</small></p>
    <div${sx(kit.prose)}>${fmt(a.body)}</div>
    <p${sx(ck.answerFoot)}><a href="${urlFor(a)}">${a.comments ? plural(a.comments, "comment") : "Comment or react"}</a></p>
  </div>
</article>`)}</div>`)}`}
${yield* itemFooter(c, q, project, { comments: false })}`, projectCrumbs(project, "checkins"))
    })),

  get("/projects/:id/questions/:qid/edit", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      const d = qdata(q)
      const input: QInput = { title: q.title, frequency: d.frequency, days: d.days, time: d.time, asked_ids: d.asked_ids, visible_to_clients: q.visible_to_clients }
      return yield* render(c, "Edit question", html`<h1>Edit question</h1>${questionForm(project, people, input, `/projects/${project.id}/questions/${q.id}/edit`, urlFor(q), [])}`, answerCrumbs(project, q))
    })),

  post("/projects/:id/questions/:qid/edit", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      const input = readQuestion(yield* c.form)
      input.asked_ids = input.asked_ids.filter((id) => people.some((x) => x.id === id))
      const errs = validate(input)
      if (errs.length)
        return yield* render(c, "Edit question", html`<h1>Edit question</h1>${questionForm(project, people, input, `/projects/${project.id}/questions/${q.id}/edit`, urlFor(q), errs)}`, answerCrumbs(project, q), 422)
      const data: QData = { ...qdata(q), frequency: input.frequency, days: input.days, time: input.time, asked_ids: input.asked_ids }
      data.last_asked = skipToday({ data, created_at: q.created_at } as any, people.filter((x) => input.asked_ids.includes(x.id) && !qdata(q).asked_ids.includes(x.id)))
      const u = yield* updateRecording(c, q, { title: input.title, data, visible_to_clients: people.some(isClient) ? input.visible_to_clients : q.visible_to_clients })
      return redirect(urlFor(u), "Saved.")
    })),

  post("/projects/:id/questions/:qid/pause", (c) => setPaused(c, true)),
  post("/projects/:id/questions/:qid/resume", (c) => setPaused(c, false)),

  get("/projects/:id/questions/:qid/answers/new", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      return yield* render(c, "Answer", html`
<h1>${q.title}</h1>
<form method="post" action="/projects/${project.id}/questions/${q.id}/answers">
  ${textArea("Your answer", "body", "", "Write your answer…")}
  <p><button>Post my answer</button> <a href="${urlFor(q)}">Cancel</a></p>
</form>
<p><small>You can also just reply to the reminder email with your answer.</small></p>`, answerCrumbs(project, q))
    })),

  post("/projects/:id/questions/:qid/answers", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      if (q.status !== "active") return redirect(urlFor(q), "This question isn't taking answers.")
      const body = str(yield* c.form, "body")
      if (!body) return redirect(`/projects/${project.id}/questions/${q.id}/answers/new`, "Your answer was empty, so nothing was posted.")
      const a = yield* createRecording(c, { project, type: "answer", parent_id: q.id, body, visible_to_clients: q.visible_to_clients, verb: `answered “${q.title}”` })
      return redirect(`${urlFor(q)}#answer-${a.id}`, "Thanks for answering.")
    })),

  get("/projects/:id/answers/:aid", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: a, project } = yield* findRecording(c, c.params.aid, "answer")
      const [q] = yield* sql<Recording>`select * from recordings where id = ${a.parent_id}`
      const author = a.creator_id ? yield* personById(a.creator_id) : null
      return yield* render(c, `Answer: ${q!.title}`, html`
${statusBanner(a)}
<article>
  <p${sx(kit.tags)}><span${sx(kit.tag)}>Answer to</span> <a href="${urlFor(q!)}">${q!.title}</a></p>
  ${byLine(author, a.created_at, c.me.time_zone)}
  <div${sx(kit.prose)}>${fmt(a.body)}</div>
  ${a.creator_id === c.me.id && a.status === "active" ? html`<p><a href="/projects/${project.id}/answers/${a.id}/edit">Edit</a></p>` : ""}
</article>
${yield* itemFooter(c, a, project)}`, answerCrumbs(project, q!))
    })),

  get("/projects/:id/answers/:aid/edit", (c) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { r: a, project } = yield* findRecording(c, c.params.aid, "answer")
      if (a.creator_id !== c.me.id) return yield* new NoAccess()
      const [q] = yield* sql<Recording>`select * from recordings where id = ${a.parent_id}`
      return yield* render(c, "Edit answer", html`
<h1>Edit your answer to “${q!.title}”</h1>
<form method="post" action="/projects/${project.id}/answers/${a.id}/edit">
  ${textArea("Your answer", "body", a.body)}
  <p><button>Save changes</button> <a href="${urlFor(a)}">Cancel</a></p>
</form>`, answerCrumbs(project, q!))
    })),

  post("/projects/:id/answers/:aid/edit", (c) =>
    Effect.gen(function* () {
      const { r: a } = yield* findRecording(c, c.params.aid, "answer")
      if (a.creator_id !== c.me.id) return yield* new NoAccess()
      const body = str(yield* c.form, "body")
      if (!body) return redirect(`/projects/${a.project_id}/answers/${a.id}/edit`, "An answer can't be empty. Trash it instead?")
      const u = yield* updateRecording(c, a, { body })
      return redirect(urlFor(u), "Saved.")
    })),
]

const setPaused = (c: Ctx, paused: boolean) =>
  Effect.gen(function* () {
    const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
    if (isClient(c.me)) return yield* new NoAccess()
    const people = paused ? [] : (yield* projectPeople(project)).filter((x) => qdata(q).asked_ids.includes(x.id))
    // Resuming late in the day shouldn't fire a question that's already past its time.
    const last_asked = paused ? qdata(q).last_asked : skipToday({ data: { ...qdata(q), last_asked: {} }, created_at: q.created_at } as any, people)
    const u = yield* updateRecording(c, q, { data: { paused, last_asked: { ...qdata(q).last_asked, ...last_asked } } }, { summary: `${paused ? "paused" : "resumed"} the question ${q.title}` })
    return redirect(urlFor(u), paused ? "Paused. Nobody will be asked until you resume it." : "Resumed.")
  })

/** Every minute: ask each person whose question is due now in their time zone and who hasn't been asked today. */
const askDueQuestions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const qs = yield* sql<Recording>`select r.* from recordings r join projects p on p.id = r.project_id
    where r.type = 'question' and r.status = 'active' and p.status = 'active' and coalesce((r.data->>'paused')::boolean, false) = false`
  for (const q of qs) {
    const d = qdata(q)
    if (!d.asked_ids?.length) continue
    const people = yield* sql<Person>`select * from people where id in ${sql.in(d.asked_ids)} and removed_at is null and joined_at is not null`
    const last = { ...(d.last_asked ?? {}) }
    let asked = 0
    for (const p of people) {
      const now = localNow(p.time_zone)
      if (last[p.id] === now.date || now.hhmm < d.time || !askedOn(q, now.date)) continue
      const link = `/projects/${q.project_id}/questions/${q.id}/answers/new`
      yield* sql`insert into notifications ${sql.insert({ person_id: p.id, recording_id: q.id, project_id: q.project_id, actor_id: q.creator_id, kind: "checkin", summary: `Team question: ${q.title}` })}`
      yield* sendEmail(p, { subject: q.title, body: `${q.title}\n\nJust reply to this email with your answer.`, kind: "checkin", link, reply_to_recording_id: q.id })
      last[p.id] = now.date
      asked++
    }
    if (asked) yield* sql`update recordings set data = data || ${JSON.stringify({ last_asked: last })}::jsonb where id = ${q.id}`
  }
})

export const jobs = [askDueQuestions]

export const seed = (s: Seed) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const { maya, ann, bob, cara } = s.people
    const todayFor = (p: Person) => localNow(p.time_zone).date
    const daily = yield* createRecording(s.as(maya), {
      project: s.projects.website, type: "question", title: "What did you get done today?",
      data: { frequency: "daily", days: [1, 2, 3, 4, 5], time: "16:30", asked_ids: [ann.id, bob.id], last_asked: { [ann.id]: todayFor(ann), [bob.id]: todayFor(bob) } },
      verb: "started asking",
    })
    const answers: Array<[Person, number, string]> = [
      [ann, 3, "Homepage sketches, three directions. Leaning toward the plain one."],
      [bob, 3, "Set up the static site build. Deploys in 40 seconds."],
      [ann, 2, "Pricing page copy with Maya. Cut it in half."],
      [bob, 2, "Ported the old blog posts. 212 of them, ugh."],
      [ann, 1, "Picked type. Two faces, that's it."],
    ]
    for (const [who, daysAgo, body] of answers) {
      const a = yield* createRecording(s.as(who), { project: s.projects.website, type: "answer", parent_id: daily.id, body, verb: `answered “${daily.title}”` })
      const at = new Date(Date.now() - daysAgo * 86_400_000)
      at.setUTCHours(22, 45, 0, 0)
      yield* sql`update recordings set created_at = ${at}, updated_at = ${at} where id = ${a.id}`
    }
    yield* createRecording(s.as(maya), {
      project: s.projects.hq, type: "question", title: "What's your plan for this week?",
      data: { frequency: "weekly", days: [1], time: "09:00", asked_ids: [ann.id, bob.id, cara.id], paused: true },
      verb: "started asking",
    })
  })
