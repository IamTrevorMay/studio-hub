import React, { useState, useCallback, useRef, useEffect } from 'react';
import VideoSourcePanel from './telestration/VideoSourcePanel';
import VideoPlayer from './telestration/VideoPlayer';
import DrawingCanvas from './telestration/DrawingCanvas';
import Toolbar from './telestration/Toolbar';
import Timeline from './telestration/Timeline';
import AnnotationList from './telestration/AnnotationList';
import useVideoController from './telestration/useVideoController';
import useAnnotationStore from './telestration/useAnnotationStore';
import useExporter from './telestration/useExporter';
import { DEFAULT_SETTINGS } from './telestration/telestrationConstants';
import { loadSettings, saveSettings } from './telestration/telestrationStorage';

export default function Telestration({ onBack }) {
  const [videoSource, setVideoSource] = useState(null);
  const [showAnnotationList, setShowAnnotationList] = useState(false);
  const videoController = useVideoController();
  const annotationStore = useAnnotationStore();
  const exporter = useExporter();
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 960, height: 540 });

  // Drawing state (persisted)
  const saved = loadSettings();
  const [activeTool, setActiveTool] = useState(saved.activeTool || DEFAULT_SETTINGS.activeTool);
  const [drawColor, setDrawColor] = useState(saved.drawColor || DEFAULT_SETTINGS.drawColor);
  const [strokeWidth, setStrokeWidth] = useState(saved.strokeWidth || DEFAULT_SETTINGS.strokeWidth);

  // Persist drawing settings
  useEffect(() => {
    saveSettings({ activeTool, drawColor, strokeWidth });
  }, [activeTool, drawColor, strokeWidth]);

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
  }, [videoSource]);

  const handleSourceSelected = useCallback((source) => {
    setVideoSource(source);
  }, []);

  const handleBack = useCallback(() => {
    if (videoSource?.type === 'file' && videoSource.url) {
      URL.revokeObjectURL(videoSource.url);
    }
    onBack();
  }, [videoSource, onBack]);

  const handleChangeSource = useCallback(() => {
    videoController.pause();
    if (videoSource?.type === 'file' && videoSource.url) {
      URL.revokeObjectURL(videoSource.url);
    }
    setVideoSource(null);
  }, [videoSource, videoController]);

  // Select annotation: seek to its start and select on canvas
  const handleSelectAnnotation = useCallback((annId) => {
    const ann = annotationStore.annotations.find(a => a.id === annId);
    if (ann) {
      videoController.seek(ann.startTime);
      canvasRef.current?.selectByAnnotationId(annId);
    }
  }, [annotationStore.annotations, videoController]);

  // Export handler
  const handleExport = useCallback(() => {
    if (exporter.isExporting) return;
    const videoEl = videoController.videoRef.current;
    const fabricCanvas = canvasRef.current?.getCanvas();
    if (!videoEl || !fabricCanvas) return;

    videoController.pause();

    // Visibility callback: update Fabric objects for a given time during export
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
      videoSource?.fileName || 'telestration',
    );
  }, [exporter, videoController, annotationStore, videoSource]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

      if (e.code === 'Space') {
        e.preventDefault();
        videoController.togglePlay();
        return;
      }
      if (e.code === 'ArrowLeft') { e.preventDefault(); videoController.stepBackward(); return; }
      if (e.code === 'ArrowRight') { e.preventDefault(); videoController.stepForward(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) canvasRef.current?.redo();
        else canvasRef.current?.undo();
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        e.preventDefault();
        canvasRef.current?.deleteSelected();
        return;
      }
    }
    if (videoSource) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [videoSource, videoController]);

  // No video loaded — show source panel
  if (!videoSource) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <button onClick={handleBack} style={styles.backBtn} title="Back to Toolbox">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <span style={styles.headerTitle}>Telestration</span>
          </div>
        </div>
        <VideoSourcePanel onSourceSelected={handleSourceSelected} />
      </div>
    );
  }

  // Video loaded — show editor
  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button onClick={handleBack} style={styles.backBtn} title="Back to Toolbox">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span style={styles.headerTitle}>Telestration</span>
          {videoSource.fileName && (
            <span style={styles.fileName}>{videoSource.fileName}</span>
          )}
        </div>
        <div style={styles.headerRight}>
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
          <button onClick={handleChangeSource} style={styles.changeBtn}>
            Change Video
          </button>
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
        onExport={handleExport}
        isExporting={exporter.isExporting}
        isYouTube={videoController.isYouTube}
      />

      {/* Main content: viewport + optional annotation list */}
      <div style={styles.mainContent}>
        {/* Video viewport + canvas overlay */}
        <div ref={viewportRef} style={styles.viewport}>
          <VideoPlayer
            videoSource={videoSource}
            videoController={videoController}
          />
          <DrawingCanvas
            ref={canvasRef}
            activeTool={activeTool}
            drawColor={drawColor}
            strokeWidth={strokeWidth}
            containerSize={canvasSize}
            currentTime={videoController.currentTime}
            annotationStore={annotationStore}
          />
        </div>

        {/* Annotation list panel */}
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

      {/* Timeline */}
      <Timeline
        videoController={videoController}
        annotations={annotationStore.annotations}
        onSelectAnnotation={handleSelectAnnotation}
        onUpdateAnnotation={annotationStore.updateAnnotation}
        isYouTube={videoController.isYouTube}
      />

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
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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
  changeBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer',
    padding: '6px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontFamily: 'inherit',
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
