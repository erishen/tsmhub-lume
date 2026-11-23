// src/web/pages/Agent.tsx — lume Agent 聊天页（框架原生 /react/api/chat SSE）。
// 与 Playground 的区别：这是 ReAct Agent（会话记忆 + 工具调用），Playground 是
// 无状态单轮 chat/completions。流式协议解析在 ../agent.ts（纯函数，可单测）。
import { useEffect, useRef, useState } from 'react'
import { agentChat, newSessionId, type AgentEvent } from '../agent'
import API from '../api'
import { useLoad } from '../hooks'
import { Panel } from '../components'

interface ChatMsg {
  role: 'user' | 'agent'
  text: string
}

// 示例问题：只挑 agent 现有只读工具能回答的，避免误导用户以为它能执行写操作。
const SUGGESTIONS = [
  '现在有多少个 key？',
  '今天的用量和成本是多少？',
  '哪些 provider 不健康？',
  '当前有哪些路由？',
  '给我看一下整体概览',
]

export function AgentPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [note, setNote] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sessionId, setSessionId] = useState(() => newSessionId())
  const [model, setModel] = useState('') // 空 = auto（服务端 LLM_MODEL，由 tsm-hub 路由表选）
  const { data: routesData } = useLoad<any>(() => API.listRoutes())
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // 模型选项直接取 tsm-hub 路由表的对外模型名（空 model 的默认路由不列出）。
  // 路由表变了，刷新页面即可看到新选项；这里不做本地硬编码。
  const routes = Array.isArray(routesData?.routes) ? routesData.routes : []
  const models: string[] = Array.from(new Set<string>(
    routes.map((r: any) => String(r?.model || '')).filter(Boolean) as string[],
  )).sort()

  // 新内容自动滚到底部（jsdom 等环境无 scrollIntoView，用可选调用兜底）。
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, note])

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
  }

  const reset = () => {
    stop()
    setMessages([])
    setNote('')
    setErr('')
    setSessionId(newSessionId())
  }

  const send = async (override?: string) => {
    const text = (override ?? input).trim()
    if (!text || busy) return
    setInput('')
    setErr('')
    setNote('')
    setMessages((m) => [...m, { role: 'user', text }, { role: 'agent', text: '' }])
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const onEvent = (e: AgentEvent) => {
      if (e.t === 'delta') {
        setMessages((m) => {
          const copy = m.slice()
          const last = copy[copy.length - 1]
          if (last && last.role === 'agent') copy[copy.length - 1] = { ...last, text: last.text + e.d }
          return copy
        })
      } else if (e.t === 'note') {
        setNote(e.d)
      } else if (e.t === 'error') {
        setErr(e.d)
      }
      // done：由流结束统一收尾。
    }
    try {
      await agentChat(text, sessionId, ctrl.signal, onEvent, model)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(String(e?.message || e))
    } finally {
      abortRef.current = null
      setBusy(false)
      setNote('')
      // 全程没有 delta 的占位气泡移除（如请求直接失败）。
      setMessages((m) => {
        const last = m[m.length - 1]
        if (last && last.role === 'agent' && !last.text) return m.slice(0, -1)
        return m
      })
    }
  }

  return (
    <Panel
      title="Agent（lume 原生聊天）"
      extra={<button className="btn" onClick={reset}>新会话</button>}
    >
      <div className="notice ok">
        框架原生 ReAct Agent：会话记忆 + 工具调用（控制台只读工具 + tsm-hub 能力目录代理）。
        模型经 <code>tsm-hub</code> 路由；未配置 Key 时为离线演示引擎。
      </div>
      <div className="chat-toolbar">
        <label htmlFor="agent-model">模型</label>
        <select
          id="agent-model"
          aria-label="模型"
          value={model}
          disabled={busy}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">auto（tsm-hub 默认路由）</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="tiny mono wrap">选项来自 tsm-hub 路由表 · 会话 {sessionId}</span>
      </div>
      <div className="chat-log">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="empty">开始与 Agent 对话…</div>
            <div className="chat-suggests">
              <span className="tiny">试试问：</span>
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  className="btn sm"
                  disabled={busy}
                  aria-label={`示例问题：${q}`}
                  onClick={() => void send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-msg user' : 'chat-msg agent'}>
            <div className="chat-role">{m.role === 'user' ? '你' : 'Agent'}</div>
            <div className="chat-text">{m.text || (i === messages.length - 1 && busy ? '…' : '')}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {note && <div className="chat-note">{note}</div>}
      {err && <div className="notice err">{err}</div>}
      <div className="chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder="向 Agent 提问，例如：现在有多少个 key？今天的用量和成本？"
          aria-label="消息"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {busy ? (
          <button className="btn" onClick={stop}>停止</button>
        ) : (
          <button className="btn primary" disabled={!input.trim()} onClick={() => void send()}>发送</button>
        )}
      </div>
    </Panel>
  )
}
