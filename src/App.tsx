import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type * as alphaTab from '@coderline/alphatab';
import { useStore } from './state/store';
import { Stepper } from './components/Stepper';
import { CapturePanel } from './components/CapturePanel';
import { WaveformTrimmer } from './components/WaveformTrimmer';
import { AnalyseSetup } from './components/AnalyseSetup';
import { ResultSummary } from './components/ResultSummary';
import { ChordChart } from './components/ChordChart';
import { RiffEditor } from './components/RiffEditor';
import { PlaybackBar } from './components/PlaybackBar';
import { PdfExportButton } from './components/PdfExportButton';
import type { CursorMode } from './render/AlphaTabView';
import type { PlaybackSource } from './components/PlaybackBar';

// alphaTab is ~1.5MB; the chord chart should not wait for it.
const AlphaTabView = lazy(() =>
  import('./render/AlphaTabView').then((m) => ({ default: m.AlphaTabView })),
);

export function App() {
  const step = useStore((s) => s.step);
  const setStep = useStore((s) => s.setStep);
  const audio = useStore((s) => s.audio);
  const analysing = useStore((s) => s.analysing);
  const progress = useStore((s) => s.progress);
  const cancelAnalysis = useStore((s) => s.cancelAnalysis);

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">
            Song <span className="text-amber-450">→</span> Tab
          </h1>
          <p className="text-sm text-slate-400">
            Listen to a song, get a simplified single-guitar arrangement you can actually play.
          </p>
        </div>
        <Stepper step={step} onJump={setStep} />
      </header>

      {step === 'capture' && <CapturePanel />}

      {step === 'trim' && audio && (
        <div className="space-y-4">
          <WaveformTrimmer />
          <AnalyseSetup />
        </div>
      )}

      {step === 'analyse' && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold text-slate-100">Analysing…</h2>
          <p className="text-sm text-slate-400">{progress?.message ?? 'Working…'}</p>
          <div className="h-2 overflow-hidden rounded-full bg-ink-900">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-450" />
          </div>
          <p className="text-xs text-slate-500">
            Chroma over a 30 second clip is a few thousand FFTs. It runs in a worker, so the page stays responsive.
          </p>
          <button className="btn" onClick={cancelAnalysis} disabled={!analysing}>
            Cancel
          </button>
        </div>
      )}

      {step === 'edit' && <ResultScreen />}
    </div>
  );
}

function ResultScreen() {
  const a = useStore((s) => s.arrangement);
  const title = useStore((s) => s.title);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);

  const [api, setApi] = useState<alphaTab.AlphaTabApi | null>(null);
  const [source, setSource] = useState<PlaybackSource>('clip');
  const [scoreError, setScoreError] = useState<string | null>(null);
  // Anything that is not alphaTab's own synth drives the cursor from outside.
  const cursorMode: CursorMode = source === 'synth' ? 'synth' : 'external';
  const seenError = useRef(false);

  // Keyboard undo/redo - a lesson moves fast.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!a) return null;

  return (
    <div className="space-y-4">
      <PlaybackBar api={api} source={source} onSourceChange={setSource} />

      {/* The tab sits directly under the transport - it is what you read while
          the clip plays, so nothing should come between them. */}
      <div className="card">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-slate-200">Tab</h3>
          <PdfExportButton />
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading the tab renderer…</p>}>
          <AlphaTabView
            arrangement={a}
            title={title}
            mode={cursorMode}
            onReady={setApi}
            onError={(m) => {
              if (seenError.current) return;
              seenError.current = true;
              setScoreError(m);
            }}
          />
        </Suspense>
        {scoreError && source === 'synth' && (
          <p className="mt-2 text-xs text-amber-450">
            Synth playback is unavailable in this browser. Use "Original clip" instead.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={undo} disabled={past.length === 0}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={redo} disabled={future.length === 0}>
          ↷ Redo
        </button>
      </div>

      <ChordChart />
      <ResultSummary />
      <RiffEditor />
    </div>
  );
}
