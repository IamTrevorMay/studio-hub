import {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
  type ElementNode,
} from 'lexical'
import { $isSceneHeadingNode } from '../../nodes/SceneHeadingNode'
import { $isCharacterNode } from '../../nodes/CharacterNode'
import { $isTransitionNode } from '../../nodes/TransitionNode'
import type { ScriptElementType } from '../../types'

// ─── Standard transition suggestions ───
const TRANSITION_SUGGESTIONS = [
  'CUT TO:',
  'FADE IN:',
  'FADE OUT.',
  'FADE TO BLACK.',
  'DISSOLVE TO:',
  'SMASH CUT TO:',
  'MATCH CUT TO:',
  'JUMP CUT TO:',
  'INTERCUT:',
  'TIME CUT:',
  'WIPE TO:',
]

// ─── Scene heading prefixes ───
const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'I/E. ']

// ─── Time of day suffixes ───
const TIMES_OF_DAY = [
  'DAY',
  'NIGHT',
  'DAWN',
  'DUSK',
  'MORNING',
  'AFTERNOON',
  'EVENING',
  'CONTINUOUS',
  'LATER',
  'MOMENTS LATER',
]

// ─── Get element type from a node ───
function getNodeType(node: LexicalNode): ScriptElementType | null {
  if ($isSceneHeadingNode(node)) return 'scene-heading'
  if ($isCharacterNode(node)) return 'character'
  if ($isTransitionNode(node)) return 'transition'
  return null
}

// ─── Extract all unique character names from the editor ───
function collectCharacterNames(root: LexicalNode): string[] {
  const names = new Set<string>()
  const children = (root as ElementNode).getChildren()
  for (const child of children) {
    if ($isCharacterNode(child)) {
      const text = child.getTextContent().trim().toUpperCase()
      if (text) {
        // Strip (V.O.), (O.S.), (CONT'D) etc. for the base name
        const baseName = text.replace(/\s*\(.*?\)\s*$/, '').trim()
        if (baseName) names.add(baseName)
      }
    }
  }
  return Array.from(names).sort()
}

// ─── Extract all unique scene locations from the editor ───
function collectSceneLocations(root: LexicalNode): string[] {
  const locations = new Set<string>()
  const children = (root as ElementNode).getChildren()
  for (const child of children) {
    if ($isSceneHeadingNode(child)) {
      const text = child.getTextContent().trim().toUpperCase()
      if (text) locations.add(text)
    }
  }
  return Array.from(locations).sort()
}

// ─── Compute suggestions based on element type and current text ───
function getSuggestions(
  type: ScriptElementType | null,
  text: string,
  characterNames: string[],
  sceneLocations: string[]
): string[] {
  if (!type) return []
  const upper = text.toUpperCase()

  if (type === 'scene-heading') {
    // If empty or just starting, suggest prefixes
    if (text.length === 0) {
      return SCENE_PREFIXES
    }

    // If typing matches a prefix partially, suggest matching prefixes
    const prefixMatches = SCENE_PREFIXES.filter(
      (p) => p.startsWith(upper) && p !== upper
    )

    // If we already have a prefix (INT./EXT.), suggest known locations
    const hasPrefix = SCENE_PREFIXES.some(
      (p) => upper.startsWith(p.trimEnd())
    )

    if (hasPrefix) {
      // Extract the part after the prefix for filtering
      const matchingLocations = sceneLocations.filter(
        (loc) => loc.startsWith(upper) && loc !== upper
      )

      // Also check if we have a location but no time of day
      // Pattern: INT. LOCATION - (suggest TIME)
      if (upper.includes(' - ') || upper.endsWith(' -') || upper.endsWith(' - ')) {
        const base = upper.endsWith(' -') ? upper + ' ' : upper
        const timeSuggestions = TIMES_OF_DAY.map((t) => {
          // Find the dash position and build the full suggestion
          const dashIdx = base.lastIndexOf('-')
          const beforeDash = base.substring(0, dashIdx + 1).trim()
          return `${beforeDash} ${t}`
        }).filter((s) => s.startsWith(upper) && s !== upper)
        return [...timeSuggestions, ...matchingLocations].slice(0, 8)
      }

      return [...prefixMatches, ...matchingLocations].slice(0, 8)
    }

    return prefixMatches.slice(0, 8)
  }

  if (type === 'character') {
    if (text.length === 0) {
      // Show all known characters when empty
      return characterNames.slice(0, 8)
    }
    // Filter by what's typed so far
    return characterNames
      .filter((name) => name.startsWith(upper) && name !== upper)
      .slice(0, 8)
  }

  if (type === 'transition') {
    if (text.length === 0) {
      return TRANSITION_SUGGESTIONS
    }
    return TRANSITION_SUGGESTIONS.filter(
      (t) => t.startsWith(upper) && t !== upper
    ).slice(0, 8)
  }

  return []
}

// ─── Floating dropdown portal ───
function AutocompleteDropdown({
  items,
  selectedIndex,
  anchorRect,
  onSelect,
  onHover,
}: {
  items: string[]
  selectedIndex: number
  anchorRect: DOMRect | null
  onSelect: (item: string) => void
  onHover: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!anchorRect || items.length === 0) return null

  // Position below the current line
  const style: React.CSSProperties = {
    position: 'fixed',
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
    zIndex: 9999,
  }

  // If dropdown would go off bottom of screen, show above
  const spaceBelow = window.innerHeight - anchorRect.bottom
  if (spaceBelow < 200) {
    style.top = anchorRect.top - 4
    style.transform = 'translateY(-100%)'
  }

  return createPortal(
    <div className="screenplay-autocomplete" style={style}>
      <div ref={listRef} className="screenplay-autocomplete-list">
        {items.map((item, i) => (
          <div
            key={item}
            className={`screenplay-autocomplete-item${
              i === selectedIndex ? ' screenplay-autocomplete-item-active' : ''
            }`}
            onMouseDown={(e) => {
              e.preventDefault() // Don't steal focus from editor
              onSelect(item)
            }}
            onMouseEnter={() => onHover(i)}
          >
            {item}
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}

// ─── Main autocomplete plugin ───
export default function AutocompletePlugin() {
  const [editor] = useLexicalComposerContext()
  const [items, setItems] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const isOpenRef = useRef(false)

  // Keep refs in sync so command handlers see current values
  const itemsRef = useRef(items)
  const selectedIndexRef = useRef(selectedIndex)
  useEffect(() => {
    itemsRef.current = items
    isOpenRef.current = items.length > 0
  }, [items])
  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])

  // ─── Accept a suggestion ───
  const acceptSuggestion = useCallback(
    (text: string) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return

        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block) return

        // Clear the block's text content and replace with suggestion
        const children = (block as ElementNode).getChildren()
        children.forEach((child) => child.remove())
        const textNode = $createTextNode(text)
        ;(block as ElementNode).append(textNode)
        textNode.selectEnd()
      })
      setItems([])
      setSelectedIndex(0)
      setAnchorRect(null)
    },
    [editor]
  )

  // ─── Dismiss the dropdown ───
  const dismiss = useCallback(() => {
    setItems([])
    setSelectedIndex(0)
    setAnchorRect(null)
  }, [])

  // ─── Listen for text changes → compute suggestions ───
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          dismiss()
          return
        }

        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block) {
          dismiss()
          return
        }

        const type = getNodeType(block)
        if (!type) {
          dismiss()
          return
        }

        const text = block.getTextContent()
        const root = $getRoot()
        const characterNames = collectCharacterNames(root)
        const sceneLocations = collectSceneLocations(root)

        const suggestions = getSuggestions(
          type,
          text,
          characterNames,
          sceneLocations
        )

        if (suggestions.length === 0) {
          dismiss()
          return
        }

        setItems(suggestions)
        setSelectedIndex(0)

        // Get DOM rect for the current block element to position dropdown
        const blockKey = block.getKey()
        const domElement = editor.getElementByKey(blockKey)
        if (domElement) {
          setAnchorRect(domElement.getBoundingClientRect())
        }
      })
    })
  }, [editor, dismiss])

  // ─── Keyboard commands: Arrow up/down, Enter, Tab, Escape ───
  useEffect(() => {
    const removeDown = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (event) => {
        if (!isOpenRef.current) return false
        if (event) event.preventDefault()
        setSelectedIndex((prev) =>
          Math.min(prev + 1, itemsRef.current.length - 1)
        )
        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    const removeUp = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        if (!isOpenRef.current) return false
        if (event) event.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    // Intercept Enter when autocomplete is open
    const removeEnter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (_event) => {
        if (!isOpenRef.current) return false
        const currentItems = itemsRef.current
        const idx = selectedIndexRef.current
        if (currentItems[idx]) {
          acceptSuggestion(currentItems[idx])
          return true
        }
        return false
      },
      // Must be higher than the screenplay key plugin (both use HIGH,
      // so we register this one to run first by using a slightly higher value)
      COMMAND_PRIORITY_CRITICAL
    )

    // Also accept on Tab
    const removeTab = editor.registerCommand(
      KEY_TAB_COMMAND,
      (_event) => {
        if (!isOpenRef.current) return false
        const currentItems = itemsRef.current
        const idx = selectedIndexRef.current
        if (currentItems[idx]) {
          acceptSuggestion(currentItems[idx])
          return true
        }
        return false
      },
      COMMAND_PRIORITY_CRITICAL
    )

    const removeEscape = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!isOpenRef.current) return false
        dismiss()
        return true
      },
      COMMAND_PRIORITY_HIGH
    )

    return () => {
      removeDown()
      removeUp()
      removeEnter()
      removeTab()
      removeEscape()
    }
  }, [editor, acceptSuggestion, dismiss])

  // ─── Close on click outside ───
  useEffect(() => {
    if (!isOpenRef.current) return

    const handleClick = () => dismiss()
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [items, dismiss])

  return (
    <AutocompleteDropdown
      items={items}
      selectedIndex={selectedIndex}
      anchorRect={anchorRect}
      onSelect={acceptSuggestion}
      onHover={setSelectedIndex}
    />
  )
}
