// src/web/pages/Balances.tsx — Provider 余额页
import API from '../api'
import { useLoad } from '../hooks'
import { Badge, ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, fmtTime, g } from '../utils'

export function BalancesPage() {
  const { data, error, loading, reload } = useLoad<any>(() => API.listBalances())
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const rows = arr(data, 'balances')
  return (
    <Panel title={`Provider 余额 (${rows.length})`}>
      <Table
        columns={[
          { title: 'ID', render: (r) => <code>{String(g(r, 'id', '—'))}</code> },
          { title: '名称', render: (r) => String(g(r, 'name', '—')) },
          { title: '探测时间', render: (r) => fmtTime(g(r, 'probe_at')) },
          {
            title: '余额',
            render: (r) => {
              const b = g(r, 'balance')
              if (!b) return <Badge value={g(r, 'error') ? 'err' : ''} label={g(r, 'error') ? '不可用' : '无'} />
              return <code>{JSON.stringify(b).slice(0, 160)}</code>
            },
          },
          { title: '错误', render: (r) => String(g(r, 'error', '—')) },
        ]}
        rows={rows}
        empty="暂无可查询余额的 Provider（mock-local 已排除）"
      />
    </Panel>
  )
}
