// src/web/agent.test.ts —— lume agent：SSE 解析、会话持久化、超时保护与聊天页
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import React from 'react'
import { jsonResponse, installFetch } from './test-utils'
import { AgentPage } from './app'
import {
  parseAgentSse, newSessionId, agentChat, loadSessionId, saveSessionId, SESSION_KEY,
  listHistories, loadHistory, saveHistory, deleteHistory, HISTORY_KEY,
} from './agent'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---------- lume agent：SSE 解析与聊天页 ----------

describe('agentChat 超时保护', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stalledFetch() {
    // 服务端连上但永不发数据：read() 返回悬挂 Promise，模拟半死连接。
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: vi.fn() }) },
    })))
  }

  it('首字节超时：无数据到达时自动中断并抛明确错误', async () => {
    stalledFetch()
    await expect(agentChat('q', 'sess-x', undefined, () => {}, undefined,
      { firstByteMs: 20, totalMs: 500 }))
      .rejects.toThrow(/首字节超时.*已自动停止/)
  })

  it('整体超时：收到首字节后一直不发 done，到时限自动中断', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => ({
        // 第一块给 delta（撤掉首字节计时器），之后永久悬挂。
        read: () => (n++ === 0
          ? Promise.resolve({ done: false, value: new TextEncoder().encode('data: {"t":"delta","d":"x"}\n\n') })
          : new Promise(() => {})),
        cancel: vi.fn(),
      }) },
    })))
    await expect(agentChat('q', 'sess-x', undefined, () => {}, undefined,
      { firstByteMs: 200, totalMs: 40 }))
      .rejects.toThrow(/响应超时.*已自动停止/)
  })

  it('外部 abort（用户点停止）保持 AbortError，不误报成超时', async () => {
    stalledFetch()
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(agentChat('q', 'sess-x', ctrl.signal, () => {}, undefined,
      { firstByteMs: 300, totalMs: 500 }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('parseAgentSse', () => {
  it('解析 delta/note/done 信封，忽略注释心跳与非 data 行', () => {
    const r = parseAgentSse(
      'data: {"t":"delta","d":"你"}\n\n:\n\ndata: {"t":"note","d":"调用工具"}\n\nevent: ping\ndata: {"t":"done"}\n\n',
    )
    expect(r.events).toEqual([
      { t: 'delta', d: '你' },
      { t: 'note', d: '调用工具' },
      { t: 'done' },
    ])
    expect(r.rest).toBe('')
  })

  it('半包保留在 rest，拼接后完整解析；噪声/坏 JSON 不抛异常', () => {
    const a = parseAgentSse('data: {"t":"del')
    expect(a.events).toEqual([])
    const b = parseAgentSse(a.rest + 'ta","d":"hi"}\n\ndata: junk\n\ndata: [not json]\n\n')
    expect(b.events).toEqual([{ t: 'delta', d: 'hi' }])
  })

  it('未知事件类型与缺失 d 字段被丢弃，\\r\\n 兼容', () => {
    const r = parseAgentSse('data: {"t":"weird"}\r\n\r\ndata: {"t":"delta"}\r\n\r\ndata: {"t":"error","d":"boom"}\r\n\r\n')
    expect(r.events).toEqual([{ t: 'error', d: 'boom' }])
  })

  it('newSessionId 生成 sess- 前缀且只含服务端允许的字符', () => {
    const id = newSessionId()
    expect(id.startsWith('sess-')).toBe(true)
    expect(/^[A-Za-z0-9\-_+]+$/.test(id)).toBe(true)
  })

  it('会话 ID 持久化：刷新后复用、新会话覆盖、脏值回退生成新 ID', () => {
    const a = loadSessionId()
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(a)
    // 模拟页面刷新：再次读取仍是同一个
    expect(loadSessionId()).toBe(a)
    const b = newSessionId()
    saveSessionId(b)
    expect(loadSessionId()).toBe(b)
    sessionStorage.setItem(SESSION_KEY, '脏值!@#')
    const c = loadSessionId()
    expect(c).not.toBe('脏值!@#')
    expect(c.startsWith('sess-')).toBe(true)
  })
})

describe('会话历史存档', () => {
  it('保存后可读回、按更新排序，标题取首条用户提问', () => {
    const a = 'sess-aaa', b = 'sess-bbb'
    saveHistory(a, [
      { role: 'user', text: '第一条问题' },
      { role: 'agent', text: '回答' },
    ])
    saveHistory(b, [{ role: 'user', text: '第二条问题' }])
    const all = listHistories()
    expect(all.length).toBe(2)
    // 最近保存的排前面
    expect(all[0].id).toBe(b)
    expect(all[0].title).toBe('第二条问题')
    expect(all[1].title).toBe('第一条问题')
    expect(loadHistory(a)?.messages[1].text).toBe('回答')
  })

  it('同 id 覆盖而非重复，删除只移除目标', () => {
    const a = 'sess-aaa', b = 'sess-bbb'
    saveHistory(a, [{ role: 'user', text: 'v1' }])
    saveHistory(a, [{ role: 'user', text: 'v2' }])
    expect(listHistories().length).toBe(1)
    expect(loadHistory(a)?.title).toBe('v2')
    saveHistory(b, [{ role: 'user', text: 'b' }])
    deleteHistory(a)
    expect(loadHistory(a)).toBeNull()
    expect(loadHistory(b)?.title).toBe('b')
  })

  it('脏数据整条跳过，不污染列表', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([
      { id: 'sess-ok', title: '好', messages: [{ role: 'user', text: 'q' }], updated: 1 },
      { id: 'bad id', title: '坏', messages: [], updated: 2 },
      { id: 'sess-bad-msg', title: '坏消息', messages: [{ role: 'user', text: 123 }], updated: 3 },
    ]))
    const all = listHistories()
    expect(all.length).toBe(1)
    expect(all[0].id).toBe('sess-ok')
  })

  it('超过 20 条上限时丢弃最旧的', () => {
    for (let i = 0; i < 25; i++) {
      saveHistory(`sess-${i}`, [{ role: 'user', text: `q${i}` }])
      // 让每条 updated 递增，确保排序可预测
      const arr = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
      arr[0].updated = i
      localStorage.setItem(HISTORY_KEY, JSON.stringify(arr))
    }
    const all = listHistories()
    expect(all.length).toBe(20)
    expect(all[0].title).toBe('q24')
    expect(all.some((r) => r.title === 'q0')).toBe(false)
  })
})

describe('AgentPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function sseReader(chunks: string[]) {
    let i = 0
    return {
      read: async () =>
        i < chunks.length
          ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
          : { done: true, value: undefined },
    }
  }

  it('发送消息并流式渲染回复；请求体携带 message + sessionId（默认不发 model）', async () => {
    const bodies: any[] = []
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [] })
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        'data: {"t":"note","d":"round 1"}\n\n',
        'data: {"t":"delta","d":"你好"}\n\n',
        'data: {"t":"delta","d":"，我是 agent"}\n\n',
        'data: {"t":"done"}\n\n',
      ]) } }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AgentPage />)
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: '在吗' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('你好，我是 agent')).toBeTruthy()
    expect(screen.getByText('你')).toBeTruthy()
    expect(bodies[0].message).toBe('在吗')
    expect(bodies[0].sessionId).toMatch(/^sess-[0-9a-f]{16}$/)
    expect(bodies[0].model).toBeUndefined()
    // 流结束后状态行清空、发送按钮恢复
    expect(screen.getByText('发送')).toBeTruthy()
  })

  it('点击示例问题直接发送，发送后示例区消失', async () => {
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [] })
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        'data: {"t":"delta","d":"有 15 个 key"}\n\n',
        'data: {"t":"done"}\n\n',
      ]) } }
    }))
    render(<AgentPage />)
    fireEvent.click(screen.getByRole('button', { name: '示例问题：现在有多少个 key？' }))
    expect(await screen.findByText('有 15 个 key')).toBeTruthy()
    expect(bodies[0].message).toBe('现在有多少个 key？')
    expect(screen.queryByText('试试问：')).toBeNull()
  })

  it('回答完成后出现新一组追问示例，点击即发；失败不出', async () => {
    const bodies: any[] = []
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [] })
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        'data: {"t":"delta","d":"好的"}\n\n',
        'data: {"t":"done"}\n\n',
      ]) } }
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<AgentPage />)
    expect(screen.queryByText('还可以问：')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: 'hi' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('好的')).toBeTruthy()
    // 追问示例出现，且与首屏引导不是同一批
    expect(screen.getByText('还可以问：')).toBeTruthy()
    expect(screen.getByRole('button', { name: '示例问题：哪个 provider 错误率最高？' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '示例问题：现在有多少个 key？' })).toBeNull()
    // 点追问 → 按该文本再发一轮
    fireEvent.click(screen.getByRole('button', { name: '示例问题：哪个 provider 错误率最高？' }))
    expect(await screen.findByText('好的')).toBeTruthy()
    expect(bodies[1].message).toBe('哪个 provider 错误率最高？')
  })

  it('模型下拉来自 tsm-hub 路由表，选中后请求体携带 model', async () => {
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [
        { model: '', strategy: 'failover', targets: [] }, // 默认路由不列出
        { model: 'agnes-2.0-flash', strategy: 'failover', targets: [] },
        { model: 'smart', strategy: 'failover', targets: [] },
      ] })
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        'data: {"t":"delta","d":"ok"}\n\n',
        'data: {"t":"done"}\n\n',
      ]) } }
    }))
    render(<AgentPage />)
    await screen.findByRole('option', { name: 'agnes-2.0-flash' })
    // 空 model 的默认路由不列出；其余按名字排序。只看「模型」下拉，
    // 不要被新增的「历史会话」下拉里的 option 干扰。
    const modelSelect = screen.getByLabelText('模型')
    expect(Array.from(modelSelect.querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'auto（tsm-hub 默认路由）', 'agnes-2.0-flash', 'smart',
    ])
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'agnes-2.0-flash' } })
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: '你好' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('ok')).toBeTruthy()
    expect(bodies[0]).toEqual({ message: '你好', sessionId: expect.stringMatching(/^sess-/), model: 'agnes-2.0-flash' })
  })

  it('HTTP 失败显示错误提示，空占位气泡被移除', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).startsWith('/api/routes')
        ? jsonResponse({ routes: [] })
        : { ok: false, status: 403, text: async () => 'Forbidden' }))
    render(<AgentPage />)
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: 'hi' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText(/Agent 端点不可用/)).toBeTruthy()
    expect(screen.queryByText('…')).toBeNull()
  })

  it('服务端 done 后不关闭流也能收尾：追问区出现在滚动区外，按钮恢复发送', async () => {
    let readCount = 0
    const cancel = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/routes')
      ? jsonResponse({ routes: [] })
      : { ok: true, status: 200, body: { getReader: () => ({
          read: async () => {
            if (readCount++ === 0) {
              return { done: false, value: new TextEncoder().encode(
                'data: {"t":"delta","d":"回答完毕"}\n\ndata: {"t":"done"}\n\n',
              ) }
            }
            return new Promise(() => {}) // 服务端保持连接不关，傻等会卡住 busy
          },
          cancel,
        }) } }))
    const { container } = render(<AgentPage />)
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: 'q' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答完毕')).toBeTruthy()
    // 追问区出现，且不在限高可滚动的 chat-log 内部（长回答时不会被裁掉）
    expect(screen.getByText('还可以问：')).toBeTruthy()
    expect(container.querySelector('.chat-log .chat-suggests.followup')).toBeNull()
    expect(container.querySelector('.chat-input + .chat-suggests.followup, .chat-suggests.followup')).toBeTruthy()
    // 发送按钮恢复（而非一直显示「停止」）
    expect(screen.getByText('发送')).toBeTruthy()
    expect(cancel).toHaveBeenCalled()
  })

  it('新会话清空消息并更换 sessionId，且覆盖持久化的会话', async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).startsWith('/api/routes')
      ? jsonResponse({ routes: [] })
      : { ok: true, status: 200, body: { getReader: () => sseReader([
          'data: {"t":"delta","d":"ok"}\n\n',
          'data: {"t":"done"}\n\n',
        ]) } })
    vi.stubGlobal('fetch', fetchMock)
    render(<AgentPage />)
    // 等路由表加载完（useLoad 的异步 setState），否则断言后 resolve 会触发 act 警告
    await screen.findByRole('option', { name: 'auto（tsm-hub 默认路由）' })
    const firstSid = screen.getByText(/会话 sess-/).textContent
    expect(sessionStorage.getItem(SESSION_KEY)).toBeTruthy()
    fireEvent.click(screen.getByText('新会话'))
    expect(screen.getByText(/开始与 Agent 对话/)).toBeTruthy()
    const nextSid = screen.getByText(/会话 sess-/).textContent
    expect(nextSid).not.toBe(firstSid)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeTruthy()
    expect(loadSessionId()).toBeTruthy()
  })

  it('回答可复制 Markdown 原文，复制后短暂显示“已复制”', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/routes')
        ? jsonResponse({ routes: [] })
        : { ok: true, status: 200, body: { getReader: () => sseReader([
            'data: {"t":"delta","d":"**粗体**\\n\\n- 甲\\n- 乙"}\n\n',
            'data: {"t":"done"}\n\n',
          ]) } }))
      render(<AgentPage />)
      fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: 'q' } })
      fireEvent.click(screen.getByText('发送'))
      expect(await screen.findByText('粗体')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '复制第 2 条回答' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('**粗体**\n\n- 甲\n- 乙'))
      expect(screen.getByText('已复制')).toBeTruthy()
      // 复制的是原文，不是渲染后的 DOM：strong 标签仍在，未被替换。
      expect(screen.getByText('粗体').tagName).toBe('STRONG')
    } finally {
      delete (navigator as any).clipboard
    }
  })

  it('重试：重发该轮提问、替换回答，不新增消息且不换会话；重试中间轮次会丢弃后续对话', async () => {
    const bodies: any[] = []
    let round = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [] })
      bodies.push(JSON.parse(init.body))
      round++
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        `data: {"t":"delta","d":"回答${round}"}\n\n`,
        'data: {"t":"done"}\n\n',
      ]) } }
    }))
    const { container } = render(<AgentPage />)
    const input = screen.getByPlaceholderText(/向 Agent 提问/)
    fireEvent.change(input, { target: { value: 'q1' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答1')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'q2' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答2')).toBeTruthy()
    expect(container.querySelectorAll('.chat-msg').length).toBe(4)

    // 重试第一条回答（下标 1）：q2 及其回答被丢弃，只保留 q1 + 新回答。
    fireEvent.click(screen.getByRole('button', { name: '重试第 2 条回答' }))
    expect(await screen.findByText('回答3')).toBeTruthy()
    expect(screen.queryByText('回答1')).toBeNull()
    expect(screen.queryByText('回答2')).toBeNull()
    expect(screen.queryByText('q2')).toBeNull()
    expect(container.querySelectorAll('.chat-msg').length).toBe(2)
    expect(bodies[2]).toEqual({ message: 'q1', sessionId: bodies[0].sessionId })
  })

  it('换上下文重试：换新 sessionId 重发该轮提问，会话显示与持久化都更新', async () => {
    const bodies: any[] = []
    let round = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/routes')) return jsonResponse({ routes: [] })
      bodies.push(JSON.parse(init.body))
      round++
      return { ok: true, status: 200, body: { getReader: () => sseReader([
        `data: {"t":"delta","d":"回答${round}"}\n\n`,
        'data: {"t":"done"}\n\n',
      ]) } }
    }))
    render(<AgentPage />)
    const input = screen.getByPlaceholderText(/向 Agent 提问/)
    fireEvent.change(input, { target: { value: 'q1' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答1')).toBeTruthy()
    const firstSid = bodies[0].sessionId
    expect(screen.getByText(/会话 sess-/).textContent).toContain(firstSid)

    fireEvent.click(screen.getByRole('button', { name: '换上下文重试第 2 条回答' }))
    expect(await screen.findByText('回答2')).toBeTruthy()
    // 关键：请求体必须用新 sessionId（不是旧的），否则换上下文失效。
    expect(bodies[1]).toEqual({ message: 'q1', sessionId: expect.not.stringMatching(firstSid) })
    expect(bodies[1].sessionId).not.toBe(firstSid)
    // 页面显示的会话 id 与持久化值同步为新 id。
    expect(screen.getByText(/会话 sess-/).textContent).toContain(bodies[1].sessionId)
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(bodies[1].sessionId)
    // 前序对话仍在（只是不再进入服务端记忆）。历史下拉 option 也含 q1，
    // 所以限定在聊天气泡里查。
    expect(Array.from(document.querySelectorAll('.chat-msg.user')).some((el) => (el.textContent || '').includes('q1'))).toBe(true)
  })

  it('流式输出期间复制/重试按钮禁用，避免复制到半截回答', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((res) => { release = res })
    let readCount = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/routes')
      ? jsonResponse({ routes: [] })
      : { ok: true, status: 200, body: { getReader: () => ({
          read: async () => {
            if (readCount++ === 0) {
              return { done: false, value: new TextEncoder().encode('data: {"t":"delta","d":"hi"}\n\n') }
            }
            await gate // 第一次 delta 后挂起，模拟长回答尚未结束
            return { done: true, value: undefined }
          },
        }) } }))
    render(<AgentPage />)
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: 'q' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('hi')).toBeTruthy()
    expect((screen.getByRole('button', { name: '复制第 2 条回答' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '重试第 2 条回答' }) as HTMLButtonElement).disabled).toBe(true)
    release?.()
    await waitFor(() => expect(screen.getByText('发送')).toBeTruthy())
  })

  it('一轮对话结束后自动存档；切换会话载入对应记录', async () => {
    const stub = () => vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).startsWith('/api/routes')
        ? jsonResponse({ routes: [] })
        : { ok: true, status: 200, body: { getReader: () => sseReader([
            'data: {"t":"delta","d":"回答甲"}\n\n',
            'data: {"t":"done"}\n\n',
          ]) } }))

    stub()
    const { unmount } = render(<AgentPage />)
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: '问题甲' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答甲')).toBeTruthy()
    await waitFor(() => expect(listHistories().length).toBe(1))
    const sid1 = sessionStorage.getItem(SESSION_KEY)

    // 新会话：发第二个问题，产生第二条存档
    fireEvent.click(screen.getByText('新会话'))
    fireEvent.change(screen.getByPlaceholderText(/向 Agent 提问/), { target: { value: '问题乙' } })
    fireEvent.click(screen.getByText('发送'))
    expect(await screen.findByText('回答甲')).toBeTruthy() // stub 的回答相同，只看流程
    await waitFor(() => expect(listHistories().length).toBe(2))
    const sid2 = sessionStorage.getItem(SESSION_KEY)
    expect(sid2).not.toBe(sid1)

    // 切回第一条：消息与会话 id 都还原
    const historySelect = screen.getByLabelText('历史会话') as HTMLSelectElement
    fireEvent.change(historySelect, { target: { value: sid1 as string } })
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(sid1)
    expect(Array.from(document.querySelectorAll('.chat-msg.user')).some((el) => (el.textContent || '').includes('问题甲'))).toBe(true)
    unmount()
  })

  it('重新挂载（模拟刷新）从存档恢复当前会话的对话', async () => {
    // 先造一条存档并把它的 id 设为当前会话
    const sid = 'sess-restore-1'
    saveHistory(sid, [
      { role: 'user', text: '刷新前的问题' },
      { role: 'agent', text: '刷新前的回答' },
    ])
    saveSessionId(sid)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).startsWith('/api/routes')
      ? jsonResponse({ routes: [] })
      : jsonResponse({ ok: true })))

    const { container } = render(<AgentPage />)
    // 等 useLoad 的路由请求 resolve，避免异步 state 更新落在断言之后（act 警告）
    await act(async () => {})
    const log = container.querySelector('.chat-log') as HTMLElement
    expect(log.textContent).toContain('刷新前的问题')
    expect(log.textContent).toContain('刷新前的回答')
    expect(screen.getByText(/会话 sess-restore-1/)).toBeTruthy()
  })
})
