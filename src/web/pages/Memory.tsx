// src/web/pages/Memory.tsx — 会话记忆页（读 + 清空，清空走 approve 闸门）
import API from '../api'
import { useAction, useLoad } from '../hooks'
import { ErrorBox, Panel, Spinner, Table } from '../components'
import { arr, g } from '../utils'

export function MemoryPage({ role }: { role: string }) {
  const { data, error, loading, reload } = useLoad<any>(() => API.memory())
  const act = useAction(role)
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const entries = arr(data, 'entries')
  // ListMemory 返回 []map[string]string；按首行键动态出列，非对象则单列展示。
  const cols =
    entries[0] && typeof entries[0] === 'object'
      ? Object.keys(entries[0]).map((c) => ({ title: c, render: (r: any) => String(g(r, c, '—')) }))
      : [{ title: '值', render: (r: any) => String(r) }]
  return (
    <Panel
      title={`会话记忆 (${entries.length})`}
      extra={
        <button
          className="btn sm danger"
          disabled={act.busy}
          onClick={() => {
            if (window.confirm('清空全部会话记忆？不可逆。')) act.run(() => API.clearMemory(role), reload)
          }}
        >
          清空
        </button>
      }
    >
      {act.msg && <div className={act.msg.startsWith('操作失败') ? 'notice err' : 'notice ok'}>{act.msg}</div>}
      <Table columns={cols} rows={entries} empty="无会话记忆（remember/recall 数据为空）" />
    </Panel>
  )
}
