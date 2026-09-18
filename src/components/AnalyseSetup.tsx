/**
 * Step 3 controls: tier, engine settings, and Analyse.
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import { TIER_LABELS, type Tier } from '../types';
import { basicPitchAvailability } from '../analysis/basicPitch';
import { midiToName, parsePitchClass, type KeyMode } from '../music/theory';
import { SHARP_NAMES } from '../music/theory';

const TIERS: Tier[] = ['essential', 'standard', 'full'];

export function AnalyseSetup() {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const setTier = useStore((s) => s.setTier);
  const analyse = useStore((s) => s.analyse);
  const analysing = useStore((s) => s.analysing);
  const error = useStore((s) => s.error);
  const title = useStore((s) => s.title);
  const setTitle = useStore((s) => s.setTitle);
  const [advanced, setAdvanced] = useState(false);

  const bp = basicPitchAvailability();

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label" htmlFor="title">
            Title
          </label>
          <input id="title" className="input max-w-md" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <span className="label">Output complexity</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {TIERS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`rounded-lg border p-3 text-left transition ${
                  settings.tier === t
                    ? 'border-amber-450 bg-amber-450/10'
                    : 'border-ink-600 bg-ink-700 hover:border-ink-500'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  {TIER_LABELS[t].name}
                  {t === 'essential' && <span className="chip">default</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">{TIER_LABELS[t].blurb}</p>
              </button>
            ))}
          </div>
          {settings.tier === 'full' && (
            <div className="mt-2 space-y-2 rounded-md border border-ink-600 bg-ink-900 px-3 py-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  disabled={!bp.available}
                  checked={settings.useBasicPitch && bp.available}
                  onChange={(e) => update({ useBasicPitch: e.target.checked })}
                />
                Use Basic Pitch (polyphonic)
              </label>
              <p className="text-xs text-slate-500">{bp.reason}</p>
              {!settings.useBasicPitch && (
                <p className="text-xs text-slate-500">
                  Off: the Full tier falls back to the phase 1 monophonic tracker, which is faster and will miss
                  simultaneous voices.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <button className="btn btn-ghost text-xs" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? '▾' : '▸'} Engine settings
        </button>
        {advanced && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Chord vocabulary" hint="Ambiguous chords collapse to the simple triad unless you ask for more.">
              <select
                className="input"
                value={settings.vocabulary}
                onChange={(e) => update({ vocabulary: e.target.value as typeof settings.vocabulary })}
              >
                <option value="simple">Simple (major / minor / power)</option>
                <option value="standard">Standard (+ 7ths, sus, dim)</option>
                <option value="rich">Rich (everything)</option>
              </select>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={settings.richChords}
                  onChange={(e) => update({ richChords: e.target.checked })}
                />
                Keep the richer chord instead of reducing to a triad
              </label>
            </Field>

            <Field label="Chord stickiness" hint="Higher holds a chord for longer. Raise it on washy, reverby material.">
              <input
                type="range"
                min={0.4}
                max={3}
                step={0.1}
                value={settings.chordStickiness}
                onChange={(e) => update({ chordStickiness: Number(e.target.value) })}
                className="w-full"
              />
              <span className="text-xs text-slate-400">{settings.chordStickiness.toFixed(1)}</span>
            </Field>

            <Field label="Beats per bar">
              <select
                className="input"
                value={settings.beatsPerBar}
                onChange={(e) => update({ beatsPerBar: Number(e.target.value) })}
              >
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n}/4
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Chord pitch range" hint="Keeps bass rumble and vocal air out of the harmony.">
              <RangeInputs
                min={settings.chromaMinMidi}
                max={settings.chromaMaxMidi}
                onChange={(lo, hi) => update({ chromaMinMidi: lo, chromaMaxMidi: hi })}
              />
            </Field>

            <Field label="Melody pitch range" hint="Narrow to the guitar register to stop octave leakage.">
              <RangeInputs
                min={settings.melodyMinMidi}
                max={settings.melodyMaxMidi}
                onChange={(lo, hi) => update({ melodyMinMidi: lo, melodyMaxMidi: hi })}
              />
            </Field>

            <Field label="Note-engine confidence" hint="Lower finds more notes and more phantoms.">
              <input
                type="range"
                min={0.05}
                max={0.9}
                step={0.05}
                value={settings.noteConfidence}
                onChange={(e) => update({ noteConfidence: Number(e.target.value) })}
                className="w-full"
              />
              <span className="text-xs text-slate-400">{settings.noteConfidence.toFixed(2)}</span>
            </Field>

            <Field label="Riff quantisation">
              <select
                className="input"
                value={settings.quantiseGrid}
                onChange={(e) => update({ quantiseGrid: Number(e.target.value) })}
              >
                <option value={1}>Quarter notes</option>
                <option value={0.5}>Eighth notes</option>
                <option value={0.25}>Sixteenth notes</option>
              </select>
            </Field>

            <Field label="Tempo override" hint="Leave blank to use what the beat tracker finds.">
              <input
                className="input"
                type="number"
                min={30}
                max={260}
                placeholder="auto"
                value={settings.tempoOverride ?? ''}
                onChange={(e) => update({ tempoOverride: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>

            <Field label="Key override">
              <KeyPicker value={settings.keyOverride} onChange={(k) => update({ keyOverride: k })} />
            </Field>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">{error}</div>
      )}

      <button className="btn btn-primary w-full py-3 text-base" disabled={analysing} onClick={() => void analyse()}>
        {analysing ? 'Analysing…' : `Analyse — ${TIER_LABELS[settings.tier].name}`}
      </button>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function RangeInputs({ min, max, onChange }: { min: number; max: number; onChange: (lo: number, hi: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="input w-20"
        type="number"
        min={24}
        max={96}
        value={min}
        onChange={(e) => onChange(Math.min(Number(e.target.value), max - 6), max)}
      />
      <span className="text-xs text-slate-500">{midiToName(min)}</span>
      <span className="text-slate-600">–</span>
      <input
        className="input w-20"
        type="number"
        min={30}
        max={108}
        value={max}
        onChange={(e) => onChange(min, Math.max(Number(e.target.value), min + 6))}
      />
      <span className="text-xs text-slate-500">{midiToName(max)}</span>
    </div>
  );
}

function KeyPicker({
  value,
  onChange,
}: {
  value: { tonic: number; mode: KeyMode } | null;
  onChange: (k: { tonic: number; mode: KeyMode } | null) => void;
}) {
  return (
    <div className="flex gap-2">
      <select
        className="input"
        value={value ? SHARP_NAMES[value.tonic] : ''}
        onChange={(e) => {
          if (e.target.value === '') return onChange(null);
          const pc = parsePitchClass(e.target.value);
          onChange(pc === null ? null : { tonic: pc, mode: value?.mode ?? 'major' });
        }}
      >
        <option value="">auto</option>
        {SHARP_NAMES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <select
        className="input"
        disabled={!value}
        value={value?.mode ?? 'major'}
        onChange={(e) => value && onChange({ tonic: value.tonic, mode: e.target.value as KeyMode })}
      >
        <option value="major">major</option>
        <option value="minor">minor</option>
      </select>
    </div>
  );
}
