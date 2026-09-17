/**
 * Worker-backed entry point for analysis, with a main-thread fallback for
 * environments where module workers are unavailable.
 */

import type { AnalysisProgress, AnalysisResult, AnalysisSettings } from '../types';

export interface RunHandle {
  promise: Promise<AnalysisResult>;
  cancel(): void;
}

export function runAnalysis(
  samples: Float32Array,
  sampleRate: number,
  settings: AnalysisSettings,
  onProgress: (p: AnalysisProgress) => void,
): RunHandle {
  let worker: Worker | null = null;
  let cancelled = false;

  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    try {
      worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }

    if (!worker) {
      // No worker support: run inline and accept the jank.
      import('./engine')
        .then(({ analyzeClip }) => analyzeClip({ samples, sampleRate, settings }, onProgress))
        .then((r) => (cancelled ? reject(new Error('cancelled')) : resolve(r)))
        .catch(reject);
      return;
    }

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'progress') onProgress(data.progress as AnalysisProgress);
      else if (data.type === 'result') {
        resolve(data.result as AnalysisResult);
        worker?.terminate();
      } else if (data.type === 'error') {
        reject(new Error(data.message));
        worker?.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || 'Analysis worker crashed'));
      worker?.terminate();
    };

    // The buffer is copied rather than transferred so the caller keeps its clip.
    const copy = samples.slice();
    worker.postMessage({ type: 'run', samples: copy, sampleRate, settings }, [copy.buffer]);
  });

  return {
    promise,
    cancel() {
      cancelled = true;
      worker?.terminate();
    },
  };
}
