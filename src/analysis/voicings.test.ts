/**
 * What the engine makes of ordinary open-position guitar chords.
 *
 * The rest of the test suite feeds the analysis audio built from stacked
 * root-position triads, which is not how a guitar works: a guitar voices a
 * chord across six strings with doubled notes, open strings ringing, and the
 * root rarely the loudest thing in the room. This file plays the voicings out
 * of `chordShapes.ts` instead and records what comes back.
 *
 * **Three of the seven are wrong**, and the assertions below say so on purpose.
 * They are a characterisation test: they pin today's behaviour so a change to
 * the chord engine shows up as a failure here rather than as a teacher
 * noticing their C came back as something else. When one starts failing
 * because the naming got *better*, update it - that is the test doing its job.
 *
 * The measured cause is in the second describe block below.
 */

import { describe, expect, it } from 'vitest';
import { analyzeClip } from './engine';
import { ANALYSIS_SAMPLE_RATE, computeChroma } from './dsp';
import { chordName } from '../music/theory';
import { tuningById } from '../music/fretboard';
import { DEFAULT_SETTINGS } from '../types';

const SR = ANALYSIS_SAMPLE_RATE;
const TUNING = tuningById('standard').midi; // E2 A2 D3 G3 B3 E4
const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function voicing(frets: (number | null)[]): number[] {
  return frets.flatMap((f, s) => (f === null ? [] : [TUNING[s] + f]));
}

/** One plucked steel string: many partials, 1/h rolloff, high ones dying first. */
function pluck(out: Float32Array, start: number, midi: number, gain: number, seconds: number) {
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const s0 = Math.max(0, Math.floor(start * SR));
  const s1 = Math.min(out.length, s0 + Math.floor(seconds * SR));
  for (let n = s0; n < s1; n++) {
    const t = (n - s0) / SR;
    let v = 0;
    for (let h = 1; h <= 12; h++) {
      const f = f0 * h;
      if (f > SR / 2) break;
      v += (Math.sin(2 * Math.PI * f * t) / h) * Math.exp(-t * (1.1 + h * 0.35));
    }
    out[n] += v * gain * Math.min(1, t * 300);
  }
}

/** Four strums a bar, strings sounded low to high a few milliseconds apart. */
function render(frets: (number | null)[], bars = 6, barSeconds = 2.4): Float32Array {
  const midis = voicing(frets);
  const out = new Float32Array(Math.ceil(bars * barSeconds * SR) + SR);
  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      const at = b * barSeconds + beat * (barSeconds / 4);
      midis.forEach((m, i) => pluck(out, at + i * 0.012, m, 0.22, 3.2));
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak * 1.05;
  return out;
}

async function heard(frets: (number | null)[]): Promise<string> {
  const result = await analyzeClip({ samples: render(frets), sampleRate: SR, settings: { ...DEFAULT_SETTINGS } });
  const names = [...new Set(result.arrangement.chords.map((c) => chordName(c.chord)))];
  return names.join('/');
}

/** Loudest pitch class of the bass-register chroma the decoder is handed. */
function bassLeader(frets: (number | null)[]): string {
  const bass = computeChroma(render(frets, 3), { sampleRate: SR, minMidi: 28, maxMidi: 55, harmonics: 2 });
  const avg = new Array(12).fill(0);
  for (const f of bass.frames) for (let i = 0; i < 12; i++) avg[i] += f[i] / bass.frames.length;
  return PITCH_NAMES[avg.indexOf(Math.max(...avg))];
}

describe('open-position voicings', () => {
  it.each([
    ['x32010', 'C', 'C', [null, 3, 2, 0, 1, 0]],
    ['332010', 'C/G', 'C', [3, 3, 2, 0, 1, 0]],
    ['320003', 'G', 'G', [3, 2, 0, 0, 0, 3]],
    ['320013', 'Gsus4', 'G', [3, 2, 0, 0, 1, 3]],
    // --- wrong, and pinned so a fix is visible ------------------------------
    // Cadd9 and Cmaj7 both lose their root: E is the loudest pitch class in
    // each, and Em is a subset of Cmaj7, so the decoder takes it.
    ['x32033', 'Cadd9', 'Em', [null, 3, 2, 0, 3, 3]],
    ['x32000', 'Cmaj7', 'Em', [null, 3, 2, 0, 0, 0]],
    // A big G with the top two strings at the 3rd fret is G B D and nothing
    // else, but D is the loudest bin and the naming follows it.
    ['320033', 'G', 'D', [3, 2, 0, 0, 3, 3]],
  ])('%s played as %s is heard as %s', async (_frets, _played, expected, shape) => {
    expect(await heard(shape as (number | null)[])).toBe(expected);
  }, 120000);
});

describe('why', () => {
  /**
   * `engine.ts` builds a second chroma over MIDI 28-55 and feeds it to the
   * decoder as `bassChroma`, to "reinforce the root, which is what separates C
   * from Am7 or G from Em". It does not do that.
   *
   * MIDI 55 is G3, the open fourth string, so the window is not the bass - it
   * is the middle of the chord. On top of that `computeChroma` divides spectral
   * peaks by each harmonic number to guess fundamentals, so energy from the
   * ringing top strings lands inside the window too.
   *
   * The result is a term worth up to +0.66 on the wrong template and about
   * -0.11 on the right one, on every chord. It is the single largest thing
   * pushing these names around: the emission is
   * `cosine(frame, template) * 6 + keyBias + bassTerm`, and keyBias is ±0.05.
   */
  it('reinforces the third or the fifth, never the root', () => {
    const cases: [string, (number | null)[], string][] = [
      ['C', [null, 3, 2, 0, 1, 0], 'C'],
      ['Cmaj7', [null, 3, 2, 0, 0, 0], 'C'],
      ['G', [3, 2, 0, 0, 0, 3], 'G'],
      ['G 320033', [3, 2, 0, 0, 3, 3], 'G'],
    ];
    for (const [label, frets, root] of cases) {
      expect(bassLeader(frets), `${label}: bass chroma should not lead with ${root}`).not.toBe(root);
    }
  }, 120000);
});
