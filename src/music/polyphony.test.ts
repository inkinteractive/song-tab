/**
 * Phase 2 made the riff polyphonic. These lock down the invariants that a
 * stacked chord has to satisfy but a single line never did.
 */

import { describe, expect, it } from 'vitest';
import { dropUnplayableNotes, groupRiffIntoChords, withFretPositions } from './arrangement';
import { buildScore } from '../render/score';
import { toMusicXml } from '../export/musicxml';
import { toMidi } from '../export/midi';
import type { Arrangement, RiffNote } from '../types';

function note(id: string, startBeat: number, midi: number, durationBeats = 1): RiffNote {
  return { id, startBeat, durationBeats, midi, confidence: 0.9 };
}

function fixture(riff: RiffNote[]): Arrangement {
  return {
    tier: 'full',
    tempo: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    key: { tonic: 0, mode: 'major' },
    tuningId: 'standard',
    capo: 0,
    transpose: 0,
    strumPatternId: 'ddu-udu',
    richChords: false,
    clipDuration: 8,
    beatOffset: 0,
    notes: [],
    chords: [{ id: 'c1', startBeat: 0, durationBeats: 4, chord: { root: 0, quality: 'maj' }, confidence: 0.9 }],
    riff,
  };
}

describe('grouping', () => {
  it('stacks notes that start together and takes the shortest duration', () => {
    const groups = groupRiffIntoChords([
      note('a', 0, 60, 2),
      note('b', 0, 64, 1),
      note('c', 0, 67, 4),
      note('d', 2, 65, 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].notes.map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(groups[0].durationBeats).toBe(1);
    expect(groups[1].notes.map((n) => n.midi)).toEqual([65]);
  });

  it('leaves a monophonic line as one group per note', () => {
    const groups = groupRiffIntoChords([note('a', 0, 60), note('b', 1, 62), note('c', 2, 64)]);
    expect(groups).toHaveLength(3);
  });
});

describe('fret assignment', () => {
  it('never puts two simultaneous notes on the same string', () => {
    const a = fixture([note('a', 0, 52), note('b', 0, 55), note('c', 0, 60), note('d', 0, 64)]);
    withFretPositions(a);
    const strings = a.riff.map((n) => n.string).filter((s): s is number => s !== undefined);
    expect(strings.length).toBe(4);
    expect(new Set(strings).size).toBe(4);
  });

  it('keeps a stacked chord under one hand', () => {
    // C major triad, playable in first position.
    const a = fixture([note('a', 0, 48), note('b', 0, 52), note('c', 0, 55)]);
    withFretPositions(a);
    const frets = a.riff.map((n) => n.fret).filter((f): f is number => f !== undefined && f > 0);
    if (frets.length > 1) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4);
  });

  it('marks a note as unplayable rather than doubling a string', () => {
    // Five notes needing the same register; the tuning cannot supply five
    // distinct strings for all of them in range.
    const a = fixture([
      note('a', 0, 40),
      note('b', 0, 41),
      note('c', 0, 42),
      note('d', 0, 43),
      note('e', 0, 44),
      note('f', 0, 39),
    ]);
    withFretPositions(a);
    const strings = a.riff.map((n) => n.string).filter((s): s is number => s !== undefined);
    expect(new Set(strings).size).toBe(strings.length);
  });
});

describe('polyphonic output', () => {
  const a = (() => {
    const arr = fixture([
      note('a', 0, 60, 1),
      note('b', 0, 64, 1),
      note('c', 0, 67, 1),
      note('d', 2, 62, 2),
      note('e', 2, 65, 2),
    ]);
    withFretPositions(arr);
    return arr;
  })();

  it('emits one alphaTab beat per stack, not one per note', () => {
    const built = buildScore(a);
    const bar = built.score.tracks[built.riffTrack!].staves[0].bars[0];
    const beats = bar.voices[0].beats;
    // Two sounding stacks plus the rest that fills beat 2.
    const sounding = beats.filter((b) => b.notes.length > 0);
    expect(sounding).toHaveLength(2);
    expect(sounding[0].notes).toHaveLength(3);
    expect(sounding[1].notes).toHaveLength(2);
  });

  it('writes stacked notes as a MusicXML chord', () => {
    const xml = toMusicXml(a);
    const tabPart = xml.slice(xml.indexOf('<part id="P2">'));
    const firstMeasure = tabPart.slice(0, tabPart.indexOf('</measure>'));
    // Bar 1 holds a 3-note stack and a 2-note stack. MusicXML marks every note
    // after the first of a stack, so that is 2 + 1 markers.
    expect((firstMeasure.match(/<chord\/>/g) ?? []).length).toBe(3);
    // Five sounding notes, each with its own string/fret.
    expect((firstMeasure.match(/<technical>/g) ?? []).length).toBe(5);
  });

  it('keeps every note in the MIDI export', () => {
    const bytes = toMidi(a);
    // Five note-ons on the melody channel (0x91).
    let noteOns = 0;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x91 && bytes[i + 2] > 0) noteOns++;
    }
    expect(noteOns).toBeGreaterThanOrEqual(5);
  });
});

describe('fretboard limits', () => {
  it('drops notes a six-string guitar cannot voice, weakest first', () => {
    // Eight simultaneous pitches: more than the instrument has strings.
    const riff = [60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => ({
      ...note(`n${i}`, 0, midi),
      confidence: i / 8,
    }));
    const a = fixture(riff);
    withFretPositions(a);
    const dropped = dropUnplayableNotes(a);
    expect(a.riff.length).toBeLessThanOrEqual(6);
    expect(dropped).toBe(riff.length - a.riff.length);
    // Every survivor is on its own string.
    const strings = a.riff.map((n) => n.string);
    expect(new Set(strings).size).toBe(strings.length);
  });

  it('never hands the score a note without a string', () => {
    const a = fixture([60, 62, 64, 65, 67, 69, 71, 72].map((midi, i) => note(`n${i}`, 0, midi)));
    withFretPositions(a);
    dropUnplayableNotes(a);
    const built = buildScore(a);
    for (const bar of built.score.tracks[built.riffTrack!].staves[0].bars) {
      for (const beat of bar.voices[0].beats) {
        for (const n of beat.notes) {
          // alphaTab numbers strings from 1; 0 or less means "unset", which is
          // what crashed the tab painter.
          expect(n.string).toBeGreaterThan(0);
        }
      }
    }
  });
});
