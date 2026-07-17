// Modal registry for workflow tasks whose action_type === 'modal'.
// Each entry: { component, description }. MyTasks looks up by modalKey.

import PickVideoEventModal from '../pages/workflows/modals/PickVideoEventModal';
import AddBriefModal from '../pages/workflows/modals/AddBriefModal';
import WriteAdReadModal from '../pages/workflows/modals/WriteAdReadModal';

const MODAL_REGISTRY = {
  pick_video_event: {
    component: PickVideoEventModal,
    description: 'Picks a calendar video event to connect the deliverable to.',
  },
  add_brief: {
    component: AddBriefModal,
    description: 'Adds a brief URL to the campaign.',
  },
  write_ad_read: {
    component: WriteAdReadModal,
    description: 'Write ad read copy for a deliverable.',
    // "Save & Complete" inside the modal calls onSubmit → completes the task.
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
