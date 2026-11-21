// src/web/hooks.ts — 通用数据加载与操作钩子。
import { useCallback, useEffect, useState } from 'react'

export function useLoad<T>(loader: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    loader()
      .then((d) => {
        if (alive) setData(d)
      })
      .catch((e: any) => {
        if (alive) setError(String(e?.message || e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, loading, reload }
}

export function useAction(role: string) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const run = async (fn: () => Promise<any>, done?: () => void) => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      await fn()
      setMsg('操作成功')
      done?.()
    } catch (e: any) {
      setMsg(`操作失败：${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }
  return { role, busy, msg, run, clear: () => setMsg('') }
}
