import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { jsPDF } from 'jspdf';

// ─── Element type definitions ───
const ELEMENT_TYPES = {
  sceneHeading:    { label: 'Scene Heading',   shortLabel: 'SCENE',  uppercase: true,  nextOnEnter: 'action',       blankBefore: true  },
  action:          { label: 'Action',           shortLabel: 'ACT',    uppercase: false, nextOnEnter: 'action',       blankBefore: false },
  character:       { label: 'Character',        shortLabel: 'CHAR',   uppercase: true,  nextOnEnter: 'dialogue',     blankBefore: true  },
  dialogue:        { label: 'Dialogue',         shortLabel: 'DIA',    uppercase: false, nextOnEnter: 'character',    blankBefore: false },
  parenthetical:   { label: 'Parenthetical',    shortLabel: 'PAREN',  uppercase: false, nextOnEnter: 'dialogue',     blankBefore: false },
  transition:      { label: 'Transition',       shortLabel: 'TRANS',  uppercase: true,  nextOnEnter: 'sceneHeading', blankBefore: true  },
};

// Tab cycle order
const TAB_CYCLE = ['action', 'character', 'sceneHeading', 'transition'];

// Margins (in inches, for PDF and visual styling)
const ELEMENT_MARGINS = {
  sceneHeading:  { left: 1.5, right: 1.0 },
  action:        { left: 1.5, right: 1.0 },
  character:     { left: 3.7, right: 1.0 },
  dialogue:      { left: 2.5, right: 2.5 },
  parenthetical: { left: 3.1, right: 2.9 },
  transition:    { left: 1.5, right: 1.0 },
};

// Page dimensions for visual editor (scaled to screen)
const PAGE_WIDTH_IN = 8.5;
const LINES_PER_PAGE = 56;
const MAX_UNDO = 50;

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export default function ScreenplayEditor({ docId, title, docType, onBack, onSaveTemplate }) {
  const [elements, setElements] = useState([{ id: uid(), type: 'sceneHeading', text: '' }]);
  const [titlePage, setTitlePage] = useState({ title: '', writtenBy: '', basedOn: '', draft: '', date: '', contact: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSceneNav, setShowSceneNav] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [autocomplete, setAutocomplete] = useState(null); // { idx, items, selected, type }

  const blockRefs = useRef({});
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);
  const saveTimer = useRef(null);
  const suppressSync = useRef(false);
  const editorScrollRef = useRef(null);

  const tableName = docType === 'resource_documents' ? 'resource_documents' : 'concept_documents';

  // ─── Load doc ───
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from(tableName).select('content').eq('id', docId).single();
      if (data?.content) {
        if (data.content.elements?.length) setElements(data.content.elements);
        if (data.content.titlePage) setTitlePage(data.content.titlePage);
      }
      setLoaded(true);
    })();
  }, [docId, tableName]);

  // Focus first block on load
  useEffect(() => {
    if (loaded && elements.length > 0) {
      setTimeout(() => {
        const el = blockRefs.current[elements[0].id];
        if (el) el.focus();
      }, 100);
    }
  }, [loaded]);

  // ─── Auto-save ───
  const save = useCallback(async () => {
    setSaving(true);
    await supabase.from(tableName)
      .update({ content: { titlePage, elements, notes: [] }, updated_at: new Date().toISOString() })
      .eq('id', docId);
    setSaving(false);
  }, [titlePage, elements, docId, tableName]);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 2000);
    return () => clearTimeout(saveTimer.current);
  }, [elements, titlePage, loaded, save]);

  // ─── Undo / Redo ───
  function pushUndo(els) {
    undoStack.current.push(JSON.parse(JSON.stringify(els)));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setUndoLen(undoStack.current.length);
    setRedoLen(0);
  }

  function handleUndo() {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop();
    redoStack.current.push(JSON.parse(JSON.stringify(elements)));
    suppressSync.current = true;
    setElements(prev);
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
    setTimeout(() => { suppressSync.current = false; }, 50);
  }

  function handleRedo() {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    undoStack.current.push(JSON.parse(JSON.stringify(elements)));
    suppressSync.current = true;
    setElements(next);
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
    setTimeout(() => { suppressSync.current = false; }, 50);
  }

  // ─── SmartType: build character + scene heading lists ───
  const characterNames = useMemo(() => {
    const names = new Set();
    elements.forEach(el => { if (el.type === 'character' && el.text.trim()) names.add(el.text.trim().toUpperCase()); });
    return [...names].sort();
  }, [elements]);

  const sceneLocations = useMemo(() => {
    const locs = new Set();
    elements.forEach(el => { if (el.type === 'sceneHeading' && el.text.trim()) locs.add(el.text.trim().toUpperCase()); });
    return [...locs].sort();
  }, [elements]);

  // ─── Page count ───
  const pageCount = useMemo(() => {
    let lines = 0;
    elements.forEach(el => {
      const type = ELEMENT_TYPES[el.type];
      if (type.blankBefore) lines += 1;
      const charWidth = el.type === 'dialogue' ? 35 : el.type === 'parenthetical' ? 25 : 60;
      const textLen = (el.text || '').length || 1;
      lines += Math.ceil(textLen / charWidth);
    });
    return Math.max(1, Math.ceil(lines / LINES_PER_PAGE));
  }, [elements]);

  // ─── Scene headings for navigator ───
  const sceneHeadings = useMemo(() => {
    return elements
      .map((el, idx) => ({ ...el, idx }))
      .filter(el => el.type === 'sceneHeading' && el.text.trim());
  }, [elements]);

  // ─── Update element ───
  function updateElement(idx, updates) {
    setElements(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  }

  // ─── Insert element after idx ───
  function insertAfter(idx, type) {
    pushUndo(elements);
    const newEl = { id: uid(), type, text: '' };
    setElements(prev => {
      const next = [...prev];
      next.splice(idx + 1, 0, newEl);
      return next;
    });
    setTimeout(() => {
      const el = blockRefs.current[newEl.id];
      if (el) el.focus();
    }, 30);
  }

  // ─── Delete element ───
  function deleteElement(idx) {
    if (elements.length <= 1) return;
    pushUndo(elements);
    const prevId = elements[Math.max(0, idx - 1)]?.id;
    setElements(prev => prev.filter((_, i) => i !== idx));
    setTimeout(() => {
      const el = blockRefs.current[prevId];
      if (el) {
        el.focus();
        // Place cursor at end
        const range = document.createRange();
        const sel = window.getSelection();
        if (el.childNodes.length > 0) {
          range.setStartAfter(el.lastChild);
        } else {
          range.setStart(el, 0);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 30);
  }

  // ─── Change element type ───
  function changeType(idx, newType) {
    pushUndo(elements);
    updateElement(idx, { type: newType });
  }

  // ─── Autocomplete logic ───
  function checkAutocomplete(idx, text) {
    const el = elements[idx];
    if (!el) { setAutocomplete(null); return; }

    if (el.type === 'character' && text.length >= 1) {
      const upper = text.toUpperCase();
      const matches = characterNames.filter(n => n.startsWith(upper) && n !== upper);
      if (matches.length > 0) {
        setAutocomplete({ idx, items: matches, selected: 0, type: 'character' });
        return;
      }
    }

    if (el.type === 'sceneHeading' && text.length >= 1) {
      const upper = text.toUpperCase();
      const prefixes = ['INT. ', 'EXT. ', 'INT./EXT. '];
      const prefixMatches = prefixes.filter(p => p.startsWith(upper) && p !== upper);
      const locMatches = sceneLocations.filter(l => l.startsWith(upper) && l !== upper);
      const allMatches = [...prefixMatches, ...locMatches].slice(0, 8);
      if (allMatches.length > 0) {
        setAutocomplete({ idx, items: allMatches, selected: 0, type: 'sceneHeading' });
        return;
      }
    }

    setAutocomplete(null);
  }

  function acceptAutocomplete() {
    if (!autocomplete) return;
    const { idx, items, selected } = autocomplete;
    const text = items[selected];
    pushUndo(elements);
    updateElement(idx, { text });
    setAutocomplete(null);
    setTimeout(() => {
      const el = blockRefs.current[elements[idx].id];
      if (el) {
        el.textContent = text;
        const range = document.createRange();
        const sel = window.getSelection();
        if (el.childNodes.length > 0) {
          range.setStartAfter(el.lastChild);
        } else {
          range.setStart(el, 0);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }, 20);
  }

  // ─── Scene navigator click ───
  function jumpToScene(elId) {
    const el = blockRefs.current[elId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }

  // ─── PDF Export ───
  function handleExportPDF() {
    const pdf = new jsPDF({ unit: 'in', format: 'letter' });
    const pageW = 8.5;
    const pageH = 11;
    const topMargin = 1.0;
    const bottomMargin = 1.0;
    let y = topMargin;
    let pageNum = 1;
    const lineHeight = 12 / 72; // 12pt in inches

    pdf.setFont('courier', 'normal');
    pdf.setFontSize(12);

    // Title page
    const tp = titlePage;
    if (tp.title || tp.writtenBy) {
      const centerX = pageW / 2;
      y = 3.5;
      if (tp.title) {
        pdf.setFontSize(24);
        pdf.text(tp.title.toUpperCase(), centerX, y, { align: 'center' });
        y += 0.6;
      }
      pdf.setFontSize(12);
      if (tp.writtenBy) {
        pdf.text('Written by', centerX, y, { align: 'center' });
        y += 0.3;
        pdf.text(tp.writtenBy, centerX, y, { align: 'center' });
        y += 0.4;
      }
      if (tp.basedOn) {
        pdf.text(tp.basedOn, centerX, y, { align: 'center' });
        y += 0.4;
      }
      // Bottom-left contact info
      if (tp.contact || tp.draft || tp.date) {
        let cy = 9.0;
        if (tp.draft) { pdf.text(tp.draft, 1.5, cy); cy += 0.25; }
        if (tp.date) { pdf.text(tp.date, 1.5, cy); cy += 0.25; }
        if (tp.contact) { pdf.text(tp.contact, 1.5, cy); }
      }
      pdf.addPage();
      pageNum++;
      y = topMargin;
    }

    // Page number helper
    function addPageNumber() {
      if (pageNum > 1 || !tp.title) {
        pdf.text(`${pageNum}.`, pageW - 1.0, 0.5, { align: 'right' });
      }
    }
    addPageNumber();

    // Render elements
    elements.forEach(el => {
      const typeDef = ELEMENT_TYPES[el.type];
      const margins = ELEMENT_MARGINS[el.type];
      const textWidth = pageW - margins.left - margins.right;
      let text = el.text || '';
      if (typeDef.uppercase) text = text.toUpperCase();
      if (el.type === 'parenthetical' && text && !text.startsWith('(')) text = `(${text})`;

      // Blank line before
      if (typeDef.blankBefore) y += lineHeight;

      // Word wrap
      const lines = text ? pdf.splitTextToSize(text, textWidth) : [''];

      lines.forEach(line => {
        if (y + lineHeight > pageH - bottomMargin) {
          pdf.addPage();
          pageNum++;
          y = topMargin;
          addPageNumber();
        }
        if (el.type === 'transition') {
          pdf.text(line, pageW - margins.right, y, { align: 'right' });
        } else {
          pdf.text(line, margins.left, y);
        }
        y += lineHeight;
      });
    });

    const filename = (titlePage.title || title || 'screenplay').replace(/[^a-zA-Z0-9]/g, '_');
    pdf.save(`${filename}.pdf`);
  }

  // ─── Key handler for each block ───
  function handleKeyDown(e, idx) {
    const el = elements[idx];
    const domEl = blockRefs.current[el.id];
    const text = domEl?.textContent || '';

    // Autocomplete navigation
    if (autocomplete && autocomplete.idx === idx) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocomplete(prev => ({ ...prev, selected: Math.min(prev.selected + 1, prev.items.length - 1) }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocomplete(prev => ({ ...prev, selected: Math.max(prev.selected - 1, 0) }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptAutocomplete();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAutocomplete(null);
        return;
      }
    }

    // Undo/Redo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
      return;
    }

    // Tab — cycle element type
    if (e.key === 'Tab' && !autocomplete) {
      e.preventDefault();
      const currentIdx = TAB_CYCLE.indexOf(el.type);
      if (e.shiftKey) {
        const newIdx = currentIdx <= 0 ? TAB_CYCLE.length - 1 : currentIdx - 1;
        changeType(idx, TAB_CYCLE[newIdx]);
      } else {
        const newIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % TAB_CYCLE.length;
        changeType(idx, TAB_CYCLE[newIdx]);
      }
      return;
    }

    // Enter — insert next element or change type if empty
    if (e.key === 'Enter') {
      e.preventDefault();
      // Sync text before acting
      pushUndo(elements);
      updateElement(idx, { text });

      if (text.trim() === '') {
        // Empty block: convert type
        if (el.type === 'action' || el.type === 'dialogue' || el.type === 'character' || el.type === 'parenthetical') {
          const fallback = (el.type === 'action') ? 'character' : 'action';
          updateElement(idx, { type: fallback });
        }
        return;
      }

      const nextType = ELEMENT_TYPES[el.type].nextOnEnter;
      insertAfter(idx, nextType);
      return;
    }

    // Backspace at start of empty block
    if (e.key === 'Backspace' && text === '') {
      e.preventDefault();
      deleteElement(idx);
      return;
    }

    // `(` in dialogue → switch to parenthetical
    if (e.key === '(' && el.type === 'dialogue' && text === '') {
      e.preventDefault();
      changeType(idx, 'parenthetical');
      setTimeout(() => {
        const dom = blockRefs.current[el.id];
        if (dom) {
          dom.textContent = '(';
          const range = document.createRange();
          const sel = window.getSelection();
          range.setStartAfter(dom.lastChild);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 20);
      return;
    }

    // Arrow up at top → focus previous
    if (e.key === 'ArrowUp' && idx > 0) {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const domRect = domEl?.getBoundingClientRect();
        if (domRect && Math.abs(rect.top - domRect.top) < 5) {
          e.preventDefault();
          const prevEl = blockRefs.current[elements[idx - 1].id];
          if (prevEl) {
            prevEl.focus();
            const r = document.createRange();
            const s = window.getSelection();
            if (prevEl.childNodes.length > 0) {
              r.setStartAfter(prevEl.lastChild);
            } else {
              r.setStart(prevEl, 0);
            }
            r.collapse(true);
            s.removeAllRanges();
            s.addRange(r);
          }
        }
      }
    }

    // Arrow down at bottom → focus next
    if (e.key === 'ArrowDown' && idx < elements.length - 1) {
      const sel = window.getSelection();
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const domRect = domEl?.getBoundingClientRect();
        if (domRect && Math.abs(rect.bottom - domRect.bottom) < 5) {
          e.preventDefault();
          const nextEl = blockRefs.current[elements[idx + 1].id];
          if (nextEl) {
            nextEl.focus();
            const r = document.createRange();
            const s = window.getSelection();
            r.setStart(nextEl, 0);
            r.collapse(true);
            s.removeAllRanges();
            s.addRange(r);
          }
        }
      }
    }
  }

  // ─── Input handler ───
  function handleInput(idx) {
    const el = elements[idx];
    const dom = blockRefs.current[el.id];
    if (!dom || suppressSync.current) return;
    const text = dom.textContent || '';
    updateElement(idx, { text });
    checkAutocomplete(idx, text);
  }

  // ─── Sync DOM from state on undo/redo ───
  useEffect(() => {
    if (!suppressSync.current) return;
    elements.forEach(el => {
      const dom = blockRefs.current[el.id];
      if (dom && dom.textContent !== el.text) {
        dom.textContent = el.text;
      }
    });
  }, [elements]);

  // ─── Page break indicators ───
  const pageBreakIndices = useMemo(() => {
    const breaks = [];
    let lines = 0;
    elements.forEach((el, idx) => {
      const typeDef = ELEMENT_TYPES[el.type];
      if (typeDef.blankBefore) lines += 1;
      const charWidth = el.type === 'dialogue' ? 35 : el.type === 'parenthetical' ? 25 : 60;
      const textLen = (el.text || '').length || 1;
      lines += Math.ceil(textLen / charWidth);
      if (lines >= LINES_PER_PAGE) {
        breaks.push(idx);
        lines = lines - LINES_PER_PAGE;
      }
    });
    return new Set(breaks);
  }, [elements]);

  // ─── Autocomplete dropdown position ───
  const acPosition = useMemo(() => {
    if (!autocomplete) return null;
    const el = elements[autocomplete.idx];
    if (!el) return null;
    const dom = blockRefs.current[el.id];
    if (!dom) return null;
    const rect = dom.getBoundingClientRect();
    const scrollRect = editorScrollRef.current?.getBoundingClientRect();
    if (!scrollRect) return null;
    return {
      top: rect.bottom - scrollRect.top + editorScrollRef.current.scrollTop + 4,
      left: rect.left - scrollRect.left,
    };
  }, [autocomplete, elements]);

  if (!loaded) return <div style={s.loading}>Loading screenplay...</div>;

  return (
    <div style={s.page}>
      {/* ─── Toolbar ─── */}
      <div style={s.toolbar}>
        <button onClick={onBack} style={s.backBtn}>← Back</button>
        <span style={s.titleText}>{title}</span>

        {/* Element type buttons */}
        <div style={s.toolGroup}>
          {Object.entries(ELEMENT_TYPES).map(([type, def]) => (
            <button
              key={type}
              onClick={() => { if (focusedIdx >= 0 && focusedIdx < elements.length) changeType(focusedIdx, type); }}
              style={{
                ...s.typeBtn,
                ...(elements[focusedIdx]?.type === type ? s.typeBtnActive : {}),
              }}
            >{def.shortLabel}</button>
          ))}
        </div>

        <div style={s.toolGroup}>
          <button onClick={handleUndo} disabled={undoLen === 0} style={s.toolBtn} title="Undo">↩</button>
          <button onClick={handleRedo} disabled={redoLen === 0} style={s.toolBtn} title="Redo">↪</button>
        </div>

        <span style={s.pageCount}>~{pageCount} pg</span>

        <button onClick={() => setShowSceneNav(!showSceneNav)} style={{ ...s.navBtn, ...(showSceneNav ? s.navBtnActive : {}) }}>
          Scenes
        </button>
        <button onClick={() => setShowTitlePage(true)} style={s.navBtn}>Title Page</button>
        <button onClick={handleExportPDF} style={s.exportBtn}>PDF</button>
        <button onClick={save} style={s.saveBtn}>{saving ? 'Saving...' : 'Save'}</button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name) onSaveTemplate(name, 'screenplay', { titlePage, elements, notes: [] });
        }} style={s.templateBtn}>Template</button>
      </div>

      {/* ─── Main area ─── */}
      <div style={s.mainArea}>
        {/* Scene Navigator */}
        {showSceneNav && (
          <div style={s.sceneNav}>
            <div style={s.sceneNavHeader}>Scenes</div>
            {sceneHeadings.length === 0 ? (
              <div style={s.sceneNavEmpty}>No scenes yet</div>
            ) : (
              sceneHeadings.map((sh, i) => (
                <button key={sh.id} onClick={() => jumpToScene(sh.id)} style={s.sceneNavItem}>
                  <span style={s.sceneNavNum}>{i + 1}</span>
                  <span style={s.sceneNavText}>{sh.text.toUpperCase()}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Editor scroll area */}
        <div ref={editorScrollRef} style={s.editorScroll}>
          <div style={s.pageContainer}>
            {elements.map((el, idx) => {
              const typeDef = ELEMENT_TYPES[el.type];
              const margins = ELEMENT_MARGINS[el.type];
              const isPageBreak = pageBreakIndices.has(idx);

              return (
                <React.Fragment key={el.id}>
                  {typeDef.blankBefore && idx > 0 && <div style={s.blankLine} />}
                  <div
                    ref={node => { blockRefs.current[el.id] = node; }}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    data-placeholder={getPlaceholder(el.type)}
                    onFocus={() => setFocusedIdx(idx)}
                    onInput={() => handleInput(idx)}
                    onKeyDown={(e) => handleKeyDown(e, idx)}
                    onBlur={() => {
                      // Sync on blur
                      const dom = blockRefs.current[el.id];
                      if (dom && dom.textContent !== el.text) {
                        pushUndo(elements);
                        updateElement(idx, { text: dom.textContent || '' });
                      }
                    }}
                    style={{
                      ...s.block,
                      paddingLeft: `${(margins.left - 1.0) * 60}px`,
                      paddingRight: `${(margins.right - 0.5) * 60}px`,
                      textTransform: typeDef.uppercase ? 'uppercase' : 'none',
                      textAlign: el.type === 'transition' ? 'right' : 'left',
                      ...(focusedIdx === idx ? s.blockFocused : {}),
                    }}
                  >{el.text}</div>
                  {isPageBreak && <div style={s.pageBreak}><span style={s.pageBreakLabel}>page break</span></div>}
                </React.Fragment>
              );
            })}
            {/* Extra space at bottom for scrolling */}
            <div style={{ height: '300px' }} />
          </div>

          {/* Autocomplete dropdown */}
          {autocomplete && acPosition && (
            <div style={{ ...s.autocomplete, top: acPosition.top, left: acPosition.left }}>
              {autocomplete.items.map((item, i) => (
                <div
                  key={item}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAutocomplete(prev => ({ ...prev, selected: i }));
                    setTimeout(acceptAutocomplete, 10);
                  }}
                  style={{
                    ...s.acItem,
                    ...(i === autocomplete.selected ? s.acItemActive : {}),
                  }}
                >{item}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Title Page Modal ─── */}
      {showTitlePage && (
        <div style={s.modalOverlay} onClick={() => setShowTitlePage(false)}>
          <div style={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={s.modalTitle}>Title Page</h2>
            {[
              ['title', 'Title'],
              ['writtenBy', 'Written By'],
              ['basedOn', 'Based On'],
              ['draft', 'Draft'],
              ['date', 'Date'],
              ['contact', 'Contact'],
            ].map(([key, label]) => (
              <div key={key} style={s.modalField}>
                <label style={s.modalLabel}>{label}</label>
                <input
                  value={titlePage[key]}
                  onChange={(e) => setTitlePage(prev => ({ ...prev, [key]: e.target.value }))}
                  style={s.modalInput}
                  placeholder={label}
                />
              </div>
            ))}
            <div style={s.modalActions}>
              <button onClick={() => setShowTitlePage(false)} style={s.modalDoneBtn}>Done</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        [data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: rgba(255,255,255,0.15);
          pointer-events: none;
        }
        [contenteditable]:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}

function getPlaceholder(type) {
  switch (type) {
    case 'sceneHeading': return 'INT./EXT. LOCATION - TIME';
    case 'action': return 'Action description...';
    case 'character': return 'CHARACTER NAME';
    case 'dialogue': return 'Dialogue...';
    case 'parenthetical': return '(parenthetical)';
    case 'transition': return 'CUT TO:';
    default: return '';
  }
}

// ─── Styles ───
const s = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a14' },
  loading: { padding: '40px', color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)',
    flexWrap: 'wrap',
  },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '6px 10px' },
  titleText: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginRight: 'auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: '2px', padding: '0 6px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  typeBtn: {
    padding: '3px 7px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '4px', color: 'rgba(255,255,255,0.4)', fontSize: '10px', fontWeight: 600,
    cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.5px',
  },
  typeBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  toolBtn: { minWidth: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit', padding: '0 6px' },
  pageCount: { fontSize: '11px', color: 'rgba(255,255,255,0.3)', padding: '0 4px', borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: '10px' },
  navBtn: { padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: 'rgba(255,255,255,0.45)', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  navBtnActive: { background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  exportBtn: { padding: '5px 12px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '5px', color: '#93c5fd', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  saveBtn: { padding: '5px 12px', background: '#22c55e', border: 'none', borderRadius: '5px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  templateBtn: { padding: '5px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: 'rgba(255,255,255,0.35)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit' },

  // Main area
  mainArea: { flex: 1, display: 'flex', overflow: 'hidden' },

  // Scene navigator
  sceneNav: {
    width: '220px', borderRight: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.015)', overflowY: 'auto', flexShrink: 0,
  },
  sceneNavHeader: { padding: '12px 14px', fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  sceneNavEmpty: { padding: '16px 14px', fontSize: '12px', color: 'rgba(255,255,255,0.2)' },
  sceneNavItem: {
    display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 14px',
    background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.03)',
    color: 'rgba(255,255,255,0.6)', fontSize: '11px', cursor: 'pointer',
    fontFamily: "'Courier New', Courier, monospace", textAlign: 'left', width: '100%',
  },
  sceneNavNum: { color: 'rgba(99,102,241,0.6)', fontWeight: 700, flexShrink: 0 },
  sceneNavText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  // Editor scroll area
  editorScroll: { flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '24px 20px', position: 'relative' },

  // Page container (white page look)
  pageContainer: {
    width: '100%', maxWidth: '680px', minHeight: '100%',
    background: 'rgba(255,255,255,0.025)', borderRadius: '4px',
    border: '1px solid rgba(255,255,255,0.06)',
    padding: '60px 40px',
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: '13px', lineHeight: '20px',
  },

  // Block styles
  blankLine: { height: '20px' },
  block: {
    padding: '1px 4px', minHeight: '20px',
    color: 'rgba(255,255,255,0.82)',
    borderRadius: '2px', transition: 'background 0.1s',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  blockFocused: { background: 'rgba(99,102,241,0.04)' },

  // Page breaks
  pageBreak: {
    borderBottom: '1px dashed rgba(255,255,255,0.1)', margin: '8px 0',
    display: 'flex', justifyContent: 'center',
  },
  pageBreakLabel: { fontSize: '9px', color: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.025)', padding: '0 8px', position: 'relative', top: '5px' },

  // Autocomplete
  autocomplete: {
    position: 'absolute', zIndex: 100,
    background: '#1e1e30', border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: '6px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    maxHeight: '200px', overflowY: 'auto', minWidth: '200px',
  },
  acItem: {
    padding: '6px 12px', fontSize: '12px', color: 'rgba(255,255,255,0.7)',
    fontFamily: "'Courier New', Courier, monospace",
    cursor: 'pointer',
  },
  acItemActive: { background: 'rgba(99,102,241,0.2)', color: '#fff' },

  // Modal
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
  },
  modal: {
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '14px', padding: '28px', width: '420px', maxWidth: '90vw',
  },
  modalTitle: { fontSize: '18px', fontWeight: 700, color: '#fff', margin: '0 0 20px' },
  modalField: { marginBottom: '14px' },
  modalLabel: { display: 'block', fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' },
  modalInput: {
    width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
    color: '#fff', fontSize: '14px', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  },
  modalActions: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' },
  modalDoneBtn: { padding: '8px 20px', background: '#6366f1', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
};
