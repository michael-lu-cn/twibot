import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { initTheme } from "./lib/theme"
import { ThemeProvider } from "./lib/theme-context"
import "./index.css"

// 首帧对齐 <html> 主题（index.html 内联脚本已先行一次，这里兜底）
initTheme()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
