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
import { mapNotesToFrets, tuningById, type FretPosition } from './fretboard';
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

/**
 * Riff notes that start together, grouped into one event.
 *
 * The phase 1 note engine was monophonic by construction. Basic Pitch is not,
 * so anything that lays notes out in time - the score, the tab staff, the
 * fretboard mapper - has to treat a simultaneous stack as one event rather
 * than as a run of zero-length notes.
 */
export interface RiffGroup {
  startBeat: number;
  /** Shortest note in the stack; what the notated beat is worth. */
  durationBeats: number;
  notes: RiffNote[];
}

export function groupRiffIntoChords(riff: RiffNote[], tolerance = 1e-6): RiffGroup[] {
  const sorted = riff.slice().sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  const groups: RiffGroup[] = [];
  for (const note of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.startBeat - note.startBeat) <= tolerance) {
      last.notes.push(note);
      last.durationBeats = Math.min(last.durationBeats, note.durationBeats);
    } else {
      groups.push({ startBeat: note.startBeat, durationBeats: note.durationBeats, notes: [note] });
    }
  }
  return groups;
}

/**
 * (Re)assign string/fret for every riff note under the current tuning and capo.
 *
 * The top note of each group carries the line, so it goes through the
 * hand-movement optimiser; the notes stacked under it take the nearest free
 * string, because two notes cannot share one.
 */
export function withFretPositions(a: Arrangement, tuningMidi?: number[]): Arrangement {
  const tuning = tuningMidi ?? tuningOf(a);
  const opts = { tuning, capo: a.capo };
  const groups = groupRiffIntoChords(a.riff);

  // The melodic spine: the highest note of each group, mapped as a line.
  const lead = groups.map((g) => Math.max(...g.notes.map((n) => n.midi)));
  const leadPositions = mapNotesToFrets(lead, opts);

  const assigned = new Map<string, FretPosition | null>();
  groups.forEach((group, gi) => {
    const anchor = leadPositions[gi];
    const taken = new Set<number>();
    // Highest note first, so the lead keeps the position the optimiser picked.
    const ordered = group.notes.slice().sort((x, y) => y.midi - x.midi);
    ordered.forEach((note, i) => {
      if (i === 0 && anchor) {
        assigned.set(note.id, anchor);
        taken.add(anchor.string);
        return;
      }
      const candidates: FretPosition[] = [];
      tuning.forEach((open, string) => {
        const fret = note.midi - open - a.capo;
        if (fret >= 0 && fret <= 15 && !taken.has(string)) candidates.push({ string, fret });
      });
      if (candidates.length === 0) {
        assigned.set(note.id, null);
        return;
      }
      // Nearest to where the hand already is.
      const reference = anchor?.fret ?? candidates[0].fret;
      candidates.sort((x, y) => Math.abs(x.fret - reference) - Math.abs(y.fret - reference));
      assigned.set(note.id, candidates[0]);
      taken.add(candidates[0].string);
    });
  });

  a.riff = a.riff.map((n) => {
    const pos = assigned.get(n.id) ?? null;
    return { ...n, string: pos?.string, fret: pos?.fret };
  });
  return a;
}

/**
 * Drop notes the guitar cannot actually play in this tuning.
 *
 * Basic Pitch happily reports eight simultaneous pitches; a guitar has six
 * strings. Rather than carry notes that no voicing can produce - and that the
 * tab renderer cannot paint - the weakest of each stack are dropped and the
 * count is reported so the teacher knows the reduction happened.
 */
export function dropUnplayableNotes(a: Arrangement): number {
  const before = a.riff.length;
  a.riff = a.riff.filter((n) => n.string !== undefined && n.fret !== undefined);
  return before - a.riff.length;
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
