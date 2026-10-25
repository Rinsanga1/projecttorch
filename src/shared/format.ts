// Text and date formatting, shared by the server and the React app. Dates arrive as Date (server) or ISO strings (synced rows).
import { Marked } from "marked"

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!)

// Bodies are Markdown: what agents write, and still readable as plain text in emails and previews. Plain text from
// before renders as it did (line breaks kept, URLs linked). Raw HTML shows as text and never runs; links go only to
// http(s), mailto or this app; images become links (no remote pixels); headings start at h2, under the page's h1.
// Returns HTML: in React, `dangerouslySetInnerHTML={{ __html: fmt(body) }}` (or use <Fmt> from client/ui).
const safeHref = (href: string) => /^(https?:|mailto:|\/(?![/\\])|#)/i.test(href)
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => esc(text),
    heading({ tokens, depth }) {
      const h = Math.min(depth + 1, 6)
      return `<h${h}>${this.parser.parseInline(tokens)}</h${h}>\n`
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      return safeHref(href) ? `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${text}</a>` : text
    },
    image: ({ href, text }) => (safeHref(href) ? `<a href="${esc(href)}">${esc(text || href)}</a>` : esc(text)),
    text(token) {
      const out = "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : "escaped" in token && token.escaped ? token.text : esc(token.text)
      return out.replace(/(^|\s)@(\w+)/g, "$1<b>@$2</b>")
    },
  },
})

export const fmt = (text: string | null | undefined) => {
  const html = (md.parse(text ?? "", { async: false }) as string).trim()
  // One paragraph (a chat line, a short comment) stays bare, so it sits in its bubble or line as before.
  const one = /^<p>([\s\S]*)<\/p>$/.exec(html)
  return one && !one[1]!.includes("<p>") ? one[1]! : html
}

/** Markdown down to its words, for one-line previews. */
const plain = (t: string) =>
  t.replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ x]\]\s+|[-*+]\s+|\d+[.)]\s+)/gim, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s*\|\s*/g, " · ")

export const excerpt = (text: string | null | undefined, n = 140) => {
  const t = plain(text ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? t.slice(0, n - 1) + "…" : t
}

type When = Date | string | null | undefined

/** "Oct 4", "Oct 4, 2025" when not this year. A bare YYYY-MM-DD is a calendar day, not an instant. */
export const fmtDate = (d: When, tz = "UTC") => {
  if (!d) return ""
  const day = typeof d === "string" && d.length === 10
  const date = typeof d === "string" ? new Date(day ? d + "T12:00:00Z" : d) : d
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear()
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: day ? "UTC" : tz })
}

export const fmtTime = (d: When, tz = "UTC") => {
  if (!d) return ""
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
}

export const fmtDateTime = (d: When, tz = "UTC") => (d ? `${fmtDate(d, tz)} at ${fmtTime(d, tz)}` : "")

/** "just now", "5m ago", "2h ago", "3d ago", then the date. */
export const ago = (d: When, tz = "UTC", now = Date.now()) => {
  if (!d) return ""
  const s = Math.max(0, (now - new Date(d).getTime()) / 1000)
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : s < 7 * 86400 ? `${Math.floor(s / 86400)}d ago` : fmtDate(d, tz)
}

/** YYYY-MM-DD for <input type=date> and SQL dates. */
export const isoDate = (d: When) => {
  if (!d) return ""
  if (typeof d === "string") return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

export const today = () => new Date().toISOString().slice(0, 10)

/** "2026-10-22" plus `n` days, as a date string. */
export const addDays = (d: string, n: number) => new Date(Date.parse(d.slice(0, 10) + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10)

/** Whole days from today to `d` (negative = in the past). */
export const daysFromToday = (d: Date | string) => {
  const day = isoDate(d)
  return Math.round((Date.parse(day + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 86_400_000)
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`

/** Milliseconds since epoch for a Date or ISO string. */
export const ms = (d: Date | string) => (typeof d === "string" ? Date.parse(d) : d.getTime())
