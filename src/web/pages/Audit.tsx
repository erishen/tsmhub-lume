// src/web/pages/Audit.tsx — 审计页
import { useState } from 'react'
import API from '../api'
import { useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, fmtNum, fmtTime, g, num } from '../utils'

export function AuditPage() {
  const [limit, setLimit] = useState(100)
  const { data, error, loading, reload } = useLoad<any>(() => API.auditLogs(limit), [limit])
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const logs = arr(data, 'logs')
  return (
    <Panel title={`审计日志 · 共 ${fmtNum(g(data, 'total', logs.length))} 条`} extra={
      <select value={limit} onChange={(e) => setLimit(num(e.target.value, 100))}>
        {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{n} 条</option>)}
      </select>
    }>
      <Table
        columns={[
          { title: '时间', render: (r) => fmtTime(g(r, 'created_at', g(r, 'at'))) },
          { title: '动作', render: (r) => <Badge value={g(r, 'action')} /> },
          { title: '对象', render: (r) => String(g(r, 'object', '—')) },
          { title: 'ID', render: (r) => String(g(r, 'object_id', '—')) },
          { title: '操作人', render: (r) => String(g(r, 'operator', '—')) },
          { title: 'IP', render: (r) => String(g(r, 'client_ip', '—')) },
        ]}
        rows={logs}
        empty="审计未启用或暂无记录"
      />
    </Panel>
  )
}
