/**
 * Pitch-class and chord primitives.
 *
 * Everything downstream (chord decoding, capo search, fretboard mapping,
 * exporters) speaks in these terms, so keep it dependency-free and pure.
 */

export type PitchClass = number; // 0..11, 0 = C

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Keys that guitarists normally read with flats. */
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]); // Db, Eb, F, Ab, Bb

export function pitchClassName(pc: PitchClass, preferFlats = false): string {
  const i = ((pc % 12) + 12) % 12;
  return preferFlats ? FLAT_NAMES[i] : SHARP_NAMES[i];
}

export function parsePitchClass(name: string): PitchClass | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name.trim());
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

export function shouldPreferFlats(tonic: PitchClass, mode: KeyMode): boolean {
  // Relative-major tonic decides the spelling convention.
  const major = mode === 'minor' ? (tonic + 3) % 12 : tonic;
  return FLAT_KEYS.has(major);
}

// ---------------------------------------------------------------------------
// Chord qualities
// ---------------------------------------------------------------------------

export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | '7'
  | 'maj7'
  | 'min7'
  | 'dim7'
  | 'm7b5'
  | 'sus2'
  | 'sus4'
  | 'add9'
  | '6'
  | 'min6'
  | '5';

/** Intervals above the root, in semitones. */
export const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 2, 4, 7],
  '6': [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  '5': [0, 7],
};

/** Suffix as written on a chart. */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  '7': '7',
  maj7: 'maj7',
  min7: 'm7',
  dim7: 'dim7',
  m7b5: 'm7b5',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'add9',
  '6': '6',
  min6: 'm6',
  '5': '5',
};

/**
 * The plain triad a richer quality collapses to. Used by the "simple triad by
 * default, richer chord as a toggle" rule.
 */
export const TRIAD_REDUCTION: Record<ChordQuality, ChordQuality> = {
  maj: 'maj',
  min: 'min',
  dim: 'dim',
  aug: 'maj',
  '7': 'maj',
  maj7: 'maj',
  min7: 'min',
  dim7: 'dim',
  m7b5: 'min',
  sus2: 'maj',
  sus4: 'maj',
  add9: 'maj',
  '6': 'maj',
  min6: 'min',
  '5': 'maj',
};

export interface Chord {
  root: PitchClass;
  quality: ChordQuality;
  /** Slash-chord bass note, when it differs from the root. */
  bass?: PitchClass;
}

export function chordName(chord: Chord, preferFlats = false): string {
  const base = pitchClassName(chord.root, preferFlats) + QUALITY_SUFFIX[chord.quality];
  if (chord.bass !== undefined && chord.bass !== chord.root) {
    return `${base}/${pitchClassName(chord.bass, preferFlats)}`;
  }
  return base;
}

export function chordPitchClasses(chord: Chord): PitchClass[] {
  const pcs = QUALITY_INTERVALS[chord.quality].map((i) => (chord.root + i) % 12);
  if (chord.bass !== undefined && !pcs.includes(chord.bass)) pcs.push(chord.bass);
  return pcs;
}

export function chordsEqual(a: Chord | null, b: Chord | null): boolean {
  if (!a || !b) return a === b;
  return a.root === b.root && a.quality === b.quality && (a.bass ?? a.root) === (b.bass ?? b.root);
}

export function transposeChord(chord: Chord, semitones: number): Chord {
  const wrap = (p: number) => ((p + semitones) % 12 + 12) % 12;
  return {
    root: wrap(chord.root),
    quality: chord.quality,
    bass: chord.bass === undefined ? undefined : wrap(chord.bass),
  };
}

export function simplifyToTriad(chord: Chord): Chord {
  return { root: chord.root, quality: TRIAD_REDUCTION[chord.quality] };
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type KeyMode = 'major' | 'minor';

export interface MusicalKey {
  tonic: PitchClass;
  mode: KeyMode;
}

export function keyName(key: MusicalKey): string {
  const flats = shouldPreferFlats(key.tonic, key.mode);
  return `${pitchClassName(key.tonic, flats)} ${key.mode}`;
}

/** Krumhansl-Kessler key profiles, used for key estimation from a chroma average. */
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function scalePitchClasses(key: MusicalKey): PitchClass[] {
  const scale = key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE;
  return scale.map((i) => (key.tonic + i) % 12);
}

/** Roman-numeral label for a chord inside a key; '' when it is not diatonic. */
export function romanNumeral(chord: Chord, key: MusicalKey): string {
  const scale = scalePitchClasses(key);
  const degree = scale.indexOf(chord.root);
  if (degree < 0) return '';
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const n = numerals[degree];
  const triad = TRIAD_REDUCTION[chord.quality];
  if (triad === 'min') return n.toLowerCase();
  if (triad === 'dim') return `${n.toLowerCase()}°`;
  return n;
}

// ---------------------------------------------------------------------------
// MIDI helpers
// ---------------------------------------------------------------------------

export function midiToName(midi: number, preferFlats = false): string {
  return `${pitchClassName(midi % 12, preferFlats)}${Math.floor(midi / 12) - 1}`;
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
