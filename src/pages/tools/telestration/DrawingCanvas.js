import React, { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as fabric from 'fabric';
import { CUSTOM_FABRIC_PROPS, DEFAULT_ANNOTATION_DURATION } from './telestrationConstants';

const MAX_UNDO = 50;

const DrawingCanvas = forwardRef(function DrawingCanvas(
  { activeTool, drawColor, strokeWidth, containerSize, currentTime, annotationStore },
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

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    undo,
    redo,
    deleteSelected,
    getCanvas: () => fabricRef.current,
    selectByAnnotationId,
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

    fc.on('object:modified', pushHistory);
    fc.on('object:added', handleObjectAdded);
    fc.on('object:removed', () => { if (!skipHistory.current) pushHistory(); });

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
    if (!fc || !annotationStore) return;

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
    annotationStore.addAnnotation({
      id,
      fabricJSON: lastObj.toJSON(CUSTOM_FABRIC_PROPS),
      startTime: time,
      endTime: time + DEFAULT_ANNOTATION_DURATION,
      color,
      type: tool,
    });

    pushHistory();
  }, [annotationStore]); // eslint-disable-line

  // Re-attach the object:added listener when annotationStore changes
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.off('object:added', handleObjectAdded);
    fc.on('object:added', handleObjectAdded);
  }, [handleObjectAdded]);

  // --- Visibility sync: show/hide objects based on currentTime ---
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !annotationStore) return;
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
  }, [currentTime, annotationStore]);

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

    // Clean up shape-drawing listeners
    fc.off('mouse:down', handleShapeStart);
    fc.off('mouse:move', handleShapeDrag);
    fc.off('mouse:up', handleShapeEnd);
    fc.off('mouse:down', handleTextClick);

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
  const handleShapeStart = useCallback((opt) => {
    const fc = fabricRef.current;
    if (!fc) return;
    const pointer = fc.getScenePoint(opt.e);
    originRef.current = { x: pointer.x, y: pointer.y };
    drawingShapeRef.current = null;
  }, []);

  const handleShapeDrag = useCallback((opt) => {
    const fc = fabricRef.current;
    if (!fc || !originRef.current) return;
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
    // Finalize: make selectable and push history
    const shape = drawingShapeRef.current;
    shape.set({ selectable: true, evented: true });
    drawingShapeRef.current = null;
    originRef.current = null;
    pushHistory();
  }, []);

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
      if (obj.annotationId && annotationStore) {
        annotationStore.removeAnnotation(obj.annotationId);
      }
      fc.remove(obj);
    });
    fc.discardActiveObject();
    fc.renderAll();
    pushHistory();
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
    });
  }

  return (
    <canvas
      ref={canvasElRef}
      style={styles.canvas}
    />
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
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'auto',
  },
};
