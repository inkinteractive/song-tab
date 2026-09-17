/**
 * Builds an alphaTab Score from an Arrangement.
 *
 * One model serves three jobs: on-screen rendering, synth playback, and the
 * Guitar Pro / alphaTex exporters. Everything the teacher edits flows through
 * here, so a change to a chord or a note shows up in all three at once.
 */

import * as alphaTab from '@coderline/alphatab';
import { resolveShape, toBars, tuningOf, uniqueShapes } from '../music/arrangement';
import { keyName } from '../music/theory';
import { patternById, patternToString } from '../music/strumming';
import { tuningById } from '../music/fretboard';
import type { Arrangement, BarChord, RiffNote } from '../types';
import { TIER_LABELS } from '../types';

const M = alphaTab.model;

interface DurationPart {
  /** In sixteenth notes. */
  sixteenths: number;
  duration: alphaTab.model.Duration;
  dots: number;
}

const DURATION_TABLE: DurationPart[] = [
  { sixteenths: 16, duration: M.Duration.Whole, dots: 0 },
  { sixteenths: 12, duration: M.Duration.Half, dots: 1 },
  { sixteenths: 8, duration: M.Duration.Half, dots: 0 },
  { sixteenths: 6, duration: M.Duration.Quarter, dots: 1 },
  { sixteenths: 4, duration: M.Duration.Quarter, dots: 0 },
  { sixteenths: 3, duration: M.Duration.Eighth, dots: 1 },
  { sixteenths: 2, duration: M.Duration.Eighth, dots: 0 },
  { sixteenths: 1, duration: M.Duration.Sixteenth, dots: 0 },
];

/** Split a length in sixteenths into writable note values. */
export function durationParts(sixteenths: number): DurationPart[] {
  const out: DurationPart[] = [];
  let remaining = Math.max(1, Math.round(sixteenths));
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    const fit = DURATION_TABLE.find((d) => d.sixteenths <= remaining);
    if (!fit) break;
    out.push(fit);
    remaining -= fit.sixteenths;
  }
  return out.length ? out : [DURATION_TABLE[DURATION_TABLE.length - 1]];
}

const KEY_SIGNATURES: Record<number, alphaTab.model.KeySignature> = {
  0: M.KeySignature.C,
  7: M.KeySignature.G,
  2: M.KeySignature.D,
  9: M.KeySignature.A,
  4: M.KeySignature.E,
  11: M.KeySignature.B,
  6: M.KeySignature.FSharp,
  1: M.KeySignature.Db,
  8: M.KeySignature.Ab,
  3: M.KeySignature.Eb,
  10: M.KeySignature.Bb,
  5: M.KeySignature.F,
};

function keySignatureFor(a: Arrangement): alphaTab.model.KeySignature {
  const tonic = (a.key.tonic + a.transpose + 12) % 12;
  const major = a.key.mode === 'minor' ? (tonic + 3) % 12 : tonic;
  return KEY_SIGNATURES[major] ?? M.KeySignature.C;
}

/**
 * alphaTab numbers strings 1..N from the *lowest* sounding string, which is the
 * opposite of MusicXML. Ours are 0-based from the lowest, so this is just +1 -
 * but it is worth naming, because getting it backwards silently produces a tab
 * staff that is a mirror image of the real fingering.
 */
function toAlphaTabString(ourString: number): number {
  return ourString + 1;
}

function makeRest(voice: alphaTab.model.Voice, part: DurationPart): void {
  const beat = new M.Beat();
  beat.duration = part.duration;
  beat.dots = part.dots;
  voice.addBeat(beat);
}

function fillRest(voice: alphaTab.model.Voice, sixteenths: number): void {
  if (sixteenths <= 0) return;
  for (const part of durationParts(sixteenths)) makeRest(voice, part);
}

interface ScoreBuildOptions {
  title?: string;
  /** Render slash notation for the chord track (the Essential-tier look). */
  chordsAsSlashes?: boolean;
}

export interface BuiltScore {
  score: alphaTab.model.Score;
  /** Track index -> what it holds, so the view can pick what to show. */
  chordTrack: number;
  riffTrack: number | null;
  /** Absolute beat position of each bar, for cursor mapping. */
  barStartBeats: number[];
}

export function buildScore(a: Arrangement, opts: ScoreBuildOptions = {}): BuiltScore {
  const settings = new alphaTab.Settings();
  const score = new M.Score();
  const bars = toBars(a);
  const tuning = tuningOf(a);
  const pattern = patternById(a.strumPatternId);

  score.title = opts.title ?? 'Simplified arrangement';
  score.subTitle = `${keyName({ tonic: (a.key.tonic + a.transpose + 12) % 12, mode: a.key.mode })} · ${Math.round(
    a.tempo,
  )} BPM · ${TIER_LABELS[a.tier].name}`;
  score.artist = a.capo > 0 ? `Capo fret ${a.capo}` : '';
  score.words = `Strum: ${pattern.name} (${patternToString(pattern)})`;
  score.notices = a.notes.join('  |  ');
  score.tab = tuningById(a.tuningId).name;

  // ---- master bars --------------------------------------------------------
  const keySignature = keySignatureFor(a);
  for (let i = 0; i < Math.max(1, bars.length); i++) {
    const mb = new M.MasterBar();
    mb.timeSignatureNumerator = a.beatsPerBar;
    mb.timeSignatureDenominator = a.beatUnit;
    if (i === 0) {
      mb.tempoAutomations = [M.Automation.buildTempoAutomation(false, 0, a.tempo, 2)];
    }
    score.addMasterBar(mb);
  }

  // ---- chord track --------------------------------------------------------
  const chordTrack = new M.Track();
  chordTrack.name = 'Chords';
  chordTrack.shortName = 'Ch';
  chordTrack.playbackInfo.program = 25; // steel-string acoustic
  chordTrack.playbackInfo.primaryChannel = 0;
  chordTrack.playbackInfo.secondaryChannel = 1;
  score.addTrack(chordTrack);

  const chordStaff = new M.Staff();
  chordStaff.stringTuning = new M.Tuning('', tuning.slice().reverse(), false);
  chordStaff.capo = a.capo;
  // Essential tier reads as a chord chart: a single slash staff under the chord
  // symbols and diagrams. The other tiers show the voicing on a notation + tab
  // pair, since at that point the teacher is picking the arrangement apart.
  const slashes = opts.chordsAsSlashes ?? a.tier === 'essential';
  chordStaff.showSlash = slashes;
  chordStaff.showStandardNotation = !slashes;
  chordStaff.showTablature = !slashes;
  chordTrack.addStaff(chordStaff);

  // Diagrams live on the staff and are referenced per beat by id.
  for (const { shape, name } of uniqueShapes(a)) {
    const chord = new M.Chord();
    chord.name = name;
    chord.firstFret = Math.max(1, shape.baseFret);
    // alphaTab orders `strings` high to low; -1 is a muted string.
    chord.strings = shape.frets
      .slice()
      .reverse()
      .map((f) => (f === null ? -1 : f));
    chord.barreFrets = shape.barre ? [shape.barre.fret] : [];
    chord.showName = true;
    chord.showDiagram = true;
    chord.showFingering = false;
    if (!chordStaff.hasChord(shape.id)) chordStaff.addChord(shape.id, chord);
  }

  bars.forEach((bar) => {
    const atBar = new M.Bar();
    atBar.clef = M.Clef.G2;
    chordStaff.addBar(atBar);
    const voice = new M.Voice();
    atBar.addVoice(voice);

    const barSixteenths = a.beatsPerBar * 4;
    let cursor = 0;
    const sorted = bar.chords.slice().sort((x, y) => x.startBeat - y.startBeat);

    for (const bc of sorted) {
      const start = Math.round((bc.startBeat - bar.startBeat) * 4);
      if (start > cursor) {
        fillRest(voice, start - cursor);
        cursor = start;
      }
      const length = Math.min(Math.round(bc.durationBeats * 4), barSixteenths - cursor);
      if (length <= 0) continue;
      addChordBeats(voice, bc, a, length, slashes);
      cursor += length;
    }
    if (cursor < barSixteenths) fillRest(voice, barSixteenths - cursor);
    if (voice.beats.length === 0) fillRest(voice, barSixteenths);
  });

  // ---- riff track ---------------------------------------------------------
  let riffTrackIndex: number | null = null;
  if (a.tier !== 'essential' && a.riff.length > 0) {
    const riffTrack = new M.Track();
    riffTrack.name = a.tier === 'full' ? 'Transcription (approximate)' : 'Riff / melody';
    riffTrack.shortName = 'Riff';
    riffTrack.playbackInfo.program = 25;
    riffTrack.playbackInfo.primaryChannel = 2;
    riffTrack.playbackInfo.secondaryChannel = 3;
    score.addTrack(riffTrack);
    riffTrackIndex = riffTrack.index;

    const riffStaff = new M.Staff();
    riffStaff.stringTuning = new M.Tuning('', tuning.slice().reverse(), false);
    riffStaff.capo = a.capo;
    riffStaff.showTablature = true;
    riffStaff.showStandardNotation = true;
    riffTrack.addStaff(riffStaff);

    bars.forEach((bar) => {
      const atBar = new M.Bar();
      atBar.clef = M.Clef.G2;
      riffStaff.addBar(atBar);
      const voice = new M.Voice();
      atBar.addVoice(voice);

      const barSixteenths = a.beatsPerBar * 4;
      let cursor = 0;
      const sorted = bar.notes.slice().sort((x, y) => x.startBeat - y.startBeat);
      for (const n of sorted) {
        const start = Math.round((n.startBeat - bar.startBeat) * 4);
        if (start > cursor) {
          fillRest(voice, start - cursor);
          cursor = start;
        }
        const length = Math.min(Math.max(1, Math.round(n.durationBeats * 4)), barSixteenths - cursor);
        if (length <= 0) continue;
        addRiffBeats(voice, n, length);
        cursor += length;
      }
      if (cursor < barSixteenths) fillRest(voice, barSixteenths - cursor);
      if (voice.beats.length === 0) fillRest(voice, barSixteenths);
    });
  }

  // The key-signature setter on a master bar propagates into every staff's bar
  // at that index, so it only works once the tracks and bars exist.
  for (const mb of score.masterBars) mb.keySignature = keySignature;

  score.finish(settings);

  return {
    score,
    chordTrack: chordTrack.index,
    riffTrack: riffTrackIndex,
    barStartBeats: bars.map((b) => b.startBeat),
  };
}

function addChordBeats(
  voice: alphaTab.model.Voice,
  bc: BarChord,
  a: Arrangement,
  lengthSixteenths: number,
  slashed: boolean,
): void {
  const shape = resolveShape(bc, a);
  const parts = durationParts(lengthSixteenths);
  let previousNotes: Map<number, alphaTab.model.Note> | null = null;

  parts.forEach((part, pi) => {
    const beat = new M.Beat();
    beat.duration = part.duration;
    beat.dots = part.dots;
    beat.chordId = shape.id;
    beat.slashed = slashed;
    if (pi === 0) {
      // A downward brush reads (and sounds) like a strum rather than a stab.
      beat.brushType = M.BrushType.BrushDown;
      beat.brushDuration = 30;
      beat.text = null;
    }
    const current = new Map<number, alphaTab.model.Note>();
    shape.frets.forEach((fret, ourString) => {
      if (fret === null) return;
      const note = new M.Note();
      note.fret = fret;
      note.string = toAlphaTabString(ourString);
      if (pi > 0 && previousNotes?.has(note.string)) {
        note.isTieDestination = true;
        note.tieOrigin = previousNotes.get(note.string)!;
      }
      beat.addNote(note);
      current.set(note.string, note);
    });
    previousNotes = current;
    voice.addBeat(beat);
  });
}

function addRiffBeats(voice: alphaTab.model.Voice, n: RiffNote, lengthSixteenths: number): void {
  const parts = durationParts(lengthSixteenths);
  let previous: alphaTab.model.Note | null = null;
  parts.forEach((part, pi) => {
    const beat = new M.Beat();
    beat.duration = part.duration;
    beat.dots = part.dots;
    const note = new M.Note();
    if (n.string !== undefined && n.fret !== undefined) {
      note.fret = n.fret;
      note.string = toAlphaTabString(n.string);
    } else {
      // Unplayable in this tuning: keep the pitch so it still shows and sounds.
      note.octave = Math.floor(n.midi / 12) - 1;
      note.tone = n.midi % 12;
    }
    if (pi > 0 && previous) {
      note.isTieDestination = true;
      note.tieOrigin = previous;
    }
    beat.addNote(note);
    previous = note;
    voice.addBeat(beat);
  });
}

/** Guitar Pro 7 (.gp) bytes for the current arrangement. */
export function toGuitarProBytes(a: Arrangement, title?: string): Uint8Array {
  const { score } = buildScore(a, { title });
  return new alphaTab.exporter.Gp7Exporter().export(score, new alphaTab.Settings());
}

/** alphaTex source - handy for debugging and for pasting into alphaTab demos. */
export function toAlphaTex(a: Arrangement, title?: string): string {
  const { score } = buildScore(a, { title });
  const bytes = new alphaTab.exporter.AlphaTexExporter().export(score, new alphaTab.Settings());
  return new TextDecoder().decode(bytes);
}
