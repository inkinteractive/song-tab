/**
 * What the engine heard, and the overrides for everything it guessed.
 *
 * This card shares a row with the capo helper, so it is narrow. Labels are one
 * word and never wrap; what the engine detected goes in a hint under the
 * control rather than inside the label, where it used to push every heading
 * onto a second line.
 */

import { useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { TUNINGS } from '../music/fretboard';
import { STRUM_PATTERNS, patternById, patternToString } from '../music/strumming';
import { keyName, SHARP_NAMES, parsePitchClass, simplifyToTriad, type KeyMode } from '../music/theory';
import { progressionSummary } from '../music/arrangement';

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1 block truncate whitespace-nowrap text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      {children}
      {hint && <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function ResultSummary() {
  const result = useStore((s) => s.result);
  const a = useStore((s) => s.arrangement);
  const edit = useStore((s) => s.edit);
  const analyse = useStore((s) => s.analyse);
  const setRichChords = useStore((s) => s.setRichChords);
  const setStep = useStore((s) => s.setStep);
  // Collapsed by default: these are overrides for guesses that are usually
  // right, and the tab is what you came for.
  const [open, setOpen] = useState(false);
  if (!result || !a) return null;

  const pattern = patternById(a.strumPatternId);
  const confidence = (value: number, label: string) => (
    <span
      className={`chip whitespace-nowrap ${value < 0.3 ? 'border-amber-450 text-amber-450' : ''}`}
      title={`${label} confidence ${(value * 100).toFixed(0)}%`}
    >
      {label} {value < 0.3 ? 'low' : value < 0.6 ? 'fair' : 'good'}
    </span>
  );

  return (
    <div className={`card ${open ? 'space-y-4' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="w-3 shrink-0 text-xs text-slate-500">{open ? '▾' : '▸'}</span>
          <h2 className="truncate text-lg font-semibold text-slate-100">What it heard</h2>
          {!open && (
            <span className="truncate font-mono text-sm text-amber-450">{progressionSummary(a)}</span>
          )}
        </button>
        {open && (
          <div className="flex shrink-0 gap-1 text-xs">
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setStep('trim')}>
              Re-trim
            </button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => void analyse()}>
              Re-analyse
            </button>
          </div>
        )}
      </div>

      {!open ? null : (
        <>
      <div className="space-y-2">
        <p className="line-clamp-2 font-mono text-sm text-amber-450">{progressionSummary(a)}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="chip whitespace-nowrap">
            {result.backend === 'essentia' ? 'Essentia.js' : 'built-in DSP'}
          </span>
          {confidence(result.tempoConfidence, 'tempo')}
          {confidence(result.keyConfidence, 'key')}
        </div>
      </div>

      {result.backendNote && <p className="line-clamp-2 text-xs text-slate-500">{result.backendNote}</p>}

      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Tempo" hint={`detected ${Math.round(result.detectedTempo)} BPM`}>
          <div className="flex items-center gap-1">
            <input
              className="input w-20"
              type="number"
              min={30}
              max={260}
              step={0.5}
              value={Math.round(a.tempo * 10) / 10}
              onChange={(e) => edit((d) => void (d.tempo = Math.max(30, Number(e.target.value) || d.tempo)))}
            />
            <button
              className="btn btn-ghost px-1.5 py-1 text-xs"
              title="Half time"
              onClick={() => edit((d) => void (d.tempo = d.tempo / 2))}
            >
              ÷2
            </button>
            <button
              className="btn btn-ghost px-1.5 py-1 text-xs"
              title="Double time"
              onClick={() => edit((d) => void (d.tempo = d.tempo * 2))}
            >
              ×2
            </button>
          </div>
        </Field>

        <Field label="Key" hint={`detected ${keyName(result.detectedKey)}`}>
          <div className="flex gap-1">
            <select
              className="input w-16"
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
              className="input min-w-0 flex-1"
              value={a.key.mode}
              onChange={(e) => edit((d) => void (d.key = { ...d.key, mode: e.target.value as KeyMode }))}
            >
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </div>
        </Field>

        <Field label="Time">
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
        </Field>

        <Field label="Tuning">
          <select className="input" value={a.tuningId} onChange={(e) => edit((d) => void (d.tuningId = e.target.value))}>
            {TUNINGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Capo">
          <select className="input" value={a.capo} onChange={(e) => edit((d) => void (d.capo = Number(e.target.value)))}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? 'none' : `fret ${i}`}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Transpose" hint="changes the sounding pitch">
          <select
            className="input"
            value={a.transpose}
            onChange={(e) => edit((d) => void (d.transpose = Number(e.target.value)))}
          >
            {Array.from({ length: 13 }, (_, i) => i - 6).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'none' : `${n > 0 ? '+' : ''}${n}`}
              </option>
            ))}
          </select>
        </Field>

        {/* Only worth showing when the engine actually detected something
            richer than the triad on screen - otherwise it is a control that
            demonstrably does nothing. */}
        {a.chords.some((c) => c.detected && c.detected.quality !== simplifyToTriad(c.detected).quality) && (
        <Field label="Chords" hint="the triad is the teachable default">
          <div className="flex rounded-md border border-ink-600 p-0.5 text-xs">
            {[
              { rich: false, label: 'Triads' },
              { rich: true, label: 'Detected' },
            ].map((opt) => (
              <button
                key={String(opt.rich)}
                onClick={() => setRichChords(opt.rich)}
                className={`flex-1 truncate rounded px-2 py-1 ${
                  a.richChords === opt.rich ? 'bg-amber-450 text-ink-900' : 'text-slate-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Field>
        )}

        <Field
          label="Strum"
          hint={
            <>
              <span className="font-mono text-amber-450">{patternToString(pattern)}</span> - {pattern.description}
            </>
          }
        >
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
        </Field>
      </div>

      {a.notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-ink-600 bg-ink-900 p-3 text-xs leading-snug text-slate-400">
          {a.notes.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}
        </>
      )}
    </div>
  );
}
