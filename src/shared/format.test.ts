// `bun test`: Markdown bodies render, and nothing in a body can run.
import { expect, test } from "bun:test"
import { excerpt, fmt } from "./format.ts"

test("plain text renders as before", () => {
  expect(fmt("Hi @Ann, see https://example.com\nthanks")).toBe('Hi <b>@Ann</b>, see <a href="https://example.com">https://example.com</a><br>thanks')
})

test("Markdown renders, headings start at h2", () => {
  const html = fmt("# Plan\n\n- **one**\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |")
  expect(html).toContain("<h2>Plan</h2>")
  expect(html).toContain("<li><strong>one</strong></li>")
  expect(html).toContain("<table>")
})

test("HTML and scripts show as text", () => {
  for (const body of ["<script>alert(1)</script>", '<img src=x onerror="alert(1)">', "<div><b>hi</b></div>", "text <iframe src=x></iframe>"]) {
    const html = fmt(body)
    expect(html).not.toMatch(/<(script|img|iframe|div)\b/i)
    expect(html).toContain("&lt;")
  }
})

test("only safe links", () => {
  expect(fmt("[x](javascript:alert(1))")).not.toContain("href")
  expect(fmt("[x](data:text/html,hi)")).not.toContain("href")
  expect(fmt('[x](https://ok.com "t\\"onmouseover=alert(1)")')).not.toMatch(/"\s*onmouseover=/)
  expect(fmt("[card](/projects/1/cards/2)")).toContain('href="/projects/1/cards/2"')
  expect(fmt("![pixel](https://tracker.example/p.gif)")).not.toContain("<img")
})

test("previews drop the Markdown", () => {
  expect(excerpt("## Status\n\n- **Done:** the [footer](https://x.com) fix\n- `code`")).toBe("Status Done: the footer fix code")
})
