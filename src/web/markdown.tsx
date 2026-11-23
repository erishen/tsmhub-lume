// src/web/markdown.tsx — 轻量 Markdown 渲染（零新依赖）。
// 只覆盖 agent 回答常见语法：标题/粗体/斜体/行内代码/代码块/列表/表格/引用/段落。
// 全部用 React 元素渲染（不用 dangerouslySetInnerHTML），链接协议白名单，避免 XSS。
import { Fragment, type ReactNode } from 'react'

// 链接 URL 允许一层嵌套括号（如 https://x.com/a_(b)），其余 token 保持简单。
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)|\*[^*]+\*)/g

function safeHref(raw: string): string | null {
  const s = raw.trim()
  if (/^(https?:|mailto:)/i.test(s)) return s
  // 站内相对路径放行；协议相对 URL（//host、/\host）会被浏览器解析成外链，
  // 不让 LLM 输出借它绕过白名单跳到任意主机。
  if (s.startsWith('#') || /^\/(?![\/\\])/.test(s)) return s
  return null
}

// keyPrefix：同一父节点里可能拼多行的 inline 结果（段落用 <br> 连接），
// 每行的 token index 都从 0 开始，不前缀会撞 key。
function inline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyPrefix}${m.index}`
    if (tok.startsWith('**') && tok.endsWith('**')) {
      out.push(<strong key={k}>{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('`') && tok.endsWith('`')) {
      out.push(<code key={k}>{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)$/.exec(tok)
      if (link) {
        const href = safeHref(link[2])
        out.push(href
          ? <a key={k} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
          : <Fragment key={k}>{link[1]}</Fragment>)
      } else {
        out.push(tok)
      }
    } else if (tok.startsWith('*') && tok.endsWith('*')) {
      out.push(<em key={k}>{tok.slice(1, -1)}</em>)
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

// ---- 列表：按缩进建树，避免「1. 顶层 / - 缩进子项 / 1. 顶层」被拆成多个单元素 <ol> ----
// LLM 输出的有序列表常把每项都写成 "1."，靠 <ol> 自动编号才是 1/2/3；
// 而每项下挂缩进的无序子列表会让朴素的行扫描提前 break，导致每项都从 1 开始。
interface ListNode {
  kind: 'ol' | 'ul'
  text: string
  children: ListNode[]
}

function listLine(line: string): { indent: number; kind: 'ol' | 'ul'; text: string } | null {
  const m = /^(\s*)(?:[-*+]|(\d+[.)]))\s+(.*)$/.exec(line)
  if (!m) return null
  return {
    indent: m[1].replace(/\t/g, '  ').length,
    kind: m[2] ? 'ol' : 'ul',
    text: m[3],
  }
}

/** 从 lines[start] 起收集一段列表，返回扁平的顶层节点树与结束下标。 */
function readList(lines: string[], start: number): { nodes: ListNode[]; next: number } {
  const roots: ListNode[] = []
  const stack: ListNode[] = []       // 路径：每层最近加入的节点
  const indents: number[] = []       // 与 stack 对应的缩进宽度
  let i = start
  while (i < lines.length) {
    const cur = listLine(lines[i])
    if (!cur) {
      // 项间空行：若后面还有列表项（任意层级）则跳过继续，否则本段结束。
      if (!lines[i].trim()) {
        let j = i
        while (j < lines.length && !lines[j].trim()) j++
        if (j < lines.length && listLine(lines[j])) { i = j; continue }
      }
      break
    }
    while (indents.length && indents[indents.length - 1] >= cur.indent) {
      indents.pop()
      stack.pop()
    }
    const node: ListNode = { kind: cur.kind, text: cur.text, children: [] }
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
    indents.push(cur.indent)
    i++
  }
  return { nodes: roots, next: i }
}

/** 连续同类型的兄弟节点合并进同一个 <ol>/<ul>，不同类型断开成新列表。 */
function renderNodes(nodes: ListNode[], prefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let group: ListNode[] = []
  let kind: 'ol' | 'ul' | null = null
  let seq = 0 // 同一节点下 ol/ul 交替会多次 flush，key 必须每次不同
  const flush = () => {
    if (!group.length || !kind) return
    const items = group
    const Tag = kind
    out.push(
      <Tag key={`${prefix}-l${seq++}`}>
        {items.map((n, idx) => (
          <li key={idx}>
            {inline(n.text)}
            {n.children.length ? renderNodes(n.children, `${prefix}-${idx}`) : null}
          </li>
        ))}
      </Tag>,
    )
    group = []
    kind = null
  }
  for (const n of nodes) {
    if (kind !== n.kind) flush()
    group.push(n)
    kind = n.kind
  }
  flush()
  return out
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

    // 列表（无序 / 有序，支持缩进子列表与项间空行）。
    if (listLine(line)) {
      const { nodes, next } = readList(lines, i)
      out.push(...renderNodes(nodes, `list${key}`))
      i = next
      key++
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
    out.push(<p key={key++}>{para.flatMap((s, n) => (n
      ? [<br key={`b${n}`} />, ...inline(s, `l${n}-`)]
      : inline(s, 'l0-')))}</p>)
  }
  return <>{out}</>
}
