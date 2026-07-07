import { supabase } from '../supabaseClient';

// VAPID public key (applicationServerKey). Public by design — the private
// half lives only in Supabase edge function secrets (VAPID_KEYS_JWK).
export const VAPID_PUBLIC_KEY = 'BFUkOtrdO1hxHiyIN33lLhc-uAeYoil55HBXpMSgSRaYORYs9fGXJc99HFTVlyrNBODkMJi0G9i76gNsPg0MMGE';

const SW_PATH = '/push-sw.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

// iOS only allows Web Push for web apps launched from the Home Screen.
export function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

// iOS Safari/Chrome tab (not installed): push is impossible until the user
// adds the app to their Home Screen.
export function iosNeedsInstall() {
  return isIos() && !isStandalone();
}

export async function getExistingSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// Must be called from a user gesture (iOS requires it for the permission prompt).
export async function subscribeToPush(userId) {
  if (!pushSupported()) throw new Error('Push is not supported in this browser');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const reg = await navigator.serviceWorker.register(SW_PATH);
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    platform: isIos() ? 'ios' : 'other',
    user_agent: navigator.userAgent.slice(0, 255),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
  return sub;
}

export async function unsubscribeFromPush() {
  const sub = await getExistingSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
