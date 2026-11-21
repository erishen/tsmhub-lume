// src/web/pages/Routes.tsx — 路由表页
import React, { useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g, splitList } from '../utils'

export function RoutesPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.listRoutes())
  const act = useAction(role)
  const [form, setForm] = useState(false)
  const [f, setF] = useState({ model: '', strategy: 'failover', targets: '', remark: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value })

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'routes')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    act.run(
      () =>
        API.createRoute(
          {
            model: f.model,
            strategy: f.strategy,
            targets: splitList(f.targets).map((id, i) => ({
              provider_id: id,
              weight: 1,
              priority: i + 1,
            })),
            remark: f.remark,
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
    <Panel
      title={`路由表 (${rows.length})`}
      extra={
        <button className="btn" onClick={() => setForm(!form)}>
          {form ? '取消' : '+ 新增'}
        </button>
      }
    >
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      {form && (
        <form className="form" onSubmit={submit}>
          <label>对外模型名 / 别名<input value={f.model} onChange={set('model')} required placeholder="smart" /></label>
          <label>策略
            <select value={f.strategy} onChange={set('strategy')}>
              <option value="failover">failover</option>
              <option value="weighted">weighted</option>
              <option value="smart">smart</option>
            </select>
          </label>
          <label>目标 Provider（逗号分隔）<input value={f.targets} onChange={set('targets')} placeholder="p1, p2" /></label>
          <label>备注<input value={f.remark} onChange={set('remark')} /></label>
          <button className="btn primary" disabled={act.busy} type="submit">保存</button>
        </form>
      )}
      <Table
        columns={[
          { title: '模型', render: (r) => <code>{String(g(r, 'model', '—'))}</code> },
          { title: '策略', render: (r) => <Badge value={g(r, 'strategy')} /> },
          {
            title: '目标',
            render: (r) =>
              arr(r, 'targets')
                .map((t: any) => `${g(t, 'provider_id', '?')}${g(t, 'model') ? '/' + g(t, 'model') : ''}(w${g(t, 'weight', 0)},p${g(t, 'priority', 0)})`)
                .join(', ') || '—',
          },
          { title: '备注', render: (r) => String(g(r, 'remark', '—')) },
          {
            title: '操作',
            render: (r) => (
              <button
                className="btn danger sm"
                disabled={act.busy}
                onClick={() => {
                  if (window.confirm(`删除路由 ${g(r, 'model')}？`))
                    act.run(() => API.deleteRoute(String(g(r, 'model')), role), reload)
                }}
              >
                删除
              </button>
            ),
          },
        ]}
        rows={rows}
        empty="尚未配置路由"
      />
    </Panel>
  )
}
