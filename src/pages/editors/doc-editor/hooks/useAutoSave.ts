import { useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from '../editorStore'
import { supabase } from '../../../../supabaseClient'

const SAVE_INTERVAL = 2000

export function useAutoSave(editor: Editor | null, docId: string, tableName: string, loaded: boolean) {
  const { setSaving, setLastSavedAt } = useEditorStore()
  const dirtyRef = useRef(false)
  const loadedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep a ref in sync so flush() always sees the latest value
  useEffect(() => {
    loadedRef.current = loaded
  }, [loaded])

  const flush = useCallback(() => {
    if (!dirtyRef.current || !editor || !docId || !loadedRef.current) return
    dirtyRef.current = false
    setSaving(true)
    const html = editor.getHTML()
    supabase
      .from(tableName)
      .update({ content: { html }, updated_at: new Date().toISOString() })
      .eq('id', docId)
      .then(({ error }) => {
        setSaving(false)
        if (error) {
          // Supabase resolves (doesn't reject) on DB/RLS failure. Re-mark dirty
          // so the next edit/interval retries — never report a failed save as saved.
          console.error('Doc autosave failed:', error.message)
          dirtyRef.current = true
          return
        }
        setLastSavedAt(Date.now())
      })
  }, [editor, docId, tableName, setSaving, setLastSavedAt])

  useEffect(() => {
    if (!editor) return

    const onUpdate = () => {
      if (!loadedRef.current) return // Ignore setContent() during initial load
      dirtyRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_INTERVAL)
    }

    editor.on('update', onUpdate)

    return () => {
      editor.off('update', onUpdate)
      if (timerRef.current) clearTimeout(timerRef.current)
      flush()
    }
  }, [editor, flush])

  // Save on beforeunload
  useEffect(() => {
    const onBeforeUnload = () => flush()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [flush])

  return flush
}
