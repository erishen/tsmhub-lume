// src/web/markdown.tsx — 轻量 Markdown 渲染（零新依赖）。
// 只覆盖 agent 回答常见语法：标题/粗体/斜体/行内代码/代码块/列表/表格/引用/段落。
// 全部用 React 元素渲染（不用 dangerouslySetInnerHTML），链接协议白名单，避免 XSS。
import { Fragment, type ReactNode } from 'react'

// 链接 URL 允许一层嵌套括号（如 https://x.com/a_(b)），其余 token 保持简单。
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)|\*[^*]+\*)/g

function safeHref(raw: string): string | null {
  const s = raw.trim()
  if (/^(https?:|mailto:)/i.test(s)) return s
  if (s.startsWith('#') || s.startsWith('/')) return s
  return null
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**') && tok.endsWith('**')) {
      out.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      out.push(<code key={m.index}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)$/.exec(tok)
      if (link) {
        const href = safeHref(link[2])
        out.push(href
          ? <a key={m.index} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
          : <Fragment key={m.index}>{link[1]}</Fragment>)
      } else {
        out.push(tok)
      }
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      out.push(<em key={m.index}>{tok.slice(1, -1)}</em>)
    } else {
      out.push(tok)
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function cells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

/** 把 Markdown 文本渲染成 React 节点；非 Markdown 的纯文本也能正常展示。 */
export function MarkdownText({ text }: { text: string }): ReactNode {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let i = 0
  let key = 0
  while (i < lines.length) {
    const line = lines[i]

    // 代码块：``` 或 ```lang，到下一个 ``` 或结尾（流式未闭合也能显示）。
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
      if (i < lines.length) i++
      out.push(<pre key={key++} data-lang={lang || undefined}><code>{buf.join('\n')}</code></pre>)
      continue
    }

    // 表格：表头 + 分隔行（|---| 或 |:---:|）。
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|/.test(lines[i + 1])) {
      const head = cells(line)
      const aligns = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]))
      out.push(
        <table key={key++}>
          <thead><tr>{head.map((h, c) => <th key={c} style={{ textAlign: aligns[c] || 'left' }}>{inline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, c) => <td key={c} style={{ textAlign: aligns[c] || 'left' }}>{inline(r[c] || '')}</td>)}</tr>)}</tbody>
        </table>,
      )
      continue
    }

    // 标题。
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      out.push(<div key={key++} className="md-heading">{inline(h[2])}</div>)
      i++
      continue
    }

    // 列表（无序 / 有序）。
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ul || ol) {
      const ordered = !!ol
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/
      const items: string[] = []
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (m) { items.push(m[1]); i++; continue }
        // 项间空行（LLM 常见的「松散列表」）：只要下一个非空行还是同类列表项，
        // 就并进同一个列表，否则会被拆成多个 <ol>，每项都从 1 开始。
        if (!lines[i].trim()) {
          let j = i
          while (j < lines.length && !lines[j].trim()) j++
          if (j < lines.length && re.test(lines[j])) { i = j; continue }
        }
        break
      }
      out.push(ordered
        ? <ol key={key++}>{items.map((it, n) => <li key={n}>{inline(it)}</li>)}</ol>
        : <ul key={key++}>{items.map((it, n) => <li key={n}>{inline(it)}</li>)}</ul>)
      continue
    }

    // 引用。
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(<blockquote key={key++}>{inline(buf.join(' '))}</blockquote>)
      continue
    }

    // 空行跳过；其余按段落收集，段内换行用 <br />。
    if (!line.trim()) { i++; continue }
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim()
      && !/^```/.test(lines[i].trim())
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !/^#{1,6}\s+/.test(lines[i])
      && !/^>\s?/.test(lines[i])
      && !(lines[i].trim().startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|/.test(lines[i + 1]))) {
      para.push(lines[i++])
    }
    out.push(<p key={key++}>{para.flatMap((s, n) => (n ? [<br key={`b${n}`} />, ...inline(s)] : inline(s)))}</p>)
  }
  return <>{out}</>
}
