// Harbor WebRTC mesh manager — framework-free (no React imports).
//
// Topology: full P2P mesh, max 4 participants (producer + 3 guests), so every
// client holds up to 3 RTCPeerConnections. No media server — media flows
// peer-to-peer; only signaling rides Supabase Realtime broadcast (see
// signaling.js).
//
// Glare avoidance: the peer with the lexicographically SMALLER client_id is
// the deterministic initial offerer (connectTo() no-ops on the larger side —
// it waits for the remote's offer). On top of that, every connection runs the
// MDN "perfect negotiation" pattern for renegotiation safety: the LARGER
// client_id is the polite peer (rolls back on collision), the smaller one is
// impolite (ignores colliding offers).

// Default cap: producer + 3 guests. Recording sessions use this; meeting-mode
// sessions raise it (up to ~6 on the mesh) via the constructor's
// maxParticipants, sourced from harbor_sessions.max_participants. Mirrors the
// per-session cap enforced in supabase/functions/harbor-join/index.ts.
export const HARBOR_MAX_PARTICIPANTS = 4;

// ── ICE configuration ──────────────────────────────────────────
// STUN always; TURN when provisioned. Without TURN, peers behind symmetric NAT
// / strict firewalls fail to connect (shows as connectionState 'failed' on the
// tile) — fine for occasional podcast guests, painful for frequent meetings.
//
// TURN is wired from CRA env (build-time inlined), so provisioning a coturn
// daemon needs ZERO code change — set these and redeploy:
//   REACT_APP_TURN_URLS        comma-separated, e.g. "turn:turn.mydomain:3478,turns:turn.mydomain:5349"
//   REACT_APP_TURN_USERNAME    coturn username (or ephemeral-credential user)
//   REACT_APP_TURN_CREDENTIAL  coturn credential
const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

function buildIceServers() {
  const servers = [...STUN_SERVERS];
  const urls = (process.env.REACT_APP_TURN_URLS || '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const username = process.env.REACT_APP_TURN_USERNAME;
  const credential = process.env.REACT_APP_TURN_CREDENTIAL;
  if (urls.length && username && credential) {
    servers.push({ urls, username, credential });
  }
  return servers;
}

export const ICE_SERVERS = buildIceServers();

// What the CAMERA is asked for. This is not what peers receive: the local
// stream feeds both the recorder and the mesh, and a 4K track multiplied by
// three peers would saturate any uplink. capSenderResolution() below scales
// what goes over the wire back down to MESH_SEND_HEIGHT, so a Show can record
// at full resolution while the call still behaves like 720p.
export const CAPTURE_PROFILES = {
  '720p': { width: { ideal: 1280 }, height: { ideal: 720 } },
  '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 } },
  // No `max` — ask high and take whatever the camera actually offers, so
  // "High Quality" means the sensor's real ceiling rather than a guess.
  best: { width: { ideal: 3840 }, height: { ideal: 2160 } },
};

/** Constraints for a capture quality ('720p' | '1080p' | 'best'). */
export function localMediaConstraints(quality = '720p') {
  return {
    video: CAPTURE_PROFILES[quality] || CAPTURE_PROFILES['720p'],
    audio: { echoCancellation: true, noiseSuppression: true },
  };
}

// Back-compat for callers that haven't been given a quality yet.
export const LOCAL_MEDIA_CONSTRAINTS = localMediaConstraints('720p');

// Ceiling for what any peer receives, regardless of capture resolution.
export const MESH_SEND_HEIGHT = 720;
export const MESH_SEND_MAX_BPS = 2500000;

/**
 * Cap one video sender so a high-resolution local capture doesn't flood the
 * mesh. Best-effort by design — scaleResolutionDownBy is unevenly supported,
 * and a browser that ignores it still works, just at higher bitrate.
 */
export async function capSenderResolution(sender) {
  if (!sender || sender.track?.kind !== 'video') return;
  try {
    const height = sender.track.getSettings?.().height || MESH_SEND_HEIGHT;
    const params = sender.getParameters();
    // Firefox hands back an empty encodings array before negotiation.
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].scaleResolutionDownBy = Math.max(1, height / MESH_SEND_HEIGHT);
    params.encodings[0].maxBitrate = MESH_SEND_MAX_BPS;
    await sender.setParameters(params);
  } catch (err) {
    console.warn('Harbor: could not cap sender resolution:', err?.message || err);
  }
}

export class HarborMesh {
  /**
   * @param {object} opts
   * @param {string} opts.clientId      this tab's random id (crypto.randomUUID)
   * @param {(toClientId: string, msg: object) => void} opts.sendSignal
   *        transport callback — wired to signaling.js's channel.send
   * @param {(clientId: string, stream: MediaStream) => void} [opts.onRemoteStream]
   * @param {(clientId: string, state: string) => void} [opts.onPeerState]
   * @param {(clientId: string) => void} [opts.onPeerRemoved]
   * @param {number} [opts.maxParticipants]  session seat cap (incl. self);
   *        defaults to HARBOR_MAX_PARTICIPANTS. The mesh holds one fewer
   *        RTCPeerConnection than this.
   * @param {(active: boolean, screenStream: MediaStream|null) => void} [opts.onScreenShareChange]
   *        fires when screen share starts/stops, including when the browser's
   *        native "Stop sharing" ends it out from under us.
   * @param {'720p'|'1080p'|'best'} [opts.captureQuality]  what to ask the
   *        camera for. Peers still receive MESH_SEND_HEIGHT regardless; only
   *        the local recording sees the full resolution.
   */
  constructor({ clientId, sendSignal, onRemoteStream, onPeerState, onPeerRemoved, maxParticipants = HARBOR_MAX_PARTICIPANTS, onScreenShareChange, captureQuality = '720p' }) {
    this.clientId = clientId;
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onPeerState = onPeerState;
    this.onPeerRemoved = onPeerRemoved;
    this.onScreenShareChange = onScreenShareChange;
    this.maxRemotePeers = Math.max(1, (maxParticipants || HARBOR_MAX_PARTICIPANTS) - 1);
    this.captureQuality = captureQuality;
    this.peers = new Map(); // clientId → { pc, makingOffer, ignoreOffer, settingRemoteAnswer, polite }
    this.localStream = null;
    // Present mode: while sharing, each peer's outgoing VIDEO sender carries the
    // screen track instead of the camera (replaceTrack — same kind, so no
    // renegotiation and no glare). localStream keeps the camera track, so the
    // recorder + mute logic are untouched; only what peers receive changes.
    this.screenStream = null;
    this.screenTrack = null;
    this.closed = false;
  }

  /** Acquire (or adopt) local media. Reuses a preview stream when provided so
   *  the camera light never double-blinks between device-check and call. */
  async startLocalMedia(existingStream = null) {
    if (this.localStream) return this.localStream;
    this.localStream =
      existingStream ||
      (await navigator.mediaDevices.getUserMedia(localMediaConstraints(this.captureQuality)));
    return this.localStream;
  }

  /** Called on peer discovery (presence join / hello broadcast). Only the
   *  smaller client_id initiates; the larger side waits for the offer. */
  connectTo(remoteId) {
    if (this.closed || !remoteId || remoteId === this.clientId) return;
    if (this.peers.has(remoteId)) return;
    if (this.clientId < remoteId) this._ensurePeer(remoteId);
  }

  _ensurePeer(remoteId) {
    let peer = this.peers.get(remoteId);
    if (peer) return peer;
    if (this.closed || this.peers.size >= this.maxRemotePeers) return null;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      polite: this.clientId > remoteId,
    };
    this.peers.set(remoteId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        // Recording keeps the full-resolution track; peers get 720p.
        if (track.kind === 'video') capSenderResolution(sender);
      }
    }
    // Late joiner while we're presenting: send them the screen, not the camera.
    if (this.screenTrack) this._applyScreenToPeer(peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription(); // implicit offer
        this.sendSignal(remoteId, { type: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.warn('harbor mesh: negotiation failed', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal(remoteId, { type: 'ice', candidate: e.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      this.onPeerState?.(remoteId, pc.connectionState);
      if (pc.connectionState === 'failed' && typeof pc.restartIce === 'function') {
        pc.restartIce(); // triggers negotiationneeded → new offer w/ fresh ICE
      }
    };

    pc.ontrack = (e) => {
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      this.onRemoteStream?.(remoteId, stream);
    };

    return peer;
  }

  /** Perfect-negotiation message pump for offer / answer / ice. */
  async handleSignal(fromId, msg) {
    if (this.closed || !fromId || fromId === this.clientId) return;
    const peer = this._ensurePeer(fromId);
    if (!peer) return; // at capacity
    const { pc } = peer;

    try {
      if (msg.type === 'offer' || msg.type === 'answer') {
        const description = msg.sdp;
        if (!description) return;
        const readyForOffer =
          !peer.makingOffer && (pc.signalingState === 'stable' || peer.settingRemoteAnswer);
        const offerCollision = description.type === 'offer' && !readyForOffer;
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return; // impolite: drop; remote (polite) will re-sync

        peer.settingRemoteAnswer = description.type === 'answer';
        await pc.setRemoteDescription(description); // polite side auto-rolls-back on glare
        peer.settingRemoteAnswer = false;

        if (description.type === 'offer') {
          await pc.setLocalDescription(); // implicit answer
          this.sendSignal(fromId, { type: 'answer', sdp: pc.localDescription });
        }
      } else if (msg.type === 'ice') {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          // Candidates for an offer we deliberately ignored are expected noise.
          if (!peer.ignoreOffer) console.warn('harbor mesh: addIceCandidate failed', err);
        }
      }
    } catch (err) {
      console.warn('harbor mesh: signal handling failed', err);
    }
  }

  /** Tear down one peer (leave broadcast / presence leave). */
  removePeer(remoteId) {
    const peer = this.peers.get(remoteId);
    if (!peer) return;
    this.peers.delete(remoteId);
    try {
      peer.pc.onnegotiationneeded = null;
      peer.pc.onicecandidate = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.ontrack = null;
      peer.pc.close();
    } catch {
      /* already closed */
    }
    this.onPeerRemoved?.(remoteId);
  }

  /** The video RTCRtpSender for one peer (camera or, while presenting, screen). */
  _videoSender(peer) {
    return peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video') || null;
  }

  /** Point one peer's video sender at the current screen track. */
  _applyScreenToPeer(peer) {
    const sender = this._videoSender(peer);
    if (sender && this.screenTrack) sender.replaceTrack(this.screenTrack).catch(() => {});
  }

  get isScreenSharing() {
    return !!this.screenStream;
  }

  /** Start present mode: capture a display surface and swap it in for the
   *  camera on every peer's video sender. Resolves the screen MediaStream (for
   *  local preview) or null if the user cancelled the picker. */
  async startScreenShare() {
    if (this.closed || this.screenStream) return this.screenStream;
    let screen;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch (err) {
      // AbortError/NotAllowedError = user dismissed the picker — not fatal.
      if (err?.name !== 'AbortError' && err?.name !== 'NotAllowedError') {
        console.warn('harbor mesh: getDisplayMedia failed', err);
      }
      return null;
    }
    if (this.closed) {
      screen.getTracks().forEach((t) => t.stop());
      return null;
    }
    this.screenStream = screen;
    this.screenTrack = screen.getVideoTracks()[0] || null;
    // The browser's own "Stop sharing" control ends the track directly.
    this.screenTrack?.addEventListener('ended', () => this.stopScreenShare());
    for (const peer of this.peers.values()) this._applyScreenToPeer(peer);
    this.onScreenShareChange?.(true, screen);
    return screen;
  }

  /** Stop present mode: restore the camera track on every peer's video sender
   *  and release the display capture. Safe to call when not sharing. */
  stopScreenShare() {
    if (!this.screenStream) return;
    const camera = this.localStream?.getVideoTracks()[0] || null;
    for (const peer of this.peers.values()) {
      const sender = this._videoSender(peer);
      if (sender) sender.replaceTrack(camera).catch(() => {});
    }
    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenTrack = null;
    this.onScreenShareChange?.(false, null);
  }

  setAudioEnabled(on) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = on;
    });
  }

  setVideoEnabled(on) {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
  }

  /** Full teardown: close every peer and STOP local tracks (kills the camera
   *  light). Safe to call multiple times. */
  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    // Release the display capture directly (no onScreenShareChange — the
    // component is tearing down and must not receive a late setState).
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.screenTrack = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }
}
