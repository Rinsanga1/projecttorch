// `bun run dev`: run the server and restart it when anything in src/ changes.
// Not `bun --watch`: it doesn't see files that the StyleX preload (src/lib/stylex-plugin.ts) compiles.
import { watch } from "node:fs"

const start = () => Bun.spawn(["bun", "src/server.ts"], { stdio: ["inherit", "inherit", "inherit"] })
let server = start()
let timer: Timer | undefined
watch("src", { recursive: true }, () => {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    server.kill()
    await server.exited
    server = start()
  }, 100)
})
