// The React app: Vite on Rolldown, StyleX through its unplugin. The Bun server (src/server.ts) runs the API on
// API_PORT; in dev Vite serves the app on 3000 and proxies /api (and its WebSocket) to it.
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import stylex from "@stylexjs/unplugin"

const API = `http://localhost:${process.env.API_PORT ?? 3001}`

/** "react-dom" for …/node_modules/react-dom/…, "@stylexjs/stylex" for scoped packages. */
const packageOf = (id: string) => id.split(/[\/]node_modules[\/]/).at(-1)!.split(/[\/]/).slice(0, id.includes("node_modules/@") || id.includes("node_modules\@") ? 2 : 1).join("/")

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true, devMode: "full" }), react()],
  server: { port: 3000, strictPort: true, proxy: { "/api": { target: API, ws: true } } },
  build: {
    target: "esnext",
    outDir: "dist",
    rolldownOptions: {
      output: {
        // One chunk per package (after Linear): updating a dependency only invalidates that file in browser caches.
        codeSplitting: {
          groups: [{ debugName: "vendor", test: /node_modules/, name: (id: string) => `vendor-${packageOf(id).replace(/[@/]/g, "-").replace(/^-/, "")}` }],
        },
      },
    },
  },
})
