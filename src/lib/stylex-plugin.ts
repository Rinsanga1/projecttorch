// StyleX without a bundler: preloaded by bunfig.toml, this compiles every module that imports StyleX
// as Bun loads it, and keeps the CSS rules it emits. `css()` turns them into the one stylesheet at /app.css.
import { plugin } from "bun"
import { transformSync } from "@babel/core"
import stylex, { type Rule } from "@stylexjs/babel-plugin"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const rules = new Map<string, Rule[]>()

const compile = (file: string, code: string) => {
  const out = transformSync(code, {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [
      ["@babel/plugin-syntax-typescript", {}],
      stylex.withOptions({ dev: false, runtimeInjection: false, unstable_moduleResolution: { type: "commonJS", rootDir: root } }),
    ],
  })
  rules.set(file, ((out?.metadata as any)?.stylex ?? []) as Rule[])
  return out?.code ?? code
}

// Once compiled, a module's token references are inlined, so Bun drops its now-unused `.stylex.ts` imports
// (TypeScript import elision) and those files never load. Compile them all up front for their CSS variables.
for (const f of new Bun.Glob("src/**/*.stylex.ts").scanSync(root)) {
  const file = path.join(root, f)
  compile(file, await Bun.file(file).text())
}

plugin({
  name: "stylex",
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async ({ path: file }) => {
      const code = await Bun.file(file).text()
      return { contents: code.includes("@stylexjs/stylex") ? compile(file, code) : code, loader: "ts" }
    })
  },
})

let cached: string | null = null
/** The compiled stylesheet. Every module has loaded by the first request, so it's built once. */
export const css = () => (cached ??= stylex.processStylexRules([...rules.values()].flat(), { useLayers: true }))
