// src/web/main.tsx — 入口：挂载 React 应用（app.tsx 无副作用，便于测试）
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App, ErrorBoundary } from './app'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  )
}
