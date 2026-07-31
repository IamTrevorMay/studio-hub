// Harbor room transport — the single seam between the call UI (CallStage) and
// the media topology.
//
// Today every room is a full P2P mesh (HarborMesh), which holds ~6 participants
// before uplink/CPU degrade. When an SFU (e.g. LiveKit) is provisioned for
// larger meetings, implement a HarborSfuRoom that satisfies the SAME interface
// and select it here — by opts.maxParticipants or a per-session flag. CallStage
// consumes only this factory's return value, so the swap needs no UI change.
//
// Transport interface (HarborMesh is the reference implementation):
//   startLocalMedia(existingStream?) -> Promise<MediaStream>
//   connectTo(remoteId)
//   handleSignal(fromId, msg)
//   removePeer(remoteId)
//   setAudioEnabled(on) / setVideoEnabled(on)
//   startScreenShare() -> Promise<MediaStream|null> / stopScreenShare() / get isScreenSharing
//   peers: Map<clientId, unknown>   (used for presence-leave reconciliation)
//   close()
// Constructor opts (callbacks): clientId, maxParticipants, sendSignal,
//   onRemoteStream, onPeerState, onPeerRemoved, onScreenShareChange.

import { HarborMesh } from './mesh';

// P2P ceiling — above this a meeting really wants an SFU. Kept here (not in
// mesh.js) because it's a topology-selection concern, not a mesh internal.
export const MESH_MAX_PARTICIPANTS = 6;

/**
 * Build the media transport for a room. Returns a HarborMesh today; the single
 * place to branch to an SFU room once one exists.
 * @param {object} opts - see the interface note above
 */
export function createHarborRoom(opts) {
  // Future SFU selection lands here, e.g.:
  //   if (sfuAvailable() && (opts.maxParticipants || 0) > MESH_MAX_PARTICIPANTS) {
  //     return new HarborSfuRoom(opts);
  //   }
  return new HarborMesh(opts);
}
