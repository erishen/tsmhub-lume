// vitest.config.ts —— 前端单测（jsdom 环境 + React，esbuild 原生 JSX 转换）
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/web/**/*.test.{ts,tsx}'],
    css: false,
  },
})
