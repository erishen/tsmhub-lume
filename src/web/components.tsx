// src/web/components.tsx — 通用展示组件（无业务逻辑，仅依赖 utils）。
import React from 'react'
import { fmtCost, fmtNum, g, statusClass } from './utils'

export function Spinner({ label = '加载中…' }: { label?: string }) {
  return (
    <div className="empty">
      <span className="spin" /> {label}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="errorbox">
      <div>
        <strong>请求失败</strong>
        <p>{error}</p>
      </div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return <div className="empty">{text}</div>
}

export function Panel({
  title,
  extra,
  children,
}: {
  title: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {extra}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  )
}

export function Badge({ value, label }: { value?: any; label?: string }) {
  const s = value == null ? '' : String(value)
  return <span className={statusClass(s)}>{label || s || '—'}</span>
}

export function Table({
  columns,
  rows,
  empty,
}: {
  columns: Array<{ title: string; render: (r: any, i: number) => React.ReactNode }>
  rows: any[]
  empty?: string
}) {
  if (!rows.length) return <Empty text={empty} />
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c, j) => (
                <td key={j}>{c.render(r, i)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  )
}

export function AggCards({ agg }: { agg: any }) {
  return (
    <div className="agg-grid">
      <Stat label="请求数" value={fmtNum(g(agg, 'requests'))} />
      <Stat label="Prompt tokens" value={fmtNum(g(agg, 'prompt_tokens'))} />
      <Stat label="Completion tokens" value={fmtNum(g(agg, 'completion_tokens'))} />
      <Stat label="估算成本" value={fmtCost(g(agg, 'cost_usd'))} />
    </div>
  )
}
