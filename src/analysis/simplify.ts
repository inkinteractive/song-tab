/**
 * Turning a raw chord path into something teachable.
 *
 * The detector emits a chord every 46ms. A beginner needs one chord per bar.
 * This module does that collapse: snap segments to the beat grid, pick the
 * chord that owns each bar, and reduce extended chords to plain triads unless
 * asked otherwise.
 *
 * It used to emit a second chord when one owned each half of a bar convincingly.
 * Real songs do change mid-bar, but the chart could not tell a real change from
 * the detector wobbling between two readings of the same harmony, and a bar
 * holding two stacked diagrams is harder to teach than a bar holding one. The
 * teacher can still split a bar by hand in the chord chart.
 */

import { type Chord, simplifyToTriad, chordsEqual } from '../music/theory';
import type { ChordSegment } from './chordEngine';
import type { BarChord } from '../types';

export interface SimplifyOptions {
  beats: number[];
  beatsPerBar: number;
  /** Collapse 7ths/sus/add9 to their plain triad. */
  reduceToTriads: boolean;
  /** Bars whose best chord scores below this are left empty. */
  minConfidence?: number;
}

interface Weighted {
  chord: Chord;
  weight: number;
  confidence: number;
}

function accumulate(
  segments: ChordSegment[],
  start: number,
  end: number,
): Weighted[] {
  const map = new Map<string, Weighted>();
  for (const seg of segments) {
    if (!seg.chord) continue;
    const overlap = Math.min(seg.end, end) - Math.max(seg.start, start);
    if (overlap <= 0) continue;
    const key = `${seg.chord.root}:${seg.chord.quality}`;
    const prev = map.get(key);
    const weight = overlap * (0.4 + 0.6 * seg.confidence);
    if (prev) {
      prev.weight += weight;
      prev.confidence = Math.max(prev.confidence, seg.confidence);
    } else {
      map.set(key, { chord: seg.chord, weight, confidence: seg.confidence });
    }
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

/** Exactly one chord per bar - the chord that owns the most of it. */
export function simplifyToBars(segments: ChordSegment[], opts: SimplifyOptions): BarChord[] {
  const { beats, beatsPerBar } = opts;
  const minConfidence = opts.minConfidence ?? 0.05;
  const out: BarChord[] = [];
  if (beats.length < 2) return out;

  const barCount = Math.ceil((beats.length - 1) / beatsPerBar);
  for (let bar = 0; bar < barCount; bar++) {
    const firstBeat = bar * beatsPerBar;
    const lastBeat = Math.min(firstBeat + beatsPerBar, beats.length - 1);
    if (lastBeat <= firstBeat) break;
    const start = beats[firstBeat];
    const end = beats[lastBeat];

    const ranked = accumulate(segments, start, end);
    if (ranked.length === 0 || ranked[0].confidence < minConfidence) continue;
    out.push(make(bar, firstBeat, lastBeat - firstBeat, ranked[0], opts));
  }
  return out;
}

function make(bar: number, startBeat: number, durationBeats: number, w: Weighted, opts: SimplifyOptions): BarChord {
  const chord = opts.reduceToTriads ? simplifyToTriad(w.chord) : w.chord;
  return {
    id: `bar${bar}-${startBeat}`,
    startBeat,
    durationBeats,
    chord,
    detected: w.chord,
    confidence: w.confidence,
  };
}

/**
 * Trim empty bars from the ends and drop a single stray bar wedged between two
 * bars of the same chord (almost always a detection wobble).
 */
export function tidyProgression(bars: BarChord[]): BarChord[] {
  const out = bars.slice();
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const next = out[i + 1];
    if (
      chordsEqual(prev.chord, next.chord) &&
      !chordsEqual(prev.chord, out[i].chord) &&
      out[i].confidence < prev.confidence * 0.7 &&
      out[i].confidence < next.confidence * 0.7
    ) {
      out[i] = { ...out[i], chord: prev.chord, detected: prev.detected };
    }
  }
  return out;
}

/** Weighted chord list for the capo search: weight = bars spent on the chord. */
export function chordWeights(bars: BarChord[], beatsPerBar: number): { chord: Chord; weight: number }[] {
  const map = new Map<string, { chord: Chord; weight: number }>();
  for (const b of bars) {
    const key = `${b.chord.root}:${b.chord.quality}`;
    const w = b.durationBeats / beatsPerBar;
    const prev = map.get(key);
    if (prev) prev.weight += w;
    else map.set(key, { chord: b.chord, weight: w });
  }
  return [...map.values()];
}
