import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { NOTIF_CATEGORIES, isCategoryEnabled } from '../lib/notificationPrefs';
import {
  pushSupported, iosNeedsInstall, getExistingSubscription,
  subscribeToPush, unsubscribeFromPush,
} from '../lib/pushNotifications';

function Toggle({ on, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        position: 'relative', width: '40px', height: '22px', borderRadius: '11px',
        border: 'none', background: on ? '#22c55e' : 'rgba(255,255,255,0.15)',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'background 0.2s', padding: 0, flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: '2px', left: on ? '20px' : '2px',
        width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  );
}

// Desktop + Mobile notification sections shared by the desktop settings modal
// (Dashboard.js) and the mobile settings sheet (DashboardMobile.js).
// Category prefs are per-user (sparse opt-outs in profiles.notification_prefs);
// the mobile push subscription itself is per-device.
export default function NotificationSettings() {
  const { profile, updateProfile } = useAuth();
  const prefs = profile?.notification_prefs || {};

  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );
  const [pushOnThisDevice, setPushOnThisDevice] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getExistingSubscription()
      .then((sub) => { if (!cancelled) setPushOnThisDevice(!!sub); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function setCategoryPref(surface, key, enabled) {
    const surfacePrefs = { ...(prefs[surface] || {}) };
    if (enabled) delete surfacePrefs[key]; else surfacePrefs[key] = false;
    try {
      await updateProfile({ notification_prefs: { ...prefs, [surface]: surfacePrefs } });
    } catch (err) {
      console.error('Error saving notification prefs:', err);
    }
  }

  async function handleDesktopToggle() {
    if (profile?.desktop_notifications_enabled === true) {
      await updateProfile({ desktop_notifications_enabled: false });
      return;
    }
    if (typeof Notification === 'undefined') return;
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    setNotifPermission(perm);
    if (perm === 'granted') await updateProfile({ desktop_notifications_enabled: true });
  }

  async function handlePushToggle() {
    if (pushBusy) return;
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushOnThisDevice) {
        await unsubscribeFromPush();
        setPushOnThisDevice(false);
      } else {
        await subscribeToPush(profile.id);
        setPushOnThisDevice(true);
      }
    } catch (err) {
      console.error('Push subscribe error:', err);
      setPushError(err.message || 'Could not enable push on this device');
    } finally {
      setPushBusy(false);
    }
  }

  const desktopOn = profile?.desktop_notifications_enabled === true && notifPermission === 'granted';
  const desktopBlocked = notifPermission === 'denied' || notifPermission === 'unsupported';
  const pushUnavailable = !pushSupported();
  const needsInstall = iosNeedsInstall();

  function renderCategoryRows(surface, masterOn) {
    return NOTIF_CATEGORIES.map((cat) => (
      <div key={`${surface}-${cat.key}`} style={{ ...st.row, paddingLeft: '14px', opacity: masterOn ? 1 : 0.45 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.catLabel}>{cat.label}</div>
          <div style={st.caption}>{cat.caption}</div>
        </div>
        <Toggle
          on={isCategoryEnabled(prefs, surface, cat.key)}
          onClick={() => setCategoryPref(surface, cat.key, !isCategoryEnabled(prefs, surface, cat.key))}
          disabled={!masterOn}
        />
      </div>
    ));
  }

  return (
    <div>
      {/* ── Desktop ── */}
      <div style={st.sectionTitle}>Desktop</div>
      <div style={st.row}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.label}>Desktop Notifications</div>
          <div style={st.caption}>
            {notifPermission === 'denied'
              ? 'Blocked in browser settings — allow notifications for this site to enable'
              : notifPermission === 'unsupported'
                ? 'Not supported in this browser'
                : 'OS alerts for new notifications while this tab is in the background'}
          </div>
        </div>
        <Toggle on={desktopOn} onClick={handleDesktopToggle} disabled={desktopBlocked} />
      </div>
      {renderCategoryRows('desktop', desktopOn)}

      {/* ── Mobile / Push ── */}
      <div style={{ ...st.sectionTitle, marginTop: '18px' }}>Mobile & Push</div>
      <div style={st.row}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={st.label}>Push on this device</div>
          <div style={st.caption}>
            {needsInstall
              ? 'On iPhone/iPad: open the share menu, tap "Add to Home Screen", then enable this from the installed app'
              : pushUnavailable
                ? 'Not supported in this browser'
                : 'Notifications delivered even when the app is closed'}
          </div>
          {pushError && <div style={{ ...st.caption, color: '#f87171' }}>{pushError}</div>}
        </div>
        <Toggle
          on={pushOnThisDevice}
          onClick={handlePushToggle}
          disabled={pushUnavailable || needsInstall || pushBusy}
        />
      </div>
      {renderCategoryRows('mobile', true)}
      <div style={{ ...st.caption, paddingLeft: '14px', marginTop: '2px' }}>
        Mobile toggles apply to every device where push is enabled.
      </div>
    </div>
  );
}

const st = {
  sectionTitle: {
    fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.35)', marginBottom: '4px',
  },
  row: {
    display: 'flex', alignItems: 'center', gap: '12px',
    padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  label: { fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.9)' },
  catLabel: { fontSize: '13px', fontWeight: 500, color: 'rgba(255,255,255,0.8)' },
  caption: { fontSize: '11.5px', color: 'rgba(255,255,255,0.4)', marginTop: '1px' },
};
