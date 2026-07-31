import React, { useState, useEffect, useRef, useCallback } from 'react';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamily, transitions, zIndex, shadows } from '../../lib/styleTokens';
import { pill, button, sectionHeader } from '../../lib/styleRecipes';
import { HarborMesh } from '../../lib/harbor/mesh';
import { joinSignalingChannel } from '../../lib/harbor/signaling';
import { HarborRecorder } from '../../lib/harbor/recorder';

// Shared live-call surface for Harbor — used by both HarborRoom (staff /
// producer side) and HarborJoin (public guest side). Owns the mesh +
// signaling lifecycle: acquire media, join the broadcast channel, connect
// peers as presence/hello reveals them, tear everything down on unmount
// (no camera-light-stuck-on bugs).
//
// Session control: when canControlSession (producer), Start/End buttons call
// onUpdateSessionStatus (the parent does the DB write under RLS) and then the
// new status is broadcast as a 'state' message so guests — who can't read the
// table — follow along live.
//
// Phase 3 — green room + moderation. Participant state machine:
//   lobby → admitted → (removed)
// A lobby guest subscribes to signaling (presence meta state:'lobby') and
// keeps their camera warm, but is EXCLUDED from the mesh in four places:
//   1. a lobby client never sends 'hello' and never calls connectTo
//   2. a lobby client drops incoming offer/answer/ice (no media in or out)
//   3. admitted clients skip connectTo for presence-lobby peers
//   4. admitted clients drop offer/answer/ice from known-lobby senders
// Admit: the producer's parent updates the row under RLS
// (onAdmitParticipant), then a targeted 'admit' signal flips the guest to
// admitted — it re-tracks presence and broadcasts 'hello', joining the mesh
// exactly like a Phase 1 late joiner. Moderation signals (mute /
// request-unmute / remove) are honored only from a presence-verified
// producer, same trust model as Phase 2's 'record' commands.

const CONN_TONES = {
  connected: 'success',
  connecting: 'warning',
  new: 'warning',
  disconnected: 'warning',
  failed: 'danger',
  closed: 'danger',
};

const STATUS_LABELS = { scheduled: 'Scheduled', live: 'Live', ended: 'Ended' };
const STATUS_TONES = { scheduled: 'info', live: 'success', ended: 'danger' };

// While recording, 'record-state' rebroadcasts are throttled to this cadence
// (status transitions always broadcast immediately).
const REC_BROADCAST_THROTTLE_MS = 5000;
const TOAST_MS = 4000;
// Lost-admit recovery: while in the lobby, re-check our DB state at this
// cadence via onCheckAdmission (the harbor-join re-join path) — if the
// producer's RLS write landed but the targeted 'admit' signal got lost, the
// poll flips us into the call instead of leaving the guest stuck.
const ADMIT_POLL_MS = 15000;

/** Upload-health label for the SELF tile, from a recorder state snapshot. */
function recHealthLabel(state) {
  if (!state) return null;
  switch (state.status) {
    case 'starting':
      return 'Starting…';
    case 'recording':
      return state.pending > 0 ? `Saving — ${state.pending} behind` : 'All safe';
    case 'flushing':
      return `Saving — ${state.pending} to go`;
    case 'complete':
      return 'Saved';
    case 'failed':
      return 'Recording failed';
    default:
      return null;
  }
}

/** Upload-health label for a REMOTE tile, from its record-state broadcast. */
function remoteRecLabel(rec) {
  if (!rec) return null;
  if (rec.status === 'failed' || rec.health === 'failed') return 'Recording failed';
  if (rec.recording) return rec.pending > 0 ? `Saving — ${rec.pending} behind` : 'All safe';
  if (rec.status === 'complete') return 'Saved';
  return null;
}

export default function CallStage({
  channelName,
  clientId,
  displayName,
  role, // 'producer' | 'guest'
  session, // { id, title, status }
  mode = 'recording', // 'recording' | 'meeting'
  maxParticipants = 4, // session seat cap → mesh peer limit
  participantId = null, // own harbor_participants row id (presence meta)
  initialParticipantState = 'admitted', // 'lobby' for green-room guests
  initialStream = null, // reuse a device-check preview stream (guest flow)
  canControlSession = false,
  recordEnabled = true, // meeting mode gates recording; recording mode passes true
  onToggleRecordEnabled = null, // async (next) => void — host flips record_enabled (meeting only)
  onUpdateSessionStatus, // async (nextStatus) => void — parent writes the DB
  onAdmitParticipant = null, // async (participantId) => void — staff RLS write
  onRemoveParticipant = null, // async (participantId) => void — staff RLS write
  onLeave, // (reason: 'left' | 'ended' | 'removed') => void
  onPageUnload, // best-effort hard-unload hook (guest leave beacon)
  onCheckAdmission = null, // async () => 'lobby'|'admitted'|null — lobby poll (guest flow)
  createRecorderTransport = null, // () => transport (see recorderTransports.js)
}) {
  const isMeeting = mode === 'meeting';
  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState(null);
  const [channelStatus, setChannelStatus] = useState('connecting');
  const [sessionStatus, setSessionStatus] = useState(session?.status || 'scheduled');
  const [pState, setPState] = useState(initialParticipantState); // lobby | admitted | removed
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // remotes: clientId → { name, role, state, participantId, stream, connState, micOn, camOn, rec }
  const [remotes, setRemotes] = useState({});
  const [savingStatus, setSavingStatus] = useState(false);
  const [recState, setRecState] = useState(null); // own recorder snapshot
  // Meeting-mode recording opt-in (host-toggled, broadcast over 'state').
  // Recording-mode sessions pass recordEnabled=true and never show the toggle.
  const [recEnabled, setRecEnabled] = useState(recordEnabled);
  const [togglingRec, setTogglingRec] = useState(false); // meeting host record-enable write in flight
  const [toast, setToast] = useState(null); // transient banner ("The producer muted you")
  const [unmuteAsk, setUnmuteAsk] = useState(false); // producer asked us to unmute
  const [busyAdmit, setBusyAdmit] = useState({}); // clientId → true while admitting

  const meshRef = useRef(null);
  const signalRef = useRef(null);
  const selfStateRef = useRef({ micOn: true, camOn: true });
  const recorderRef = useRef(null);
  const transportFactoryRef = useRef(createRecorderTransport);
  transportFactoryRef.current = createRecorderTransport;
  const presenceMetaRef = useRef({}); // clientId → { role, state } (presence-verified)
  const pStateRef = useRef(initialParticipantState);
  const recEnabledRef = useRef(recordEnabled); // synchronous mirror for signal handlers
  const admitSelfRef = useRef(null); // lobby→admitted transition (set in the mount effect)
  const lastRecBroadcastRef = useRef({ at: 0, status: null });

  const upsertRemote = useCallback((id, patch) => {
    setRemotes((prev) => ({
      ...prev,
      [id]: {
        name: 'Guest',
        role: 'guest',
        state: 'admitted',
        micOn: true,
        camOn: true,
        ...(prev[id] || {}),
        ...patch,
      },
    }));
  }, []);

  const dropRemote = useCallback((id) => {
    setRemotes((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Set (not toggle) own mic, sync mesh + peers. Used by the mic button, the
  // producer 'mute' signal, and the request-unmute banner's Unmute button.
  const applyMic = useCallback((next) => {
    meshRef.current?.setAudioEnabled(next);
    setMicOn(next);
    selfStateRef.current = { ...selfStateRef.current, micOn: next };
    signalRef.current?.send('state', { micOn: next });
    if (next) setUnmuteAsk(false); // any unmute settles the producer's ask
  }, []);

  // ── Local recording (Phase 2) ────────────────────────────────
  // Every client records its OWN camera/mic and uploads through its
  // transport — recording quality never depends on the call. 'record'
  // commands arrive over signaling; 'record-state' broadcasts drive the
  // producer's tile badges (immediate on transitions, throttled while
  // recording — chunk uploads emit ~every 5s anyway).
  const broadcastRecState = useCallback((state) => {
    const last = lastRecBroadcastRef.current;
    const now = Date.now();
    const transition = state.status !== last.status;
    if (!transition && now - last.at < REC_BROADCAST_THROTTLE_MS) return;
    lastRecBroadcastRef.current = { at: now, status: state.status };
    signalRef.current?.send('record-state', {
      recording:
        state.status === 'starting' || state.status === 'recording' || state.status === 'flushing',
      trackId: state.trackId,
      recStatus: state.status,
      health: state.health,
      pending: state.pending,
    });
  }, []);

  const startRecording = useCallback(async () => {
    const factory = transportFactoryRef.current;
    const source = meshRef.current?.localStream;
    if (!factory || !source) return;
    const current = recorderRef.current?.getState().status;
    if (current === 'starting' || current === 'recording' || current === 'flushing') return;
    // Mute-proof recording (explicit product decision): the call mutes by
    // flipping track.enabled on the SHARED mic track, so the recorder gets
    // CLONES of the audio tracks taken here — producer-mute and self-mute
    // silence the mesh, never the recording. clone() copies the enabled
    // flag, so clones are force-enabled in case we start while muted. The
    // recorder OWNS the clones and stops them the moment MediaRecorder
    // stops (no mic-light leaks). Video stays the shared track on purpose:
    // "Cam off" is a privacy control and should blank the recording too.
    const audioClones = source.getAudioTracks().map((track) => {
      const clone = track.clone();
      clone.enabled = true;
      return clone;
    });
    const recorder = new HarborRecorder({
      stream: new MediaStream([...source.getVideoTracks(), ...audioClones]),
      ownedTracks: audioClones,
      transport: factory(),
      onState: (state) => {
        setRecState(state);
        broadcastRecState(state);
      },
    });
    recorderRef.current = recorder;
    setRecState(recorder.getState());
    try {
      await recorder.start();
    } catch (err) {
      // The engine released the owned clones on the failure path.
      console.error('Harbor: recording failed to start:', err);
    }
  }, [broadcastRecState]);

  const stopRecording = useCallback(() => {
    // Flush + finalize continue async — uploads don't need the media stream.
    recorderRef.current?.stop();
  }, []);

  // ── Mesh + signaling lifecycle (mount once) ──────────────────
  useEffect(() => {
    let cancelled = false;

    const mesh = new HarborMesh({
      clientId,
      maxParticipants,
      sendSignal: (to, msg) => signalRef.current?.send(msg.type, msg, to),
      onRemoteStream: (id, stream) => upsertRemote(id, { stream }),
      onPeerState: (id, connState) => upsertRemote(id, { connState }),
      onPeerRemoved: (id) => dropRemote(id),
    });
    meshRef.current = mesh;

    const fromProducer = (id) => presenceMetaRef.current[id]?.role === 'producer';

    // The ONE lobby→admitted transition, shared by the targeted 'admit'
    // signal and the lost-admit recovery poll. The synchronous pStateRef
    // guard makes it idempotent — signal and poll landing back-to-back on
    // the single JS thread can't double-fire the presence flip / hello.
    admitSelfRef.current = () => {
      if (pStateRef.current !== 'lobby') return;
      pStateRef.current = 'admitted';
      setPState('admitted');
      // Join the mesh exactly like a Phase 1 late joiner: presence flip +
      // hello, then initiate toward every admitted peer we already know.
      signalRef.current?.updatePresence({ state: 'admitted' });
      signalRef.current?.send('hello', { name: displayName, role });
      for (const [id, meta] of Object.entries(presenceMetaRef.current)) {
        if (meta.state !== 'lobby') mesh.connectTo(id);
      }
    };

    const handleSignal = (payload) => {
      switch (payload.type) {
        case 'hello':
          // A lobby client stays out of the mesh entirely.
          if (pStateRef.current !== 'admitted') break;
          // hello = "I'm in the mesh now". Mark the sender admitted right
          // away: after an admit, their hello (and the offers right behind
          // it) can arrive before their presence re-track syncs, and gating
          // those offers on stale lobby presence would stall the mesh.
          presenceMetaRef.current[payload.from] = {
            ...(presenceMetaRef.current[payload.from] || {}),
            role: payload.role,
            state: 'admitted',
          };
          upsertRemote(payload.from, { name: payload.name, role: payload.role, state: 'admitted' });
          mesh.connectTo(payload.from);
          // Tell the newcomer our current mute state (they missed past
          // broadcasts). A producer also seeds the live record-enabled flag so
          // a late joiner's UI matches the room without waiting for a toggle.
          signalRef.current?.send(
            'state',
            { ...selfStateRef.current, ...(role === 'producer' ? { recordEnabled: recEnabledRef.current } : {}) },
            payload.from,
          );
          break;
        case 'offer':
        case 'answer':
        case 'ice':
          // No media in or out of the lobby — mine or theirs.
          if (pStateRef.current !== 'admitted') break;
          if (presenceMetaRef.current[payload.from]?.state === 'lobby') break;
          mesh.handleSignal(payload.from, payload);
          break;
        case 'leave':
          mesh.removePeer(payload.from);
          dropRemote(payload.from);
          break;
        case 'state':
          if (payload.status) setSessionStatus(payload.status);
          if (typeof payload.recordEnabled === 'boolean') {
            recEnabledRef.current = payload.recordEnabled;
            setRecEnabled(payload.recordEnabled);
          }
          if (typeof payload.micOn === 'boolean' || typeof payload.camOn === 'boolean') {
            upsertRemote(payload.from, {
              ...(typeof payload.micOn === 'boolean' ? { micOn: payload.micOn } : {}),
              ...(typeof payload.camOn === 'boolean' ? { camOn: payload.camOn } : {}),
            });
          }
          break;
        case 'record':
          // Only honor commands from a presence-verified producer, addressed
          // to us or to the whole room. Presence meta is the role source;
          // the channel secret is the trust boundary.
          if (!fromProducer(payload.from)) break;
          if (pStateRef.current !== 'admitted') break; // lobby never records
          if (!recEnabledRef.current) break; // recording disabled for this meeting
          if (payload.target !== 'all' && payload.target !== clientId) break;
          if (payload.action === 'start') startRecording();
          else if (payload.action === 'stop') stopRecording();
          break;
        case 'record-state':
          upsertRemote(payload.from, {
            rec: {
              recording: !!payload.recording,
              status: payload.recStatus,
              health: payload.health || 'safe',
              pending: payload.pending || 0,
            },
          });
          break;
        case 'admit':
          // Targeted at us by a producer: leave the lobby.
          if (!fromProducer(payload.from)) break;
          admitSelfRef.current?.();
          break;
        case 'mute':
          // Producer muted us: gate our OUTGOING audio. The recording stays
          // raw — it runs on cloned tracks (see startRecording).
          if (!fromProducer(payload.from)) break;
          if (pStateRef.current !== 'admitted') break;
          applyMic(false);
          setToast('The producer muted you');
          break;
        case 'request-unmute':
          // Never force-unmutes — just an ask, answered by a button.
          if (!fromProducer(payload.from)) break;
          if (pStateRef.current !== 'admitted') break;
          if (!selfStateRef.current.micOn) setUnmuteAsk(true);
          break;
        case 'remove':
          // Room-wide broadcast: the target tears down, everyone else prunes.
          if (!fromProducer(payload.from)) break;
          if (!payload.target) break;
          if (payload.target === clientId) {
            if (pStateRef.current === 'removed') break;
            pStateRef.current = 'removed';
            setPState('removed'); // teardown runs in the pState effect below
          } else {
            mesh.removePeer(payload.target);
            dropRemote(payload.target);
          }
          break;
        default:
          break;
      }
    };

    (async () => {
      try {
        const stream = await mesh.startLocalMedia(initialStream);
        if (cancelled) {
          mesh.close();
          return;
        }
        setLocalStream(stream);

        const signal = joinSignalingChannel({
          channelName,
          clientId,
          meta: {
            name: displayName,
            role,
            state: pStateRef.current,
            participant_id: participantId,
          },
          onSignal: handleSignal,
          onPresence: (others) => {
            const metaMap = {};
            const present = new Set(others.map((o) => o.clientId));
            for (const o of others) {
              metaMap[o.clientId] = { role: o.role, state: o.state };
              upsertRemote(o.clientId, {
                name: o.name,
                role: o.role,
                state: o.state,
                participantId: o.participantId,
              });
              // Mesh forms only between admitted peers; lobby is presence-only.
              if (pStateRef.current === 'admitted' && o.state !== 'lobby') {
                mesh.connectTo(o.clientId);
              }
            }
            presenceMetaRef.current = metaMap;
            // Presence leave: peer teardown for anyone no longer tracked.
            for (const id of [...mesh.peers.keys()]) {
              if (!present.has(id)) {
                mesh.removePeer(id);
                dropRemote(id);
              }
            }
            setRemotes((prev) => {
              const next = {};
              for (const [id, r] of Object.entries(prev)) if (present.has(id)) next[id] = r;
              return Object.keys(next).length === Object.keys(prev).length ? prev : next;
            });
          },
          onStatus: (status) => {
            setChannelStatus(status === 'SUBSCRIBED' ? 'connected' : status.toLowerCase());
            // Lobby clients don't hello — they announce via presence only.
            if (status === 'SUBSCRIBED' && pStateRef.current === 'admitted') {
              signalRef.current?.send('hello', { name: displayName, role });
            }
          },
        });
        signalRef.current = signal;
      } catch (err) {
        console.error('Harbor call setup failed:', err);
        if (!cancelled) setMediaError(err?.message || 'Could not access camera and microphone.');
      }
    })();

    // beforeunload only WARNS (it's cancellable); destructive teardown lives
    // on pagehide, which fires only when the page is really going away. With
    // recording in play, teardown-on-beforeunload would kill the call even
    // when the user cancels the "uploads still saving" dialog.
    const handleBeforeUnload = (e) => {
      if (recorderRef.current?.hasPendingUploads()) {
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to show the dialog
      }
    };
    const handlePageHide = () => {
      try {
        signalRef.current?.send('leave');
      } catch {
        /* page is going away */
      }
      onPageUnload?.();
      mesh.close();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      recorderRef.current?.stop(); // flush + finalize continue past unmount
      try {
        signalRef.current?.send('leave');
      } catch {
        /* channel may be gone */
      }
      signalRef.current?.leave();
      signalRef.current = null;
      mesh.close(); // stops local tracks — camera light off
      meshRef.current = null;
      admitSelfRef.current = null; // stale closure holds a closed mesh
    };
    // eslint-disable-next-line
  }, []); // channel + identity are fixed for the life of a call

  // Session ended (by us or via 'state' broadcast): stop all media.
  const ended = sessionStatus === 'ended';
  useEffect(() => {
    if (ended) {
      // Stop the recorder BEFORE killing tracks: MediaRecorder.stop() flushes
      // its final chunk, and the upload flush doesn't need the stream.
      recorderRef.current?.stop();
      meshRef.current?.close();
      setRemotes({});
      setLocalStream(null);
    }
  }, [ended]);

  // Removed by the producer: full teardown — recording up to this moment
  // still lands (stop() flushes + finalizes async; the guest upload path
  // keeps a grace window in harbor-track), tracks stop, channel is left.
  const removed = pState === 'removed';
  useEffect(() => {
    if (!removed) return;
    recorderRef.current?.stop();
    try {
      signalRef.current?.send('leave');
    } catch {
      /* channel may be gone */
    }
    signalRef.current?.leave();
    signalRef.current = null;
    meshRef.current?.close();
    setRemotes({});
    setLocalStream(null);
  }, [removed]);

  // Auto-dismiss transient toasts.
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Lost-admit recovery poll — runs only while in the lobby; the effect
  // cleanup clears the interval on admit (pState change), removal, and
  // unmount. Double-fire with the 'admit' signal is impossible: both paths
  // funnel through admitSelfRef, which guards synchronously on pStateRef.
  useEffect(() => {
    if (pState !== 'lobby' || !onCheckAdmission) return undefined;
    let inFlight = false;
    const interval = setInterval(async () => {
      if (inFlight) return; // don't stack slow polls
      inFlight = true;
      try {
        const state = await onCheckAdmission();
        if (state === 'admitted') admitSelfRef.current?.();
        // null / 'lobby' / errors: no info — keep waiting; the signal path
        // stays live regardless (e.g. after a guest-link rotation the poll
        // 404s but the targeted admit still works).
      } catch {
        /* parent callback should return null on errors, but never let a
           throw become an unhandled rejection */
      } finally {
        inFlight = false;
      }
    }, ADMIT_POLL_MS);
    return () => clearInterval(interval);
  }, [pState, onCheckAdmission]);

  const toggleMic = () => applyMic(!micOn);

  const toggleCam = () => {
    const next = !camOn;
    meshRef.current?.setVideoEnabled(next);
    setCamOn(next);
    selfStateRef.current = { ...selfStateRef.current, camOn: next };
    signalRef.current?.send('state', { camOn: next });
  };

  const changeSessionStatus = async (next) => {
    if (!onUpdateSessionStatus) return;
    setSavingStatus(true);
    try {
      await onUpdateSessionStatus(next);
      setSessionStatus(next);
      signalRef.current?.send('state', { status: next });
    } catch (err) {
      console.error('Harbor: session status update failed:', err);
    } finally {
      setSavingStatus(false);
    }
  };

  const remoteEntries = Object.entries(remotes).filter(([, r]) => r.state !== 'lobby');
  const lobbyEntries = Object.entries(remotes).filter(([, r]) => r.state === 'lobby');

  // ── Producer controls ────────────────────────────────────────
  const isProducer = role === 'producer';
  // Recording mode always allows recording; a meeting only when the host has
  // opted in. Guards every record control + the incoming 'record' command.
  const recordingAllowed = !isMeeting || recEnabled;
  const canRecord = !!createRecorderTransport && recordingAllowed;
  const selfRecording =
    recState?.status === 'starting' ||
    recState?.status === 'recording' ||
    recState?.status === 'flushing';
  const anyoneRecording = selfRecording || remoteEntries.some(([, r]) => r.rec?.recording);

  const recordAll = () => {
    signalRef.current?.send('record', { action: 'start', target: 'all' });
    startRecording();
  };
  const stopRecordAll = () => {
    signalRef.current?.send('record', { action: 'stop', target: 'all' });
    stopRecording();
  };
  const toggleRemoteRecord = (id, isRec) => {
    signalRef.current?.send('record', { action: isRec ? 'stop' : 'start', target: id }, id);
  };

  // Meeting host flips recording on/off for the whole room. The DB write runs
  // in the parent; on success we broadcast the new flag so every client's UI
  // (and its 'record' guard) updates live. Disabling mid-record stops everyone.
  const toggleRecordEnabled = async () => {
    if (!onToggleRecordEnabled || togglingRec) return;
    const next = !recEnabled;
    setTogglingRec(true);
    try {
      await onToggleRecordEnabled(next);
    } catch (err) {
      console.error('Harbor: record-enable toggle failed:', err);
      return;
    } finally {
      setTogglingRec(false);
    }
    if (!next && anyoneRecording) stopRecordAll();
    recEnabledRef.current = next;
    setRecEnabled(next);
    signalRef.current?.send('state', { recordEnabled: next });
  };

  const muteRemote = (id) => signalRef.current?.send('mute', {}, id);
  const askRemoteUnmute = (id) => signalRef.current?.send('request-unmute', {}, id);

  const admitGuest = async (id, peer) => {
    if (!onAdmitParticipant || !peer.participantId || busyAdmit[id]) return;
    setBusyAdmit((prev) => ({ ...prev, [id]: true }));
    try {
      await onAdmitParticipant(peer.participantId); // RLS write first…
      signalRef.current?.send('admit', {}, id); // …then the targeted signal
      upsertRemote(id, { state: 'admitted' }); // optimistic; presence confirms
    } catch (err) {
      console.error('Harbor: admit failed:', err);
    } finally {
      setBusyAdmit((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const removeGuest = async (id, peer) => {
    if (!onRemoveParticipant || !peer.participantId) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Remove ${peer.name} from the session? Their recording up to now is kept.`,
    );
    if (!ok) return;
    try {
      await onRemoveParticipant(peer.participantId); // row → removed, left_at stamped
      // Room-wide: the target tears down; everyone else prunes the peer.
      signalRef.current?.send('remove', { target: id });
      meshRef.current?.removePeer(id);
      dropRemote(id);
    } catch (err) {
      console.error('Harbor: remove failed:', err);
    }
  };

  if (mediaError) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.notice}>
          <h2 style={sectionHeader(2)}>Camera & microphone needed</h2>
          <p style={styles.noticeText}>{mediaError}</p>
          <p style={styles.noticeText}>
            Check browser permissions for this site, then reload the page.
          </p>
          <button type="button" style={button({ variant: 'ghost' })} onClick={() => onLeave?.('left')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (removed) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.notice}>
          <span style={pill('danger')}>Removed</span>
          <p style={styles.noticeText}>You were removed from this session.</p>
          {recState && recState.status !== 'idle' && recState.status !== 'complete' && (
            <p style={styles.noticeText}>
              Your recording is still finishing its upload — give this tab a moment before closing.
            </p>
          )}
          <button type="button" style={button()} onClick={() => onLeave?.('removed')}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (ended) {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.notice}>
          <span style={pill('danger')}>Session ended</span>
          <p style={styles.noticeText}>
            {session?.title ? `"${session.title}" has ended.` : 'This session has ended.'}
          </p>
          <button type="button" style={button()} onClick={() => onLeave?.('ended')}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Green room (lobby guest) — camera warm, no mesh, no media ─
  if (pState === 'lobby') {
    return (
      <div style={styles.centerWrap}>
        <div style={styles.lobbyWaitPanel}>
          <span style={pill('info')}>Green room</span>
          <div style={styles.lobbyPreviewBox}>
            <LocalTile
              stream={localStream}
              name={displayName}
              micOn={micOn}
              camOn={camOn}
              recState={null}
              onToggleRecord={null}
            />
          </div>
          <p style={styles.noticeText}>
            Waiting for the producer to let you in. Keep this tab open — your camera and mic stay
            ready.
          </p>
          {channelStatus !== 'connected' && (
            <span style={pill('warning')}>signaling: {channelStatus}</span>
          )}
          <button type="button" style={button({ variant: 'ghost' })} onClick={() => onLeave?.('left')}>
            Leave
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.stage}>
      {toast && <div style={styles.toast}>{toast}</div>}

      {/* Header: title, session status, channel status, producer controls */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.title}>{session?.title || 'Harbor session'}</span>
          {isMeeting && <span style={pill('default')}>Meeting</span>}
          <span style={pill(STATUS_TONES[sessionStatus] || 'info')}>
            {STATUS_LABELS[sessionStatus] || sessionStatus}
          </span>
          {isProducer && lobbyEntries.length > 0 && (
            <span style={pill('warning')}>
              {lobbyEntries.length} waiting in green room
            </span>
          )}
          {channelStatus !== 'connected' && (
            <span style={pill('warning')}>signaling: {channelStatus}</span>
          )}
        </div>
        {(canControlSession || (isProducer && canRecord)) && (
          <div style={styles.headerRight}>
            {isMeeting && canControlSession && (
              <button
                type="button"
                style={button({ variant: recEnabled ? 'ghost' : 'secondary', size: 'sm', disabled: togglingRec })}
                disabled={togglingRec}
                onClick={toggleRecordEnabled}
                title={recEnabled ? 'Turn recording off for this meeting' : 'Turn recording on for this meeting'}
              >
                {togglingRec ? 'Saving…' : recEnabled ? 'Disable recording' : 'Enable recording'}
              </button>
            )}
            {isProducer && canRecord && (
              anyoneRecording ? (
                <button
                  type="button"
                  style={button({ variant: 'danger', size: 'sm' })}
                  onClick={stopRecordAll}
                >
                  Stop all recording
                </button>
              ) : (
                <button
                  type="button"
                  style={button({ variant: 'secondary', size: 'sm' })}
                  onClick={recordAll}
                >
                  Record all
                </button>
              )
            )}
            {canControlSession && sessionStatus === 'scheduled' && (
              <button
                type="button"
                style={button({ size: 'sm', disabled: savingStatus })}
                disabled={savingStatus}
                onClick={() => changeSessionStatus('live')}
              >
                Start session
              </button>
            )}
            {canControlSession && sessionStatus === 'live' && (
              <button
                type="button"
                style={button({ variant: 'danger', size: 'sm', disabled: savingStatus })}
                disabled={savingStatus}
                onClick={() => changeSessionStatus('ended')}
              >
                End session
              </button>
            )}
          </div>
        )}
      </div>

      {/* Producer lobby panel — presence-driven list of waiting guests */}
      {isProducer && lobbyEntries.length > 0 && (
        <div style={styles.lobbyPanel}>
          <div style={styles.lobbyPanelHeader}>
            <span style={styles.lobbyPanelTitle}>Green room</span>
            <span style={styles.lobbyPanelHint}>
              Waiting guests can't see or hear the call until admitted.
            </span>
          </div>
          {lobbyEntries.map(([id, peer]) => (
            <div key={id} style={styles.lobbyRow}>
              <span style={styles.lobbyName}>{peer.name}</span>
              <button
                type="button"
                style={button({ size: 'sm', disabled: !!busyAdmit[id] || !peer.participantId })}
                disabled={!!busyAdmit[id] || !peer.participantId}
                onClick={() => admitGuest(id, peer)}
              >
                {busyAdmit[id] ? 'Admitting…' : 'Admit'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tile grid: local preview + admitted remote peers, responsive wrap */}
      <div style={styles.grid}>
        <LocalTile
          stream={localStream}
          name={displayName}
          micOn={micOn}
          camOn={camOn}
          recState={recState}
          onToggleRecord={
            isProducer && canRecord ? (selfRecording ? stopRecording : startRecording) : null
          }
        />
        {remoteEntries.map(([id, peer]) => (
          <RemoteTile
            key={id}
            peer={peer}
            showRecHealth={isProducer}
            onToggleRecord={
              isProducer && canRecord
                ? () => toggleRemoteRecord(id, !!peer.rec?.recording)
                : null
            }
            onMute={isProducer && peer.micOn !== false ? () => muteRemote(id) : null}
            onAskUnmute={isProducer && peer.micOn === false ? () => askRemoteUnmute(id) : null}
            onRemove={
              isProducer && onRemoveParticipant && peer.role === 'guest' && peer.participantId
                ? () => removeGuest(id, peer)
                : null
            }
          />
        ))}
        {remoteEntries.length === 0 && (
          <div style={styles.emptyTile}>
            <span style={styles.emptyTileText}>Waiting for others to join…</span>
          </div>
        )}
      </div>

      {/* Producer asked us to unmute — never forced, always a button */}
      {unmuteAsk && (
        <div style={styles.askBanner}>
          <span style={styles.askText}>The producer asks you to unmute</span>
          <button type="button" style={button({ size: 'sm' })} onClick={() => applyMic(true)}>
            Unmute
          </button>
          <button
            type="button"
            style={button({ variant: 'ghost', size: 'sm' })}
            onClick={() => setUnmuteAsk(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Controls */}
      <div style={styles.controls}>
        <button
          type="button"
          style={micOn ? styles.ctrlBtnOn : styles.ctrlBtnOff}
          onClick={toggleMic}
          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {micOn ? 'Mic on' : 'Mic off'}
        </button>
        {selfRecording && (
          <span style={styles.recMuteHint}>Recording stays live while muted</span>
        )}
        <button
          type="button"
          style={camOn ? styles.ctrlBtnOn : styles.ctrlBtnOff}
          onClick={toggleCam}
          title={camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {camOn ? 'Cam on' : 'Cam off'}
        </button>
        <button type="button" style={button({ variant: 'danger' })} onClick={() => onLeave?.('left')}>
          Leave
        </button>
      </div>
    </div>
  );
}

function LocalTile({ stream, name, micOn, camOn, recState, onToggleRecord }) {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const recording =
    recState?.status === 'starting' ||
    recState?.status === 'recording' ||
    recState?.status === 'flushing';
  const healthLabel = recHealthLabel(recState);

  return (
    <div style={styles.tile}>
      {/* Local preview is always muted (no echo) and mirrored. */}
      <video ref={videoRef} autoPlay playsInline muted style={styles.videoMirrored} />
      {!camOn && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
      )}
      {/* Own recording state — every participant sees this clearly. */}
      {recState && recState.status !== 'idle' && (
        <div style={styles.recBadge}>
          {recording && <span style={styles.recDot} />}
          {recording && <span style={styles.recText}>REC</span>}
          {healthLabel && (
            <span style={recState.status === 'failed' ? styles.recHealthBad : styles.recHealthText}>
              {healthLabel}
            </span>
          )}
        </div>
      )}
      {onToggleRecord && (
        <div style={styles.tileBtnRow}>
          <button type="button" style={styles.tileBtn} onClick={onToggleRecord}>
            {recording ? 'Stop rec' : 'Record'}
          </button>
        </div>
      )}
      <div style={styles.nameTag}>
        <span style={styles.nameText}>{name} (you)</span>
        {!micOn && <span style={styles.mutedTag}>muted</span>}
      </div>
    </div>
  );
}

function RemoteTile({ peer, showRecHealth, onToggleRecord, onMute, onAskUnmute, onRemove }) {
  const videoRef = useRef(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !peer.stream) return;
    el.srcObject = peer.stream;
    // Safari/iOS autoplay policy: try with sound (we're post-user-gesture in
    // most flows); on rejection fall back to muted playback + tap-to-unmute.
    el.muted = false;
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        el.muted = true;
        el.play().catch(() => {});
        setNeedsUnmute(true);
      });
    }
  }, [peer.stream]);

  const unmute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.play().catch(() => {});
    setNeedsUnmute(false);
  };

  const connState = peer.connState || 'connecting';
  const recLabel = remoteRecLabel(peer.rec);
  const hasControls = onToggleRecord || onMute || onAskUnmute || onRemove;
  return (
    <div style={styles.tile}>
      <video ref={videoRef} autoPlay playsInline style={styles.video} />
      {peer.camOn === false && (
        <div style={styles.camOffOverlay}>
          <span style={styles.camOffText}>Camera off</span>
        </div>
      )}
      {/* REC is visible to everyone; upload health is producer-only. */}
      {peer.rec && (peer.rec.recording || (showRecHealth && recLabel)) && (
        <div style={styles.recBadge}>
          {peer.rec.recording && <span style={styles.recDot} />}
          {peer.rec.recording && <span style={styles.recText}>REC</span>}
          {showRecHealth && recLabel && (
            <span
              style={
                peer.rec.status === 'failed' || peer.rec.health === 'failed'
                  ? styles.recHealthBad
                  : styles.recHealthText
              }
            >
              {recLabel}
            </span>
          )}
        </div>
      )}
      {hasControls && (
        <div style={styles.tileBtnRow}>
          {onToggleRecord && (
            <button type="button" style={styles.tileBtn} onClick={onToggleRecord}>
              {peer.rec?.recording ? 'Stop rec' : 'Record'}
            </button>
          )}
          {onMute && (
            <button type="button" style={styles.tileBtn} onClick={onMute}>
              Mute
            </button>
          )}
          {onAskUnmute && (
            <button type="button" style={styles.tileBtn} onClick={onAskUnmute}>
              Ask to unmute
            </button>
          )}
          {onRemove && (
            <button type="button" style={styles.tileBtnDanger} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      )}
      {connState !== 'connected' && (
        <span style={{ ...pill(CONN_TONES[connState] || 'warning'), ...styles.connBadge }}>
          {connState}
        </span>
      )}
      {needsUnmute && (
        <button type="button" style={styles.unmuteBtn} onClick={unmute}>
          Tap for audio
        </button>
      )}
      <div style={styles.nameTag}>
        <span style={styles.nameText}>{peer.name}</span>
        {peer.micOn === false && <span style={styles.mutedTag}>muted</span>}
      </div>
    </div>
  );
}

const styles = {
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.lg,
    width: '100%',
    flex: 1,
    minHeight: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
    gap: spacing.md,
    width: '100%',
    alignContent: 'start',
    flex: 1,
  },
  tile: {
    position: 'relative',
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    overflow: 'hidden',
    aspectRatio: '16 / 9',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: colors.bg,
  },
  videoMirrored: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
    background: colors.bg,
    transform: 'scaleX(-1)',
  },
  emptyTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.bgInput,
    border: `1px dashed ${colors.borderStrong}`,
    borderRadius: radii.lg,
    aspectRatio: '16 / 9',
  },
  emptyTileText: {
    fontSize: fontSizes.md,
    color: colors.textSubtle,
  },
  nameTag: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgOverlay,
    borderRadius: radii.sm,
    maxWidth: '85%',
  },
  nameText: {
    fontSize: fontSizes.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  mutedTag: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    color: colors.danger.fgSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  connBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  recBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgOverlay,
    borderRadius: radii.sm,
    maxWidth: '85%',
  },
  recDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radii.circle,
    background: colors.danger.fg,
    flexShrink: 0,
  },
  recText: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.bold,
    color: colors.danger.fgSoft,
    letterSpacing: 0.5,
  },
  recHealthText: {
    fontSize: fontSizes.xxs,
    color: colors.textMuted,
    whiteSpace: 'nowrap',
  },
  recHealthBad: {
    fontSize: fontSizes.xxs,
    fontWeight: fontWeights.semibold,
    color: colors.danger.fgSoft,
    whiteSpace: 'nowrap',
  },
  // Per-tile action cluster (bottom-right): record / mute / remove.
  tileBtnRow: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    display: 'flex',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    zIndex: zIndex.base,
  },
  tileBtn: {
    ...button({ variant: 'secondary', size: 'sm' }),
  },
  tileBtnDanger: {
    ...button({ variant: 'danger', size: 'sm' }),
  },
  unmuteBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    ...button({ size: 'sm' }),
    zIndex: zIndex.base,
  },
  camOffOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: colors.bgHover,
  },
  camOffText: {
    fontSize: fontSizes.md,
    color: colors.textSubtle,
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    flexWrap: 'wrap',
  },
  ctrlBtnOn: {
    ...button({ variant: 'secondary' }),
    transition: transitions.fast,
  },
  ctrlBtnOff: {
    ...button({ variant: 'secondary' }),
    background: colors.danger.bg,
    border: `1px solid ${colors.danger.border}`,
    color: colors.danger.fgSoft,
    transition: transitions.fast,
  },
  recMuteHint: {
    fontSize: fontSizes.xs,
    color: colors.textSubtle,
    whiteSpace: 'nowrap',
  },
  toast: {
    position: 'fixed',
    top: spacing.xl,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: zIndex.toast,
    padding: `${spacing.sm}px ${spacing.lg}px`,
    background: colors.bgModal,
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: radii.lg,
    color: colors.text,
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    boxShadow: shadows.md,
  },
  askBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.lg,
    flexWrap: 'wrap',
  },
  askText: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.warning.fgSoft,
  },
  lobbyPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
    padding: spacing.lg,
    background: colors.warning.bg,
    border: `1px solid ${colors.warning.border}`,
    borderRadius: radii.lg,
  },
  lobbyPanelHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  lobbyPanelTitle: {
    fontSize: fontSizes.lg,
    fontWeight: fontWeights.bold,
    color: colors.warning.fgSoft,
  },
  lobbyPanelHint: {
    fontSize: fontSizes.sm,
    color: colors.textMuted,
  },
  lobbyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  lobbyName: {
    fontSize: fontSizes.md,
    fontWeight: fontWeights.semibold,
    color: colors.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  lobbyWaitPanel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    width: '100%',
    maxWidth: 560,
    textAlign: 'center',
  },
  lobbyPreviewBox: {
    width: '100%',
  },
  centerWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    width: '100%',
    fontFamily,
  },
  notice: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xxxl,
    background: colors.bgRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.xl,
    maxWidth: 420,
    textAlign: 'center',
  },
  noticeText: {
    fontSize: fontSizes.md,
    color: colors.textMuted,
    lineHeight: 1.6,
    margin: 0,
  },
};
