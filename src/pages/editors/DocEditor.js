import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { Mark, mergeAttributes } from '@tiptap/core';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../contexts/AuthContext';

// Custom Comment Mark extension
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

export default function DocEditor({ docId, title, docType, onBack, onSaveTemplate }) {
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [hoveredComment, setHoveredComment] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const commentInputRef = useRef(null);
  const editorWrapRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      CommentMark,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'doc-editor-content',
        style: 'outline: none; min-height: 100%; padding: 40px 60px; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.85);',
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
  });

  useEffect(() => {
    if (!editor) return;
    loadDoc();
  }, [docId, editor]);

  async function loadDoc() {
    const { data } = await supabase.from('concept_documents')
      .select('content').eq('id', docId).single();
    if (data?.content?.html && editor) {
      editor.commands.setContent(data.content.html);
    }
    setLoaded(true);
  }

  const save = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    const html = editor.getHTML();
    await supabase.from('concept_documents')
      .update({ content: { html }, updated_at: new Date().toISOString() })
      .eq('id', docId);
    setSaving(false);
  }, [editor, docId]);

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

  function handleAddComment() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      alert('Select some text first to add a comment.');
      return;
    }
    setShowCommentInput(true);
    setCommentText('');
    setTimeout(() => commentInputRef.current?.focus(), 50);
  }

  function submitComment() {
    if (!editor || !commentText.trim()) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    editor.chain().focus()
      .setMark('comment', {
        commentId: Date.now().toString(),
        author: profile?.full_name || 'Unknown',
        text: commentText.trim(),
        createdAt: new Date().toISOString(),
      })
      .run();

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
    if (found) {
      editor.view.dispatch(tr);
      setHoveredComment(null);
    }
  }

  async function handleExportDocx() {
    if (!editor) return;
    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
      const html = editor.getHTML();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const children = [];

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
          });
          runs.push(...childRuns);
        }
        return runs;
      }

      for (const child of doc.body.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
          children.push(new Paragraph({ children: [new TextRun(child.textContent)] }));
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = child.tagName.toLowerCase();
        const runs = processNode(child);
        if (tag === 'h1') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_1 }));
        else if (tag === 'h2') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_2 }));
        else if (tag === 'h3') children.push(new Paragraph({ children: runs, heading: HeadingLevel.HEADING_3 }));
        else if (tag === 'ul' || tag === 'ol') {
          for (const li of child.querySelectorAll('li')) {
            const liRuns = processNode(li);
            children.push(new Paragraph({
              children: liRuns,
              bullet: tag === 'ul' ? { level: 0 } : undefined,
              numbering: tag === 'ol' ? { reference: 'default-numbering', level: 0 } : undefined,
            }));
          }
        } else if (tag === 'blockquote') {
          children.push(new Paragraph({ children: processNode(child), indent: { left: 720 } }));
        } else {
          children.push(runs.length > 0 ? new Paragraph({ children: runs }) : new Paragraph({}));
        }
      }

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

  if (!editor) return null;

  return (
    <div style={styles.page}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.titleText}>{title}</span>

        <div style={styles.toolGroup}>
          <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="B" style={{ fontWeight: 700 }} />
          <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="I" style={{ fontStyle: 'italic' }} />
          <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} label="U" style={{ textDecoration: 'underline' }} />
          <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="S" style={{ textDecoration: 'line-through' }} />
        </div>

        <div style={styles.toolGroup}>
          <ToolBtn active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="H1" />
          <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="H2" />
          <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="H3" />
        </div>

        <div style={styles.toolGroup}>
          <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="•" />
          <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="1." />
          <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="❝" />
        </div>

        <div style={styles.toolGroup}>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} label="⫷" />
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} label="≡" />
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} label="⫸" />
        </div>

        <div style={styles.toolGroup}>
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} label="↩" />
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} label="↪" />
        </div>

        <div style={styles.toolGroup}>
          <button onClick={handleAddComment} style={styles.commentBtn}>💬 Comment</button>
        </div>

        <button onClick={handleExportDocx} style={styles.exportBtn}>📄 Export .docx</button>
        <button onClick={save} style={styles.saveBtn}>
          {saving ? 'Saving...' : '💾 Save'}
        </button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name && editor) onSaveTemplate(name, 'document', { html: editor.getHTML() });
        }} style={styles.templateBtn}>📋 Save as Template</button>
      </div>

      {/* Comment Input Popup */}
      {showCommentInput && (
        <div style={styles.commentInputBar}>
          <span style={styles.commentInputLabel}>💬 Add comment on selected text:</span>
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

      {/* Editor */}
      <div ref={editorWrapRef} style={styles.editorWrap}>
        <div style={styles.editorPage}>
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

      <style>{`
        .doc-editor-content {
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        .doc-editor-content h1 { font-size: 28px; font-weight: 700; margin: 24px 0 12px; color: #fff; }
        .doc-editor-content h2 { font-size: 22px; font-weight: 600; margin: 20px 0 10px; color: #fff; }
        .doc-editor-content h3 { font-size: 18px; font-weight: 600; margin: 16px 0 8px; color: #e2e8f0; }
        .doc-editor-content p { margin: 0 0 8px; }
        .doc-editor-content ul, .doc-editor-content ol { padding-left: 24px; margin: 8px 0; }
        .doc-editor-content li { margin: 4px 0; }
        .doc-editor-content blockquote {
          border-left: 3px solid rgba(99,102,241,0.4);
          padding-left: 16px; margin: 12px 0;
          color: rgba(255,255,255,0.6); font-style: italic;
        }
        .doc-editor-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: rgba(255,255,255,0.2);
          pointer-events: none;
          float: left; height: 0;
        }
      `}</style>
    </div>
  );
}

function ToolBtn({ active, onClick, label, style = {} }) {
  return (
    <button onClick={onClick} style={{
      ...btnStyles.btn,
      ...(active ? btnStyles.btnActive : {}),
      ...style,
    }}>{label}</button>
  );
}

const btnStyles = {
  btn: { minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', padding: '0 6px' },
  btnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
};

const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', flexWrap: 'wrap' },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '6px 10px' },
  titleText: { fontSize: '15px', fontWeight: 600, color: '#e2e8f0', marginRight: 'auto' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: '3px', padding: '0 6px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  commentBtn: { padding: '5px 10px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '5px', color: '#fbbf24', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  exportBtn: { padding: '6px 14px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', color: '#93c5fd', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { padding: '6px 14px', background: '#22c55e', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  templateBtn: { padding: '6px 12px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: 'rgba(255,255,255,0.45)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },
  commentInputBar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.15)' },
  commentInputLabel: { fontSize: '12px', color: '#fbbf24', fontWeight: 600, whiteSpace: 'nowrap' },
  commentInputField: { flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: '#fff', fontSize: '13px', fontFamily: 'inherit', outline: 'none' },
  commentSubmitBtn: { padding: '6px 14px', background: '#fbbf24', border: 'none', borderRadius: '6px', color: '#000', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  commentCancelBtn: { padding: '6px 10px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', color: 'rgba(255,255,255,0.4)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' },
  editorWrap: { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '20px', background: '#0a0a14', position: 'relative' },
  editorPage: { width: '100%', maxWidth: '800px', minHeight: '100%', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' },
  commentTooltip: { position: 'absolute', transform: 'translate(-50%, -100%)', background: '#2a2a40', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '10px', padding: '10px 14px', zIndex: 200, minWidth: '200px', maxWidth: '300px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', pointerEvents: 'auto' },
  tooltipHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  tooltipAuthor: { fontSize: '12px', fontWeight: 700, color: '#fbbf24' },
  tooltipTime: { fontSize: '10px', color: 'rgba(255,255,255,0.3)' },
  tooltipText: { fontSize: '13px', color: 'rgba(255,255,255,0.75)', margin: '0 0 8px', lineHeight: 1.4 },
  tooltipRemoveBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', fontSize: '10px', cursor: 'pointer', padding: 0, fontFamily: 'inherit' },
};
