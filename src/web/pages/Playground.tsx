// src/web/pages/Playground.tsx — Playground 测试页
import { useState } from 'react'
import API, { ChatReply, Meta } from '../api'
import { useLoad } from '../hooks'
import { ErrorBox, Panel } from '../components'
import { arr, g } from '../utils'

export function PlaygroundPage({ meta }: { meta: Meta | null }) {
  const { data: modelsData } = useLoad<any>(() => API.listModels())
  const clientKey = !!meta?.playground?.client_key
  const [model, setModel] = useState('smart')
  const [text, setText] = useState('你好，请介绍一下自己。')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const send = async () => {
    setBusy(true)
    setErr('')
    setReply('')
    try {
      const r: ChatReply = await API.chat(model, [{ role: 'user', content: text }])
      if (r.error && !r.choices) throw new Error(r.error)
      const content = r.choices?.[0]?.message?.content || '(空响应)'
      setReply(content)
      if (r.usage) setReply((prev) => `${prev}\n\n— usage: ${JSON.stringify(r.usage)}`)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const modelNames: string[] = arr(modelsData, 'models')
    .map((m: any) => String(typeof m === 'string' ? m : g(m, 'id', g(m, 'model', ''))))
    .filter(Boolean)

  return (
    <Panel title="Playground（经服务端注入 sk-tr- Key）">
      {!clientKey && (
        <div className="notice warn">
          服务端未配置 <code>TSM_CLIENT_KEY</code>（sk-tr-… 客户端 Key），Playground 不可用。
          设置后在容器里可用 <code>TSM_CLIENT_KEY=…</code>（本地 <code>TSM_CLIENT_KEY=… make dev</code>）。
        </div>
      )}
      {err && <ErrorBox error={err} />}
      <div className="form">
        <label>模型
          <input list="model-list" value={model} onChange={(e) => setModel(e.target.value)} placeholder="smart" />
          <datalist id="model-list">
            {(modelNames.length ? modelNames : ['smart', 'cheap', 'auto']).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>消息<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button className="btn primary" disabled={busy || !clientKey || !text.trim()} onClick={send}>
          {busy ? '请求中…' : '发送'}
        </button>
      </div>
      {reply && <pre className="reply">{reply}</pre>}
    </Panel>
  )
}
