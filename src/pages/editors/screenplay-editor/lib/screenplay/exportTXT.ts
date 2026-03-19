/**
 * Plain Text (.txt) Exporter
 *
 * Generates an industry-standard plain-text screenplay from Lexical editor state.
 * Follows standard screenplay formatting with proper margins and spacing.
 */

import type { LegacyTitlePage } from '../../types'

// ─── Serialized node types (shared with FDX exporter) ───

interface SerializedTextNode {
  type: 'text'
  text: string
  [key: string]: any
}

interface SerializedElementNode {
  type: string
  children: SerializedNode[]
  [key: string]: any
}

type SerializedNode = SerializedTextNode | SerializedElementNode

interface SerializedEditorState {
  root: {
    children: SerializedElementNode[]
    [key: string]: any
  }
}

// ─── Formatting constants (character widths for Courier 12pt) ───
// Standard screenplay page is ~60 characters wide

const PAGE_WIDTH = 60
const DIALOGUE_LEFT_MARGIN = 10
const DIALOGUE_WIDTH = 35
const CHARACTER_LEFT_MARGIN = 22
const PARENTHETICAL_LEFT_MARGIN = 16
const TRANSITION_WIDTH = 60

// ─── Extract plain text from node children ───

function extractText(children: SerializedNode[]): string {
  let text = ''
  for (const child of children) {
    if (child.type === 'text') {
      text += (child as SerializedTextNode).text
    } else if ('children' in child && Array.isArray(child.children)) {
      text += extractText(child.children)
    }
  }
  return text
}

// ─── Pad a string to center or indent ───

function padLeft(text: string, spaces: number): string {
  return ' '.repeat(spaces) + text
}

function centerText(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2))
  return ' '.repeat(pad) + text
}

// ─── Word-wrap a line to a maximum width ───

function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text]

  const lines: string[] = []
  let remaining = text

  while (remaining.length > maxWidth) {
    // Find the last space within the max width
    let breakAt = remaining.lastIndexOf(' ', maxWidth)
    if (breakAt <= 0) breakAt = maxWidth // force break if no space found

    lines.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }

  if (remaining) lines.push(remaining)
  return lines
}

// ─── Format a single paragraph ───

function formatParagraph(type: string, text: string): string {
  if (!text.trim()) return ''

  switch (type) {
    case 'scene-heading': {
      // Scene headings: uppercase, full width, preceded by blank line
      return '\n' + text.toUpperCase()
    }

    case 'action': {
      // Action: full width, wrapped
      const wrapped = wordWrap(text, PAGE_WIDTH)
      return wrapped.join('\n')
    }

    case 'character': {
      // Character name: uppercase, centered roughly
      return '\n' + padLeft(text.toUpperCase(), CHARACTER_LEFT_MARGIN)
    }

    case 'dialogue': {
      // Dialogue: indented, narrower column
      const wrapped = wordWrap(text, DIALOGUE_WIDTH)
      return wrapped.map((line) => padLeft(line, DIALOGUE_LEFT_MARGIN)).join('\n')
    }

    case 'parenthetical': {
      // Parenthetical: indented slightly less than dialogue
      const pText = text.startsWith('(') ? text : `(${text})`
      const wrapped = wordWrap(pText, DIALOGUE_WIDTH)
      return wrapped.map((line) => padLeft(line, PARENTHETICAL_LEFT_MARGIN)).join('\n')
    }

    case 'transition': {
      // Transitions: right-aligned, uppercase
      const upper = text.toUpperCase()
      const pad = Math.max(0, TRANSITION_WIDTH - upper.length)
      return '\n' + ' '.repeat(pad) + upper
    }

    default:
      return text
  }
}

// ─── Build the title page ───

function buildTitlePageText(
  tp: LegacyTitlePage | undefined,
  scriptTitle?: string
): string {
  const title = scriptTitle || tp?.title
  if (!title) return ''

  const lines: string[] = []

  // Add some vertical spacing
  lines.push('')
  lines.push('')
  lines.push('')
  lines.push('')
  lines.push('')

  // Title (centered, uppercase)
  lines.push(centerText(title.toUpperCase(), PAGE_WIDTH))
  lines.push('')

  // Written by
  if (tp?.writtenBy) {
    lines.push(centerText('Written by', PAGE_WIDTH))
    lines.push(centerText(tp.writtenBy, PAGE_WIDTH))
  }

  // Based on
  if (tp?.basedOn) {
    lines.push('')
    lines.push(centerText(tp.basedOn, PAGE_WIDTH))
  }

  // Bottom section: draft, date, contact (left-aligned)
  lines.push('')
  lines.push('')
  lines.push('')

  if (tp?.draft) lines.push(tp.draft)
  if (tp?.date) lines.push(tp.date)
  if (tp?.contact) lines.push(tp.contact)

  // Page break
  lines.push('')
  lines.push('=' .repeat(PAGE_WIDTH))
  lines.push('')

  return lines.join('\n')
}

// ─── Main export function ───

export function exportToTXT(
  editorState: SerializedEditorState | null,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string
): string {
  const parts: string[] = []

  // Title page
  const tp = buildTitlePageText(titlePage, scriptTitle)
  if (tp) parts.push(tp)

  // Body
  if (editorState?.root?.children) {
    let prevType = ''

    for (const block of editorState.root.children) {
      const text = extractText(block.children || [])
      const type = block.type

      // Add spacing between paragraphs (not between character→dialogue or parenthetical→dialogue)
      const needsExtraSpace =
        prevType &&
        !(prevType === 'character' && (type === 'dialogue' || type === 'parenthetical')) &&
        !(prevType === 'parenthetical' && type === 'dialogue') &&
        !(prevType === 'dialogue' && type === 'parenthetical') &&
        type !== 'scene-heading' && // scene heading adds its own
        type !== 'character' && // character adds its own
        type !== 'transition' // transition adds its own

      if (needsExtraSpace) {
        parts.push('')
      }

      const formatted = formatParagraph(type, text)
      if (formatted) {
        parts.push(formatted)
      }

      prevType = type
    }
  }

  return parts.join('\n') + '\n'
}

// ─── Convenience: export from legacy elements format ───

export function exportLegacyToTXT(
  elements: Array<{ type: string; text: string }>,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string
): string {
  const LEGACY_TO_LEXICAL: Record<string, string> = {
    sceneHeading: 'scene-heading',
    action: 'action',
    character: 'character',
    dialogue: 'dialogue',
    parenthetical: 'parenthetical',
    transition: 'transition',
  }

  const fakeEditorState: SerializedEditorState = {
    root: {
      children: elements.map((el) => ({
        type: LEGACY_TO_LEXICAL[el.type] || el.type || 'action',
        children: [{ type: 'text', text: el.text || '' }],
      })),
    },
  }

  return exportToTXT(fakeEditorState, titlePage, scriptTitle)
}
