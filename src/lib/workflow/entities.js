// Entity schema registry for workflow builder autocomplete.
// Maps entity types to their known fields and context keys.

export const ENTITY_SCHEMAS = {
  proposal: {
    fields: ['id', 'sponsor_name', 'timeframe', 'description', 'status'],
    contextKeys: ['proposal_id', 'brand_name'],
  },
  campaign: {
    fields: ['id', 'name', 'brief_url', 'brief_name', 'sponsor_id'],
    contextKeys: ['campaign_id', 'campaign_name'],
  },
  deliverable: {
    fields: ['id', 'title', 'deliverable_type', 'channel', 'due_date', 'pay'],
    contextKeys: ['deliverable_id', 'title'],
  },
  sponsor: {
    fields: ['id', 'name'],
    contextKeys: ['sponsor_id'],
  },
  calendar_event: {
    fields: ['id', 'title', 'event_type', 'start_date', 'end_date'],
    contextKeys: ['video_event_id'],
  },
};

export function getContextKeySuggestions(entityType) {
  return ENTITY_SCHEMAS[entityType]?.contextKeys || [];
}

export function getFieldSuggestions(entityType) {
  return ENTITY_SCHEMAS[entityType]?.fields || [];
}

export function getAllContextKeys() {
  const keys = new Set();
  Object.values(ENTITY_SCHEMAS).forEach(schema => {
    schema.contextKeys.forEach(k => keys.add(k));
  });
  return Array.from(keys);
}
