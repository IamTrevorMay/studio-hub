/**
 * FDX (Final Draft XML) Exporter
 *
 * Generates a valid .fdx file matching the Final Draft 12 XML schema
 * from a Lexical editor state JSON.
 */

import type { LegacyTitlePage } from '../../types'

// ─── Lexical serialized node types ───

interface SerializedTextNode {
  type: 'text'
  text: string
  format?: number
  style?: string
  [key: string]: any
}

interface SerializedNoteMarkNode {
  type: 'note-mark'
  noteId: string
  noteColor: string
  children: SerializedNode[]
  [key: string]: any
}

interface SerializedElementNode {
  type: string
  children: SerializedNode[]
  [key: string]: any
}

type SerializedNode = SerializedTextNode | SerializedNoteMarkNode | SerializedElementNode

interface SerializedEditorState {
  root: {
    children: SerializedElementNode[]
    [key: string]: any
  }
}

// ─── Node type → FDX paragraph type mapping ───

const FDX_TYPE_MAP: Record<string, string> = {
  'scene-heading': 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
}

// ─── Lexical text format bitmask constants ───
const IS_BOLD = 1
const IS_ITALIC = 2
const IS_UNDERLINE = 8

// ─── XML-escape text ───

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Extract plain text from a node tree (recursing through note-marks) ───

interface TextRun {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
}

function extractTextRuns(children: SerializedNode[]): TextRun[] {
  const runs: TextRun[] = []

  for (const child of children) {
    if (child.type === 'text') {
      const tc = child as SerializedTextNode
      const fmt = tc.format || 0
      runs.push({
        text: tc.text,
        bold: (fmt & IS_BOLD) !== 0,
        italic: (fmt & IS_ITALIC) !== 0,
        underline: (fmt & IS_UNDERLINE) !== 0,
      })
    } else if (child.type === 'note-mark') {
      // Recurse into note-mark children — notes are metadata, text is content
      const nm = child as SerializedNoteMarkNode
      runs.push(...extractTextRuns(nm.children))
    } else if ('children' in child && Array.isArray(child.children)) {
      runs.push(...extractTextRuns(child.children))
    }
  }

  return runs
}

// ─── Build FDX Text elements with optional Style attribute ───

function buildTextElements(runs: TextRun[]): string {
  if (runs.length === 0) {
    return '        <Text></Text>'
  }

  return runs
    .map((run) => {
      const styles: string[] = []
      if (run.bold) styles.push('Bold')
      if (run.italic) styles.push('Italic')
      if (run.underline) styles.push('Underline')

      const styleAttr = styles.length > 0 ? ` Style="${styles.join('+')}"` : ''
      return `        <Text${styleAttr}>${escapeXml(run.text)}</Text>`
    })
    .join('\n')
}

// ─── Main export function ───

export function exportToFDX(
  editorState: SerializedEditorState | null,
  titlePage?: LegacyTitlePage,
  scriptTitle?: string
): string {
  const title = escapeXml(scriptTitle || titlePage?.title || 'Untitled Screenplay')
  const author = escapeXml(titlePage?.writtenBy || '')

  // Build paragraphs from editor state
  let paragraphs = ''

  if (editorState?.root?.children) {
    for (const block of editorState.root.children) {
      const fdxType = FDX_TYPE_MAP[block.type] || 'General'
      const runs = extractTextRuns(block.children || [])
      const textElements = buildTextElements(runs)

      // Scene numbers for scene headings
      let sceneNumberAttr = ''
      if (block.type === 'scene-heading' && block.sceneNumber) {
        sceneNumberAttr = ` Number="${escapeXml(String(block.sceneNumber))}"`
      }

      paragraphs += `      <Paragraph Type="${fdxType}"${sceneNumberAttr}>\n${textElements}\n      </Paragraph>\n`
    }
  }

  // Build the title page section
  const titlePageXml = buildTitlePage(titlePage, title, author)

  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paragraphs}  </Content>
${titlePageXml}  <HeaderAndFooter>
    <Header>
      <Paragraph>
        <Text></Text>
      </Paragraph>
    </Header>
    <Footer>
      <Paragraph>
        <Text></Text>
      </Paragraph>
    </Footer>
  </HeaderAndFooter>
  <SpellCheckIgnoreLists>
    <IgnoredRanges />
    <IgnoredWords />
  </SpellCheckIgnoreLists>
  <PageLayout>
    <PageSize Height="11.00" Width="8.50" />
    <InchesPerLine>0.1667</InchesPerLine>
    <LinesPerInch>6</LinesPerInch>
  </PageLayout>
</FinalDraft>
`
}

// ─── Build the FDX TitlePage section ───

function buildTitlePage(
  tp: LegacyTitlePage | undefined,
  title: string,
  author: string
): string {
  if (!tp && !title) return ''

  const lines: string[] = []

  // Title
  lines.push(`      <Paragraph>
        <Text Style="Bold+Underline">${title}</Text>
      </Paragraph>`)

  // Written By
  if (author) {
    lines.push(`      <Paragraph>
        <Text></Text>
      </Paragraph>`)
    lines.push(`      <Paragraph>
        <Text>Written by</Text>
      </Paragraph>`)
    lines.push(`      <Paragraph>
        <Text>${author}</Text>
      </Paragraph>`)
  }

  // Based On
  if (tp?.basedOn) {
    lines.push(`      <Paragraph>
        <Text></Text>
      </Paragraph>`)
    lines.push(`      <Paragraph>
        <Text>${escapeXml(tp.basedOn)}</Text>
      </Paragraph>`)
  }

  // Contact / Draft info goes in bottom-left
  const contactLines: string[] = []
  if (tp?.draft) contactLines.push(escapeXml(tp.draft))
  if (tp?.date) contactLines.push(escapeXml(tp.date))
  if (tp?.contact) contactLines.push(escapeXml(tp.contact))

  const contactXml = contactLines.length > 0
    ? contactLines.map((l) => `      <Paragraph>
        <Text>${l}</Text>
      </Paragraph>`).join('\n')
    : ''

  return `  <TitlePage>
    <Content>
${lines.join('\n')}
    </Content>
${contactXml ? `    <ContactContent>\n${contactXml}\n    </ContactContent>\n` : ''}  </TitlePage>
`
}

// ─── Convenience: export from legacy elements format ───

export function exportLegacyToFDX(
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

  return exportToFDX(fakeEditorState, titlePage, scriptTitle)
}
