// src/web/pages/Keys.tsx — 自制 Keys 页
import React, { useState } from 'react'
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, fmtNum, fmtTime, g, num, splitList } from '../utils'

export function KeysPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.listKeys())
  const act = useAction(role)
  const [form, setForm] = useState(false)
  const [revealed, setRevealed] = useState('')
  const [edit, setEdit] = useState<null | { id: string; name: string; models: string; max_tokens: string; max_cost_usd: string; daily_tokens: string; rpm: string }>(null)
  const [f, setF] = useState({ name: '', models: '', max_tokens: '', max_cost_usd: '', daily_tokens: '', rpm: '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'keys')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    act.run(
      () =>
        API.createKey(
          {
            name: f.name,
            models: splitList(f.models),
            quota: {
              max_tokens: num(f.max_tokens),
              max_cost_usd: num(f.max_cost_usd),
              daily_tokens: num(f.daily_tokens),
              rpm: num(f.rpm),
            },
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
      title={`自制 Keys (${rows.length})`}
      extra={
        <button className="btn" onClick={() => setForm(!form)}>
          {form ? '取消' : '+ 签发'}
        </button>
      }
    >
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      {revealed && <div className="notice ok">{revealed}</div>}
      {form && (        <form className="form" onSubmit={submit}>
          <label>名称<input value={f.name} onChange={set('name')} required /></label>
          <label>可用模型（逗号，空=不限）<input value={f.models} onChange={set('models')} /></label>
          <label>总 token 额度<input value={f.max_tokens} onChange={set('max_tokens')} type="number" /></label>
          <label>总金额 USD<input value={f.max_cost_usd} onChange={set('max_cost_usd')} type="number" step="0.01" /></label>
          <label>每日 token<input value={f.daily_tokens} onChange={set('daily_tokens')} type="number" /></label>
          <label>RPM<input value={f.rpm} onChange={set('rpm')} type="number" /></label>
          <button className="btn primary" disabled={act.busy} type="submit">签发</button>
        </form>
      )}
      {edit && (
        <form className="form" onSubmit={(e) => {
          e.preventDefault()
          act.run(
            () =>
              API.updateKey(
                edit.id,
                {
                  name: edit.name,
                  models: splitList(edit.models),
                  quota: {
                    max_tokens: num(edit.max_tokens),
                    max_cost_usd: num(edit.max_cost_usd),
                    daily_tokens: num(edit.daily_tokens),
                    rpm: num(edit.rpm),
                  },
                },
                role,
              ),
            () => {
              setEdit(null)
              reload()
            },
          )
        }}>
          <label>名称<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required /></label>
          <label>可用模型（逗号，空=不限）<input value={edit.models} onChange={(e) => setEdit({ ...edit, models: e.target.value })} /></label>
          <label>总 token 额度<input value={edit.max_tokens} onChange={(e) => setEdit({ ...edit, max_tokens: e.target.value })} type="number" /></label>
          <label>总金额 USD<input value={edit.max_cost_usd} onChange={(e) => setEdit({ ...edit, max_cost_usd: e.target.value })} type="number" step="0.01" /></label>
          <label>每日 token<input value={edit.daily_tokens} onChange={(e) => setEdit({ ...edit, daily_tokens: e.target.value })} type="number" /></label>
          <label>RPM<input value={edit.rpm} onChange={(e) => setEdit({ ...edit, rpm: e.target.value })} type="number" /></label>
          <div className="row-actions">
            <button className="btn" type="button" onClick={() => setEdit(null)}>取消</button>
            <button className="btn primary" disabled={act.busy} type="submit">更新</button>
          </div>
        </form>
      )}
      <Table
        columns={[
          { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
          { title: '名称', render: (r) => String(g(r, 'name', '—')) },
          { title: 'Prefix', render: (r) => <code>{String(g(r, 'prefix', '—'))}</code> },
          { title: '状态', render: (r) => <Badge value={g(r, 'enabled')} label={g(r, 'enabled') ? '启用' : '停用'} /> },
          {
            title: '额度',
            render: (r) => {
              const q = g(r, 'quota') || {}
              return `tokens ${fmtNum(q.max_tokens)} · $${fmtNum(q.max_cost_usd)} · day ${fmtNum(q.daily_tokens)} · rpm ${fmtNum(q.rpm)}`
            },
          },
          { title: '创建', render: (r) => fmtTime(g(r, 'created_at')) },
          {
            title: '操作',
            render: (r) => (
              <div className="row-actions">
                <button
                  className="btn sm"
                  disabled={act.busy}
                  onClick={() => {
                    const q = g(r, 'quota') || {}
                    setEdit({
                      id: String(g(r, 'id')),
                      name: String(g(r, 'name', '')),
                      models: (g(r, 'models') || []).join(', '),
                      max_tokens: String(q.max_tokens ?? ''),
                      max_cost_usd: String(q.max_cost_usd ?? ''),
                      daily_tokens: String(q.daily_tokens ?? ''),
                      rpm: String(q.rpm ?? ''),
                    })
                  }}
                >
                  编辑
                </button>
                <button
                  className="btn sm"
                  disabled={act.busy}
                  onClick={() =>
                    act.run(async () => {
                      const res = await API.revealKey(String(g(r, 'id')), role)
                      setRevealed(`Key「${g(r, 'name')}」明文：${g(res, 'key')}`)
                    })
                  }
                >
                  明文
                </button>
                <button className="btn sm" disabled={act.busy} onClick={() => act.run(() => API.toggleKey(String(g(r, 'id')), role), reload)}>
                  {g(r, 'enabled') ? '停用' : '启用'}
                </button>
                <button
                  className="btn danger sm"
                  disabled={act.busy}
                  onClick={() => {
                    if (window.confirm(`删除 Key ${g(r, 'name')}？`)) act.run(() => API.deleteKey(String(g(r, 'id')), role), reload)
                  }}
                >
                  删除
                </button>
              </div>
            ),
          },
        ]}
        rows={rows}
        empty="尚未签发 Key"
      />
    </Panel>
  )
}
