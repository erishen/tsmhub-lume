// src/web/pages/Agent.tsx — lume Agent 聊天页（框架原生 /react/api/chat SSE）。
// 与 Playground 的区别：这是 ReAct Agent（会话记忆 + 工具调用），Playground 是
// 无状态单轮 chat/completions。流式协议解析在 ../agent.ts（纯函数，可单测）。
import { useEffect, useRef, useState } from 'react'
import {
  agentChat, loadSessionId, newSessionId, saveSessionId,
  listHistories, loadHistory, saveHistory, deleteHistory,
  type ChatMsg, type AgentEvent,
} from '../agent'
import API from '../api'
import { useLoad } from '../hooks'
import { Panel } from '../components'
import { MarkdownText } from '../markdown'

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
  // 初次挂载：沿用 sessionStorage 里的当前会话 id，并从 localStorage 存档恢复
  // 该会话的对话记录（关标签页后重新打开也能找回）。只算一次初始 id：
  // loadSessionId 在无存档时会生成并写入新 id，重复调用会拿到不同的值。
  const initialIdRef = useRef<string | null>(null)
  if (initialIdRef.current === null) initialIdRef.current = loadSessionId()
  const [sessionId, setSessionId] = useState(initialIdRef.current)
  const [messages, setMessages] = useState<ChatMsg[]>(() => {
    const saved = loadHistory(initialIdRef.current as string)
    return saved ? saved.messages : []
  })
  const [histories, setHistories] = useState(() => listHistories())
  const [note, setNote] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
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

  // 一轮对话结束后（busy true→false）把当前会话存档，并刷新会话列表。
  // 不在每条 delta 写 localStorage：流式期间频繁写既浪费也会让列表跳动。
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) {
      saveHistory(sessionId, messages)
      setHistories(listHistories())
    }
    wasBusy.current = busy
  }, [busy, messages, sessionId])

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

  // 切换到历史会话：停止当前流，载入该会话的 id 与对话记录。
  const switchTo = (id: string) => {
    if (busy || id === sessionId) return
    stop()
    const rec = loadHistory(id)
    if (!rec) return
    saveSessionId(id)
    setSessionId(id)
    setMessages(rec.messages)
    setNote('')
    setErr('')
    setInput('')
    setShowFollowup(false)
    setCopiedIdx(null)
  }

  // 删除一条历史存档；若删的是当前会话，同时开一个空白新会话。
  const removeHistory = (id: string) => {
    deleteHistory(id)
    if (id === sessionId) reset()
    setHistories(listHistories())
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

  const send = async (override?: string, retryIndex?: number, freshContext = false) => {
    const text = (override ?? input).trim()
    if (!text || busy) return
    setInput('')
    setErr('')
    setNote('')
    setShowFollowup(false)
    setCopiedIdx(null)
    gotDeltaRef.current = false
    // 本次请求用的会话 id：换上下文重试时必须是局部新值——setSessionId 是异步的，
    // 直接读 state 会拿到旧 id，请求仍带旧记忆，换上下文就失效了。
    const sid = freshContext ? newSessionId() : sessionId
    if (freshContext) {
      saveSessionId(sid)
      setSessionId(sid)
    }
    if (typeof retryIndex === 'number') {
      // 重试 = 从该轮分叉：保留对应提问，丢弃旧回答及其后所有消息，再重新生成。
      // 默认沿用会话（服务端保留前序记忆）；freshContext 时前端历史仍显示，
      // 但服务端从空白上下文重新回答——旧回答不会带偏，代价是前序轮次不再进记忆。
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
      await agentChat(text, sid, ctrl.signal, onEvent, model)
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

  // 点某条回答的「重试」：找到它前面那条用户提问重发。
  // fresh=true 时换新 sessionId，服务端不带旧记忆重新生成（前序对话仍显示）。
  const retry = (index: number, fresh = false) => {
    if (busy) return
    const question = messages[index - 1]
    if (!question || question.role !== 'user') return
    void send(question.text, index, fresh)
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
        <label htmlFor="agent-history">会话</label>
        <select
          id="agent-history"
          aria-label="历史会话"
          value={sessionId}
          disabled={busy}
          onChange={(e) => switchTo(e.target.value)}
        >
          {!histories.some((h) => h.id === sessionId) && (
            <option value={sessionId}>当前对话（未存档）</option>
          )}
          {histories.map((h) => (
            <option key={h.id} value={h.id}>{h.title || h.id}</option>
          ))}
        </select>
        {histories.some((h) => h.id === sessionId) && (
          <button
            type="button"
            className="chat-act"
            title="删除这条会话存档（同时开一个空白新会话）"
            aria-label="删除当前会话存档"
            disabled={busy}
            onClick={() => removeHistory(sessionId)}
          >删除</button>
        )}
        <span className="tiny mono wrap">模型来自 tsm-hub 路由 · 会话 {sessionId}</span>
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
                    title="沿用当前会话重新生成（保留前序记忆，丢弃该轮及之后的回答）"
                    aria-label={`重试第 ${i + 1} 条回答`}
                    disabled={busy}
                    onClick={() => retry(i)}
                  >重试</button>
                  <button
                    type="button"
                    className="chat-act"
                    title="换新会话重新生成：服务端不带旧记忆，旧回答不会带偏；代价是前序轮次不再进入服务端记忆"
                    aria-label={`换上下文重试第 ${i + 1} 条回答`}
                    disabled={busy}
                    onClick={() => retry(i, true)}
                  >换上下文</button>
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
