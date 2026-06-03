// Single source of truth for block definitions. JSON imported here so
// the same data can be required from server-side (api/_lib/emails/...)
// via a relative path.

import registry from './blockRegistry.json';

export function getBlockDef(type) {
  return registry[type] || null;
}

export function getBlocksByCategory(category) {
  return Object.values(registry).filter((b) => b.category === category);
}

export function getAllBlocks() {
  return Object.values(registry);
}

export const CATEGORIES = ['content', 'layout', 'interactive', 'data'];

export default registry;
