import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import NotificationSettings from './NotificationSettings';
import {
  resolveLayout, normalizeLayout, availableWidgets, WIDGET_BY_KEY, SIZES, LAYOUT_VERSION,
} from '../lib/dashboardWidgets';
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

// The Dashboard's widget catalog is the single list of toggleable sections
// now — this modal and the Dashboard's own Edit mode read and write the same
// `dashboard_prefs.layout`, so they can never disagree about what's on.

/** A widget is visible exactly when it appears in the saved layout. */
export function isSectionVisible(profile, key) {
  return resolveLayout(profile?.dashboard_prefs).layout.some(e => e.k === key);
}

export default function SettingsModal({ onClose }) {
  const { profile, updateProfile, isAdmin, isContractor, isClient, isPartner } = useAuth();

  // Contractors and clients get their own portal dashboards, which have none of
  // these sections — no point offering toggles that control nothing.
  const showDashboardSections = !isContractor && !isClient;

  // Toggling here adds or removes the widget from the layout. A widget turned
  // back on lands at the end at its default size — its old slot isn't kept,
  // since the layout array is what defines placement.
  function toggleSection(key) {
    const prefs = profile?.dashboard_prefs || {};
    const { layout } = resolveLayout(prefs);
    const on = layout.some(e => e.k === key);
    const spec = WIDGET_BY_KEY[key];
    const next = on
      ? layout.filter(e => e.k !== key)
      : [...layout, { k: key, x: 0, w: SIZES[spec.defaultSize] }];
    updateProfile({
      dashboard_prefs: { ...prefs, layout: normalizeLayout(next), v: LAYOUT_VERSION },
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
            {availableWidgets({ isPartner }).map((section) => (
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
