/// <reference lib="webworker" />
/**
 * Analysis worker.
 *
 * Chroma over a 30 second clip is several thousand FFTs; running it on the main
 * thread freezes the waveform and the record button. Everything heavy lives here.
 */

import { analyzeClip } from './engine';
import type { AnalysisSettings } from '../types';

interface RunMessage {
  type: 'run';
  samples: Float32Array;
  sampleRate: number;
  settings: AnalysisSettings;
}

self.onmessage = async (event: MessageEvent<RunMessage>) => {
  const msg = event.data;
  if (msg?.type !== 'run') return;
  try {
    const result = await analyzeClip(
      { samples: msg.samples, sampleRate: msg.sampleRate, settings: msg.settings },
      (progress) => self.postMessage({ type: 'progress', progress }),
    );
    self.postMessage({ type: 'result', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
