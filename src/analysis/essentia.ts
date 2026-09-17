/**
 * Essentia.js (WASM) adapter.
 *
 * Essentia is the preferred source for HPCP, tempo and key, but it is a 2.5MB
 * AGPL WASM bundle that can fail to load (CSP, memory, offline). Every entry
 * point here returns `null` on failure so the caller can drop to the pure-TS
 * implementations in `dsp.ts` without the app noticing.
 */

import { ANALYSIS_SAMPLE_RATE } from './dsp';

export type EssentiaBackend = 'essentia' | 'builtin';

interface EssentiaLike {
  arrayToVector(a: Float32Array): any;
  vectorToArray(v: any): Float32Array;
  FrameGenerator(a: Float32Array, frameSize: number, hopSize: number): any;
  Windowing(frame: any, ...rest: any[]): { frame: any };
  Spectrum(frame: any, ...rest: any[]): { spectrum: any };
  SpectralPeaks(spectrum: any, ...rest: any[]): { frequencies: any; magnitudes: any };
  HPCP(frequencies: any, magnitudes: any, ...rest: any[]): { hpcp: any };
  KeyExtractor(signal: any, ...rest: any[]): { key: string; scale: string; strength: number };
  RhythmExtractor2013(signal: any, ...rest: any[]): { bpm: number; ticks: any; confidence: number };
  PercivalBpmEstimator(signal: any, ...rest: any[]): { bpm: number };
  delete?(): void;
}

let cached: EssentiaLike | null | undefined;
let loadError: string | null = null;

/** Loads (once) and caches the Essentia instance. `null` means unavailable. */
export async function getEssentia(): Promise<EssentiaLike | null> {
  if (cached !== undefined) return cached;
  try {
    const [wasmMod, coreMod] = await Promise.all([
      import('essentia.js/dist/essentia-wasm.es.js'),
      import('essentia.js/dist/essentia.js-core.es.js'),
    ]);
    const EssentiaWASM = (wasmMod as any).EssentiaWASM ?? (wasmMod as any).default;
    const Essentia = (coreMod as any).default ?? (coreMod as any).Essentia;
    if (!EssentiaWASM || !Essentia) throw new Error('unexpected essentia.js module shape');
    cached = new Essentia(EssentiaWASM) as EssentiaLike;
    return cached;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    cached = null;
    return null;
  }
}

export function essentiaLoadError(): string | null {
  return loadError;
}

function free(...objs: any[]) {
  for (const o of objs) {
    try {
      o?.delete?.();
    } catch {
      /* the WASM heap is already gone; nothing useful to do */
    }
  }
}

/** HPCP frames via Essentia. Returns `null` if anything in the chain fails. */
export async function essentiaHpcp(
  signal: Float32Array,
  sampleRate: number,
  opts: { frameSize?: number; hopSize?: number; minFreq?: number; maxFreq?: number } = {},
): Promise<{ frames: Float32Array[]; times: number[]; hopSeconds: number } | null> {
  const frameSize = opts.frameSize ?? 4096;
  const hopSize = opts.hopSize ?? 1024;
  const minFreq = opts.minFreq ?? 60;
  const maxFreq = opts.maxFreq ?? 5000;
  const essentia = await getEssentia();
  if (!essentia) return null;
  let generator: any;
  try {
    generator = essentia.FrameGenerator(signal, frameSize, hopSize);
    const out: Float32Array[] = [];
    const times: number[] = [];
    const count = generator.size();
    for (let i = 0; i < count; i++) {
      const frame = generator.get(i);
      const windowed = essentia.Windowing(frame, true, frameSize, 'hann');
      const spec = essentia.Spectrum(windowed.frame, frameSize);
      const peaks = essentia.SpectralPeaks(spec.spectrum, 0, maxFreq, 100, minFreq, 'magnitude', sampleRate);
      const hpcp = essentia.HPCP(peaks.frequencies, peaks.magnitudes);
      const arr = essentia.vectorToArray(hpcp.hpcp);
      // Essentia's HPCP starts at A; rotate so index 0 is C, like everything else here.
      out.push(rotate(Float32Array.from(arr), 3));
      times.push((i * hopSize) / sampleRate);
      free(windowed.frame, spec.spectrum, peaks.frequencies, peaks.magnitudes, hpcp.hpcp);
    }
    return { frames: out, times, hopSeconds: hopSize / sampleRate };
  } catch {
    return null;
  } finally {
    free(generator);
  }
}

function rotate(v: Float32Array, by: number): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[(i + by) % v.length];
  return out;
}

export interface EssentiaRhythm {
  bpm: number;
  beats: number[];
  confidence: number;
}

export async function essentiaRhythm(signal: Float32Array): Promise<EssentiaRhythm | null> {
  const essentia = await getEssentia();
  if (!essentia) return null;
  let vec: any;
  try {
    vec = essentia.arrayToVector(signal);
    const r = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
    const beats = Array.from(essentia.vectorToArray(r.ticks));
    free(r.ticks);
    if (!Number.isFinite(r.bpm) || r.bpm <= 0) return null;
    // RhythmExtractor2013 reports confidence roughly on a 0..5.32 scale.
    return { bpm: r.bpm, beats, confidence: Math.max(0, Math.min(1, r.confidence / 5.32)) };
  } catch {
    try {
      const r = essentia.PercivalBpmEstimator(vec);
      if (!Number.isFinite(r?.bpm) || r.bpm <= 0) return null;
      return { bpm: r.bpm, beats: [], confidence: 0.4 };
    } catch {
      return null;
    }
  } finally {
    free(vec);
  }
}

export async function essentiaKey(
  signal: Float32Array,
): Promise<{ tonic: string; scale: string; strength: number } | null> {
  const essentia = await getEssentia();
  if (!essentia) return null;
  let vec: any;
  try {
    vec = essentia.arrayToVector(signal);
    const r = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'bgate', ANALYSIS_SAMPLE_RATE);
    if (!r?.key) return null;
    return { tonic: r.key, scale: r.scale, strength: r.strength };
  } catch {
    return null;
  } finally {
    free(vec);
  }
}

/**
 * No Essentia melody path on purpose.
 *
 * `PredominantPitchMelodia` takes twenty positional parameters in essentia.js
 * and is built for vocal melody over a full mix; getting it to behave on a
 * guitar register meant fighting it, and the harmonic-sum tracker in `dsp.ts`
 * tracked the line more reliably in testing. The note engine therefore always
 * runs the built-in tracker, and Basic Pitch (phase 2) is what replaces it.
 */
