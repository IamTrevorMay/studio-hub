import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  FileText,
  FileCode2,
  FileDown,
  Printer,
  ClipboardCopy,
} from 'lucide-react'

interface Props {
  editor: Editor | null
  title: string
}

// ── Helpers ──

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function sanitizeFilename(title: string): string {
  return (title || 'Untitled').replace(/[/\\?%*:|"<>]/g, '-')
}

// ── TipTap JSON → Markdown converter ──

function jsonToMarkdown(doc: Record<string, unknown>): string {
  const content = doc.content as Record<string, unknown>[] | undefined
  if (!content) return ''
  return content.map((node) => nodeToMd(node, 0)).join('\n')
}

function nodeToMd(node: Record<string, unknown>, depth: number): string {
  const type = node.type as string
  const attrs = (node.attrs ?? {}) as Record<string, unknown>
  const content = node.content as Record<string, unknown>[] | undefined

  switch (type) {
    case 'paragraph':
      return inlineContent(content) + '\n'

    case 'heading': {
      const level = (attrs.level as number) || 1
      const prefix = '#'.repeat(level)
      return `${prefix} ${inlineContent(content)}\n`
    }

    case 'bulletList':
      return (content ?? [])
        .map((child) => nodeToMd(child, depth))
        .join('') + '\n'

    case 'orderedList':
      return (content ?? [])
        .map((child, i) => nodeToMd({ ...child, _orderedIndex: i + 1 }, depth))
        .join('') + '\n'

    case 'listItem': {
      const idx = node._orderedIndex as number | undefined
      const prefix = idx ? `${idx}. ` : '- '
      const indent = '  '.repeat(depth)
      const lines = (content ?? []).map((child) => {
        if ((child.type as string) === 'bulletList' || (child.type as string) === 'orderedList') {
          return nodeToMd(child, depth + 1)
        }
        return inlineContent(child.content as Record<string, unknown>[] | undefined)
      })
      return `${indent}${prefix}${lines.join('\n' + indent + '  ')}\n`
    }

    case 'taskList':
      return (content ?? [])
        .map((child) => nodeToMd(child, depth))
        .join('') + '\n'

    case 'taskItem': {
      const checked = attrs.checked ? 'x' : ' '
      const indent = '  '.repeat(depth)
      const text = (content ?? []).map((c) => inlineContent(c.content as Record<string, unknown>[] | undefined)).join('')
      return `${indent}- [${checked}] ${text}\n`
    }

    case 'blockquote':
      return (content ?? [])
        .map((child) => '> ' + nodeToMd(child, depth).trimEnd())
        .join('\n') + '\n\n'

    case 'codeBlock': {
      const lang = (attrs.language as string) || ''
      const code = (content ?? []).map((c) => (c.text as string) || '').join('')
      return '```' + lang + '\n' + code + '\n```\n'
    }

    case 'horizontalRule':
      return '---\n'

    case 'image': {
      const alt = (attrs.alt as string) || ''
      const src = attrs.src as string
      return `![${alt}](${src})\n`
    }

    case 'table':
      return tableToMd(content ?? []) + '\n'

    default:
      if (content) {
        return content.map((child) => nodeToMd(child, depth)).join('')
      }
      return (node.text as string) || ''
  }
}

function tableToMd(rows: Record<string, unknown>[]): string {
  const parsed = rows.map((row) => {
    const cells = (row.content ?? []) as Record<string, unknown>[]
    return cells.map((cell) => {
      const inner = cell.content as Record<string, unknown>[] | undefined
      return (inner ?? []).map((p) => inlineContent(p.content as Record<string, unknown>[] | undefined)).join(' ')
    })
  })

  if (parsed.length === 0) return ''

  const lines: string[] = []
  lines.push('| ' + parsed[0].join(' | ') + ' |')
  lines.push('| ' + parsed[0].map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < parsed.length; i++) {
    lines.push('| ' + parsed[i].join(' | ') + ' |')
  }
  return lines.join('\n') + '\n'
}

function inlineContent(content: Record<string, unknown>[] | undefined): string {
  if (!content) return ''
  return content.map((node) => {
    const text = (node.text as string) || ''
    const marks = (node.marks ?? []) as Record<string, unknown>[]

    if (node.type === 'hardBreak') return '  \n'
    if (node.type !== 'text') return nodeToMd(node, 0)

    let result = text
    for (const mark of marks) {
      const markType = mark.type as string
      const markAttrs = (mark.attrs ?? {}) as Record<string, unknown>
      switch (markType) {
        case 'bold':
          result = `**${result}**`
          break
        case 'italic':
          result = `*${result}*`
          break
        case 'strike':
          result = `~~${result}~~`
          break
        case 'code':
          result = '`' + result + '`'
          break
        case 'link':
          result = `[${result}](${markAttrs.href as string})`
          break
      }
    }
    return result
  }).join('')
}

// ── Styled HTML template ──

function buildHtmlDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.15;
      color: #1f2937;
      max-width: 816px;
      margin: 40px auto;
      padding: 0 24px;
    }
    h1 { font-size: 24px; font-weight: 700; margin: 24px 0 8px; }
    h2 { font-size: 20px; font-weight: 600; margin: 20px 0 8px; }
    h3 { font-size: 18px; font-weight: 600; margin: 16px 0 4px; }
    p { margin: 4px 0; }
    ul, ol { padding-left: 24px; margin: 8px 0; }
    blockquote {
      border-left: 4px solid #d1d5db;
      padding-left: 16px;
      font-style: italic;
      color: #6b7280;
      margin: 16px 0;
    }
    code {
      background: #f3f4f6;
      color: #374151;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      font-family: monospace;
    }
    pre {
      background: #111827;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin: 16px 0;
    }
    pre code {
      background: transparent;
      padding: 0;
      color: inherit;
      font-size: 13px;
    }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
    a { color: #2563eb; text-decoration: underline; }
    img { max-width: 100%; height: auto; border-radius: 4px; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #d1d5db; padding: 8px 12px; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${bodyHtml}
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Component ──

export default function ExportMenu({ editor, title }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (!editor) return null

  const filename = sanitizeFilename(title)

  const exportTxt = () => {
    const text = editor.getText()
    downloadFile(`${filename}.txt`, text, 'text/plain')
  }

  const exportHtml = () => {
    const bodyHtml = editor.getHTML()
    const fullHtml = buildHtmlDocument(title, bodyHtml)
    downloadFile(`${filename}.html`, fullHtml, 'text/html')
  }

  const exportMarkdown = () => {
    const json = editor.getJSON()
    const md = jsonToMarkdown(json as Record<string, unknown>)
    downloadFile(`${filename}.md`, md, 'text/markdown')
  }

  const printDoc = () => {
    window.print()
  }

  const copyToClipboard = async () => {
    const text = editor.getText()
    await navigator.clipboard.writeText(text)
  }

  const items = [
    { label: 'Export as .txt', icon: FileText, action: exportTxt },
    { label: 'Export as .html', icon: FileCode2, action: exportHtml },
    { label: 'Export as .md', icon: FileDown, action: exportMarkdown },
    { label: 'divider', icon: null, action: () => {} },
    { label: 'Print / Save as PDF', icon: Printer, action: printDoc },
    { label: 'Copy as plain text', icon: ClipboardCopy, action: copyToClipboard },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-navy-200 hover:text-white hover:bg-navy-700 rounded transition-colors cursor-pointer"
      >
        Export
      </button>

      {menuOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-navy-800 border border-navy-600 rounded-lg shadow-xl py-1 w-52">
          {items.map((item) =>
            item.label === 'divider' ? (
              <div key="divider" className="h-px bg-navy-700 my-1" />
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  item.action()
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-navy-200 hover:bg-navy-700 hover:text-white transition-colors cursor-pointer"
              >
                {item.icon && <item.icon size={16} className="text-navy-400" />}
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
