/**
 * Capo / transposition helper.
 *
 * A capo at fret N means the player fingers everything N semitones *lower* than
 * it sounds, so the shape chord is `transposeChord(sounding, -N)`.
 */

import { type Chord, chordName, transposeChord, type MusicalKey, shouldPreferFlats } from './theory';
import { chordDifficulty, shapesForChord } from './chordShapes';

export interface CapoSuggestion {
  capo: number;
  /** Extra transposition applied on top (changes the sounding pitch). 0 keeps the recording's key. */
  transpose: number;
  /** Mean voicing difficulty for the progression under this reframing. */
  score: number;
  shapeChords: Chord[];
  shapeNames: string[];
  openShapeCount: number;
  barreCount: number;
  summary: string;
}

export interface CapoInput {
  /** Sounding chords with a weight (typically number of bars they occupy). */
  chords: { chord: Chord; weight: number }[];
  key: MusicalKey;
  maxCapo?: number;
  /** Allow suggestions that change the sounding key (student sings lower/higher). */
  allowTranspose?: boolean;
}

function evaluate(input: CapoInput, capo: number, transpose: number): CapoSuggestion {
  const shift = transpose - capo;
  let total = 0;
  let weight = 0;
  let open = 0;
  let barre = 0;
  const shapeChords: Chord[] = [];

  for (const { chord, weight: w } of input.chords) {
    const shaped = transposeChord(chord, shift);
    shapeChords.push(shaped);
    const d = chordDifficulty(shaped);
    total += d * w;
    weight += w;
    const best = shapesForChord(shaped)[0];
    if (best?.kind === 'open' || best?.kind === 'easy') open += 1;
    if (best?.kind === 'barre') barre += 1;
  }

  const mean = weight > 0 ? total / weight : 9;
  // A capo is a small cost of its own; a high one crowds the fretboard.
  const capoCost = capo === 0 ? 0 : 0.25 + capo * 0.06;
  const transposeCost = transpose === 0 ? 0 : 1.2 + Math.abs(transpose) * 0.15;

  const flats = shouldPreferFlats(input.key.tonic, input.key.mode);
  const names = shapeChords.map((c) => chordName(c, flats));

  const summary =
    capo === 0 && transpose === 0
      ? 'No capo, played as it sounds'
      : transpose !== 0
        ? `Capo ${capo}, transposed ${transpose > 0 ? '+' : ''}${transpose} semitones (sounds in a different key)`
        : `Capo ${capo} - play ${dedupe(names).join(' ')}`;

  return {
    capo,
    transpose,
    score: mean + capoCost + transposeCost,
    shapeChords,
    shapeNames: names,
    openShapeCount: open,
    barreCount: barre,
    summary,
  };
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
}

/** Ranked reframings, easiest first. Always includes capo 0 for comparison. */
export function suggestCapos(input: CapoInput): CapoSuggestion[] {
  const maxCapo = input.maxCapo ?? 7;
  const out: CapoSuggestion[] = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    out.push(evaluate(input, capo, 0));
  }
  if (input.allowTranspose) {
    for (let capo = 0; capo <= maxCapo; capo++) {
      for (const t of [-2, -1, 1, 2]) {
        out.push(evaluate(input, capo, t));
      }
    }
  }
  return out.sort((a, b) => a.score - b.score);
}

/**
 * The one suggestion worth surfacing: the best non-zero capo, but only if it is
 * meaningfully easier than playing open.
 */
export function bestCapoSuggestion(input: CapoInput): CapoSuggestion | null {
  const all = suggestCapos(input);
  const plain = all.find((s) => s.capo === 0 && s.transpose === 0)!;
  const candidate = all.find((s) => s.capo !== 0 || s.transpose !== 0);
  if (!candidate) return null;
  // Needs to buy at least a noticeable amount of ease to be worth the fuss.
  if (plain.score - candidate.score < 0.6) return null;
  return candidate;
}

/** Sounding key of a progression once a capo/transposition is applied. */
export function reframedKey(key: MusicalKey, transpose: number): MusicalKey {
  return { tonic: ((key.tonic + transpose) % 12 + 12) % 12, mode: key.mode };
}
