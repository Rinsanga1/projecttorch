// Project chat, bots and private chats. Posts: src/areas/chat.ts. A private chat is a project of kind 'ping' whose
// people are its participants, so project chat and private chats share one conversation and one composer.
// New lines arrive through sync, so the conversation re-renders by itself.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useContext, useEffect, useRef, useState } from "react"
import { InWindow, useSince } from "../ui/in-window.tsx"
import { Navigate, useParams, useSearchParams } from "react-router"
import { db, isTemp, submit, temp } from "../store.ts"
import { me, account, accountPeople, findProject, findRecording, projectPeople, boostsOn, recordings, useVisit, NoAccess, NotFound } from "../data.ts"
import { isAdmin, isClient, isOutOfOffice, toolName, type Project, type Recording } from "../../shared/domain.ts"
import { excerpt, fmtDate, fmtTime, ms, plural } from "../../shared/format.ts"
import { Face, Fmt, kit, sx } from "../ui/kit.tsx"
import { Form, PeopleCheckboxes, submitOwnForm } from "../ui/forms.tsx"
import { Page, projectCrumbs, page, type Crumb } from "../ui/page.tsx"
import { color, media, radius, space, text } from "../ui/tokens.stylex.ts"

// A conversation: each line as avatar + name/time + text, days split by a centered date, the composer in a tile.
const cs = stylex.create({
  lines: { margin: 0, marginBottom: space.s4 },
  line: { display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, alignItems: "start", paddingBlock: 6, borderTopWidth: 0 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2 },
  body: { overflowWrap: "anywhere" },
  extras: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s3, marginTop: 2, fontSize: text.sm },
  quiet: { color: color.muted, textDecoration: "none", ":hover": { textDecoration: "underline" } },
  file: {
    display: "inline-flex", alignItems: "center", gap: 6, marginTop: space.s1, paddingBlock: 6, paddingInline: 12, borderRadius: radius.md,
    backgroundColor: color.tile, fontSize: text.sm, fontWeight: 600, textDecoration: "none",
  },
  day: { display: "flex", alignItems: "center", gap: space.s3, paddingBlock: space.s4, borderTopWidth: 0, color: color.muted },
  dayRule: { flexGrow: 1, height: 1, backgroundColor: color.line },
  dayLabel: { margin: 0, fontSize: text.xs, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: color.muted },
  // HEY's line: where what's new since your last visit begins, in the orange kept for "needs you".
  newRule: { backgroundColor: `color-mix(in srgb, ${color.accent} 45%, transparent)` },
  newLabel: { color: color.accentText },
  composer: { padding: space.s4, borderRadius: radius.xl, backgroundColor: color.tile, display: "grid", gap: space.s2 },
  // In a window the composer stays at the window's bottom while you read back; the shadow paints the window's white into
  // the gap under it, so older lines don't peek through.
  composerPinned: { position: "sticky", bottom: { default: 64, "@media (min-width: 900px)": 0 }, zIndex: 1, boxShadow: `0 12px 0 0 ${color.sheet}` },
  field: { width: "100%", maxWidth: "none", minHeight: "3.5em", backgroundColor: color.sheet, margin: 0 },
  composerRow: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: space.s3, margin: 0, maxWidth: "none" },
  composerHint: { margin: 0 },
  // A file input dressed as a button: the native "Choose File / No file chosen" box is hidden, the name shows once picked.
  attach: {
    display: "inline-flex", alignItems: "center", minHeight: 34, maxWidth: "100%", margin: 0, paddingBlock: 7, paddingInline: space.s4, borderRadius: radius.pill,
    backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tileHover } }, fontSize: text.sm, fontWeight: 600, cursor: "pointer",
    outline: { default: null, ":focus-within": `2px solid ${color.focus}` }, outlineOffset: 2,
  },
  fileName: { marginLeft: space.s2, fontWeight: 400, color: color.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "16rem" },
})

/** Where a conversation lives: a project's Campfire or a Ping. */
const convUrl = (p: Pick<Project, "id" | "kind">) => (p.kind === "ping" ? `/chats/${p.id}` : `/projects/${p.id}/chat`)
const convCrumbs = (p: Project): Crumb[] => (p.kind === "ping" ? [["Private chats", "/chats"]] : projectCrumbs(p, "campfire"))

/** Line order: by id, newest last. Stand-ins (not saved yet) have ids above every saved line. */
const seq = (r: Recording) => r.id
const linesOf = (projectId: number) =>
  recordings((r) => r.project_id === projectId && r.type === "line" && r.status === "active").sort((a, b) => seq(a) - seq(b))

const whoWrote = (l: Recording) => {
  const p = l.creator_id ? db.people.get(String(l.creator_id)) : undefined
  return { name: p?.name ?? (l.data.chatbot_name ? `${l.data.chatbot_name} (bot)` : "Someone"), avatar_url: p?.avatar_url }
}

/** Opening a conversation (or a new line arriving while it's open) marks its notifications read. */
const useMarkRead = (p: Project, kind: "line" | "ping") => {
  const m = me()
  const unread = [...db.notifications.values()].filter((n) => n.person_id === m.id && n.project_id === p.id && n.kind === kind && !n.read_at)
  useEffect(() => {
    if (!unread.length) return
    submit(`${convUrl(p)}/read`, new FormData(), () => {
      const now = new Date().toISOString()
      for (const n of unread) db.notifications.set(String(n.id), { ...n, read_at: now })
    }).catch(() => {})
  }, [unread.length, p.id])
}

const Line = ({ l, base, meId, tz }: { l: Recording; base: string; meId: number; tz: string }) => {
  const who = whoWrote(l)
  const own = l.creator_id !== null && l.creator_id === meId && !isTemp(l.id)
  const boosts = boostsOn(l.id).flatMap((b) => { const p = db.people.get(String(b.person_id)); return p ? [`${b.content} ${p.name}`] : [] }).join(", ")
  return (
    <li id={`line-${l.id}`} {...sx(cs.line)}>
      <Face p={who} />
      <div>
        <p {...sx(cs.head)}><b>{who.name}</b> <small>{fmtTime(l.created_at, tz)}{ms(l.updated_at) - ms(l.created_at) > 1000 ? " (edited)" : ""}</small></p>
        <Fmt text={l.body} {...sx(cs.body)} />
        {l.data.file && <a href={`/api${base}/lines/${l.id}/file`} {...sx(cs.file)}>📎 {l.data.file.name} <small>({Math.ceil(l.data.file.size / 1024)} KB)</small></a>}
        {!isTemp(l.id) && (
          <p {...sx(cs.extras)}>
            {boosts && <small>Reactions: {boosts}</small>}
            <a href={`/r/${l.id}/reactions`} {...sx(cs.quiet)}>React</a>
            {own && <span><a href={`${base}/lines/${l.id}/edit`} {...sx(cs.quiet)}>Edit</a> · <a href={`/r/${l.id}/trash`} {...sx(cs.quiet)}>Delete</a></span>}
          </p>
        )}
      </div>
    </li>
  )
}

/** The conversation: lines grouped by day and the composer. Shared by Campfire and Pings. */
const Conversation = observer(({ p, blank }: { p: Project; blank: string }) => {
  const [q] = useSearchParams()
  const m = me()
  const before = Number(q.get("before")) || null
  const rows = linesOf(p.id).filter((l) => !before || seq(l) < before)
  const more = rows.length > 150
  const lines = rows.slice(-150)
  const days = new Map<string, Recording[]>()
  for (const l of lines) {
    const d = fmtDate(l.created_at, m.time_zone)
    days.set(d, [...(days.get(d) ?? []), l])
  }
  const pool = projectPeople(p).filter((x) => x.id !== m.id)
  const base = convUrl(p)
  const field = useRef<HTMLTextAreaElement>(null)
  const [file, setFile] = useState("")

  // A line arriving while the page is open scrolls into view, like the old live stream did.
  const last = lines.at(-1)?.id
  const prev = useRef(last)
  useEffect(() => {
    if (last !== undefined && last !== prev.current) document.getElementById(`line-${last}`)?.scrollIntoView({ block: "nearest" })
    prev.current = last
  }, [last])
  // In a project window, chat opens where the talk is: at the line where what's new since your last visit begins, or
  // else at the newest lines and the composer, not the top of the day.
  const inWindow = useContext(InWindow)
  const { since, isNew } = useSince()
  const firstNew = lines.find(isNew)?.id
  useEffect(() => {
    const body = field.current?.closest("[data-window-body]")
    if (!inWindow || !body) return
    const line = body.querySelector("[data-new-line]")
    if (body.scrollHeight > body.clientHeight) body.scrollTop = line ? body.scrollTop + line.getBoundingClientRect().top - body.getBoundingClientRect().top - 12 : body.scrollHeight
    // On a phone the window is the page: scroll the page there, after the app's own scroll-to-top for a new page.
    else requestAnimationFrame(() => (line ?? body.querySelector("#lines > li:last-child"))?.scrollIntoView({ block: line ? "start" : "center" }))
  }, [inWindow])

  // Lines without a file show up right away; the server's row replaces the stand-in.
  const say = (fd: FormData) => {
    const body = String(fd.get("body") ?? "").trim()
    const file = fd.get("file")
    if (!body || (file instanceof File && file.size > 0)) return
    const now = new Date().toISOString()
    temp("recordings", {
      account_id: m.account_id, project_id: p.id, parent_id: null, type: "line", title: "", body, data: {}, status: "active",
      trashed_at: null, position: 0, visible_to_clients: true, creator_id: m.id, created_at: now, updated_at: now,
    })
  }

  return (
    <>
      {more && <p><a href={`${base}?before=${lines[0]!.id}`}>Show earlier messages</a></p>}
      {before && <p><a href={base}>Back to the latest messages</a></p>}
      {!lines.length && <p>{blank}</p>}
      <ul id="lines" {...sx(cs.lines)}>
        {[...days].map(([d, ls]) => [
          <li key={`day-${d}`} {...sx(cs.day)}><span {...sx(cs.dayRule)} /><h2 {...sx(cs.dayLabel)}>{d}</h2><span {...sx(cs.dayRule)} /></li>,
          ...ls.flatMap((l) => [
            l.id === firstNew && since && (
              <li key="new" data-new-line {...sx(cs.day)}><span {...sx(cs.dayRule, cs.newRule)} /><h2 {...sx(cs.dayLabel, cs.newLabel)}>New {since.label.charAt(0).toLowerCase() + since.label.slice(1)}</h2><span {...sx(cs.dayRule, cs.newRule)} /></li>
            ),
            <Line key={l.id} l={l} base={base} meId={m.id} tz={m.time_zone} />,
          ]),
        ])}
      </ul>
      {p.status === "active" ? (
        <Form id="say" action={`${base}/lines`} encType="multipart/form-data" optimistic={say} onDone={() => { field.current?.form?.reset(); setFile("") }} {...sx(cs.composer, inWindow && cs.composerPinned)}>
          <textarea
            ref={field} name="body" rows={2} cols={70} placeholder="Type a message…" aria-label="Message" {...sx(cs.field)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }}
          />
          <p {...sx(cs.composerRow)}>
            <label {...sx(cs.attach)}>Attach a file{file && <span {...sx(cs.fileName)}>{file}</span>}
              <input type="file" name="file" onChange={(e) => setFile(e.currentTarget.files?.[0]?.name ?? "")} {...sx(kit.srOnly)} /></label>
            <button data-primary>Send</button>
          </p>
          <p {...sx(cs.composerHint)}><small>Enter sends, Shift+Enter for a new line.{pool.length > 0 && <> Mention someone with @: {pool.map((x) => `@${x.name.split(" ")[0]}`).join(", ")}</>}</small></p>
        </Form>
      ) : (
        <p><i>This {p.kind === "ping" ? "conversation" : "project"} is read-only.</i></p>
      )}
    </>
  )
})

const Campfire = observer(({ p }: { p: Project }) => {
  const m = me()
  useMarkRead(p, "line")
  useVisit(convUrl(p), `${p.name}: ${toolName(p, "campfire")}`, p.id)
  const setting = m.prefs.campfire_notify?.[String(p.id)] ?? "mentions"
  return (
    <Page title={toolName(p, "campfire")} crumbs={projectCrumbs(p)}>
      <h1>{toolName(p, "campfire")}</h1>
      <Conversation p={p} blank="Chat with the group. Ask quick questions and share stuff." />
      {/* A setting you change once: one quiet line that opens, and saves as soon as you pick. */}
      <details>
        <summary>Notifications: {setting === "everything" ? "Everything" : "Only @mentions"}</summary>
        <Form action={`/projects/${p.id}/chat/notify`}>
          <fieldset key={setting}><legend>Notify me about</legend>
            <label><input type="radio" name="notify" value="everything" defaultChecked={setting === "everything"} onChange={submitOwnForm} /> Everything</label>
            <label><input type="radio" name="notify" value="mentions" defaultChecked={setting === "mentions"} onChange={submitOwnForm} /> Only @mentions</label>
          </fieldset>
        </Form>
      </details>
      {!isClient(m) && <p><a href="/bots">Set up bots</a></p>}
    </Page>
  )
})

const Ping = observer(({ p }: { p: Project }) => {
  const m = me()
  const others = projectPeople(p).filter((x) => x.id !== m.id)
  const names = others.map((x) => x.name).join(", ") || "Just you"
  useMarkRead(p, "ping")
  useVisit(`/chats/${p.id}`, `Private chat: ${names}`)
  const away = others.filter((x) => isOutOfOffice(x))
  return (
    <Page title={`Private chat: ${names}`} crumbs={[["Private chats", "/chats"]]}>
      <h1>Chat with {others.length ? others.map((x, i) => <span key={x.id}>{i ? ", " : ""}<a href={`/people/${x.id}`}>{x.name}</a></span>) : "just you"}</h1>
      {away.map((x) => <p key={x.id} role="note"><b>{x.name} is out of office until {fmtDate(x.prefs.ooo!.until)}.</b>{x.prefs.ooo?.message && <> {x.prefs.ooo.message}</>}</p>)}
      <Conversation p={p} blank={`This is the start of your private chat${others.length ? ` with ${names}` : ""}. Only the people here can see it.`} />
    </Page>
  )
})

const EditLine = () => {
  const { r, project } = findRecording(useParams().lid, "line")
  if (r.creator_id !== me().id) throw new NotFound()
  return (
    <Page title="Edit message" crumbs={convCrumbs(project)}>
      <h1>Edit your message</h1>
      <Form action={`${convUrl(project)}/lines/${r.id}`}>
        <p><textarea name="body" rows={3} cols={70} required defaultValue={r.body} /></p>
        <button>Save changes</button> <a href={`${convUrl(project)}#line-${r.id}`}>Cancel</a>
      </Form>
    </Page>
  )
}

export const routes = [
  // Campfire
  page("/projects/:id/chat", () => {
    const p = findProject(useParams().id)
    if (p.kind === "ping") return <Navigate replace to={`/chats/${p.id}${location.hash}`} />
    return <Campfire p={p} />
  }),

  page("/projects/:id/chat/lines/:lid/edit", EditLine),

  // Chatbots
  page("/bots", () => {
    const m = me()
    if (isClient(m)) throw new NoAccess()
    const bots = [...db.chatbots.values()].filter((b) => b.account_id === m.account_id).sort((a, b) => a.name.localeCompare(b.name))
    return (
      <Page title="Bots" crumbs={[["Admin", "/admin"], ["Integrations", "/admin/integrations"]]}>
        <h1>Bots</h1>
        <p>Bots are small programs that post in project chats and answer commands. To send a bot a command, type <code>!botname something</code> in a chat.</p>
        {bots.length ? (
          <ul>
            {bots.map((b) => (
              <li key={b.id}>
                <b>{b.name}</b>{b.command_url && <> · commands go to {b.command_url}</>}
                <br />Posting URL: <input readOnly size={70} value={`${location.origin}/api/bots/${b.token}/lines`} onClick={(e) => e.currentTarget.select()} />
                <br /><small>POST <code>content</code> and <code>project_id</code> (form or JSON) to post a message as {b.name}.</small>
                {isAdmin(m) && <Form action={`/bots/${b.id}/delete`}><button>Delete</button></Form>}
              </li>
            ))}
          </ul>
        ) : (
          <p>Bots let other apps post in your project chats. Add one to get its posting URL.</p>
        )}
        {isAdmin(m) ? (
          <>
            <h2>Add a bot</h2>
            <Form action="/bots">
              <p><label>Name (one word, used for !commands)<br /><input name="name" required pattern="\w+" /></label></p>
              <p><label>Command URL (optional)<br /><input type="url" name="command_url" size={60} placeholder="https://example.com/bot" /></label></p>
              <button>Add a bot</button>
            </Form>
          </>
        ) : (
          <p><small>Only admins can add or remove bots.</small></p>
        )}
      </Page>
    )
  }),

  // Pings
  page("/chats", () => {
    const m = me()
    const mine = new Set([...db.project_people.values()].filter((pp) => pp.person_id === m.id).map((pp) => pp.project_id))
    const pings = [...db.projects.values()]
      .filter((p) => p.kind === "ping" && p.account_id === m.account_id && mine.has(p.id))
      .map((p) => {
        const names = [...db.project_people.values()]
          .filter((pp) => pp.project_id === p.id && pp.person_id !== m.id)
          .flatMap((pp) => db.people.get(String(pp.person_id))?.name ?? [])
          .sort((a, b) => a.localeCompare(b))
          .join(", ") || null
        const unread = [...db.notifications.values()].filter((n) => n.project_id === p.id && n.person_id === m.id && n.kind === "ping" && !n.read_at).length
        const last = linesOf(p.id).at(-1)
        return { id: p.id, names, unread, last, at: last?.created_at ?? p.created_at }
      })
      .sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0) || ms(b.at) - ms(a.at))
    return (
      <Page title="Private chats">
        <h1>Private chats</h1>
        <p><a href="/chats/new" data-button>Start a private chat</a></p>
        {pings.length ? (
          <ul>
            {pings.map((g) => (
              <li key={g.id}>
                <a href={`/chats/${g.id}`}>{g.unread ? <b>{g.names ?? "Just you"}</b> : g.names ?? "Just you"}</a>{g.unread ? ` (${plural(g.unread, "new message")})` : ""}
                {g.last && <><br /><small>{db.people.get(String(g.last.creator_id))?.name ?? g.last.data.chatbot_name ?? "Someone"}: {excerpt(g.last.body, 80)} · {fmtDate(g.last.created_at, m.time_zone)}</small></>}
              </li>
            ))}
          </ul>
        ) : (
          <p>A private chat is just you and one or a few people. Start one with anyone at {account().name}.</p>
        )}
      </Page>
    )
  }),

  page("/chats/new", () => {
    const [q] = useSearchParams()
    // people.tsx links here with ?with=<id>; the old page only read person_id, so it opened with nobody picked.
    const preset = [...q.getAll("person_id"), ...q.getAll("with")].map(Number).filter((n) => n > 0)
    const people = accountPeople().filter((p) => p.id !== me().id)
    return (
      <Page title="Start a private chat" crumbs={[["Private chats", "/chats"]]}>
        <h1>Start a private chat</h1>
        <p>Chat with one person or a few.</p>
        <Form action="/chats">
          <p>Who do you want to chat with?</p>
          {people.length ? <PeopleCheckboxes name="person_ids" people={people} checked={preset} /> : <p>Nobody else is here yet. <a href="/people/invite">Invite someone</a></p>}
          <p><label>Say something (optional)<br /><textarea name="body" rows={2} cols={60} placeholder="Type a message…" /></label></p>
          <button>Start chatting</button> <a href="/chats">Cancel</a>
        </Form>
      </Page>
    )
  }),

  page("/chats/:id", () => {
    const p = findProject(useParams().id)
    if (p.kind !== "ping") return <Navigate replace to={`/projects/${p.id}`} />
    if (!db.project_people.has(`${p.id}:${me().id}`)) throw new NoAccess()
    return <Ping p={p} />
  }),

  page("/chats/:id/lines/:lid/edit", EditLine),
]
