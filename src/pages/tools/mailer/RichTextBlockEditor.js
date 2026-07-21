import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Link2 } from 'lucide-react';
import { colors } from '../../../lib/styleTokens';

// Tiptap WYSIWYG editor for the rich-text block. The HTML output is
// stored on block.html and consumed verbatim by the renderer. Tiptap's
// default output uses semantic tags (p/strong/em/ul/ol/a) which most
// email clients render well — fancier formatting (tables, columns) is
// handled by their own block types instead.

export default function RichTextBlockEditor({ html, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Drop heading from rich-text — separate "Heading" block exists.
        heading: false,
      }),
    ],
    content: html || '<p></p>',
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // Update editor content when block.html changes externally
  // (e.g. user undoes via parent state).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== (html || '<p></p>')) {
      editor.commands.setContent(html || '<p></p>', false);
    }
    // eslint-disable-next-line
  }, [html, !!editor]);

  if (!editor) return null;

  function addLink() {
    const prev = editor.getAttributes('link').href || '';
    // eslint-disable-next-line no-alert
    const url = window.prompt('URL', prev);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetMark('link').run();
      return;
    }
    // Use starter-kit's link extension if available; otherwise insert raw text.
    if (editor.commands.setMark) {
      try {
        editor.chain().focus().extendMarkRange('link').setMark('link', { href: url, target: '_blank' }).run();
      } catch {
        // Link extension not loaded — fall through to plain insert.
        editor.chain().focus().insertContent(url).run();
      }
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          style={{ ...styles.tbBtn, ...(editor.isActive('bold') ? styles.tbBtnActive : {}) }}
          title="Bold"
        >
          <Bold size={13} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          style={{ ...styles.tbBtn, ...(editor.isActive('italic') ? styles.tbBtnActive : {}) }}
          title="Italic"
        >
          <Italic size={13} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          style={{ ...styles.tbBtn, ...(editor.isActive('bulletList') ? styles.tbBtnActive : {}) }}
          title="Bullet list"
        >
          <List size={13} />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          style={{ ...styles.tbBtn, ...(editor.isActive('orderedList') ? styles.tbBtnActive : {}) }}
          title="Ordered list"
        >
          <ListOrdered size={13} />
        </button>
        <button onClick={addLink} style={styles.tbBtn} title="Link">
          <Link2 size={13} />
        </button>
      </div>
      <div style={styles.editorWrap}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    background: 'rgba(0,0,0,0.25)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex', gap: 2,
    padding: 4, borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(0,0,0,0.2)',
  },
  tbBtn: {
    background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.65)', borderRadius: 4,
    width: 26, height: 26, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'inherit',
  },
  tbBtnActive: { background: colors.accentA25, color: colors.accentFgSoft },
  editorWrap: {
    padding: 8, minHeight: 100, color: '#fff', fontSize: 13,
  },
};
