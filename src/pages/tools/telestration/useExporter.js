import { useState, useRef, useCallback } from 'react';

export default function useExporter() {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const cancelledRef = useRef(false);
  const recorderRef = useRef(null);
  const rafRef = useRef(null);

  const cancelExport = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setIsExporting(false);
    setExportProgress(0);
  }, []);

  /**
   * Export annotated video as .webm
   *
   * @param {HTMLVideoElement} videoEl - the source video element
   * @param {HTMLCanvasElement} fabricCanvasEl - Fabric's lower canvas element (the rendered drawing)
   * @param {number} duration - video duration in seconds
   * @param {Function} getVisibleIds - annotationStore.getVisibleIds
   * @param {Function} setVisibility - callback(time) to update Fabric object visibility and re-render
   * @param {string} fileName - base name for the downloaded file
   */
  const startExport = useCallback(async (videoEl, fabricCanvasEl, duration, getVisibleIds, setVisibility, fileName) => {
    if (!videoEl || !fabricCanvasEl || !duration) return;

    cancelledRef.current = false;
    setIsExporting(true);
    setExportProgress(0);

    // Create offscreen compositing canvas at video's native resolution
    const width = videoEl.videoWidth;
    const height = videoEl.videoHeight;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');

    // Set up MediaRecorder on the offscreen canvas stream
    const stream = offscreen.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    recorderRef.current = recorder;
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const downloadPromise = new Promise((resolve) => {
      recorder.onstop = () => {
        if (cancelledRef.current) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const baseName = fileName ? fileName.replace(/\.[^.]+$/, '') : 'telestration';
        a.href = url;
        a.download = `${baseName}_annotated.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        resolve(blob);
      };
    });

    // Seek video to start
    videoEl.currentTime = 0;
    videoEl.playbackRate = 1;

    // Wait for seek to complete
    await new Promise((resolve) => {
      const onSeeked = () => { videoEl.removeEventListener('seeked', onSeeked); resolve(); };
      videoEl.addEventListener('seeked', onSeeked);
    });

    // Start recording
    recorder.start();

    // Play the video and composite each frame
    videoEl.play();

    const compositeFrame = () => {
      if (cancelledRef.current) return;

      const currentTime = videoEl.currentTime;
      setExportProgress(Math.min(currentTime / duration, 1));

      // Update annotation visibility for this frame
      if (setVisibility) setVisibility(currentTime);

      // Draw video frame
      ctx.drawImage(videoEl, 0, 0, width, height);

      // Draw Fabric canvas overlay (scaled from display size to native resolution)
      ctx.drawImage(fabricCanvasEl, 0, 0, width, height);

      if (videoEl.ended || currentTime >= duration - 0.05) {
        // Done — stop recording
        videoEl.pause();
        setExportProgress(1);
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, 100);
        return;
      }

      rafRef.current = requestAnimationFrame(compositeFrame);
    };

    rafRef.current = requestAnimationFrame(compositeFrame);

    // Wait for download
    await downloadPromise;
    setIsExporting(false);
    setExportProgress(0);
  }, []);

  return {
    isExporting,
    exportProgress,
    startExport,
    cancelExport,
  };
}
