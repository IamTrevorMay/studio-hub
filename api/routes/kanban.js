const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  return createClient(url, key);
}

// POST /api/kanban/sync
// Body: { clips: [{ id, title, timeSensitive, postByDate, showDate, driveLink, type }] }
// Inserts clips into shorts_queue with stage: 'editing'
router.post('/sync', async (req, res) => {
  const { clips } = req.body;

  if (!Array.isArray(clips) || clips.length === 0) {
    return res.status(400).json({ error: 'clips array is required' });
  }

  const createdBy = process.env.KANBAN_CREATED_BY_USER_ID;
  const alanaUserId = process.env.ALANA_USER_ID;

  if (!createdBy) return res.status(500).json({ error: 'KANBAN_CREATED_BY_USER_ID not set in .env' });

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const results = [];

  for (const clip of clips) {
    const { id, title, timeSensitive, postByDate, showDate, driveLink } = clip;

    const notes = driveLink ? `Drive: ${driveLink}` : null;

    const insertData = {
      title,
      stage: 'editing',
      urgency: timeSensitive ? 'time_sensitive' : 'evergreen',
      post_by: timeSensitive && postByDate ? postByDate : null,
      source_show: showDate || null,
      notes,
      created_by: createdBy,
      assigned_to: alanaUserId || null,
    };

    try {
      const { data, error } = await supabase
        .from('shorts_queue')
        .insert(insertData)
        .select('id')
        .single();

      if (error) throw error;

      results.push({ id, success: true, shortId: data.id });
    } catch (err) {
      console.error(`[Kanban] Sync failed for "${title}":`, err.message);
      results.push({ id, success: false, error: err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
