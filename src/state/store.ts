/**
 * Application state.
 *
 * The arrangement is the editable document; everything else is either capture
 * state or the immutable analysis report it came from. Edits push onto an undo
 * stack so a teacher can experiment during a lesson without fear.
 */

import { create } from 'zustand';
import { DEFAULT_SETTINGS, type AnalysisProgress, type AnalysisResult, type AnalysisSettings, type Arrangement } from '../types';
import { runAnalysis } from '../analysis/runAnalysis';
import { withFretPositions } from '../music/arrangement';
import { tuningById } from '../music/fretboard';
import { simplifyToTriad } from '../music/theory';
import { bestCapoSuggestion, type CapoSuggestion } from '../music/capo';
import { chordWeights } from '../analysis/simplify';

export type Step = 'capture' | 'trim' | 'analyse' | 'edit';

export interface ClipAudio {
  mono: Float32Array;
  sampleRate: number;
  duration: number;
  /** How it got here, for the UI to explain itself. */
  origin: 'mic' | 'tab' | 'file';
  label: string;
}

interface State {
  step: Step;
  title: string;
  audio: ClipAudio | null;
  trim: { start: number; end: number };
  settings: AnalysisSettings;

  analysing: boolean;
  progress: AnalysisProgress | null;
  error: string | null;
  result: AnalysisResult | null;


  arrangement: Arrangement | null;
  past: Arrangement[];
  future: Arrangement[];
  capoSuggestion: CapoSuggestion | null;

  setTitle(title: string): void;
  setAudio(audio: ClipAudio): void;
  clearAudio(): void;
  setTrim(start: number, end: number): void;
  setStep(step: Step): void;
  updateSettings(patch: Partial<AnalysisSettings>): void;

  analyse(): Promise<void>;
  cancelAnalysis(): void;

  /** Any edit to the arrangement; pushes undo state. */
  edit(mutator: (draft: Arrangement) => Arrangement | void, label?: string): void;
  undo(): void;
  redo(): void;
  applyCapo(capo: number, transpose: number): void;
  /** Flip every chord between its plain triad and the extension detected. */
  setRichChords(rich: boolean): void;
  refreshCapoSuggestion(): void;
}

let activeRun: { cancel(): void } | null = null;

function clone(a: Arrangement): Arrangement {
  return {
    ...a,
    key: { ...a.key },
    chords: a.chords.map((c) => ({ ...c, chord: { ...c.chord }, detected: c.detected ? { ...c.detected } : undefined })),
    riff: a.riff.map((n) => ({ ...n })),
    notes: [...a.notes],
  };
}

export const useStore = create<State>((set, get) => ({
  step: 'capture',
  title: 'Lesson arrangement',
  audio: null,
  trim: { start: 0, end: 0 },
  settings: { ...DEFAULT_SETTINGS },

  analysing: false,
  progress: null,
  error: null,
  result: null,

  arrangement: null,
  past: [],
  future: [],
  capoSuggestion: null,

  setTitle: (title) => set({ title }),

  setAudio: (audio) =>
    set({
      audio,
      // Default to the first 30 seconds: short sections analyse far better.
      trim: { start: 0, end: Math.min(audio.duration, 30) },
      step: 'trim',
      result: null,
      arrangement: null,
      error: null,
      past: [],
      future: [],
    }),

  clearAudio: () =>
    set({ audio: null, step: 'capture', result: null, arrangement: null, error: null, past: [], future: [] }),

  setTrim: (start, end) => {
    const audio = get().audio;
    if (!audio) return;
    const s = Math.max(0, Math.min(start, audio.duration));
    const e = Math.max(s + 0.5, Math.min(end, audio.duration));
    set({ trim: { start: s, end: e } });
  },

  setStep: (step) => set({ step }),

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  async analyse() {
    const { audio, trim, settings } = get();
    if (!audio) return;
    activeRun?.cancel();
    set({ analysing: true, error: null, progress: { phase: 'loading', message: 'Starting…' }, step: 'analyse' });

    const clip = audio.mono.slice(
      Math.floor(trim.start * audio.sampleRate),
      Math.min(audio.mono.length, Math.ceil(trim.end * audio.sampleRate)),
    );
    const sampleRate = audio.sampleRate;

    const run = runAnalysis(clip, sampleRate, settings, (progress) => set({ progress }));
    activeRun = run;
    try {
      const result = await run.promise;

      set({
        result,
        arrangement: result.arrangement,
        analysing: false,
        progress: null,
        step: 'edit',
        past: [],
        future: [],
      });
      get().refreshCapoSuggestion();
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') {
        set({ analysing: false, progress: null, step: 'trim' });
        return;
      }
      set({
        analysing: false,
        progress: null,
        error: err instanceof Error ? err.message : String(err),
        step: 'trim',
      });
    } finally {
      activeRun = null;
    }
  },

  cancelAnalysis() {
    activeRun?.cancel();
    activeRun = null;
    set({ analysing: false, progress: null, step: 'trim' });
  },

  edit(mutator) {
    const current = get().arrangement;
    if (!current) return;
    const draft = clone(current);
    const next = mutator(draft) ?? draft;
    withFretPositions(next, tuningById(next.tuningId).midi);
    set((s) => ({
      arrangement: next,
      past: [...s.past.slice(-49), current],
      future: [],
    }));
    get().refreshCapoSuggestion();
  },

  undo() {
    const { past, arrangement } = get();
    if (past.length === 0 || !arrangement) return;
    const previous = past[past.length - 1];
    set((s) => ({
      arrangement: previous,
      past: s.past.slice(0, -1),
      future: [arrangement, ...s.future].slice(0, 50),
    }));
  },

  redo() {
    const { future, arrangement } = get();
    if (future.length === 0 || !arrangement) return;
    set((s) => ({
      arrangement: future[0],
      past: [...s.past, arrangement],
      future: s.future.slice(1),
    }));
  },

  applyCapo(capo, transpose) {
    get().edit((draft) => {
      draft.capo = Math.max(0, Math.min(11, Math.round(capo)));
      draft.transpose = Math.max(-6, Math.min(6, Math.round(transpose)));
    });
  },

  setRichChords(rich) {
    get().edit((draft) => {
      draft.richChords = rich;
      for (const bc of draft.chords) {
        if (!bc.detected) continue;
        const next = rich ? { ...bc.detected } : simplifyToTriad(bc.detected);
        if (next.quality === bc.chord.quality && next.root === bc.chord.root) continue;
        bc.chord = next;
        // The pinned voicing belonged to the other spelling.
        bc.shapeId = undefined;
      }
    });
  },

  refreshCapoSuggestion() {
    const a = get().arrangement;
    if (!a || a.chords.length === 0) {
      set({ capoSuggestion: null });
      return;
    }
    // Evaluate against the sounding chords so the suggestion is independent of
    // whatever capo is currently applied.
    const sounding = chordWeights(
      a.chords.map((c) => ({ ...c, chord: { ...c.chord } })),
      a.beatsPerBar,
    );
    set({
      capoSuggestion: bestCapoSuggestion({
        chords: sounding,
        key: a.key,
        allowTranspose: false,
      }),
    });
  },
}));
