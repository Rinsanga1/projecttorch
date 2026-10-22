// Team questions: questions, new question, question & its answers, answer, plus the job that asks.
// question data: frequency (daily|weekly|biweekly|monthly), days[0-6], time "HH:MM", asked_ids[], paused, last_asked{personId: "YYYY-MM-DD"}
// The pages are client/areas/checkins.tsx (which also has `summary`); these are their posts and the job.
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { post, redirect, invalid, str, ids, bool, isClient, NoAccess, type Ctx, type Person } from "../lib/web.ts"
import { findProject, findRecording, projectPeople, createRecording, updateRecording, urlFor, sendEmail, type Recording } from "../lib/core.ts"
import type { Seed } from "../seed.ts"

const FREQUENCIES = { daily: "Every day", weekly: "Every week", biweekly: "Every other week", monthly: "Once a month" } as const
type Frequency = keyof typeof FREQUENCIES

type QData = { frequency: Frequency; days: number[]; time: string; asked_ids: number[]; paused?: boolean; last_asked?: Record<string, string> }
const qdata = (q: Recording) => q.data as QData

/** Wall-clock now in a time zone. Mirrored in client/areas/checkins.tsx. */
const localNow = (tz: string, now = new Date()) => {
  const l = new Date(now.toLocaleString("en-US", { timeZone: tz }))
  const date = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`
  return { date, hhmm: l.toTimeString().slice(0, 5), dow: l.getDay() }
}

/** Is this question asked on `date` (a local YYYY-MM-DD)? Mirrored in client/areas/checkins.tsx. */
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

// ---------- routes ----------
export const routes = [
  post("/projects/:id/questions", (c) =>
    Effect.gen(function* () {
      const p = yield* findProject(c, c.params.id)
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(p)
      const q = readQuestion(yield* c.form)
      q.asked_ids = q.asked_ids.filter((id) => people.some((x) => x.id === id))
      const errs = validate(q)
      if (errs.length) return invalid(errs)
      const data: QData = { frequency: q.frequency, days: q.days, time: q.time, asked_ids: q.asked_ids }
      data.last_asked = skipToday({ data, created_at: new Date() } as any, people.filter((x) => q.asked_ids.includes(x.id)))
      const r = yield* createRecording(c, { project: p, type: "question", title: q.title, data, visible_to_clients: q.visible_to_clients, verb: "started asking" })
      return redirect(urlFor(r), "Got it. We'll start asking.")
    })),

  post("/projects/:id/questions/:qid/edit", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      if (isClient(c.me)) return yield* new NoAccess()
      const people = yield* projectPeople(project)
      const input = readQuestion(yield* c.form)
      input.asked_ids = input.asked_ids.filter((id) => people.some((x) => x.id === id))
      const errs = validate(input)
      if (errs.length) return invalid(errs)
      const data: QData = { ...qdata(q), frequency: input.frequency, days: input.days, time: input.time, asked_ids: input.asked_ids }
      data.last_asked = skipToday({ data, created_at: q.created_at } as any, people.filter((x) => input.asked_ids.includes(x.id) && !qdata(q).asked_ids.includes(x.id)))
      const u = yield* updateRecording(c, q, { title: input.title, data, visible_to_clients: people.some(isClient) ? input.visible_to_clients : q.visible_to_clients })
      return redirect(urlFor(u), "Saved.")
    })),

  post("/projects/:id/questions/:qid/pause", (c) => setPaused(c, true)),
  post("/projects/:id/questions/:qid/resume", (c) => setPaused(c, false)),

  post("/projects/:id/questions/:qid/answers", (c) =>
    Effect.gen(function* () {
      const { r: q, project } = yield* findRecording(c, c.params.qid, "question")
      if (q.status !== "active") return redirect(urlFor(q), "This question isn't taking answers.")
      const body = str(yield* c.form, "body")
      if (!body) return redirect(`/projects/${project.id}/questions/${q.id}/answers/new`, "Your answer was empty, so nothing was posted.")
      const a = yield* createRecording(c, { project, type: "answer", parent_id: q.id, body, visible_to_clients: q.visible_to_clients, verb: `answered “${q.title}”` })
      return redirect(`${urlFor(q)}#answer-${a.id}`, "Thanks for answering.")
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
