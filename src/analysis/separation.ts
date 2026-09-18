/**
 * Guitar isolation (phase 2).
 *
 * Posts the trimmed clip to a small Demucs service (see `server/`) and gets one
 * stem back. Guitars mostly land in Demucs' `other` stem; on a vocal-heavy
 * track, pulling the voice out is often enough on its own, because a vocal line
 * is what most confuses the note engine.
 *
 * Every failure path is soft: if the service is absent, slow or broken, the app
 * analyses the raw capture and says so.
 */

export type Stem = 'other' | 'vocals' | 'drums' | 'bass';

export interface SeparationConfig {
  /** Base URL of the separation service, e.g. http://localhost:8000 */
  endpoint: string | null;
  model: 'htdemucs' | 'htdemucs_ft';
  stem: Stem;
}

export const DEFAULT_SEPARATION: SeparationConfig = {
  endpoint: null,
  model: 'htdemucs',
  stem: 'other',
};

export const STEM_LABELS: Record<Stem, string> = {
  other: 'other - guitars, keys, everything not voice/bass/drums',
  vocals: 'vocals - isolate the voice',
  bass: 'bass',
  drums: 'drums',
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
        'Not configured. Start the Demucs service in `server/` and put its URL here; until then the raw capture is analysed directly.',
    };
  }
  return { available: true, reason: `${config.model} → ${config.stem} stem, via ${config.endpoint}` };
}

export interface ServiceHealth {
  reachable: boolean;
  backendInstalled: boolean;
  models: string[];
  message: string;
}

export async function probeService(endpoint: string, signal?: AbortSignal): Promise<ServiceHealth> {
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/health`, { signal });
    if (!res.ok) {
      return { reachable: false, backendInstalled: false, models: [], message: `Service answered ${res.status}.` };
    }
    const body = (await res.json()) as { models?: string[]; backend_installed?: boolean };
    return {
      reachable: true,
      backendInstalled: Boolean(body.backend_installed),
      models: body.models ?? [],
      message: body.backend_installed
        ? `Ready. Models: ${(body.models ?? []).join(', ')}.`
        : 'Service is up but Demucs is not installed on it. See server/README.md.',
    };
  } catch (err) {
    return {
      reachable: false,
      backendInstalled: false,
      models: [],
      message: err instanceof Error ? err.message : 'Could not reach the service.',
    };
  }
}

/** Posts a clip for separation. Throws with a readable message on failure. */
export async function separateStem(
  wav: Blob,
  config: SeparationConfig,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!config.endpoint) throw new Error('No separation service configured.');
  const form = new FormData();
  form.append('audio', wav, 'clip.wav');
  form.append('model', config.model);
  form.append('stem', config.stem);

  const res = await fetch(`${config.endpoint.replace(/\/$/, '')}/separate`, {
    method: 'POST',
    body: form,
    signal,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* not JSON; the status line is all we have */
    }
    throw new Error(detail);
  }
  return res.arrayBuffer();
}
