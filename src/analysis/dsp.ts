/**
 * Pure-TypeScript signal processing.
 *
 * This is the fallback path when Essentia's WASM build is unavailable, and it
 * also supplies the pieces Essentia does not give us in a convenient shape
 * (spectral flux onsets, harmonic-sum melody salience). Everything here is
 * plain arrays so it can be unit tested in Node.
 */

export const ANALYSIS_SAMPLE_RATE = 22050;

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 FFT. `re`/`im` must be a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return w;
}

/** Magnitude spectrum (bins 0..N/2) of one windowed frame. */
export function magnitudeSpectrum(frame: Float32Array, window: Float32Array): Float32Array {
  const n = frame.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * window[i];
  fft(re, im);
  const half = n / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

export interface FrameSpec {
  frameSize: number;
  hopSize: number;
}

export function frameCount(length: number, spec: FrameSpec): number {
  if (length < spec.frameSize) return 0;
  return 1 + Math.floor((length - spec.frameSize) / spec.hopSize);
}

export function* frames(signal: Float32Array, spec: FrameSpec): Generator<Float32Array> {
  const n = frameCount(signal.length, spec);
  for (let i = 0; i < n; i++) {
    yield signal.subarray(i * spec.hopSize, i * spec.hopSize + spec.frameSize);
  }
}

// ---------------------------------------------------------------------------
// Spectral peaks
// ---------------------------------------------------------------------------

export interface SpectralPeak {
  freq: number;
  mag: number;
}

/** Local maxima with parabolic interpolation, strongest first. */
export function spectralPeaks(
  mag: Float32Array,
  sampleRate: number,
  opts: { minFreq?: number; maxFreq?: number; maxPeaks?: number; threshold?: number } = {},
): SpectralPeak[] {
  const minFreq = opts.minFreq ?? 60;
  const maxFreq = opts.maxFreq ?? 5000;
  const maxPeaks = opts.maxPeaks ?? 60;
  const n = mag.length;
  const binHz = sampleRate / (n * 2);
  let peak = 0;
  for (let i = 0; i < n; i++) if (mag[i] > peak) peak = mag[i];
  if (peak <= 0) return [];
  const floor = peak * (opts.threshold ?? 0.005);

  const peaks: SpectralPeak[] = [];
  const lo = Math.max(1, Math.floor(minFreq / binHz));
  const hi = Math.min(n - 2, Math.ceil(maxFreq / binHz));
  for (let i = lo; i <= hi; i++) {
    const m = mag[i];
    if (m <= mag[i - 1] || m < mag[i + 1] || m < floor) continue;
    // Parabolic interpolation around the peak bin.
    const a = mag[i - 1];
    const b = m;
    const c = mag[i + 1];
    const denom = a - 2 * b + c;
    const delta = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    peaks.push({ freq: (i + delta) * binHz, mag: b - 0.25 * (a - c) * delta });
  }
  peaks.sort((x, y) => y.mag - x.mag);
  return peaks.slice(0, maxPeaks);
}

// ---------------------------------------------------------------------------
// Chroma / HPCP
// ---------------------------------------------------------------------------

export interface ChromaOptions {
  sampleRate: number;
  frameSize?: number;
  hopSize?: number;
  /** Pitch range filter, in MIDI, to keep bass and vocals from leaking in. */
  minMidi?: number;
  maxMidi?: number;
  /** Harmonics folded back onto the fundamental. */
  harmonics?: number;
}

export interface ChromaResult {
  /** One 12-element vector per frame, L-infinity normalised. */
  frames: Float32Array[];
  times: number[];
  hopSeconds: number;
  /** Estimated tuning offset in semitones (-0.5 .. 0.5). */
  tuningOffset: number;
}

const SUBBINS = 36; // 3 bins per semitone, so we can find the tuning offset

/**
 * Harmonic pitch class profile.
 *
 * Peaks are folded onto a 36-bin circle with a raised-cosine spread, each peak
 * also voting for the fundamentals it could be the 2nd..Nth harmonic of. That
 * is what lets it read a chord through distortion and reverb: the harmonic
 * votes reinforce the real roots and smear the phantom partials.
 */
export function computeChroma(signal: Float32Array, opts: ChromaOptions): ChromaResult {
  const sampleRate = opts.sampleRate;
  const frameSize = opts.frameSize ?? 4096;
  const hopSize = opts.hopSize ?? 1024;
  const minMidi = opts.minMidi ?? 40; // low E
  const maxMidi = opts.maxMidi ?? 84; // C6
  const harmonics = opts.harmonics ?? 4;
  const harmonicWeights = Array.from({ length: harmonics }, (_, i) => Math.pow(0.6, i));

  const minFreq = 440 * Math.pow(2, (minMidi - 69) / 12) * 0.97;
  const maxFreq = 440 * Math.pow(2, (maxMidi - 69) / 12) * 1.03;

  const window = hannWindow(frameSize);
  const spec: FrameSpec = { frameSize, hopSize };
  const out: Float32Array[] = [];
  const times: number[] = [];
  const subTotals = new Float64Array(SUBBINS);

  let index = 0;
  for (const frame of frames(signal, spec)) {
    const mag = magnitudeSpectrum(frame, window);
    const peaks = spectralPeaks(mag, sampleRate, {
      minFreq: minFreq * 0.5,
      maxFreq: Math.min(maxFreq * harmonics, sampleRate / 2 - 100),
      maxPeaks: 80,
    });
    const sub = new Float64Array(SUBBINS);
    for (const p of peaks) {
      const energy = p.mag * p.mag;
      for (let h = 1; h <= harmonics; h++) {
        const f0 = p.freq / h;
        if (f0 < minFreq || f0 > maxFreq) continue;
        const midi = 69 + 12 * Math.log2(f0 / 440);
        const pos = (midi * 3) % SUBBINS;
        const w = energy * harmonicWeights[h - 1];
        // Raised-cosine spread over +/-1 sub-bin so tuning drift is tolerated.
        for (let d = -1; d <= 1; d++) {
          const bin = ((Math.round(pos) + d) % SUBBINS + SUBBINS) % SUBBINS;
          const dist = Math.abs(pos - (Math.round(pos) + d));
          if (dist > 1) continue;
          sub[bin] += w * 0.5 * (1 + Math.cos(Math.PI * dist));
        }
      }
    }
    for (let i = 0; i < SUBBINS; i++) subTotals[i] += sub[i];
    out.push(subToFloat(sub));
    times.push((index * hopSize) / sampleRate);
    index++;
  }

  // Global tuning: which third-of-a-semitone carries the most energy.
  let bestOffsetBin = 0;
  let bestEnergy = -1;
  for (let o = 0; o < 3; o++) {
    let e = 0;
    for (let s = o; s < SUBBINS; s += 3) e += subTotals[s];
    if (e > bestEnergy) {
      bestEnergy = e;
      bestOffsetBin = o;
    }
  }
  const tuningOffset = bestOffsetBin === 2 ? -1 / 3 : bestOffsetBin / 3;

  const folded = out.map((sub36) => foldTo12(sub36, bestOffsetBin));
  return { frames: folded, times, hopSeconds: hopSize / sampleRate, tuningOffset };
}

function subToFloat(sub: Float64Array): Float32Array {
  const f = new Float32Array(SUBBINS);
  for (let i = 0; i < SUBBINS; i++) f[i] = sub[i];
  return f;
}

function foldTo12(sub36: Float32Array, offsetBin: number): Float32Array {
  const out = new Float32Array(12);
  for (let pc = 0; pc < 12; pc++) {
    let v = 0;
    for (let d = -1; d <= 1; d++) {
      const bin = ((pc * 3 + offsetBin + d) % SUBBINS + SUBBINS) % SUBBINS;
      v += sub36[bin] * (d === 0 ? 1 : 0.5);
    }
    out[pc] = v;
  }
  return normalizeMax(out);
}

export function normalizeMax(v: Float32Array): Float32Array {
  let max = 0;
  for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
  if (max <= 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / max;
  return out;
}

// ---------------------------------------------------------------------------
// Onsets and tempo
// ---------------------------------------------------------------------------

export interface OnsetResult {
  /** Half-wave rectified spectral flux, one value per ODF frame. */
  odf: Float32Array;
  hopSeconds: number;
  onsetTimes: number[];
  density: number;
}

export function detectOnsets(signal: Float32Array, sampleRate: number): OnsetResult {
  const frameSize = 1024;
  const hopSize = 256;
  const window = hannWindow(frameSize);
  const spec: FrameSpec = { frameSize, hopSize };
  const n = frameCount(signal.length, spec);
  const odf = new Float32Array(Math.max(0, n));
  let prev: Float32Array | null = null;
  let i = 0;
  for (const frame of frames(signal, spec)) {
    const mag = magnitudeSpectrum(frame, window);
    if (prev) {
      let flux = 0;
      for (let k = 1; k < mag.length; k++) {
        const d = Math.log1p(mag[k] * 100) - Math.log1p(prev[k] * 100);
        if (d > 0) flux += d;
      }
      odf[i] = flux;
    }
    prev = mag;
    i++;
  }

  const hopSeconds = hopSize / sampleRate;
  const smoothed = subtractMovingAverage(odf, Math.round(0.12 / hopSeconds));
  const onsetTimes: number[] = [];
  let peak = 0;
  for (let k = 0; k < smoothed.length; k++) if (smoothed[k] > peak) peak = smoothed[k];
  const thresh = peak * 0.18;
  let lastOnset = -Infinity;
  for (let k = 1; k < smoothed.length - 1; k++) {
    if (
      smoothed[k] > thresh &&
      smoothed[k] >= smoothed[k - 1] &&
      smoothed[k] > smoothed[k + 1] &&
      k * hopSeconds - lastOnset > 0.05
    ) {
      onsetTimes.push(k * hopSeconds);
      lastOnset = k * hopSeconds;
    }
  }
  const duration = signal.length / sampleRate;
  return {
    odf: smoothed,
    hopSeconds,
    onsetTimes,
    density: duration > 0 ? onsetTimes.length / duration : 0,
  };
}

function subtractMovingAverage(v: Float32Array, win: number): Float32Array {
  const out = new Float32Array(v.length);
  const w = Math.max(1, win);
  let sum = 0;
  const queue: number[] = [];
  for (let i = 0; i < v.length; i++) {
    queue.push(v[i]);
    sum += v[i];
    if (queue.length > w) sum -= queue.shift()!;
    const mean = sum / queue.length;
    out[i] = Math.max(0, v[i] - mean);
  }
  return out;
}

export interface TempoResult {
  bpm: number;
  /** Time of the first beat, in seconds from the start of the clip. */
  phase: number;
  beats: number[];
  confidence: number;
}

/**
 * Tempo by autocorrelation of the onset function, with the phase recovered by
 * cross-correlating a pulse train.
 */
export function estimateTempo(
  onsets: OnsetResult,
  duration: number,
  range: { min?: number; max?: number } = {},
): TempoResult {
  const minBpm = range.min ?? 60;
  const maxBpm = range.max ?? 190;
  const { odf, hopSeconds } = onsets;
  if (odf.length < 16 || duration <= 0) {
    return { bpm: 120, phase: 0, beats: [], confidence: 0 };
  }

  const minLag = Math.max(2, Math.floor(60 / maxBpm / hopSeconds));
  const maxLag = Math.min(odf.length - 2, Math.ceil(60 / minBpm / hopSeconds));

  let mean = 0;
  for (let i = 0; i < odf.length; i++) mean += odf[i];
  mean /= odf.length;

  const scores: { lag: number; score: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    let count = 0;
    for (let i = 0; i + lag < odf.length; i++) {
      s += (odf[i] - mean) * (odf[i + lag] - mean);
      count++;
    }
    if (count === 0) continue;
    let score = s / count;
    // Nudge towards tempi a teacher would actually count.
    const bpm = 60 / (lag * hopSeconds);
    score *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 112) / 0.85, 2));
    scores.push({ lag, score });
  }
  if (scores.length === 0) return { bpm: 120, phase: 0, beats: [], confidence: 0 };
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const bpm = 60 / (best.lag * hopSeconds);

  // Phase: slide a pulse train over the ODF and take the best alignment.
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let p = 0; p < best.lag; p++) {
    let s = 0;
    for (let i = p; i < odf.length; i += best.lag) s += odf[i];
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = p;
    }
  }

  const beatPeriod = best.lag * hopSeconds;
  const beats: number[] = [];
  for (let t = bestPhase * hopSeconds; t < duration; t += beatPeriod) beats.push(t);

  const secondScore = scores[1]?.score ?? 0;
  const confidence = best.score > 0 ? Math.max(0, Math.min(1, 1 - secondScore / best.score)) : 0;
  return { bpm, phase: bestPhase * hopSeconds, beats, confidence };
}

/**
 * Best beat-grid offset for a given tempo: slide a pulse train over the onset
 * function and take the alignment with the most energy under it.
 */
export function estimateBeatPhase(onsets: OnsetResult, bpm: number): number {
  const { odf, hopSeconds } = onsets;
  const lag = Math.max(2, Math.round(60 / bpm / hopSeconds));
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let p = 0; p < lag && p < odf.length; p++) {
    let s = 0;
    for (let i = p; i < odf.length; i += lag) s += odf[i];
    if (s > bestScore) {
      bestScore = s;
      bestPhase = p;
    }
  }
  return bestPhase * hopSeconds;
}

/** Regenerate a beat grid from overridden tempo/phase values. */
export function beatGrid(bpm: number, phase: number, duration: number): number[] {
  const period = 60 / bpm;
  const beats: number[] = [];
  for (let t = phase; t < duration + 1e-6; t += period) beats.push(t);
  return beats;
}

// ---------------------------------------------------------------------------
// Monophonic pitch salience (melody / riff)
// ---------------------------------------------------------------------------

export interface PitchTrackOptions {
  sampleRate: number;
  minMidi?: number;
  maxMidi?: number;
  frameSize?: number;
  hopSize?: number;
  harmonics?: number;
}

export interface PitchTrack {
  /** Fractional MIDI per frame; NaN where nothing convincing was found. */
  midi: Float32Array;
  salience: Float32Array;
  times: number[];
  hopSeconds: number;
}

/**
 * Harmonic-sum pitch tracking.
 *
 * Deliberately monophonic: it looks for the single strongest melodic line in a
 * register window, which is what the "main riff" tier needs.
 */
export function trackPitch(signal: Float32Array, opts: PitchTrackOptions): PitchTrack {
  const sampleRate = opts.sampleRate;
  const frameSize = opts.frameSize ?? 4096;
  const hopSize = opts.hopSize ?? 512;
  const minMidi = opts.minMidi ?? 45;
  const maxMidi = opts.maxMidi ?? 84;
  const harmonics = opts.harmonics ?? 6;
  const window = hannWindow(frameSize);
  const spec: FrameSpec = { frameSize, hopSize };
  const n = frameCount(signal.length, spec);

  const midiOut = new Float32Array(n).fill(NaN);
  const salOut = new Float32Array(n);
  const times: number[] = [];
  const binHz = sampleRate / frameSize;

  // Quarter-tone grid keeps bends and slightly flat tracks from snapping wrong.
  const steps: number[] = [];
  for (let m = minMidi; m <= maxMidi; m += 0.5) steps.push(m);

  // Pass 1: strongest fundamental per frame, plus how peaked that choice was.
  const rawSalience = new Float32Array(n);
  const peakiness = new Float32Array(n);
  let idx = 0;
  for (const frame of frames(signal, spec)) {
    const mag = magnitudeSpectrum(frame, window);
    let bestSal = 0;
    let bestMidi = NaN;
    let total = 1e-9;
    for (const m of steps) {
      const f0 = 440 * Math.pow(2, (m - 69) / 12);
      let s = 0;
      for (let h = 1; h <= harmonics; h++) {
        const bin = (f0 * h) / binHz;
        const b = Math.round(bin);
        if (b < 1 || b >= mag.length - 1) break;
        // Take the local max so slight mistuning does not fall between bins.
        const v = Math.max(mag[b - 1], mag[b], mag[b + 1]);
        s += v / Math.sqrt(h);
      }
      total += s;
      if (s > bestSal) {
        bestSal = s;
        bestMidi = m;
      }
    }
    midiOut[idx] = bestMidi;
    rawSalience[idx] = bestSal;
    // Peak-to-average: a real melodic note stands well clear of the field.
    const mean = total / steps.length;
    peakiness[idx] = mean > 0 ? bestSal / mean : 0;
    times.push((idx * hopSize) / sampleRate);
    idx++;
  }

  // Pass 2: normalise into a 0..1 confidence. Strength is relative to the
  // loudest melodic frame in the clip, scaled by how peaked the choice was, so
  // the threshold in the UI means the same thing on a quiet and a loud take.
  let maxSalience = 0;
  for (let i = 0; i < n; i++) if (rawSalience[i] > maxSalience) maxSalience = rawSalience[i];
  for (let i = 0; i < n; i++) {
    const strength = maxSalience > 0 ? rawSalience[i] / maxSalience : 0;
    const peaked = Math.max(0, Math.min(1, (peakiness[i] - 2) / 10));
    salOut[i] = Math.sqrt(strength * peaked);
  }

  return { midi: midiOut, salience: salOut, times, hopSeconds: hopSize / sampleRate };
}

// ---------------------------------------------------------------------------
// Resampling
// ---------------------------------------------------------------------------

/** Linear-interpolation resample. Good enough ahead of an STFT. */
export function resample(signal: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return signal;
  const ratio = from / to;
  const outLength = Math.floor(signal.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(signal.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = signal[i0] * (1 - frac) + signal[i1] * frac;
  }
  return out;
}
