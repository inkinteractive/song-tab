/**
 * Guitar voicings.
 *
 * Two sources: a hand-written table of the open shapes a beginner actually
 * plays, and movable (barre / power / dim) templates that get transposed. The
 * simplifier asks for candidates and picks the easiest one that fits.
 */

import {
  type Chord,
  type ChordQuality,
  type PitchClass,
  TRIAD_REDUCTION,
  chordName,
} from './theory';

/** Fret per string, low E first. `null` = muted, `0` = open. */
export type FretArray = (number | null)[];

export type ShapeKind = 'open' | 'easy' | 'barre' | 'power' | 'movable';

export interface ChordShape {
  /** Stable id so edits can pin a voicing. */
  id: string;
  label: string;
  chord: Chord;
  frets: FretArray;
  fingers: (number | null)[];
  /** Lowest fret drawn on the diagram (1 for shapes in open position). */
  baseFret: number;
  barre?: { fret: number; fromString: number; toString: number; finger: number };
  kind: ShapeKind;
  /** 1 (open chord) .. 9 (nasty stretch). Lower wins during simplification. */
  difficulty: number;
}

const OPEN_STRING_PCS: PitchClass[] = [4, 9, 2, 7, 11, 4]; // E A D G B e

interface OpenShapeDef {
  root: PitchClass;
  quality: ChordQuality;
  frets: FretArray;
  fingers: (number | null)[];
  difficulty: number;
  kind: ShapeKind;
  note?: string;
}

// prettier-ignore
const OPEN_SHAPES: OpenShapeDef[] = [
  // E family (root 4)
  { root: 4, quality: 'maj',  frets: [0,2,2,1,0,0], fingers: [null,2,3,1,null,null], difficulty: 1, kind: 'open' },
  { root: 4, quality: 'min',  frets: [0,2,2,0,0,0], fingers: [null,2,3,null,null,null], difficulty: 1, kind: 'open' },
  { root: 4, quality: '7',    frets: [0,2,0,1,0,0], fingers: [null,2,null,1,null,null], difficulty: 1, kind: 'open' },
  { root: 4, quality: 'min7', frets: [0,2,0,0,0,0], fingers: [null,2,null,null,null,null], difficulty: 1, kind: 'open' },
  { root: 4, quality: 'maj7', frets: [0,2,1,1,0,0], fingers: [null,3,1,2,null,null], difficulty: 2, kind: 'open' },
  { root: 4, quality: 'sus4', frets: [0,2,2,2,0,0], fingers: [null,1,2,3,null,null], difficulty: 2, kind: 'open' },
  { root: 4, quality: 'add9', frets: [0,2,2,1,0,2], fingers: [null,2,3,1,null,4], difficulty: 3, kind: 'open' },
  { root: 4, quality: '6',    frets: [0,2,2,1,2,0], fingers: [null,2,3,1,4,null], difficulty: 3, kind: 'open' },
  { root: 4, quality: 'min6', frets: [0,2,2,0,2,0], fingers: [null,2,3,null,4,null], difficulty: 3, kind: 'open' },

  // A family (root 9)
  { root: 9, quality: 'maj',  frets: [null,0,2,2,2,0], fingers: [null,null,1,2,3,null], difficulty: 1, kind: 'open' },
  { root: 9, quality: 'min',  frets: [null,0,2,2,1,0], fingers: [null,null,2,3,1,null], difficulty: 1, kind: 'open' },
  { root: 9, quality: '7',    frets: [null,0,2,0,2,0], fingers: [null,null,2,null,3,null], difficulty: 1, kind: 'open' },
  { root: 9, quality: 'min7', frets: [null,0,2,0,1,0], fingers: [null,null,2,null,1,null], difficulty: 1, kind: 'open' },
  { root: 9, quality: 'maj7', frets: [null,0,2,1,2,0], fingers: [null,null,3,1,2,null], difficulty: 2, kind: 'open' },
  { root: 9, quality: 'sus2', frets: [null,0,2,2,0,0], fingers: [null,null,1,2,null,null], difficulty: 1, kind: 'open' },
  { root: 9, quality: 'sus4', frets: [null,0,2,2,3,0], fingers: [null,null,1,2,3,null], difficulty: 2, kind: 'open' },
  { root: 9, quality: 'add9', frets: [null,0,2,4,2,0], fingers: [null,null,1,4,2,null], difficulty: 4, kind: 'open' },
  { root: 9, quality: '6',    frets: [null,0,2,2,2,2], fingers: [null,null,1,1,1,1], difficulty: 3, kind: 'open' },
  { root: 9, quality: 'min6', frets: [null,0,2,2,1,2], fingers: [null,null,2,3,1,4], difficulty: 4, kind: 'open' },
  { root: 9, quality: 'm7b5', frets: [null,0,1,0,1,null], fingers: [null,null,1,null,2,null], difficulty: 3, kind: 'open' },

  // D family (root 2)
  { root: 2, quality: 'maj',  frets: [null,null,0,2,3,2], fingers: [null,null,null,1,3,2], difficulty: 1, kind: 'open' },
  { root: 2, quality: 'min',  frets: [null,null,0,2,3,1], fingers: [null,null,null,2,3,1], difficulty: 2, kind: 'open' },
  { root: 2, quality: '7',    frets: [null,null,0,2,1,2], fingers: [null,null,null,2,1,3], difficulty: 2, kind: 'open' },
  { root: 2, quality: 'min7', frets: [null,null,0,2,1,1], fingers: [null,null,null,2,1,1], difficulty: 2, kind: 'open' },
  { root: 2, quality: 'maj7', frets: [null,null,0,2,2,2], fingers: [null,null,null,1,1,1], difficulty: 2, kind: 'open' },
  { root: 2, quality: 'sus2', frets: [null,null,0,2,3,0], fingers: [null,null,null,1,2,null], difficulty: 1, kind: 'open' },
  { root: 2, quality: 'sus4', frets: [null,null,0,2,3,3], fingers: [null,null,null,1,2,3], difficulty: 2, kind: 'open' },
  { root: 2, quality: '6',    frets: [null,null,0,2,0,2], fingers: [null,null,null,2,null,3], difficulty: 2, kind: 'open' },

  // C family (root 0)
  { root: 0, quality: 'maj',  frets: [null,3,2,0,1,0], fingers: [null,3,2,null,1,null], difficulty: 2, kind: 'open' },
  { root: 0, quality: 'maj7', frets: [null,3,2,0,0,0], fingers: [null,3,2,null,null,null], difficulty: 1, kind: 'open' },
  { root: 0, quality: '7',    frets: [null,3,2,3,1,0], fingers: [null,3,2,4,1,null], difficulty: 3, kind: 'open' },
  { root: 0, quality: 'add9', frets: [null,3,2,0,3,0], fingers: [null,2,1,null,3,null], difficulty: 2, kind: 'open' },
  { root: 0, quality: '6',    frets: [null,3,2,2,1,0], fingers: [null,4,2,3,1,null], difficulty: 3, kind: 'open' },

  // G family (root 7)
  { root: 7, quality: 'maj',  frets: [3,2,0,0,0,3], fingers: [2,1,null,null,null,3], difficulty: 2, kind: 'open' },
  { root: 7, quality: '7',    frets: [3,2,0,0,0,1], fingers: [3,2,null,null,null,1], difficulty: 2, kind: 'open' },
  { root: 7, quality: 'maj7', frets: [3,2,0,0,0,2], fingers: [3,2,null,null,null,1], difficulty: 2, kind: 'open' },
  { root: 7, quality: 'sus4', frets: [3,3,0,0,1,3], fingers: [2,3,null,null,1,4], difficulty: 4, kind: 'open' },

  // Beginner-friendly partials that dodge a barre
  { root: 5, quality: 'maj7', frets: [null,null,3,2,1,0], fingers: [null,null,3,2,1,null], difficulty: 2, kind: 'easy', note: 'Fmaj7 - the usual stand-in for a full F barre' },
  { root: 5, quality: 'maj',  frets: [null,null,3,2,1,1], fingers: [null,null,3,2,1,1], difficulty: 4, kind: 'easy', note: 'Four-string F, no full barre' },
  { root: 11, quality: '7',   frets: [null,2,1,2,0,2], fingers: [null,2,1,3,null,4], difficulty: 3, kind: 'open' },
  { root: 11, quality: 'min7',frets: [null,2,0,2,0,2], fingers: [null,2,null,3,null,4], difficulty: 3, kind: 'open' },
];

interface MovableTemplate {
  /** Which open string the root sits on (0 = low E, 1 = A, 3 = D). */
  rootString: number;
  quality: ChordQuality;
  /** Offsets from the barre fret; `null` = muted string. */
  offsets: (number | null)[];
  fingers: (number | null)[];
  barreStrings?: [number, number];
  difficulty: number;
  kind: ShapeKind;
}

// prettier-ignore
const MOVABLE: MovableTemplate[] = [
  // E-shape barres, root on the 6th string
  { rootString: 0, quality: 'maj',  offsets: [0,2,2,1,0,0], fingers: [1,3,4,2,1,1], barreStrings: [0,5], difficulty: 6, kind: 'barre' },
  { rootString: 0, quality: 'min',  offsets: [0,2,2,0,0,0], fingers: [1,3,4,1,1,1], barreStrings: [0,5], difficulty: 6, kind: 'barre' },
  { rootString: 0, quality: '7',    offsets: [0,2,0,1,0,0], fingers: [1,3,1,2,1,1], barreStrings: [0,5], difficulty: 6, kind: 'barre' },
  { rootString: 0, quality: 'min7', offsets: [0,2,0,0,0,0], fingers: [1,3,1,1,1,1], barreStrings: [0,5], difficulty: 6, kind: 'barre' },
  { rootString: 0, quality: 'maj7', offsets: [0,2,1,1,0,0], fingers: [1,4,2,3,1,1], barreStrings: [0,5], difficulty: 7, kind: 'barre' },
  { rootString: 0, quality: 'sus4', offsets: [0,2,2,2,0,0], fingers: [1,2,3,4,1,1], barreStrings: [0,5], difficulty: 7, kind: 'barre' },
  { rootString: 0, quality: 'sus2', offsets: [0,2,4,4,0,0], fingers: [1,2,3,4,1,1], barreStrings: [0,5], difficulty: 8, kind: 'barre' },
  { rootString: 0, quality: '6',    offsets: [0,2,2,1,2,0], fingers: [1,3,4,2,1,1], barreStrings: [0,5], difficulty: 7, kind: 'barre' },
  { rootString: 0, quality: 'min6', offsets: [0,2,2,0,2,0], fingers: [1,3,4,1,2,1], barreStrings: [0,5], difficulty: 7, kind: 'barre' },
  { rootString: 0, quality: 'add9', offsets: [0,2,2,1,0,2], fingers: [1,3,4,2,1,4], barreStrings: [0,5], difficulty: 8, kind: 'barre' },

  // A-shape barres, root on the 5th string
  { rootString: 1, quality: 'maj',  offsets: [null,0,2,2,2,0], fingers: [null,1,3,3,3,1], barreStrings: [1,5], difficulty: 7, kind: 'barre' },
  { rootString: 1, quality: 'min',  offsets: [null,0,2,2,1,0], fingers: [null,1,3,4,2,1], barreStrings: [1,5], difficulty: 7, kind: 'barre' },
  { rootString: 1, quality: '7',    offsets: [null,0,2,0,2,0], fingers: [null,1,3,1,4,1], barreStrings: [1,5], difficulty: 7, kind: 'barre' },
  { rootString: 1, quality: 'min7', offsets: [null,0,2,0,1,0], fingers: [null,1,3,1,2,1], barreStrings: [1,5], difficulty: 6, kind: 'barre' },
  { rootString: 1, quality: 'maj7', offsets: [null,0,2,1,2,0], fingers: [null,1,4,2,3,1], barreStrings: [1,5], difficulty: 7, kind: 'barre' },
  { rootString: 1, quality: 'sus4', offsets: [null,0,2,2,3,0], fingers: [null,1,2,3,4,1], barreStrings: [1,5], difficulty: 8, kind: 'barre' },
  { rootString: 1, quality: 'sus2', offsets: [null,0,2,2,0,null], fingers: [null,1,3,4,1,null], difficulty: 6, kind: 'movable' },
  { rootString: 1, quality: 'm7b5', offsets: [null,0,1,0,1,null], fingers: [null,1,2,1,3,null], difficulty: 5, kind: 'movable' },
  { rootString: 1, quality: 'dim',  offsets: [null,0,1,-1,null,null], fingers: [null,2,3,1,null,null], difficulty: 5, kind: 'movable' },
  { rootString: 1, quality: 'dim7', offsets: [null,0,1,-1,1,null], fingers: [null,2,3,1,4,null], difficulty: 6, kind: 'movable' },
  { rootString: 1, quality: 'aug',  offsets: [null,0,3,2,1,null], fingers: [null,1,4,3,2,null], difficulty: 6, kind: 'movable' },
  { rootString: 1, quality: 'add9', offsets: [null,0,2,4,2,0], fingers: [null,1,2,4,3,1], difficulty: 8, kind: 'movable' },

  // Power chords - the universal escape hatch
  { rootString: 0, quality: '5', offsets: [0,2,2,null,null,null], fingers: [1,3,4,null,null,null], difficulty: 2, kind: 'power' },
  { rootString: 1, quality: '5', offsets: [null,0,2,2,null,null], fingers: [null,1,3,4,null,null], difficulty: 3, kind: 'power' },
];

function shapeId(chord: Chord, frets: FretArray): string {
  return `${chord.root}:${chord.quality}:${frets.map((f) => (f === null ? 'x' : f)).join('-')}`;
}

function baseFretFor(frets: FretArray): number {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  if (fretted.length === 0) return 1;
  const min = Math.min(...fretted);
  const max = Math.max(...fretted);
  // Diagrams stay in open position while everything fits in frets 1-4.
  if (max <= 4) return 1;
  return min;
}

function fromTemplate(t: MovableTemplate, chord: Chord, barreFret: number): ChordShape | null {
  const frets: FretArray = t.offsets.map((o) => (o === null ? null : o + barreFret));
  if (frets.some((f) => f !== null && (f < 0 || f > 16))) return null;
  const rootFret = frets[t.rootString];
  if (rootFret === null) return null;
  const openAtZero = frets.every((f) => f === null || f >= 0);
  if (!openAtZero) return null;
  return {
    id: shapeId(chord, frets),
    label: chordName(chord),
    chord,
    frets,
    fingers: t.fingers,
    baseFret: baseFretFor(frets),
    barre:
      t.barreStrings && barreFret > 0
        ? { fret: barreFret, fromString: t.barreStrings[0], toString: t.barreStrings[1], finger: 1 }
        : undefined,
    kind: barreFret === 0 ? 'open' : t.kind,
    // Barres get harder the further up the neck you push them.
    difficulty:
      barreFret === 0
        ? Math.max(1, t.difficulty - 4)
        : t.difficulty + (barreFret > 7 ? 1 : 0),
  };
}

/**
 * Every voicing worth offering for a chord, easiest first.
 *
 * `chord` is the *shape* chord (already transposed for any capo), not the
 * sounding chord.
 */
export function shapesForChord(chord: Chord): ChordShape[] {
  const out: ChordShape[] = [];

  for (const def of OPEN_SHAPES) {
    if (def.root === chord.root && def.quality === chord.quality) {
      out.push({
        id: shapeId(chord, def.frets),
        label: chordName(chord),
        chord,
        frets: def.frets,
        fingers: def.fingers,
        baseFret: baseFretFor(def.frets),
        kind: def.kind,
        difficulty: def.difficulty,
      });
    }
  }

  for (const t of MOVABLE) {
    if (t.quality !== chord.quality) continue;
    const openPc = OPEN_STRING_PCS[t.rootString];
    let fret = ((chord.root - openPc) % 12 + 12) % 12;
    const made = fromTemplate(t, chord, fret);
    if (made) out.push(made);
    // Offer the octave-up position too; sometimes it is the closer move.
    const upper = fromTemplate(t, chord, fret + 12);
    if (upper && fret + 12 <= 12) out.push(upper);
  }

  // Nothing matched the exact quality - fall back to the plain triad, then to a
  // power chord, so the chart never has a hole in it.
  if (out.length === 0) {
    const triad = TRIAD_REDUCTION[chord.quality];
    if (triad !== chord.quality) {
      out.push(
        ...shapesForChord({ root: chord.root, quality: triad }).map((s) => ({
          ...s,
          label: chordName(chord),
          difficulty: s.difficulty + 1,
        })),
      );
    }
  }
  if (out.length === 0) {
    out.push(...shapesForChord({ root: chord.root, quality: '5' }));
  }

  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.difficulty - b.difficulty);
}

export function bestShape(chord: Chord): ChordShape {
  return shapesForChord(chord)[0];
}

/** How hard this chord is to play at all, used by the capo search. */
export function chordDifficulty(chord: Chord): number {
  const shapes = shapesForChord(chord);
  return shapes.length ? shapes[0].difficulty : 9;
}

/** Sounding MIDI notes of a voicing, for playback and MIDI export. */
export function shapeMidiNotes(shape: ChordShape, tuning: number[], capo: number): number[] {
  const notes: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f === null) return;
    const open = tuning[i];
    if (open === undefined) return;
    notes.push(open + capo + f);
  });
  return notes.sort((a, b) => a - b);
}
