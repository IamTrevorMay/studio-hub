import { useState, useCallback, useRef } from 'react';
import { DEFAULT_ANNOTATION_DURATION } from './telestrationConstants';
import { loadProject, saveProject } from './telestrationStorage';

export default function useAnnotationStore() {
  const [annotations, setAnnotations] = useState(() => {
    const saved = loadProject();
    return saved.annotations || [];
  });
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const persist = useCallback((next) => {
    setAnnotations(next);
    saveProject({ annotations: next });
  }, []);

  // Add a new annotation tied to the current video time
  const addAnnotation = useCallback((annotation) => {
    const next = [...annotationsRef.current, annotation];
    persist(next);
    return annotation;
  }, [persist]);

  // Build annotation metadata for a new Fabric object
  const createAnnotationEntry = useCallback((fabricObjectJSON, currentTime, color, type) => {
    return {
      id: crypto.randomUUID(),
      fabricJSON: fabricObjectJSON,
      startTime: currentTime,
      endTime: currentTime + DEFAULT_ANNOTATION_DURATION,
      color: color || '#ef4444',
      type: type || 'pen',
    };
  }, []);

  // Update an existing annotation
  const updateAnnotation = useCallback((id, updates) => {
    const next = annotationsRef.current.map(a =>
      a.id === id ? { ...a, ...updates } : a
    );
    persist(next);
  }, [persist]);

  // Remove an annotation
  const removeAnnotation = useCallback((id) => {
    const next = annotationsRef.current.filter(a => a.id !== id);
    persist(next);
  }, [persist]);

  // Get IDs of annotations visible at a given time
  const getVisibleIds = useCallback((time) => {
    const visible = new Set();
    annotationsRef.current.forEach(a => {
      if (time >= a.startTime && time <= a.endTime) {
        visible.add(a.id);
      }
    });
    return visible;
  }, []);

  // Clear all annotations
  const clearAll = useCallback(() => {
    persist([]);
  }, [persist]);

  return {
    annotations,
    addAnnotation,
    createAnnotationEntry,
    updateAnnotation,
    removeAnnotation,
    getVisibleIds,
    clearAll,
  };
}
