/**
 * Screenplay paginator engine.
 *
 * Calculates page breaks for industry-standard screenplay formatting:
 *   - US Letter (8.5" × 11"), Courier Prime 12pt
 *   - Margins: 1.5" left, 1" right, 1" top, 1" bottom
 *   - 12pt Courier ≈ 10 chars/inch → ~60 chars across the text area
 *   - 12pt line height = 1/6 inch = 12pt
 *   - Usable page height = 11" - 1" top - 1" bottom = 9" = 54 lines
 *
 * Formatting rules:
 *   1. Scene headings never appear alone at bottom of page (widow protection)
 *   2. Character names never appear without at least one line of dialogue
 *   3. Action blocks >4 lines break at a natural sentence boundary
 *   4. Transitions never appear alone at bottom of page
 */

import type { ScriptElementType } from '../../types'

// ─── Constants ───

/** Lines available per page (9" / (12pt / 72 pts-per-inch) = 54 lines) */
const LINES_PER_PAGE = 54

/** Characters per line for each element type (based on margin widths) */
const CHARS_PER_LINE: Record<string, number> = {
  'scene-heading': 60,   // full width
  action: 60,            // full width
  character: 33,         // narrow column (3.7" to ~7.5" = 3.8")
  dialogue: 35,          // 2.5" to 6.0" = 3.5"
  parenthetical: 25,     // 3.1" to 5.6" = 2.5"
  transition: 60,        // full width (right-aligned)
  shot: 60,
  general: 60,
}

/** Elements that get a blank line before them */
const BLANK_LINE_BEFORE = new Set<string>([
  'scene-heading',
  'character',
  'transition',
])

// ─── Flat element representation fed into the paginator ───

export interface PaginatorElement {
  /** Lexical node key — used to map back to DOM */
  key: string
  type: ScriptElementType
  text: string
  /** Index in the flat element array */
  index: number
}

// ─── Page break result ───

export interface CalculatedPageBreak {
  /** The node key of the element AFTER which the page break goes */
  afterKey: string
  /** 1-indexed page number ending at this break */
  pageNumber: number
}

// ─── Page object returned by the paginator ───

export interface PaginatorPage {
  /** 1-indexed page number */
  pageNumber: number
  /** Keys of elements assigned to this page */
  elementKeys: string[]
  /** Line count consumed on this page */
  lineCount: number
}

// ─── Estimate how many lines an element occupies ───

function estimateLines(type: ScriptElementType, text: string): number {
  const chars = CHARS_PER_LINE[type] || 60
  const textLen = Math.max((text || '').length, 1)
  return Math.ceil(textLen / chars)
}

// ─── Find the best sentence boundary to break a long action block ───
// Returns the number of lines for the "top half" that should stay on
// the current page. Falls back to the maximum if no good boundary is found.

function findActionBreakPoint(
  text: string,
  maxLines: number,
  charsPerLine: number
): number {
  // We want to break at a sentence end (. ! ?) that falls within maxLines
  const maxChars = maxLines * charsPerLine

  // Find the last sentence-ending punctuation within the budget
  const window = text.substring(0, maxChars)

  // Walk backwards from the end of the window to find ". " or ".\n" etc.
  let bestPos = -1
  for (let i = window.length - 1; i >= charsPerLine; i--) {
    const ch = window[i]
    if (ch === '.' || ch === '!' || ch === '?') {
      // Must be followed by a space, end-of-string, or newline
      const next = window[i + 1]
      if (!next || next === ' ' || next === '\n') {
        bestPos = i + 1
        break
      }
    }
  }

  if (bestPos > 0) {
    return Math.ceil(bestPos / charsPerLine)
  }

  // No good sentence boundary — just break at maxLines
  return maxLines
}

// ─── Main pagination function ───

export function paginate(elements: PaginatorElement[]): {
  pages: PaginatorPage[]
  breaks: CalculatedPageBreak[]
} {
  if (elements.length === 0) {
    return { pages: [{ pageNumber: 1, elementKeys: [], lineCount: 0 }], breaks: [] }
  }

  const pages: PaginatorPage[] = []
  const breaks: CalculatedPageBreak[] = []

  let currentPage: PaginatorPage = { pageNumber: 1, elementKeys: [], lineCount: 0 }
  let lineCount = 0

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const type = el.type
    const text = el.text

    // Calculate lines this element needs
    const blankBefore = i > 0 && BLANK_LINE_BEFORE.has(type) ? 1 : 0
    const contentLines = estimateLines(type, text)
    const totalLines = blankBefore + contentLines

    // ─── Check if this element fits on the current page ───
    const remaining = LINES_PER_PAGE - lineCount

    if (totalLines <= remaining) {
      // Fits — but apply widow/orphan protection checks

      // Rule 1: Scene heading widow protection
      // If a scene heading would land on the last 2 lines of a page,
      // push it to the next page (it needs itself + at least 1 action line)
      if (type === 'scene-heading' && remaining - totalLines < 2 && remaining < 4) {
        // Start new page with this scene heading
        emitPageBreak()
        lineCount = 0
        currentPage = {
          pageNumber: currentPage.pageNumber + 1,
          elementKeys: [],
          lineCount: 0,
        }
      }

      // Rule 2: Character name protection
      // Character must have room for itself + at least 1 line of dialogue
      if (type === 'character') {
        const nextEl = elements[i + 1]
        const nextIsDialogue =
          nextEl &&
          (nextEl.type === 'dialogue' || nextEl.type === 'parenthetical')
        if (nextIsDialogue && remaining - totalLines < 1) {
          // Not enough room for character + 1 dialogue line
          emitPageBreak()
          lineCount = 0
          currentPage = {
            pageNumber: currentPage.pageNumber + 1,
            elementKeys: [],
            lineCount: 0,
          }
        }
      }

      // Rule 4: Transition widow protection (like scene heading)
      if (type === 'transition' && remaining - totalLines < 1 && remaining < 3) {
        emitPageBreak()
        lineCount = 0
        currentPage = {
          pageNumber: currentPage.pageNumber + 1,
          elementKeys: [],
          lineCount: 0,
        }
      }

      // Add element to current page
      currentPage.elementKeys.push(el.key)
      lineCount += totalLines
      currentPage.lineCount = lineCount
    } else {
      // Doesn't fit — need a page break

      // Rule 3: Long action blocks break at sentence boundary
      if (type === 'action' && contentLines > 4 && remaining > 2) {
        const topHalf = findActionBreakPoint(
          text,
          remaining - blankBefore,
          CHARS_PER_LINE['action']
        )

        if (topHalf >= 2) {
          // Keep the element on the current page (it'll visually wrap)
          // but mark the page break
          currentPage.elementKeys.push(el.key)
          lineCount += blankBefore + topHalf
          currentPage.lineCount = lineCount

          emitPageBreak()

          // Continue the remaining lines on next page. Clamp ≥0 — findActionBreakPoint
          // can return topHalf ≥ contentLines, which would make bottomHalf negative
          // and corrupt `remaining` for every later element.
          const bottomHalf = Math.max(0, contentLines - topHalf)
          lineCount = bottomHalf
          currentPage = {
            pageNumber: currentPage.pageNumber + 1,
            elementKeys: [],
            lineCount: bottomHalf,
          }
          continue
        }
      }

      // Default: push the entire element to the next page. Cap the running
      // lineCount at a full page — an element taller than a page would otherwise
      // leave `remaining` negative, force-breaking (and mis-counting) every
      // subsequent element for the rest of the document.
      emitPageBreak()
      lineCount = Math.min(totalLines, LINES_PER_PAGE)
      currentPage = {
        pageNumber: currentPage.pageNumber + 1,
        elementKeys: [el.key],
        lineCount: Math.min(totalLines, LINES_PER_PAGE),
      }
    }
  }

  // Push the last page
  if (currentPage.elementKeys.length > 0 || pages.length === 0) {
    pages.push(currentPage)
  }

  return { pages, breaks }

  // ─── Helper to finalize the current page and record a break ───
  function emitPageBreak() {
    pages.push(currentPage)

    // The break goes after the last element on the current page
    const lastKey =
      currentPage.elementKeys[currentPage.elementKeys.length - 1]
    if (lastKey) {
      breaks.push({
        afterKey: lastKey,
        pageNumber: currentPage.pageNumber,
      })
    }
  }
}
