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

// 发送一条消息并消费 SSE 流，逐事件回调。抛错 = 网络 / HTTP 层失败；
// 调用方用 AbortController 实现「停止」（AbortError 由调用方静默处理）。
export async function agentChat(
  message: string,
  sessionId: string,
  signal: AbortSignal | undefined,
  onEvent: (e: AgentEvent) => void,
  model?: string,
): Promise<void> {
  // model 非空才下发：留空 = 服务端 LLM_MODEL（默认 auto，由 tsm-hub 路由表选模型）。
  // 名字来自 tsm-hub /api/routes 的路由 key；服务端另有 LLM_ALLOWED_MODELS 白名单兜底。
  const body: Record<string, string> = { message, sessionId }
  if (model) body.model = model
  const r = await fetch('/react/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
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
  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const flush = () => {
    const { events, rest } = parseAgentSse(buf)
    buf = rest
    events.forEach(onEvent)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      buf += decoder.decode(value, { stream: true })
      flush()
    }
    if (done) break
  }
  buf += decoder.decode()
  flush()
}
