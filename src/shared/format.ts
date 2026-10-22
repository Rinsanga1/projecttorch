// Text and date formatting, shared by the server and the React app. Dates arrive as Date (server) or ISO strings (synced rows).

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!)

// Bodies are stored as plain text. Render: escape, link URLs, keep line breaks, bold @mentions.
// Returns escaped HTML: in React, `dangerouslySetInnerHTML={{ __html: fmt(body) }}` (or use <Fmt> from client/ui).
// ponytail: plain-text bodies, swap in Trix/Action Text-style rich text when formatting matters
export const fmt = (text: string | null | undefined) =>
  esc(text ?? "")
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/(^|\s)@(\w+)/g, "$1<b>@$2</b>")
    .replace(/\n/g, "<br>\n")

export const excerpt = (text: string | null | undefined, n = 140) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
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
