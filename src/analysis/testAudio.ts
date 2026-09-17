/**
 * Synthetic audio for the tests.
 *
 * Renders a chord progression (and optionally a melody) with enough harmonics,
 * a percussive transient per beat, and light noise that the analysis path is
 * exercised the way a real recording exercises it.
 */

import { chordPitchClasses, midiToFreq, type Chord } from '../music/theory';

export interface SynthOptions {
  sampleRate: number;
  tempo: number;
  beatsPerBar: number;
  /** One chord per bar. */
  progression: Chord[];
  /** Optional melody as [midi, durationInBeats] pairs, looping over the clip. */
  melody?: [number, number][];
  /** Extra partials per note - more means a denser, more "produced" sound. */
  harmonics?: number;
  noise?: number;
  /** Repeat the progression this many times. */
  repeats?: number;
}

export function synthesizeProgression(opts: SynthOptions): Float32Array {
  const { sampleRate, tempo, beatsPerBar, progression } = opts;
  const harmonics = opts.harmonics ?? 5;
  const noise = opts.noise ?? 0.01;
  const repeats = opts.repeats ?? 1;
  const beatSeconds = 60 / tempo;
  const barSeconds = beatSeconds * beatsPerBar;
  const totalBars = progression.length * repeats;
  const length = Math.ceil(totalBars * barSeconds * sampleRate);
  const out = new Float32Array(length);

  // Chords: voiced around the guitar's register, struck on every beat.
  for (let bar = 0; bar < totalBars; bar++) {
    const chord = progression[bar % progression.length];
    const pcs = chordPitchClasses(chord);
    const voicing = pcs.map((pc, i) => {
      const octave = i === 0 ? 3 : 4; // root low, the rest stacked above
      let midi = octave * 12 + 12 + pc;
      while (midi < 48) midi += 12;
      while (midi > 76) midi -= 12;
      return midi;
    });
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const start = (bar * barSeconds + beat * beatSeconds) * sampleRate;
      addStrum(out, start, beatSeconds * 1.1 * sampleRate, voicing, sampleRate, harmonics, 0.18);
      addClick(out, start, sampleRate);
    }
  }

  if (opts.melody) {
    let beatCursor = 0;
    let i = 0;
    const totalBeats = totalBars * beatsPerBar;
    while (beatCursor < totalBeats) {
      const [midi, durBeats] = opts.melody[i % opts.melody.length];
      const start = beatCursor * beatSeconds * sampleRate;
      addTone(out, start, durBeats * beatSeconds * 0.9 * sampleRate, midi, sampleRate, 6, 0.3);
      beatCursor += durBeats;
      i++;
    }
  }

  if (noise > 0) {
    let seed = 12345;
    for (let i = 0; i < out.length; i++) {
      // Deterministic LCG so tests do not flake.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] += ((seed / 0x7fffffff) * 2 - 1) * noise;
    }
  }

  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] /= peak * 1.05;
  return out;
}

function addStrum(
  out: Float32Array,
  start: number,
  duration: number,
  midis: number[],
  sampleRate: number,
  harmonics: number,
  gain: number,
) {
  midis.forEach((midi, i) => {
    addTone(out, start + i * 0.008 * sampleRate, duration, midi, sampleRate, harmonics, gain);
  });
}

function addTone(
  out: Float32Array,
  start: number,
  duration: number,
  midi: number,
  sampleRate: number,
  harmonics: number,
  gain: number,
) {
  const f0 = midiToFreq(midi);
  const s0 = Math.max(0, Math.floor(start));
  const s1 = Math.min(out.length, Math.floor(start + duration));
  for (let n = s0; n < s1; n++) {
    const t = (n - s0) / sampleRate;
    const env = Math.exp(-t * 2.2) * Math.min(1, t * 400);
    let v = 0;
    for (let h = 1; h <= harmonics; h++) {
      if (f0 * h > sampleRate / 2) break;
      v += Math.sin(2 * Math.PI * f0 * h * t) / (h * h);
    }
    out[n] += v * env * gain;
  }
}

function addClick(out: Float32Array, start: number, sampleRate: number) {
  const s0 = Math.max(0, Math.floor(start));
  const s1 = Math.min(out.length, s0 + Math.floor(sampleRate * 0.02));
  let seed = 7;
  for (let n = s0; n < s1; n++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const t = (n - s0) / sampleRate;
    out[n] += ((seed / 0x7fffffff) * 2 - 1) * Math.exp(-t * 160) * 0.12;
  }
}
