// Project chat, bots and private chats. Posts: src/areas/chat.ts. A private chat is a project of kind 'ping' whose
// people are its participants, so project chat and private chats share one conversation and one composer.
// New lines arrive through sync, so the conversation re-renders by itself.
import * as stylex from "@stylexjs/stylex"
import { observer } from "mobx-react-lite"
import { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react"
import { InWindow, useSince, useWindow, WindowField } from "../ui/in-window.tsx"
import { Navigate, useParams, useSearchParams } from "react-router"
import { db, isTemp, submit, temp } from "../store.ts"
import { me, account, accountPeople, findProject, findRecording, projectPeople, boostsOn, recordings, inWindow as inChat, useVisit, NoAccess, NotFound } from "../data.ts"
import { isAdmin, isClient, isOutOfOffice, windowQuery, windowUrl, type Project, type Recording, type Tool } from "../../shared/domain.ts"
import { excerpt, fmtDate, fmtTime, ms, plural } from "../../shared/format.ts"
import { Face, Fmt, kit, sx } from "../ui/kit.tsx"
import { Icon } from "../ui/icons.tsx"
import { Form, PeopleCheckboxes, submitOwnForm } from "../ui/forms.tsx"
import { Page, projectCrumbs, page, type Crumb } from "../ui/page.tsx"
import { color, media, radius, space, text } from "../ui/tokens.stylex.ts"

// A conversation: the start of it (what this room is, its settings), then lines split by a centered date, then the
// composer, one line tall. Lines from one person a few minutes apart run together under one face and name; a line's
// actions float at its end on hover (a tap shows them on touch), so they take no room until wanted.
const cs = stylex.create({
  lines: { margin: 0, marginBottom: space.s3 },
  line: {
    position: "relative", display: "grid", gridTemplateColumns: "32px 1fr", columnGap: space.s3, alignItems: "start",
    marginTop: 8, paddingBlock: 4, paddingInline: 8, marginInline: -8, borderRadius: radius.md, borderTopWidth: 0,
    // A line arriving scrolls into view above the composer pinned under it.
    scrollMarginBottom: 96,
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
    transitionProperty: "background-color", transitionDuration: "120ms", transitionTimingFunction: "ease",
  },
  // A follow-up from the same person: no face or name, tight to the line above.
  more: { marginTop: 0, paddingBlock: 1 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s2, margin: 0, lineHeight: 1.3 },
  when: { color: color.muted, fontSize: text.xs },
  // A follow-up's time, in the face's place, while the line is hovered.
  gutterTime: { fontSize: 10.5, lineHeight: 1.6, color: color.muted, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  body: { overflowWrap: "anywhere", lineHeight: 1.5 },
  bot: { color: color.muted, fontWeight: 400 },
  // Hover actions: a small white card on the line's top-right corner.
  actions: {
    position: "absolute", top: -12, right: 8, zIndex: 1, display: "flex", gap: 2, padding: 2, borderRadius: 10,
    backgroundColor: color.sheet, borderWidth: 1, borderStyle: "solid", borderColor: color.line, boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
  },
  action: {
    paddingBlock: 3, paddingInline: 8, borderRadius: 7, fontSize: text.xs, fontWeight: 600, textDecoration: "none",
    color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } },
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tile } },
  },
  // Your own lines: on the right, in a bubble a shade darker than the tile, so it holds against the window's white and
  // the line's hover. The line itself doesn't light up on hover (the bubble already says which one).
  mine: { display: "flex", justifyContent: "flex-end", backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: "transparent" } } },
  mineCol: { position: "relative", display: "grid", justifyItems: "end", gap: 2, maxWidth: { default: "85%", "@media (min-width: 900px)": "72%" }, minWidth: 0 },
  mineWhen: { paddingInline: 4 },
  mineRow: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  bubble: { minWidth: 0, paddingBlock: 6, paddingInline: 12, borderRadius: 16, backgroundColor: color.tileHover },
  // On your lines the actions sit beside the bubble, to its left; on a phone there's no room beside it, so above it.
  actionsMine: { top: { default: -14, "@media (min-width: 900px)": 0 }, right: { default: 0, "@media (min-width: 900px)": "calc(100% + 8px)" } },
  reactions: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reaction: {
    display: "inline-flex", alignItems: "center", gap: 4, height: 24, paddingInline: 8, borderRadius: radius.pill, fontSize: text.xs, fontWeight: 600,
    textDecoration: "none", color: color.ink, borderWidth: 1, borderStyle: "solid", borderColor: color.line,
    backgroundColor: { default: color.sheet, ":hover": { default: null, [media.hover]: color.tile } },
  },
  // The start of the conversation: what this room is, then its quiet settings.
  start: { paddingBlock: space.s4, borderBottomWidth: 1, borderBottomStyle: "solid", borderBottomColor: color.line, marginBottom: space.s2 },
  startTitle: { margin: 0, fontSize: text.base },
  startMeta: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: space.s2, rowGap: space.s1, margin: 0, marginTop: space.s1, fontSize: text.sm, color: color.muted },
  inlineForm: { display: "inline" },
  // Short, but its right padding (the arrow's room) is the base select's.
  notifySelect: { minHeight: 28, paddingBlock: 2, paddingLeft: 8, fontSize: text.sm },
  empty: { margin: 0, paddingBlock: space.s6, textAlign: "center", color: color.muted },
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
  // One row: attach, the field (it grows as you write, up to six lines), Send.
  composer: { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "end", gap: 6, padding: 6, borderRadius: 18, backgroundColor: color.tile },
  // In a window the composer stays at the window's bottom while you read back; the shadow paints the window's white into
  // the gap under it, so older lines don't peek through.
  composerPinned: { position: "sticky", bottom: { default: 64, "@media (min-width: 900px)": 0 }, zIndex: 1, boxShadow: `0 12px 0 0 ${color.sheet}` },
  field: {
    width: "100%", maxWidth: "none", minHeight: 38, maxHeight: "calc(6lh + 18px)", margin: 0, paddingBlock: 8, paddingInline: 12,
    borderRadius: 12, backgroundColor: color.sheet, resize: "none", overflowY: "auto", lineHeight: 1.4,
  },
  send: { minHeight: 38 },
  // A file input dressed as a round button: the native "Choose File" box is hidden; the name shows beside it once picked.
  attach: {
    display: "inline-flex", alignItems: "center", gap: 6, minHeight: 38, minWidth: 38, maxWidth: "12rem", margin: 0, paddingInline: 10, borderRadius: radius.pill,
    color: { default: color.muted, ":hover": { default: null, [media.hover]: color.ink } }, cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": { default: null, [media.hover]: color.tileHover } },
    outline: { default: null, ":focus-within": `2px solid ${color.focus}` }, outlineOffset: 2,
  },
  fileName: { fontSize: text.sm, fontWeight: 600, color: color.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
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

/** Does `l` run on from `prev`: the same person (or bot), within five minutes? */
const runsOn = (prev: Recording | undefined, l: Recording) =>
  !!prev && prev.creator_id === l.creator_id && prev.data.chatbot_name === l.data.chatbot_name && ms(l.created_at) - ms(prev.created_at) < 5 * 60_000

const Line = ({ l, more, base, meId, tz }: { l: Recording; more: boolean; base: string; meId: number; tz: string }) => {
  const who = whoWrote(l)
  const own = l.creator_id !== null && l.creator_id === meId && !isTemp(l.id)
  // On touch there's no hover: a tap on the line shows its actions (and a follow-up's time).
  const [open, setOpen] = useState(false)
  const tap = (e: ReactMouseEvent<HTMLLIElement>) => { if (!(e.target as HTMLElement).closest("a, button")) setOpen(!open) }
  // Reactions, one pill per emoji with its count; who reacted is in its tip.
  const byEmoji = new Map<string, string[]>()
  for (const b of boostsOn(l.id)) {
    const p = db.people.get(String(b.person_id))
    if (p) byEmoji.set(b.content, [...(byEmoji.get(b.content) ?? []), p.name])
  }
  const time = `${fmtTime(l.created_at, tz)}${ms(l.updated_at) - ms(l.created_at) > 1000 ? " (edited)" : ""}`
  const shortTime = <small data-row-action data-line-tap title={time} {...sx(cs.gutterTime)}>{fmtTime(l.created_at, tz).replace(/\s?[ap]m$/i, "")}</small>
  const file = l.data.file && <a href={`/api${base}/lines/${l.id}/file`} {...sx(cs.file)}>📎 {l.data.file.name} <small>({Math.ceil(l.data.file.size / 1024)} KB)</small></a>
  const reactions = byEmoji.size > 0 && (
    <p {...sx(cs.reactions)}>
      {[...byEmoji].map(([emoji, names]) => <a key={emoji} href={`/r/${l.id}/reactions`} title={names.join(", ")} aria-label={`${emoji} from ${names.join(", ")}`} {...sx(cs.reaction)}>{emoji} {names.length}</a>)}
    </p>
  )
  // Yours sit on the right in a soft bubble, with no face or name: you know it's you. Everyone else's run down the left.
  const mine = l.creator_id !== null && l.creator_id === meId
  const actions = !isTemp(l.id) && (
    <span data-row-action data-line-tap {...sx(cs.actions, mine && cs.actionsMine)}>
      <a href={`/r/${l.id}/reactions`} {...sx(cs.action)}>React</a>
      {own && <><a href={`${base}/lines/${l.id}/edit`} {...sx(cs.action)}>Edit</a><a href={`/r/${l.id}/trash`} {...sx(cs.action)}>Delete</a></>}
    </span>
  )
  return (
    <li id={`line-${l.id}`} data-open={open || undefined} onClick={tap} {...sx(cs.line, more && cs.more, mine && cs.mine)}>
      {mine ? (
        <div {...sx(cs.mineCol)}>
          {!more && <small {...sx(cs.when, cs.mineWhen)}>{time}</small>}
          <div {...sx(cs.mineRow)}>
            {more && shortTime}
            <div {...sx(cs.bubble)}><Fmt text={l.body} {...sx(cs.body)} />{file}</div>
          </div>
          {reactions}
          {actions}
        </div>
      ) : <>
        {more ? shortTime : <Face p={who} />}
        <div>
          {!more && <p {...sx(cs.head)}><b {...sx(!l.creator_id && cs.bot)}>{who.name}</b> <small {...sx(cs.when)}>{time}</small></p>}
          <Fmt text={l.body} {...sx(cs.body)} />
          {file}
          {reactions}
        </div>
      </>}
      {!mine && actions}
    </li>
  )
}

/** The field grows with what's written, up to its max height (then it scrolls). */
const grow = (el: HTMLTextAreaElement) => {
  el.style.height = "auto"
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`
}

/** A conversation: a private chat, or one of a project's chats (`w`; a project can have several). `start` says what it
 * is, above its oldest line; `placeholder` names it in the empty field ("Message Chat"). */
const Conversation = observer(({ p, w, start, placeholder }: { p: Project; w?: Tool; start: ReactNode; placeholder: string }) => {
  const [q] = useSearchParams()
  const m = me()
  const before = Number(q.get("before")) || null
  const rows = linesOf(p.id).filter((l) => (!w || inChat(p, w.id)(l)) && (!before || seq(l) < before))
  const more = rows.length > 150
  const lines = rows.slice(-150)
  const days = new Map<string, Recording[]>()
  for (const l of lines) {
    const d = fmtDate(l.created_at, m.time_zone)
    days.set(d, [...(days.get(d) ?? []), l])
  }
  const base = convUrl(p)
  const here = base + (w ? windowQuery(w) : "")
  const field = useRef<HTMLTextAreaElement>(null)
  const [file, setFile] = useState("")

  // A line arriving while the page is open comes into view, like the old live stream did: yours always, someone else's
  // only if you're at the bottom (reading back, nothing yanks you down). In a window only the window scrolls, not the page.
  const last = lines.at(-1)
  const prev = useRef(last?.id)
  useEffect(() => {
    const el = last && last.id !== prev.current ? document.getElementById(`line-${last.id}`) : null
    prev.current = last?.id
    if (!el || !last) return
    const mine = last.creator_id === m.id
    const body = el.closest<HTMLElement>("[data-window-body]")
    if (body && body.scrollHeight > body.clientHeight) {
      if (mine || body.scrollHeight - body.scrollTop - body.clientHeight < el.offsetHeight + 160) body.scrollTop = body.scrollHeight
    } else if (mine || el.getBoundingClientRect().top < innerHeight) el.scrollIntoView({ block: "nearest" })
  }, [last?.id])
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
      account_id: m.account_id, project_id: p.id, parent_id: null, type: "line", title: "", body, status: "active",
      trashed_at: null, position: 0, visible_to_clients: true, creator_id: m.id, created_at: now, updated_at: now,
      data: w && w.id !== w.type ? { tool: w.id } : {},
    })
  }

  return (
    <>
      {/* The start of the conversation shows once its oldest lines are here. */}
      {more ? <p><a href={`${here}${here.includes("?") ? "&" : "?"}before=${lines[0]!.id}`}>Show earlier messages</a></p> : start}
      {before && <p><a href={here}>Back to the latest messages</a></p>}
      {!lines.length && <p {...sx(cs.empty)}>Nothing here yet. Say hi 👋</p>}
      <ul id="lines" {...sx(cs.lines)}>
        {[...days].map(([d, ls]) => [
          <li key={`day-${d}`} {...sx(cs.day)}><span {...sx(cs.dayRule)} /><h2 {...sx(cs.dayLabel)}>{d}</h2><span {...sx(cs.dayRule)} /></li>,
          ...ls.flatMap((l, i) => [
            l.id === firstNew && since && (
              <li key="new" data-new-line {...sx(cs.day)}><span {...sx(cs.dayRule, cs.newRule)} /><h2 {...sx(cs.dayLabel, cs.newLabel)}>New {since.label.charAt(0).toLowerCase() + since.label.slice(1)}</h2><span {...sx(cs.dayRule, cs.newRule)} /></li>
            ),
            <Line key={l.id} l={l} more={l.id !== firstNew && runsOn(ls[i - 1], l)} base={base} meId={m.id} tz={m.time_zone} />,
          ]),
        ])}
      </ul>
      {p.status === "active" ? (
        <Form id="say" action={`${base}/lines`} encType="multipart/form-data" optimistic={say} {...sx(cs.composer, inWindow && cs.composerPinned)}
          onDone={() => { field.current?.form?.reset(); setFile(""); if (field.current) field.current.style.height = "" }}>
          {w && <WindowField w={w} />}
          <label title="Attach a file" {...sx(cs.attach)}>
            <Icon name="attach" size={18} />{file && <span {...sx(cs.fileName)}>{file}</span>}
            <input type="file" name="file" aria-label="Attach a file" onChange={(e) => setFile(e.currentTarget.files?.[0]?.name ?? "")} {...sx(kit.srOnly)} />
          </label>
          <textarea
            ref={field} name="body" rows={1} placeholder={placeholder} aria-label="Message" {...sx(cs.field)} onInput={(e) => grow(e.currentTarget)}
            // Enter sends with a keyboard; on a phone's keyboard Enter is a new line and Send sends.
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); e.currentTarget.form?.requestSubmit() }
            }}
          />
          <button data-primary {...sx(cs.send)}>Send</button>
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
  const w = useWindow(p, "campfire")
  useVisit(windowUrl(p, w), `${p.name}: ${w.name}`, p.id)
  const setting = m.prefs.campfire_notify?.[String(p.id)] ?? "mentions"
  return (
    <Page title={w.name} crumbs={projectCrumbs(p)}>
      <h1>{w.name}</h1>
      <Conversation p={p} w={w} placeholder={`Message ${w.name}`} start={
        // Settings you change once live where the conversation starts, not under the composer.
        <div {...sx(cs.start)}>
          <p {...sx(cs.startTitle)}><b>This is the start of {w.name}.</b> Quick questions, quick answers.</p>
          <div {...sx(cs.startMeta)}>
            <Form action={`/projects/${p.id}/chat/notify`} {...sx(cs.inlineForm)}>
              <label>Notify me about{" "}
                <select key={setting} name="notify" defaultValue={setting} onChange={submitOwnForm} {...sx(cs.notifySelect)}>
                  <option value="mentions">Only @mentions</option>
                  <option value="everything">Everything</option>
                </select>
              </label>
            </Form>
            {!isClient(m) && <><span aria-hidden="true">·</span><a href="/bots">Set up bots</a></>}
          </div>
        </div>
      } />
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
      <Conversation p={p} placeholder={`Message ${others.length ? others.map((x) => x.name.split(" ")[0]).join(", ") : "yourself"}`} start={
        <div {...sx(cs.start)}><p {...sx(cs.startTitle)}><b>This is the start of your private chat{others.length ? ` with ${names}` : ""}.</b> Only the people here can see it.</p></div>
      } />
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
