import type { Chord, MusicalKey } from './music/theory';

export type Tier = 'essential' | 'standard' | 'full';

export const TIER_LABELS: Record<Tier, { name: string; blurb: string }> = {
  essential: {
    name: 'Essential',
    blurb: 'Chord chart only - names, diagrams and a strumming pattern. The acoustic busking version.',
  },
  standard: {
    name: 'Standard',
    blurb: 'Those chords plus the main riff or melody as tab, so the hook is in there.',
  },
  full: {
    name: 'Full (reference)',
    blurb: 'Best-effort note-for-note transcription to pick apart. Always approximate.',
  },
};

/** A chord placed on the bar grid. */
export interface BarChord {
  id: string;
  /** Absolute beat from the start of the clip. */
  startBeat: number;
  durationBeats: number;
  chord: Chord;
  /** Pinned voicing id; when unset the easiest shape is used. */
  shapeId?: string;
  confidence: number;
  /** The un-simplified chord the engine actually detected, for the rich toggle. */
  detected?: Chord;
}

/** A single-note event in the riff/melody line. */
export interface RiffNote {
  id: string;
  startBeat: number;
  durationBeats: number;
  midi: number;
  confidence: number;
  /** Assigned by the fretboard mapper; null when unplayable in this tuning. */
  string?: number;
  fret?: number;
}

export interface Arrangement {
  tier: Tier;
  tempo: number;
  beatsPerBar: number;
  /** Denominator of the time signature (4 = quarter-note beats). */
  beatUnit: number;
  key: MusicalKey;
  tuningId: string;
  capo: number;
  /** Extra transposition on top of the capo. Changes the sounding key. */
  transpose: number;
  chords: BarChord[];
  riff: RiffNote[];
  strumPatternId: string;
  /** Seconds. */
  clipDuration: number;
  /** Time of beat 0 within the clip, in seconds. */
  beatOffset: number;
  /** Caveats worth showing the teacher. */
  notes: string[];
}

export interface AnalysisSettings {
  tier: Tier;
  /** 'simple' = maj/min only, 'standard' = +7ths/sus, 'rich' = everything. */
  vocabulary: 'simple' | 'standard' | 'rich';
  /** Show the detected extended chord rather than its plain triad. */
  richChords: boolean;
  /** Pitch-range filter for the chroma, in MIDI. */
  chromaMinMidi: number;
  chromaMaxMidi: number;
  /** Pitch-range filter for the melody engine, in MIDI. */
  melodyMinMidi: number;
  melodyMaxMidi: number;
  /** Note-engine confidence floor, 0..1. */
  noteConfidence: number;
  /** Riff quantisation grid, in beat fractions (0.5 = eighths). */
  quantiseGrid: number;
  /** How much stronger a mid-bar change must be to survive simplification. */
  chordStickiness: number;
  beatsPerBar: number;
  /** Optional overrides - null means "use what was detected". */
  tempoOverride: number | null;
  keyOverride: MusicalKey | null;
  /** Phase 2. */
  isolateGuitar: boolean;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  tier: 'essential',
  vocabulary: 'standard',
  richChords: false,
  chromaMinMidi: 40,
  chromaMaxMidi: 84,
  melodyMinMidi: 52,
  melodyMaxMidi: 84,
  noteConfidence: 0.35,
  quantiseGrid: 0.5,
  chordStickiness: 1.2,
  beatsPerBar: 4,
  tempoOverride: null,
  keyOverride: null,
  isolateGuitar: false,
};

export interface AnalysisResult {
  arrangement: Arrangement;
  /** Which chroma/tempo backend actually ran. */
  backend: 'essentia' | 'builtin';
  backendNote?: string;
  detectedTempo: number;
  tempoConfidence: number;
  detectedKey: MusicalKey;
  keyConfidence: number;
  tuningOffsetSemitones: number;
  onsetDensity: number;
  /** Raw pre-simplification chord segments, for the "what did it hear" view. */
  rawSegments: { start: number; end: number; name: string | null; confidence: number }[];
}

export type AnalysisProgress =
  | { phase: 'loading'; message: string }
  | { phase: 'chroma'; message: string }
  | { phase: 'rhythm'; message: string }
  | { phase: 'chords'; message: string }
  | { phase: 'melody'; message: string }
  | { phase: 'simplify'; message: string }
  | { phase: 'done'; message: string };
