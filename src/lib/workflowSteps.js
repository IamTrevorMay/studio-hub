// Kanban-era step action lookup.
// All kanban-generated tasks render the same "Mark Complete" button.
// The function + loader remain for MyTasks call-site compatibility.

const DEFAULT_ACTION = { type: 'complete', label: 'Mark Complete' };

export function getStepAction(_stepKey) {
  return DEFAULT_ACTION;
}

export async function loadDataDrivenStepActions(_stepKeys) {
  return;
}
