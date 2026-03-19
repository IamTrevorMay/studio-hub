// Document types matching existing Supabase schema exactly

export type DocumentType = 'document' | 'screenplay' | 'whiteboard' | 'stickyboard' | 'storyboard'

export type DocumentSource = 'concept_documents' | 'show_documents' | 'resource_documents'

// Rich text document content
export interface RichTextContent {
  html: string
}

// Screenplay content
export interface ScreenplayTitlePage {
  title: string
  writtenBy: string
  basedOn: string
  draft: string
  date: string
  contact: string
}

export interface ScreenplayElement {
  id: string
  type: 'sceneHeading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition' | 'shot'
  text: string
}

export interface ScreenplayContent {
  titlePage: ScreenplayTitlePage
  elements: ScreenplayElement[]
  notes: string[]
}

// Whiteboard content
export interface WhiteboardStroke {
  color: string
  width: number
  eraser: boolean
  points: { x: number; y: number }[]
}

export interface WhiteboardContent {
  strokes: WhiteboardStroke[]
}

// Stickyboard content
export interface StickyNote {
  id: string
  x: number
  y: number
  text: string
  color: string
}

export interface StickyboardContent {
  notes: StickyNote[]
}

// Storyboard content
export interface StoryboardContent {
  pageCount: number
}

// Union of all content types
export type DocumentContent =
  | RichTextContent
  | ScreenplayContent
  | WhiteboardContent
  | StickyboardContent
  | StoryboardContent

// Base document matching concept_documents / show_documents schema
export interface ConceptDocument {
  id: string
  concept_id: string
  type: DocumentType
  title: string
  content: DocumentContent
  created_by: string
  created_at: string
  updated_at: string
}

export interface ShowDocument {
  id: string
  show_id: string
  type: DocumentType
  title: string
  content: DocumentContent
  created_by: string
  created_at: string
  updated_at: string
}

export interface ResourceDocument {
  id: string
  folder_id: string | null
  type: DocumentType
  title: string
  content: DocumentContent
  file_path: string | null
  file_type: string | null
  file_size: number | null
  original_filename: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ConceptTemplate {
  id: string
  name: string
  type: DocumentType
  content: DocumentContent
  created_by: string
  created_at: string
}

// Generic document used within the editor (normalized from any source table)
export interface EditorDocument {
  id: string
  source: DocumentSource
  parentId: string | null  // concept_id, show_id, or folder_id
  type: DocumentType
  title: string
  content: DocumentContent
  created_by: string
  created_at: string
  updated_at: string
}

// Editor config
export interface EditorConfig {
  placeholder?: string
  autofocus?: boolean
  editable?: boolean
}

// Comment stored as TipTap mark attributes
export interface CommentMark {
  commentId: string
  author: string
  text: string
  createdAt: string
}
