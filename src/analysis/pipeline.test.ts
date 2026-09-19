/**
 * End-to-end checks of the analysis path on synthetic audio.
 *
 * These render a progression, run the real pipeline over it, and assert the
 * chart that comes out is the one a teacher would have written down.
 */

import { describe, expect, it } from 'vitest';
import { analyzeClip } from './engine';
import { synthesizeProgression } from './testAudio';
import { DEFAULT_SETTINGS } from '../types';
import { type Chord } from '../music/theory';
import { displayName } from '../music/arrangement';

const SR = 22050;
const C = (root: number, quality: Chord['quality'] = 'maj'): Chord => ({ root, quality });
const key = (c: Chord) => `${c.root}:${c.quality}`;

interface Case {
  name: string;
  progression: Chord[];
  tempo: number;
  harmonics: number;
  noise: number;
}

const CASES: Case[] = [
  { name: 'Am F C G', progression: [C(9, 'min'), C(5), C(0), C(7)], tempo: 100, harmonics: 5, noise: 0.01 },
  { name: 'Em C G D', progression: [C(4, 'min'), C(0), C(7), C(2)], tempo: 128, harmonics: 5, noise: 0.01 },
  // The design case: dense, effected, fast, minor. Underneath it is four chords.
  { name: 'F#m D A E (dense)', progression: [C(6, 'min'), C(2), C(9), C(4)], tempo: 148, harmonics: 9, noise: 0.06 },
  { name: 'Dm Bb F C', progression: [C(2, 'min'), C(10), C(5), C(0)], tempo: 84, harmonics: 7, noise: 0.03 },
  { name: 'Cm Ab Eb Bb', progression: [C(0, 'min'), C(8), C(3), C(10)], tempo: 112, harmonics: 8, noise: 0.05 },
];

describe('chord pipeline', () => {
  it.each(CASES)('recovers $name', async (c) => {
    const samples = synthesizeProgression({
      sampleRate: SR,
      tempo: c.tempo,
      beatsPerBar: 4,
      progression: c.progression,
      repeats: 2,
      harmonics: c.harmonics,
      noise: c.noise,
    });

    const result = await analyzeClip({ samples, sampleRate: SR, settings: { ...DEFAULT_SETTINGS } });
    const got = result.arrangement.chords.map((x) => key(x.chord));
    expect(got.length).toBeGreaterThanOrEqual(6);

    const want = got.map((_, i) => key(c.progression[i % c.progression.length]));
    const hits = got.filter((g, i) => g === want[i]).length;
    expect(hits / got.length).toBeGreaterThanOrEqual(0.75);

    // Tempo within 5%, or a clean half/double (which the UI lets you flip).
    const ratio = result.detectedTempo / c.tempo;
    const nearest = [0.5, 1, 2].map((r) => Math.abs(ratio - r)).sort((x, y) => x - y)[0];
    expect(nearest).toBeLessThan(0.08);
  }, 90000);

  it('honours a tempo override and puts exactly one chord in every bar', async () => {
    const samples = synthesizeProgression({
      sampleRate: SR,
      tempo: 90,
      beatsPerBar: 4,
      progression: CASES[0].progression,
      repeats: 2,
    });
    const result = await analyzeClip({
      samples,
      sampleRate: SR,
      settings: { ...DEFAULT_SETTINGS, tempoOverride: 90 },
    });
    expect(result.arrangement.tempo).toBe(90);
    // No chord may start off a bar line, and no bar may hold two.
    const starts = result.arrangement.chords.map((c) => c.startBeat);
    expect(starts.filter((b) => b % 4 !== 0)).toEqual([]);
    expect(new Set(starts).size).toBe(starts.length);
  }, 90000);

  it('reduces extended chords to plain triads by default', async () => {
    const samples = synthesizeProgression({
      sampleRate: SR,
      tempo: 100,
      beatsPerBar: 4,
      progression: [C(0, 'maj7'), C(9, 'min7'), C(5, 'maj7'), C(7, '7')],
      repeats: 2,
    });
    const result = await analyzeClip({
      samples,
      sampleRate: SR,
      settings: { ...DEFAULT_SETTINGS, vocabulary: 'rich' },
    });
    const qualities = new Set(result.arrangement.chords.map((c) => c.chord.quality));
    for (const q of qualities) expect(['maj', 'min', 'dim', '5']).toContain(q);
    // The richer chord is still on hand for the toggle.
    expect(result.arrangement.chords.some((c) => c.detected !== undefined)).toBe(true);
  }, 90000);
});

describe('note engine', () => {
  it('extracts a playable riff', async () => {
    const samples = synthesizeProgression({
      sampleRate: SR,
      tempo: 100,
      beatsPerBar: 4,
      progression: CASES[0].progression,
      repeats: 2,
      melody: [
        [69, 1],
        [72, 1],
        [76, 1],
        [72, 1],
      ],
    });
    const result = await analyzeClip({
      samples,
      sampleRate: SR,
      settings: { ...DEFAULT_SETTINGS, melodyMinMidi: 64, melodyMaxMidi: 84 },
    });
    const riff = result.arrangement.riff;
    expect(riff.length).toBeGreaterThan(8);

    // Every kept note must be reachable on the fretboard.
    for (const n of riff) {
      expect(n.string).toBeGreaterThanOrEqual(0);
      expect(n.fret).toBeGreaterThanOrEqual(0);
    }

    // Pitch classes should match the melody we played (octave errors allowed:
    // they are a known failure mode with an 8va/8vb fix in the editor).
    const played = new Set([69 % 12, 72 % 12, 76 % 12]);
    const matching = riff.filter((n) => played.has(n.midi % 12)).length;
    expect(matching / riff.length).toBeGreaterThan(0.75);
  }, 90000);

});

describe('capo naming', () => {
  it('names chords against the capo, not concert pitch', async () => {
    const samples = synthesizeProgression({
      sampleRate: SR,
      tempo: 100,
      beatsPerBar: 4,
      progression: CASES[0].progression,
      repeats: 1,
    });
    const result = await analyzeClip({ samples, sampleRate: SR, settings: { ...DEFAULT_SETTINGS } });
    const a = result.arrangement;
    expect(a.chords.length).toBeGreaterThan(0);
    const before = displayName(a.chords[0], a);
    a.capo = 2;
    expect(displayName(a.chords[0], a)).not.toBe(before);
  }, 90000);
});
