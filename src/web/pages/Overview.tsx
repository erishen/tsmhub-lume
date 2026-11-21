// src/web/pages/Overview.tsx — 总览页
import API, { Overview } from '../api'
import { useLoad } from '../hooks'
import { AggCards, Badge, Empty, ErrorBox, Panel, Spinner, Stat, Table } from '../components'
import { arr, fmtNum, fmtTime, g } from '../utils'

export function OverviewPage() {
  const { data, error, loading, reload } = useLoad<Overview>(() => API.overview())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return <Empty />
  const warnings = arr(data, 'warnings')
  const health = arr(data, 'providers_health')
  const logs = arr(data, 'recent_logs')

  return (
    <>
      <div className="stats">
        <Stat label="Providers" value={fmtNum(data.providers)} hint={`${fmtNum(data.healthy)} 健康`} />
        <Stat label="路由" value={fmtNum(data.routes)} />
        <Stat label="Keys" value={fmtNum(data.keys)} hint={`${warnings.length} 条额度告警`} />
        <Stat label="累计请求" value={fmtNum(data.requests_total)} />
      </div>

      <Panel title="今日用量">
        <AggCards agg={data.today} />
      </Panel>
      <Panel title="累计用量">
        <AggCards agg={data.total} />
      </Panel>

      {warnings.length > 0 && (
        <Panel title={`额度告警 (${warnings.length})`}>
          <Table
            columns={[
              { title: 'Key', render: (r) => String(g(r, 'name', g(r, 'key', '—'))) },
              { title: '类型', render: (r) => String(g(r, 'kind', '—')) },
              { title: '使用率', render: (r) => `${fmtNum(g(r, 'ratio'))}%` },
              { title: '详情', render: (r) => String(g(r, 'detail', '—')) },
            ]}
            rows={warnings}
          />
        </Panel>
      )}

      <Panel title="Provider 健康">
        <Table
          columns={[
            { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
            { title: '状态', render: (r) => <Badge value={g(r, 'healthy', g(r, 'status'))} /> },
            { title: '失败数', render: (r) => fmtNum(g(r, 'failures')) },
            { title: '延迟(ms)', render: (r) => fmtNum(g(r, 'latency_ms')) },
            { title: '冷却至', render: (r) => fmtTime(g(r, 'down_until')) },
          ]}
          rows={health}
          empty="暂无 Provider 健康数据"
        />
      </Panel>

      <Panel title="最近操作">
        <Table
          columns={[
            { title: '时间', render: (r) => fmtTime(g(r, 'created_at', g(r, 'at', g(r, 'ts')))) },
            { title: '动作', render: (r) => String(g(r, 'action', '—')) },
            { title: '对象', render: (r) => `${g(r, 'object', '')} ${g(r, 'object_id', '')}` },
            { title: '操作人', render: (r) => String(g(r, 'operator', '—')) },
          ]}
          rows={logs}
          empty="暂无审计记录"
        />
      </Panel>
    </>
  )
}
