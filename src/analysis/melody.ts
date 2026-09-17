/**
 * Pitch track -> playable riff.
 *
 * Segments a frame-wise pitch curve into notes, quantises them to a simple
 * rhythmic grid, and throws away everything that would clutter a lesson: short
 * blips, low-confidence frames, and octave jumps that are really tracking errors.
 */

import type { RiffNote } from '../types';

export interface MelodyOptions {
  /** Absolute beat = (frameTime - beatOffset) / beatDuration. */
  beatOffset: number;
  tempo: number;
  /** Quantisation grid in beats (0.5 = eighth notes). */
  grid: number;
  /** Salience floor, 0..1. */
  minConfidence: number;
  minMidi: number;
  maxMidi: number;
  /** Notes shorter than this (in beats) are dropped. */
  minDurationBeats?: number;
  /** Cap on how many notes per bar survive; the quietest go first. */
  maxNotesPerBeat?: number;
  beatsPerBar: number;
}

export interface PitchFrames {
  midi: Float32Array;
  salience: Float32Array;
  hopSeconds: number;
}

/** Odd-length median filter; kills single-frame octave errors. */
export function medianFilter(v: Float32Array, size: number): Float32Array {
  const out = new Float32Array(v.length);
  const half = Math.floor(size / 2);
  const buf: number[] = [];
  for (let i = 0; i < v.length; i++) {
    buf.length = 0;
    for (let k = i - half; k <= i + half; k++) {
      const x = v[Math.max(0, Math.min(v.length - 1, k))];
      if (Number.isFinite(x)) buf.push(x);
    }
    if (buf.length === 0) {
      out[i] = NaN;
      continue;
    }
    buf.sort((a, b) => a - b);
    out[i] = buf[Math.floor(buf.length / 2)];
  }
  return out;
}

export function extractRiff(track: PitchFrames, opts: MelodyOptions): RiffNote[] {
  const beatDuration = 60 / opts.tempo;
  const minDurationBeats = opts.minDurationBeats ?? Math.max(0.2, opts.grid * 0.75);
  const smoothed = medianFilter(track.midi, 5);

  // Mask out frames that are too quiet or outside the register we care about.
  const voiced = new Array<boolean>(smoothed.length);
  for (let i = 0; i < smoothed.length; i++) {
    const m = smoothed[i];
    voiced[i] =
      Number.isFinite(m) &&
      m >= opts.minMidi &&
      m <= opts.maxMidi &&
      (track.salience[i] ?? 0) >= opts.minConfidence;
  }

  // Segment: a new note starts when the pitch moves more than a semitone.
  interface Raw {
    startFrame: number;
    endFrame: number;
    midi: number;
    salience: number;
  }
  const raw: Raw[] = [];
  let i = 0;
  while (i < smoothed.length) {
    if (!voiced[i]) {
      i++;
      continue;
    }
    let j = i;
    let sum = 0;
    let salSum = 0;
    let count = 0;
    let ref = smoothed[i];
    while (j < smoothed.length && voiced[j] && Math.abs(smoothed[j] - ref) < 0.75) {
      sum += smoothed[j];
      salSum += track.salience[j] ?? 0;
      count++;
      ref = sum / count; // let the reference drift with a bend
      j++;
    }
    raw.push({ startFrame: i, endFrame: j, midi: sum / count, salience: salSum / count });
    i = j;
  }

  // Quantise onto the grid and merge anything that collapses to the same slot.
  const notes: RiffNote[] = [];
  for (const r of raw) {
    const startSec = r.startFrame * track.hopSeconds;
    const endSec = r.endFrame * track.hopSeconds;
    const startBeatRaw = (startSec - opts.beatOffset) / beatDuration;
    const endBeatRaw = (endSec - opts.beatOffset) / beatDuration;
    const startBeat = Math.round(startBeatRaw / opts.grid) * opts.grid;
    let duration = Math.round((endBeatRaw - startBeatRaw) / opts.grid) * opts.grid;
    if (duration < opts.grid) duration = opts.grid;
    if (duration < minDurationBeats) continue;
    if (startBeat < -opts.grid) continue;

    const midi = Math.round(r.midi);
    const prev = notes[notes.length - 1];
    if (prev && prev.midi === midi && Math.abs(prev.startBeat + prev.durationBeats - startBeat) < 1e-6) {
      prev.durationBeats += duration;
      continue;
    }
    if (prev && startBeat < prev.startBeat + prev.durationBeats) {
      // Monophonic by construction: trim the previous note rather than overlap.
      prev.durationBeats = Math.max(opts.grid, startBeat - prev.startBeat);
    }
    notes.push({
      id: `n${notes.length}-${startBeat}`,
      startBeat: Math.max(0, startBeat),
      durationBeats: duration,
      midi,
      confidence: Math.max(0, Math.min(1, r.salience)),
    });
  }

  return thinByDensity(notes, opts);
}

/**
 * Density limit: a hook a student can hold onto, not every passing note the
 * tracker found. The quietest notes go first.
 */
function thinByDensity(notes: RiffNote[], opts: MelodyOptions): RiffNote[] {
  const maxPerBeat = opts.maxNotesPerBeat ?? 2;
  if (notes.length === 0) return notes;
  const lastBeat = Math.max(...notes.map((n) => n.startBeat + n.durationBeats));
  const barCount = Math.max(1, Math.ceil(lastBeat / opts.beatsPerBar));
  const limit = Math.round(maxPerBeat * opts.beatsPerBar);
  const kept: RiffNote[] = [];
  for (let bar = 0; bar < barCount; bar++) {
    const lo = bar * opts.beatsPerBar;
    const hi = lo + opts.beatsPerBar;
    const inBar = notes.filter((n) => n.startBeat >= lo && n.startBeat < hi);
    if (inBar.length <= limit) {
      kept.push(...inBar);
      continue;
    }
    const ranked = inBar.slice().sort((a, b) => b.confidence * b.durationBeats - a.confidence * a.durationBeats);
    const survivors = new Set(ranked.slice(0, limit).map((n) => n.id));
    kept.push(...inBar.filter((n) => survivors.has(n.id)));
  }
  return kept.sort((a, b) => a.startBeat - b.startBeat);
}

/**
 * Locate the most-repeated phrase, so the UI can point at "this is the hook".
 * Compares interval contours so a transposed repeat still matches.
 */
export function findHook(
  notes: RiffNote[],
  beatsPerBar: number,
  phraseBars = 2,
): { startBeat: number; endBeat: number; repeats: number } | null {
  if (notes.length < 6) return null;
  const phraseBeats = phraseBars * beatsPerBar;
  const lastBeat = Math.max(...notes.map((n) => n.startBeat + n.durationBeats));
  const windows: { start: number; contour: string }[] = [];
  for (let s = 0; s + phraseBeats <= lastBeat + 1e-6; s += beatsPerBar) {
    const inWin = notes.filter((n) => n.startBeat >= s && n.startBeat < s + phraseBeats);
    if (inWin.length < 3) continue;
    const contour = inWin
      .slice(1)
      .map((n, i) => `${n.midi - inWin[i].midi}:${Math.round(n.startBeat - inWin[i].startBeat)}`)
      .join(',');
    windows.push({ start: s, contour });
  }
  if (windows.length === 0) return null;
  const counts = new Map<string, number[]>();
  for (const w of windows) {
    const list = counts.get(w.contour) ?? [];
    list.push(w.start);
    counts.set(w.contour, list);
  }
  let best: { starts: number[]; count: number } | null = null;
  for (const starts of counts.values()) {
    if (!best || starts.length > best.count) best = { starts, count: starts.length };
  }
  if (!best || best.count < 2) return null;
  return { startBeat: best.starts[0], endBeat: best.starts[0] + phraseBeats, repeats: best.count };
}
