// src/web/pages/Models.tsx — 模型目录页（/api/models → 上游 models/catalog）
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g } from '../utils'

export function ModelsPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.listModels())
  const act = useAction(role)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'models')
  return (
    <Panel
      title={`模型目录 (${rows.length})`}
      extra={
        <button className="btn sm" disabled={act.busy} onClick={() => act.run(() => API.refreshModels(role), reload)}>
          刷新目录
        </button>
      }
    >
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      <Table
        columns={[
          { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
          { title: 'Provider', render: (r) => String(g(r, 'provider', '—')) },
          { title: '类别', render: (r) => String(g(r, 'category', '—')) },
          { title: '用途', render: (r) => <span className="wrap">{String(g(r, 'purpose', '—'))}</span> },
          { title: '上下文', render: (r) => String(g(r, 'context', g(r, 'context_length', '—'))) },
          { title: '免费', render: (r) => <Badge value={g(r, 'free') ? 'ok' : ''} label={g(r, 'free') ? 'FREE' : '—'} /> },
          { title: '入路由', render: (r) => <Badge value={g(r, 'in_route') ? 'ok' : ''} label={g(r, 'in_route') ? '是' : '否'} /> },
          { title: '评分', render: (r) => String(g(r, 'route_score', '—')) },
          {
            title: '定价',
            render: (r) => {
              const p = g(r, 'pricing')
              return p ? <code>{`${g(p, 'prompt', '')} / ${g(p, 'completion', '')}`}</code> : '—'
            },
          },
          {
            title: '状态',
            render: (r) => {
              const u = g(r, 'unavailable')
              return u ? <Badge value="err" label={String(u)} /> : <span className="wrap">可用</span>
            },
          },
        ]}
        rows={rows}
        empty="目录为空（可在 Providers 页探测拉取模型）"
      />
    </Panel>
  )
}
