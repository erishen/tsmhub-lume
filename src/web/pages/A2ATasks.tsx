// src/web/pages/A2ATasks.tsx — A2A 任务列表（/api/a2a/tasks，独立加载）
import API from '../api'
import { useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g } from '../utils'

export function A2ATasks() {
  const { data, error, loading, reload } = useLoad<any>(() => API.a2aTasks())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const tasks = arr(data, 'tasks')
  return (
    <Panel title={`A2A 任务 (${tasks.length})`}>
      <Table
        columns={[
          { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
          { title: '类型', render: (r) => String(g(r, 'type', '—')) },
          { title: '状态', render: (r) => <Badge value={g(r, 'status')} /> },
          { title: '节点', render: (r) => String(g(r, 'agent', g(r, 'node', '—'))) },
          { title: '时间', render: (r) => String(g(r, 'updated_at', g(r, 'ts', g(r, 'created_at', '—')))) },
        ]}
        rows={tasks}
        empty="暂无 A2A 任务"
      />
    </Panel>
  )
}
