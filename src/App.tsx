import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type * as alphaTab from '@coderline/alphatab';
import { useStore } from './state/store';
import { Stepper } from './components/Stepper';
import { CapturePanel } from './components/CapturePanel';
import { WaveformTrimmer } from './components/WaveformTrimmer';
import { AnalyseSetup } from './components/AnalyseSetup';
import { ResultSummary } from './components/ResultSummary';
import { CapoHelper } from './components/CapoHelper';
import { ChordChart } from './components/ChordChart';
import { ShapeStrip } from './components/ShapeStrip';
import { RiffEditor } from './components/RiffEditor';
import { PlaybackBar } from './components/PlaybackBar';
import { ExportPanel } from './components/ExportPanel';
import type { CursorMode } from './render/AlphaTabView';
import type { PlaybackSource } from './components/PlaybackBar';

// alphaTab is ~1.5MB; the chord chart should not wait for it.
const AlphaTabView = lazy(() =>
  import('./render/AlphaTabView').then((m) => ({ default: m.AlphaTabView })),
);
import { TIER_LABELS } from './types';

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
            Listen to a song, get a simplified single-guitar arrangement you can actually teach.
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
            {progress?.phase === 'transcribe' && typeof progress.percent === 'number' ? (
              <div
                className="h-full rounded-full bg-amber-450 transition-[width]"
                style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-450" />
            )}
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

      <footer className="mt-10 border-t border-ink-700 pt-4 text-xs text-slate-600">
        <p>
          Everything runs in this browser - no upload, no login. The output is a playable reduction, not a faithful
          transcription, and it is meant to be edited before you teach from it.
        </p>
      </footer>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="chip">{TIER_LABELS[a.tier].name} tier</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={undo} disabled={past.length === 0}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={redo} disabled={future.length === 0}>
            ↷ Redo
          </button>
        </div>
      </div>

      {/* What it heard, with the capo helper alongside it. */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ResultSummary />
        <CapoHelper />
      </div>

      {/* Shapes sit directly above the chart they belong to, both full width. */}
      <ShapeStrip />
      <ChordChart />
      <RiffEditor />

      <div className="card">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold text-slate-200">Score</h3>
          <span className="text-xs text-slate-500">
            {cursorMode === 'external'
              ? `Cursor follows the ${source === 'guitar' ? 'isolated guitar' : 'original clip'}`
              : 'alphaTab is playing its own rendering'}
          </span>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading the score renderer…</p>}>
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

      <ExportPanel />
    </div>
  );
}
