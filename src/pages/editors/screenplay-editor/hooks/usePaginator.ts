import { useEffect, useState, useRef, useCallback } from 'react'
import { $getRoot, type LexicalEditor, type ElementNode } from 'lexical'
import { $isSceneHeadingNode } from '../nodes/SceneHeadingNode'
import { $isActionNode } from '../nodes/ActionNode'
import { $isCharacterNode } from '../nodes/CharacterNode'
import { $isDialogueNode } from '../nodes/DialogueNode'
import { $isParentheticalNode } from '../nodes/ParentheticalNode'
import { $isTransitionNode } from '../nodes/TransitionNode'
import {
  paginate,
  type PaginatorElement,
  type PaginatorPage,
  type CalculatedPageBreak,
} from '../lib/screenplay/paginator'
import type { ScriptElementType } from '../types'

// ─── Map Lexical node → ScriptElementType ───

function getNodeType(node: ElementNode): ScriptElementType | null {
  if ($isSceneHeadingNode(node)) return 'scene-heading'
  if ($isActionNode(node)) return 'action'
  if ($isCharacterNode(node)) return 'character'
  if ($isDialogueNode(node)) return 'dialogue'
  if ($isParentheticalNode(node)) return 'parenthetical'
  if ($isTransitionNode(node)) return 'transition'
  return null
}

// ─── Hook result ───

export interface PaginatorResult {
  pages: PaginatorPage[]
  breaks: CalculatedPageBreak[]
  pageCount: number
}

// ─── usePaginator hook ───
// Reads the current editor state on every update, extracts elements,
// runs the paginator, and returns page/break data.
// Debounced to avoid running on every keystroke.

export function usePaginator(editor: LexicalEditor): PaginatorResult {
  const [result, setResult] = useState<PaginatorResult>({
    pages: [{ pageNumber: 1, elementKeys: [], lineCount: 0 }],
    breaks: [],
    pageCount: 1,
  })

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const compute = useCallback(() => {
    editor.getEditorState().read(() => {
      const root = $getRoot()
      const children = root.getChildren() as ElementNode[]

      const elements: PaginatorElement[] = []
      let index = 0

      for (const child of children) {
        const type = getNodeType(child)
        if (!type) continue

        elements.push({
          key: child.getKey(),
          type,
          text: child.getTextContent(),
          index: index++,
        })
      }

      const { pages, breaks } = paginate(elements)

      setResult({
        pages,
        breaks,
        pageCount: pages.length,
      })
    })
  }, [editor])

  useEffect(() => {
    // Run once immediately
    compute()

    // Then on every editor update (debounced 300ms)
    return editor.registerUpdateListener(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(compute, 300)
    })
  }, [editor, compute])

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return result
}
