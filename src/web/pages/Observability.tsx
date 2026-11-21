// src/web/pages/Observability.tsx — 监控页
import API from '../api'
import { useLoad } from '../hooks'
import { ErrorBox, Panel, Spinner, Stat, Table } from '../components'
import { fmtNum, g } from '../utils'

export function ObservabilityPage() {
  const { data, error, loading, reload } = useLoad<any>(() => API.observability())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <Panel title="请求概览">
        <div className="stats">
          <Stat label="请求总数" value={fmtNum(g(data, 'requests_total', g(data, 'total_requests')))} />
          <Stat label="错误数" value={fmtNum(g(data, 'errors_total', g(data, 'errors')))} />
          <Stat label="今日请求" value={fmtNum(g(data, 'requests_today'))} />
          <Stat label="上游调用" value={fmtNum(g(data, 'upstream_requests'))} />
        </div>
      </Panel>
      {Object.keys(data || {})
        .filter((k) => Array.isArray(g(data, k)))
        .map((k) => (
          <Panel key={k} title={k}>
            <Table
              columns={Object.keys(g(data, k)[0] || {}).slice(0, 7).map((col) => ({
                title: col,
                render: (r: any) => String(g(r, col, '—')),
              }))}
              rows={g(data, k)}
            />
          </Panel>
        ))}
    </>
  )
}
