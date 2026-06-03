// Per-widget right-panel components. Custom panels override the schema-
// driven FilterBar — used for widgets whose filter UI doesn't fit the
// section/control model (tabs, multi-config, etc.).
//
// 2H wires the two heatmap panels. Other widgets continue to render via
// the schema-driven FilterBar.

import HeatMapsPanel from '../panels/HeatMapsPanel';
import HeatMapOverlaysPanel from '../panels/HeatMapOverlaysPanel';

export const PANEL_REGISTRY = {
  'heat-maps': HeatMapsPanel,
  'heat-map-overlays': HeatMapOverlaysPanel,
};

export function getPanelFor(widgetId) {
  return PANEL_REGISTRY[widgetId] || null;
}
