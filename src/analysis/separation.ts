/**
 * Phase 2 stub: guitar isolation.
 *
 * The plan is a small FastAPI service running Demucs (htdemucs) - see
 * `server/README.md`. The client posts the trimmed clip and gets back the
 * `other`/`guitar` stem, which then goes through the same analysis path.
 *
 * Phase 1 analyses the raw capture. That is fine for chords (the chord engine
 * reads through layering) and is the weak point for the note engine.
 */

export interface SeparationConfig {
  /** Base URL of the separation service, e.g. http://localhost:8000 */
  endpoint: string | null;
  model: 'htdemucs' | 'htdemucs_ft' | 'spleeter:4stems';
  stem: 'other' | 'vocals' | 'drums' | 'bass';
}

export const DEFAULT_SEPARATION: SeparationConfig = {
  endpoint: null,
  model: 'htdemucs',
  stem: 'other',
};

export interface SeparationStatus {
  available: boolean;
  reason: string;
}

export function separationStatus(config: SeparationConfig): SeparationStatus {
  if (!config.endpoint) {
    return {
      available: false,
      reason:
        'Guitar isolation is phase 2. Start the Demucs service in `server/` and set its URL to enable it; until then the raw capture is analysed directly.',
    };
  }
  return { available: true, reason: `Using ${config.model} at ${config.endpoint}` };
}

/** Posts a clip for separation. Returns null when the service is not configured. */
export async function separateStem(
  wav: Blob,
  config: SeparationConfig,
  signal?: AbortSignal,
): Promise<ArrayBuffer | null> {
  if (!config.endpoint) return null;
  const form = new FormData();
  form.append('audio', wav, 'clip.wav');
  form.append('model', config.model);
  form.append('stem', config.stem);
  const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/separate`, {
    method: 'POST',
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`Separation failed: ${res.status} ${res.statusText}`);
  return res.arrayBuffer();
}
