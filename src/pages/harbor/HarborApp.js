import React, { useState, useEffect } from 'react';
import HarborHome from './HarborHome';
import HarborRoom from './HarborRoom';

// Harbor sub-router for the staff side of the suite. AppLayout /
// AppLayoutMobile resolve the FIRST URL segment ('harbor' → suiteView) and
// render this component full-screen; this file owns everything after it:
//   /harbor                → HarborHome (sessions list)
//   /harbor/room/<uuid>    → HarborRoom (the call)
// The layouts' URL-sync effect only compares the first segment, so deeper
// /harbor/* paths pushed here are never clobbered (AppLayout.js tab→URL
// effect). The PUBLIC guest route /harbor/join/<token> never reaches this —
// App.js serves it before the auth gate.

function getRoomIdFromPath() {
  const segments = window.location.pathname.replace(/^\/+/, '').split('/');
  if (segments[0] === 'harbor' && segments[1] === 'room' && segments[2]) return segments[2];
  return null;
}

export default function HarborApp({ onBackToLauncher }) {
  const [roomId, setRoomId] = useState(() => getRoomIdFromPath());

  // Keep the URL in sync with the view (mirror the layouts' pushState idiom).
  useEffect(() => {
    const target = roomId ? `/harbor/room/${roomId}` : '/harbor';
    if (window.location.pathname !== target) window.history.pushState({}, '', target);
  }, [roomId]);

  // Back/forward inside Harbor. The layouts' own popstate handler resolves the
  // suite view first (stays 'harbor' for any /harbor/* path) — this one
  // resolves the room segment.
  useEffect(() => {
    const handlePopState = () => setRoomId(getRoomIdFromPath());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (roomId) {
    return <HarborRoom sessionId={roomId} onExit={() => setRoomId(null)} />;
  }
  return <HarborHome onOpenRoom={setRoomId} onBackToLauncher={onBackToLauncher} />;
}
