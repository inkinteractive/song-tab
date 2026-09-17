import { describe, expect, it } from 'vitest';
import { chordName, parsePitchClass, romanNumeral, transposeChord, type Chord } from './theory';
import { bestShape, shapeMidiNotes, shapesForChord } from './chordShapes';
import { mapNotesToFrets, tuningById } from './fretboard';
import { bestCapoSuggestion, suggestCapos } from './capo';
import { suggestStrumPattern } from './strumming';

const C = (root: number, quality: Chord['quality'] = 'maj'): Chord => ({ root, quality });
const STANDARD = tuningById('standard').midi;

describe('theory', () => {
  it('parses and names pitch classes', () => {
    expect(parsePitchClass('F#')).toBe(6);
    expect(parsePitchClass('Bb')).toBe(10);
    expect(chordName(C(9, 'min'))).toBe('Am');
    expect(chordName(C(7, '7'))).toBe('G7');
    expect(chordName({ root: 0, quality: 'maj', bass: 4 })).toBe('C/E');
  });

  it('transposes chords around the octave', () => {
    expect(transposeChord(C(10), 3)).toEqual({ root: 1, quality: 'maj', bass: undefined });
    expect(transposeChord(C(0), -1).root).toBe(11);
  });

  it('labels diatonic degrees', () => {
    const key = { tonic: 0, mode: 'major' as const };
    expect(romanNumeral(C(0), key)).toBe('I');
    expect(romanNumeral(C(9, 'min'), key)).toBe('vi');
    expect(romanNumeral(C(6), key)).toBe(''); // F# is not in C major
  });
});

describe('chord shapes', () => {
  it('offers the open shape first for open-position chords', () => {
    for (const [root, quality] of [
      [7, 'maj'],
      [0, 'maj'],
      [2, 'maj'],
      [9, 'min'],
      [4, 'min'],
    ] as const) {
      const shape = bestShape(C(root, quality));
      expect(shape.kind === 'open' || shape.kind === 'easy').toBe(true);
    }
  });

  it('falls back to a barre for chords with no open shape', () => {
    const shape = bestShape(C(1, 'min')); // C#m
    expect(shape.kind).toBe('barre');
    expect(shape.barre?.fret).toBeGreaterThan(0);
  });

  it('never returns an empty shape list', () => {
    for (let root = 0; root < 12; root++) {
      for (const q of ['maj', 'min', '7', 'min7', 'maj7', 'dim', 'aug', 'sus2', 'sus4', 'add9', '6', 'min6', '5', 'm7b5', 'dim7'] as const) {
        const shapes = shapesForChord(C(root, q));
        expect(shapes.length, `${root}:${q}`).toBeGreaterThan(0);
        expect(shapes[0].frets.some((f) => f !== null)).toBe(true);
      }
    }
  });

  it('sounds the right notes for a voicing', () => {
    // Open G: 3-2-0-0-0-3 sounds G B D G B G.
    const g = shapesForChord(C(7)).find((s) => s.frets.join(',') === '3,2,0,0,0,3');
    expect(g).toBeDefined();
    const pcs = new Set(shapeMidiNotes(g!, STANDARD, 0).map((m) => m % 12));
    expect([...pcs].sort((a, b) => a - b)).toEqual([2, 7, 11]);
  });

  it('accounts for a capo when sounding a shape', () => {
    const open = bestShape(C(7));
    const withCapo = shapeMidiNotes(open, STANDARD, 2);
    const without = shapeMidiNotes(open, STANDARD, 0);
    expect(withCapo.every((m, i) => m === without[i] + 2)).toBe(true);
  });
});

describe('fretboard', () => {
  it('keeps a melodic line in one hand position', () => {
    // A major scale from A3 up - should not wander all over the neck.
    const line = [57, 59, 61, 62, 64, 66, 68, 69];
    const positions = mapNotesToFrets(line, { tuning: STANDARD, capo: 0 });
    const frets = positions.filter((p) => p !== null).map((p) => p!.fret);
    expect(frets.length).toBe(line.length);
    // Open strings are reachable from anywhere; the fretted notes are what has
    // to stay under one hand.
    const stopped = frets.filter((f) => f > 0);
    expect(Math.max(...stopped) - Math.min(...stopped)).toBeLessThanOrEqual(5);
  });

  it('returns null for notes below the lowest string', () => {
    const positions = mapNotesToFrets([30, 64], { tuning: STANDARD, capo: 0 });
    expect(positions[0]).toBeNull();
    expect(positions[1]).not.toBeNull();
  });

  it('reads frets relative to the capo', () => {
    // G4 is fret 3 on the high E string; with a capo at 3 it is the open string.
    const open = mapNotesToFrets([67], { tuning: STANDARD, capo: 0 })[0];
    const capo3 = mapNotesToFrets([67], { tuning: STANDARD, capo: 3 })[0];
    expect(open!.fret - capo3!.fret).toBe(3);
    expect(capo3!.fret).toBe(0);
  });
});

describe('capo helper', () => {
  it('turns a barre-heavy progression into open shapes', () => {
    // Bb - Eb - F - Cm: four barres at concert pitch.
    const chords = [C(10), C(3), C(5), C(0, 'min')].map((chord) => ({ chord, weight: 1 }));
    const suggestion = bestCapoSuggestion({ chords, key: { tonic: 10, mode: 'major' }, allowTranspose: false });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.capo).toBeGreaterThan(0);
    expect(suggestion!.openShapeCount).toBeGreaterThan(suggestion!.barreCount);
  });

  it('leaves an already-open progression alone', () => {
    const chords = [C(7), C(2), C(9, 'min'), C(0)].map((chord) => ({ chord, weight: 1 }));
    expect(bestCapoSuggestion({ chords, key: { tonic: 7, mode: 'major' } })).toBeNull();
  });

  it('always includes the no-capo baseline', () => {
    const options = suggestCapos({ chords: [{ chord: C(10), weight: 1 }], key: { tonic: 10, mode: 'major' } });
    expect(options.some((o) => o.capo === 0 && o.transpose === 0)).toBe(true);
  });
});

describe('strumming', () => {
  it('picks a pattern that suits the feel', () => {
    expect(suggestStrumPattern({ tempo: 60, beatsPerBar: 4 }).id).toBe('ballad');
    expect(suggestStrumPattern({ tempo: 100, beatsPerBar: 3 }).id).toBe('waltz');
    expect(suggestStrumPattern({ tempo: 170, beatsPerBar: 4 }).id).toBe('downs');
    expect(suggestStrumPattern({ tempo: 140, beatsPerBar: 4, onsetDensity: 6 }).id).toBe('pulse-eighths');
  });
});
