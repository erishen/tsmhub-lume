// src/web/pages/Agent.tsx — lume Agent 聊天页（框架原生 /react/api/chat SSE）。
// 与 Playground 的区别：这是 ReAct Agent（会话记忆 + 工具调用），Playground 是
// 无状态单轮 chat/completions。流式协议解析在 ../agent.ts（纯函数，可单测）。
import { useEffect, useRef, useState } from 'react'
import { agentChat, loadSessionId, newSessionId, saveSessionId, type AgentEvent } from '../agent'
import API from '../api'
import { useLoad } from '../hooks'
import { Panel } from '../components'
import { MarkdownText } from '../markdown'

interface ChatMsg {
  role: 'user' | 'agent'
  text: string
}

// 示例问题：只挑 agent 现有只读工具能回答的，避免误导用户以为它能执行写操作。
// 首屏引导问题 + 回答完成后的追问问题（两组交替，避免每次都是同一批）。
const INTRO_SUGGESTIONS = [
  '现在有多少个 key？',
  '今天的用量和成本是多少？',
  '哪些 provider 不健康？',
  '当前有哪些路由？',
  '给我看一下整体概览',
]
const FOLLOWUP_SUGGESTIONS = [
  '哪个 provider 错误率最高？',
  '今天总共花了多少钱？',
  '哪些 key 没有用量？',
  '路由表的 failover 是怎么配置的？',
  '总结一下现在的系统状态',
]

export function AgentPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [note, setNote] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sessionId, setSessionId] = useState(loadSessionId)
  const [model, setModel] = useState('') // 空 = auto（服务端 LLM_MODEL，由 tsm-hub 路由表选）
  const [showFollowup, setShowFollowup] = useState(false) // 回答完成后显示下一组追问示例
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null) // 最近一次复制成功的消息下标（短暂反馈）
  const { data: routesData } = useLoad<any>(() => API.listRoutes())
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const gotDeltaRef = useRef(false) // 本轮是否收到过 delta（区分成功回复与失败/空回复）
  const copyTimerRef = useRef<number | null>(null)

  // 模型选项直接取 tsm-hub 路由表的对外模型名（空 model 的默认路由不列出）。
  // 路由表变了，刷新页面即可看到新选项；这里不做本地硬编码。
  const routes = Array.isArray(routesData?.routes) ? routesData.routes : []
  const models: string[] = Array.from(new Set<string>(
    routes.map((r: any) => String(r?.model || '')).filter(Boolean) as string[],
  )).sort()

  // 新内容自动滚到底部（jsdom 等环境无 scrollIntoView，用可选调用兜底）。
  // 依赖含 showFollowup / busy：回答完成追问区出现、或发送期间占位出现时也要滚到底，
  // 否则追问区渲染在可见区域下方，用户看不到。
  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, note, showFollowup, busy])

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
    const fresh = newSessionId()
    saveSessionId(fresh)
    setSessionId(fresh)
    setShowFollowup(false)
    setCopiedIdx(null)
  }

  // 复制回答的 Markdown 原文（不是渲染后的 DOM 文本），便于粘贴到别处保留格式。
  // 非安全上下文（http / 老浏览器）没有 clipboard API 时降级到 execCommand。
  const copy = async (text: string, index: number) => {
    if (!text) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopiedIdx(index)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopiedIdx(null), 2000)
    } catch {
      setErr('复制失败，请手动选择文本')
    }
  }

  const send = async (override?: string, retryIndex?: number) => {
    const text = (override ?? input).trim()
    if (!text || busy) return
    setInput('')
    setErr('')
    setNote('')
    setShowFollowup(false)
    setCopiedIdx(null)
    gotDeltaRef.current = false
    if (typeof retryIndex === 'number') {
      // 重试 = 从该轮分叉：保留对应提问，丢弃旧回答及其后所有消息，再重新生成。
      // 会话 ID 不变，服务端 ReAct 记忆仍含前序轮次，上下文不丢。
      setMessages((m) => {
        const old = m[retryIndex]
        const question = m[retryIndex - 1]
        if (!old || old.role !== 'agent' || !question || question.role !== 'user') return m
        return [...m.slice(0, retryIndex), { role: 'agent', text: '' }]
      })
    } else {
      setMessages((m) => [...m, { role: 'user', text }, { role: 'agent', text: '' }])
    }
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const onEvent = (e: AgentEvent) => {
      if (e.t === 'delta') {
        gotDeltaRef.current = true
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
      // 有实际回复才出下一组示例；停止/失败不出。
      if (gotDeltaRef.current && !ctrl.signal.aborted) setShowFollowup(true)
    }
  }

  // 点某条回答的「重试」：找到它前面那条用户提问，以同一会话重发。
  const retry = (index: number) => {
    if (busy) return
    const question = messages[index - 1]
    if (!question || question.role !== 'user') return
    void send(question.text, index)
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
              {INTRO_SUGGESTIONS.map((q) => (
                <button key={q} className="btn sm" disabled={busy} aria-label={`示例问题：${q}`} onClick={() => void send(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-msg user' : 'chat-msg agent'}>
            <div className="chat-head">
              <div className="chat-role">{m.role === 'user' ? '你' : 'Agent'}</div>
              {m.role === 'agent' && m.text && (
                <div className="chat-actions">
                  <button
                    type="button"
                    className="chat-act"
                    title="复制回答的 Markdown 原文"
                    aria-label={`复制第 ${i + 1} 条回答`}
                    disabled={busy && i === messages.length - 1}
                    onClick={() => void copy(m.text, i)}
                  >{copiedIdx === i ? '已复制' : '复制'}</button>
                  <button
                    type="button"
                    className="chat-act"
                    title="基于当前会话重新生成这条回答（会丢弃该轮及之后的回答）"
                    aria-label={`重试第 ${i + 1} 条回答`}
                    disabled={busy}
                    onClick={() => retry(i)}
                  >重试</button>
                </div>
              )}
            </div>
            <div className="chat-text">
              {m.role === 'agent'
                ? (m.text ? <MarkdownText text={m.text} /> : (i === messages.length - 1 && busy ? '…' : ''))
                : m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {note && <div className="chat-note">{note}</div>}
      {err && <div className="notice err">{err}</div>}
      {/* 追问区放在可滚动的 chat-log 之外、输入框上方：长回答时不会排在滚动区底部而看不到。 */}
      {showFollowup && !busy && (
        <div className="chat-suggests followup">
          <span className="tiny">还可以问：</span>
          {FOLLOWUP_SUGGESTIONS.map((q) => (
            <button key={q} className="btn sm" aria-label={`示例问题：${q}`} onClick={() => void send(q)}>{q}</button>
          ))}
        </div>
      )}
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
