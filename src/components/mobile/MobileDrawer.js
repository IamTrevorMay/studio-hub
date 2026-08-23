import React, { useEffect, useState } from 'react';
import { mobileTokens, mobileTapButton } from '../../utils/mobileTokens';
import { getDisplayName, getDisplayInitial } from '../../lib/displayName';
import backdropDismiss from '../../lib/backdropDismiss';
import { colors } from '../../lib/styleTokens';

// Slide-in drawer with the full nav (already filtered for mobile by the caller),
// plus user info + sign out at the bottom.
//
// Props:
//   open: boolean
//   onClose: () => void
//   resolvedNav: array of { type: 'item'|'folder', ... }  — already mobile-filtered
//   activeTab: string
//   onSelect: (tabKey) => void
//   profile?: { full_name, title }
//   onSignOut: () => void
//   isAdmin?: boolean
const MODE_LABELS = { work: 'Work', production: 'Production', admin: 'Admin' };

export default function MobileDrawer({
  open,
  onClose,
  resolvedNav = [],
  activeTab,
  onSelect,
  profile,
  onSignOut,
  isAdmin,
  mode,
  availableModes = [],
  onSelectMode,
  suiteBrand,      // staff only: show "Bridge" + Mayday Studio suite mark
  onOpenLauncher,  // staff only: "Apps" row → suite launcher
}) {
  const [folderState, setFolderState] = useState(() =>
    JSON.parse(localStorage.getItem('nav-folder-state') || '{}')
  );

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  function toggleFolder(id) {
    setFolderState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      localStorage.setItem('nav-folder-state', JSON.stringify(next));
      return next;
    });
  }

  function handleSelect(key) {
    onSelect?.(key);
    onClose?.();
  }

  // Group nav into top-level entries with children for folders.
  // Mobile flattens 'pre_production' and 'core_team' so their children
  // appear at top level — those folders aren't useful with a small nav.
  const FLATTEN_FOLDERS = new Set(['pre_production', 'core_team']);
  const folders = {};
  resolvedNav
    .filter((e) => e.type === 'folder' && !FLATTEN_FOLDERS.has(e.id))
    .forEach((f) => { folders[f.id] = { ...f, children: [] }; });
  const topLevel = [];
  resolvedNav.forEach((entry) => {
    if (entry.type === 'folder') {
      if (FLATTEN_FOLDERS.has(entry.id)) return; // drop the folder header
      topLevel.push({ ...entry, children: folders[entry.id].children });
    } else if (entry.folderId && folders[entry.folderId]) {
      folders[entry.folderId].children.push(entry);
    } else {
      topLevel.push(entry);
    }
  });

  return (
    <div style={styles.backdrop} {...backdropDismiss(onClose)}>
      <aside style={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...styles.logoArea, paddingTop: `calc(${mobileTokens.space.lg}px + ${mobileTokens.safeTop})` }}>
          <img src="/logo.png" alt="Mayday Studio" width="28" height="28" />
          {suiteBrand ? (
            <div style={styles.logoStack}>
              <span style={styles.logoText}>Bridge</span>
              <span style={styles.logoSuiteMark}>Mayday Studio</span>
            </div>
          ) : (
            <span style={styles.logoText}>Mayday Studio</span>
          )}
        </div>

        <nav style={styles.nav}>
          {topLevel.map((entry) => {
            if (entry.type === 'folder') {
              const collapsed = folderState[entry.id] ?? entry.collapsed;
              return (
                <React.Fragment key={entry.id}>
                  <button onClick={() => toggleFolder(entry.id)} style={styles.folderBtn}>
                    <span>{entry.label}</span>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>
                      <path d="M3 5l4 4 4-4z" />
                    </svg>
                  </button>
                  {!collapsed && entry.children.map((child) => (
                    <NavItemBtn
                      key={child.key}
                      label={child.label}
                      active={activeTab === child.key}
                      onClick={() => handleSelect(child.key)}
                      indented
                    />
                  ))}
                </React.Fragment>
              );
            }
            return (
              <NavItemBtn
                key={entry.key}
                label={entry.label}
                active={activeTab === entry.key}
                onClick={() => handleSelect(entry.key)}
              />
            );
          })}

        </nav>

        {onOpenLauncher && (
          <div style={styles.appsArea}>
            <button onClick={onOpenLauncher} style={styles.appsBtn}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="6" height="6" rx="1.5" />
                <rect x="11" y="3" width="6" height="6" rx="1.5" />
                <rect x="3" y="11" width="6" height="6" rx="1.5" />
                <rect x="11" y="11" width="6" height="6" rx="1.5" />
              </svg>
              <span>Apps</span>
            </button>
          </div>
        )}

        {onSelectMode && availableModes.length > 1 && (
          <div style={styles.modeToggleArea}>
            <div style={styles.modeToggle} role="tablist">
              {availableModes.map((m) => (
                <button
                  key={m}
                  onClick={mode === m ? undefined : () => onSelectMode(m)}
                  role="tab"
                  aria-selected={mode === m}
                  style={{
                    ...styles.modeBtn,
                    ...(mode === m ? styles.modeBtnActive : {}),
                  }}
                >
                  {MODE_LABELS[m] || m}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ ...styles.userArea, paddingBottom: `calc(${mobileTokens.space.md}px + ${mobileTokens.safeBottom})` }}>
          <div style={styles.avatar}>{getDisplayInitial(profile)}</div>
          <div style={styles.userInfo}>
            <div style={styles.userName}>{getDisplayName(profile) || 'User'}</div>
            <div style={styles.userTitle}>{profile?.title || 'Team Member'}</div>
          </div>
          <button onClick={onSignOut} style={{ ...mobileTapButton, ...styles.signOutBtn }} aria-label="Sign out">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>
    </div>
  );
}

function NavItemBtn({ label, active, onClick, indented, style }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...mobileTapButton,
        justifyContent: 'flex-start',
        width: '100%',
        padding: `${mobileTokens.space.md}px ${indented ? 32 : mobileTokens.space.md}px`,
        borderRadius: mobileTokens.radius.md,
        background: active ? 'rgba(91, 143, 199,0.16)' : 'transparent',
        color: active ? '#8fb4d8' : 'rgba(255,255,255,0.85)',
        fontWeight: active ? 600 : 500,
        fontSize: mobileTokens.font.md,
        textAlign: 'left',
        ...style,
      }}
    >
      {label}
    </button>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: mobileTokens.z.drawer,
    animation: 'maydayBackdropFade 0.18s ease-out',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 'min(86vw, 320px)',
    background: colors.bg,
    color: '#e2e8f0',
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: mobileTokens.font.base,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 24px rgba(0,0,0,0.5)',
    animation: 'maydayDrawerSlideIn 0.22s ease-out',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.lg}px ${mobileTokens.space.lg}px ${mobileTokens.space.md}px`,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  logoText: {
    fontSize: mobileTokens.font.lg,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.3px',
  },
  logoStack: {
    display: 'flex',
    flexDirection: 'column',
  },
  logoSuiteMark: {
    fontSize: mobileTokens.font.xs,
    fontWeight: 600,
    color: colors.textDim,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    lineHeight: 1.3,
  },
  appsArea: {
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    borderTop: `1px solid ${colors.border}`,
    flexShrink: 0,
  },
  appsBtn: {
    ...mobileTapButton,
    justifyContent: 'flex-start',
    gap: mobileTokens.space.md,
    width: '100%',
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.md,
    color: colors.textMuted,
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    textAlign: 'left',
  },
  nav: {
    flex: 1,
    overflowY: 'auto',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.sm}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    WebkitOverflowScrolling: 'touch',
  },
  folderBtn: {
    ...mobileTapButton,
    justifyContent: 'space-between',
    width: '100%',
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.md}px`,
    borderRadius: mobileTokens.radius.md,
    color: 'rgba(255,255,255,0.5)',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    textAlign: 'left',
  },
  userArea: {
    display: 'flex',
    alignItems: 'center',
    gap: mobileTokens.space.md,
    padding: `${mobileTokens.space.md}px ${mobileTokens.space.lg}px`,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: mobileTokens.radius.md,
    background: 'linear-gradient(135deg, #5b8fc7, #8fb4d8)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: mobileTokens.font.md,
    fontWeight: 700,
    flexShrink: 0,
  },
  userInfo: {
    flex: 1,
    overflow: 'hidden',
  },
  userName: {
    fontSize: mobileTokens.font.md,
    fontWeight: 600,
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userTitle: {
    fontSize: mobileTokens.font.xs,
    color: 'rgba(255,255,255,0.4)',
    whiteSpace: 'nowrap',
  },
  signOutBtn: {
    color: 'rgba(255,255,255,0.5)',
    borderRadius: mobileTokens.radius.sm,
  },
  modeToggleArea: {
    padding: `${mobileTokens.space.sm}px ${mobileTokens.space.lg}px`,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  modeToggle: {
    display: 'flex',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: mobileTokens.radius.pill,
    padding: 3,
    gap: 2,
  },
  modeBtn: {
    ...mobileTapButton,
    flex: 1,
    minHeight: 36,
    padding: '6px 12px',
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.55)',
    fontSize: mobileTokens.font.sm,
    fontWeight: 600,
    borderRadius: mobileTokens.radius.pill,
    fontFamily: 'inherit',
  },
  modeBtnActive: {
    background: colors.accentSoft,
    color: colors.accentFg,
  },
};
