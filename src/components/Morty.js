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
// Each frame is a function that returns box-shadow CSS for a 1px element at 3x scale
// Sprite is ~24x32 pixels

const S = 3; // scale factor

function px(x, y, color) {
  return `${x * S}px ${y * S}px 0 0 ${color}`;
}

function buildShadow(pixels) {
  return pixels.join(', ');
}

// Colors
const C = {
  body: '#2d8a4e',
  dark: '#1d6b3a',
  light: '#3aaf62',
  belly: '#8fd4a0',
  eye: '#ffffff',
  pupil: '#1a1a2e',
  teeth: '#ffffff',
  mouth: '#1a1a2e',
  spike: '#1d6b3a',
  claw: '#f5e6c8',
};

function baseBody(shirt, frame) {
  const pixels = [];
  // === HEAD (rows 0-8) ===
  // Top of head
  [9,10,11,12,13,14].forEach(x => pixels.push(px(x, 0, C.body)));
  [8,9,10,11,12,13,14,15].forEach(x => pixels.push(px(x, 1, C.body)));
  // Eyes row
  [7,8].forEach(x => pixels.push(px(x, 2, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 2, C.eye)));
  [11].forEach(x => pixels.push(px(x, 2, C.body)));
  [12,13].forEach(x => pixels.push(px(x, 2, C.eye)));
  [14,15,16].forEach(x => pixels.push(px(x, 2, C.body)));
  // Pupils
  [7].forEach(x => pixels.push(px(x, 3, C.body)));
  pixels.push(px(9, 3, C.eye)); pixels.push(px(10, 3, C.pupil));
  pixels.push(px(11, 3, C.body));
  pixels.push(px(12, 3, C.eye)); pixels.push(px(13, 3, C.pupil));
  [14,15,16].forEach(x => pixels.push(px(x, 3, C.body)));
  pixels.push(px(8, 3, C.body));
  // Snout
  [7,8,9,10,11,12,13,14,15,16].forEach(x => pixels.push(px(x, 4, C.body)));
  // Mouth with teeth
  [7,8].forEach(x => pixels.push(px(x, 5, C.body)));
  pixels.push(px(9, 5, C.mouth));
  [10,12,14].forEach(x => pixels.push(px(x, 5, C.teeth)));
  [11,13].forEach(x => pixels.push(px(x, 5, C.mouth)));
  pixels.push(px(15, 5, C.mouth));
  pixels.push(px(16, 5, C.body));
  // Jaw
  [8,9,10,11,12,13,14,15].forEach(x => pixels.push(px(x, 6, C.body)));
  // Neck
  [9,10,11,12,13,14].forEach(x => pixels.push(px(x, 7, C.body)));

  // === BACK SPIKES ===
  pixels.push(px(8, 0, C.spike));
  pixels.push(px(7, 1, C.spike));
  pixels.push(px(6, 7, C.spike));
  pixels.push(px(7, 6, C.spike));
  pixels.push(px(6, 8, C.spike));

  // === BODY + SHIRT (rows 8-18) ===
  // Shirt area
  for (let y = 8; y <= 16; y++) {
    const rowWidth = y <= 10 ? [8,9,10,11,12,13,14,15] :
                     y <= 13 ? [7,8,9,10,11,12,13,14,15,16] :
                     y <= 15 ? [8,9,10,11,12,13,14,15,16] :
                     [9,10,11,12,13,14,15];
    rowWidth.forEach(x => {
      // "MM" letters on shirt (rows 10-14, centered)
      if (y >= 10 && y <= 14 && x >= 9 && x <= 15) {
        // M pattern
        if (y === 10 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 11 && (x === 9 || x === 10 || x === 11 || x === 12 || x === 13 || x === 14 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 12 && (x === 9 || x === 11 || x === 12 || x === 13 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 13 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 14 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else pixels.push(px(x, y, shirt.base));
      } else {
        pixels.push(px(x, y, shirt.base));
      }
    });
    // Light edge on shirt
    if (y >= 8 && y <= 15) {
      const edgeX = y <= 10 ? 15 : y <= 13 ? 16 : y <= 15 ? 16 : 15;
      pixels.push(px(edgeX, y, shirt.light));
    }
  }

  // Belly area
  for (let y = 17; y <= 19; y++) {
    [9,10,11,12,13,14].forEach(x => pixels.push(px(x, y, C.belly)));
    [8,15].forEach(x => pixels.push(px(x, y, C.body)));
  }

  // === LEGS (rows 20-25) ===
  // Upper legs
  [9,10,11].forEach(x => pixels.push(px(x, 20, C.body)));
  [13,14,15].forEach(x => pixels.push(px(x, 20, C.body)));
  [12].forEach(x => pixels.push(px(x, 20, C.belly)));

  return pixels;
}

function walkFrame(shirt, frame) {
  const pixels = baseBody(shirt, frame);
  const legFrame = frame % 4;

  if (legFrame === 0) {
    // Both feet on ground
    [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
    [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
    [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));
  } else if (legFrame === 1) {
    // Left forward, right back
    [8,9,10].forEach(x => pixels.push(px(x, 21, C.body)));
    [14,15,16].forEach(x => pixels.push(px(x, 21, C.body)));
    [7,8,9].forEach(x => pixels.push(px(x, 22, C.body)));
    [15,16].forEach(x => pixels.push(px(x, 22, C.body)));
    [7,8].forEach(x => pixels.push(px(x, 23, C.claw)));
    [15,16].forEach(x => pixels.push(px(x, 23, C.claw)));
  } else if (legFrame === 2) {
    // Both feet on ground (passing)
    [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
    [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
    [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));
  } else {
    // Right forward, left back
    [10,11,12].forEach(x => pixels.push(px(x, 21, C.body)));
    [12,13,14].forEach(x => pixels.push(px(x, 21, C.body)));
    [10,11].forEach(x => pixels.push(px(x, 22, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 22, C.body)));
    [10,11].forEach(x => pixels.push(px(x, 23, C.claw)));
    [15,16].forEach(x => pixels.push(px(x, 23, C.claw)));
  }

  // Arms (small T-rex arms)
  if (legFrame % 2 === 0) {
    [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
    pixels.push(px(5, 11, C.claw));
    pixels.push(px(6, 11, C.body));
  } else {
    [6,7].forEach(x => pixels.push(px(x, 9, C.body)));
    pixels.push(px(5, 10, C.claw));
    pixels.push(px(6, 10, C.body));
  }

  // Tail
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x, 19, C.body)));
  pixels.push(px(2, 20, C.body));
  pixels.push(px(1, 21, C.body));

  return buildShadow(pixels);
}

function idleFrame(shirt, frame) {
  const pixels = baseBody(shirt, frame);
  const breathe = frame % 2;

  // Legs standing
  [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
  [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
  [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
  [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));

  // Arms
  if (breathe === 0) {
    [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
    pixels.push(px(5, 11, C.claw));
    pixels.push(px(6, 11, C.body));
  } else {
    [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
    pixels.push(px(5, 11, C.claw));
    pixels.push(px(6, 11, C.body));
  }

  // Tail
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x, 19, C.body)));
  pixels.push(px(2, 20, C.body));
  pixels.push(px(breathe === 0 ? 1 : 2, 21, C.body));

  return buildShadow(pixels);
}

function waveFrame(shirt, frame) {
  const pixels = baseBody(shirt, frame);
  const wf = frame % 3;

  // Legs standing
  [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
  [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
  [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
  [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));

  // Waving arm (right side raised)
  if (wf === 0) {
    [16,17].forEach(x => pixels.push(px(x, 8, C.body)));
    pixels.push(px(18, 7, C.claw));
    pixels.push(px(17, 8, C.body));
  } else if (wf === 1) {
    [16,17].forEach(x => pixels.push(px(x, 7, C.body)));
    pixels.push(px(18, 6, C.claw));
    pixels.push(px(17, 7, C.body));
  } else {
    [16,17].forEach(x => pixels.push(px(x, 8, C.body)));
    pixels.push(px(18, 8, C.claw));
    pixels.push(px(17, 9, C.body));
  }

  // Left arm normal
  [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
  pixels.push(px(5, 11, C.claw));
  pixels.push(px(6, 11, C.body));

  // Tail
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x, 19, C.body)));
  pixels.push(px(2, 20, C.body));
  pixels.push(px(1, 21, C.body));

  return buildShadow(pixels);
}

function jumpFrame(shirt, frame) {
  const pixels = baseBody(shirt, frame);
  const jf = frame % 3;
  const yOff = jf === 1 ? -3 : jf === 2 ? -1 : 0;

  // Legs (tucked when jumping)
  if (jf === 1) {
    [9,10,11].forEach(x => pixels.push(px(x, 21 + yOff, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 21 + yOff, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 22 + yOff, C.claw)));
    [14,15].forEach(x => pixels.push(px(x, 22 + yOff, C.claw)));
  } else {
    [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
    [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
    [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));
  }

  // Arms up when jumping
  [6,7].forEach(x => pixels.push(px(x, 9 + (jf === 1 ? -2 : 0), C.body)));
  pixels.push(px(5, 8 + (jf === 1 ? -2 : 0), C.claw));

  // Tail
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x, 19, C.body)));
  pixels.push(px(2, 20, C.body));
  pixels.push(px(1, 21, C.body));

  return buildShadow(pixels);
}

function lookFrame(shirt, frame) {
  const pixels = [];
  const lf = frame % 2;

  // Build head with different pupil positions
  [9,10,11,12,13,14].forEach(x => pixels.push(px(x, 0, C.body)));
  [8,9,10,11,12,13,14,15].forEach(x => pixels.push(px(x, 1, C.body)));
  // Eyes with shifting pupils
  [7,8].forEach(x => pixels.push(px(x, 2, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 2, C.eye)));
  [11].forEach(x => pixels.push(px(x, 2, C.body)));
  [12,13].forEach(x => pixels.push(px(x, 2, C.eye)));
  [14,15,16].forEach(x => pixels.push(px(x, 2, C.body)));

  [7,8].forEach(x => pixels.push(px(x, 3, C.body)));
  if (lf === 0) {
    pixels.push(px(9, 3, C.pupil)); pixels.push(px(10, 3, C.eye));
    pixels.push(px(11, 3, C.body));
    pixels.push(px(12, 3, C.pupil)); pixels.push(px(13, 3, C.eye));
  } else {
    pixels.push(px(9, 3, C.eye)); pixels.push(px(10, 3, C.pupil));
    pixels.push(px(11, 3, C.body));
    pixels.push(px(12, 3, C.eye)); pixels.push(px(13, 3, C.pupil));
  }
  [14,15,16].forEach(x => pixels.push(px(x, 3, C.body)));

  // Rest of head
  [7,8,9,10,11,12,13,14,15,16].forEach(x => pixels.push(px(x, 4, C.body)));
  [7,8].forEach(x => pixels.push(px(x, 5, C.body)));
  pixels.push(px(9, 5, C.mouth));
  [10,12,14].forEach(x => pixels.push(px(x, 5, C.teeth)));
  [11,13].forEach(x => pixels.push(px(x, 5, C.mouth)));
  pixels.push(px(15, 5, C.mouth));
  pixels.push(px(16, 5, C.body));
  [8,9,10,11,12,13,14,15].forEach(x => pixels.push(px(x, 6, C.body)));
  [9,10,11,12,13,14].forEach(x => pixels.push(px(x, 7, C.body)));

  // Spikes
  pixels.push(px(8, 0, C.spike));
  pixels.push(px(7, 1, C.spike));
  pixels.push(px(6, 7, C.spike));
  pixels.push(px(7, 6, C.spike));
  pixels.push(px(6, 8, C.spike));

  // Shirt + body
  for (let y = 8; y <= 16; y++) {
    const rowWidth = y <= 10 ? [8,9,10,11,12,13,14,15] :
                     y <= 13 ? [7,8,9,10,11,12,13,14,15,16] :
                     y <= 15 ? [8,9,10,11,12,13,14,15,16] :
                     [9,10,11,12,13,14,15];
    rowWidth.forEach(x => {
      if (y >= 10 && y <= 14 && x >= 9 && x <= 15) {
        if (y === 10 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 11 && (x === 9 || x === 10 || x === 11 || x === 12 || x === 13 || x === 14 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 12 && (x === 9 || x === 11 || x === 12 || x === 13 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 13 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else if (y === 14 && (x === 9 || x === 12 || x === 15)) pixels.push(px(x, y, shirt.letter));
        else pixels.push(px(x, y, shirt.base));
      } else {
        pixels.push(px(x, y, shirt.base));
      }
    });
    if (y >= 8 && y <= 15) {
      const edgeX = y <= 10 ? 15 : 16;
      pixels.push(px(edgeX, y, shirt.light));
    }
  }

  // Belly
  for (let y = 17; y <= 19; y++) {
    [9,10,11,12,13,14].forEach(x => pixels.push(px(x, y, C.belly)));
    [8,15].forEach(x => pixels.push(px(x, y, C.body)));
  }
  [9,10,11].forEach(x => pixels.push(px(x, 20, C.body)));
  [13,14,15].forEach(x => pixels.push(px(x, 20, C.body)));
  [12].forEach(x => pixels.push(px(x, 20, C.belly)));

  // Legs
  [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
  [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
  [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
  [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
  [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));

  // Arms
  [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
  pixels.push(px(5, 11, C.claw));
  pixels.push(px(6, 11, C.body));

  // Tail
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x, 19, C.body)));
  pixels.push(px(2, 20, C.body));
  pixels.push(px(1, 21, C.body));

  return buildShadow(pixels);
}

function danceFrame(shirt, frame, type) {
  const pixels = baseBody(shirt, frame);
  const df = frame % 4;

  // All dances share base legs with variations
  if (type === 'disco') {
    // Arms alternate up/down disco style
    if (df === 0) {
      pixels.push(px(17, 7, C.body)); pixels.push(px(18, 6, C.claw));
      [6,7].forEach(x => pixels.push(px(x, 12, C.body)));
      pixels.push(px(5, 13, C.claw));
    } else if (df === 1) {
      [6,7].forEach(x => pixels.push(px(x, 8, C.body)));
      pixels.push(px(5, 7, C.claw));
      pixels.push(px(17, 12, C.body)); pixels.push(px(18, 13, C.claw));
    } else if (df === 2) {
      pixels.push(px(17, 7, C.body)); pixels.push(px(18, 6, C.claw));
      pixels.push(px(5, 7, C.claw)); [6,7].forEach(x => pixels.push(px(x, 8, C.body)));
    } else {
      [6,7].forEach(x => pixels.push(px(x, 12, C.body)));
      pixels.push(px(5, 13, C.claw));
      pixels.push(px(17, 12, C.body)); pixels.push(px(18, 13, C.claw));
    }
  } else if (type === 'headbang') {
    const hf = frame % 3;
    // Arms normal
    [6,7].forEach(x => pixels.push(px(x, 10, C.body)));
    pixels.push(px(5, 11, C.claw));
    pixels.push(px(6, 11, C.body));
    // Head bob is simulated by body being in base already
    if (hf === 1) {
      // Extra emphasis pixels near head
      pixels.push(px(10, 0, C.light));
      pixels.push(px(13, 0, C.light));
    }
  } else {
    // Default dance arms
    if (df % 2 === 0) {
      [6,7].forEach(x => pixels.push(px(x, 9, C.body)));
      pixels.push(px(5, 8, C.claw));
    } else {
      [6,7].forEach(x => pixels.push(px(x, 11, C.body)));
      pixels.push(px(5, 12, C.claw));
    }
  }

  // Legs with dance movement
  if (df === 0 || df === 2) {
    [9,10,11].forEach(x => pixels.push(px(x, 21, C.body)));
    [13,14,15].forEach(x => pixels.push(px(x, 21, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 22, C.body)));
    [14,15].forEach(x => pixels.push(px(x, 22, C.body)));
    [9,10].forEach(x => pixels.push(px(x, 23, C.claw)));
    [14,15].forEach(x => pixels.push(px(x, 23, C.claw)));
  } else {
    [8,9,10].forEach(x => pixels.push(px(x, 21, C.body)));
    [14,15,16].forEach(x => pixels.push(px(x, 21, C.body)));
    [8,9].forEach(x => pixels.push(px(x, 22, C.body)));
    [15,16].forEach(x => pixels.push(px(x, 22, C.body)));
    [8,9].forEach(x => pixels.push(px(x, 23, C.claw)));
    [15,16].forEach(x => pixels.push(px(x, 23, C.claw)));
  }

  // Tail
  const tailWag = df % 2 === 0 ? 0 : 1;
  [6,7,8].forEach(x => pixels.push(px(x, 17, C.body)));
  [4,5,6].forEach(x => pixels.push(px(x, 18, C.body)));
  [3,4].forEach(x => pixels.push(px(x + tailWag, 19, C.body)));
  pixels.push(px(2 + tailWag, 20, C.body));
  pixels.push(px(1 + tailWag, 21, C.body));

  return buildShadow(pixels);
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
  const [state, setState] = useState('hidden'); // hidden, entering, speaking, walking, idle, dancing, exiting
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
  const facingRef = useRef(facingRight);
  const moveIntervalRef = useRef(null);
  const animIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const idleTimeoutRef = useRef(null);
  const bubbleTimeoutRef = useRef(null);
  const targetXRef = useRef(null);

  // Sync refs
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { posRef.current = posX; }, [posX]);
  useEffect(() => { facingRef.current = facingRight; }, [facingRight]);

  const getRandomSaying = useCallback(() => {
    return SAYINGS[Math.floor(Math.random() * SAYINGS.length)];
  }, []);

  const getRandomInterval = useCallback(() => {
    // 12-18 minutes in ms
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

  const startIdle = useCallback(() => {
    startAnimation('idle');
    const idleDuration = 3000 + Math.random() * 5000;

    idleTimeoutRef.current = setTimeout(() => {
      if (stateRef.current !== 'idle') return;

      const roll = Math.random();
      if (roll < 0.05) {
        // 5% chance: dance
        const danceType = DANCE_TYPES[Math.floor(Math.random() * DANCE_TYPES.length)];
        setState('dancing');
        startAnimation(danceType);
        setTimeout(() => {
          if (stateRef.current === 'dancing') {
            setState('idle');
          }
        }, 3000 + Math.random() * 2000);
      } else if (roll < 0.20) {
        // 15% chance: jump
        startAnimation('jump');
        setTimeout(() => {
          if (stateRef.current === 'idle') {
            startWalkToRandom();
          }
        }, 750);
      } else if (roll < 0.35) {
        // 15% chance: look around
        startAnimation('look');
        setTimeout(() => {
          if (stateRef.current === 'idle') {
            startWalkToRandom();
          }
        }, 1600);
      } else if (roll < 0.45) {
        // 10% chance: speak
        showSpeechBubble(getRandomSaying());
        setTimeout(() => {
          if (stateRef.current === 'idle') {
            startWalkToRandom();
          }
        }, 5500);
      } else {
        // Walk to new position
        startWalkToRandom();
      }
    }, idleDuration);
  }, [startAnimation, showSpeechBubble, getRandomSaying]);

  const startWalkToRandom = useCallback(() => {
    const minX = 48;
    const maxX = window.innerWidth - 120;
    const target = minX + Math.random() * (maxX - minX);
    setState('walking');
    startWalking(target);
  }, [startWalking]);

  // State machine transitions
  useEffect(() => {
    if (state === 'hidden') {
      clearAllTimers();
      // Set respawn timer
      timerRef.current = setTimeout(() => {
        // Pick new shirt
        setShirt(SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]);
        setState('entering');
      }, getRandomInterval());
    } else if (state === 'entering') {
      // Enter from random edge
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
      // Walk to nearest edge
      const leftDist = posRef.current;
      const rightDist = window.innerWidth - posRef.current;
      const exitTarget = leftDist < rightDist ? -80 : window.innerWidth + 80;
      startWalking(exitTarget);
    } else if (state === 'dancing') {
      // Dancing handled inline
    }

    return () => {
      // Cleanup idle timeout on state change
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
    };
  // eslint-disable-next-line
  }, [state]);

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

  // Handle double-click to dismiss
  const handleDoubleClick = useCallback(() => {
    if (state !== 'hidden') {
      setShowBubble(false);
      setState('exiting');
    }
  }, [state]);

  // Get current sprite
  const config = ANIM_CONFIG[animation] || ANIM_CONFIG.idle;
  const spriteShadow = config.fn(shirt, animFrame);

  if (state === 'hidden') return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: S * 24,
        left: posX,
        zIndex: 900,
        cursor: 'pointer',
        transition: 'none',
        transform: facingRight ? 'none' : 'scaleX(-1)',
      }}
      onDoubleClick={handleDoubleClick}
      title="Double-click to dismiss Morty"
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
