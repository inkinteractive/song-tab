/**
 * What the engine heard, and the overrides for everything it guessed.
 */

import { useStore } from '../state/store';
import { TUNINGS } from '../music/fretboard';
import { STRUM_PATTERNS, patternById, patternToString } from '../music/strumming';
import { keyName, SHARP_NAMES, parsePitchClass, type KeyMode } from '../music/theory';
import { progressionSummary } from '../music/arrangement';

export function ResultSummary() {
  const result = useStore((s) => s.result);
  const a = useStore((s) => s.arrangement);
  const edit = useStore((s) => s.edit);
  const analyse = useStore((s) => s.analyse);
  const setRichChords = useStore((s) => s.setRichChords);
  const setStep = useStore((s) => s.setStep);
  if (!result || !a) return null;

  const confidenceChip = (value: number, label: string) => (
    <span
      className={`chip ${value < 0.3 ? 'border-amber-450 text-amber-450' : ''}`}
      title={`${label} confidence ${(value * 100).toFixed(0)}%`}
    >
      {label} {value < 0.3 ? 'low' : value < 0.6 ? 'fair' : 'good'}
    </span>
  );

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">What it heard</h2>
          <p className="mt-1 font-mono text-sm text-amber-450">{progressionSummary(a)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="chip">
            engine: {result.backend === 'essentia' ? 'Essentia.js (WASM)' : 'built-in DSP'}
          </span>
          {confidenceChip(result.tempoConfidence, 'tempo')}
          {confidenceChip(result.keyConfidence, 'key')}
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setStep('trim')}>
            Re-trim
          </button>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => void analyse()}>
            Re-analyse
          </button>
        </div>
      </div>

      {result.backendNote && <p className="text-xs text-slate-500">{result.backendNote}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="label">Tempo (detected {Math.round(result.detectedTempo)})</span>
          <div className="flex items-center gap-2">
            <input
              className="input w-24"
              type="number"
              min={30}
              max={260}
              step={0.5}
              value={Math.round(a.tempo * 10) / 10}
              onChange={(e) => edit((d) => void (d.tempo = Math.max(30, Number(e.target.value) || d.tempo)))}
            />
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => edit((d) => void (d.tempo = d.tempo / 2))}>
              ÷2
            </button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => edit((d) => void (d.tempo = d.tempo * 2))}>
              ×2
            </button>
          </div>
        </div>

        <div>
          <span className="label">Key (detected {keyName(result.detectedKey)})</span>
          <div className="flex gap-2">
            <select
              className="input"
              value={SHARP_NAMES[a.key.tonic]}
              onChange={(e) => {
                const pc = parsePitchClass(e.target.value);
                if (pc !== null) edit((d) => void (d.key = { ...d.key, tonic: pc }));
              }}
            >
              {SHARP_NAMES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <select
              className="input"
              value={a.key.mode}
              onChange={(e) => edit((d) => void (d.key = { ...d.key, mode: e.target.value as KeyMode }))}
            >
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </div>
        </div>

        <div>
          <span className="label">Time signature</span>
          <select
            className="input"
            value={a.beatsPerBar}
            onChange={(e) => edit((d) => void (d.beatsPerBar = Number(e.target.value)))}
          >
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="label">Tuning</span>
          <select
            className="input"
            value={a.tuningId}
            onChange={(e) => edit((d) => void (d.tuningId = e.target.value))}
          >
            {TUNINGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="label">Capo</span>
          <select className="input" value={a.capo} onChange={(e) => edit((d) => void (d.capo = Number(e.target.value)))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? 'none' : `fret ${i}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="label">Transpose (changes pitch)</span>
          <select
            className="input"
            value={a.transpose}
            onChange={(e) => edit((d) => void (d.transpose = Number(e.target.value)))}
          >
            {Array.from({ length: 13 }, (_, i) => i - 6).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'none' : `${n > 0 ? '+' : ''}${n} semitones`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="label">Chord detail</span>
          <div className="flex rounded-md border border-ink-600 p-0.5 text-xs">
            {[
              { rich: false, label: 'Simple triads' },
              { rich: true, label: 'As detected' },
            ].map((opt) => (
              <button
                key={String(opt.rich)}
                onClick={() => setRichChords(opt.rich)}
                className={`flex-1 rounded px-2 py-1 ${
                  a.richChords === opt.rich ? 'bg-amber-450 text-ink-900' : 'text-slate-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Sus, add9 and 7th chords are common in this genre; the triad is the teachable default.
          </p>
        </div>

        <div className="sm:col-span-2">
          <span className="label">Strumming pattern</span>
          <div className="flex items-center gap-2">
            <select
              className="input"
              value={a.strumPatternId}
              onChange={(e) => edit((d) => void (d.strumPatternId = e.target.value))}
            >
              {STRUM_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="font-mono text-sm text-amber-450">{patternToString(patternById(a.strumPatternId))}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{patternById(a.strumPatternId).description}</p>
        </div>
      </div>

      {a.notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-ink-600 bg-ink-900 p-3 text-xs text-slate-400">
          {a.notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
