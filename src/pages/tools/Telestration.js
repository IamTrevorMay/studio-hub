import React, { useState, useCallback, useRef, useEffect } from 'react';
import VideoSourcePanel from './telestration/VideoSourcePanel';
import VideoPlayer from './telestration/VideoPlayer';
import DrawingCanvas from './telestration/DrawingCanvas';
import Toolbar from './telestration/Toolbar';
import Timeline from './telestration/Timeline';
import AnnotationList from './telestration/AnnotationList';
import StaticImagePanel from './telestration/StaticImagePanel';
import VideoQueuePanel from './telestration/VideoQueuePanel';
import useVideoController from './telestration/useVideoController';
import useAnnotationStore from './telestration/useAnnotationStore';
import useExporter from './telestration/useExporter';
import { DEFAULT_SETTINGS } from './telestration/telestrationConstants';
import { loadSettings, saveSettings } from './telestration/telestrationStorage';

export default function Telestration({ onBack }) {
  const [videoSources, setVideoSources] = useState([]);
  const [selectedVideoId, setSelectedVideoId] = useState(null);
  const [showAnnotationList, setShowAnnotationList] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoController = useVideoController();
  const annotationStore = useAnnotationStore();
  const exporter = useExporter();
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const pageRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 540 });

  // Mode + format state
  const [mode, setMode] = useState(() => loadSettings().mode || 'video');
  const [exportFormat, setExportFormat] = useState(() => loadSettings().exportFormat || 'webm');

  // Static image state
  const [staticImages, setStaticImages] = useState([]);
  const [selectedStaticImageId, setSelectedStaticImageId] = useState(null);
  const staticImgRef = useRef(null);

  // Stable refs for use inside callbacks (avoids stale closures)
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const videoSourcesRef = useRef(videoSources);
  videoSourcesRef.current = videoSources;
  const selectedVideoIdRef = useRef(selectedVideoId);
  selectedVideoIdRef.current = selectedVideoId;
  const staticImagesRef = useRef(staticImages);
  staticImagesRef.current = staticImages;
  const selectedStaticImageIdRef = useRef(selectedStaticImageId);
  selectedStaticImageIdRef.current = selectedStaticImageId;

  // Drawing state (persisted)
  const saved = loadSettings();
  const [activeTool, setActiveTool] = useState(saved.activeTool || DEFAULT_SETTINGS.activeTool);
  const [drawColor, setDrawColor] = useState(saved.drawColor || DEFAULT_SETTINGS.drawColor);
  const [strokeWidth, setStrokeWidth] = useState(saved.strokeWidth || DEFAULT_SETTINGS.strokeWidth);

  // Persist drawing + mode settings
  useEffect(() => {
    saveSettings({ activeTool, drawColor, strokeWidth, mode, exportFormat });
  }, [activeTool, drawColor, strokeWidth, mode, exportFormat]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      staticImages.forEach(img => URL.revokeObjectURL(img.url));
      videoSources.forEach(v => {
        if (v.source.type === 'file' && v.source.url) URL.revokeObjectURL(v.source.url);
      });
    };
  }, []); // eslint-disable-line

  // Fullscreen sync
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      pageRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Track viewport size for canvas
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setCanvasSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selectedVideoId, mode]);

  // Computed
  const selectedStaticImage = staticImages.find(i => i.id === selectedStaticImageId) ?? null;
  const selectedVideo = videoSources.find(v => v.id === selectedVideoId) ?? null;
  const selectedVideoSource = selectedVideo?.source ?? null;
  const isEditorMode = videoSources.length > 0 || staticImages.length > 0;

  // --- Mode switching (uses refs to avoid stale closures) ---
  const handleSwitchMode = useCallback((newMode) => {
    if (newMode === modeRef.current) return;
    const currentStaticId = selectedStaticImageIdRef.current;
    const currentImages = staticImagesRef.current;
    const currentStaticImage = currentImages.find(i => i.id === currentStaticId) ?? null;
    const currentVideoId = selectedVideoIdRef.current;
    const currentVideos = videoSourcesRef.current;

    try {
      if (newMode === 'static') {
        // Save current video canvas + annotations into queue
        if (currentVideoId) {
          const json = canvasRef.current?.getCanvasJSON() ?? null;
          const anns = [...(annotationStore.annotations || [])];
          setVideoSources(prev => prev.map(v =>
            v.id === currentVideoId ? { ...v, canvasJSON: json, annotations: anns } : v
          ));
        }
        // Load static image canvas
        if (currentStaticImage?.canvasJSON) {
          canvasRef.current?.loadCanvasJSON(currentStaticImage.canvasJSON);
        } else {
          canvasRef.current?.clearCanvas();
        }
      } else {
        // Save static image canvas
        if (currentStaticImage) {
          const json = canvasRef.current?.getCanvasJSON();
          setStaticImages(prev => prev.map(img =>
            img.id === currentStaticId ? { ...img, canvasJSON: json } : img
          ));
        }
        // Restore selected video canvas + annotations
        const targetVideo = currentVideos.find(v => v.id === currentVideoId);
        if (targetVideo?.canvasJSON) {
          canvasRef.current?.loadCanvasJSON(targetVideo.canvasJSON, { skipSync: true });
          annotationStore.replaceAnnotations(targetVideo.annotations || []);
        } else {
          canvasRef.current?.clearCanvas();
        }
      }
    } catch (e) {
      console.error('Mode switch canvas error:', e);
    }
    setMode(newMode); // always runs
  }, [annotationStore]); // eslint-disable-line

  // --- Static image selection ---
  const handleSelectStaticImage = useCallback((id) => {
    const currentSelectedId = selectedStaticImageIdRef.current;
    const currentImages = staticImagesRef.current;

    try {
      if (currentSelectedId) {
        const json = canvasRef.current?.getCanvasJSON();
        setStaticImages(prev => prev.map(img =>
          img.id === currentSelectedId ? { ...img, canvasJSON: json } : img
        ));
      }
      setSelectedStaticImageId(id);
      const target = currentImages.find(i => i.id === id);
      if (target?.canvasJSON) {
        canvasRef.current?.loadCanvasJSON(target.canvasJSON);
      } else {
        canvasRef.current?.clearCanvas();
      }
    } catch (e) {
      console.error('Select image canvas error:', e);
      setSelectedStaticImageId(id); // still update selection even on error
    }
  }, []); // eslint-disable-line

  // --- Add static images ---
  const handleAddStaticImages = useCallback((files) => {
    const currentSelectedId = selectedStaticImageIdRef.current;
    const newImages = files.map(file => ({
      id: crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
      canvasJSON: null,
    }));
    setStaticImages(prev => [...prev, ...newImages]);
    if (!currentSelectedId && newImages.length > 0) {
      setSelectedStaticImageId(newImages[0].id);
      canvasRef.current?.clearCanvas();
    }
  }, []);

  // Handle drag-drop on static image drop zone
  const handleStaticDrop = useCallback((e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type === 'image/png' || f.type === 'image/jpeg'
    );
    if (files.length > 0) handleAddStaticImages(files);
  }, [handleAddStaticImages]);

  // --- Video queue handlers ---
  const handleAddVideo = useCallback((files, directSource) => {
    const currentVideoId = selectedVideoIdRef.current;
    const currentVideos = videoSourcesRef.current;

    // Save current video state before adding
    if (currentVideoId && currentVideos.length > 0) {
      const json = canvasRef.current?.getCanvasJSON() ?? null;
      const anns = [...(annotationStore.annotations || [])];
      setVideoSources(prev => prev.map(v =>
        v.id === currentVideoId ? { ...v, canvasJSON: json, annotations: anns } : v
      ));
    }

    let newItems = [];
    if (directSource) {
      // YouTube or single source passed directly
      newItems = [{
        id: crypto.randomUUID(),
        name: directSource.fileName || 'Untitled',
        source: directSource,
        annotations: [],
        canvasJSON: null,
      }];
    } else if (files && files.length > 0) {
      newItems = files.map(file => ({
        id: crypto.randomUUID(),
        name: file.name,
        source: { type: 'file', url: URL.createObjectURL(file), fileName: file.name, file },
        annotations: [],
        canvasJSON: null,
      }));
    }

    if (newItems.length > 0) {
      setVideoSources(prev => [...prev, ...newItems]);
      setSelectedVideoId(newItems[0].id);
      canvasRef.current?.clearCanvas();
      annotationStore.replaceAnnotations([]);
    }
  }, [annotationStore]);

  const handleSelectVideo = useCallback((id) => {
    const currentVideoId = selectedVideoIdRef.current;
    if (id === currentVideoId) return;
    const currentVideos = videoSourcesRef.current;

    try {
      // Save current video state
      if (currentVideoId) {
        const json = canvasRef.current?.getCanvasJSON() ?? null;
        const anns = [...(annotationStore.annotations || [])];
        setVideoSources(prev => prev.map(v =>
          v.id === currentVideoId ? { ...v, canvasJSON: json, annotations: anns } : v
        ));
      }

      videoController.pause();
      setSelectedVideoId(id);

      // Load target video state
      const target = currentVideos.find(v => v.id === id);
      if (target?.canvasJSON) {
        canvasRef.current?.loadCanvasJSON(target.canvasJSON, { skipSync: true });
      } else {
        canvasRef.current?.clearCanvas();
      }
      annotationStore.replaceAnnotations(target?.annotations || []);
    } catch (e) {
      console.error('Select video canvas error:', e);
      setSelectedVideoId(id);
    }
  }, [annotationStore, videoController]); // eslint-disable-line

  const handleRemoveVideo = useCallback((id) => {
    const currentVideos = videoSourcesRef.current;
    const target = currentVideos.find(v => v.id === id);
    if (target?.source.type === 'file' && target.source.url) {
      URL.revokeObjectURL(target.source.url);
    }

    setVideoSources(prev => prev.filter(v => v.id !== id));
    if (selectedVideoIdRef.current === id) {
      const remaining = currentVideos.filter(v => v.id !== id);
      if (remaining.length > 0) {
        const next = remaining[0];
        setSelectedVideoId(next.id);
        if (next.canvasJSON) {
          canvasRef.current?.loadCanvasJSON(next.canvasJSON, { skipSync: true });
        } else {
          canvasRef.current?.clearCanvas();
        }
        annotationStore.replaceAnnotations(next.annotations || []);
      } else {
        setSelectedVideoId(null);
        canvasRef.current?.clearCanvas();
        annotationStore.replaceAnnotations([]);
      }
    }
  }, [annotationStore]); // eslint-disable-line

  // Wire initial VideoSourcePanel to the queue
  const handleSourceSelected = useCallback((source) => {
    handleAddVideo(null, source);
  }, [handleAddVideo]);

  const handleBack = useCallback(() => {
    videoSources.forEach(v => {
      if (v.source.type === 'file' && v.source.url) URL.revokeObjectURL(v.source.url);
    });
    staticImages.forEach(img => URL.revokeObjectURL(img.url));
    onBack();
  }, [videoSources, onBack, staticImages]);

  // Select annotation: seek to its start and select on canvas
  const handleSelectAnnotation = useCallback((annId) => {
    const ann = annotationStore.annotations.find(a => a.id === annId);
    if (ann) {
      videoController.seek(ann.startTime);
      canvasRef.current?.selectByAnnotationId(annId);
    }
  }, [annotationStore.annotations, videoController]);

  // Export static PNG
  const handleExportStaticPNG = useCallback(() => {
    exporter.exportStaticPNG(
      staticImgRef.current,
      canvasRef.current?.getCanvas()?.lowerCanvasEl,
      selectedStaticImage?.name
    );
  }, [exporter, selectedStaticImage]);

  // Export video handler
  const handleExport = useCallback(() => {
    if (exporter.isExporting) return;
    const videoEl = videoController.videoRef.current;
    const fabricCanvas = canvasRef.current?.getCanvas();
    if (!videoEl || !fabricCanvas) return;

    videoController.pause();

    const setVisibility = (time) => {
      const visibleIds = annotationStore.getVisibleIds(time);
      fabricCanvas.forEachObject(obj => {
        if (!obj.annotationId) return;
        obj.set('visible', visibleIds.has(obj.annotationId));
      });
      fabricCanvas.renderAll();
    };

    exporter.startExport(
      videoEl,
      fabricCanvas.lowerCanvasEl,
      videoController.duration,
      annotationStore.getVisibleIds,
      setVisibility,
      selectedVideo?.name || 'telestration',
      exportFormat,
    );
  }, [exporter, videoController, annotationStore, selectedVideo, exportFormat]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (mode === 'video') {
        if (e.code === 'Space') {
          e.preventDefault();
          videoController.togglePlay();
          return;
        }
        if (e.code === 'ArrowLeft') { e.preventDefault(); videoController.stepBackward(); return; }
        if (e.code === 'ArrowRight') { e.preventDefault(); videoController.stepForward(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) canvasRef.current?.redo();
        else canvasRef.current?.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'c') {
        canvasRef.current?.copy();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'x') {
        canvasRef.current?.cut();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'v') {
        canvasRef.current?.paste();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'd') {
        e.preventDefault();
        canvasRef.current?.duplicate();
        return;
      }
      if (e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault();
        canvasRef.current?.deleteSelected();
        return;
      }
    }
    if (isEditorMode) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isEditorMode, mode, videoController, toggleFullscreen]);

  // Mode toggle pill
  const modeToggle = (
    <div style={styles.modeToggle}>
      <button
        style={{ ...styles.modeBtn, ...(mode === 'video' ? styles.modeBtnActive : {}) }}
        onClick={() => handleSwitchMode('video')}
      >
        Video
      </button>
      <button
        style={{ ...styles.modeBtn, ...(mode === 'static' ? styles.modeBtnActive : {}) }}
        onClick={() => handleSwitchMode('static')}
      >
        Images
      </button>
    </div>
  );

  // --- Pre-editor: no source loaded ---
  if (!isEditorMode) {
    return (
      <div ref={pageRef} style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <button onClick={handleBack} style={styles.backBtn} title="Back to Toolbox">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span style={styles.headerTitle}>Telestrator</span>
          </div>
          <div style={styles.headerCenter}>
            {modeToggle}
          </div>
          <div style={styles.headerRight} />
        </div>
        {mode === 'video' ? (
          <VideoSourcePanel onSourceSelected={handleSourceSelected} />
        ) : (
          <div style={styles.staticDropZoneWrap}>
            <div
              style={styles.staticDropZone}
              onDragOver={e => e.preventDefault()}
              onDrop={handleStaticDrop}
            >
              <div style={styles.dropIcon}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </div>
              <div style={styles.dropTitle}>Drop images here</div>
              <div style={styles.dropSub}>PNG or JPEG files</div>
              <label style={styles.dropBtn}>
                Browse Files
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/jpg"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) handleAddStaticImages(files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Editor view ---
  return (
    <div ref={pageRef} style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={handleBack} style={styles.backBtn} title="Back to Toolbox">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={styles.headerTitle}>Telestrator</span>
          {mode === 'video' && selectedVideo && (
            <span style={styles.fileName}>{selectedVideo.name}</span>
          )}
          {mode === 'static' && selectedStaticImage && (
            <span style={styles.fileName}>{selectedStaticImage.name}</span>
          )}
        </div>
        <div style={styles.headerCenter}>
          {modeToggle}
        </div>
        <div style={styles.headerRight}>
          <button
            onClick={toggleFullscreen}
            style={styles.fsBtn}
            title="Fullscreen (F)"
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
          {mode === 'video' && (
            <>
              <button
                onClick={() => setShowAnnotationList(prev => !prev)}
                style={{
                  ...styles.toggleBtn,
                  ...(showAnnotationList ? styles.toggleBtnActive : {}),
                }}
                title="Toggle annotations panel"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                <span style={styles.toggleLabel}>
                  {annotationStore.annotations.length}
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        drawColor={drawColor}
        onColorChange={setDrawColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        onUndo={() => canvasRef.current?.undo()}
        onRedo={() => canvasRef.current?.redo()}
        onDelete={() => canvasRef.current?.deleteSelected()}
        onExport={mode === 'static' ? handleExportStaticPNG : handleExport}
        isExporting={exporter.isExporting}
        isYouTube={mode === 'video' ? videoController.isYouTube : false}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        staticMode={mode === 'static'}
      />

      {/* Main content */}
      <div style={styles.mainContent}>
        {/* Viewport */}
        <div ref={viewportRef} style={styles.viewport}>
          {mode === 'video' && selectedVideoSource && (
            <VideoPlayer
              key={selectedVideoId}
              videoSource={selectedVideoSource}
              videoController={videoController}
            />
          )}
          {mode === 'video' && !selectedVideoSource && (
            <div style={styles.noSourcePrompt}>
              <span style={styles.noSourceText}>No video loaded</span>
              <button onClick={() => handleSwitchMode('video')} style={styles.noSourceBtn}>
                Load a Video
              </button>
            </div>
          )}
          {mode === 'static' && selectedStaticImage && (
            <img
              ref={staticImgRef}
              src={selectedStaticImage.url}
              alt={selectedStaticImage.name}
              style={styles.staticImg}
              draggable={false}
            />
          )}
          {mode === 'static' && !selectedStaticImage && (
            <div style={styles.noSourcePrompt}>
              <span style={styles.noSourceText}>Select an image from the panel →</span>
            </div>
          )}
          <DrawingCanvas
            ref={canvasRef}
            activeTool={activeTool}
            drawColor={drawColor}
            strokeWidth={strokeWidth}
            containerSize={canvasSize}
            currentTime={mode === 'video' ? videoController.currentTime : 0}
            annotationStore={annotationStore}
            staticMode={mode === 'static'}
          />
        </div>

        {/* Side panel */}
        {mode === 'video' && (
          <div style={styles.videoSidePanel}>
            <VideoQueuePanel
              videos={videoSources}
              selectedId={selectedVideoId}
              onSelect={handleSelectVideo}
              onAdd={handleAddVideo}
              onRemove={handleRemoveVideo}
            />
            {showAnnotationList && (
              <AnnotationList
                annotations={annotationStore.annotations}
                currentTime={videoController.currentTime}
                onUpdateAnnotation={annotationStore.updateAnnotation}
                onRemoveAnnotation={annotationStore.removeAnnotation}
                onSelectAnnotation={handleSelectAnnotation}
                onClose={() => setShowAnnotationList(false)}
              />
            )}
          </div>
        )}
        {mode === 'static' && (
          <StaticImagePanel
            images={staticImages}
            selectedId={selectedStaticImageId}
            onSelect={handleSelectStaticImage}
            onAddImages={handleAddStaticImages}
          />
        )}
      </div>

      {/* Timeline (video only) */}
      {mode === 'video' && (
        <Timeline
          videoController={videoController}
          annotations={annotationStore.annotations}
          onSelectAnnotation={handleSelectAnnotation}
          onUpdateAnnotation={annotationStore.updateAnnotation}
          onRemoveAnnotation={annotationStore.removeAnnotation}
          isYouTube={videoController.isYouTube}
        />
      )}

      {/* Export progress overlay */}
      {exporter.isExporting && (
        <div style={styles.exportOverlay}>
          <div style={styles.exportCard}>
            <div style={styles.exportTitle}>Exporting Video…</div>
            <div style={styles.exportBarTrack}>
              <div style={{ ...styles.exportBarFill, width: `${Math.round(exporter.exportProgress * 100)}%` }} />
            </div>
            <div style={styles.exportPercent}>{Math.round(exporter.exportProgress * 100)}%</div>
            <button onClick={exporter.cancelExport} style={styles.exportCancelBtn}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0f0f1a',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flex: 1,
  },
  headerCenter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modeToggle: {
    display: 'flex',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '6px',
    overflow: 'hidden',
  },
  modeBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: 'none',
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    padding: '6px 16px',
    fontSize: '13px',
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'background 0.12s, color 0.12s',
  },
  modeBtnActive: {
    background: 'rgba(99,102,241,0.15)',
    color: '#a5b4fc',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s',
  },
  headerTitle: {
    fontSize: '16px',
    fontWeight: 700,
    color: '#ffffff',
  },
  fileName: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.35)',
    fontWeight: 400,
  },
  toggleBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '6px 10px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontFamily: 'inherit',
    transition: 'background 0.15s, border-color 0.15s',
  },
  toggleBtnActive: {
    background: 'rgba(99,102,241,0.12)',
    borderColor: 'rgba(99,102,241,0.3)',
    color: '#a5b4fc',
  },
  toggleLabel: {
    fontVariantNumeric: 'tabular-nums',
  },
  videoSidePanel: {
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    width: '220px',
    overflow: 'hidden',
    borderLeft: '1px solid rgba(255,255,255,0.06)',
  },
  fsBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  },
  viewport: {
    flex: 1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000000',
    overflow: 'hidden',
    minHeight: 0,
  },
  staticImg: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  noSourcePrompt: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    zIndex: 0,
  },
  noSourceText: {
    fontSize: '14px',
    color: 'rgba(255,255,255,0.3)',
  },
  noSourceBtn: {
    background: 'rgba(99,102,241,0.15)',
    border: '1px solid rgba(99,102,241,0.3)',
    color: '#a5b4fc',
    cursor: 'pointer',
    padding: '8px 20px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'inherit',
    transition: 'background 0.12s',
  },
  // Static image drop zone (pre-editor)
  staticDropZoneWrap: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px',
  },
  staticDropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '60px 80px',
    border: '2px dashed rgba(255,255,255,0.1)',
    borderRadius: '16px',
    background: 'rgba(255,255,255,0.02)',
    cursor: 'default',
  },
  dropIcon: {
    marginBottom: '4px',
  },
  dropTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.6)',
  },
  dropSub: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.3)',
  },
  dropBtn: {
    marginTop: '8px',
    background: '#6366f1',
    border: 'none',
    color: '#ffffff',
    cursor: 'pointer',
    padding: '10px 24px',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'inherit',
    fontWeight: 600,
    display: 'inline-block',
    transition: 'background 0.12s',
  },
  exportOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  exportCard: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '12px',
    padding: '32px 40px',
    textAlign: 'center',
    minWidth: '300px',
  },
  exportTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '20px',
  },
  exportBarTrack: {
    height: '6px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '3px',
    overflow: 'hidden',
    marginBottom: '12px',
  },
  exportBarFill: {
    height: '100%',
    background: '#6366f1',
    borderRadius: '3px',
    transition: 'width 0.15s',
  },
  exportPercent: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
    fontVariantNumeric: 'tabular-nums',
    marginBottom: '16px',
  },
  exportCancelBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    padding: '8px 20px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'inherit',
    transition: 'background 0.12s',
  },
};
