// Kanban-era step action lookup.
// Sign-off tasks use a distinct action type so MyTasks renders the correct button.
// The function + loader remain for MyTasks call-site compatibility.

const DEFAULT_ACTION = { type: 'complete', label: 'Mark Complete' };
const SIGN_OFF_ACTION = { type: 'sign_off', label: 'Sign Off' };
const WRITE_AD_READ_ACTION = {
  type: 'write_ad_read',
  modalKey: 'write_ad_read',
  label: 'Write It',
};

export function getStepAction(stepKey, task) {
  if (task && task.requires_sign_off) return SIGN_OFF_ACTION;
  const key = stepKey || task?.step_key;
  if (key === 'write_ad_reads') return WRITE_AD_READ_ACTION;
  return DEFAULT_ACTION;
}

export async function loadDataDrivenStepActions(_stepKeys) {
  return;
}
