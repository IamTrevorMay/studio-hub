import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as fabric from 'fabric';
import { CUSTOM_FABRIC_PROPS, DEFAULT_ANNOTATION_DURATION } from './telestrationConstants';

const MAX_UNDO = 50;

const DrawingCanvas = forwardRef(function DrawingCanvas(
  { activeTool, drawColor, strokeWidth, containerSize, currentTime, annotationStore, staticMode = false },
  ref
) {
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const skipHistory = useRef(false);
  const drawingShapeRef = useRef(null);
  const originRef = useRef(null);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const annotationStoreRef = useRef(annotationStore);
  annotationStoreRef.current = annotationStore;
  const staticModeRef = useRef(staticMode);
  staticModeRef.current = staticMode;
  const clipboardRef = useRef(null);
  const wrapperRef = useRef(null);

  const [hasSelection, setHasSelection] = useState(false);
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0 });

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    undo,
    redo,
    deleteSelected,
    copy,
    cut,
    paste,
    duplicate,
    getCanvas: () => fabricRef.current,
    selectByAnnotationId,
    getCanvasJSON,
    loadCanvasJSON,
    clearCanvas,
    get undoLen() { return undoStack.current.length; },
    get redoLen() { return redoStack.current.length; },
  }));

  // --- Init Fabric canvas ---
  useEffect(() => {
    if (!canvasElRef.current || fabricRef.current) return;
    const fc = new fabric.Canvas(canvasElRef.current, {
      width: containerSize.width || 960,
      height: containerSize.height || 540,
      backgroundColor: 'transparent',
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = fc;

    // Fabric wraps the canvas in a div — style it to fill our container
    const wrapper = fc.wrapperEl || canvasElRef.current?.parentElement;
    if (wrapper) {
      wrapper.style.position = 'absolute';
      wrapper.style.top = '0';
      wrapper.style.left = '0';
      wrapper.style.width = '100%';
      wrapper.style.height = '100%';
    }

    fc.on('object:modified', pushHistory);
    fc.on('object:added', handleObjectAdded);
    fc.on('object:removed', () => { if (!skipHistory.current) pushHistory(); });
    fc.on('selection:created', () => setHasSelection(true));
    fc.on('selection:updated', () => setHasSelection(true));
    fc.on('selection:cleared', () => setHasSelection(false));

    pushHistory();

    return () => {
      fc.dispose();
      fabricRef.current = null;
    };
  }, []); // eslint-disable-line

  // --- Handle new objects: tag with annotation metadata + register in store ---
  const handleObjectAdded = useCallback(() => {
    if (skipHistory.current) return;
    const fc = fabricRef.current;
    if (!fc || !annotationStoreRef.current) return;

    // Find the most recently added object without an annotationId
    const objects = fc.getObjects();
    const lastObj = objects[objects.length - 1];
    if (!lastObj || lastObj.annotationId) {
      pushHistory();
      return;
    }

    // Tag the Fabric object
    const id = crypto.randomUUID();
    const time = currentTimeRef.current || 0;
    lastObj.set('annotationId', id);
    lastObj.set('startTime', time);
    lastObj.set('endTime', time + DEFAULT_ANNOTATION_DURATION);

    // Register in annotation store
    const tool = fc._telestrationTool || 'pen';
    const color = fc._telestrationColor || '#ef4444';
    annotationStoreRef.current.addAnnotation({
      id,
      fabricJSON: lastObj.toJSON(CUSTOM_FABRIC_PROPS),
      startTime: time,
      endTime: time + DEFAULT_ANNOTATION_DURATION,
      color,
      type: tool,
    });

    pushHistory();
  }, []); // eslint-disable-line

  // Re-attach the object:added listener when annotationStore changes
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.off('object:added', handleObjectAdded);
    fc.on('object:added', handleObjectAdded);
  }, [handleObjectAdded]);

  // --- Visibility sync: show/hide objects based on currentTime (or show all in static mode) ---
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (staticModeRef.current) {
      let changed = false;
      fc.forEachObject(obj => {
        if (obj.annotationId && !obj.visible) { obj.set('visible', true); changed = true; }
      });
      if (changed) fc.renderAll();
      return;
    }
    if (!annotationStore) return;
    const visibleIds = annotationStore.getVisibleIds(currentTime);
    let changed = false;
    fc.forEachObject(obj => {
      if (!obj.annotationId) return;
      const shouldBeVisible = visibleIds.has(obj.annotationId);
      if (obj.visible !== shouldBeVisible) {
        obj.set('visible', shouldBeVisible);
        changed = true;
      }
    });
    if (changed) fc.renderAll();
  }, [currentTime, annotationStore, staticMode]);

  // --- Resize canvas when container changes ---
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !containerSize.width || !containerSize.height) return;
    fc.setDimensions({ width: containerSize.width, height: containerSize.height });
    fc.renderAll();
  }, [containerSize.width, containerSize.height]);

  // --- Tool switching ---
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    if (activeTool === 'pen' || activeTool === 'highlighter') {
      fc.isDrawingMode = true;
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
      if (activeTool === 'highlighter') {
        fc.freeDrawingBrush.color = hexToRgba(drawColor, 0.35);
        fc.freeDrawingBrush.width = strokeWidth * 6;
      } else {
        fc.freeDrawingBrush.color = drawColor;
        fc.freeDrawingBrush.width = strokeWidth;
      }
      fc.selection = false;
      fc.defaultCursor = 'crosshair';
    } else if (activeTool === 'select') {
      fc.isDrawingMode = false;
      fc.selection = true;
      fc.defaultCursor = 'default';
      fc.forEachObject(o => {
        if (o.visible) { o.selectable = true; o.evented = true; }
      });
    } else if (activeTool === 'text') {
      fc.isDrawingMode = false;
      fc.selection = false;
      fc.defaultCursor = 'text';
      fc.forEachObject(o => { o.selectable = false; o.evented = false; });
      fc.on('mouse:down', handleTextClick);
    } else {
      // Shape tools: line, arrow, circle, triangle, square
      fc.isDrawingMode = false;
      fc.selection = false;
      fc.defaultCursor = 'crosshair';
      fc.forEachObject(o => { o.selectable = false; o.evented = false; });
      fc.on('mouse:down', handleShapeStart);
      fc.on('mouse:move', handleShapeDrag);
      fc.on('mouse:up', handleShapeEnd);
    }

    // Cleanup: remove all tool-specific listeners before next run or on unmount
    return () => {
      fc.off('mouse:down', handleShapeStart);
      fc.off('mouse:move', handleShapeDrag);
      fc.off('mouse:up', handleShapeEnd);
      fc.off('mouse:down', handleTextClick);
    };
  }, [activeTool, drawColor, strokeWidth]); // eslint-disable-line

  // --- Update brush when color/width changes during pen/highlighter ---
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (activeTool === 'pen' && fc.freeDrawingBrush) {
      fc.freeDrawingBrush.color = drawColor;
      fc.freeDrawingBrush.width = strokeWidth;
    } else if (activeTool === 'highlighter' && fc.freeDrawingBrush) {
      fc.freeDrawingBrush.color = hexToRgba(drawColor, 0.35);
      fc.freeDrawingBrush.width = strokeWidth * 6;
    }
  }, [drawColor, strokeWidth, activeTool]);

  // --- Shape drawing handlers ---
  const SHAPE_TOOLS = ['line', 'arrow', 'circle', 'triangle', 'square'];

  const handleShapeStart = useCallback((opt) => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (!SHAPE_TOOLS.includes(fc._telestrationTool)) return; // guard: no-op if not in shape mode
    const pointer = fc.getScenePoint(opt.e);
    originRef.current = { x: pointer.x, y: pointer.y };
    drawingShapeRef.current = null;
  }, []); // eslint-disable-line

  const handleShapeDrag = useCallback((opt) => {
    const fc = fabricRef.current;
    if (!fc || !originRef.current) return;
    if (!SHAPE_TOOLS.includes(fc._telestrationTool)) return; // guard
    const pointer = fc.getScenePoint(opt.e);
    const ox = originRef.current.x;
    const oy = originRef.current.y;
    const dx = pointer.x - ox;
    const dy = pointer.y - oy;

    // Remove preview shape
    if (drawingShapeRef.current) {
      skipHistory.current = true;
      fc.remove(drawingShapeRef.current);
      skipHistory.current = false;
    }

    const tool = fabricRef.current._telestrationTool || 'line';
    let shape = null;
    const baseOpts = { fill: 'transparent', stroke: fabricRef.current._telestrationColor || '#ef4444', strokeWidth: fabricRef.current._telestrationStroke || 4, selectable: false, evented: false };

    switch (tool) {
      case 'line':
        shape = new fabric.Line([ox, oy, pointer.x, pointer.y], { ...baseOpts, fill: undefined });
        break;
      case 'arrow': {
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const line = new fabric.Line([ox, oy, pointer.x, pointer.y], { stroke: baseOpts.stroke, strokeWidth: baseOpts.strokeWidth });
        const headSize = Math.max(12, baseOpts.strokeWidth * 4);
        const head = new fabric.Triangle({
          left: pointer.x,
          top: pointer.y,
          width: headSize,
          height: headSize,
          fill: baseOpts.stroke,
          angle: angle + 90,
          originX: 'center',
          originY: 'center',
        });
        shape = new fabric.Group([line, head], { selectable: false, evented: false });
        break;
      }
      case 'circle': {
        const radius = Math.sqrt(dx * dx + dy * dy);
        shape = new fabric.Circle({ ...baseOpts, left: ox - radius, top: oy - radius, radius });
        break;
      }
      case 'triangle': {
        const left = Math.min(ox, pointer.x);
        const top = Math.min(oy, pointer.y);
        shape = new fabric.Triangle({ ...baseOpts, left, top, width: Math.abs(dx), height: Math.abs(dy) });
        break;
      }
      case 'square': {
        const left = Math.min(ox, pointer.x);
        const top = Math.min(oy, pointer.y);
        shape = new fabric.Rect({ ...baseOpts, left, top, width: Math.abs(dx), height: Math.abs(dy) });
        break;
      }
      default:
        break;
    }

    if (shape) {
      skipHistory.current = true;
      fc.add(shape);
      skipHistory.current = false;
      drawingShapeRef.current = shape;
      fc.renderAll();
    }
  }, []);

  const handleShapeEnd = useCallback(() => {
    const fc = fabricRef.current;
    if (!fc || !drawingShapeRef.current) {
      originRef.current = null;
      return;
    }
    if (!SHAPE_TOOLS.includes(fc._telestrationTool)) { // guard
      drawingShapeRef.current = null;
      originRef.current = null;
      return;
    }
    const shape = drawingShapeRef.current;

    const id = crypto.randomUUID();
    const time = currentTimeRef.current || 0;
    const tool = fc._telestrationTool || 'line';
    const color = fc._telestrationColor || '#ef4444';
    shape.set('annotationId', id);
    shape.set('startTime', time);
    shape.set('endTime', time + DEFAULT_ANNOTATION_DURATION);
    shape.set('annotationType', tool);

    if (annotationStoreRef.current) {
      annotationStoreRef.current.addAnnotation({
        id,
        fabricJSON: shape.toJSON(CUSTOM_FABRIC_PROPS),
        startTime: time,
        endTime: time + DEFAULT_ANNOTATION_DURATION,
        color,
        type: tool,
      });
    }

    drawingShapeRef.current = null;
    originRef.current = null;
    pushHistory();
  }, []); // eslint-disable-line

  // Store current tool/color/stroke on fabric instance for use in callbacks
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc._telestrationTool = activeTool;
    fc._telestrationColor = drawColor;
    fc._telestrationStroke = strokeWidth;
  }, [activeTool, drawColor, strokeWidth]);

  // --- Text click handler ---
  const handleTextClick = useCallback((opt) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const pointer = fc.getScenePoint(opt.e);
    const text = new fabric.IText('Text', {
      left: pointer.x,
      top: pointer.y,
      fontSize: Math.max(24, (fabricRef.current._telestrationStroke || 4) * 8),
      fill: fabricRef.current._telestrationColor || '#ef4444',
      fontFamily: "'DM Sans', Arial, sans-serif",
      selectable: true,
      evented: true,
    });
    fc.add(text);
    fc.setActiveObject(text);
    text.enterEditing();
    fc.renderAll();
  }, []);

  // --- Select an object by annotationId ---
  function selectByAnnotationId(annotationId) {
    const fc = fabricRef.current;
    if (!fc) return;
    const obj = fc.getObjects().find(o => o.annotationId === annotationId);
    if (obj) {
      fc.setActiveObject(obj);
      fc.renderAll();
    }
  }

  // --- Delete selected (also removes from annotation store) ---
  function deleteSelected() {
    const fc = fabricRef.current;
    if (!fc) return;
    const active = fc.getActiveObjects();
    if (active.length === 0) return;
    active.forEach(obj => {
      if (obj.annotationId && annotationStoreRef.current) {
        annotationStoreRef.current.removeAnnotation(obj.annotationId);
      }
      fc.remove(obj);
    });
    fc.discardActiveObject();
    fc.renderAll();
    pushHistory();
  }

  // --- Sync annotation store from canvas objects (canvas is source of truth after undo/redo) ---
  function syncStoreFromCanvas() {
    const fc = fabricRef.current;
    const store = annotationStoreRef.current;
    if (!fc || !store) return;
    const objs = fc.getObjects().filter(o => o.annotationId);
    const rebuilt = objs.map(o => ({
      id: o.annotationId,
      fabricJSON: o.toJSON(CUSTOM_FABRIC_PROPS),
      startTime: o.startTime ?? 0,
      endTime: o.endTime ?? (o.startTime ?? 0) + DEFAULT_ANNOTATION_DURATION,
      color: o.stroke || '#ef4444',
      type: o.annotationType || 'pen',
    }));
    store.replaceAnnotations(rebuilt);
  }

  // --- Undo / Redo ---
  function pushHistory() {
    const fc = fabricRef.current;
    if (!fc || skipHistory.current) return;
    const json = fc.toJSON(CUSTOM_FABRIC_PROPS);
    undoStack.current.push(JSON.stringify(json));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }

  function undo() {
    const fc = fabricRef.current;
    if (!fc || undoStack.current.length <= 1) return;
    const current = undoStack.current.pop();
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    skipHistory.current = true;
    fc.loadFromJSON(JSON.parse(prev), () => {
      fc.renderAll();
      skipHistory.current = false;
      syncStoreFromCanvas();
    });
  }

  function redo() {
    const fc = fabricRef.current;
    if (!fc || redoStack.current.length === 0) return;
    const next = redoStack.current.pop();
    undoStack.current.push(next);
    skipHistory.current = true;
    fc.loadFromJSON(JSON.parse(next), () => {
      fc.renderAll();
      skipHistory.current = false;
      syncStoreFromCanvas();
    });
  }

  // --- Copy / Cut / Paste / Duplicate ---
  async function copy() {
    const fc = fabricRef.current;
    if (!fc) return;
    const active = fc.getActiveObject();
    if (!active) return;
    clipboardRef.current = await active.clone(CUSTOM_FABRIC_PROPS);
  }

  async function cut() {
    await copy();
    deleteSelected();
  }

  async function paste() {
    const fc = fabricRef.current;
    if (!fc || !clipboardRef.current) return;
    const cloned = await clipboardRef.current.clone(CUSTOM_FABRIC_PROPS);
    cloned.set({
      annotationId: undefined,
      startTime: undefined,
      endTime: undefined,
      annotationType: undefined,
      left: (cloned.left || 0) + 20,
      top: (cloned.top || 0) + 20,
      selectable: true,
      evented: true,
    });
    skipHistory.current = true;
    fc.add(cloned);
    skipHistory.current = false;
    fc.setActiveObject(cloned);

    const id = crypto.randomUUID();
    const time = currentTimeRef.current || 0;
    const color = cloned.stroke || fc._telestrationColor || '#ef4444';
    const type = cloned.annotationType || fc._telestrationTool || 'pen';
    cloned.set('annotationId', id);
    cloned.set('startTime', time);
    cloned.set('endTime', time + DEFAULT_ANNOTATION_DURATION);
    cloned.set('annotationType', type);

    if (annotationStoreRef.current) {
      annotationStoreRef.current.addAnnotation({
        id,
        fabricJSON: cloned.toJSON(CUSTOM_FABRIC_PROPS),
        startTime: time,
        endTime: time + DEFAULT_ANNOTATION_DURATION,
        color,
        type,
      });
    }
    pushHistory();
    fc.renderAll();
  }

  async function duplicate() {
    const fc = fabricRef.current;
    if (!fc) return;
    const active = fc.getActiveObject();
    if (!active) return;
    const cloned = await active.clone(CUSTOM_FABRIC_PROPS);
    cloned.set({
      annotationId: undefined,
      startTime: undefined,
      endTime: undefined,
      annotationType: undefined,
      left: (cloned.left || 0) + 20,
      top: (cloned.top || 0) + 20,
      selectable: true,
      evented: true,
    });
    skipHistory.current = true;
    fc.add(cloned);
    skipHistory.current = false;
    fc.setActiveObject(cloned);

    const id = crypto.randomUUID();
    const time = currentTimeRef.current || 0;
    const color = cloned.stroke || fc._telestrationColor || '#ef4444';
    const type = cloned.annotationType || fc._telestrationTool || 'pen';
    cloned.set('annotationId', id);
    cloned.set('startTime', time);
    cloned.set('endTime', time + DEFAULT_ANNOTATION_DURATION);
    cloned.set('annotationType', type);

    if (annotationStoreRef.current) {
      annotationStoreRef.current.addAnnotation({
        id,
        fabricJSON: cloned.toJSON(CUSTOM_FABRIC_PROPS),
        startTime: time,
        endTime: time + DEFAULT_ANNOTATION_DURATION,
        color,
        type,
      });
    }
    pushHistory();
    fc.renderAll();
  }

  // --- Static mode: get/load/clear canvas JSON ---
  function getCanvasJSON() {
    const fc = fabricRef.current;
    if (!fc) return null;
    return fc.toJSON(CUSTOM_FABRIC_PROPS);
  }

  function loadCanvasJSON(json) {
    const fc = fabricRef.current;
    if (!fc) return;
    skipHistory.current = true;
    fc.loadFromJSON(json, () => {
      fc.renderAll();
      skipHistory.current = false;
      // Only sync annotation store in video mode — static mode manages its own canvas
      if (!staticModeRef.current) syncStoreFromCanvas();
      const initial = fc.toJSON(CUSTOM_FABRIC_PROPS);
      undoStack.current = [JSON.stringify(initial)];
      redoStack.current = [];
    });
  }

  function clearCanvas() {
    const fc = fabricRef.current;
    if (!fc) return;
    skipHistory.current = true;
    fc.clear();
    skipHistory.current = false;
    // Only clear annotation store in video mode — avoids wiping video annotations on mode switch
    if (!staticModeRef.current && annotationStoreRef.current) {
      annotationStoreRef.current.replaceAnnotations([]);
    }
    const initial = fc.toJSON(CUSTOM_FABRIC_PROPS);
    undoStack.current = [JSON.stringify(initial)];
    redoStack.current = [];
  }

  // --- Right-click context menu ---
  function handleContextMenu(e) {
    e.preventDefault();
    const rect = wrapperRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : e.clientX;
    const y = rect ? e.clientY - rect.top : e.clientY;
    setContextMenu({ visible: true, x, y });
  }

  function dismissContextMenu() {
    setContextMenu({ visible: false, x: 0, y: 0 });
  }

  useEffect(() => {
    if (!contextMenu.visible) return;
    function onDown() { dismissContextMenu(); }
    function onKey(e) { if (e.key === 'Escape') dismissContextMenu(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu.visible]); // eslint-disable-line

  return (
    <div ref={wrapperRef} style={styles.wrapper} onContextMenu={handleContextMenu}>
      <canvas ref={canvasElRef} />
      {contextMenu.visible && (
        <div
          style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            style={{ ...styles.ctxItem, ...(hasSelection ? {} : styles.ctxItemDisabled) }}
            disabled={!hasSelection}
            onClick={() => { copy(); dismissContextMenu(); }}
          >Copy</button>
          <button
            style={{ ...styles.ctxItem, ...(hasSelection ? {} : styles.ctxItemDisabled) }}
            disabled={!hasSelection}
            onClick={() => { cut(); dismissContextMenu(); }}
          >Cut</button>
          <button
            style={{ ...styles.ctxItem, ...(!clipboardRef.current ? styles.ctxItemDisabled : {}) }}
            disabled={!clipboardRef.current}
            onClick={() => { paste(); dismissContextMenu(); }}
          >Paste</button>
          <button
            style={{ ...styles.ctxItem, ...(hasSelection ? {} : styles.ctxItemDisabled) }}
            disabled={!hasSelection}
            onClick={() => { duplicate(); dismissContextMenu(); }}
          >Duplicate</button>
          <div style={styles.ctxDivider} />
          <button
            style={{ ...styles.ctxItem, ...styles.ctxItemDelete, ...(hasSelection ? {} : styles.ctxItemDisabled) }}
            disabled={!hasSelection}
            onClick={() => { deleteSelected(); dismissContextMenu(); }}
          >Delete</button>
        </div>
      )}
    </div>
  );
});

export default DrawingCanvas;

// --- Helpers ---

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const styles = {
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'auto',
    zIndex: 1,
  },
  contextMenu: {
    position: 'absolute',
    background: '#1e1e2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '4px',
    minWidth: '140px',
    zIndex: 50,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.85)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '7px 12px',
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: '5px',
    transition: 'background 0.1s',
  },
  ctxItemDisabled: {
    color: 'rgba(255,255,255,0.25)',
    cursor: 'default',
  },
  ctxItemDelete: {
    color: '#f87171',
  },
  ctxDivider: {
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
    margin: '4px 0',
  },
};
