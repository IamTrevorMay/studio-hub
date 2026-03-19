import { useEffect, useRef, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { useEditorStore } from '../store/editorStore'

const SAVE_INTERVAL = 3000

export function useAutoSave(editor: Editor | null, documentId: string | null) {
  const { updateContent, saveToLocalStorage, setSaving } = useEditorStore()
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    if (!dirtyRef.current || !editor || !documentId) return
    setSaving(true)
    const content = editor.getJSON()
    const wordCount = editor.storage.characterCount.words()
    updateContent(documentId, content, wordCount)
    saveToLocalStorage()
    dirtyRef.current = false
  }, [editor, documentId, updateContent, saveToLocalStorage, setSaving])

  useEffect(() => {
    if (!editor) return

    const onUpdate = () => {
      dirtyRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SAVE_INTERVAL)
    }

    editor.on('update', onUpdate)

    return () => {
      editor.off('update', onUpdate)
      if (timerRef.current) clearTimeout(timerRef.current)
      // Save any pending changes on unmount
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
