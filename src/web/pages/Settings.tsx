// src/web/pages/Settings.tsx — 运行设置页（读 + 保存，写操作过闸门）
import React, { useEffect, useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { ErrorBox, Panel, Spinner } from '../components'
import { g, num } from '../utils'

const FIELDS: Array<{ key: string; label: string }> = [
  { key: 'default_timeout_ms', label: '默认超时 (ms)' },
  { key: 'max_body_bytes', label: '最大请求体 (bytes)' },
  { key: 'fail_threshold', label: '失败阈值' },
  { key: 'cooldown_sec', label: '冷却 (秒)' },
  { key: 'audit_retention_days', label: '审计保留 (天)' },
  { key: 'usage_retention_days', label: '用量保留 (天)' },
]

export function SettingsPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.settings())
  const act = useAction(role)
  const [f, setF] = useState<Record<string, string>>({})

  // 加载完成后用当前值初始化表单。
  useEffect(() => {
    if (!data) return
    const next: Record<string, string> = {}
    for (const fld of FIELDS) next[fld.key] = String(g(data, fld.key) ?? '')
    setF(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const body: Record<string, number> = {}
    for (const fld of FIELDS) body[fld.key] = num(f[fld.key])
    act.run(() => API.updateSettings(body, role), reload)
  }

  return (
    <Panel title="运行设置">
      <div className="kv">
        <div className="kv-row"><span className="kv-key">data_file</span><span className="wrap">{String(g(data, 'data_file', '—'))}</span></div>
        <div className="kv-row"><span className="kv-key">listen</span><span className="wrap">{String(g(data, 'listen', '—'))}</span></div>
        <div className="kv-row"><span className="kv-key">admin_token_set</span><span className="wrap">{g(data, 'admin_token_set') ? '是' : '否'}</span></div>
      </div>
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      <form className="form" onSubmit={submit}>
        {FIELDS.map((fld) => (
          <label key={fld.key}>
            {fld.label}
            <input value={f[fld.key] || ''} onChange={(e) => setF({ ...f, [fld.key]: e.target.value })} type="number" />
          </label>
        ))}
        <button className="btn primary" disabled={act.busy} type="submit">保存</button>
      </form>
    </Panel>
  )
}
