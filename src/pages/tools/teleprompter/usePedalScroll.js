import { useRef, useState, useCallback, useEffect } from 'react';

// Scroll speed in px/sec while a pedal is held
const SCROLL_PX_PER_SEC = 150;

export default function usePedalScroll(scrollRef) {
  const [connected, setConnected] = useState(false);
  const deviceRef = useRef(null);
  const directionRef = useRef(0); // -1 = up, 1 = down, 0 = stopped
  const lastTimeRef = useRef(null);
  const rafRef = useRef(null);

  const scrollLoop = useCallback((timestamp) => {
    if (directionRef.current === 0) {
      lastTimeRef.current = null;
      rafRef.current = null;
      return;
    }
    if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
    const delta = Math.min(timestamp - lastTimeRef.current, 100);
    lastTimeRef.current = timestamp;

    if (scrollRef.current) {
      scrollRef.current.scrollTop += directionRef.current * (SCROLL_PX_PER_SEC * delta) / 1000;
    }
    rafRef.current = requestAnimationFrame(scrollLoop);
  }, [scrollRef]);

  const handleInputReport = useCallback((event) => {
    const { data } = event;
    if (!data || data.byteLength === 0) return;
    const byte = data.getUint8(0);

    const leftHeld = (byte & 0x01) !== 0;
    const rightHeld = (byte & 0x02) !== 0;

    if (leftHeld) {
      directionRef.current = -1;
    } else if (rightHeld) {
      directionRef.current = 1;
    } else {
      directionRef.current = 0;
    }

    // Kick off rAF loop if not already running
    if (directionRef.current !== 0 && !rafRef.current) {
      lastTimeRef.current = null;
      rafRef.current = requestAnimationFrame(scrollLoop);
    }
  }, [scrollLoop]);

  const connectPedal = useCallback(async () => {
    if (!navigator.hid) {
      alert('WebHID is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    // If already connected, disconnect
    if (deviceRef.current) {
      try {
        deviceRef.current.removeEventListener('inputreport', handleInputReport);
        await deviceRef.current.close();
      } catch (_) {}
      deviceRef.current = null;
      setConnected(false);
      directionRef.current = 0;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }

    try {
      const devices = await navigator.hid.requestDevice({ filters: [] });
      if (!devices || devices.length === 0) return;
      const device = devices[0];
      if (!device.opened) await device.open();

      device.addEventListener('inputreport', handleInputReport);

      const onDisconnect = () => {
        setConnected(false);
        directionRef.current = 0;
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        deviceRef.current = null;
      };
      device.addEventListener('disconnect', onDisconnect);

      deviceRef.current = device;
      setConnected(true);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('Pedal connect error:', err);
      }
    }
  }, [handleInputReport]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      directionRef.current = 0;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const dev = deviceRef.current;
      if (dev) {
        dev.removeEventListener('inputreport', handleInputReport);
        if (dev.opened) dev.close().catch(() => {});
      }
    };
  }, []); // eslint-disable-line

  return { pedalConnected: connected, connectPedal };
}
