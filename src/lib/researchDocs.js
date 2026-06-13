// Shared config + Drive API helpers for Research documents.
// Used by the Research page (ResearchDocs.js) and the Background Research
// assignment template (MemberAssignmentModal.js) so the field set and the
// create/list calls stay in one place.

import { supabase } from '../supabaseClient';

export const RESEARCH_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/google-drive-research`;

// Fields collected when creating a research doc. `key` matches the {{token}}
// in the template doc. Big Question doubles as the document's name in Drive.
export const RESEARCH_FIELDS = [
  {
    key: 'big_question',
    label: 'Big Question / Working Title',
    help: 'The central question we are seeking to answer. Often this is the title, or directly maps to it. Everything in the research serves this.',
    multiline: false,
    required: true,
  },
  {
    key: 'scope',
    label: 'Scope',
    help: "The boundaries of the research: time period, specific players/teams, stat categories, era, etc. What's in bounds and what's out of bounds.",
    multiline: true,
  },
  {
    key: 'key_sources',
    label: 'Key Sources / Where to Look',
    help: "Direction on where to dig (Statcast, MLB Stats API, specific outlets, historical records, etc.) so researchers don't waste time hunting.",
    multiline: true,
  },
  {
    key: 'expected_output',
    label: 'Expected Output / Format',
    help: 'What "done" looks like: annotated notes, a structured doc with sections, key takeaways, supporting data/links. Be explicit so the handoff to the video team is smooth.',
    multiline: true,
  },
];

// Template tokens not collected in the form (filled in by the researcher
// directly in the doc). Still cleared on create so no raw {{token}} remains.
export const RESEARCH_CLEARED_TOKENS = ['anomalies', 'sources'];

export const emptyResearchForm = () =>
  RESEARCH_FIELDS.reduce((acc, f) => { acc[f.key] = ''; return acc; }, {});

async function callResearchFn(method, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(RESEARCH_FN_URL, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export function listResearchDocs() {
  return callResearchFn('GET');
}

// Build the token→value map for the merge: trimmed form values plus the
// cleared tokens blanked out.
export function buildResearchFields(form) {
  const fields = RESEARCH_FIELDS.reduce((acc, f) => {
    acc[f.key] = (form[f.key] || '').trim();
    return acc;
  }, {});
  RESEARCH_CLEARED_TOKENS.forEach((k) => { fields[k] = ''; });
  return fields;
}

// Copies the template, merges the form values, returns { id, name, url }.
export function createResearchDoc({ name, form }) {
  return callResearchFn('POST', {
    action: 'create-from-template',
    name,
    fields: buildResearchFields(form),
  });
}
