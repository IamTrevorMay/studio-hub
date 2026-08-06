import React, {
  createContext, useContext, useState, useCallback, useEffect, useRef,
} from 'react';
import {
  colors, spacing, radii, fontSizes, fontWeights, fontFamily, shadows, transitions,
} from '../lib/styleTokens';

// ─────────────────────────────────────────────────────────────
// Toast system — on-brand replacement for native alert().
//
// Two ways to fire a toast:
//   1. useToast() hook inside a component → { success, error, info, warning }
//      plus the object itself is callable: const toast = useToast(); toast('hi').
//   2. The module-level `toast` singleton (react-hot-toast pattern) for the many
//      alert() sites that live in non-component module helpers where hooks are
//      illegal:  import { toast } from '.../ToastContext';  toast.error(msg).
//
// The provider registers its emit fn into a module variable on mount; the
// singleton proxies to it. Calls fired before mount are queued and flushed.
// ─────────────────────────────────────────────────────────────

const ToastContext = createContext(null);

// Tone triple per type. error maps to the danger palette.
const TONES = {
  success: colors.success,
  error:   colors.danger,
  info:    colors.info,
  warning: colors.warning,
};

// Auto-dismiss durations (ms). Errors linger longer.
const DURATIONS = {
  success: 4000,
  info:    4000,
  warning: 5000,
  error:   6000,
};

const MAX_VISIBLE = 4;

// ─── Module-level singleton escape hatch ──────────────────────
let emitFn = null;
const pendingQueue = [];

function dispatch(type, message, opts) {
  const msg = message == null ? '' : (typeof message === 'string' ? message : String(message));
  // A toast needs either a body or a title to be worth showing.
  if (!msg && !opts?.title) return;
  if (emitFn) emitFn(type, msg, opts);
  else pendingQueue.push([type, msg, opts]);
}

export const toast = Object.assign(
  (message) => dispatch('info', message),
  {
    success: (message) => dispatch('success', message),
    error:   (message) => dispatch('error', message),
    info:    (message) => dispatch('info', message),
    warning: (message) => dispatch('warning', message),
    // Richer toast — optional bold title + click-to-navigate handler.
    //   toast.notify({ title, message, onClick, type, duration })
    notify: ({ type = 'info', message, title, onClick, duration } = {}) =>
      dispatch(type, message, { title, onClick, duration }),
  },
);

export function useToast() {
  const ctx = useContext(ToastContext);
  // Fall back to the singleton if used outside the provider so callers never crash.
  return ctx || toast;
}

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]); // [{ id, type, message }]
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const remove = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((type, message, opts) => {
    const id = ++nextId;
    setToasts((cur) => {
      // Newest on top; cap the stack.
      const next = [{
        id, type, message,
        title: opts?.title,
        onClick: opts?.onClick,
        duration: opts?.duration,
      }, ...cur];
      return next.slice(0, MAX_VISIBLE);
    });
  }, []);

  // Register the singleton emitter + flush anything queued before mount.
  useEffect(() => {
    emitFn = (type, message, opts) => add(type, message, opts);
    if (pendingQueue.length) {
      const drained = pendingQueue.splice(0, pendingQueue.length);
      drained.forEach(([type, message, opts]) => add(type, message, opts));
    }
    return () => { emitFn = null; };
  }, [add]);

  // Hook API — the value is callable AND has .success/.error/.info/.warning/.notify.
  const api = useRef(null);
  if (!api.current) {
    const fn = (message) => add('info', message);
    fn.success = (message) => add('success', message);
    fn.error   = (message) => add('error', message);
    fn.info    = (message) => add('info', message);
    fn.warning = (message) => add('warning', message);
    fn.notify  = ({ type = 'info', message, title, onClick, duration } = {}) =>
      add(type, message, { title, onClick, duration });
    api.current = fn;
  }

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div style={containerStyle} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast: t, onDismiss }) {
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const tone = TONES[t.type] || colors.info;

  const dismiss = useCallback(() => {
    setLeaving(true);
    // Let the exit transition play before unmounting.
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const dur = t.duration || DURATIONS[t.type] || DURATIONS.info;
    const timer = setTimeout(dismiss, dur);
    return () => clearTimeout(timer);
  }, [t.type, t.duration, dismiss]);

  const shown = entered && !leaving;
  const clickable = typeof t.onClick === 'function';

  const handleClick = useCallback(() => {
    if (!clickable) return;
    try { t.onClick(); } catch (e) { /* navigation is best-effort */ }
    dismiss();
  }, [clickable, t, dismiss]);

  return (
    <div
      role={t.type === 'error' ? 'alert' : 'status'}
      onClick={clickable ? handleClick : undefined}
      style={{
        ...toastStyle,
        borderLeft: `3px solid ${tone.fg}`,
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateX(0)' : 'translateX(16px)',
        cursor: clickable ? 'pointer' : 'default',
      }}
    >
      <span style={{ ...dotStyle, background: tone.fg }} aria-hidden="true" />
      <div style={bodyStyle}>
        {t.title && <div style={titleStyle}>{t.title}</div>}
        {t.message && (
          <div style={t.title ? { ...messageStyle, color: colors.textSubtle } : messageStyle}>
            {t.message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); dismiss(); }}
        aria-label="Dismiss"
        style={dismissStyle}
      >
        ×
      </button>
    </div>
  );
}

// ─── Styles (tokens only) ─────────────────────────────────────

const containerStyle = {
  position: 'fixed',
  top: spacing.xl,
  right: spacing.xl,
  zIndex: 100000, // above modals (~1000) and the confirm overlay (99999)
  display: 'flex',
  flexDirection: 'column',
  gap: spacing.sm,
  maxWidth: 380,
  width: 'calc(100vw - 40px)',
  pointerEvents: 'none', // let clicks fall through the gaps
};

const toastStyle = {
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'flex-start',
  gap: spacing.sm,
  padding: `${spacing.md}px ${spacing.md}px ${spacing.md}px ${spacing.lg}px`,
  background: colors.bgModal,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radii.lg,
  boxShadow: shadows.lg,
  color: colors.text,
  fontFamily,
  transition: transitions.normal,
};

const dotStyle = {
  flexShrink: 0,
  width: spacing.sm,
  height: spacing.sm,
  borderRadius: radii.pill,
  marginTop: spacing.xs,
};

const bodyStyle = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const titleStyle = {
  fontSize: fontSizes.md,
  fontWeight: fontWeights.semibold,
  lineHeight: 1.35,
  wordBreak: 'break-word',
};

const messageStyle = {
  fontSize: fontSizes.md,
  fontWeight: fontWeights.medium,
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

const dismissStyle = {
  flexShrink: 0,
  background: 'transparent',
  border: 'none',
  color: colors.textSubtle,
  fontSize: fontSizes.xl,
  lineHeight: 1,
  padding: 0,
  marginLeft: spacing.xs,
  cursor: 'pointer',
  fontFamily,
};

export default ToastContext;
