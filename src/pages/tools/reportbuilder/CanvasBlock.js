import React, { useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle, FontFamily } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';

const KIND_COLORS = {
  brief: '#f59e0b',
  cards: '#8b5cf6',
  trends: '#10b981',
  news: '#06b6d4',
  custom: '#6366f1',
};

// Tiptap editor for text/heading blocks — only mounted when selected
function InlineEditor({ content, style, onUpdate }) {
  const skipNextUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false }),
      Underline,
      TextAlign.configure({ types: ['paragraph'] }),
      TextStyle,
      Color,
      FontFamily,
    ],
    content: content || '<p></p>',
    onUpdate: ({ editor: ed }) => {
      if (skipNextUpdate.current) {
        skipNextUpdate.current = false;
        return;
      }
      onUpdate(ed.getHTML());
    },
  });

  // Sync external content changes (e.g. from undo)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      skipNextUpdate.current = true;
      editor.commands.setContent(content || '<p></p>');
    }
  }, [content, editor]);

  // Auto-focus when mounted
  useEffect(() => {
    if (editor) {
      setTimeout(() => editor.commands.focus('end'), 50);
    }
  }, [editor]);

  if (!editor) return null;

  // Expose editor on the DOM node so BlockStyleEditor can access it
  return (
    <div data-canvas-editor="true" ref={el => { if (el) el.__tiptapEditor = editor; }}>
      <EditorContent
        editor={editor}
        style={{
          fontFamily: style?.fontFamily || 'DM Sans',
          fontSize: style?.fontSize || '14px',
          color: style?.color || '#333',
          textAlign: style?.textAlign || 'left',
          lineHeight: style?.lineHeight || '1.6',
          outline: 'none',
        }}
      />
    </div>
  );
}

export default function CanvasBlock({ block, selected, sectionsById, onUpdate, onClick }) {
  const handleContentUpdate = useCallback((html) => {
    onUpdate({ ...block, content: html });
  }, [block, onUpdate]);

  const blockStyle = block.style || {};

  switch (block.type) {
    case 'heading': {
      const level = block.level || 1;
      const fontSize = blockStyle.fontSize || (level === 1 ? '28px' : level === 2 ? '22px' : '18px');
      const hStyle = {
        margin: 0,
        fontFamily: blockStyle.fontFamily || 'DM Sans',
        fontSize,
        fontWeight: blockStyle.fontWeight || '700',
        color: blockStyle.color || '#1a1a2e',
        textAlign: blockStyle.textAlign || 'left',
        lineHeight: '1.3',
      };

      if (selected) {
        return (
          <div style={hStyle} onClick={onClick}>
            <InlineEditor content={block.content} style={{ ...blockStyle, fontSize }} onUpdate={handleContentUpdate} />
          </div>
        );
      }
      return (
        <div
          style={hStyle}
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: block.content || 'Heading' }}
        />
      );
    }

    case 'text': {
      const tStyle = {
        fontFamily: blockStyle.fontFamily || 'DM Sans',
        fontSize: blockStyle.fontSize || '14px',
        color: blockStyle.color || '#333333',
        textAlign: blockStyle.textAlign || 'left',
        lineHeight: blockStyle.lineHeight || '1.6',
      };

      if (selected) {
        return (
          <div style={tStyle} onClick={onClick}>
            <InlineEditor content={block.content} style={blockStyle} onUpdate={handleContentUpdate} />
          </div>
        );
      }
      return (
        <div
          style={tStyle}
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: block.content || '<p>Start typing...</p>' }}
        />
      );
    }

    case 'image': {
      const imgStyle = {
        width: blockStyle.width || '100%',
        borderRadius: blockStyle.borderRadius || '4px',
        display: 'block',
      };

      if (!block.src) {
        return (
          <div
            onClick={onClick}
            style={{
              background: '#f1f5f9',
              border: '2px dashed #cbd5e1',
              borderRadius: blockStyle.borderRadius || '4px',
              padding: '32px 16px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: '24px', marginBottom: '6px', opacity: 0.5 }}>🖼</div>
            Click to add image URL
          </div>
        );
      }
      return (
        <img
          src={block.src}
          alt={block.alt || ''}
          style={imgStyle}
          onClick={onClick}
        />
      );
    }

    case 'divider': {
      return (
        <hr
          onClick={onClick}
          style={{
            border: 'none',
            borderTop: `${blockStyle.borderWidth || '1px'} solid ${blockStyle.borderColor || '#e2e8f0'}`,
            margin: blockStyle.margin || '8px 0',
          }}
        />
      );
    }

    case 'spacer': {
      return (
        <div
          onClick={onClick}
          style={{
            height: blockStyle.height || '24px',
            position: 'relative',
          }}
        >
          {selected && (
            <div style={{
              position: 'absolute', inset: 0,
              borderTop: '1px dashed rgba(99,102,241,0.3)',
              borderBottom: '1px dashed rgba(99,102,241,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '10px', color: 'rgba(99,102,241,0.5)',
            }}>
              {blockStyle.height || '24px'}
            </div>
          )}
        </div>
      );
    }

    case 'columns': {
      const cols = block.columns || [{ blocks: [] }, { blocks: [] }];
      return (
        <div
          onClick={onClick}
          style={{ display: 'flex', gap: '16px' }}
        >
          {cols.map((col, ci) => (
            <div
              key={ci}
              style={{
                flex: 1,
                minHeight: '40px',
                background: selected ? 'rgba(99,102,241,0.04)' : 'transparent',
                border: selected ? '1px dashed rgba(99,102,241,0.2)' : '1px dashed transparent',
                borderRadius: '4px',
                padding: '8px',
              }}
            >
              {col.blocks.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#94a3b8', textAlign: 'center', padding: '8px' }}>
                  Column {ci + 1}
                </div>
              ) : (
                col.blocks.map((nested) => (
                  <CanvasBlock
                    key={nested.id}
                    block={nested}
                    selected={false}
                    sectionsById={sectionsById}
                    onUpdate={() => {}}
                    onClick={onClick}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      );
    }

    case 'section': {
      const section = sectionsById?.get(block.sectionId);
      const kindColor = section ? (KIND_COLORS[section.kind] || KIND_COLORS.custom) : '#6366f1';

      return (
        <div
          onClick={onClick}
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderLeft: `3px solid ${kindColor}`,
            borderRadius: '6px',
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
              {section?.name || 'Unknown Section'}
            </span>
            {section && (
              <span style={{
                fontSize: '9px', fontWeight: 700, color: kindColor,
                background: `${kindColor}18`, padding: '2px 6px',
                borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                {section.kind}
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            Generated by AI at runtime
          </div>
        </div>
      );
    }

    default:
      return <div onClick={onClick} style={{ padding: '8px', color: '#94a3b8', fontSize: '12px' }}>Unknown block type: {block.type}</div>;
  }
}
