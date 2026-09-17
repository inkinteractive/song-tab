/**
 * Tunings and note-to-fret mapping.
 *
 * Fret numbers are always *relative to the capo*: fret 0 means "the capo bar
 * (or the nut, with no capo)", which is what a player reads off a tab staff.
 */

export interface Tuning {
  id: string;
  name: string;
  /** Open-string MIDI notes, low string first. */
  midi: number[];
}

export const TUNINGS: Tuning[] = [
  { id: 'standard', name: 'Standard (EADGBE)', midi: [40, 45, 50, 55, 59, 64] },
  { id: 'dropd', name: 'Drop D (DADGBE)', midi: [38, 45, 50, 55, 59, 64] },
  { id: 'halfdown', name: 'Eb standard (half step down)', midi: [39, 44, 49, 54, 58, 63] },
  { id: 'fulldown', name: 'D standard (whole step down)', midi: [38, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', midi: [38, 45, 50, 55, 57, 62] },
  { id: 'openg', name: 'Open G (DGDGBD)', midi: [38, 43, 50, 55, 59, 62] },
  { id: 'opend', name: 'Open D (DADF#AD)', midi: [38, 45, 50, 54, 57, 62] },
];

export function tuningById(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

export interface FretPosition {
  /** 0 = lowest (thickest) string. */
  string: number;
  /** Relative to the capo. */
  fret: number;
}

export interface FretOptions {
  tuning: number[];
  capo: number;
  maxFret?: number;
  /** Frets a hand can comfortably cover without shifting. */
  span?: number;
}

function candidates(midi: number, opts: FretOptions): FretPosition[] {
  const maxFret = opts.maxFret ?? 15;
  const out: FretPosition[] = [];
  opts.tuning.forEach((open, string) => {
    const fret = midi - open - opts.capo;
    if (fret >= 0 && fret <= maxFret) out.push({ string, fret });
  });
  return out;
}

/** True when the note is reachable at all in this tuning/capo. */
export function isPlayable(midi: number, opts: FretOptions): boolean {
  return candidates(midi, opts).length > 0;
}

/**
 * Map a melodic line to positions, minimising hand movement.
 *
 * Viterbi over the candidate positions for each note. A single pass only sees
 * note-to-note distance, which happily walks a scale twelve frets up one string
 * - technically a small move each time, but not a position a teacher would
 * write. So it runs twice: the first pass finds roughly where the line sits,
 * the second anchors the hand there and charges for leaving it.
 */
export function mapNotesToFrets(midiNotes: number[], opts: FretOptions): (FretPosition | null)[] {
  const span = opts.span ?? 4;
  const perNote = midiNotes.map((m) => candidates(m, opts));

  const first = viterbi(perNote, span, null);
  const fretted = first.filter((p): p is FretPosition => p !== null && p.fret > 0).map((p) => p.fret);
  if (fretted.length === 0) return first;
  const sorted = fretted.slice().sort((a, b) => a - b);
  const anchor = sorted[Math.floor(sorted.length / 2)];
  return viterbi(perNote, span, anchor);
}

function viterbi(
  perNote: FretPosition[][],
  span: number,
  anchor: number | null,
): (FretPosition | null)[] {
  const emission = (p: FretPosition) => {
    let c = 0;
    // Prefer the low end of the neck: same pitch, easier reach, and it is where
    // a student's hand already is for the chords.
    c += p.fret * 0.04;
    if (p.fret > 12) c += (p.fret - 12) * 0.8; // awkward past the body join
    // Open strings are free wherever the hand is.
    if (anchor !== null && p.fret > 0) {
      c += Math.max(0, Math.abs(p.fret - anchor) - span) * 0.7;
    }
    return c;
  };

  const transition = (a: FretPosition, b: FretPosition) => {
    const shift = Math.abs(a.fret - b.fret);
    // Inside the hand span a move is nearly free; beyond it, the hand travels.
    const travel = shift <= span ? shift * 0.15 : span * 0.15 + (shift - span) * 1.2;
    const stringJump = Math.abs(a.string - b.string) * 0.25;
    if (b.fret === 0) return stringJump * 0.5;
    if (a.fret === 0) return stringJump * 0.5 + emissionFreeTravel(b, anchor, span);
    return travel + stringJump;
  };

  let prevCosts: number[] = [];
  const backptr: number[][] = [];
  let lastValidIndex = -1;

  perNote.forEach((cands, i) => {
    if (cands.length === 0) {
      backptr.push([]);
      return;
    }
    if (lastValidIndex < 0) {
      prevCosts = cands.map(emission);
      backptr.push(cands.map(() => -1));
      lastValidIndex = i;
      return;
    }
    const prevCands = perNote[lastValidIndex];
    const costs: number[] = [];
    const ptrs: number[] = [];
    cands.forEach((c) => {
      let best = Infinity;
      let bestJ = 0;
      prevCands.forEach((p, j) => {
        const v = prevCosts[j] + transition(p, c);
        if (v < best) {
          best = v;
          bestJ = j;
        }
      });
      costs.push(best + emission(c));
      ptrs.push(bestJ);
    });
    prevCosts = costs;
    backptr.push(ptrs);
    lastValidIndex = i;
  });

  const result: (FretPosition | null)[] = new Array(perNote.length).fill(null);
  if (lastValidIndex < 0) return result;

  let idx = prevCosts.indexOf(Math.min(...prevCosts));
  for (let i = lastValidIndex; i >= 0; i--) {
    const cands = perNote[i];
    if (cands.length === 0) continue;
    result[i] = cands[idx];
    const ptr = backptr[i][idx];
    if (ptr < 0) break;
    idx = ptr;
    // Step back over unplayable notes so the pointer lines up.
    let k = i - 1;
    while (k >= 0 && perNote[k].length === 0) k--;
    i = k + 1;
  }
  return result;
}

/** Leaving an open string costs whatever it costs to be where you land. */
function emissionFreeTravel(b: FretPosition, anchor: number | null, span: number): number {
  if (anchor === null) return 0;
  return Math.max(0, Math.abs(b.fret - anchor) - span) * 0.5;
}

export function positionToMidi(pos: FretPosition, opts: FretOptions): number {
  return opts.tuning[pos.string] + opts.capo + pos.fret;
}
