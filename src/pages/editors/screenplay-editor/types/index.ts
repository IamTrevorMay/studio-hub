// ─── Element Types ───

export type ScriptElementType =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'shot'
  | 'general'

export interface ScriptElement {
  id: string
  type: ScriptElementType
  content: string
  /** Duration estimate in eighths of a page */
  duration?: number
  /** Revision this element was last modified in */
  revision?: string
  /** Whether this element is locked from editing */
  locked?: boolean
  /** Optional notes/annotations attached to this element */
  notes?: string
}

// ─── Scene ───

export interface Scene {
  id: string
  heading: string
  sceneNumber?: number
  elements: ScriptElement[]
  /** Synopsis / logline for this scene */
  synopsis?: string
  /** Color tag for scene card / breakdown */
  color?: string
}

// ─── Character ───

export interface Character {
  name: string
  aliases: string[]
  notes: string
  /** Number of dialogue lines (computed) */
  dialogueCount?: number
}

// ─── Revision ───

export type RevisionColor =
  | 'white'
  | 'blue'
  | 'pink'
  | 'yellow'
  | 'green'
  | 'goldenrod'
  | 'buff'
  | 'salmon'
  | 'cherry'

export interface Revision {
  id: string
  color: RevisionColor
  date: string
  locked: boolean
  label?: string
}

// ─── Page Break ───

export interface PageBreak {
  /** Index of the element after which the break occurs */
  afterElementIndex: number
  /** Forced by user vs calculated automatically */
  forced: boolean
  pageNumber: number
}

// ─── Title Page ───

export interface TitlePage {
  title: string
  writtenBy: string
  basedOn?: string
  draft?: string
  date?: string
  contact?: string
}

// ─── Script ───

export type ScriptFormat = 'feature' | 'tv' | 'short'

export interface Script {
  id: string
  title: string
  author: string
  format: ScriptFormat
  scenes: Scene[]
  characters: Character[]
  revisions: Revision[]
  titlePage: TitlePage
  createdAt: string
  updatedAt: string
}

// ─── Inline Notes ───

export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue'

export interface ScriptNote {
  id: string
  color: NoteColor
  /** User-written note text */
  text: string
  /** The highlighted text from the script */
  highlightedText: string
  /** Element index in the flat elements array (for save/load anchoring) */
  elementIndex: number
  /** Character offset within the element's text */
  offset: number
  /** Length of the highlighted span */
  length: number
  createdAt: string
  resolved: boolean
}

// ─── Legacy format stored in Supabase ───
// Existing screenplays store { titlePage, elements, notes }
// where elements are flat arrays of { id, type, text }

export interface LegacyElement {
  id: string
  type: 'sceneHeading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'
  text: string
}

export interface LegacyTitlePage {
  title: string
  writtenBy: string
  basedOn: string
  draft: string
  date: string
  contact: string
}

export interface LegacyScreenplayContent {
  titlePage: LegacyTitlePage
  elements: LegacyElement[]
  notes: any[]
}

// ─── User Settings ───

export type PaperSize = 'us-letter' | 'a4'
export type FontSize = 10 | 11 | 12

export interface MarginSettings {
  top: number
  bottom: number
  left: number
  right: number
}

export interface UserSettings {
  paperSize: PaperSize
  fontSize: FontSize
  margins: MarginSettings
  /** Auto-uppercase scene headings, characters, transitions */
  autoUppercase: boolean
  /** Auto-insert CONT'D on split dialogue */
  autoContinued: boolean
  /** Auto-insert (MORE) / (CONT'D) at page breaks */
  autoMoresAndContinueds: boolean
  /** Show scene numbers */
  showSceneNumbers: boolean
  /** Show page breaks in editor */
  showPageBreaks: boolean
  /** Snap Tab key to cycle element types */
  tabCyclesTypes: boolean
  /** Auto-complete character names and locations */
  autoComplete: boolean
}

// ─── Default Settings ───

export const DEFAULT_MARGINS: MarginSettings = {
  top: 1.0,
  bottom: 1.0,
  left: 1.5,
  right: 1.0,
}

export const DEFAULT_SETTINGS: UserSettings = {
  paperSize: 'us-letter',
  fontSize: 12,
  margins: DEFAULT_MARGINS,
  autoUppercase: true,
  autoContinued: true,
  autoMoresAndContinueds: true,
  showSceneNumbers: false,
  showPageBreaks: true,
  tabCyclesTypes: true,
  autoComplete: true,
}
