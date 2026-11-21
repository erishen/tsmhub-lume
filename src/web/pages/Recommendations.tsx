// src/web/pages/Recommendations.tsx — 模型推荐页（/api/models/recommendations）
import API from '../api'
import { useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Stat, Table } from '../components'
import { arr, fmtNum, g } from '../utils'

export function RecommendationsPage() {
  const { data, error, loading, reload } = useLoad<any>(() => API.listRecommendations())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'scenarios')
  return (
    <>
      <Panel title="模型推荐">
        <div className="stats">
          <Stat label="总模型" value={fmtNum(g(data, 'total_models'))} />
          <Stat label="免费模型" value={fmtNum(g(data, 'free_models'))} />
          <Stat label="场景数" value={fmtNum(g(data, 'scenario_num'))} />
        </div>
      </Panel>
      <Panel title="推荐场景">
        <Table
          columns={[
            { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
            { title: 'Provider', render: (r) => String(g(r, 'provider', '—')) },
            { title: '用途', render: (r) => <span className="wrap">{String(g(r, 'purpose', '—'))}</span> },
            { title: '上下文', render: (r) => String(g(r, 'context_length', '—')) },
            { title: '免费', render: (r) => <Badge value={g(r, 'free') ? 'ok' : ''} label={g(r, 'free') ? 'FREE' : '—'} /> },
            { title: '入路由', render: (r) => <Badge value={g(r, 'in_route') ? 'ok' : ''} label={g(r, 'in_route') ? '是' : '否'} /> },
            { title: '评分', render: (r) => String(g(r, 'route_score', '—')) },
            {
              title: '状态',
              render: (r) => {
                const u = g(r, 'unavailable')
                return u ? <Badge value="err" label={String(u)} /> : <span className="wrap">可用</span>
              },
            },
          ]}
          rows={rows}
          empty="暂无推荐数据"
        />
      </Panel>
    </>
  )
}
