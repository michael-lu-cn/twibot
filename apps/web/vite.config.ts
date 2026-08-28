import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath, URL } from "node:url"

const PORT = Number(process.env["PORT"] ?? 12001)

export default defineConfig({
  plugins: [tailwindcss(), react({ fastRefresh: false })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: PORT,
    proxy: {
      "/api": `http://127.0.0.1:12000`,
    },
  },
})
