// Emoji reactions shared by Channels + Messages (desktop & mobile).
// Reactions live as jsonb on the message row ({ "👍": [userId, ...] }) and
// toggle through the toggle_message_reaction RPC (security definer — RLS
// blocks updating someone else's message directly).
import React from 'react';
import { supabase } from '../supabaseClient';

export const QUICK_REACTIONS = ['\u{1F44D}', '❤️', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

// kind: 'channel' | 'dm'. Resolves to the message's new reactions jsonb.
export async function toggleReaction(kind, messageId, emoji) {
  const { data, error } = await supabase.rpc('toggle_message_reaction', {
    p_kind: kind,
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) throw error;
  return data || {};
}

// Chips under a message: one per emoji with a count, highlighted when the
// current user is among the reactors. Click toggles.
export function ReactionChips({ reactions, userId, onToggle, align = 'left' }) {
  const entries = Object.entries(reactions || {}).filter(
    ([, users]) => Array.isArray(users) && users.length > 0
  );
  if (entries.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px', justifyContent: align === 'right' ? 'flex-end' : 'flex-start' }}>
      {entries.map(([emoji, users]) => {
        const mine = users.includes(userId);
        return (
          <button
            key={emoji}
            onClick={(e) => { e.stopPropagation(); onToggle(emoji); }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 8px',
              borderRadius: '10px',
              border: mine ? '1px solid rgba(99,102,241,0.6)' : '1px solid rgba(255,255,255,0.12)',
              background: mine ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
              color: '#e2e8f0',
              fontSize: '12px',
              lineHeight: '18px',
              cursor: 'pointer',
            }}
          >
            <span>{emoji}</span>
            {users.length > 1 && <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>{users.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Horizontal quick-pick bar for context menus / bottom sheets (iMessage tapback style).
export function ReactionBar({ onPick }) {
  return (
    <div style={{ display: 'flex', gap: '2px', padding: '4px 6px' }}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={(e) => { e.stopPropagation(); onPick(emoji); }}
          style={{
            border: 'none',
            background: 'transparent',
            fontSize: '20px',
            padding: '4px 6px',
            borderRadius: '8px',
            cursor: 'pointer',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
