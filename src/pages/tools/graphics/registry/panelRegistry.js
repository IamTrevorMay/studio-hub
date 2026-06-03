// Per-widget right-panel components. Populated in step 2H when the
// HeatMapsPanel + HeatMapOverlaysPanel are rewritten to Mayday styling.
// Widget IDs that don't appear here fall back to the schema-driven
// FilterBar.

export const PANEL_REGISTRY = {};

export function getPanelFor(widgetId) {
  return PANEL_REGISTRY[widgetId] || null;
}
