// Kanban-era step action lookup.
// Sign-off tasks use a distinct action type so MyTasks renders the correct button.
// The function + loader remain for MyTasks call-site compatibility.

const DEFAULT_ACTION = { type: 'complete', label: 'Mark Complete' };
const SIGN_OFF_ACTION = { type: 'sign_off', label: 'Sign Off' };

export function getStepAction(_stepKey, task) {
  if (task && task.requires_sign_off) return SIGN_OFF_ACTION;
  return DEFAULT_ACTION;
}

export async function loadDataDrivenStepActions(_stepKeys) {
  return;
}
