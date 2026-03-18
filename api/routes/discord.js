const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

const DISCORD_API = 'https://discord.com/api/v10';

// POST /api/discord/notify
// Body: { channelId: string, userId: string, message: string }
router.post('/notify', async (req, res) => {
  const { channelId, userId, message } = req.body;

  if (!message) return res.status(400).json({ error: 'message is required' });
  if (!channelId && !userId) return res.status(400).json({ error: 'channelId or userId is required' });

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'DISCORD_BOT_TOKEN not set in .env' });

  const headers = {
    'Authorization': `Bot ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // Send to channel if provided
    if (channelId) {
      const channelRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: message }),
      });
      if (!channelRes.ok) {
        const err = await channelRes.json();
        throw new Error(`Channel send failed: ${err.message || JSON.stringify(err)}`);
      }
    }

    // DM the user if provided
    if (userId) {
      // Create DM channel first
      const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ recipient_id: userId }),
      });
      if (!dmRes.ok) {
        const err = await dmRes.json();
        console.warn(`[Discord] Could not open DM with user ${userId}: ${err.message}`);
      } else {
        const dmChannel = await dmRes.json();
        await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ content: message }),
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Discord] Notify failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
