// src/web/app.test.tsx —— 核心纯函数与关键组件的单元测试
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { jsonResponse, baseOf, installFetch } from './test-utils'
import {
  g,
  arr,
  num,
  fmtNum,
  fmtCost,
  fmtTime,
  splitList,
  statusClass,
  routeFromPath,
  readRole,
  writeRole,
  Badge,
  Stat,
  Table,
  Panel,
  ErrorBoundary,
  OverviewPage,
  ProvidersPage,
  RoutesPage,
  KeysPage,
  BalancesPage,
  ModelsPage,
  RecommendationsPage,
  SettingsPage,
  MemoryPage,
} from './app'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
})
afterEach(cleanup)

// ---------- 取值工具 ----------

describe('g / arr / num', () => {
  it('g 取嵌套键、缺失返回默认值、null 安全', () => {
    expect(g({ a: { b: 1 } }, 'a')).toEqual({ b: 1 })
    expect(g({ a: 1 }, 'missing', 'dft')).toBe('dft')
    expect(g(null, 'a', 'dft')).toBe('dft')
    expect(g(undefined, 'a', 0)).toBe(0)
    expect(g('str', 'length')).toBe(undefined)
  })

  it('arr 从多个候选键里取第一个数组，兜底空数组', () => {
    expect(arr({ x: [1, 2] }, 'x', 'y')).toEqual([1, 2])
    expect(arr({ y: [3] }, 'x', 'y')).toEqual([3])
    expect(arr({ a: 'not-array' }, 'a')).toEqual([])
    expect(arr(null, 'a')).toEqual([])
  })

  it('num 兼容数字与数字字符串，非法回退', () => {
    expect(num(5)).toBe(5)
    expect(num('7')).toBe(7)
    expect(num('abc', 9)).toBe(9)
    expect(num(null, 3)).toBe(3)
    expect(num('', 4)).toBe(4)
  })
})

// ---------- 格式化 ----------

describe('格式化', () => {
  it('fmtNum 千分位，非法显示 —', () => {
    expect(fmtNum(1234567)).toBe('1,234,567')
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(undefined)).toBe('—')
    expect(fmtNum('not-a-number')).toBe('—')
  })

  it('fmtCost 4 位小数美元，非法显示 —', () => {
    expect(fmtCost(0.001175)).toBe('$0.0012')
    expect(fmtCost(13.977)).toBe('$13.9770')
    expect(fmtCost(undefined)).toBe('—')
  })

  it('fmtTime 解析 ISO 字符串，非法/远古显示 —', () => {
    expect(fmtTime('2026-11-21T10:00:00Z')).not.toBe('—')
    expect(fmtTime('')).toBe('—')
    expect(fmtTime('not-a-date')).toBe('—')
    expect(fmtTime('1970-01-01T00:00:00Z')).toBe('—')
  })

  it('splitList 按逗号/空白拆分并去空', () => {
    expect(splitList('a, b c')).toEqual(['a', 'b', 'c'])
    expect(splitList('')).toEqual([])
    expect(splitList('  ,  ')).toEqual([])
  })
})

// ---------- 状态样式 ----------

describe('statusClass', () => {
  it('健康/成功 → ok，运行/半开 → warn，失败/冷却 → err，其余 gray', () => {
    expect(statusClass('ok')).toBe('badge ok')
    expect(statusClass('healthy')).toBe('badge ok')
    expect(statusClass('running')).toBe('badge warn')
    expect(statusClass('cooling')).toBe('badge err')
    expect(statusClass('failed')).toBe('badge err')
    expect(statusClass('unknown')).toBe('badge gray')
    expect(statusClass(undefined)).toBe('badge gray')
  })
})

// ---------- 路由 / 角色 ----------

describe('routeFromPath / role persistence', () => {
  it('routeFromPath 识别合法路由，否则回退 overview', () => {
    expect(routeFromPath()).toBe('overview')
    window.history.replaceState({}, '', '/providers')
    expect(routeFromPath()).toBe('providers')
    window.history.replaceState({}, '', '/nope')
    expect(routeFromPath()).toBe('overview')
  })

  it('角色读写 localStorage，非法角色回退 agent_operator', () => {
    writeRole('human_admin')
    expect(readRole()).toBe('human_admin')
    writeRole('bogus')
    expect(readRole()).toBe('agent_operator')
    localStorage.setItem('tsmhub_lume_role', 'agent_reviewer_second')
    expect(readRole()).toBe('agent_reviewer_second')
  })
})

// ---------- 组件 ----------

describe('Badge / Stat / Table / Panel', () => {
  it('Badge 按状态渲染类名与标签', () => {
    const { container } = render(<Badge value="ok" />)
    expect(container.querySelector('.badge.ok')?.textContent).toBe('ok')
    cleanup()
    const { container: c2 } = render(<Badge value={undefined} label="启用" />)
    expect(c2.querySelector('.badge.gray')?.textContent).toBe('启用')
  })

  it('Stat 展示 label 与 value', () => {
    render(<Stat label="Keys" value="14" hint="2 条告警" />)
    expect(screen.getByText('Keys')).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('2 条告警')).toBeTruthy()
  })

  it('Table 空数据渲染 empty，有数据渲染行', () => {
    const cols = [
      { title: '名称', render: (r: any) => String(r.name) },
      { title: '值', render: (r: any) => String(r.value) },
    ]
    const { container: c1 } = render(<Table columns={cols} rows={[]} empty="暂无" />)
    expect(c1.querySelector('.empty')?.textContent).toBe('暂无')
    cleanup()
    const { container: c2 } = render(
      <Table columns={cols} rows={[{ name: 'a', value: 1 }, { name: 'b', value: 2 }]} />,
    )
    expect(c2.querySelectorAll('tbody tr').length).toBe(2)
  })

  it('Panel 渲染标题与内容', () => {
    render(<Panel title="用量统计"><p>内容</p></Panel>)
    expect(screen.getByText('用量统计')).toBeTruthy()
    expect(screen.getByText('内容')).toBeTruthy()
  })
})

// ---------- 错误边界 ----------

describe('ErrorBoundary', () => {
  // ErrorBoundary 测试故意抛错，React 会向 console.error 打印堆栈；静音以保持 CI 输出干净。
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
  })

  function Boom(): React.ReactNode {
    throw new Error('boom-msg')
  }
  it('捕获子组件渲染异常并显示可重试错误卡', () => {
    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(container.querySelector('.errorbox')).toBeTruthy()
    expect(container.textContent).toContain('boom-msg')
    // 重试按钮：点击后边界清空错误（这里子组件仍会抛，但不应崩溃）。
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn as HTMLButtonElement)
    expect(container.querySelector('.errorbox')).toBeTruthy()
  })

  it('无错误时透传子内容', () => {
    const { container } = render(
      <ErrorBoundary>
        <span>child</span>
      </ErrorBoundary>,
    )
    expect(container.textContent).toBe('child')
  })
})

// ---------- 页面级：总览 ----------

const overviewBody = {
  ok: true,
  upstream: 'http://tsm-hub:9070',
  providers: 15,
  healthy: 12,
  routes: 17,
  keys: 14,
  requests_total: 11952,
  today: { requests: 9, prompt_tokens: 58698, completion_tokens: 1103, total_tokens: 59801, cost_usd: 0, errors: 0, failovers: 3 },
  total: { requests: 11952, prompt_tokens: 103706945, completion_tokens: 4260842, total_tokens: 107970679, cost_usd: 13.977, errors: 2220, failovers: 761 },
  warnings: [],
  providers_health: [{ provider_id: 'agnes', healthy: true, failures: 1 }],
  recent_logs: [{ action: 'upsert', object: 'provider', object_id: 'agnes', operator: 'admin' }],
  errors: {},
}

describe('OverviewPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(overviewBody),
    })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('加载并渲染概览统计卡与上游健康', async () => {
    render(<OverviewPage />)
    // 初始 loading，随后数据渲染（useLoad 异步）。
    expect(fetchMock).toHaveBeenCalledWith('/api/overview', expect.anything())
    expect(await screen.findByText('15')).toBeTruthy() // providers
    expect(await screen.findByText('12 健康')).toBeTruthy() // healthy（stat hint）
    // '11,952' 出现两次：累计请求 stat + 累计用量 agg 的 requests。
    expect((await screen.findAllByText('11,952')).length).toBeGreaterThanOrEqual(1)
    expect(await screen.findByText('$13.9770')).toBeTruthy() // total cost
    expect(screen.getByText('Provider 健康')).toBeTruthy()
  })

  it('接口失败时显示可重试错误条', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ ok: false, error: '无法连接上游' }),
    })
    render(<OverviewPage />)
    expect(await screen.findByText(/请求失败/)).toBeTruthy()
    expect(screen.getByText(/无法连接上游/)).toBeTruthy()
  })
})

// ---------- 页面级：Providers / Routes（CRUD）----------

const providersBody = {
  ok: true,
  providers: [
    { id: 'p1', name: 'Primary', protocol: 'openai', models: ['smart'], weight: 1, priority: 1, enabled: true },
    { id: 'p2', name: 'Backup', protocol: 'anthropic', models: ['claude'], weight: 1, priority: 2, enabled: false },
  ],
}

const routesBody = {
  ok: true,
  routes: [
    { model: 'smart', strategy: 'failover', targets: [{ provider_id: 'p1', weight: 1, priority: 1 }], remark: 'main' },
  ],
}

describe('ProvidersPage', () => {
  let confirmSpy: MockInstance<typeof window.confirm>
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    confirmSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('加载并渲染 Provider 列表', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/providers' ? jsonResponse(providersBody) : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<ProvidersPage role="agent_operator" />)
    expect(await screen.findByText('Primary')).toBeTruthy()
    expect(screen.getByText('Backup')).toBeTruthy()
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.getByText('anthropic')).toBeTruthy()
    expect(screen.getByText('上游 Providers (2)')).toBeTruthy()
  })

  it('新增 Provider：POST /api/providers?role=…，表单关闭并重载', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url) === '/api/providers' && init?.method === 'POST') return jsonResponse({ ok: true, created: 'p3' })
      return jsonResponse(providersBody)
    })
    const { container } = render(<ProvidersPage role="agent_operator" />)
    await screen.findByText('Primary')
    fireEvent.click(screen.getByText('+ 新增'))
    fireEvent.change(screen.getByPlaceholderText('my-provider'), { target: { value: 'Tertiary' } })
    fireEvent.change(screen.getByPlaceholderText('https://api.example.com/v1'), { target: { value: 'https://x/v1' } })
    fireEvent.change(screen.getByPlaceholderText('smart, cheap'), { target: { value: 'smart, cheap' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await screen.findByText('操作成功')
    const post = calls.find((c) => c.method === 'POST' && baseOf(c.url) === '/api/providers')
    expect(post?.url).toBe('/api/providers?role=agent_operator')
    expect(post?.body).toMatchObject({ name: 'Tertiary', base_url: 'https://x/v1', models: ['smart', 'cheap'], weight: 1, priority: 1 })
  })

  it('删除 Provider：confirm 后 DELETE /api/providers/p1?role=…', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url).startsWith('/api/providers/') && init?.method === 'DELETE') return jsonResponse({ ok: true })
      return jsonResponse(providersBody)
    })
    render(<ProvidersPage role="agent_operator" />)
    await screen.findByText('Primary')
    fireEvent.click(screen.getAllByText('删除')[0])
    await screen.findByText('操作成功')
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toBe('/api/providers/p1?role=agent_operator')
    expect(confirmSpy).toHaveBeenCalled()
  })
})

describe('RoutesPage', () => {
  let confirmSpy: MockInstance<typeof window.confirm>
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    confirmSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('加载并渲染路由表', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/routes' ? jsonResponse(routesBody) : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<RoutesPage role="agent_operator" />)
    expect(await screen.findByText('smart')).toBeTruthy()
    expect(screen.getByText('failover')).toBeTruthy()
    expect(screen.getByText('路由表 (1)')).toBeTruthy()
  })

  it('新增路由：POST /api/routes?role=… 携带 targets 数组', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url) === '/api/routes' && init?.method === 'POST') return jsonResponse({ ok: true, created: 'r2' })
      return jsonResponse(routesBody)
    })
    const { container } = render(<RoutesPage role="agent_operator" />)
    await screen.findByText('smart')
    fireEvent.click(screen.getByText('+ 新增'))
    fireEvent.change(screen.getByPlaceholderText('smart'), { target: { value: 'cheap' } })
    fireEvent.change(screen.getByPlaceholderText('p1, p2'), { target: { value: 'p1, p2' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await screen.findByText('操作成功')
    const post = calls.find((c) => c.method === 'POST' && baseOf(c.url) === '/api/routes')
    expect(post?.url).toBe('/api/routes?role=agent_operator')
    expect(post?.body).toMatchObject({
      model: 'cheap',
      strategy: 'failover',
      targets: [
        { provider_id: 'p1', weight: 1, priority: 1 },
        { provider_id: 'p2', weight: 1, priority: 2 },
      ],
    })
  })

  it('删除路由：confirm 后 DELETE /api/routes/smart?role=…', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url).startsWith('/api/routes/') && init?.method === 'DELETE') return jsonResponse({ ok: true })
      return jsonResponse(routesBody)
    })
    render(<RoutesPage role="agent_operator" />)
    await screen.findByText('smart')
    fireEvent.click(screen.getAllByText('删除')[0])
    await screen.findByText('操作成功')
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toBe('/api/routes/smart?role=agent_operator')
    expect(confirmSpy).toHaveBeenCalled()
  })
})

const keysBody = {
  ok: true,
  keys: [
    { id: 'k1', name: 'Main', prefix: 'sk-tr-abc', enabled: true, quota: { max_tokens: 1000, max_cost_usd: 5, daily_tokens: 100, rpm: 60 }, created_at: '2026-11-01T00:00:00Z' },
  ],
}

describe('KeysPage', () => {
  let confirmSpy: MockInstance<typeof window.confirm>
  beforeEach(() => {
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => {
    confirmSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('加载并渲染 Key 列表', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/keys' ? jsonResponse(keysBody) : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<KeysPage role="agent_operator" />)
    expect(await screen.findByText('Main')).toBeTruthy()
    expect(screen.getByText('sk-tr-abc')).toBeTruthy()
    expect(screen.getByText('启用')).toBeTruthy() // 状态 badge label
    expect(screen.getByText('自制 Keys (1)')).toBeTruthy()
  })

  it('新增 Key：POST /api/keys?role=…，quota 空值回退 0', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url) === '/api/keys' && init?.method === 'POST') return jsonResponse({ ok: true, created: 'k2' })
      return jsonResponse(keysBody)
    })
    const { container } = render(<KeysPage role="agent_operator" />)
    await screen.findByText('Main')
    fireEvent.click(screen.getByText('+ 签发'))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'K2' } })
    fireEvent.change(screen.getByLabelText(/可用模型/), { target: { value: 'alpha, beta' } })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    await screen.findByText('操作成功')
    const post = calls.find((c) => c.method === 'POST' && baseOf(c.url) === '/api/keys')
    expect(post?.url).toBe('/api/keys?role=agent_operator')
    expect(post?.body).toMatchObject({
      name: 'K2',
      models: ['alpha', 'beta'],
      quota: { max_tokens: 0, max_cost_usd: 0, daily_tokens: 0, rpm: 0 },
    })
  })

  it('切换 Key：POST /api/keys/k1/toggle?role=…', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url).includes('/toggle') && init?.method === 'POST') return jsonResponse({ ok: true })
      return jsonResponse(keysBody)
    })
    render(<KeysPage role="agent_operator" />)
    await screen.findByText('Main')
    fireEvent.click(screen.getByText('停用')) // 状态 badge 是「启用」，操作按钮是「停用」
    await screen.findByText('操作成功')
    const t = calls.find((c) => c.method === 'POST' && baseOf(c.url).includes('/toggle'))
    expect(t?.url).toBe('/api/keys/k1/toggle?role=agent_operator')
  })

  it('删除 Key：confirm 后 DELETE /api/keys/k1?role=…', async () => {
    const { calls } = installFetch((url, init) => {
      if (baseOf(url).startsWith('/api/keys/') && init?.method === 'DELETE') return jsonResponse({ ok: true })
      return jsonResponse(keysBody)
    })
    render(<KeysPage role="agent_operator" />)
    await screen.findByText('Main')
    fireEvent.click(screen.getAllByText('删除')[0])
    await screen.findByText('操作成功')
    const del = calls.find((c) => c.method === 'DELETE')
    expect(del?.url).toBe('/api/keys/k1?role=agent_operator')
    expect(confirmSpy).toHaveBeenCalled()
  })
})

// ---------- 页面级：新增页面加载渲染 ----------

describe('BalancesPage / ModelsPage / RecommendationsPage / SettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('BalancesPage 渲染 Provider 余额', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/balances'
        ? jsonResponse({ balances: [{ id: 'b1', name: 'Provider A', probe_at: '2026-11-01T00:00:00Z', balance: { usd: 100 }, error: '' }] })
        : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<BalancesPage />)
    expect(await screen.findByText('Provider A')).toBeTruthy()
    expect(screen.getByText('Provider 余额 (1)')).toBeTruthy()
  })

  it('ModelsPage 渲染模型目录', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/models'
        ? jsonResponse({ models: [{ id: 'm1', provider: 'p1', category: 'chat', purpose: '通用', free: true, in_route: true, route_score: 9 }] })
        : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<ModelsPage role="agent_operator" />)
    expect(await screen.findByText('m1')).toBeTruthy()
    expect(screen.getByText('FREE')).toBeTruthy()
    expect(screen.getByText('模型目录 (1)')).toBeTruthy()
  })

  it('RecommendationsPage 渲染推荐与统计', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/models/recommendations'
        ? jsonResponse({ scenarios: [{ id: 'r1', provider: 'p1', route_score: 9 }], total_models: 10, free_models: 2, scenario_num: 1 })
        : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<RecommendationsPage />)
    expect(await screen.findByText('r1')).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy() // total_models
    expect(screen.getByText('模型推荐')).toBeTruthy()
  })

  it('SettingsPage 渲染设置只读字段与表单', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/settings'
        ? jsonResponse({ listen: '127.0.0.1:9070', data_file: '/data/config.json', admin_token_set: true, default_timeout_ms: 30000 })
        : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<SettingsPage role="agent_operator" />)
    expect(await screen.findByText('运行设置')).toBeTruthy()
    expect(screen.getByText('data_file')).toBeTruthy()
    expect(screen.getByText('/data/config.json')).toBeTruthy()
  })

  it('MemoryPage 渲染会话记忆与清空按钮', async () => {
    installFetch((url) =>
      baseOf(url) === '/api/memory'
        ? jsonResponse({ entries: [{ key: 'k1', value: 'v1' }] })
        : jsonResponse({ ok: false, error: 'nf' }, 404),
    )
    render(<MemoryPage role="agent_operator" />)
    expect(await screen.findByText('会话记忆 (1)')).toBeTruthy()
    expect(screen.getByText('k1')).toBeTruthy()
    expect(screen.getByText('清空')).toBeTruthy()
  })
})

// 保留：防止 ts 未使用导入告警（vi 供未来异步测试用）。
void vi
