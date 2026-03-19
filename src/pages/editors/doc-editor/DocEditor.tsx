import { useEffect, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { editorExtensions } from './editor/extensions'
import { useAutoSave } from './hooks/useAutoSave'
import { useEditorStore } from './editorStore'
import { supabase } from '../../../supabaseClient'
import { useAuth } from '../../../contexts/AuthContext'
import DocumentEditor from './DocumentEditor'
import './doc-editor.css'

const TABLE_MAP: Record<string, string> = {
  resource_documents: 'resource_documents',
  show_documents: 'show_documents',
}

interface Props {
  docId: string
  title: string
  docType: string
  onBack: () => void
  onSaveTemplate: ((name: string, type: string, content: any) => void) | null
  reviewData?: any
  onSendForReview?: (htmlContent: string) => void
}

export default function DocEditor({ docId, title, docType, onBack, onSaveTemplate, reviewData, onSendForReview }: Props) {
  const { profile } = useAuth() as any
  const [loaded, setLoaded] = useState(false)
  const tableName = TABLE_MAP[docType] || 'concept_documents'
  const { setAuthorName } = useEditorStore()

  const editor = useEditor({
    extensions: editorExtensions,
    autofocus: 'end',
    editorProps: {
      attributes: {
        class: 'tiptap prose-editor',
      },
    },
  })

  // Set author name from auth profile
  useEffect(() => {
    if (profile?.full_name) {
      setAuthorName(profile.full_name)
    }
  }, [profile?.full_name, setAuthorName])

  // Load document content from Supabase
  useEffect(() => {
    if (!editor) return
    ;(async () => {
      const { data } = await supabase
        .from(tableName)
        .select('content')
        .eq('id', docId)
        .single()
      if (data?.content?.html && editor) {
        editor.commands.setContent(data.content.html)
      }
      setLoaded(true)
    })()
  }, [docId, editor, tableName])

  // Auto-save to Supabase
  const save = useAutoSave(editor, docId, tableName, loaded)

  if (!editor) return null

  return (
    <DocumentEditor
      editor={editor}
      title={title}
      docId={docId}
      onBack={onBack}
      onSaveTemplate={onSaveTemplate}
      onSave={save}
      loaded={loaded}
      reviewData={reviewData}
      onSendForReview={onSendForReview}
    />
  )
}
