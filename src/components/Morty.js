import React, { useState, useEffect, useRef, useCallback } from 'react';

// === SAYINGS ===
const SAYINGS = [
  // Encouragement (15)
  "You're crushing it today!",
  "This content is gonna slap.",
  "Keep going, legend.",
  "The algorithm loves consistency. So do I.",
  "Your future subscribers don't know how lucky they are.",
  "Every video starts with a first frame.",
  "You didn't come this far to only come this far.",
  "Morty believes in you!",
  "That idea? Chef's kiss.",
  "You're built different. In a good way.",
  "One upload closer to the goal.",
  "Your work ethic is showing.",
  "Main character energy detected.",
  "Plot twist: you're already winning.",
  "The grind is temporary. The content is forever.",
  // Dad Jokes (15)
  "Why did the YouTuber break up? No chemistry.",
  "I'm a dinosaur who believes in you. That's rare.",
  "What's a video editor's favorite meal? Cuts of meat.",
  "Why don't scientists trust atoms? They make up everything.",
  "I told my wife she was drawing her eyebrows too high. She seemed surprised.",
  "What do you call a fake noodle? An impasta.",
  "I'm reading a book about anti-gravity. Can't put it down.",
  "Why did the scarecrow win an award? Outstanding in his field.",
  "What do you call a dinosaur that crashes their car? Tyrannosaurus Wrecks.",
  "I would tell you a construction joke but I'm still working on it.",
  "What's the best thing about Switzerland? The flag is a big plus.",
  "Did you hear about the claustrophobic astronaut? He needed more space.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a sleeping dinosaur? A dino-snore.",
  // Health Reminders (10)
  "Hey, have you had water recently? Go drink some.",
  "Stand up and stretch! Your back will thank you.",
  "When's the last time you blinked? Screen breaks matter.",
  "Take a deep breath. In... and out. Nice.",
  "Your posture right now... yeah, fix that.",
  "Fun fact: walking for 5 minutes boosts creativity 60%.",
  "Snack check: fuel the machine!",
  "Eye strain is real. Look at something 20ft away for 20 seconds.",
  "Roll those shoulders back. You're not a shrimp.",
  "Sunshine exists. Consider visiting it briefly.",
  // Fun/Random (10)
  "I'm 65 million years old and still learning new things.",
  "Morty was here.",
  "If I had longer arms, I'd give you a hug.",
  "Rawr means 'great job' in dinosaur.",
  "Fun fact: I can't actually go extinct. I'm digital.",
  "Don't mind me, just vibing.",
  "MM stands for Mega Morty, obviously.",
  "I may be small but my encouragement is huge.",
  "This is my favorite tab to visit.",
  "Tell no one you saw me here.",
];

// === DISAPPOINTED SAYINGS (on dismiss) ===
const DISMISS_SAYINGS = [
  "Fine. I'll just go be extinct.",
  "Wow. Okay. Cool cool cool.",
  "I was just trying to help...",
  "My tiny arms can't hold back these tears.",
  "Et tu, human?",
  "I'll remember this.",
  "Guess I'll go walk into a tar pit.",
  "You'll miss me when I'm gone.",
  "This is my villain origin story.",
  "Ouch. Right in the scales.",
  "I didn't want to be here anyway. (I did.)",
  "Tell my eggs I love them.",
  "The meteor hurt less than this.",
  "Okay but I'm coming back.",
  "Was it something I said?",
  "Going... going... still here... okay NOW going.",
  "You just lost your biggest fan.",
  "Even the asteroid gave me more warning.",
  "Alexa, play 'All By Myself.'",
  "I'll be back. Probably. Definitely.",
];

// === SHIRT COLORS ===
const SHIRT_COLORS = [
  { base: '#dc2626', light: '#ef4444', letter: '#ffffff' }, // Red
  { base: '#2563eb', light: '#3b82f6', letter: '#ffffff' }, // Blue
  { base: '#7c3aed', light: '#8b5cf6', letter: '#ffffff' }, // Purple
  { base: '#ea580c', light: '#f97316', letter: '#ffffff' }, // Orange
  { base: '#db2777', light: '#ec4899', letter: '#ffffff' }, // Pink
  { base: '#ca8a04', light: '#eab308', letter: '#1a1a2e' }, // Yellow
  { base: '#0d9488', light: '#14b8a6', letter: '#ffffff' }, // Teal
  { base: '#4338ca', light: '#6366f1', letter: '#ffffff' }, // Indigo
  { base: '#d1d5db', light: '#f3f4f6', letter: '#1a1a2e' }, // White
  { base: '#1f2937', light: '#374151', letter: '#ffffff' }, // Black
];

// === PIXEL ART SPRITE GENERATOR ===
// Cute baseball with arms, legs, face, and cap
// ~16 wide x 20 tall pixel grid at 4x scale

const S = 4; // scale factor
const SPRITE_H = 20; // sprite height in logical pixels

function px(x, y, color) {
  return `${x * S}px ${y * S}px 0 0 ${color}`;
}

function buildShadow(pixels) {
  return pixels.join(', ');
}

// Colors
const B = {
  white: '#f5f0e8',    // baseball leather
  seam: '#cc3333',     // red stitching
  shade: '#ddd8cc',    // shadow side of ball
  eye: '#1a1a2e',      // eyes
  mouth: '#1a1a2e',    // mouth
  blush: '#ffaaaa',    // cheek blush
  arm: '#f5f0e8',      // arms (same as ball)
  glove: '#8B4513',    // little glove/hand
  shoe: '#333333',     // shoes
  leg: '#f5f0e8',      // legs
  capTop: '#1e40af',   // cap top (blue)
  capBrim: '#1e3a8a',  // cap brim (darker blue)
};

// Baseball body (round ball shape, rows 0-12)
function ballBody(shirt) {
  const p = [];

  // === CAP (rows 0-3) ===
  [6, 7, 8, 9, 10].forEach(x => p.push(px(x, 0, B.capTop)));
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 1, B.capTop)));
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 2, B.capTop)));
  // Cap brim
  [4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(x => p.push(px(x, 3, B.capBrim)));

  // === BALL / FACE (rows 4-12) ===
  // Row 4: top of ball below cap
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 4, B.white)));

  // Row 5: wider
  [4, 5, 11, 12].forEach(x => p.push(px(x, 5, B.white)));
  // Seam stitch on left
  p.push(px(6, 5, B.seam));
  [7, 8, 9, 10].forEach(x => p.push(px(x, 5, B.white)));

  // Row 6: eyes row
  [4].forEach(x => p.push(px(x, 6, B.white)));
  p.push(px(5, 6, B.seam));
  p.push(px(6, 6, B.white));
  p.push(px(7, 6, B.eye)); // left eye
  p.push(px(8, 6, B.white));
  p.push(px(9, 6, B.eye)); // right eye
  p.push(px(10, 6, B.white));
  p.push(px(11, 6, B.seam));
  p.push(px(12, 6, B.white));

  // Row 7: blush + seams
  [4].forEach(x => p.push(px(x, 7, B.white)));
  p.push(px(5, 7, B.white));
  p.push(px(6, 7, B.blush)); // left blush
  [7, 8, 9].forEach(x => p.push(px(x, 7, B.white)));
  p.push(px(10, 7, B.blush)); // right blush
  p.push(px(11, 7, B.white));
  p.push(px(12, 7, B.white));

  // Row 8: mouth
  [4, 5, 6].forEach(x => p.push(px(x, 8, B.white)));
  p.push(px(7, 8, B.mouth)); p.push(px(8, 8, B.mouth)); p.push(px(9, 8, B.mouth)); // smile
  [10, 11, 12].forEach(x => p.push(px(x, 8, B.white)));

  // Row 9: lower face + seam
  [4, 5].forEach(x => p.push(px(x, 9, B.white)));
  p.push(px(6, 9, B.seam));
  [7, 8, 9, 10].forEach(x => p.push(px(x, 9, B.white)));
  p.push(px(11, 9, B.seam));
  p.push(px(12, 9, B.white));

  // Row 10: lower ball
  [5, 6].forEach(x => p.push(px(x, 10, B.shade)));
  p.push(px(7, 10, B.seam));
  [8, 9].forEach(x => p.push(px(x, 10, B.shade)));
  p.push(px(10, 10, B.seam));
  p.push(px(11, 10, B.shade));

  // Row 11: bottom curve
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 11, B.shade)));

  // Row 12: very bottom of ball
  [6, 7, 8, 9, 10].forEach(x => p.push(px(x, 12, B.shade)));

  return p;
}

// Standing legs (rows 13-17)
function standingLegs(p) {
  // Left leg
  p.push(px(6, 13, B.leg)); p.push(px(7, 13, B.leg));
  p.push(px(6, 14, B.leg)); p.push(px(7, 14, B.leg));
  p.push(px(6, 15, B.leg)); p.push(px(7, 15, B.leg));
  // Left shoe
  p.push(px(5, 16, B.shoe)); p.push(px(6, 16, B.shoe)); p.push(px(7, 16, B.shoe));

  // Right leg
  p.push(px(9, 13, B.leg)); p.push(px(10, 13, B.leg));
  p.push(px(9, 14, B.leg)); p.push(px(10, 14, B.leg));
  p.push(px(9, 15, B.leg)); p.push(px(10, 15, B.leg));
  // Right shoe
  p.push(px(9, 16, B.shoe)); p.push(px(10, 16, B.shoe)); p.push(px(11, 16, B.shoe));
}

// Arms at rest (sides of ball)
function restingArms(p) {
  // Left arm
  p.push(px(3, 7, B.arm)); p.push(px(3, 8, B.arm));
  p.push(px(2, 9, B.glove));
  // Right arm
  p.push(px(13, 7, B.arm)); p.push(px(13, 8, B.arm));
  p.push(px(14, 9, B.glove));
}

function walkFrame(shirt, frame) {
  const p = ballBody(shirt);
  const f = frame % 4;

  // Arms swing while walking
  if (f === 0 || f === 2) {
    restingArms(p);
  } else if (f === 1) {
    // Left arm forward, right back
    p.push(px(3, 6, B.arm)); p.push(px(3, 7, B.arm)); p.push(px(2, 8, B.glove));
    p.push(px(13, 8, B.arm)); p.push(px(13, 9, B.arm)); p.push(px(14, 10, B.glove));
  } else {
    // Right arm forward, left back
    p.push(px(3, 8, B.arm)); p.push(px(3, 9, B.arm)); p.push(px(2, 10, B.glove));
    p.push(px(13, 6, B.arm)); p.push(px(13, 7, B.arm)); p.push(px(14, 8, B.glove));
  }

  // Walking legs
  if (f === 0) {
    // Left forward, right back
    p.push(px(5, 13, B.leg)); p.push(px(6, 13, B.leg));
    p.push(px(5, 14, B.leg)); p.push(px(6, 14, B.leg));
    p.push(px(4, 15, B.shoe)); p.push(px(5, 15, B.shoe)); p.push(px(6, 15, B.shoe));
    p.push(px(10, 13, B.leg)); p.push(px(11, 13, B.leg));
    p.push(px(10, 14, B.leg)); p.push(px(11, 14, B.leg));
    p.push(px(10, 15, B.shoe)); p.push(px(11, 15, B.shoe)); p.push(px(12, 15, B.shoe));
  } else if (f === 2) {
    // Right forward, left back
    p.push(px(6, 13, B.leg)); p.push(px(7, 13, B.leg));
    p.push(px(6, 14, B.leg)); p.push(px(7, 14, B.leg));
    p.push(px(6, 15, B.shoe)); p.push(px(7, 15, B.shoe)); p.push(px(8, 15, B.shoe));
    p.push(px(9, 13, B.leg)); p.push(px(10, 13, B.leg));
    p.push(px(9, 14, B.leg)); p.push(px(10, 14, B.leg));
    p.push(px(8, 15, B.shoe)); p.push(px(9, 15, B.shoe)); p.push(px(10, 15, B.shoe));
  } else {
    standingLegs(p);
  }

  return buildShadow(p);
}

function idleFrame(shirt, frame) {
  const p = ballBody(shirt);
  restingArms(p);
  standingLegs(p);
  return buildShadow(p);
}

function waveFrame(shirt, frame) {
  const p = ballBody(shirt);
  standingLegs(p);
  const wf = frame % 3;

  // Left arm resting
  p.push(px(3, 7, B.arm)); p.push(px(3, 8, B.arm)); p.push(px(2, 9, B.glove));

  // Right arm waving up
  if (wf === 0) {
    p.push(px(13, 5, B.arm)); p.push(px(14, 4, B.arm)); p.push(px(15, 3, B.glove));
  } else if (wf === 1) {
    p.push(px(13, 5, B.arm)); p.push(px(14, 4, B.arm)); p.push(px(15, 4, B.glove));
  } else {
    p.push(px(13, 5, B.arm)); p.push(px(14, 4, B.arm)); p.push(px(15, 3, B.glove));
  }

  return buildShadow(p);
}

function jumpFrame(shirt, frame) {
  const p = ballBody(shirt);
  const jf = frame % 3;

  // Arms up
  p.push(px(3, 5, B.arm)); p.push(px(2, 4, B.arm)); p.push(px(1, 3, B.glove));
  p.push(px(13, 5, B.arm)); p.push(px(14, 4, B.arm)); p.push(px(15, 3, B.glove));

  if (jf === 1) {
    // Tucked legs (in air)
    p.push(px(6, 13, B.leg)); p.push(px(7, 13, B.leg));
    p.push(px(5, 14, B.shoe)); p.push(px(6, 14, B.shoe));
    p.push(px(9, 13, B.leg)); p.push(px(10, 13, B.leg));
    p.push(px(10, 14, B.shoe)); p.push(px(11, 14, B.shoe));
  } else {
    standingLegs(p);
  }

  return buildShadow(p);
}

function lookFrame(shirt, frame) {
  const p = [];
  const lf = frame % 2;

  // Cap
  [6, 7, 8, 9, 10].forEach(x => p.push(px(x, 0, B.capTop)));
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 1, B.capTop)));
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 2, B.capTop)));
  [4, 5, 6, 7, 8, 9, 10, 11, 12].forEach(x => p.push(px(x, 3, B.capBrim)));

  // Ball top
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 4, B.white)));
  [4, 5, 11, 12].forEach(x => p.push(px(x, 5, B.white)));
  p.push(px(6, 5, B.seam));
  [7, 8, 9, 10].forEach(x => p.push(px(x, 5, B.white)));

  // Eyes shifted
  [4].forEach(x => p.push(px(x, 6, B.white)));
  p.push(px(5, 6, B.seam)); p.push(px(6, 6, B.white));
  if (lf === 0) {
    p.push(px(7, 6, B.white)); p.push(px(8, 6, B.eye)); // look right
    p.push(px(9, 6, B.white)); p.push(px(10, 6, B.eye));
  } else {
    p.push(px(7, 6, B.eye)); p.push(px(8, 6, B.white)); // look left
    p.push(px(9, 6, B.eye)); p.push(px(10, 6, B.white));
  }
  p.push(px(11, 6, B.seam)); p.push(px(12, 6, B.white));

  // Blush + lower face (same as base)
  [4].forEach(x => p.push(px(x, 7, B.white)));
  p.push(px(5, 7, B.white)); p.push(px(6, 7, B.blush));
  [7, 8, 9].forEach(x => p.push(px(x, 7, B.white)));
  p.push(px(10, 7, B.blush)); p.push(px(11, 7, B.white)); p.push(px(12, 7, B.white));
  [4, 5, 6].forEach(x => p.push(px(x, 8, B.white)));
  p.push(px(7, 8, B.mouth)); p.push(px(8, 8, B.mouth)); p.push(px(9, 8, B.mouth));
  [10, 11, 12].forEach(x => p.push(px(x, 8, B.white)));
  [4, 5].forEach(x => p.push(px(x, 9, B.white)));
  p.push(px(6, 9, B.seam)); [7, 8, 9, 10].forEach(x => p.push(px(x, 9, B.white)));
  p.push(px(11, 9, B.seam)); p.push(px(12, 9, B.white));
  [5, 6].forEach(x => p.push(px(x, 10, B.shade)));
  p.push(px(7, 10, B.seam)); [8, 9].forEach(x => p.push(px(x, 10, B.shade)));
  p.push(px(10, 10, B.seam)); p.push(px(11, 10, B.shade));
  [5, 6, 7, 8, 9, 10, 11].forEach(x => p.push(px(x, 11, B.shade)));
  [6, 7, 8, 9, 10].forEach(x => p.push(px(x, 12, B.shade)));

  // Arms + legs
  restingArms(p);
  standingLegs(p);

  return buildShadow(p);
}

function danceFrame(shirt, frame, type) {
  const p = ballBody(shirt);
  const df = frame % 4;

  // Dance legs — side to side
  if (df === 0 || df === 2) {
    standingLegs(p);
  } else if (df === 1) {
    // Legs apart left
    p.push(px(5, 13, B.leg)); p.push(px(5, 14, B.leg)); p.push(px(5, 15, B.leg));
    p.push(px(4, 16, B.shoe)); p.push(px(5, 16, B.shoe));
    p.push(px(10, 13, B.leg)); p.push(px(10, 14, B.leg)); p.push(px(10, 15, B.leg));
    p.push(px(10, 16, B.shoe)); p.push(px(11, 16, B.shoe));
  } else {
    // Legs apart right
    p.push(px(7, 13, B.leg)); p.push(px(7, 14, B.leg)); p.push(px(7, 15, B.leg));
    p.push(px(7, 16, B.shoe)); p.push(px(8, 16, B.shoe));
    p.push(px(11, 13, B.leg)); p.push(px(11, 14, B.leg)); p.push(px(11, 15, B.leg));
    p.push(px(11, 16, B.shoe)); p.push(px(12, 16, B.shoe));
  }

  // Disco arms
  if (df % 2 === 0) {
    p.push(px(2, 5, B.arm)); p.push(px(1, 4, B.glove)); // left up
    p.push(px(13, 8, B.arm)); p.push(px(14, 9, B.glove)); // right down
  } else {
    p.push(px(3, 8, B.arm)); p.push(px(2, 9, B.glove)); // left down
    p.push(px(14, 5, B.arm)); p.push(px(15, 4, B.glove)); // right up
  }

  return buildShadow(p);
}

// === ANIMATION CONFIG ===
const ANIM_CONFIG = {
  walk: { frames: 4, speed: 200, fn: walkFrame },
  idle: { frames: 2, speed: 500, fn: idleFrame },
  wave: { frames: 3, speed: 300, fn: waveFrame },
  jump: { frames: 3, speed: 250, fn: jumpFrame },
  look: { frames: 2, speed: 400, fn: lookFrame },
  disco: { frames: 4, speed: 250, fn: (s, f) => danceFrame(s, f, 'disco') },
  spin: { frames: 4, speed: 200, fn: (s, f) => danceFrame(s, f, 'spin') },
  shuffle: { frames: 4, speed: 250, fn: (s, f) => danceFrame(s, f, 'shuffle') },
  headbang: { frames: 3, speed: 200, fn: (s, f) => danceFrame(s, f, 'headbang') },
  moonwalk: { frames: 4, speed: 250, fn: (s, f) => danceFrame(s, f, 'moonwalk') },
};

const DANCE_TYPES = ['disco', 'spin', 'shuffle', 'headbang', 'moonwalk'];

// === MAIN COMPONENT ===
export default function Morty() {
  const [state, setState] = useState('hidden'); // hidden, entering, speaking, walking, idle, dancing, dismissing, exiting
  const [posX, setPosX] = useState(0);
  const [facingRight, setFacingRight] = useState(true);
  const [animation, setAnimation] = useState('idle');
  const [animFrame, setAnimFrame] = useState(0);
  const [shirt, setShirt] = useState(() => SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]);
  const [saying, setSaying] = useState('');
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleOpacity, setBubbleOpacity] = useState(1);

  const stateRef = useRef(state);
  const posRef = useRef(posX);
  const moveIntervalRef = useRef(null);
  const animIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const idleTimeoutRef = useRef(null);
  const bubbleTimeoutRef = useRef(null);
  const targetXRef = useRef(null);

  // Sync refs
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { posRef.current = posX; }, [posX]);

  const getRandomSaying = useCallback(() => {
    return SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
  }, []);

  const getRandomInterval = useCallback(() => {
    return (12 + Math.random() * 6) * 60 * 1000;
  }, []);

  const clearAllTimers = useCallback(() => {
    if (moveIntervalRef.current) clearInterval(moveIntervalRef.current);
    if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    moveIntervalRef.current = null;
    animIntervalRef.current = null;
    timerRef.current = null;
    idleTimeoutRef.current = null;
    bubbleTimeoutRef.current = null;
  }, []);

  const showSpeechBubble = useCallback((text) => {
    setSaying(text);
    setShowBubble(true);
    setBubbleOpacity(1);
    if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => {
      setBubbleOpacity(0);
      setTimeout(() => setShowBubble(false), 400);
    }, 5000);
  }, []);

  const startAnimation = useCallback((type) => {
    setAnimation(type);
    setAnimFrame(0);
    if (animIntervalRef.current) clearInterval(animIntervalRef.current);
    const config = ANIM_CONFIG[type];
    animIntervalRef.current = setInterval(() => {
      setAnimFrame(f => (f + 1) % config.frames);
    }, config.speed);
  }, []);

  const startWalking = useCallback((targetX) => {
    targetXRef.current = targetX;
    const goingRight = targetX > posRef.current;
    setFacingRight(goingRight);
    startAnimation('walk');

    if (moveIntervalRef.current) clearInterval(moveIntervalRef.current);
    moveIntervalRef.current = setInterval(() => {
      const current = posRef.current;
      const target = targetXRef.current;
      const dir = target > current ? 1 : -1;
      const step = 2;
      const next = current + dir * step;

      if (Math.abs(next - target) < step) {
        setPosX(target);
        clearInterval(moveIntervalRef.current);
        moveIntervalRef.current = null;

        if (stateRef.current === 'exiting') {
          setState('hidden');
        } else if (stateRef.current === 'entering') {
          setState('speaking');
        } else {
          setState('idle');
        }
      } else {
        setPosX(next);
      }
    }, 30);
  }, [startAnimation]);

  const startWalkToRandom = useCallback(() => {
    const minX = 48;
    const maxX = window.innerWidth - 120;
    const target = minX + Math.random() * (maxX - minX);
    setState('walking');
    startWalking(target);
  }, [startWalking]);

  const startIdle = useCallback(() => {
    startAnimation('idle');
    const idleDuration = 3000 + Math.random() * 5000;

    idleTimeoutRef.current = setTimeout(() => {
      if (stateRef.current !== 'idle') return;

      const roll = Math.random();
      if (roll < 0.05) {
        const danceType = DANCE_TYPES[Math.floor(Math.random() * DANCE_TYPES.length)];
        setState('dancing');
        startAnimation(danceType);
        setTimeout(() => {
          if (stateRef.current === 'dancing') setState('idle');
        }, 3000 + Math.random() * 2000);
      } else if (roll < 0.20) {
        startAnimation('jump');
        setTimeout(() => {
          if (stateRef.current === 'idle') startWalkToRandom();
        }, 750);
      } else if (roll < 0.35) {
        startAnimation('look');
        setTimeout(() => {
          if (stateRef.current === 'idle') startWalkToRandom();
        }, 1600);
      } else if (roll < 0.45) {
        showSpeechBubble(getRandomSaying());
        setTimeout(() => {
          if (stateRef.current === 'idle') startWalkToRandom();
        }, 5500);
      } else {
        startWalkToRandom();
      }
    }, idleDuration);
  }, [startAnimation, showSpeechBubble, getRandomSaying, startWalkToRandom]);

  // Dismiss: show disappointed saying, then exit
  const dismissMorty = useCallback(() => {
    if (stateRef.current === 'hidden' || stateRef.current === 'dismissing' || stateRef.current === 'exiting') return;
    setState('dismissing');
    startAnimation('idle');
    const dismissSaying = DISMISS_SAYINGS[Math.floor(Math.random() * DISMISS_SAYINGS.length)];
    showSpeechBubble(dismissSaying);
    // After showing the disappointed message, walk off
    setTimeout(() => {
      if (stateRef.current === 'dismissing') {
        setShowBubble(false);
        setState('exiting');
      }
    }, 3000);
  }, [startAnimation, showSpeechBubble]);

  // State machine transitions
  useEffect(() => {
    if (state === 'hidden') {
      clearAllTimers();
      timerRef.current = setTimeout(() => {
        setShirt(SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]);
        setState('entering');
      }, getRandomInterval());
    } else if (state === 'entering') {
      const fromLeft = Math.random() > 0.5;
      const startPos = fromLeft ? -20 : window.innerWidth + 20;
      const targetPos = 100 + Math.random() * (window.innerWidth - 300);
      setPosX(startPos);
      setFacingRight(fromLeft);
      startWalking(targetPos);
    } else if (state === 'speaking') {
      startAnimation('wave');
      showSpeechBubble(getRandomSaying());
      idleTimeoutRef.current = setTimeout(() => {
        if (stateRef.current === 'speaking') {
          setState('walking');
          startWalkToRandom();
        }
      }, 5500);
    } else if (state === 'idle') {
      startIdle();
    } else if (state === 'exiting') {
      const leftDist = posRef.current;
      const rightDist = window.innerWidth - posRef.current;
      const exitTarget = leftDist < rightDist ? -80 : window.innerWidth + 80;
      startWalking(exitTarget);
    }

    return () => {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line
  }, [state]);

  // Hotkey: Escape to dismiss
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && stateRef.current !== 'hidden' && stateRef.current !== 'dismissing' && stateRef.current !== 'exiting') {
        dismissMorty();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissMorty]);

  // Listen for summon event
  useEffect(() => {
    function handleSummon() {
      if (stateRef.current === 'hidden') {
        clearAllTimers();
        setShirt(SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]);
        setState('entering');
      }
    }
    window.addEventListener('summon-morty', handleSummon);
    return () => window.removeEventListener('summon-morty', handleSummon);
  }, [clearAllTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearAllTimers();
  }, [clearAllTimers]);

  // Get current sprite
  const config = ANIM_CONFIG[animation] || ANIM_CONFIG.idle;
  const spriteShadow = config.fn(shirt, animFrame);

  if (state === 'hidden') return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: S * SPRITE_H,
        left: posX,
        zIndex: 900,
        cursor: 'default',
        transition: 'none',
        transform: facingRight ? 'none' : 'scaleX(-1)',
      }}
    >
      {/* Speech Bubble */}
      {showBubble && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          left: facingRight ? S * 8 : 'auto',
          right: facingRight ? 'auto' : S * 8,
          transform: facingRight ? 'none' : 'scaleX(-1)',
          background: '#ffffff',
          color: '#1a1a2e',
          padding: '8px 12px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
          maxWidth: '200px',
          whiteSpace: 'normal',
          lineHeight: 1.3,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          opacity: bubbleOpacity,
          transition: 'opacity 0.4s ease',
          pointerEvents: 'none',
        }}>
          {saying}
          {/* Tail triangle */}
          <div style={{
            position: 'absolute',
            bottom: '-6px',
            left: '16px',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '8px solid #ffffff',
          }} />
        </div>
      )}

      {/* Pixel Art Sprite */}
      <div style={{
        width: `${S}px`,
        height: `${S}px`,
        overflow: 'visible',
        boxShadow: spriteShadow,
        background: 'transparent',
      }} />
    </div>
  );
}
