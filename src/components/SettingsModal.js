import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import NotificationSettings from './NotificationSettings';
import { colors, spacing, fontSizes, fontWeights } from '../lib/styleTokens';
import { modalOverlay, modal as modalShell, button as buttonRecipe } from '../lib/styleRecipes';

// Settings used to live inside Dashboard.js, which meant only staff could reach
// it — contractors and clients never render that page. It's mounted from the
// sidebar now, so it has to stand on its own.

export function ToggleSwitch({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative',
        width: '40px',
        height: '22px',
        borderRadius: '11px',
        border: 'none',
        background: on ? colors.success.fg : 'rgba(255,255,255,0.15)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'background 0.2s',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute',
        top: '2px',
        left: on ? '20px' : '2px',
        width: '18px',
        height: '18px',
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

// The toggleable Dashboard sections, in the order they appear on the page.
export const DASHBOARD_SECTIONS = [
  { key: 'schedule', label: "Today's Schedule", caption: "Today's calendar events" },
  { key: 'sprint', label: 'Sprint Board', caption: 'Sprint planning and board' },
  { key: 'checkin', label: 'Check In', caption: 'Daily check-in card' },
  { key: 'todo', label: 'To Do', caption: 'Personal to-do list' },
];

/** A section is visible unless explicitly turned off. */
export function isSectionVisible(profile, key) {
  return profile?.dashboard_prefs?.[key] !== false;
}

export default function SettingsModal({ onClose }) {
  const { profile, updateProfile, isAdmin, isContractor, isClient } = useAuth();

  // Contractors and clients get their own portal dashboards, which have none of
  // these sections — no point offering toggles that control nothing.
  const showDashboardSections = !isContractor && !isClient;

  function toggleSection(key) {
    const current = profile?.dashboard_prefs || {};
    updateProfile({
      dashboard_prefs: { ...current, [key]: current[key] === false },
    });
  }

  return (
    <div
      style={modalOverlay()}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ ...modalShell({ width: 420 }), fontFamily: 'inherit', maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{
          margin: `0 0 ${spacing.xl}px`,
          fontSize: fontSizes.xl,
          fontWeight: fontWeights.bold,
          color: colors.text,
        }}>
          Settings
        </h3>

        {/* Desktop + Mobile notification sections */}
        <NotificationSettings />

        {showDashboardSections && (
          <>
            <div style={styles.groupHeader}>Dashboard</div>
            {DASHBOARD_SECTIONS.map((section) => (
              <div key={section.key} style={styles.settingsRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.settingsLabel}>{section.label}</div>
                  <div style={styles.settingsCaption}>{section.caption}</div>
                </div>
                <ToggleSwitch
                  on={isSectionVisible(profile, section.key)}
                  onClick={() => toggleSection(section.key)}
                />
              </div>
            ))}
          </>
        )}

        {/* Morty */}
        <div style={styles.settingsRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.settingsLabel}>Morty</div>
            <div style={styles.settingsCaption}>Mascot appearances around the app</div>
          </div>
          {isAdmin && profile?.mascot_enabled !== false && (
            <button
              onClick={() => window.dispatchEvent(new Event('summon-morty'))}
              style={{ ...buttonRecipe({ variant: 'ghost', size: 'sm' }), color: colors.accentFg, borderColor: colors.accentBorder, fontFamily: 'inherit' }}
              title="Summon Morty now"
            >
              Summon
            </button>
          )}
          <ToggleSwitch
            on={profile?.mascot_enabled !== false}
            onClick={() => updateProfile({ mascot_enabled: profile?.mascot_enabled === false ? true : false })}
          />
        </div>

        {/* Morty Chat */}
        <div style={styles.settingsRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={styles.settingsLabel}>Morty Chat</div>
            <div style={styles.settingsCaption}>Assistant chat for app questions (bottom right)</div>
          </div>
          <ToggleSwitch
            on={profile?.assistant_enabled !== false}
            onClick={() => updateProfile({ assistant_enabled: profile?.assistant_enabled === false ? true : false })}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: spacing.xl }}>
          <button
            onClick={onClose}
            style={{ ...buttonRecipe({ variant: 'secondary', size: 'md' }), fontFamily: 'inherit' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  groupHeader: {
    fontSize: `${fontSizes.sm}px`,
    fontWeight: fontWeights.bold,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.textSubtle,
    margin: `${spacing.xl}px 0 ${spacing.xs}px`,
  },
  // Mirrors the rows this modal used to render inside Dashboard.js.
  settingsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: `${spacing.md}px`,
    padding: `${spacing.md}px 0`,
    borderBottom: `1px solid ${colors.border}`,
  },
  settingsLabel: {
    fontSize: `${fontSizes.lg}px`,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  settingsCaption: {
    fontSize: `${fontSizes.sm}px`,
    color: colors.textSubtle,
    marginTop: '2px',
    lineHeight: 1.4,
  },
};
