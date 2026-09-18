/**
 * How much should a teacher trust this progression?
 *
 * The chord engine reads harmony well from one instrument at a time and badly
 * from a dense produced mix, where the loudest thing in the chroma is a vocal,
 * a cymbal wash, or a bass line walking away from the root. When that happens
 * it does not fail quietly - it emits a confident-looking chord per bar, and
 * the run of names is the only evidence anything went wrong.
 *
 * So measure the run itself. Real progressions sit in a key and reuse their
 * chords; a misread one wanders through unrelated roots. Neither test needs the
 * audio, which means the verdict updates live as the teacher corrects bars by
 * hand - fix the chart and the warning goes away.
 */

import { chordPitchClasses, scalePitchClasses, type MusicalKey } from '../music/theory';
import type { BarChord } from '../types';

export type Verdict = 'good' | 'mixed' | 'poor';

export interface ReliabilityReport {
  verdict: Verdict;
  /** Share of the chart, by duration, whose chord is wholly inside the key. */
  diatonicFit: number;
  /** Distinct roots per chord slot. A four-chord song over twelve bars is 0.33. */
  rootChurn: number;
  /**
   * Reported, never judged. The decoder's confidence is a softmax over the
   * whole vocabulary - 97 states for `standard` - and most of those states
   * share notes with the right answer, so the winner takes only a fifth of the
   * mass even when it is certain: a flawless run of Am F C G measures 0.214.
   * The absolute value tracks vocabulary size, not correctness, so thresholding
   * it flagged a 100%-correct chart as unreliable.
   */
  meanConfidence: number;
  /** Distinct roots, for the message. */
  distinctRoots: number;
}

/** Below this share of in-key chords, the progression is not in any key. */
const POOR_FIT = 0.45;
const GOOD_FIT = 0.7;
/** Above this, the chart names a new chord almost every bar. */
const HIGH_CHURN = 0.6;
/**
 * Churn only speaks when the fit already leaves room for doubt. A progression
 * that walks the scale is busy but perfectly ordinary music; the same churn
 * over chords from six different keys is a detector smearing.
 */
const CHURN_NEEDS_FIT_BELOW = 0.9;

export function assessProgression(chords: BarChord[], key: MusicalKey): ReliabilityReport {
  const scale = new Set(scalePitchClasses(key));
  let inKey = 0;
  let total = 0;
  let confidence = 0;
  const roots = new Set<number>();

  for (const bc of chords) {
    const weight = Math.max(0.001, bc.durationBeats);
    total += weight;
    confidence += bc.confidence * weight;
    roots.add(bc.chord.root);
    // Whole-chord test, not partial credit: a chord with one foreign note is
    // still a chord the song plausibly contains, and scoring it 2/3 let a
    // completely scrambled run average out to a respectable-looking number.
    if (chordPitchClasses(bc.chord).every((pc) => scale.has(pc))) inKey += weight;
  }

  const diatonicFit = total > 0 ? inKey / total : 1;
  const meanConfidence = total > 0 ? confidence / total : 0;
  const rootChurn = chords.length > 0 ? roots.size / chords.length : 0;

  let verdict: Verdict;
  if (chords.length < 3) {
    // Too short to say anything about. Not a compliment - just no evidence.
    verdict = 'good';
  } else if (diatonicFit < POOR_FIT) {
    verdict = 'poor';
  } else if (diatonicFit < GOOD_FIT || (diatonicFit < CHURN_NEEDS_FIT_BELOW && rootChurn > HIGH_CHURN)) {
    verdict = 'mixed';
  } else {
    verdict = 'good';
  }

  return { verdict, diatonicFit, rootChurn, meanConfidence, distinctRoots: roots.size };
}
