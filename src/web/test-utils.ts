// src/web/test-utils.ts — 前端单测共享工具：fetch mock / 响应构造。
// installFetch 按 (url, init) 路由响应并记录全部调用，便于断言路径 / ?role= / 请求体。
import { vi } from 'vitest'

export const jsonResponse = (body: any, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
})

export const baseOf = (url: string) => url.split('?')[0]

export function installFetch(router: (url: string, init?: RequestInit) => any) {
  const calls: Array<{ url: string; method: string; body?: any }> = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    let body: any
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body))
      } catch {
        body = undefined
      }
    }
    calls.push({ url, method: init?.method || 'GET', body })
    return router(url, init)
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}
