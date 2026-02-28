import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import * as fabric from 'fabric';
import { jsPDF } from 'jspdf';
import {
  SILHOUETTES, PROPS, SHOT_TYPES, TRANSITIONS,
  DRAW_COLORS, STROKE_WIDTHS,
} from './storyboardAssets';

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const MAX_UNDO = 30;
const GRID_SIZE = 20;

const EMPTY_ANNOTATIONS = {
  scene: '', shot: '', description: '', action: '', dialogue: '',
  shotType: '', transition: '',
};

export default function Storyboard({ docId, title, onBack, onSaveTemplate }) {
  // Canvas refs
  const canvasElRef = useRef(null);
  const fabricRef = useRef(null);
  const containerRef = useRef(null);

  // Pages
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [annotations, setAnnotations] = useState({ ...EMPTY_ANNOTATIONS });

  // Tools
  const [activeTool, setActiveTool] = useState('select');
  const [drawColor, setDrawColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [shapeType, setShapeType] = useState('rect');

  // UI panels
  const [showLayers, setShowLayers] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showImageLib, setShowImageLib] = useState(false);
  const [viewMode, setViewMode] = useState('canvas'); // canvas | grid
  const [showGuides, setShowGuides] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showGrid, setShowGrid] = useState(false);

  // Dropdowns
  const [showSilhouettes, setShowSilhouettes] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const [showShotTypes, setShowShotTypes] = useState(false);
  const [showTransitions, setShowTransitions] = useState(false);

  // Zoom
  const [zoom, setZoom] = useState(50);

  // Undo/redo
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);
  const skipHistory = useRef(false);

  // Assets
  const [assets, setAssets] = useState([]);
  const [uploading, setUploading] = useState(false);

  // Layers
  const [layerList, setLayerList] = useState([]);

  // Save state
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef(null);
  const [loaded, setLoaded] = useState(false);

  // Page thumbnails for grid view
  const [thumbnails, setThumbnails] = useState({});

  // Drag state for grid reorder
  const dragIdx = useRef(null);

  // ------- INIT -------
  useEffect(() => {
    loadPages();
    loadAssets();
    return () => {
      if (fabricRef.current) fabricRef.current.dispose();
    };
  }, [docId]);

  // Init fabric canvas after first page load
  useEffect(() => {
    if (!loaded || !canvasElRef.current || fabricRef.current) return;
    const fc = new fabric.Canvas(canvasElRef.current, {
      width: CANVAS_W,
      height: CANVAS_H,
      backgroundColor: '#ffffff',
      selection: true,
      preserveObjectStacking: true,
    });
    fabricRef.current = fc;

    fc.on('object:modified', pushHistory);
    fc.on('object:added', () => { if (!skipHistory.current) pushHistory(); });
    fc.on('object:removed', () => { if (!skipHistory.current) pushHistory(); });
    fc.on('mouse:up', handleCanvasChange);
    fc.on('path:created', handleCanvasChange);
    fc.on('selection:created', updateLayers);
    fc.on('selection:updated', updateLayers);
    fc.on('selection:cleared', updateLayers);

    // Load first page
    if (pages.length > 0) {
      loadPageIntoCanvas(0);
    }
    pushHistory();
  }, [loaded]);

  // ------- DATA LOADING -------
  async function loadPages() {
    const { data, error } = await supabase
      .from('storyboard_pages')
      .select('*')
      .eq('document_id', docId)
      .order('page_number', { ascending: true });

    if (error) { console.error(error); return; }

    if (!data || data.length === 0) {
      // Create first page
      const { data: newPage, error: createErr } = await supabase
        .from('storyboard_pages')
        .insert({ document_id: docId, page_number: 1, canvas_data: {}, annotations: {} })
        .select()
        .single();
      if (createErr) { console.error(createErr); return; }
      setPages([newPage]);
    } else {
      setPages(data);
    }
    setLoaded(true);
  }

  async function loadAssets() {
    const { data } = await supabase
      .from('storyboard_assets')
      .select('*')
      .eq('document_id', docId)
      .order('created_at', { ascending: false });
    setAssets(data || []);
  }

  // ------- PAGE MANAGEMENT -------
  function loadPageIntoCanvas(pageIdx) {
    const fc = fabricRef.current;
    if (!fc) return;
    const page = pages[pageIdx];
    if (!page) return;

    skipHistory.current = true;
    fc.clear();
    fc.backgroundColor = '#ffffff';

    if (page.canvas_data && Object.keys(page.canvas_data).length > 0) {
      fc.loadFromJSON(page.canvas_data, () => {
        fc.renderAll();
        skipHistory.current = false;
        updateLayers();
      });
    } else {
      fc.renderAll();
      skipHistory.current = false;
      updateLayers();
    }

    setAnnotations(page.annotations && Object.keys(page.annotations).length > 0
      ? { ...EMPTY_ANNOTATIONS, ...page.annotations }
      : { ...EMPTY_ANNOTATIONS });

    // Reset undo/redo for new page
    undoStack.current = [];
    redoStack.current = [];
    setUndoLen(0);
    setRedoLen(0);
  }

  async function saveCurrentPage() {
    const fc = fabricRef.current;
    if (!fc || pages.length === 0) return;
    const page = pages[currentPage];
    if (!page) return;

    const canvasData = fc.toJSON();
    const { error } = await supabase
      .from('storyboard_pages')
      .update({
        canvas_data: canvasData,
        annotations,
        updated_at: new Date().toISOString(),
      })
      .eq('id', page.id);
    if (error) console.error('Save error:', error);
  }

  function triggerAutoSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await saveCurrentPage();
      setSaving(false);
    }, 2000);
  }

  function handleCanvasChange() {
    triggerAutoSave();
    updateLayers();
  }

  async function switchPage(newIdx) {
    if (newIdx === currentPage || newIdx < 0 || newIdx >= pages.length) return;
    // Save current
    setSaving(true);
    await saveCurrentPage();
    setSaving(false);
    // Generate thumbnail for current page before leaving
    generateThumbnail(currentPage);
    setCurrentPage(newIdx);
    loadPageIntoCanvas(newIdx);
  }

  async function addPage() {
    await saveCurrentPage();
    generateThumbnail(currentPage);
    const newNum = pages.length + 1;
    const { data, error } = await supabase
      .from('storyboard_pages')
      .insert({ document_id: docId, page_number: newNum, canvas_data: {}, annotations: {} })
      .select()
      .single();
    if (error) { console.error(error); return; }
    const newPages = [...pages, data];
    setPages(newPages);
    setCurrentPage(newPages.length - 1);
    loadPageIntoCanvas(newPages.length - 1);
  }

  async function duplicatePage() {
    const fc = fabricRef.current;
    if (!fc) return;
    await saveCurrentPage();
    generateThumbnail(currentPage);
    const canvasData = fc.toJSON();
    const newNum = pages.length + 1;
    const { data, error } = await supabase
      .from('storyboard_pages')
      .insert({ document_id: docId, page_number: newNum, canvas_data: canvasData, annotations })
      .select()
      .single();
    if (error) { console.error(error); return; }
    const newPages = [...pages, data];
    setPages(newPages);
    setCurrentPage(newPages.length - 1);
    loadPageIntoCanvas(newPages.length - 1);
  }

  async function deletePage(idx) {
    if (pages.length <= 1) return;
    if (!window.confirm(`Delete page ${idx + 1}?`)) return;
    const page = pages[idx];
    await supabase.from('storyboard_pages').delete().eq('id', page.id);
    const newPages = pages.filter((_, i) => i !== idx);
    // Renumber
    for (let i = 0; i < newPages.length; i++) {
      if (newPages[i].page_number !== i + 1) {
        await supabase.from('storyboard_pages').update({ page_number: i + 1 }).eq('id', newPages[i].id);
        newPages[i] = { ...newPages[i], page_number: i + 1 };
      }
    }
    setPages(newPages);
    const newIdx = Math.min(idx, newPages.length - 1);
    setCurrentPage(newIdx);
    loadPageIntoCanvas(newIdx);
  }

  // Grid view drag-to-reorder
  function handleGridDragStart(idx) { dragIdx.current = idx; }
  async function handleGridDrop(targetIdx) {
    const fromIdx = dragIdx.current;
    if (fromIdx === null || fromIdx === targetIdx) return;
    await saveCurrentPage();
    const newPages = [...pages];
    const [moved] = newPages.splice(fromIdx, 1);
    newPages.splice(targetIdx, 0, moved);
    // Renumber in DB
    for (let i = 0; i < newPages.length; i++) {
      if (newPages[i].page_number !== i + 1) {
        await supabase.from('storyboard_pages').update({ page_number: i + 1 }).eq('id', newPages[i].id);
        newPages[i] = { ...newPages[i], page_number: i + 1 };
      }
    }
    setPages(newPages);
    setCurrentPage(targetIdx);
    loadPageIntoCanvas(targetIdx);
    dragIdx.current = null;
  }

  // ------- THUMBNAILS -------
  function generateThumbnail(pageIdx) {
    const fc = fabricRef.current;
    if (!fc) return;
    try {
      const dataUrl = fc.toDataURL({ format: 'jpeg', quality: 0.4, multiplier: 0.15 });
      setThumbnails(prev => ({ ...prev, [pageIdx]: dataUrl }));
    } catch (e) { /* ignore */ }
  }

  // Generate all thumbnails when entering grid view
  async function generateAllThumbnails() {
    const fc = fabricRef.current;
    if (!fc) return;
    await saveCurrentPage();
    generateThumbnail(currentPage);

    const newThumbs = { ...thumbnails };
    for (let i = 0; i < pages.length; i++) {
      if (i === currentPage) continue;
      const page = pages[i];
      if (page.canvas_data && Object.keys(page.canvas_data).length > 0) {
        try {
          const tempCanvas = new fabric.StaticCanvas(null, {
            width: CANVAS_W, height: CANVAS_H, backgroundColor: '#ffffff',
          });
          await new Promise(resolve => {
            tempCanvas.loadFromJSON(page.canvas_data, () => {
              tempCanvas.renderAll();
              newThumbs[i] = tempCanvas.toDataURL({ format: 'jpeg', quality: 0.4, multiplier: 0.15 });
              tempCanvas.dispose();
              resolve();
            });
          });
        } catch (e) { /* ignore */ }
      }
    }
    setThumbnails(newThumbs);
  }

  // ------- TOOLS -------
  function setTool(tool) {
    const fc = fabricRef.current;
    if (!fc) return;
    setActiveTool(tool);
    closeAllDropdowns();

    if (tool === 'draw') {
      fc.isDrawingMode = true;
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
      fc.freeDrawingBrush.color = drawColor;
      fc.freeDrawingBrush.width = strokeWidth;
    } else {
      fc.isDrawingMode = false;
    }

    if (tool === 'select') {
      fc.selection = true;
      fc.defaultCursor = 'default';
    }
  }

  // Update brush when color/width changes
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || activeTool !== 'draw') return;
    if (fc.freeDrawingBrush) {
      fc.freeDrawingBrush.color = drawColor;
      fc.freeDrawingBrush.width = strokeWidth;
    }
  }, [drawColor, strokeWidth, activeTool]);

  function addText() {
    const fc = fabricRef.current;
    if (!fc) return;
    const text = new fabric.IText('Double-click to edit', {
      left: CANVAS_W / 2 - 100,
      top: CANVAS_H / 2 - 20,
      fontSize: 36,
      fill: drawColor,
      fontFamily: 'Arial',
    });
    fc.add(text);
    fc.setActiveObject(text);
    fc.renderAll();
    handleCanvasChange();
  }

  function addShape(type) {
    const fc = fabricRef.current;
    if (!fc) return;
    const opts = {
      left: CANVAS_W / 2 - 50,
      top: CANVAS_H / 2 - 50,
      fill: 'transparent',
      stroke: drawColor,
      strokeWidth: strokeWidth,
    };
    let shape;
    switch (type) {
      case 'rect':
        shape = new fabric.Rect({ ...opts, width: 200, height: 120 });
        break;
      case 'circle':
        shape = new fabric.Circle({ ...opts, radius: 60 });
        break;
      case 'ellipse':
        shape = new fabric.Ellipse({ ...opts, rx: 80, ry: 50 });
        break;
      case 'triangle':
        shape = new fabric.Triangle({ ...opts, width: 120, height: 120 });
        break;
      case 'line':
        shape = new fabric.Line([CANVAS_W / 2 - 80, CANVAS_H / 2, CANVAS_W / 2 + 80, CANVAS_H / 2], {
          stroke: drawColor, strokeWidth: strokeWidth,
        });
        break;
      case 'arrow': {
        const pts = [CANVAS_W / 2 - 80, CANVAS_H / 2, CANVAS_W / 2 + 80, CANVAS_H / 2];
        const line = new fabric.Line(pts, { stroke: drawColor, strokeWidth: strokeWidth });
        const head = new fabric.Triangle({
          left: pts[2], top: pts[3] - 10,
          width: 20, height: 20, fill: drawColor,
          angle: 90, originX: 'center', originY: 'center',
        });
        const group = new fabric.Group([line, head], { left: CANVAS_W / 2 - 80, top: CANVAS_H / 2 - 10 });
        fc.add(group);
        fc.setActiveObject(group);
        fc.renderAll();
        handleCanvasChange();
        return;
      }
      default: return;
    }
    fc.add(shape);
    fc.setActiveObject(shape);
    fc.renderAll();
    handleCanvasChange();
  }

  function addSilhouette(sil) {
    const fc = fabricRef.current;
    if (!fc) return;
    closeAllDropdowns();
    const pathObj = new fabric.Path(sil.path, {
      left: CANVAS_W / 2 - 20,
      top: CANVAS_H / 2 - 25,
      fill: '#333333',
      scaleX: 2,
      scaleY: 2,
    });
    pathObj.set('customName', sil.name);
    fc.add(pathObj);
    fc.setActiveObject(pathObj);
    fc.renderAll();
    handleCanvasChange();
  }

  function addProp(prop) {
    const fc = fabricRef.current;
    if (!fc) return;
    closeAllDropdowns();
    const pathObj = new fabric.Path(prop.path, {
      left: CANVAS_W / 2 - 20,
      top: CANVAS_H / 2 - 20,
      fill: '#555555',
      scaleX: 2,
      scaleY: 2,
    });
    pathObj.set('customName', prop.name);
    fc.add(pathObj);
    fc.setActiveObject(pathObj);
    fc.renderAll();
    handleCanvasChange();
  }

  // Camera guides
  function toggleGuides() {
    const fc = fabricRef.current;
    if (!fc) return;
    setShowGuides(!showGuides);
  }

  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    // Remove existing guides
    const existing = fc.getObjects().filter(o => o.customType === 'guide');
    existing.forEach(o => { skipHistory.current = true; fc.remove(o); skipHistory.current = false; });

    if (showGuides) {
      const guideOpts = { stroke: 'rgba(255,255,0,0.4)', strokeWidth: 1, selectable: false, evented: false, excludeFromExport: false, customType: 'guide' };
      // Rule of thirds
      const third_x1 = CANVAS_W / 3, third_x2 = (2 * CANVAS_W) / 3;
      const third_y1 = CANVAS_H / 3, third_y2 = (2 * CANVAS_H) / 3;
      skipHistory.current = true;
      fc.add(new fabric.Line([third_x1, 0, third_x1, CANVAS_H], guideOpts));
      fc.add(new fabric.Line([third_x2, 0, third_x2, CANVAS_H], guideOpts));
      fc.add(new fabric.Line([0, third_y1, CANVAS_W, third_y1], guideOpts));
      fc.add(new fabric.Line([0, third_y2, CANVAS_W, third_y2], guideOpts));
      // Safe zone (90%)
      const margin = 0.05;
      fc.add(new fabric.Rect({
        left: CANVAS_W * margin, top: CANVAS_H * margin,
        width: CANVAS_W * (1 - 2 * margin), height: CANVAS_H * (1 - 2 * margin),
        fill: 'transparent', stroke: 'rgba(0,255,0,0.3)', strokeWidth: 1, strokeDashArray: [8, 4],
        selectable: false, evented: false, excludeFromExport: false, customType: 'guide',
      }));
      skipHistory.current = false;
      fc.renderAll();
    } else {
      fc.renderAll();
    }
  }, [showGuides]);

  // Snap to grid
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    if (snapToGrid) {
      fc.on('object:moving', snapHandler);
    } else {
      fc.off('object:moving', snapHandler);
    }
    return () => fc.off('object:moving', snapHandler);
  }, [snapToGrid]);

  function snapHandler(e) {
    const obj = e.target;
    obj.set({
      left: Math.round(obj.left / GRID_SIZE) * GRID_SIZE,
      top: Math.round(obj.top / GRID_SIZE) * GRID_SIZE,
    });
  }

  // Grid overlay
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const existing = fc.getObjects().filter(o => o.customType === 'gridline');
    existing.forEach(o => { skipHistory.current = true; fc.remove(o); skipHistory.current = false; });

    if (showGrid) {
      const gridOpts = { stroke: 'rgba(0,0,0,0.06)', strokeWidth: 0.5, selectable: false, evented: false, excludeFromExport: false, customType: 'gridline' };
      skipHistory.current = true;
      for (let x = GRID_SIZE; x < CANVAS_W; x += GRID_SIZE) {
        fc.add(new fabric.Line([x, 0, x, CANVAS_H], gridOpts));
      }
      for (let y = GRID_SIZE; y < CANVAS_H; y += GRID_SIZE) {
        fc.add(new fabric.Line([0, y, CANVAS_W, y], gridOpts));
      }
      skipHistory.current = false;
      fc.renderAll();
    } else {
      fc.renderAll();
    }
  }, [showGrid]);

  // ------- IMAGE LIBRARY -------
  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('Only JPG and PNG files are supported.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Max file size is 10MB.');
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const filePath = `${docId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('storyboard-assets')
      .upload(filePath, file);
    if (uploadErr) { console.error(uploadErr); setUploading(false); return; }

    const { error: dbErr } = await supabase.from('storyboard_assets').insert({
      document_id: docId,
      file_path: filePath,
      filename: file.name,
      file_size: file.size,
    });
    if (dbErr) console.error(dbErr);
    setUploading(false);
    loadAssets();
  }

  function getAssetUrl(filePath) {
    const { data } = supabase.storage.from('storyboard-assets').getPublicUrl(filePath);
    return data?.publicUrl || '';
  }

  function addImageToCanvas(url) {
    const fc = fabricRef.current;
    if (!fc) return;
    fabric.FabricImage.fromURL(url, { crossOrigin: 'anonymous' }).then(img => {
      // Scale to fit reasonably
      const maxDim = 400;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      img.set({
        left: CANVAS_W / 2 - (img.width * scale) / 2,
        top: CANVAS_H / 2 - (img.height * scale) / 2,
        scaleX: scale,
        scaleY: scale,
      });
      fc.add(img);
      fc.setActiveObject(img);
      fc.renderAll();
      handleCanvasChange();
    }).catch(err => console.error('Image load error:', err));
  }

  async function deleteAsset(asset) {
    await supabase.storage.from('storyboard-assets').remove([asset.file_path]);
    await supabase.from('storyboard_assets').delete().eq('id', asset.id);
    loadAssets();
  }

  // ------- LAYERS -------
  function updateLayers() {
    const fc = fabricRef.current;
    if (!fc) return;
    const objs = fc.getObjects().filter(o => o.customType !== 'guide' && o.customType !== 'gridline');
    setLayerList(objs.map((o, i) => ({
      index: i,
      type: o.type || 'object',
      name: o.customName || o.type || 'Object',
      visible: o.visible !== false,
      obj: o,
    })).reverse());
  }

  function moveLayer(obj, direction) {
    const fc = fabricRef.current;
    if (!fc) return;
    if (direction === 'up') fc.bringObjectForward(obj);
    else if (direction === 'down') fc.sendObjectBackwards(obj);
    else if (direction === 'top') fc.bringObjectToFront(obj);
    else if (direction === 'bottom') fc.sendObjectToBack(obj);
    fc.renderAll();
    updateLayers();
    handleCanvasChange();
  }

  function toggleLayerVisibility(obj) {
    obj.set('visible', !obj.visible);
    fabricRef.current?.renderAll();
    updateLayers();
  }

  function deleteSelectedObject() {
    const fc = fabricRef.current;
    if (!fc) return;
    const active = fc.getActiveObjects();
    if (active.length === 0) return;
    active.forEach(obj => fc.remove(obj));
    fc.discardActiveObject();
    fc.renderAll();
    handleCanvasChange();
  }

  // ------- UNDO / REDO -------
  function pushHistory() {
    const fc = fabricRef.current;
    if (!fc || skipHistory.current) return;
    const json = fc.toJSON();
    undoStack.current.push(JSON.stringify(json));
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
    setUndoLen(undoStack.current.length);
    setRedoLen(0);
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
      updateLayers();
      triggerAutoSave();
    });
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
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
      updateLayers();
      triggerAutoSave();
    });
    setUndoLen(undoStack.current.length);
    setRedoLen(redoStack.current.length);
  }

  // ------- KEYBOARD SHORTCUTS -------
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.target === document.body) { e.preventDefault(); deleteSelectedObject(); }
      }
      if (e.key === 'v' && !e.metaKey && !e.ctrlKey) setTool('select');
      if (e.key === 'b' && !e.metaKey && !e.ctrlKey) setTool('draw');
      if (e.key === 't' && !e.metaKey && !e.ctrlKey) addText();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // ------- PDF EXPORT -------
  async function exportPDF() {
    setSaving(true);
    await saveCurrentPage();

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [CANVAS_W, CANVAS_H] });

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage([CANVAS_W, CANVAS_H], 'landscape');

      const page = pages[i];
      let canvasData = page.canvas_data;
      if (i === currentPage && fabricRef.current) {
        canvasData = fabricRef.current.toJSON();
      }

      const tempCanvas = new fabric.StaticCanvas(null, {
        width: CANVAS_W, height: CANVAS_H, backgroundColor: '#ffffff',
      });

      if (canvasData && Object.keys(canvasData).length > 0) {
        await new Promise(resolve => {
          tempCanvas.loadFromJSON(canvasData, () => {
            tempCanvas.renderAll();
            resolve();
          });
        });
      }

      const imgData = tempCanvas.toDataURL({ format: 'jpeg', quality: 0.9 });
      pdf.addImage(imgData, 'JPEG', 0, 0, CANVAS_W, CANVAS_H);

      // Page number
      pdf.setFontSize(24);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${i + 1}`, CANVAS_W - 50, CANVAS_H - 20);

      // Annotations overlay at bottom
      const ann = page.annotations || {};
      if (i === currentPage) Object.assign(ann, annotations);
      const lines = [];
      if (ann.scene) lines.push(`Scene: ${ann.scene}`);
      if (ann.shot) lines.push(`Shot: ${ann.shot}`);
      if (ann.shotType) lines.push(`Type: ${ann.shotType}`);
      if (ann.transition) lines.push(`Transition: ${ann.transition}`);
      if (ann.description) lines.push(`Desc: ${ann.description}`);
      if (ann.action) lines.push(`Action: ${ann.action}`);
      if (ann.dialogue) lines.push(`Dialogue: ${ann.dialogue}`);

      if (lines.length > 0) {
        pdf.setFillColor(0, 0, 0);
        pdf.setGlobalAlpha(0.6);
        pdf.rect(0, CANVAS_H - 20 - lines.length * 20, CANVAS_W, lines.length * 20 + 20, 'F');
        pdf.setGlobalAlpha(1);
        pdf.setFontSize(14);
        pdf.setTextColor(255, 255, 255);
        lines.forEach((line, li) => {
          pdf.text(line, 20, CANVAS_H - 20 - (lines.length - 1 - li) * 18);
        });
      }

      tempCanvas.dispose();
    }

    pdf.save(`${title || 'storyboard'}.pdf`);
    setSaving(false);
  }

  // ------- ANNOTATIONS -------
  function updateAnnotation(key, value) {
    setAnnotations(prev => ({ ...prev, [key]: value }));
    triggerAutoSave();
  }

  // ------- DROPDOWN HELPERS -------
  function closeAllDropdowns() {
    setShowSilhouettes(false);
    setShowProps(false);
    setShowShotTypes(false);
    setShowTransitions(false);
  }

  // ------- RENDER -------
  const zoomScale = zoom / 100;

  return (
    <div style={styles.page}>
      {/* Top Toolbar */}
      <div style={styles.toolbar}>
        <button onClick={onBack} style={styles.backBtn}>← Back</button>
        <span style={styles.titleText}>{title}</span>

        {/* Tool buttons */}
        <div style={styles.toolGroup}>
          {[
            { key: 'select', label: '↖ Select', shortcut: 'V' },
            { key: 'draw', label: '✏ Draw', shortcut: 'B' },
          ].map(t => (
            <button key={t.key} onClick={() => setTool(t.key)}
              style={{ ...styles.toolBtn, ...(activeTool === t.key ? styles.toolBtnActive : {}) }}
              title={`${t.label} (${t.shortcut})`}>
              {t.label}
            </button>
          ))}
          <button onClick={addText} style={styles.toolBtn} title="Add Text (T)">T Text</button>
        </div>

        {/* Shape buttons */}
        <div style={styles.toolGroup}>
          {['rect', 'circle', 'ellipse', 'triangle', 'line', 'arrow'].map(s => (
            <button key={s} onClick={() => addShape(s)}
              style={{ ...styles.toolBtn, fontSize: '11px' }}>
              {s === 'rect' ? '▭' : s === 'circle' ? '○' : s === 'ellipse' ? '⬭' : s === 'triangle' ? '△' : s === 'line' ? '─' : '→'}
            </button>
          ))}
        </div>

        {/* Colors */}
        <div style={styles.toolGroup}>
          {DRAW_COLORS.map(c => (
            <button key={c} onClick={() => setDrawColor(c)}
              style={{
                ...styles.colorBtn,
                background: c,
                outline: drawColor === c ? '2px solid #6366f1' : 'none',
                outlineOffset: '2px',
              }} />
          ))}
        </div>

        {/* Stroke width */}
        <div style={styles.toolGroup}>
          {STROKE_WIDTHS.map(w => (
            <button key={w} onClick={() => setStrokeWidth(w)}
              style={{ ...styles.widthBtn, ...(strokeWidth === w ? styles.widthBtnActive : {}) }}>
              <div style={{ width: `${w + 4}px`, height: `${w + 4}px`, borderRadius: '50%', background: strokeWidth === w ? '#a5b4fc' : 'rgba(255,255,255,0.3)' }} />
            </button>
          ))}
        </div>

        {/* Undo/Redo */}
        <div style={styles.toolGroup}>
          <button onClick={undo} style={styles.toolBtn} disabled={undoLen <= 1}>↩</button>
          <button onClick={redo} style={styles.toolBtn} disabled={redoLen === 0}>↪</button>
          <button onClick={deleteSelectedObject} style={styles.toolBtn} title="Delete selected">🗑</button>
        </div>

        {/* Zoom */}
        <div style={styles.toolGroup}>
          <button onClick={() => setZoom(z => Math.max(25, z - 10))} style={styles.toolBtn}>−</button>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', minWidth: '36px', textAlign: 'center' }}>{zoom}%</span>
          <button onClick={() => setZoom(z => Math.min(300, z + 10))} style={styles.toolBtn}>+</button>
        </div>

        {/* View toggle */}
        <div style={styles.toolGroup}>
          <button onClick={() => { setViewMode('canvas'); }} style={{ ...styles.toolBtn, ...(viewMode === 'canvas' ? styles.toolBtnActive : {}) }}>Canvas</button>
          <button onClick={() => { setViewMode('grid'); generateAllThumbnails(); }} style={{ ...styles.toolBtn, ...(viewMode === 'grid' ? styles.toolBtnActive : {}) }}>Grid</button>
        </div>

        {/* Export */}
        <button onClick={exportPDF} style={styles.saveBtn}>{saving ? 'Saving...' : '📄 Export PDF'}</button>
        <button onClick={() => {
          const name = prompt('Template name:');
          if (name) onSaveTemplate(name, 'storyboard', { pageCount: pages.length });
        }} style={styles.templateBtn}>📋 Template</button>
      </div>

      {/* Secondary Toolbar */}
      <div style={styles.toolbar2}>
        {/* Silhouettes dropdown */}
        <div style={styles.dropdown}>
          <button onClick={() => { closeAllDropdowns(); setShowSilhouettes(!showSilhouettes); }} style={styles.tool2Btn}>
            🧍 Silhouettes ▾
          </button>
          {showSilhouettes && (
            <div style={styles.dropdownMenu}>
              {SILHOUETTES.map(s => (
                <button key={s.name} onClick={() => addSilhouette(s)} style={styles.dropdownItem}>{s.name}</button>
              ))}
            </div>
          )}
        </div>

        {/* Props dropdown */}
        <div style={styles.dropdown}>
          <button onClick={() => { closeAllDropdowns(); setShowProps(!showProps); }} style={styles.tool2Btn}>
            🎥 Props ▾
          </button>
          {showProps && (
            <div style={styles.dropdownMenu}>
              {PROPS.map(p => (
                <button key={p.name} onClick={() => addProp(p)} style={styles.dropdownItem}>{p.name}</button>
              ))}
            </div>
          )}
        </div>

        {/* Camera guides */}
        <button onClick={toggleGuides} style={{ ...styles.tool2Btn, ...(showGuides ? styles.tool2BtnActive : {}) }}>
          📐 Guides
        </button>

        {/* Shot type dropdown */}
        <div style={styles.dropdown}>
          <button onClick={() => { closeAllDropdowns(); setShowShotTypes(!showShotTypes); }} style={styles.tool2Btn}>
            🎯 Shot Type ▾
          </button>
          {showShotTypes && (
            <div style={styles.dropdownMenu}>
              {SHOT_TYPES.map(st => (
                <button key={st.code} onClick={() => { updateAnnotation('shotType', st.code); closeAllDropdowns(); }} style={styles.dropdownItem}>
                  <strong>{st.code}</strong> - {st.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transitions dropdown */}
        <div style={styles.dropdown}>
          <button onClick={() => { closeAllDropdowns(); setShowTransitions(!showTransitions); }} style={styles.tool2Btn}>
            🔄 Transition ▾
          </button>
          {showTransitions && (
            <div style={styles.dropdownMenu}>
              {TRANSITIONS.map(tr => (
                <button key={tr.code} onClick={() => { updateAnnotation('transition', tr.code); closeAllDropdowns(); }} style={styles.dropdownItem}>
                  <strong>{tr.code}</strong> - {tr.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => setSnapToGrid(!snapToGrid)} style={{ ...styles.tool2Btn, ...(snapToGrid ? styles.tool2BtnActive : {}) }}>
          🧲 Snap
        </button>
        <button onClick={() => setShowGrid(!showGrid)} style={{ ...styles.tool2Btn, ...(showGrid ? styles.tool2BtnActive : {}) }}>
          ⊞ Grid
        </button>

        <div style={{ flex: 1 }} />

        {/* Panel toggles */}
        <button onClick={() => setShowLayers(!showLayers)} style={{ ...styles.tool2Btn, ...(showLayers ? styles.tool2BtnActive : {}) }}>
          Layers
        </button>
        <button onClick={() => setShowAnnotations(!showAnnotations)} style={{ ...styles.tool2Btn, ...(showAnnotations ? styles.tool2BtnActive : {}) }}>
          Notes
        </button>
        <button onClick={() => setShowImageLib(!showImageLib)} style={{ ...styles.tool2Btn, ...(showImageLib ? styles.tool2BtnActive : {}) }}>
          Images
        </button>
      </div>

      {/* Main Content */}
      <div style={styles.contentArea}>
        {/* Layers Panel (left) */}
        {showLayers && (
          <div style={styles.sidePanel}>
            <div style={styles.panelHeader}>Layers</div>
            <div style={styles.panelBody}>
              {layerList.length === 0 ? (
                <div style={styles.emptyPanel}>No objects</div>
              ) : layerList.map((layer, i) => (
                <div key={i} style={styles.layerItem}>
                  <button onClick={() => toggleLayerVisibility(layer.obj)} style={styles.layerVisBtn}>
                    {layer.visible ? '👁' : '🚫'}
                  </button>
                  <span style={styles.layerName}>{layer.name}</span>
                  <div style={styles.layerBtns}>
                    <button onClick={() => moveLayer(layer.obj, 'up')} style={styles.layerMoveBtn} title="Move up">↑</button>
                    <button onClick={() => moveLayer(layer.obj, 'down')} style={styles.layerMoveBtn} title="Move down">↓</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Canvas / Grid Area */}
        <div style={styles.canvasArea} ref={containerRef}>
          {viewMode === 'canvas' ? (
            <>
              <div style={{
                ...styles.canvasContainer,
                transform: `scale(${zoomScale})`,
                transformOrigin: 'top left',
                width: CANVAS_W,
                height: CANVAS_H,
              }}>
                <canvas ref={canvasElRef} />
              </div>

              {/* Page Navigator */}
              <div style={styles.pageNav}>
                <button onClick={() => switchPage(currentPage - 1)} disabled={currentPage === 0} style={styles.pageNavBtn}>◀</button>
                <span style={styles.pageNavText}>Page {currentPage + 1} / {pages.length}</span>
                <button onClick={() => switchPage(currentPage + 1)} disabled={currentPage >= pages.length - 1} style={styles.pageNavBtn}>▶</button>
                <button onClick={addPage} style={styles.pageNavBtn} title="Add page">+ Add</button>
                <button onClick={duplicatePage} style={styles.pageNavBtn} title="Duplicate page">⧉ Dup</button>
                <button onClick={() => deletePage(currentPage)} disabled={pages.length <= 1} style={styles.pageNavBtn} title="Delete page">✕ Del</button>
              </div>
            </>
          ) : (
            /* Grid View */
            <div style={styles.gridView}>
              {pages.map((page, i) => (
                <div
                  key={page.id}
                  draggable
                  onDragStart={() => handleGridDragStart(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleGridDrop(i)}
                  onClick={() => { setCurrentPage(i); loadPageIntoCanvas(i); setViewMode('canvas'); }}
                  style={{
                    ...styles.gridCard,
                    ...(i === currentPage ? styles.gridCardActive : {}),
                  }}
                >
                  <div style={styles.gridThumb}>
                    {thumbnails[i] ? (
                      <img src={thumbnails[i]} alt={`Page ${i + 1}`} style={styles.gridThumbImg} />
                    ) : (
                      <div style={styles.gridThumbEmpty}>Page {i + 1}</div>
                    )}
                  </div>
                  <div style={styles.gridCardFooter}>
                    <span style={styles.gridCardNum}>Page {i + 1}</span>
                    <button onClick={(e) => { e.stopPropagation(); deletePage(i); }} disabled={pages.length <= 1} style={styles.gridDelBtn}>✕</button>
                  </div>
                </div>
              ))}
              <div onClick={addPage} style={styles.gridAddCard}>
                <span style={{ fontSize: '28px', color: 'rgba(255,255,255,0.3)' }}>+</span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>Add Page</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Annotations Panel */}
          {showAnnotations && (
            <div style={styles.sidePanel}>
              <div style={styles.panelHeader}>Annotations</div>
              <div style={styles.panelBody}>
                <label style={styles.annLabel}>Scene #</label>
                <input value={annotations.scene} onChange={e => updateAnnotation('scene', e.target.value)} style={styles.annInput} placeholder="e.g. 1" />
                <label style={styles.annLabel}>Shot #</label>
                <input value={annotations.shot} onChange={e => updateAnnotation('shot', e.target.value)} style={styles.annInput} placeholder="e.g. 1A" />
                <label style={styles.annLabel}>Shot Type</label>
                <select value={annotations.shotType} onChange={e => updateAnnotation('shotType', e.target.value)} style={styles.annInput}>
                  <option value="">--</option>
                  {SHOT_TYPES.map(st => <option key={st.code} value={st.code}>{st.code} - {st.name}</option>)}
                </select>
                <label style={styles.annLabel}>Transition</label>
                <select value={annotations.transition} onChange={e => updateAnnotation('transition', e.target.value)} style={styles.annInput}>
                  <option value="">--</option>
                  {TRANSITIONS.map(tr => <option key={tr.code} value={tr.code}>{tr.code} - {tr.name}</option>)}
                </select>
                <label style={styles.annLabel}>Description</label>
                <textarea value={annotations.description} onChange={e => updateAnnotation('description', e.target.value)} style={styles.annTextarea} placeholder="Scene description..." rows={2} />
                <label style={styles.annLabel}>Action</label>
                <textarea value={annotations.action} onChange={e => updateAnnotation('action', e.target.value)} style={styles.annTextarea} placeholder="Action notes..." rows={2} />
                <label style={styles.annLabel}>Dialogue</label>
                <textarea value={annotations.dialogue} onChange={e => updateAnnotation('dialogue', e.target.value)} style={styles.annTextarea} placeholder="Dialogue..." rows={2} />
              </div>
            </div>
          )}

          {/* Image Library */}
          {showImageLib && (
            <div style={styles.sidePanel}>
              <div style={styles.panelHeader}>Image Library</div>
              <div style={styles.panelBody}>
                <label style={styles.uploadBtn}>
                  {uploading ? 'Uploading...' : '+ Upload Image'}
                  <input type="file" accept="image/jpeg,image/png" onChange={handleImageUpload} style={{ display: 'none' }} />
                </label>
                <div style={styles.assetGrid}>
                  {assets.map(a => (
                    <div key={a.id} style={styles.assetItem}>
                      <img
                        src={getAssetUrl(a.file_path)}
                        alt={a.filename}
                        style={styles.assetThumb}
                        onClick={() => addImageToCanvas(getAssetUrl(a.file_path))}
                        title="Click to add to canvas"
                      />
                      <button onClick={() => deleteAsset(a)} style={styles.assetDelBtn}>✕</button>
                    </div>
                  ))}
                </div>
                {assets.length === 0 && <div style={styles.emptyPanel}>No images uploaded</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ------- STYLES -------
const styles = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)',
    flexWrap: 'wrap', minHeight: '44px',
  },
  toolbar2: {
    display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 12px',
    borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)',
    flexWrap: 'wrap', minHeight: '36px',
  },
  backBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.45)', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, padding: '4px 8px' },
  titleText: { fontSize: '14px', fontWeight: 600, color: '#e2e8f0', marginRight: '8px' },
  toolGroup: { display: 'flex', alignItems: 'center', gap: '3px', padding: '0 6px', borderLeft: '1px solid rgba(255,255,255,0.06)' },
  toolBtn: {
    padding: '4px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  toolBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)', color: '#a5b4fc' },
  colorBtn: { width: '18px', height: '18px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', padding: 0, flexShrink: 0 },
  widthBtn: {
    width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '5px', cursor: 'pointer',
  },
  widthBtnActive: { background: 'rgba(99,102,241,0.15)', borderColor: 'rgba(99,102,241,0.3)' },
  saveBtn: { padding: '4px 12px', background: '#6366f1', border: 'none', borderRadius: '5px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  templateBtn: { padding: '4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '5px', color: 'rgba(255,255,255,0.4)', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },

  // Secondary toolbar
  tool2Btn: {
    padding: '3px 10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '5px', color: 'rgba(255,255,255,0.45)', fontSize: '11px', cursor: 'pointer',
    fontFamily: 'inherit', whiteSpace: 'nowrap',
  },
  tool2BtnActive: { background: 'rgba(99,102,241,0.12)', borderColor: 'rgba(99,102,241,0.25)', color: '#a5b4fc' },

  // Dropdowns
  dropdown: { position: 'relative' },
  dropdownMenu: {
    position: 'absolute', top: '100%', left: 0, zIndex: 100,
    background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px',
    padding: '4px', minWidth: '200px', maxHeight: '300px', overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'block', width: '100%', padding: '6px 10px', background: 'none', border: 'none',
    color: 'rgba(255,255,255,0.6)', fontSize: '12px', cursor: 'pointer', textAlign: 'left',
    borderRadius: '4px', fontFamily: 'inherit',
  },

  // Content area
  contentArea: { flex: 1, display: 'flex', overflow: 'hidden' },

  // Side panels
  sidePanel: {
    width: '220px', borderLeft: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)',
    display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
  },
  panelHeader: {
    padding: '8px 12px', fontSize: '12px', fontWeight: 700, color: 'rgba(255,255,255,0.5)',
    borderBottom: '1px solid rgba(255,255,255,0.06)', textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  panelBody: { flex: 1, padding: '8px', overflowY: 'auto' },
  emptyPanel: { fontSize: '11px', color: 'rgba(255,255,255,0.25)', textAlign: 'center', padding: '16px 0' },

  // Canvas area
  canvasArea: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', background: '#1a1a2e', position: 'relative' },
  canvasContainer: { margin: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', flexShrink: 0 },

  // Page navigator
  pageNav: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'rgba(255,255,255,0.02)', flexShrink: 0,
  },
  pageNavBtn: {
    padding: '4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '5px', color: 'rgba(255,255,255,0.5)', fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
  },
  pageNavText: { fontSize: '12px', color: 'rgba(255,255,255,0.5)', fontWeight: 600 },

  // Grid view
  gridView: {
    display: 'flex', flexWrap: 'wrap', gap: '16px', padding: '24px',
    alignContent: 'flex-start', overflow: 'auto', flex: 1,
  },
  gridCard: {
    width: '240px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.15s',
  },
  gridCardActive: { borderColor: 'rgba(99,102,241,0.4)' },
  gridThumb: { width: '100%', aspectRatio: '16/9', background: '#fff', overflow: 'hidden' },
  gridThumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  gridThumbEmpty: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' },
  gridCardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px' },
  gridCardNum: { fontSize: '11px', color: 'rgba(255,255,255,0.4)' },
  gridDelBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: '12px' },
  gridAddCard: {
    width: '240px', aspectRatio: '16/9', background: 'rgba(255,255,255,0.02)',
    border: '2px dashed rgba(255,255,255,0.08)', borderRadius: '8px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', gap: '4px',
  },

  // Layers
  layerItem: {
    display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
    borderRadius: '4px', fontSize: '11px', color: 'rgba(255,255,255,0.5)',
  },
  layerVisBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px' },
  layerName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  layerBtns: { display: 'flex', gap: '2px' },
  layerMoveBtn: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: '11px', padding: '2px 4px' },

  // Annotations
  annLabel: { fontSize: '10px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', margin: '6px 0 2px', display: 'block' },
  annInput: {
    width: '100%', padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '4px', color: '#e2e8f0', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  },
  annTextarea: {
    width: '100%', padding: '5px 8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '4px', color: '#e2e8f0', fontSize: '12px', fontFamily: 'inherit', outline: 'none',
    resize: 'vertical', boxSizing: 'border-box',
  },

  // Image library
  uploadBtn: {
    display: 'block', width: '100%', padding: '8px', background: 'rgba(99,102,241,0.1)',
    border: '1px dashed rgba(99,102,241,0.3)', borderRadius: '6px', color: '#a5b4fc',
    fontSize: '11px', fontWeight: 600, textAlign: 'center', cursor: 'pointer', marginBottom: '8px',
  },
  assetGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' },
  assetItem: { position: 'relative', borderRadius: '4px', overflow: 'hidden' },
  assetThumb: {
    width: '100%', aspectRatio: '16/9', objectFit: 'cover', cursor: 'pointer',
    borderRadius: '4px', border: '1px solid rgba(255,255,255,0.06)',
  },
  assetDelBtn: {
    position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)',
    border: 'none', color: '#fff', fontSize: '10px', cursor: 'pointer', borderRadius: '3px',
    padding: '1px 4px',
  },
};
