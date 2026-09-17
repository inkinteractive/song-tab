/**
 * Phase 2 stub: Spotify Basic Pitch (@spotify/basic-pitch on onnxruntime-web).
 *
 * Polyphonic note transcription for the Full reference tier. Not wired up yet -
 * phase 1 uses the monophonic tracker in `dsp.ts` for every tier that needs
 * notes, which is honest about what it can do on a dense mix.
 *
 * When this lands:
 *   1. `npm i @spotify/basic-pitch onnxruntime-web`
 *   2. Serve the model from `public/models/basic-pitch/` (or a CDN).
 *   3. Resample the clip to 22050 Hz mono (Basic Pitch's expected rate).
 *   4. Feed `noteFramesToTime` output through `mapNotesToFrets`.
 */

import type { RiffNote } from '../types';

export interface BasicPitchOptions {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLengthMs: number;
  minMidi: number;
  maxMidi: number;
}

export interface BasicPitchAvailability {
  available: boolean;
  reason: string;
}

export function basicPitchAvailability(): BasicPitchAvailability {
  return {
    available: false,
    reason:
      'Basic Pitch (polyphonic note transcription) ships in phase 2. The Full tier currently runs the phase-1 monophonic tracker, so it will miss simultaneous voices.',
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function transcribeWithBasicPitch(
  _signal: Float32Array,
  _sampleRate: number,
  _opts: BasicPitchOptions,
): Promise<RiffNote[] | null> {
  return null;
}
