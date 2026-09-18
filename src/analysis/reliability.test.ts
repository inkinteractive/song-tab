/**
 * The verdict has to separate a progression a teacher can hand over from the
 * one the app produced for a dense rock mix. The "poor" case below is the real
 * output from a run against Black Hole Sun, typed out by hand from the chart.
 */

import { describe, expect, it } from 'vitest';
import { assessProgression } from './reliability';
import { parsePitchClass, type Chord, type ChordQuality, type MusicalKey } from '../music/theory';
import type { BarChord } from '../types';

function bars(spec: string, confidence = 0.7): BarChord[] {
  return spec.split(/\s+/).map((name, i) => {
    const m = /^([A-G][#b]?)(m)?$/.exec(name);
    if (!m) throw new Error(`bad chord in test spec: ${name}`);
    const root = parsePitchClass(m[1]);
    if (root === null) throw new Error(`bad root: ${m[1]}`);
    const chord: Chord = { root, quality: (m[2] ? 'min' : 'maj') as ChordQuality };
    return { id: `b${i}`, startBeat: i * 4, durationBeats: 4, chord, confidence };
  });
}

const C_MAJOR: MusicalKey = { tonic: 0, mode: 'major' };
const B_MAJOR: MusicalKey = { tonic: 11, mode: 'major' };

describe('progression reliability', () => {
  it('passes a progression that sits in its key and reuses its chords', () => {
    const r = assessProgression(bars('Am F C G Am F C G Am F C G'), C_MAJOR);
    expect(r.verdict).toBe('good');
    expect(r.diatonicFit).toBe(1);
    expect(r.rootChurn).toBeCloseTo(4 / 12, 5);
  });

  it('fails the run the app actually produced for a dense mix', () => {
    // Eight roots in eleven slots, F and Fm adjacent, nothing holding a key.
    const r = assessProgression(bars('C# B B C# F Fm A B A# D# D#'), B_MAJOR);
    expect(r.verdict).toBe('poor');
    expect(r.diatonicFit).toBeLessThan(0.45);
  });

  it('flags a chart the teacher should check rather than condemn', () => {
    // Mostly C major, but a third of it is borrowed - worth a second look.
    const r = assessProgression(bars('C G Am F Ab Eb Bb F'), C_MAJOR);
    expect(r.verdict).toBe('mixed');
  });

  it('leaves a busy but wholly diatonic progression alone', () => {
    // Six roots in eight bars is high churn, and also just a scale walk.
    // Churn on its own is not evidence of anything.
    const r = assessProgression(bars('C Dm Em F G Am C G'), C_MAJOR);
    expect(r.diatonicFit).toBe(1);
    expect(r.rootChurn).toBeGreaterThan(0.6);
    expect(r.verdict).toBe('good');
  });

  it('flags high churn once the fit is already doubtful', () => {
    // Bm is the one chord here that C major does not contain (F#), which puts
    // the fit at 0.875 - not low enough to fail on its own, but enough that
    // seven roots in eight bars stops looking like a decision and starts
    // looking like a smear.
    const r = assessProgression(bars('C Dm Em F G Am Bm C'), C_MAJOR);
    expect(r.diatonicFit).toBeCloseTo(0.875, 5);
    expect(r.diatonicFit).toBeGreaterThan(0.7); // the fit rule alone would pass it
    expect(r.rootChurn).toBeGreaterThan(0.6);
    expect(r.verdict).toBe('mixed');
  });

  it('does not judge a chart by the decoder confidence', () => {
    // A softmax over 97 templates gives a flawless detection about 0.2, so a
    // low number here means nothing on its own.
    const low = assessProgression(bars('Am F C G Am F C G', 0.05), C_MAJOR);
    expect(low.verdict).toBe('good');
    expect(low.meanConfidence).toBeCloseTo(0.05, 5);
  });

  it('says nothing about a chart too short to judge', () => {
    expect(assessProgression(bars('C#'), C_MAJOR).verdict).toBe('good');
  });
});
