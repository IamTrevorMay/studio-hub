import type { EditorThemeClasses } from 'lexical'

export const screenplayTheme: EditorThemeClasses = {
  root: 'screenplay-root',
  paragraph: 'screenplay-paragraph',
  text: {
    bold: 'screenplay-bold',
    italic: 'screenplay-italic',
    underline: 'screenplay-underline',
  },
  // Lexical doesn't use these directly for our custom nodes,
  // but they're available if we add paragraph-based fallback
}
