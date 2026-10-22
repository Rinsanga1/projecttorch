// Team questions: questions, new question, question & its answers, answer. Posts and the job that asks:
// src/areas/checkins.ts.
// question data: frequency (daily|weekly|biweekly|monthly), days[0-6], time "HH:MM", asked_ids[], paused, last_asked{personId: "YYYY-MM-DD"}
import * as stylex from "@stylexjs/stylex"
import { Fragment } from "react"
import { Form as GetForm, useParams, useSearchParams } from "react-router"
import { db } from "../store.ts"
import { me, findProject, findRecording, projectPeople, peopleByIds, personById, recordings, commentCount, useVisit, NoAccess, NotFound, type PersonWithCompany } from "../data.ts"
import { isClient, toolUrl, urlFor, type Project, type Recording } from "../../shared/domain.ts"
import { excerpt, fmtDate, ms, plural } from "../../shared/format.ts"
import { ByLine, Face, Fmt, PageHead, kit, sx } from "../ui/kit.tsx"
import { ClientSwitch, Form, PeopleCheckboxes, submitOnChange, TextArea } from "../ui/forms.tsx"
import { Page, page, projectCrumbs, type Crumb } from "../ui/page.tsx"
import { color, media, radius, space, text } from "../ui/tokens.stylex.ts"
import { ClientBanner, ItemFooter, StatusBanner } from "./items.tsx"

// Questions as cards; on a question, its answers by day, each answer a card with the person's face.
const ck = stylex.create({
  // auto-fit: one question fills the row instead of sitting as a half-width card.
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: space.s3, margin: 0, marginBottom: space.s5 },
  card: {
    position: "relative", borderTopWidth: 0, padding: space.s5, borderRadius: radius.xl, display: "grid", gap: space.s2, alignContent: "start", minHeight: 132,
    backgroundColor: { default: color.tile, ":hover": { default: null, [media.hover]: color.tileHover } },
  },
  cardTitle: { fontSize: text.md, fontWeight: 650, letterSpacing: "-0.02em", textDecoration: "none",
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: "inherit" } },
  latest: { display: "grid", gap: space.s1, margin: 0, marginTop: space.s2, fontSize: text.sm },
  latestItem: { borderTopWidth: 0, paddingBlock: 0, color: color.muted },
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
/** "Asking 2 people every weekday at 4:30pm". */
export const summary = (q: Recording) => {
  const d = qdata(q)
  return `Asking ${plural(d.asked_ids.length, "person", "people")} ${when(d)}`
}

/** Wall-clock now in a time zone. Mirrors src/areas/checkins.ts. */
const localNow = (tz: string, now = new Date()) => {
  const l = new Date(now.toLocaleString("en-US", { timeZone: tz }))
  const date = `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}-${String(l.getDate()).padStart(2, "0")}`
  return { date, hhmm: l.toTimeString().slice(0, 5), dow: l.getDay() }
}

/** Is this question asked on `date` (a local YYYY-MM-DD)? Mirrors src/areas/checkins.ts. */
const askedOn = (q: Recording, date: string) => {
  const d = qdata(q)
  const day = new Date(date + "T12:00:00Z")
  if (!d.days.includes(day.getUTCDay())) return false
  if (d.frequency === "monthly") return day.getUTCDate() <= 7
  if (d.frequency === "biweekly") {
    const weeks = Math.floor((day.getTime() - ms(q.created_at)) / (7 * 86_400_000))
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

// ---------- the form ----------
type QInput = { title: string; frequency: Frequency; days: number[]; time: string; asked_ids: number[]; visible_to_clients?: boolean }

const QuestionForm = ({ p, people, q, action, cancel }: { p: Project; people: PersonWithCompany[]; q: QInput; action: string; cancel: string }) => (
  <Form action={action}>
    <p><label>What do you want to ask?<br /><input name="title" size={60} defaultValue={q.title} required placeholder="What did you get done today?" /></label></p>
    <p><label>How often? <select name="frequency" defaultValue={q.frequency}>{Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></p>
    <fieldset><legend>On which days?</legend>
      {DAY_NAMES.map((d, i) => <Fragment key={i}><label><input type="checkbox" name="days" value={i} defaultChecked={q.days.includes(i)} /> {d}</label> </Fragment>)}
      <p><small>“Once a month” asks on the first of these days each month. “Every other week” skips alternate weeks.</small></p>
    </fieldset>
    <p><label>At what time? <input type="time" name="time" defaultValue={q.time} required /></label> <small>(in each person's own time zone)</small></p>
    <p>Who should answer?</p>
    <PeopleCheckboxes name="asked_ids" people={people} checked={q.asked_ids} />
    <ClientSwitch project={p} people={people} current={q.visible_to_clients} />
    <p><button>{action.endsWith("/edit") ? "Save changes" : "Start asking this question"}</button> <a href={cancel}>Cancel</a></p>
  </Form>
)

const answerCrumbs = (p: Project, q: Recording): Crumb[] => [...projectCrumbs(p, "checkins"), [q.title, urlFor(q)]]

/** The question an answer belongs to. */
const questionOf = (a: Recording) => {
  const q = db.recordings.get(String(a.parent_id))
  if (!q) throw new NotFound()
  return q
}

// ---------- pages ----------
export const routes = [
  page("/projects/:id/questions", () => {
    const p = findProject(useParams().id)
    useVisit(toolUrl(p, "checkins"), `${p.name}: Team questions`, p.id)
    const questions = recordings((r) => r.project_id === p.id && r.type === "question" && r.status === "active").sort((a, b) => a.position - b.position || a.id - b.id)
    const active = questions.filter((q) => !q.data.paused)
    const paused = questions.filter((q) => q.data.paused)
    // A question shows its newest answers, so the start page says what people said, not just what was asked.
    const item = (q: Recording) => {
      const latest = recordings((a) => a.parent_id === q.id && a.type === "answer" && a.status === "active").sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3)
      return (
        <li key={q.id} {...sx(ck.card)}><a href={urlFor(q)} {...sx(ck.cardTitle)}>{q.title}</a><small>{summary(q)}</small>
          {latest.length > 0 && <ul {...sx(ck.latest)}>{latest.map((a) => (
            <li key={a.id} {...sx(ck.latestItem)}><b>{personById(a.creator_id)?.name.split(" ")[0] ?? "Someone"}:</b> {excerpt(a.body, 110)}</li>
          ))}</ul>}
        </li>
      )
    }
    return (
      <Page title="Team questions" crumbs={projectCrumbs(p)}>
        <PageHead title="Team questions" actions={[p.status === "active" && !isClient(me()) && <a key="new" href={`/projects/${p.id}/questions/new`} data-button>Ask a new question</a>]} />
        {!questions.length && <p {...sx(kit.empty)}>Ask your team the same question on a set day and time, like “What did you get done today?” Their answers all show up here.</p>}
        {active.length > 0 && <ul {...sx(ck.grid)}>{active.map(item)}</ul>}
        {paused.length > 0 && <><h2 {...sx(ck.group)}>Paused</h2><ul {...sx(ck.grid)}>{paused.map(item)}</ul></>}
      </Page>
    )
  }),

  page("/projects/:id/questions/new", () => {
    const p = findProject(useParams().id)
    if (isClient(me())) throw new NoAccess()
    const blank: QInput = { title: "", frequency: "daily", days: [1, 2, 3, 4, 5], time: "16:30", asked_ids: [] }
    return (
      <Page title="New question" crumbs={projectCrumbs(p, "checkins")}>
        <h1>Ask a new question</h1>
        <QuestionForm p={p} people={projectPeople(p)} q={blank} action={`/projects/${p.id}/questions`} cancel={toolUrl(p, "checkins")} />
      </Page>
    )
  }),

  page("/projects/:id/questions/:qid", () => {
    const [sp] = useSearchParams()
    const { r: q, project } = findRecording(useParams().qid, "question")
    useVisit(urlFor(q), q.title, project.id)
    const m = me()
    const d = qdata(q)
    const asked = peopleByIds(d.asked_ids)
    const personId = Number(sp.get("person")) || null
    const all = recordings((r) => r.parent_id === q.id && r.type === "answer" && r.status === "active")
    const answers = all.filter((r) => !personId || r.creator_id === personId).sort((a, b) => ms(b.created_at) - ms(a.created_at)).slice(0, 200)
    const answerers = peopleByIds([...new Set(all.map((a) => a.creator_id).filter((id): id is number => id !== null))])
    const days = new Map<string, Recording[]>()
    for (const a of answers) {
      const k = fmtDate(a.created_at, m.time_zone)
      days.set(k, [...(days.get(k) ?? []), a])
    }
    const next = d.paused ? null : nextAsk(q, m.time_zone)
    return (
      <Page title={q.title} crumbs={projectCrumbs(project, "checkins")}>
        <StatusBanner r={q} />
        <ClientBanner r={q} hasClients={projectPeople(project).some(isClient)} />
        {d.paused && <div role="note"><p><b>This question is paused.</b> Nobody's being asked until it's resumed.</p></div>}
        <PageHead title={q.title} actions={[q.status === "active" && !d.paused && d.asked_ids.includes(m.id) && <a key="answer" href={`/projects/${project.id}/questions/${q.id}/answers/new`} data-button>Answer now</a>]} />
        <p {...sx(ck.asked)}>{summary(q)}: {asked.map((x, i) => <Fragment key={x.id}>{i ? ", " : ""}<a href={`/people/${x.id}`}>{x.name}</a></Fragment>)}.</p>
        {q.status === "active" && !isClient(m) && (
          <div {...sx(ck.manage)}>
            <a href={`/projects/${project.id}/questions/${q.id}/edit`} data-button>Edit</a>
            <Form
              action={`/projects/${project.id}/questions/${q.id}/${d.paused ? "resume" : "pause"}`}
              style={{ display: "inline" }}
              optimistic={() => db.recordings.set(String(q.id), { ...q, data: { ...q.data, paused: !d.paused } })}
            >
              <button>{d.paused ? "Resume" : "Pause"}</button>
            </Form>
            <a href={`/r/${q.id}/trash`}>Trash</a>
          </div>
        )}
        {(answerers.length > 1 || personId) && (
          <GetForm method="get" ref={submitOnChange} {...sx(kit.toolbar)}>
            <label>Show answers from <select name="person" key={personId ?? ""} defaultValue={personId ?? ""} {...sx(kit.toolbarControl)}><option value="">everyone</option>
              {answerers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </GetForm>
        )}
        {!answers.length ? (
          <p {...sx(kit.empty)}>{personId ? "No answers from this person yet." : next ? `No answers yet. The first one gets asked ${next}.` : "No answers yet."}</p>
        ) : [...days].map(([day, as]) => (
          <Fragment key={day}>
            <h2 {...sx(ck.day)}><span>{day}</span><span {...sx(ck.rule)}></span></h2>
            <div {...sx(ck.answers)}>
              {as.map((a) => {
                const author = personById(a.creator_id)
                const n = commentCount(a.id)
                return (
                  <article key={a.id} id={`answer-${a.id}`} {...sx(ck.answer)}>
                    <Face p={author ?? { name: "Someone" }} />
                    <div>
                      <p {...sx(ck.answerHead)}><b>{author?.name ?? "Someone"}</b> <small>{new Date(a.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: m.time_zone })}</small></p>
                      <Fmt text={a.body} {...sx(kit.prose)} />
                      <p {...sx(ck.answerFoot)}><a href={urlFor(a)}>{n ? plural(n, "comment") : "Comment or react"}</a></p>
                    </div>
                  </article>
                )
              })}
            </div>
          </Fragment>
        ))}
        <ItemFooter r={q} project={project} showComments={false} />
      </Page>
    )
  }),

  page("/projects/:id/questions/:qid/edit", () => {
    const { r: q, project } = findRecording(useParams().qid, "question")
    if (isClient(me())) throw new NoAccess()
    const d = qdata(q)
    const input: QInput = { title: q.title, frequency: d.frequency, days: d.days, time: d.time, asked_ids: d.asked_ids, visible_to_clients: q.visible_to_clients }
    return (
      <Page title="Edit question" crumbs={answerCrumbs(project, q)}>
        <h1>Edit question</h1>
        <QuestionForm p={project} people={projectPeople(project)} q={input} action={`/projects/${project.id}/questions/${q.id}/edit`} cancel={urlFor(q)} />
      </Page>
    )
  }),

  page("/projects/:id/questions/:qid/answers/new", () => {
    const { r: q, project } = findRecording(useParams().qid, "question")
    return (
      <Page title="Answer" crumbs={answerCrumbs(project, q)}>
        <h1>{q.title}</h1>
        <Form action={`/projects/${project.id}/questions/${q.id}/answers`}>
          <TextArea label="Your answer" name="body" placeholder="Write your answer…" />
          <p><button>Post my answer</button> <a href={urlFor(q)}>Cancel</a></p>
        </Form>
        <p><small>You can also just reply to the reminder email with your answer.</small></p>
      </Page>
    )
  }),

  page("/projects/:id/answers/:aid", () => {
    const { r: a, project } = findRecording(useParams().aid, "answer")
    const q = questionOf(a)
    return (
      <Page title={`Answer: ${q.title}`} crumbs={answerCrumbs(project, q)}>
        <StatusBanner r={a} />
        <article>
          <p {...sx(kit.tags)}><span {...sx(kit.tag)}>Answer to</span> <a href={urlFor(q)}>{q.title}</a></p>
          <ByLine who={personById(a.creator_id)} when={a.created_at} tz={me().time_zone} />
          <Fmt text={a.body} {...sx(kit.prose)} />
          {a.creator_id === me().id && a.status === "active" && <p><a href={`/projects/${project.id}/answers/${a.id}/edit`}>Edit</a></p>}
        </article>
        <ItemFooter r={a} project={project} />
      </Page>
    )
  }),

  page("/projects/:id/answers/:aid/edit", () => {
    const { r: a, project } = findRecording(useParams().aid, "answer")
    if (a.creator_id !== me().id) throw new NoAccess()
    const q = questionOf(a)
    return (
      <Page title="Edit answer" crumbs={answerCrumbs(project, q)}>
        <h1>Edit your answer to “{q.title}”</h1>
        <Form action={`/projects/${project.id}/answers/${a.id}/edit`}>
          <TextArea label="Your answer" name="body" value={a.body} />
          <p><button>Save changes</button> <a href={urlFor(a)}>Cancel</a></p>
        </Form>
      </Page>
    )
  }),
]
