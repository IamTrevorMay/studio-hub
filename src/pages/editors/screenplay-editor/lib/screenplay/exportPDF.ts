/**
 * PDF Exporter — generates production-ready screenplay PDFs.
 *
 * Uses jsPDF with the built-in Courier font (the industry standard for
 * screenplay production). Matches standard screenplay formatting:
 *   - US Letter (8.5" × 11"), Courier 12pt
 *   - Margins: 1.5" left, 1" right, 1" top, 1" bottom
 *   - 54 lines per page
 *   - Page numbers top-right starting from page 2
 *   - Scene numbers on both margins when enabled
 */

import { jsPDF } from 'jspdf'
import type { LegacyTitlePage } from '../../types'

// ─── Serialized node types ───

interface SerializedTextNode {
  type: 'text'
  text: string
  format?: number
  [key: string]: any
}

interface SerializedElementNode {
  type: string
  children: SerializedNode[]
  sceneNumber?: number
  [key: string]: any
}

type SerializedNode = SerializedTextNode | SerializedElementNode

export interface SerializedEditorState {
  root: {
    children: SerializedElementNode[]
    [key: string]: any
  }
}

// ─── Page constants (points) ───

const PW = 612       // 8.5" page width
const PH = 792       // 11" page height
const MT = 72        // 1" top margin
const MB = 72        // 1" bottom margin
const ML = 108       // 1.5" left margin
const MR = 72        // 1" right margin
const FONT_SIZE = 12
const LH = 12        // line height (single-spaced 12pt)
const CW = 7.2       // character width (Courier 12pt)
const LINES_PER_PAGE = 54
const BODY_TOP = MT + LH  // first text line Y (below top margin)

// ─── Element formatting ───

interface ElementFormat {
  x: number          // left edge x position
  chars: number      // max characters per line
  uppercase: boolean
  align?: 'left' | 'right'
  linesBefore: number  // blank lines before (if not first on page)
}

const ELEMENT_FORMAT: Record<string, ElementFormat> = {
  'scene-heading':   { x: ML,  chars: 60, uppercase: true,  linesBefore: 2 },
  'action':          { x: ML,  chars: 60, uppercase: false, linesBefore: 1 },
  'character':       { x: 266, chars: 33, uppercase: true,  linesBefore: 1 },
  'dialogue':        { x: 180, chars: 35, uppercase: false, linesBefore: 0 },
  'parenthetical':   { x: 223, chars: 25, uppercase: false, linesBefore: 0 },
  'transition':      { x: ML,  chars: 60, uppercase: true,  linesBefore: 1, align: 'right' },
  'shot':            { x: ML,  chars: 60, uppercase: true,  linesBefore: 1 },
  'general':         { x: ML,  chars: 60, uppercase: false, linesBefore: 1 },
}

// ─── Lexical format bitmask ───
const IS_BOLD = 1
const IS_ITALIC = 2

// ─── Text run ───

interface TextRun {
  text: string
  bold: boolean
  italic: boolean
}

// ─── Extract text runs from node children ───

function extractRuns(children: SerializedNode[]): TextRun[] {
  const runs: TextRun[] = []
  for (const child of children) {
    if (child.type === 'text') {
      const tc = child as SerializedTextNode
      const fmt = tc.format || 0
      runs.push({
        text: tc.text,
        bold: (fmt & IS_BOLD) !== 0,
        italic: (fmt & IS_ITALIC) !== 0,
      })
    } else if ('children' in child && Array.isArray(child.children)) {
      runs.push(...extractRuns(child.children))
    }
  }
  return runs
}

// ─── Extract plain text from runs ───

function plainText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join('')
}

// ─── Word-wrap text to a character width, returning lines ───

function wordWrap(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const lines: string[] = []
  let remaining = text

  while (remaining.length > maxChars) {
    let breakAt = remaining.lastIndexOf(' ', maxChars)
    if (breakAt <= 0) breakAt = maxChars
    lines.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }
  if (remaining) lines.push(remaining)
  return lines
}

// ─── Determine spacing between elements ───

function getLinesBefore(
  type: string,
  prevType: string | null,
  isFirstOnPage: boolean
): number {
  if (isFirstOnPage) return 0

  // No blank line between character→dialogue/paren or paren→dialogue
  if (
    prevType === 'character' &&
    (type === 'dialogue' || type === 'parenthetical')
  ) return 0
  if (prevType === 'parenthetical' && type === 'dialogue') return 0
  if (prevType === 'dialogue' && type === 'parenthetical') return 0

  const fmt = ELEMENT_FORMAT[type] || ELEMENT_FORMAT['action']

  // Scene headings get an extra blank line
  if (type === 'scene-heading') return Math.min(fmt.linesBefore, 2)

  return fmt.linesBefore
}

// ─── Main export function ───

export interface PDFExportOptions {
  showSceneNumbers?: boolean
}

export function generateScreenplayPDF(
  editorState: SerializedEditorState | null,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string,
  options?: PDFExportOptions
): jsPDF {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    compress: true,
  })

  doc.setFont('courier', 'normal')
  doc.setFontSize(FONT_SIZE)

  const title = scriptTitle || titlePage?.title || 'Untitled Screenplay'
  const showSceneNumbers = options?.showSceneNumbers ?? false

  // ─── Render title page ───
  renderTitlePage(doc, titlePage, title)

  // ─── Render body pages ───
  if (editorState?.root?.children?.length) {
    doc.addPage()
    renderBody(doc, editorState.root.children, showSceneNumbers)
  }

  return doc
}

// ─── Title page ───

function renderTitlePage(
  doc: jsPDF,
  tp: LegacyTitlePage | undefined,
  title: string
) {
  const cx = PW / 2 // center x

  // Title — vertically centered, upper third of page
  const titleY = PH * 0.38

  doc.setFont('courier', 'bold')
  doc.setFontSize(FONT_SIZE)

  // Word-wrap the title for long titles
  const titleLines = wordWrap(title.toUpperCase(), 40)
  titleLines.forEach((line, i) => {
    doc.text(line, cx, titleY + i * LH, { align: 'center' })
  })

  // "Written by" + author
  doc.setFont('courier', 'normal')
  const byY = titleY + titleLines.length * LH + LH * 3

  if (tp?.writtenBy) {
    doc.text('Written by', cx, byY, { align: 'center' })
    doc.text(tp.writtenBy, cx, byY + LH * 2, { align: 'center' })
  }

  // "Based on" line
  if (tp?.basedOn) {
    const basedY = byY + LH * 5
    doc.text(tp.basedOn, cx, basedY, { align: 'center' })
  }

  // Contact info — bottom left
  const contactLines: string[] = []
  if (tp?.draft) contactLines.push(tp.draft)
  if (tp?.date) contactLines.push(tp.date)
  if (tp?.contact) contactLines.push(tp.contact)

  if (contactLines.length > 0) {
    const startY = PH - MB - contactLines.length * LH
    contactLines.forEach((line, i) => {
      doc.text(line, ML, startY + i * LH)
    })
  }
}

// ─── Body renderer ───

function renderBody(
  doc: jsPDF,
  blocks: SerializedElementNode[],
  showSceneNumbers: boolean
) {
  let currentLine = 0  // 0-indexed line on current page
  let pageNum = 1       // 1-indexed (first content page)
  let prevType: string | null = null
  let sceneCounter = 0

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const type = block.type
    const fmt = ELEMENT_FORMAT[type] || ELEMENT_FORMAT['action']
    const runs = extractRuns(block.children || [])
    let text = plainText(runs)

    if (fmt.uppercase) text = text.toUpperCase()

    // Calculate wrapped lines
    const wrappedLines = text.trim() ? wordWrap(text, fmt.chars) : ['']
    const linesBefore = getLinesBefore(type, prevType, currentLine === 0)

    // Total lines needed for this element
    const totalNeeded = linesBefore + wrappedLines.length

    // ─── Page break logic ───

    const remaining = LINES_PER_PAGE - currentLine

    // Widow protection: scene heading needs room for itself + at least 2 lines
    if (type === 'scene-heading' && remaining < totalNeeded + 2 && remaining < 5) {
      startNewPage(doc, ++pageNum)
      currentLine = 0
      prevType = null
    }

    // Character protection: needs room for itself + 1 dialogue line
    if (type === 'character') {
      const nextBlock = blocks[i + 1]
      const nextIsDialogue = nextBlock && (nextBlock.type === 'dialogue' || nextBlock.type === 'parenthetical')
      if (nextIsDialogue && remaining < totalNeeded + 1) {
        startNewPage(doc, ++pageNum)
        currentLine = 0
        prevType = null
      }
    }

    // Transition protection
    if (type === 'transition' && remaining < totalNeeded + 1 && remaining < 4) {
      startNewPage(doc, ++pageNum)
      currentLine = 0
      prevType = null
    }

    // General overflow — if it doesn't fit, break page
    const recalcBefore = getLinesBefore(type, prevType, currentLine === 0)
    const recalcTotal = recalcBefore + wrappedLines.length
    const recalcRemaining = LINES_PER_PAGE - currentLine

    if (recalcTotal > recalcRemaining) {
      // For long action blocks, try to split at a sentence boundary
      if (type === 'action' && wrappedLines.length > 4 && recalcRemaining > recalcBefore + 2) {
        const linesFit = recalcRemaining - recalcBefore
        const topLines = wrappedLines.slice(0, linesFit)
        const bottomLines = wrappedLines.slice(linesFit)

        // Render top portion
        currentLine += recalcBefore
        renderLines(doc, topLines, fmt, currentLine, runs)
        currentLine += topLines.length

        // New page
        startNewPage(doc, ++pageNum)
        currentLine = 0
        prevType = null

        // Render bottom portion
        renderLines(doc, bottomLines, fmt, currentLine, runs)
        currentLine += bottomLines.length
        prevType = type
        continue
      }

      // Push entire element to next page
      startNewPage(doc, ++pageNum)
      currentLine = 0
      prevType = null
    }

    // ─── Render the element ───

    const actualBefore = getLinesBefore(type, prevType, currentLine === 0)
    currentLine += actualBefore

    // Scene numbers
    if (type === 'scene-heading') {
      sceneCounter++
      if (showSceneNumbers) {
        const y = lineToY(currentLine)
        const numStr = String(sceneCounter)
        // Left scene number (in the left margin)
        doc.setFont('courier', 'normal')
        doc.setFontSize(FONT_SIZE)
        doc.text(numStr, ML - 36, y)
        // Right scene number (in the right margin)
        doc.text(numStr, PW - MR + 14, y)
      }
    }

    renderLines(doc, wrappedLines, fmt, currentLine, runs)
    currentLine += wrappedLines.length
    prevType = type
  }
}

// ─── Render wrapped lines for an element ───

function renderLines(
  doc: jsPDF,
  lines: string[],
  fmt: ElementFormat,
  startLine: number,
  runs: TextRun[]
) {
  doc.setFontSize(FONT_SIZE)

  // For formatted (bold/italic) elements, map runs onto each wrapped line by
  // character offset so styling survives multi-line elements (previously it was
  // only rendered for single-line elements and silently dropped otherwise).
  const formatted = fmt.align !== 'right' && hasFormatting(runs)
  const styleMap = formatted ? buildStyleMap(runs) : []
  const full = formatted ? (fmt.uppercase ? plainText(runs).toUpperCase() : plainText(runs)) : ''
  let searchPos = 0

  for (let i = 0; i < lines.length; i++) {
    const y = lineToY(startLine + i)
    const lineText = lines[i]

    if (fmt.align === 'right') {
      // Right-align transitions
      const rightEdge = PW - MR
      doc.setFont('courier', 'normal')
      doc.text(lineText, rightEdge, y, { align: 'right' })
    } else if (formatted) {
      const start = full.indexOf(lineText, searchPos)
      if (start < 0) {
        doc.setFont('courier', 'normal')
        doc.text(lineText, fmt.x, y)
      } else {
        renderStyledLine(doc, lineText, styleMap, start, fmt.x, y)
        searchPos = start + lineText.length
      }
    } else {
      // Simple text
      doc.setFont('courier', 'normal')
      doc.text(lineText, fmt.x, y)
    }
  }
}

// Per-character font style for the concatenated run text.
function buildStyleMap(runs: TextRun[]): string[] {
  const map: string[] = []
  for (const run of runs) {
    const style = run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal'
    for (let i = 0; i < run.text.length; i++) map.push(style)
  }
  return map
}

// Render one (already case-correct) wrapped line, switching font per run via the
// style map, advancing x in monospace character widths.
function renderStyledLine(doc: jsPDF, lineText: string, styleMap: string[], start: number, x: number, y: number) {
  let segStart = 0
  let curStyle = styleMap[start] || 'normal'
  const emit = (seg: string, style: string, col: number) => {
    doc.setFont('courier', style)
    doc.text(seg, x + col * CW, y)
  }
  for (let i = 1; i <= lineText.length; i++) {
    const style = i < lineText.length ? (styleMap[start + i] || 'normal') : null
    if (style !== curStyle) {
      emit(lineText.slice(segStart, i), curStyle, segStart)
      segStart = i
      curStyle = style as string
    }
  }
  doc.setFont('courier', 'normal')
}

// ─── Check if runs have any bold/italic formatting ───

function hasFormatting(runs: TextRun[]): boolean {
  return runs.some((r) => r.bold || r.italic)
}


// ─── Convert a 0-indexed line number to a Y position in points ───

function lineToY(line: number): number {
  return BODY_TOP + line * LH
}

// ─── Start a new page and render the page number ───

function startNewPage(doc: jsPDF, pageNum: number) {
  doc.addPage()

  // Page number in top-right (page 2+ of content = visible, page 1 = no number)
  if (pageNum >= 2) {
    doc.setFont('courier', 'normal')
    doc.setFontSize(FONT_SIZE)
    const numStr = `${pageNum}.`
    doc.text(numStr, PW - MR, MT - LH, { align: 'right' })
  }
}

// ─── Convenience: get blob URL for preview ───

export function generatePDFBlobUrl(
  editorState: SerializedEditorState | null,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string,
  options?: PDFExportOptions
): string {
  const doc = generateScreenplayPDF(editorState, titlePage, scriptTitle, options)
  return doc.output('bloburl').toString()
}

// ─── Convenience: trigger download ───

export function downloadScreenplayPDF(
  editorState: SerializedEditorState | null,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string,
  options?: PDFExportOptions
) {
  const doc = generateScreenplayPDF(editorState, titlePage, scriptTitle, options)
  const filename = (scriptTitle || 'Untitled Screenplay')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim() || 'Screenplay'
  doc.save(`${filename}.pdf`)
}
