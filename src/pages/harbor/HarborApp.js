import React, { useState, useEffect } from 'react';
import HarborHome from './HarborHome';
import HarborRoom from './HarborRoom';
import HarborShowDetail from './HarborShowDetail';

// Harbor sub-router for the staff side of the suite. AppLayout /
// AppLayoutMobile resolve the FIRST URL segment ('harbor' → suiteView) and
// render this component full-screen; this file owns everything after it:
//   /harbor                → HarborHome (Shows | Meetings)
//   /harbor/show/<uuid>    → HarborShowDetail (a show's recordings + downloads)
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

function getShowIdFromPath() {
  const segments = window.location.pathname.replace(/^\/+/, '').split('/');
  if (segments[0] === 'harbor' && segments[1] === 'show' && segments[2]) return segments[2];
  return null;
}

export default function HarborApp({ onBackToLauncher }) {
  const [roomId, setRoomId] = useState(() => getRoomIdFromPath());
  const [showId, setShowId] = useState(() => getShowIdFromPath());

  // Keep the URL in sync with the view (mirror the layouts' pushState idiom).
  // A room wins over a show: opening a recording from inside a show should
  // read as /harbor/room/<id>, and leaving it returns to the show.
  useEffect(() => {
    let target = '/harbor';
    if (roomId) target = `/harbor/room/${roomId}`;
    else if (showId) target = `/harbor/show/${showId}`;
    if (window.location.pathname !== target) window.history.pushState({}, '', target);
  }, [roomId, showId]);

  // Back/forward inside Harbor. The layouts' own popstate handler resolves the
  // suite view first (stays 'harbor' for any /harbor/* path) — this one
  // resolves the room segment.
  useEffect(() => {
    const handlePopState = () => {
      setRoomId(getRoomIdFromPath());
      setShowId(getShowIdFromPath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (roomId) {
    return <HarborRoom sessionId={roomId} onExit={() => setRoomId(null)} />;
  }
  if (showId) {
    return (
      <HarborShowDetail
        showId={showId}
        onOpenRoom={setRoomId}
        onBack={() => setShowId(null)}
      />
    );
  }
  return (
    <HarborHome
      onOpenRoom={setRoomId}
      onOpenShow={setShowId}
      onBackToLauncher={onBackToLauncher}
    />
  );
}
