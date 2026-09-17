/**
 * Views over an Arrangement.
 *
 * An arrangement stores chords at *concert pitch as detected*. Two derived
 * forms matter:
 *   - sounding chord  = detected + transpose        (what the room hears)
 *   - shape chord     = detected + transpose - capo (what the hands play)
 * Everything on screen and in the exports comes from these two.
 */

import { type Chord, chordName, shouldPreferFlats, transposeChord } from './theory';
import { bestShape, type ChordShape, shapesForChord } from './chordShapes';
import { mapNotesToFrets, tuningById } from './fretboard';
import type { Arrangement, BarChord, RiffNote } from '../types';

export function soundingChord(bc: BarChord, a: Arrangement): Chord {
  return transposeChord(bc.chord, a.transpose);
}

export function shapeChordOf(bc: BarChord, a: Arrangement): Chord {
  return transposeChord(bc.chord, a.transpose - a.capo);
}

/** Spelling convention for the sounding key. */
export function preferFlats(a: Arrangement): boolean {
  return shouldPreferFlats((a.key.tonic + a.transpose + 12) % 12, a.key.mode);
}

/**
 * Spelling convention for the *shapes*. With a capo on, the hands are in a
 * different key from the ears, and the chart should read in the shape key -
 * "Bb", not "A#".
 */
export function preferFlatsForShapes(a: Arrangement): boolean {
  return shouldPreferFlats((a.key.tonic + a.transpose - a.capo + 120) % 12, a.key.mode);
}

/** Name as the teacher should call it out: the shape name when a capo is on. */
export function displayName(bc: BarChord, a: Arrangement): string {
  return chordName(shapeChordOf(bc, a), preferFlatsForShapes(a));
}

export function soundingName(bc: BarChord, a: Arrangement): string {
  return chordName(soundingChord(bc, a), preferFlats(a));
}

export function resolveShape(bc: BarChord, a: Arrangement): ChordShape {
  const chord = shapeChordOf(bc, a);
  if (bc.shapeId) {
    const pinned = shapesForChord(chord).find((s) => s.id === bc.shapeId);
    if (pinned) return pinned;
  }
  return bestShape(chord);
}

export function shapeOptions(bc: BarChord, a: Arrangement): ChordShape[] {
  return shapesForChord(shapeChordOf(bc, a));
}

export function beatToTime(a: Arrangement, beat: number): number {
  return a.beatOffset + (beat * 60) / a.tempo;
}

export function timeToBeat(a: Arrangement, time: number): number {
  return ((time - a.beatOffset) * a.tempo) / 60;
}

export interface Bar {
  index: number;
  startBeat: number;
  chords: BarChord[];
  notes: RiffNote[];
}

/** Group chords and riff notes into bars for layout. */
export function toBars(a: Arrangement): Bar[] {
  const spans = [
    ...a.chords.map((c) => c.startBeat + c.durationBeats),
    ...a.riff.map((n) => n.startBeat + n.durationBeats),
    a.beatsPerBar,
  ];
  const lastBeat = Math.max(...spans);
  const count = Math.max(1, Math.ceil(lastBeat / a.beatsPerBar - 1e-6));
  const bars: Bar[] = [];
  for (let i = 0; i < count; i++) {
    const lo = i * a.beatsPerBar;
    const hi = lo + a.beatsPerBar;
    bars.push({
      index: i,
      startBeat: lo,
      chords: a.chords.filter((c) => c.startBeat >= lo - 1e-6 && c.startBeat < hi - 1e-6),
      notes: a.riff.filter((n) => n.startBeat >= lo - 1e-6 && n.startBeat < hi - 1e-6),
    });
  }
  return bars;
}

export function tuningOf(a: Arrangement): number[] {
  return tuningById(a.tuningId).midi;
}

/** Distinct chords in play order - what goes in the diagram strip. */
export function uniqueShapes(a: Arrangement): { chord: Chord; shape: ChordShape; name: string }[] {
  const seen = new Map<string, { chord: Chord; shape: ChordShape; name: string }>();
  for (const bc of a.chords) {
    const shape = resolveShape(bc, a);
    const key = shape.id;
    if (!seen.has(key)) {
      seen.set(key, { chord: shapeChordOf(bc, a), shape, name: displayName(bc, a) });
    }
  }
  return [...seen.values()];
}

/** Sounding MIDI pitch of a riff note, accounting for transposition. */
export function riffMidi(n: RiffNote, a: Arrangement): number {
  return n.midi + a.transpose;
}

export function arrangementDurationBeats(a: Arrangement): number {
  return toBars(a).length * a.beatsPerBar;
}

/** (Re)assign string/fret for every riff note under the current tuning and capo. */
export function withFretPositions(a: Arrangement, tuningMidi?: number[]): Arrangement {
  const tuning = tuningMidi ?? tuningOf(a);
  const positions = mapNotesToFrets(
    a.riff.map((n) => n.midi),
    { tuning, capo: a.capo },
  );
  a.riff = a.riff.map((n, i) => ({ ...n, string: positions[i]?.string, fret: positions[i]?.fret }));
  return a;
}

/** One-line "G → D → Em → C" summary of the progression. */
export function progressionSummary(a: Arrangement): string {
  const seen: string[] = [];
  for (const bc of a.chords) {
    const name = displayName(bc, a);
    if (seen[seen.length - 1] !== name) seen.push(name);
  }
  const sounding = a.capo > 0 && a.chords[0] ? ` (sounding ${soundingName(a.chords[0], a)}\u2026)` : '';
  return seen.slice(0, 16).join(' \u2192 ') + sounding;
}
