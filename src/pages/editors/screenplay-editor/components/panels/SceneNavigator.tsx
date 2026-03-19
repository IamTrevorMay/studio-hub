import { useEffect, useState, useCallback, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  type LexicalNode,
  type ElementNode,
  type LexicalEditor,
} from 'lexical'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd'
import { $isSceneHeadingNode } from '../../nodes/SceneHeadingNode'

// ─── Scene item for the navigator list ───

interface SceneItem {
  /** Lexical node key of the scene heading */
  key: string
  /** 1-indexed scene number */
  number: number
  /** INT. / EXT. / INT./EXT. / I/E. or empty */
  prefix: string
  /** Location + time of day (everything after prefix) */
  location: string
  /** Full raw text of the heading */
  fullText: string
  /**
   * Keys of all nodes belonging to this scene:
   * the heading itself + every node up to (but not including) the next heading.
   */
  nodeKeys: string[]
}

// ─── Parse a scene heading into prefix + location ───

function parseHeading(text: string): { prefix: string; location: string } {
  const upper = text.toUpperCase().trim()

  // Try to match known prefixes in order of specificity
  const prefixes = ['INT./EXT. ', 'INT/EXT. ', 'I/E. ', 'INT. ', 'EXT. ']
  for (const p of prefixes) {
    if (upper.startsWith(p)) {
      return {
        prefix: p.trim(),
        location: text.substring(p.length).trim(),
      }
    }
  }

  return { prefix: '', location: text.trim() }
}

// ─── Extract scenes from the editor state ───

function extractScenes(editor: LexicalEditor): SceneItem[] {
  const scenes: SceneItem[] = []

  editor.getEditorState().read(() => {
    const root = $getRoot()
    const children = root.getChildren()

    let currentScene: SceneItem | null = null
    let sceneNumber = 0

    for (const child of children) {
      if ($isSceneHeadingNode(child)) {
        // Finalize previous scene
        if (currentScene) {
          scenes.push(currentScene)
        }

        sceneNumber++
        const text = child.getTextContent()
        const { prefix, location } = parseHeading(text)

        currentScene = {
          key: child.getKey(),
          number: sceneNumber,
          prefix,
          location: location || '(untitled)',
          fullText: text,
          nodeKeys: [child.getKey()],
        }
      } else if (currentScene) {
        // Non-heading node belongs to the current scene
        currentScene.nodeKeys.push(child.getKey())
      }
      // Nodes before any scene heading are ignored in the navigator
      // (they still exist in the editor, just aren't part of a numbered scene)
    }

    // Push the last scene
    if (currentScene) {
      scenes.push(currentScene)
    }
  })

  return scenes
}

// ─── Scroll the editor to a specific node ───

function scrollToNode(editor: LexicalEditor, nodeKey: string) {
  const domElement = editor.getElementByKey(nodeKey)
  if (domElement) {
    domElement.scrollIntoView({ behavior: 'smooth', block: 'center' })

    // Flash highlight
    domElement.style.transition = 'background 0.2s'
    domElement.style.background = 'rgba(99, 102, 241, 0.12)'
    setTimeout(() => {
      domElement.style.background = ''
    }, 800)
  }
}

// ─── Reorder scenes in the Lexical tree ───
//
// Moves the scene at oldIndex to newIndex. A "scene" is the heading node
// plus every following node until the next heading. We collect all those
// nodes, remove them, and re-insert them at the correct position.

function reorderScenes(
  editor: LexicalEditor,
  scenes: SceneItem[],
  oldIndex: number,
  newIndex: number
) {
  editor.update(() => {
    const root = $getRoot()

    // Collect every node key grouped by scene
    const sceneNodeGroups: LexicalNode[][] = scenes.map((scene) =>
      scene.nodeKeys
        .map((key) => {
          const node = root.getChildren().find((c) => c.getKey() === key)
          return node
        })
        .filter(Boolean) as LexicalNode[]
    )

    // Collect any orphan nodes before the first scene heading
    const allSceneKeys = new Set(scenes.flatMap((s) => s.nodeKeys))
    const orphansBefore: LexicalNode[] = []
    for (const child of root.getChildren()) {
      if (allSceneKeys.has(child.getKey())) break
      orphansBefore.push(child)
    }

    // Build the new order
    const reordered = [...sceneNodeGroups]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved)

    // Clear the root and re-append in order
    root.clear()

    // Re-add orphans first
    for (const node of orphansBefore) {
      root.append(node)
    }

    // Re-add scenes in new order
    for (const group of reordered) {
      for (const node of group) {
        root.append(node)
      }
    }
  })
}

// ─── INT/EXT badge color ───

function prefixColor(prefix: string): string {
  const p = prefix.toUpperCase()
  if (p.startsWith('INT') && p.includes('EXT')) return '#c084fc' // purple for both
  if (p.startsWith('INT')) return '#60a5fa' // blue for interior
  if (p.startsWith('EXT')) return '#34d399' // green for exterior
  return 'rgba(255,255,255,0.3)'
}

// ─── SceneNavigator Component ───

export default function SceneNavigator({
  pageCount,
  onClose,
}: {
  pageCount: number
  onClose: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const [scenes, setScenes] = useState<SceneItem[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Extract scenes on editor changes (debounced)
  const refresh = useCallback(() => {
    setScenes(extractScenes(editor))
  }, [editor])

  useEffect(() => {
    refresh()

    return editor.registerUpdateListener(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(refresh, 200)
    })
  }, [editor, refresh])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // Handle click → scroll to scene
  const handleClick = useCallback(
    (key: string) => {
      scrollToNode(editor, key)

      // Also place the cursor at the start of the scene heading
      editor.update(() => {
        const root = $getRoot()
        const node = root
          .getChildren()
          .find((c) => c.getKey() === key) as ElementNode | undefined
        if (node) {
          node.selectStart()
        }
      })
    },
    [editor]
  )

  // Handle drag end → reorder
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return
      const oldIndex = result.source.index
      const newIndex = result.destination.index
      if (oldIndex === newIndex) return

      reorderScenes(editor, scenes, oldIndex, newIndex)
    },
    [editor, scenes]
  )

  return (
    <div className="scene-navigator">
      {/* Header */}
      <div className="scene-navigator-header">
        <span className="scene-navigator-title">Scenes</span>
        <button
          className="scene-navigator-close"
          onClick={onClose}
          title="Close scene navigator"
        >
          &times;
        </button>
      </div>

      {/* Scene list */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="scene-list">
          {(provided) => (
            <div
              className="scene-navigator-list"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {scenes.length === 0 && (
                <div className="scene-navigator-empty">
                  No scenes yet. Start with a scene heading.
                </div>
              )}

              {scenes.map((scene, index) => (
                <Draggable
                  key={scene.key}
                  draggableId={scene.key}
                  index={index}
                >
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`scene-navigator-item${
                        snapshot.isDragging
                          ? ' scene-navigator-item-dragging'
                          : ''
                      }`}
                      onClick={() => handleClick(scene.key)}
                    >
                      {/* Drag handle */}
                      <div
                        className="scene-navigator-drag-handle"
                        {...provided.dragHandleProps}
                        title="Drag to reorder"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <circle cx="4" cy="2.5" r="1" />
                          <circle cx="8" cy="2.5" r="1" />
                          <circle cx="4" cy="6" r="1" />
                          <circle cx="8" cy="6" r="1" />
                          <circle cx="4" cy="9.5" r="1" />
                          <circle cx="8" cy="9.5" r="1" />
                        </svg>
                      </div>

                      {/* Scene number */}
                      <span className="scene-navigator-number">
                        {scene.number}
                      </span>

                      {/* INT/EXT badge */}
                      {scene.prefix && (
                        <span
                          className="scene-navigator-badge"
                          style={{ color: prefixColor(scene.prefix) }}
                        >
                          {scene.prefix.replace('.', '')}
                        </span>
                      )}

                      {/* Location */}
                      <span className="scene-navigator-location">
                        {scene.location}
                      </span>
                    </div>
                  )}
                </Draggable>
              ))}

              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* Footer stats */}
      <div className="scene-navigator-footer">
        <span>
          {scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}
        </span>
        <span>
          ~{pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </span>
      </div>
    </div>
  )
}
