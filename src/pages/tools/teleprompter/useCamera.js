import { useState, useEffect, useRef, useCallback } from 'react';

export default function useCamera() {
  const [devices, setDevices] = useState([]);
  const [activeDeviceId, setActiveDeviceId] = useState(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const streamRef = useRef(null);

  // Enumerate video devices
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter(d => d.kind === 'videoinput');
      setDevices(cams);
      return cams;
    } catch (err) {
      setError('Could not list camera devices');
      return [];
    }
  }, []);

  // Start stream for a given deviceId (or default)
  const startStream = useCallback(async (deviceId) => {
    // Stop existing stream first
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    try {
      const constraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = s;
      setStream(s);
      setError(null);

      // After getting permission, re-enumerate to get labels
      const cams = await refreshDevices();
      const track = s.getVideoTracks()[0];
      const usedId = track?.getSettings()?.deviceId;
      if (usedId) setActiveDeviceId(usedId);
      else if (cams.length > 0) setActiveDeviceId(cams[0].deviceId);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Camera permission denied');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found');
      } else {
        setError('Could not access camera');
      }
    }
  }, [refreshDevices]);

  // Switch to a different device
  const switchDevice = useCallback((deviceId) => {
    setActiveDeviceId(deviceId);
    startStream(deviceId);
  }, [startStream]);

  // Stop camera
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setStream(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return {
    devices,
    activeDeviceId,
    stream,
    error,
    startStream,
    switchDevice,
    stopStream,
  };
}
