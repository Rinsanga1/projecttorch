// The React app: Vite on Rolldown, StyleX through its unplugin. The Bun server (src/server.ts) runs the API on
// API_PORT; in dev Vite serves the app on 3000 and proxies /api (and its WebSocket) to it.
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import stylex from "@stylexjs/unplugin"

const API = `http://localhost:${process.env.API_PORT ?? 3001}`

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true, devMode: "full" }), react()],
  server: { port: 3000, strictPort: true, proxy: { "/api": { target: API, ws: true } } },
  build: { target: "esnext", outDir: "dist" },
})
