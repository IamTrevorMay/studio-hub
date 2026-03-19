import '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, FontFamily, FontSize, LineHeight } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table'
import { TableHeader } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Superscript from '@tiptap/extension-superscript'
import Subscript from '@tiptap/extension-subscript'
import Typography from '@tiptap/extension-typography'
import CharacterCount from '@tiptap/extension-character-count'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Mark, mergeAttributes, Node } from '@tiptap/core'
import { Extension } from '@tiptap/core'
import { SearchHighlight } from './search-highlight'

const lowlight = createLowlight(common)

/**
 * Custom CommentMark extension — matches existing DocEditor.js exactly.
 */
export const CommentMark = Mark.create({
  name: 'comment',

  addAttributes() {
    return {
      commentId: { default: null },
      author: { default: null },
      text: { default: null },
      createdAt: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-comment': '',
        style: 'background:rgba(251,191,36,0.25);border-bottom:2px solid rgba(251,191,36,0.5);',
      }),
      0,
    ]
  },
})

/**
 * Custom Indent extension — matches existing DocEditor.js exactly.
 */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => parseInt(element.style.marginLeft || '0') / 40 || 0,
            renderHTML: (attributes) => {
              if (!attributes.indent) return {}
              return { style: `margin-left: ${attributes.indent * 40}px` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      indent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state
          const { from, to } = selection
          let changed = false
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              const currentIndent = node.attrs.indent || 0
              if (currentIndent < 10) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentIndent + 1,
                  })
                }
                changed = true
              }
            }
          })
          return changed
        },

      outdent:
        () =>
        ({ tr, state, dispatch }) => {
          const { selection } = state
          const { from, to } = selection
          let changed = false
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name === 'paragraph' || node.type.name === 'heading') {
              const currentIndent = node.attrs.indent || 0
              if (currentIndent > 0) {
                if (dispatch) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    indent: currentIndent - 1,
                  })
                }
                changed = true
              }
            }
          })
          return changed
        },
    }
  },
})

/**
 * Resizable image extension — extends built-in Image with width/height attributes.
 */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.getAttribute('width') || el.style.width || null,
        renderHTML: (attrs) => {
          if (!attrs.width) return {}
          return { width: attrs.width, style: `width: ${attrs.width}` }
        },
      },
      height: {
        default: null,
        parseHTML: (el) => el.getAttribute('height') || el.style.height || null,
        renderHTML: (attrs) => {
          if (!attrs.height) return {}
          return { height: attrs.height }
        },
      },
    }
  },
})

/**
 * All editor extensions configured to match existing DocEditor.js behavior.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false, // replaced by CodeBlockLowlight
  }),
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  ResizableImage.configure({ inline: false, allowBase64: true }),
  Link.configure({ openOnClick: false, autolink: true }),
  Placeholder.configure({ placeholder: 'Start writing...' }),
  TextStyle,
  FontFamily,
  FontSize,
  LineHeight,
  Color,
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableCell,
  TableHeader,
  TaskList,
  TaskItem.configure({ nested: true }),
  Superscript,
  Subscript,
  Typography,
  CharacterCount,
  CodeBlockLowlight.configure({ lowlight }),
  CommentMark,
  Indent,
  SearchHighlight,
]
