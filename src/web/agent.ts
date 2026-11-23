// src/web/agent.ts — lume 原生 agent 聊天客户端（POST /react/api/chat，SSE）。
//
// 该端点由 lume 框架层（静态链的 agent-httpd）在路由分发前拦截，不走 BFF：
// LLM_API_KEY 配置时走 ReAct 循环（工具调用 + 会话记忆），未配置时回落内置
// 离线演示引擎。SSE 信封与 agent-httpd 契约一致（见 agent-httpd/src/agent/llm.c）：
//   data: {"t":"delta","d":"<text>"}\n\n   增量回答片段
//   data: {"t":"note","d":"<text>"}\n\n    状态提示（轮次/工具轨迹）
//   data: {"t":"error","d":"<text>"}\n\n   致命错误，流随之结束
//   data: {"t":"done"}\n\n                 结束标记
// 心跳为 SSE 注释行（":" 开头），解析时忽略。

export type AgentEvent =
  | { t: 'note'; d: string }
  | { t: 'delta'; d: string }
  | { t: 'error'; d: string }
  | { t: 'done' }

// 增量解析 SSE 缓冲：返回 (完整事件列表, 未完块剩余文本)。
// 容错设计：半包留到下一次拼接；注释心跳、非 data: 行、非 JSON 载荷、
// 未知事件类型与缺失 d 字段一律忽略，绝不抛异常。
export function parseAgentSse(buffer: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = []
  const normalized = buffer.replace(/\r\n/g, '\n')
  const blocks = normalized.split('\n\n')
  const rest = blocks.pop() || ''
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const payload = s.slice(5).trim()
      if (!payload) continue
      try {
        const obj = JSON.parse(payload)
        const t = obj?.t
        if (t === 'done') {
          events.push({ t: 'done' })
        } else if ((t === 'delta' || t === 'note' || t === 'error') && typeof obj.d === 'string') {
          events.push({ t, d: obj.d })
        }
      } catch {
        /* 半包/噪声：忽略 */
      }
    }
  }
  return { events, rest }
}

// 会话 id 持久化 key（sessionStorage：同标签页刷新后复用，关标签页即失效，
// 避免长期残留占用服务端 ReAct 会话记忆）。
export const SESSION_KEY = 'tsmhub_lume_session'

// 读取/保存当前会话 id：损坏或非法值回退生成新的。服务端只接受 sess-<hex-like>，
// 这里用同样的字符白名单校验，避免把脏值发给上游。
export function loadSessionId(): string {
  try {
    const v = sessionStorage.getItem(SESSION_KEY) || ''
    if (/^sess-[A-Za-z0-9\-_+]+$/.test(v)) return v
  } catch {
    /* 隐私模式 / 无 sessionStorage：回退内存会话 */
  }
  const fresh = newSessionId()
  saveSessionId(fresh)
  return fresh
}

export function saveSessionId(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, id)
  } catch {
    /* 忽略 */
  }
}

// 会话 id 只允许 字母/数字/-_+（服务端 chat_origin_ok 之后的白名单校验），
// 浏览器端按 lume 文档约定用 sess-<hex>。
export function newSessionId(): string {
  try {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return 'sess-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return 'sess-' + Math.random().toString(16).slice(2).replace(/[^0-9a-f]/g, '0').padEnd(16, '0').slice(0, 16)
  }
}

// ---- 会话历史存档（localStorage：刷新/关标签页后仍可找回）----
// 当前会话 id 仍存 sessionStorage（见上）：同标签页刷新复用、关标签页失效；
// 历史存档存 localStorage，用于「会话列表」切换。两者互补：前者管「当前是哪条」，
// 后者管「都有哪些、各自的对话记录」。localStorage 不可用（隐私模式）时全部静默降级。

export interface ChatMsg {
  role: 'user' | 'agent'
  text: string
}

export interface SessionRecord {
  id: string
  title: string
  messages: ChatMsg[]
  updated: number
}

export const HISTORY_KEY = 'tsmhub_lume_histories'
const HISTORY_LIMIT = 20 // 最多保留 20 条，避免 localStorage 无限增长

function isMsgArray(v: any): v is ChatMsg[] {
  return Array.isArray(v) && v.every((m) => m
    && (m.role === 'user' || m.role === 'agent')
    && typeof m.text === 'string')
}

/** 读取全部会话存档，按最近更新排序；脏数据整条跳过。 */
export function listHistories(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) || ''
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((r: any) => r && typeof r.id === 'string'
      && /^sess-[A-Za-z0-9\-_+]+$/.test(r.id)
      && typeof r.title === 'string' && isMsgArray(r.messages)
      && typeof r.updated === 'number')
      .map((r: any) => ({ id: r.id, title: r.title, messages: r.messages, updated: r.updated }))
      .sort((a: SessionRecord, b: SessionRecord) => b.updated - a.updated)
  } catch {
    return []
  }
}

/** 保存/覆盖一条会话存档（按 id 去重），超出上限丢弃最旧的。 */
export function saveHistory(id: string, messages: ChatMsg[], title?: string): void {
  if (!/^sess-[A-Za-z0-9\-_+]+$/.test(id) || messages.length === 0) return
  try {
    const all = listHistories().filter((r) => r.id !== id)
    const firstUser = messages.find((m) => m.role === 'user')
    const derived = (firstUser?.text || '新会话').replace(/\s+/g, ' ').slice(0, 40)
    all.unshift({
      id,
      title: title ?? derived,
      messages: messages.map((m) => ({ role: m.role, text: m.text })),
      updated: Date.now(),
    })
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all.slice(0, HISTORY_LIMIT)))
  } catch {
    /* localStorage 不可用：忽略 */
  }
}

/** 删除一条会话存档。 */
export function deleteHistory(id: string): void {
  try {
    const all = listHistories().filter((r) => r.id !== id)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all))
  } catch {
    /* 忽略 */
  }
}

/** 读取某条存档（不存在返回 null）。 */
export function loadHistory(id: string): SessionRecord | null {
  return listHistories().find((r) => r.id === id) || null
}

export interface AgentChatOptions {
  /** 首字节超时：建立连接后多久没收到第一个 SSE 数据块就自动停止（默认 15s）。 */
  firstByteMs?: number
  /** 整体超时：从发请求到流结束的总时限（默认 180s，需大于服务端 LLM_TIMEOUT）。 */
  totalMs?: number
}

// 发送一条消息并消费 SSE 流，逐事件回调。抛错 = 网络 / HTTP 层失败；
// 调用方用 AbortController 实现「停止」（AbortError 由调用方静默处理）。
// 另外内置双重超时：首字节 + 整体。超时会 abort 内部控制器并抛明确错误，
// 避免服务端卡住（不发 done 也不关流）时页面永远停在「停止」状态。
export async function agentChat(
  message: string,
  sessionId: string,
  signal: AbortSignal | undefined,
  onEvent: (e: AgentEvent) => void,
  model?: string,
  opts: AgentChatOptions = {},
): Promise<void> {
  const firstByteMs = opts.firstByteMs ?? 15000
  const totalMs = opts.totalMs ?? 180000
  const ctrl = new AbortController()
  let timedOut = ''
  const relayAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', relayAbort, { once: true })
  }
  const arm = (ms: number, label: string) => window.setTimeout(() => {
    timedOut = label
    ctrl.abort()
  }, ms)
  const firstByteTimer = arm(firstByteMs, `首字节超时（${Math.round(firstByteMs / 1000)}s）`)
  const totalTimer = arm(totalMs, `响应超时（${Math.round(totalMs / 1000)}s）`)

  try {
    // model 非空才下发：留空 = 服务端 LLM_MODEL（默认 auto，由 tsm-hub 路由表选模型）。
    // 名字来自 tsm-hub /api/routes 的路由 key；服务端另有 LLM_ALLOWED_MODELS 白名单兜底。
    const body: Record<string, string> = { message, sessionId }
    if (model) body.model = model
    const r = await fetch('/react/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok || !r.body) {
      let detail = `HTTP ${r.status}`
      try {
        const text = await r.text()
        if (text) detail = text.slice(0, 300)
      } catch {
        /* 忽略读体失败 */
      }
      throw new Error(`Agent 端点不可用（${detail}）`)
    }
    // 收到首个数据块就撤掉首字节计时器（整体计时器继续走）。
    let firstByteSeen = false
    // abort 竞速：超时/手动停止时，即使底层 reader.read() 因网络卡死不返回，
    // 也能立刻跳出等待（真实 ReadableStream 会 reject，但半死连接不一定）。
    const aborted = new Promise<never>((_, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (ctrl.signal.aborted) onAbort()
      else ctrl.signal.addEventListener('abort', onAbort, { once: true })
    })
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let sawDone = false
    const flush = () => {
      const { events, rest } = parseAgentSse(buf)
      buf = rest
      for (const e of events) {
        onEvent(e)
        // 收到 done 就立即收尾：服务端可能在 done 后保持 SSE 连接不关，
        // 若傻等 reader.done，界面会一直 busy，追问区永远出不来。
        if (e.t === 'done') sawDone = true
      }
    }
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (value) {
        if (!firstByteSeen) {
          firstByteSeen = true
          window.clearTimeout(firstByteTimer)
        }
        buf += decoder.decode(value, { stream: true })
        flush()
      }
      if (done || sawDone) break
    }
    if (!sawDone) {
      buf += decoder.decode()
      flush()
    }
    // 主动取消尚未关闭的流，释放连接（流已结束时 cancel 也安全）。
    if (sawDone && !reader.cancel) { /* 老环境无 cancel，忽略 */ }
    else if (sawDone) void reader.cancel().catch(() => {})
  } catch (e: any) {
    // 超时导致的 abort：转成明确错误（AgentPage 会显示）；外部「停止」
    // 仍是原 AbortError（调用方静默处理），两者不混淆。
    if (timedOut) throw new Error(`Agent ${timedOut}，已自动停止`)
    throw e
  } finally {
    window.clearTimeout(firstByteTimer)
    window.clearTimeout(totalTimer)
    if (signal) signal.removeEventListener('abort', relayAbort)
  }
}
