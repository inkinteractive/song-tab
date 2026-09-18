/**
 * Spotify's Basic Pitch - polyphonic note transcription for the Full tier.
 *
 * Two deliberate departures from the original plan:
 *
 * - It runs on **TensorFlow.js**, not onnxruntime-web. That is simply what
 *   `@spotify/basic-pitch` ships; the model is bundled in the package rather
 *   than fetched from a CDN, so the Full tier works offline.
 * - It runs on the **main thread**, unlike the chord engine. tfjs can only
 *   reach WebGL from a document, and on the CPU backend a lesson-length clip
 *   takes long enough to be useless. `evaluateModel` is async and reports
 *   progress, so the UI still breathes.
 */

import type { RiffNote } from '../types';
import { ANALYSIS_SAMPLE_RATE, resample } from './dsp';
import { midiToFreq } from '../music/theory';

export interface BasicPitchOptions {
  /** 0..1; higher means fewer, more certain note starts. */
  onsetThreshold: number;
  /** 0..1; how much energy a frame needs to count as the note continuing. */
  frameThreshold: number;
  minNoteLengthMs: number;
  minMidi: number;
  maxMidi: number;
  /** Beat 0 of the arrangement, in seconds into the clip. */
  beatOffset: number;
  tempo: number;
  /** Quantisation grid in beats. 0 leaves the raw timing alone. */
  grid: number;
}

export interface BasicPitchAvailability {
  available: boolean;
  reason: string;
}

/** Basic Pitch's own frame rate: 256-sample hop at 22050 Hz. */
const MODEL_FRAME_SECONDS = 256 / ANALYSIS_SAMPLE_RATE;

function modelUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}models/basic-pitch/model.json`;
}

export function basicPitchAvailability(): BasicPitchAvailability {
  // A worker has no document, so tfjs cannot reach WebGL there.
  if (typeof document === 'undefined') {
    return { available: false, reason: 'Basic Pitch needs the main thread; it cannot run inside the analysis worker.' };
  }
  return {
    available: true,
    reason: 'Polyphonic transcription via Spotify Basic Pitch (TensorFlow.js). Slower than the chord engine, and approximate.',
  };
}

let cached: Promise<{ bp: unknown; lib: typeof import('@spotify/basic-pitch') }> | null = null;

async function load() {
  if (!cached) {
    cached = (async () => {
      const lib = await import('@spotify/basic-pitch');
      const bp = new lib.BasicPitch(modelUrl());
      return { bp, lib };
    })();
  }
  return cached;
}

/**
 * Transcribe a clip. Returns notes in arrangement beats, or `null` when the
 * model cannot run - the caller falls back to the phase 1 monophonic tracker.
 */
export async function transcribeWithBasicPitch(
  samples: Float32Array,
  sampleRate: number,
  opts: BasicPitchOptions,
  onProgress?: (percent: number) => void,
): Promise<RiffNote[] | null> {
  if (!basicPitchAvailability().available) return null;

  let lib: typeof import('@spotify/basic-pitch');
  let bp: InstanceType<typeof import('@spotify/basic-pitch').BasicPitch>;
  try {
    const loaded = await load();
    lib = loaded.lib;
    bp = loaded.bp as InstanceType<typeof import('@spotify/basic-pitch').BasicPitch>;
  } catch {
    cached = null;
    return null;
  }

  // Basic Pitch expects 22050 Hz mono, which is what the rest of the analysis
  // path already works at.
  const audio = resample(samples, sampleRate, ANALYSIS_SAMPLE_RATE);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  try {
    await bp.evaluateModel(
      audio,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (percent) => onProgress?.(percent),
    );
  } catch {
    return null;
  }

  if (frames.length === 0) return [];

  const minNoteLenFrames = Math.max(1, Math.round(opts.minNoteLengthMs / 1000 / MODEL_FRAME_SECONDS));
  const events = lib.noteFramesToTime(
    lib.addPitchBendsToNoteEvents(
      contours,
      lib.outputToNotesPoly(
        frames,
        onsets,
        opts.onsetThreshold,
        opts.frameThreshold,
        minNoteLenFrames,
        true, // infer onsets the model did not flag outright
        midiToFreq(opts.maxMidi),
        midiToFreq(opts.minMidi),
        true, // melodia trick: keeps a melodic line intact through weak frames
      ),
    ),
  );

  const beatDuration = 60 / opts.tempo;
  const quantise = (seconds: number) => {
    const beat = (seconds - opts.beatOffset) / beatDuration;
    return opts.grid > 0 ? Math.round(beat / opts.grid) * opts.grid : beat;
  };

  const notes: RiffNote[] = [];
  events.forEach((e, i) => {
    const startBeat = quantise(e.startTimeSeconds);
    let durationBeats = quantise(e.startTimeSeconds + e.durationSeconds) - startBeat;
    if (durationBeats <= 0) durationBeats = opts.grid > 0 ? opts.grid : e.durationSeconds / beatDuration;
    if (startBeat < -(opts.grid || 0.25)) return;
    notes.push({
      id: `bp${i}-${e.pitchMidi}-${startBeat}`,
      startBeat: Math.max(0, startBeat),
      durationBeats,
      midi: Math.round(e.pitchMidi),
      confidence: Math.max(0, Math.min(1, e.amplitude)),
    });
  });

  return notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
}
