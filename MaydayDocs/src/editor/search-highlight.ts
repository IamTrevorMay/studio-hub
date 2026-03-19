import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface SearchHighlightStorage {
  searchTerm: string
  matchCase: boolean
  wholeWord: boolean
  currentIndex: number
}

const pluginKey = new PluginKey('searchHighlight')

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addStorage() {
    return {
      searchTerm: '',
      matchCase: false,
      wholeWord: false,
      currentIndex: 0,
    } as SearchHighlightStorage
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldSet) {
            const storage = extension.storage as SearchHighlightStorage
            const { searchTerm, matchCase, wholeWord, currentIndex } = storage

            if (!searchTerm) return DecorationSet.empty

            const decorations: Decoration[] = []
            let matchIdx = 0

            tr.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return

              const text = node.text
              const searchStr = matchCase ? searchTerm : searchTerm.toLowerCase()
              const haystack = matchCase ? text : text.toLowerCase()

              let startIndex = 0
              while (startIndex < haystack.length) {
                const idx = haystack.indexOf(searchStr, startIndex)
                if (idx === -1) break

                if (wholeWord) {
                  const before = idx > 0 ? text[idx - 1] : ' '
                  const after = idx + searchTerm.length < text.length ? text[idx + searchTerm.length] : ' '
                  if (/\w/.test(before) || /\w/.test(after)) {
                    startIndex = idx + 1
                    continue
                  }
                }

                const from = pos + idx
                const to = from + searchTerm.length
                const isActive = matchIdx === currentIndex

                decorations.push(
                  Decoration.inline(from, to, {
                    class: isActive ? 'search-match search-match-active' : 'search-match',
                  })
                )

                matchIdx++
                startIndex = idx + 1
              }
            })

            return DecorationSet.create(tr.doc, decorations)
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state)
          },
        },
      }),
    ]
  },
})
