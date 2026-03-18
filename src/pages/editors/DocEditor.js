import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { Link } from '@tiptap/extension-link';
import { Mark, mergeAttributes, Extension } from '@tiptap/core';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

/* ─── Custom Extensions ─────────────────────────────────────────── */

const CommentMark = Mark.create({
  name: 'comment',
  addAttributes() {
    return {
      commentId: { default: null },
      author: { default: '' },
      text: { default: '' },
      createdAt: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-comment': HTMLAttributes.commentId,
      'data-comment-author': HTMLAttributes.author,
      'data-comment-text': HTMLAttributes.text,
      'data-comment-created': HTMLAttributes.createdAt,
      style: 'background: rgba(251,191,36,0.25); border-bottom: 2px solid rgba(251,191,36,0.5); cursor: pointer; position: relative;',
    }), 0];
  },
});

// Indent — manages margin-left in 40px increments for paragraphs
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: el => {
            const ml = parseInt(el.style.marginLeft, 10);
            return ml ? Math.round(ml / 40) : 0;
          },
          renderHTML: attrs => {
            if (!attrs.indent || attrs.indent <= 0) return {};
            return { style: `margin-left: ${attrs.indent * 40}px` };
          },
        },
      },
    }];
  },
  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const cur = node.attrs.indent || 0;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.min(cur + 1, 10) });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      outdent: () => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') {
            const cur = node.attrs.indent || 0;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: Math.max(cur - 1, 0) });
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
});

/* ─── Color Picker Popover ──────────────────────────────────────── */

const PRESET_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
];

function ColorPickerPopover({ onSelect, onClose, currentColor }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={popStyles.colorPopover}>
      <div style={popStyles.colorGrid}>
        {PRESET_COLORS.map(c => (
          <button key={c} onClick={() => { onSelect(c); onClose(); }} style={{
            ...popStyles.colorSwatch,
            background: c,
            border: c === '#ffffff' ? '1px solid #dadce0' : c === currentColor ? '2px solid #1a73e8' : '1px solid transparent',
          }} />
        ))}
      </div>
      <div style={popStyles.customRow}>
        <span style={popStyles.customLabel}>Custom:</span>
        <input type="color" value={currentColor || '#000000'} onChange={(e) => { onSelect(e.target.value); onClose(); }} style={popStyles.customInput} />
      </div>
    </div>
  );
}

/* ─── Table Insert Grid ─────────────────────────────────────────── */

function TableInsertGrid({ onInsert, onClose }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} style={popStyles.tablePopover}>
      <div style={popStyles.tableLabel}>{hover.r}x{hover.c} table</div>
      <div style={popStyles.tableGrid}>
        {Array.from({ length: 8 }, (_, r) => (
          <div key={r} style={{ display: 'flex' }}>
            {Array.from({ length: 8 }, (_, c) => (
              <div key={c}
                onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
                onClick={() => { onInsert(hover.r, hover.c); onClose(); }}
                style={{
                  width: 20, height: 20, border: '1px solid #dadce0', margin: 1, cursor: 'pointer',
                  background: (r < hover.r && c < hover.c) ? 'rgba(26,115,232,0.3)' : '#fff',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main DocEditor ────────────────────────────────────────────── */

export default function DocEditor({ docId, title, docType, onBack, onSaveTemplate }) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [hoveredComment, setHoveredComment] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(100);
  const [pageCount, setPageCount] = useState(1);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [showTextColor, setShowTextColor] = useState(false);
  const [showHighlightColor, setShowHighlightColor] = useState(false);
  const [showTableGrid, setShowTableGrid] = useState(false);
  const commentInputRef = useRef(null);
  const editorWrapRef = useRef(null);
  const pageRef = useRef(null);
  const contentObserverRef = useRef(null);

  const TABLE_MAP = { resource_documents: 'resource_documents', show_documents: 'show_documents' };
  const tableName = TABLE_MAP[docType] || 'concept_documents';

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      TextStyleKit.configure({
        textStyle: true,
        color: true,
        fontFamily: true,
        fontSize: true,
        lineHeight: true,
      }),
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      Subscript,
      Superscript,
      Link.configure({ openOnClick: false }),
      CommentMark,
      Indent,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'doc-editor-content',
      },
      handleDOMEvents: {
        mouseover: (view, event) => {
          const el = event.target.closest('[data-comment]');
          if (el) {
            const rect = el.getBoundingClientRect();
            const wrapRect = editorWrapRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
            setHoveredComment({
              id: el.getAttribute('data-comment'),
              author: el.getAttribute('data-comment-author'),
              text: el.getAttribute('data-comment-text'),
              createdAt: el.getAttribute('data-comment-created'),
            });
            setTooltipPos({
              x: rect.left - wrapRect.left + rect.width / 2,
              y: rect.top - wrapRect.top - 8,
            });
          } else {
            setHoveredComment(null);
          }
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.state.doc.textContent;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setWordCount(words);
      setCharCount(text.length);
    },
  });

  // Load document
  useEffect(() => {
    if (!editor) return;
    (async () => {
      const { data } = await supabase.from(tableName).select('content').eq('id', docId).single();
      if (data?.content?.html && editor) {
        editor.commands.setContent(data.content.html);
      }
      setLoaded(true);
    })();
  }, [docId, editor, tableName]);

  // Auto-save (2s debounce)
  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    const html = editor.getHTML();
    await supabase.from(tableName)
      .update({ content: { html }, updated_at: new Date().toISOString() })
      .eq('id', docId);
    setSaving(false);
  }, [editor, docId, tableName]);

  useEffect(() => {
    if (!editor || !loaded) return;
    const handler = () => {
      clearTimeout(window._docSaveTimer);
      window._docSaveTimer = setTimeout(save, 2000);
    };
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
      clearTimeout(window._docSaveTimer);
    };
  }, [editor, loaded, save]);

  // Page dimensions
  const PAGE_HEIGHT = 1056; // 11" at 96dpi
  const PAGE_GAP = 16;     // visual gap between pages

  // Page counting via ResizeObserver on the editor DOM element
  useEffect(() => {
    if (!editor) return;
    const editorEl = editor.view.dom;
    const obs = new ResizeObserver(() => {
      const contentH = editorEl.scrollHeight;
      const totalH = contentH + 192; // add padding (96 top + 96 bottom)
      setPageCount(Math.max(1, Math.ceil(totalH / PAGE_HEIGHT)));
    });
    obs.observe(editorEl);
    contentObserverRef.current = obs;
    return () => obs.disconnect();
  }, [editor]);

  // Comments
  function handleAddComment() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) { alert('Select some text first to add a comment.'); return; }
    setShowCommentInput(true);
    setCommentText('');
    setTimeout(() => commentInputRef.current?.focus(), 50);
  }

  function submitComment() {
    if (!editor || !commentText.trim()) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    editor.chain().focus().setMark('comment', {
      commentId: Date.now().toString(),
      author: profile?.full_name || 'Unknown',
      text: commentText.trim(),
      createdAt: new Date().toISOString(),
    }).run();
    setCommentText('');
    setShowCommentInput(false);
  }

  function removeComment() {
    if (!editor || !hoveredComment) return;
    const { doc, tr } = editor.state;
    let found = false;
    doc.descendants((node, pos) => {
      if (found) return false;
      node.marks.forEach(mark => {
        if (mark.type.name === 'comment' && mark.attrs.commentId === hoveredComment.id) {
          tr.removeMark(pos, pos + node.nodeSize, mark.type);
          found = true;
        }
      });
    });
    if (found) { editor.view.dispatch(tr); setHoveredComment(null); }
  }

  // Image upload
  async function handleImageUpload() {
    if (!editor) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop();
      const filePath = `${docId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('doc-images').upload(filePath, file);
      if (error) { alert('Image upload failed.'); return; }
      const { data } = supabase.storage.from('doc-images').getPublicUrl(filePath);
      if (data?.publicUrl) {
        editor.chain().focus().setImage({ src: data.publicUrl }).run();
      }
    };
    input.click();
  }

  // Link
  function handleInsertLink() {
    if (!editor) return;
    const prev = editor.getAttributes('link').href;
    const url = prompt('Enter URL:', prev || 'https://');
    if (url === null) return;
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  // DOCX Export
  async function handleExportDocx() {
    if (!editor) return;
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TableRow: DocxRow, TableCell: DocxCell, Table: DocxTable, WidthType, BorderStyle } = await import('docx');
      const html = editor.getHTML();
      const parser = new DOMParser();
      const parsed = parser.parseFromString(html, 'text/html');
      const children = [];

      function getAlign(el) {
        const ta = el.style?.textAlign;
        if (ta === 'center') return AlignmentType.CENTER;
        if (ta === 'right') return AlignmentType.RIGHT;
        if (ta === 'justify') return AlignmentType.JUSTIFIED;
        return undefined;
      }

      function processNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return [new TextRun({ text: node.textContent })];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return [];
        const tag = node.tagName.toLowerCase();
        const runs = [];
        for (const child of node.childNodes) {
          const childRuns = processNode(child);
          childRuns.forEach(run => {
            if (tag === 'strong' || tag === 'b') run.bold = true;
            if (tag === 'em' || tag === 'i') run.italics = true;
            if (tag === 'u') run.underline = {};
            if (tag === 's') run.strike = true;
            if (tag === 'sub') run.subScript = true;
            if (tag === 'sup') run.superScript = true;
            // Inline color
            const color = node.style?.color;
            if (color && tag === 'span') {
              try {
                const temp = document.createElement('div');
                temp.style.color = color;
                document.body.appendChild(temp);
                const computed = getComputedStyle(temp).color;
                document.body.removeChild(temp);
                const match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (match) {
                  const hex = [match[1], match[2], match[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
                  run.color = hex;
                }
              } catch (e) { /* skip */ }
            }
            // Font family
            const ff = node.style?.fontFamily;
            if (ff && tag === 'span') run.font = { name: ff.replace(/['"]/g, '').split(',')[0].trim() };
            // Font size
            const fs = node.style?.fontSize;
            if (fs && tag === 'span') {
              const pt = parseFloat(fs);
              if (pt) run.size = pt * 2; // docx uses half-points
            }
          });
          runs.push(...childRuns);
        }
        return runs;
      }

      function processTopLevel(child) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          children.push(new Paragraph({ children: [new TextRun(child.textContent)] }));
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) return;
        const tag = child.tagName.toLowerCase();
        const runs = processNode(child);
        const alignment = getAlign(child);
        if (tag === 'h1') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_1, alignment }));
        else if (tag === 'h2') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_2, alignment }));
        else if (tag === 'h3') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_3, alignment }));
        else if (tag === 'ul' || tag === 'ol') {
          for (const li of child.querySelectorAll('li')) {
            children.push(new Paragraph({
              children: processNode(li),
              bullet: tag === 'ul' ? { level: 0 } : undefined,
              numbering: tag === 'ol' ? { reference: 'default-numbering', level: 0 } : undefined,
            }));
          }
        } else if (tag === 'table') {
          const rows = [];
          for (const tr of child.querySelectorAll('tr')) {
            const cells = [];
            for (const td of tr.querySelectorAll('td, th')) {
              cells.push(new DocxCell({ children: [new Paragraph({ children: processNode(td) })] }));
            }
            if (cells.length) rows.push(new DocxRow({ children: cells }));
          }
          if (rows.length) {
            children.push(new DocxTable({
              rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
                left: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
                right: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
                insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'dadce0' },
              },
            }));
          }
        } else if (tag === 'blockquote') {
          children.push(new Paragraph({ children: processNode(child), indent: { left: 720 } }));
        } else {
          children.push(runs.length > 0 ? new Paragraph({ children: runs, alignment }) : new Paragraph({}));
        }
      }

      for (const child of parsed.body.childNodes) processTopLevel(child);

      const docx = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(docx);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'document'}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed. Make sure the docx package is installed.');
    }
  }

  // Zoom
  const zoomIn = () => setZoom(z => Math.min(z + 10, 200));
  const zoomOut = () => setZoom(z => Math.max(z - 10, 50));

  // Current font attrs for toolbar display
  const currentFontFamily = editor?.getAttributes('textStyle')?.fontFamily || 'Arial';
  const currentFontSize = editor?.getAttributes('textStyle')?.fontSize || '11pt';
  const currentTextColor = editor?.getAttributes('textStyle')?.color || '#000000';

  if (!editor) return null;

  const totalPageHeight = pageCount * PAGE_HEIGHT + Math.max(0, pageCount - 1) * PAGE_GAP;

  return (
    <div style={styles.page}>
      {/* Row 1: Action Bar */}
      <div style={styles.actionBar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.titleText}>{title}</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleAddComment} style={styles.commentBtn}>Comment</button>
        <button onClick={handleExportDocx} style={styles.exportBtn}>Export .docx</button>
        <button onClick={save} style={styles.saveBtn}>{saving ? 'Saving...' : 'Save'}</button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name && editor) onSaveTemplate(name, 'document', { html: editor.getHTML() });
        }} style={styles.templateBtn}>Save as Template</button>
      </div>

      {/* Row 2: Formatting Bar */}
      <div style={styles.formatBar}>
        {/* Undo/Redo */}
        <div style={styles.fGroup}>
          <FmtBtn onClick={() => editor.chain().focus().undo().run()} title="Undo" label="↩" />
          <FmtBtn onClick={() => editor.chain().focus().redo().run()} title="Redo" label="↪" />
        </div>

        <div style={styles.fSep} />

        {/* Font Family */}
        <select value={currentFontFamily} onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()} style={styles.selectDropdown} title="Font">
          {['Arial', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Garamond'].map(f => (
            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
          ))}
        </select>

        <div style={styles.fSep} />

        {/* Font Size */}
        <select value={currentFontSize.replace('pt', '')} onChange={(e) => editor.chain().focus().setFontSize(`${e.target.value}pt`).run()} style={{ ...styles.selectDropdown, width: 56 }} title="Font size">
          {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <div style={styles.fSep} />

        {/* Inline: B I U S */}
        <div style={styles.fGroup}>
          <FmtBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="B" title="Bold" extraStyle={{ fontWeight: 700 }} />
          <FmtBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" title="Italic" extraStyle={{ fontStyle: 'italic' }} />
          <FmtBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} label="U" title="Underline" extraStyle={{ textDecoration: 'underline' }} />
          <FmtBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" title="Strikethrough" extraStyle={{ textDecoration: 'line-through' }} />
        </div>

        <div style={styles.fSep} />

        {/* Text Color */}
        <div style={{ position: 'relative' }}>
          <FmtBtn onClick={() => { setShowTextColor(!showTextColor); setShowHighlightColor(false); setShowTableGrid(false); }}
            title="Text color"
            label={<span style={{ borderBottom: `3px solid ${currentTextColor}`, paddingBottom: 1 }}>A</span>}
          />
          {showTextColor && (
            <ColorPickerPopover currentColor={currentTextColor} onSelect={(c) => editor.chain().focus().setColor(c).run()} onClose={() => setShowTextColor(false)} />
          )}
        </div>

        {/* Highlight */}
        <div style={{ position: 'relative' }}>
          <FmtBtn onClick={() => { setShowHighlightColor(!showHighlightColor); setShowTextColor(false); setShowTableGrid(false); }}
            title="Highlight color"
            label={<span style={{ background: '#fef08a', padding: '0 3px', borderRadius: 2, color: '#000', fontSize: 11, fontWeight: 700 }}>ab</span>}
          />
          {showHighlightColor && (
            <ColorPickerPopover currentColor="#fef08a" onSelect={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()} onClose={() => setShowHighlightColor(false)} />
          )}
        </div>

        <div style={styles.fSep} />

        {/* Link */}
        <FmtBtn onClick={handleInsertLink} active={editor.isActive('link')} title="Insert link" label="🔗" />

        {/* Image */}
        <FmtBtn onClick={handleImageUpload} title="Insert image" label="🖼" />

        <div style={styles.fSep} />

        {/* Alignment */}
        <div style={styles.fGroup}>
          <FmtBtn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Left" label="⫷" />
          <FmtBtn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Center" label="≡" />
          <FmtBtn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Right" label="⫸" />
          <FmtBtn active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()} title="Justify" label="☰" />
        </div>

        <div style={styles.fSep} />

        {/* Line Spacing */}
        <select value="1.15" onChange={(e) => editor.chain().focus().setLineHeight(e.target.value).run()} style={{ ...styles.selectDropdown, width: 56 }} title="Line spacing">
          {[['1.0', '1'], ['1.15', '1.15'], ['1.5', '1.5'], ['2.0', '2']].map(([label, val]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <div style={styles.fSep} />

        {/* Lists */}
        <div style={styles.fGroup}>
          <FmtBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list" label="•" />
          <FmtBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list" label="1." />
        </div>

        <div style={styles.fSep} />

        {/* Indent */}
        <div style={styles.fGroup}>
          <FmtBtn onClick={() => {
            if (editor.isActive('listItem')) editor.chain().focus().sinkListItem('listItem').run();
            else editor.chain().focus().indent().run();
          }} title="Increase indent" label="→" />
          <FmtBtn onClick={() => {
            if (editor.isActive('listItem')) editor.chain().focus().liftListItem('listItem').run();
            else editor.chain().focus().outdent().run();
          }} title="Decrease indent" label="←" />
        </div>

        <div style={styles.fSep} />

        {/* Table */}
        <div style={{ position: 'relative' }}>
          <FmtBtn onClick={() => { setShowTableGrid(!showTableGrid); setShowTextColor(false); setShowHighlightColor(false); }}
            title="Insert table" label="⊞"
          />
          {showTableGrid && (
            <TableInsertGrid onInsert={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()} onClose={() => setShowTableGrid(false)} />
          )}
        </div>

        <div style={styles.fSep} />

        {/* Headings */}
        <div style={styles.fGroup}>
          <FmtBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" title="Heading 1" extraStyle={{ fontSize: 11, fontWeight: 700 }} />
          <FmtBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" title="Heading 2" extraStyle={{ fontSize: 11, fontWeight: 700 }} />
          <FmtBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" title="Heading 3" extraStyle={{ fontSize: 11, fontWeight: 700 }} />
        </div>

        <div style={styles.fSep} />

        {/* Misc */}
        <div style={styles.fGroup}>
          <FmtBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule" label="—" />
          <FmtBtn active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} title="Subscript" label="X₂" extraStyle={{ fontSize: 10 }} />
          <FmtBtn active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} title="Superscript" label="X²" extraStyle={{ fontSize: 10 }} />
          <FmtBtn onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Clear formatting" label="T̸" />
        </div>
      </div>

      {/* Comment Input Popup */}
      {showCommentInput && (
        <div style={styles.commentInputBar}>
          <span style={styles.commentInputLabel}>Add comment on selected text:</span>
          <input
            ref={commentInputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); if (e.key === 'Escape') setShowCommentInput(false); }}
            placeholder="Type your comment..."
            style={styles.commentInputField}
          />
          <button onClick={submitComment} style={styles.commentSubmitBtn} disabled={!commentText.trim()}>Add</button>
          <button onClick={() => setShowCommentInput(false)} style={styles.commentCancelBtn}>Cancel</button>
        </div>
      )}

      {/* Canvas + Pages */}
      <div ref={editorWrapRef} style={styles.canvas}>
        <div style={{
          ...styles.pageContainer,
          transform: `scale(${zoom / 100})`,
          transformOrigin: 'top center',
          width: 816,
          minHeight: totalPageHeight,
        }}>
          {/* White page backgrounds */}
          {Array.from({ length: pageCount }, (_, i) => (
            <div key={`pg-${i}`} style={{
              position: 'absolute',
              top: i * (PAGE_HEIGHT + PAGE_GAP),
              left: 0, width: 816, height: PAGE_HEIGHT,
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.2), 0 0 1px rgba(0,0,0,0.1)',
            }} />
          ))}

          {/* Content layer — flows on top of page backgrounds */}
          <div ref={pageRef} style={{
            position: 'relative', zIndex: 1,
            width: 816, padding: 96,
            minHeight: totalPageHeight,
          }}>
            <EditorContent editor={editor} />
          </div>

          {/* Comment Tooltip */}
          {hoveredComment && (
            <div style={{
              ...styles.commentTooltip,
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y}px`,
            }}>
              <div style={styles.tooltipHeader}>
                <span style={styles.tooltipAuthor}>{hoveredComment.author}</span>
                <span style={styles.tooltipTime}>
                  {hoveredComment.createdAt ? new Date(hoveredComment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
                </span>
              </div>
              <p style={styles.tooltipText}>{hoveredComment.text}</p>
              <button onClick={removeComment} style={styles.tooltipRemoveBtn}>Remove comment</button>
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div style={styles.statusBar}>
        <span style={styles.statusText}>{wordCount} words &middot; {charCount} characters</span>
        <span style={styles.statusText}>Page {Math.min(pageCount, pageCount)} of {pageCount}</span>
        <div style={{ flex: 1 }} />
        <button onClick={zoomOut} style={styles.zoomBtn}>−</button>
        <span style={styles.statusText}>{zoom}%</span>
        <button onClick={zoomIn} style={styles.zoomBtn}>+</button>
      </div>

      {/* Editor styles */}
      <style>{`
        .doc-editor-content {
          font-family: Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.15;
          color: #000;
          outline: none;
          min-height: 864px;
          caret-color: #000;
        }
        .doc-editor-content h1 { font-size: 24pt; font-weight: 400; margin: 20px 0 8px; color: #000; }
        .doc-editor-content h2 { font-size: 18pt; font-weight: 400; margin: 18px 0 6px; color: #000; }
        .doc-editor-content h3 { font-size: 14pt; font-weight: 700; margin: 14px 0 4px; color: #434343; }
        .doc-editor-content p { margin: 0 0 4px; }
        .doc-editor-content ul, .doc-editor-content ol { padding-left: 28px; margin: 4px 0; }
        .doc-editor-content li { margin: 2px 0; }
        .doc-editor-content blockquote {
          border-left: 4px solid #dadce0;
          padding-left: 16px; margin: 10px 0;
          color: #5f6368; font-style: italic;
        }
        .doc-editor-content table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .doc-editor-content th, .doc-editor-content td { border: 1px solid #dadce0; padding: 8px 12px; min-width: 50px; vertical-align: top; }
        .doc-editor-content th { background: #f1f3f4; font-weight: 700; }
        .doc-editor-content a { color: #1a73e8; text-decoration: underline; }
        .doc-editor-content img { max-width: 100%; height: auto; margin: 8px 0; border-radius: 2px; }
        .doc-editor-content ::selection { background: #d2e3fc; }
        .doc-editor-content hr { border: none; border-top: 1px solid #dadce0; margin: 16px 0; }
        .doc-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #aaa;
          pointer-events: none;
          float: left; height: 0;
        }
        .doc-editor-content .tableWrapper { overflow-x: auto; }
        .doc-editor-content .selectedCell { background: #d2e3fc; }
      `}</style>
    </div>
  );
}

/* ─── Formatting Toolbar Button ─────────────────────────────────── */

function FmtBtn({ active, onClick, label, title, extraStyle = {} }) {
  return (
    <button onClick={onClick} title={title} style={{
      ...fmtBtnStyle.btn,
      ...(active ? fmtBtnStyle.active : {}),
      ...extraStyle,
    }}>{label}</button>
  );
}

const fmtBtnStyle = {
  btn: {
    minWidth: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: '1px solid transparent', borderRadius: 4,
    color: '#444', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: '0 5px',
    transition: 'background 0.1s',
  },
  active: { background: '#d2e3fc', borderColor: '#a8c7fa', color: '#1a73e8' },
};

/* ─── Popover Styles ────────────────────────────────────────────── */

const popStyles = {
  colorPopover: {
    position: 'absolute', top: 34, left: 0, zIndex: 300, background: '#fff', border: '1px solid #dadce0',
    borderRadius: 8, padding: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', width: 230,
  },
  colorGrid: { display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3, marginBottom: 8 },
  colorSwatch: { width: 20, height: 20, borderRadius: 3, cursor: 'pointer', padding: 0 },
  customRow: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, borderTop: '1px solid #eee' },
  customLabel: { fontSize: 11, color: '#666' },
  customInput: { width: 32, height: 24, border: '1px solid #dadce0', borderRadius: 4, cursor: 'pointer', padding: 0 },
  tablePopover: {
    position: 'absolute', top: 34, left: 0, zIndex: 300, background: '#fff', border: '1px solid #dadce0',
    borderRadius: 8, padding: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  },
  tableLabel: { fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 6 },
  tableGrid: { display: 'flex', flexDirection: 'column' },
};

/* ─── Main Layout Styles ────────────────────────────────────────── */

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', background: '#f0f0f0' },

  // Row 1: Action bar
  actionBar: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
    background: '#fff', borderBottom: '1px solid #e0e0e0',
  },
  backBtn: {
    background: 'none', border: 'none', color: '#5f6368', fontSize: 13,
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '6px 10px',
  },
  titleText: { fontSize: 16, fontWeight: 600, color: '#202124', marginLeft: 4 },
  commentBtn: {
    padding: '5px 12px', background: '#fef9e7', border: '1px solid #f9e79f', borderRadius: 5,
    color: '#7d6608', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  exportBtn: {
    padding: '5px 12px', background: '#e8f0fe', border: '1px solid #a8c7fa', borderRadius: 5,
    color: '#1a73e8', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  saveBtn: {
    padding: '5px 14px', background: '#1a73e8', border: 'none', borderRadius: 5,
    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  templateBtn: {
    padding: '5px 12px', background: '#f1f3f4', border: '1px solid #dadce0', borderRadius: 5,
    color: '#5f6368', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  // Row 2: Formatting bar
  formatBar: {
    display: 'flex', alignItems: 'center', gap: 2, padding: '4px 12px',
    background: '#f9fbfd', borderBottom: '1px solid #e0e0e0', flexWrap: 'wrap', minHeight: 36,
  },
  fGroup: { display: 'flex', alignItems: 'center', gap: 1 },
  fSep: { width: 1, height: 20, background: '#dadce0', margin: '0 4px' },
  selectDropdown: {
    height: 28, padding: '0 4px', border: '1px solid #dadce0', borderRadius: 4,
    background: '#fff', color: '#202124', fontSize: 12, fontFamily: 'inherit',
    cursor: 'pointer', outline: 'none', width: 130,
  },

  // Comment input
  commentInputBar: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
    background: '#fef9e7', borderBottom: '1px solid #f9e79f',
  },
  commentInputLabel: { fontSize: 12, color: '#7d6608', fontWeight: 600, whiteSpace: 'nowrap' },
  commentInputField: {
    flex: 1, padding: '6px 12px', background: '#fff', border: '1px solid #dadce0',
    borderRadius: 6, color: '#202124', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
  commentSubmitBtn: {
    padding: '5px 14px', background: '#f4b400', border: 'none', borderRadius: 5,
    color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  },
  commentCancelBtn: {
    padding: '5px 10px', background: 'none', border: '1px solid #dadce0', borderRadius: 5,
    color: '#5f6368', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },

  // Canvas
  canvas: {
    flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center',
    padding: '30px 20px', background: '#2a2a3e', position: 'relative',
  },
  pageContainer: {
    position: 'relative',
  },

  // Comment tooltip
  commentTooltip: {
    position: 'absolute', transform: 'translate(-50%, -100%)',
    background: '#fff', border: '1px solid #f4b400', borderRadius: 10,
    padding: '10px 14px', zIndex: 200, minWidth: 200, maxWidth: 300,
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)', pointerEvents: 'auto',
  },
  tooltipHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  tooltipAuthor: { fontSize: 12, fontWeight: 700, color: '#7d6608' },
  tooltipTime: { fontSize: 10, color: '#999' },
  tooltipText: { fontSize: 13, color: '#333', margin: '0 0 8px', lineHeight: 1.4 },
  tooltipRemoveBtn: { background: 'none', border: 'none', color: '#999', fontSize: 10, cursor: 'pointer', padding: 0, fontFamily: 'inherit' },

  // Status bar
  statusBar: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '4px 16px',
    background: '#fff', borderTop: '1px solid #e0e0e0', minHeight: 28,
  },
  statusText: { fontSize: 11, color: '#5f6368' },
  zoomBtn: {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f1f3f4', border: '1px solid #dadce0', borderRadius: 4,
    color: '#5f6368', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  },
};
