// src/web/pages/Providers.tsx — 上游 Providers 页
import React, { useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g, num, splitList } from '../utils'

export function ProvidersPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.listProviders())
  const act = useAction(role)
  const [form, setForm] = useState(false)
  const [probe, setProbe] = useState('')
  const [f, setF] = useState({
    name: '',
    base_url: '',
    api_key: '',
    protocol: 'openai',
    models: '',
    weight: '1',
    priority: '1',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value })

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'providers')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    act.run(
      () =>
        API.createProvider(
          {
            name: f.name,
            base_url: f.base_url,
            api_key: f.api_key,
            protocol: f.protocol,
            models: splitList(f.models),
            weight: num(f.weight, 1),
            priority: num(f.priority, 1),
            enabled: true,
          },
          role,
        ),
      () => {
        setForm(false)
        reload()
      },
    )
  }

  return (
    <>
      <Panel
        title={`上游 Providers (${rows.length})`}
        extra={
          <button className="btn" onClick={() => setForm(!form)}>
            {form ? '取消' : '+ 新增'}
          </button>
        }
      >
        {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
        {form && (
          <form className="form" onSubmit={submit}>
            <label>名称<input value={f.name} onChange={set('name')} required placeholder="my-provider" /></label>
            <label>Base URL<input value={f.base_url} onChange={set('base_url')} required placeholder="https://api.example.com/v1" /></label>
            <label>API Key<input value={f.api_key} onChange={set('api_key')} placeholder="sk-… 或 env:VAR" /></label>
            <label>协议
              <select value={f.protocol} onChange={set('protocol')}>
                {['openai', 'anthropic', 'azure', 'gemini', 'bedrock', 'sagemaker', 'cohere', 'mistral', 'huggingface', 'replicate', 'together', 'fireworks', 'groq'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>模型（逗号分隔）<input value={f.models} onChange={set('models')} placeholder="smart, cheap" /></label>
            <label>权重<input value={f.weight} onChange={set('weight')} type="number" /></label>
            <label>优先级<input value={f.priority} onChange={set('priority')} type="number" /></label>
            <div className="row-actions">
              <button
                className="btn"
                disabled={!f.base_url || probe === '探测中…'}
                onClick={async () => {
                  setProbe('探测中…')
                  try {
                    const r = await API.probeProvider({ base_url: f.base_url, api_key: f.api_key }, role)
                    const n = r?.models?.length ?? r?.count ?? '?'
                    setProbe(`探测完成：${n} 个模型`)
                  } catch (e: any) {
                    setProbe(`探测失败：${e?.message || e}`)
                  }
                }}
                type="button"
              >
                探测模型
              </button>
              <button className="btn primary" disabled={act.busy} type="submit">保存</button>
            </div>
            {probe && <div className={probe.startsWith('探测失败') ? 'notice err' : 'notice ok'}>{probe}</div>}
          </form>
        )}
        <Table
          columns={[
            { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
            { title: '名称', render: (r) => String(g(r, 'name', '—')) },
            { title: '协议', render: (r) => String(g(r, 'protocol', 'openai')) },
            { title: '模型', render: (r) => <span className="wrap">{arr(r, 'models').join(', ') || '—'}</span> },
            { title: 'W/P', render: (r) => `${g(r, 'weight', 0)}/${g(r, 'priority', 0)}` },
            { title: '启用', render: (r) => <Badge value={g(r, 'enabled')} /> },
            {
              title: '操作',
              render: (r) => (
                <button
                  className="btn danger sm"
                  disabled={act.busy}
                  onClick={() => {
                    if (window.confirm(`删除 Provider ${g(r, 'id')}？此操作不可逆。`))
                      act.run(() => API.deleteProvider(String(g(r, 'id')), role), reload)
                  }}
                >
                  删除
                </button>
              ),
            },
          ]}
          rows={rows}
          empty="尚未配置 Provider"
        />
      </Panel>
    </>
  )
}
