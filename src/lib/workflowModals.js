// Modal registry for workflow tasks whose action_type === 'modal'.
// Each entry: { component, description }. MyTasks looks up by modalKey.

import PickVideoEventModal from '../pages/workflows/modals/PickVideoEventModal';

const MODAL_REGISTRY = {
  pick_video_event: {
    component: PickVideoEventModal,
    description: 'Picks a calendar video event to connect the deliverable to.',
  },
};

export function getWorkflowModal(modalKey) {
  return MODAL_REGISTRY[modalKey] || null;
}

export function listWorkflowModals() {
  return Object.entries(MODAL_REGISTRY).map(([key, entry]) => ({
    key,
    description: entry.description,
  }));
}
