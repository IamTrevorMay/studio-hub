// Backdrop-click dismissal for modals that doesn't misfire on text selection.
//
// The browser fires a click on the *common ancestor* of where the mouse went
// down and where it came up. So selecting text inside a modal and releasing
// the mouse over the backdrop produces a click on the backdrop — and a plain
// `onClick={close}` slams the modal shut, eating the user's work. The fix is
// to arm the close only when the press *started* on the backdrop itself.
//
// Usage — replace `onClick={() => setModal(null)}` on the overlay div with:
//   <div style={styles.modalOverlay} {...backdropDismiss(() => setModal(null))}>
//
// The spread keeps the JSX a plain div (no wrapper component, no ref
// plumbing). A single module-level flag is safe because only one
// mousedown→click sequence can be in flight at a time.

let armed = false;

export default function backdropDismiss(onDismiss) {
  return {
    onMouseDown: (e) => {
      armed = e.target === e.currentTarget;
    },
    onClick: (e) => {
      // Also require the click target to be the backdrop, so bubbled clicks
      // from modal content never dismiss (even without stopPropagation).
      if (armed && e.target === e.currentTarget) onDismiss(e);
      armed = false;
    },
  };
}
