import React from 'react'
import ReactDOM from 'react-dom/client'
// M3 设计 token + Tailwind utilities 先加载，App.tsx 里的 App.css 后加载，
// 让 App.css 的具体规则在 Cascade 后段覆盖 Tailwind utility（仅当冲突时）。
import './ui/tokens.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
