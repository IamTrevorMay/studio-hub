import React, { useState, useEffect, useCallback } from 'react';

const TOUR_STEPS = [
  { key: 'fl_dashboard', title: 'Dashboard', description: 'This is your home base. You\'ll see your active assignments and updates here.' },
  { key: 'fl_documents', title: 'Documents', description: 'Review and sign documents from your team. A badge appears when something needs your signature.' },
  { key: 'assets', title: 'Assets Library', description: 'Access shared files — download assets you need and upload your deliverables.' },
  { key: 'resources', title: 'Resources', description: 'Reference materials, guides, and links your team has shared.' },
  { key: 'fl_profile', title: 'Profile', description: 'Set up your payment method, hourly rate, and contact info so you can get paid.' },
];

export default function FreelancerTour({ onComplete, onNavigate }) {
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState(null);

  const measure = useCallback(() => {
    const current = TOUR_STEPS[step];
    if (!current) return;
    const el = document.querySelector(`[data-nav-key="${current.key}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    }
  }, [step]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // Navigate to the current step's page so the sidebar item is visible
  useEffect(() => {
    const current = TOUR_STEPS[step];
    if (current && onNavigate) {
      onNavigate(current.key);
    }
  }, [step]); // eslint-disable-line

  const isLast = step === TOUR_STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      onNavigate('fl_profile');
      onComplete();
    } else {
      setStep(step + 1);
    }
  }

  function handleBack() {
    if (step > 0) setStep(step - 1);
  }

  if (!targetRect) return null;

  const PAD = 6;
  const highlightStyle = {
    position: 'fixed',
    top: targetRect.top - PAD,
    left: targetRect.left - PAD,
    width: targetRect.width + PAD * 2,
    height: targetRect.height + PAD * 2,
    borderRadius: 10,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)',
    zIndex: 10001,
    pointerEvents: 'none',
  };

  // Position tooltip to the right of the sidebar item
  const tooltipTop = targetRect.top;
  const tooltipLeft = targetRect.right + 16;
  // If tooltip would go below viewport, shift it up
  const viewportH = window.innerHeight;
  const tooltipHeight = 220;
  const adjustedTop = tooltipTop + tooltipHeight > viewportH - 20
    ? viewportH - tooltipHeight - 20
    : tooltipTop;

  const tooltipStyle = {
    position: 'fixed',
    top: adjustedTop,
    left: tooltipLeft,
    width: 300,
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: '20px',
    zIndex: 10002,
    fontFamily: 'DM Sans, sans-serif',
  };

  return (
    <div style={styles.overlay}>
      <div style={highlightStyle} />
      <div style={tooltipStyle}>
        <div style={styles.stepCounter}>
          {step + 1} of {TOUR_STEPS.length}
        </div>
        <div style={styles.title}>{TOUR_STEPS[step].title}</div>
        <div style={styles.description}>{TOUR_STEPS[step].description}</div>
        <div style={styles.buttonRow}>
          {step > 0 && (
            <button onClick={handleBack} style={styles.backBtn}>
              Back
            </button>
          )}
          <button onClick={handleNext} style={styles.nextBtn}>
            {isLast ? 'Go to Profile' : 'Next'}
          </button>
        </div>
        <button onClick={onComplete} style={styles.skipBtn}>
          Skip tour
        </button>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
  },
  stepCounter: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.35)',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 1.5,
    marginBottom: 20,
  },
  buttonRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 12,
  },
  backBtn: {
    padding: '8px 16px',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'transparent',
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontSize: 14,
    fontFamily: 'DM Sans, sans-serif',
  },
  nextBtn: {
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    background: '#6366f1',
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'DM Sans, sans-serif',
  },
  skipBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'DM Sans, sans-serif',
  },
};
