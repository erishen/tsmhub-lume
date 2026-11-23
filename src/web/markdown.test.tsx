// src/web/markdown.test.tsx —— 轻量 Markdown 渲染器的单元测试
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { MarkdownText } from './markdown'

afterEach(cleanup)

describe('MarkdownText', () => {
  it('渲染粗体/行内代码/列表/代码块/表格，纯文本也能显示', () => {
    const md = [
      '# 标题',
      '这是 **粗体** 和 `code`，还有 [链接](https://example.com)。',
      '- 第一项',
      '- 第二项',
      '```json',
      '{"a": 1}',
      '```',
      '| 名字 | 值 |',
      '| --- | --- |',
      '| key | 15 |',
    ].join('\n')
    const { container } = render(<MarkdownText text={md} />)
    expect(screen.getByText('粗体').tagName).toBe('STRONG')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: '链接' }).getAttribute('href')).toBe('https://example.com')
    expect(container.querySelectorAll('li').length).toBe(2)
    expect(container.querySelector('pre code')?.textContent).toBe('{"a": 1}')
    expect(container.querySelector('table')).toBeTruthy()
    expect(screen.getByText('key').tagName).toBe('TD')
    expect(screen.getByText('标题')).toBeTruthy()
  })

  it('项间有空行的有序/无序列表合并为一个列表（不会每项都从 1 开始）', () => {
    const { container } = render(<MarkdownText text={'1. 第一项\n\n2. 第二项\n\n3. 第三项'} />)
    expect(container.querySelectorAll('ol').length).toBe(1)
    expect(container.querySelectorAll('li').length).toBe(3)
    const u = render(<MarkdownText text={'- 甲\n\n- 乙\n\n- 丙'} />)
    expect(u.container.querySelectorAll('ul').length).toBe(1)
    expect(u.container.querySelectorAll('li').length).toBe(3)
    // 空行后不是同类列表项 → 不应把后面的段落吞进列表
    const x = render(<MarkdownText text={'1. 第一项\n\n普通段落'} />)
    expect(x.container.querySelectorAll('ol').length).toBe(1)
    expect(x.container.querySelectorAll('li').length).toBe(1)
    expect(screen.getByText('普通段落')).toBeTruthy()
  })

  it('有序项下挂缩进无序子列表：仍是一个 <ol>，自动编号不都显示 1', () => {
    const md = [
      '根据当前 provider 健康状态数据，需要关注：',
      '',
      '1. alibailian',
      '   - 半开放状态（half_open : true）',
      '   - 问题：免费配额耗尽',
      '1. openrouter',
      '   - 半开放状态（half_open : true）',
      '1. sensenova',
      '   - 最近出现 JSON 格式错误',
      '',
      '其他 provider 虽然有错误记录，但 healthy 为 true。',
    ].join('\n')
    const { container } = render(<MarkdownText text={md} />)
    const ol = container.querySelector('ol')!
    expect(ol).toBeTruthy()
    // 顶层 3 个 <li> → 浏览器自动编号 1/2/3（源码里都是 "1." 也没关系）
    expect(ol.children.length).toBe(3)
    expect(Array.from(ol.children).map((li) => li.tagName)).toEqual(['LI', 'LI', 'LI'])
    // 缩进子项归入各自父 <li>，不再打断外层 <ol>
    expect(ol.querySelectorAll('ul').length).toBe(3)
    expect(ol.children[0].querySelectorAll('li').length).toBe(2)
    expect(ol.children[1].querySelectorAll('li').length).toBe(1)
    // 列表前后的普通段落独立渲染，不被吞进列表项
    expect(container.querySelectorAll('p').length).toBe(2)
    expect(screen.getByText(/根据当前 provider/)).toBeTruthy()
    expect(screen.getByText(/其他 provider/)).toBeTruthy()
  })

  it('拒绝 javascript: 链接（降级为纯文本，不生成 a 标签）', () => {
    const { container } = render(<MarkdownText text="[点我](javascript:alert(1))" />)
    expect(container.querySelector('a')).toBeNull()
    expect(screen.getByText('点我')).toBeTruthy()
  })

  it('拒绝协议相对外链 //host 与 /\\host，保留站内相对路径', () => {
    const { container } = render(<MarkdownText text={[
      '[外链](//evil.example)',
      '[反斜杠](/\\evil.example)',
      '[站内](/api/health)',
    ].join('\n')} />)
    const links = Array.from(container.querySelectorAll('a'))
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('href')).toBe('/api/health')
  })

  it('段落内多行的行内标记不产生重复 React key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(<MarkdownText text={'**a**\n**b**\n`c`'} />)
      expect(err.mock.calls.some((c) => String(c[0]).includes('same key'))).toBe(false)
    } finally {
      err.mockRestore()
    }
  })

  it('同一父项下 ol/ul 交替不产生重复 React key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { container } = render(<MarkdownText text={[
        '1. parent',
        '   - child a',
        '   1. child b',
        '   - child c',
      ].join('\n')} />)
      const li = container.querySelector('li')!
      // 子节点两种类型交替 → renderNodes 多次 flush，key 各自唯一
      expect(li.querySelectorAll(':scope > ul').length).toBe(2)
      expect(li.querySelectorAll(':scope > ol').length).toBe(1)
      expect(err.mock.calls.some((c) => String(c[0]).includes('unique "key"'))).toBe(false)
    } finally {
      err.mockRestore()
    }
  })
})
