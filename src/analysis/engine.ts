/**
 * Analysis orchestration.
 *
 * Runs the chord engine (always) and the note engine (Standard/Full), reconciles
 * Essentia and the built-in DSP, and hands back a ready-to-edit arrangement.
 * Kept free of DOM APIs so it can run inside a worker.
 */

import {
  ANALYSIS_SAMPLE_RATE,
  beatGrid,
  computeChroma,
  detectOnsets,
  estimateBeatPhase,
  estimateTempo,
  resample,
  trackPitch,
} from './dsp';
import { essentiaHpcp, essentiaKey, essentiaRhythm, essentiaLoadError } from './essentia';
import { decodeChordFrames, estimateKey, framesToSegments } from './chordEngine';
import { simplifyToBars, tidyProgression } from './simplify';
import { extractRiff } from './melody';
import { basicPitchAvailability } from './basicPitch';
import { withFretPositions } from '../music/arrangement';
import { suggestStrumPattern } from '../music/strumming';
import { chordName, midiToFreq, type MusicalKey, parsePitchClass, shouldPreferFlats } from '../music/theory';
import type { AnalysisProgress, AnalysisResult, AnalysisSettings, Arrangement } from '../types';

export interface AnalyzeInput {
  /** Mono samples of the trimmed clip. */
  samples: Float32Array;
  sampleRate: number;
  settings: AnalysisSettings;
}

type ProgressFn = (p: AnalysisProgress) => void;

export async function analyzeClip(input: AnalyzeInput, onProgress: ProgressFn = () => {}): Promise<AnalysisResult> {
  const { settings } = input;
  const notes: string[] = [];

  onProgress({ phase: 'loading', message: 'Preparing audio…' });
  const mono = resample(input.samples, input.sampleRate, ANALYSIS_SAMPLE_RATE);
  const duration = mono.length / ANALYSIS_SAMPLE_RATE;
  if (duration < 1) throw new Error('Clip is too short to analyse - trim at least a second of audio.');

  // ---- chroma -------------------------------------------------------------
  onProgress({ phase: 'chroma', message: 'Reading the harmony (chroma/HPCP)…' });
  const rangeNarrowed = settings.chromaMinMidi > 40 || settings.chromaMaxMidi < 84;
  let backend: 'essentia' | 'builtin' = 'essentia';
  let backendNote: string | undefined;
  let tuningOffset = 0;

  let chroma = await essentiaHpcp(mono, ANALYSIS_SAMPLE_RATE, {
    minFreq: midiToFreq(settings.chromaMinMidi) * 0.97,
    maxFreq: Math.min(midiToFreq(settings.chromaMaxMidi) * 4, ANALYSIS_SAMPLE_RATE / 2 - 100),
  });

  if (!chroma) {
    backend = 'builtin';
    backendNote =
      essentiaLoadError()
        ? `Essentia.js did not load (${essentiaLoadError()}); ran the built-in chroma engine instead.`
        : 'Ran the built-in chroma engine.';
    const built = computeChroma(mono, {
      sampleRate: ANALYSIS_SAMPLE_RATE,
      minMidi: settings.chromaMinMidi,
      maxMidi: settings.chromaMaxMidi,
    });
    chroma = { frames: built.frames, times: built.times, hopSeconds: built.hopSeconds };
    tuningOffset = built.tuningOffset;
  } else if (rangeNarrowed) {
    notes.push('Pitch-range filter applied to the chroma via the spectral peak range.');
  }
  if (chroma.frames.length === 0) throw new Error('No usable audio in the selection.');

  // A second chroma over the bass register. Whatever produced the main chroma,
  // this one is always built the same way so the two stay frame-aligned.
  const bass = computeChroma(mono, {
    sampleRate: ANALYSIS_SAMPLE_RATE,
    minMidi: 28,
    maxMidi: 55,
    harmonics: 2,
  });

  // ---- rhythm -------------------------------------------------------------
  onProgress({ phase: 'rhythm', message: 'Finding the tempo and beats…' });
  const onsets = detectOnsets(mono, ANALYSIS_SAMPLE_RATE);

  // The built-in onset tracker is the tempo source. Essentia's
  // RhythmExtractor2013 is excellent at finding *a* pulse but, measured across
  // the test progressions, routinely reports double time on slow material and
  // half time on fast material - which throws the bar grid out even when the
  // harmony is right. Essentia is kept as a second opinion only: agreement
  // raises confidence, and a clean 2x/0.5x disagreement is surfaced to the
  // teacher rather than acted on.
  const builtin = estimateTempo(onsets, duration);
  const essentiaBpm = await essentiaRhythm(mono);

  const bpm = builtin.bpm;
  let tempoConfidence = builtin.confidence;
  if (essentiaBpm && Number.isFinite(essentiaBpm.bpm) && essentiaBpm.bpm > 0) {
    const ratio = essentiaBpm.bpm / builtin.bpm;
    const agrees = Math.abs(ratio - 1) < 0.05;
    const octaveApart = Math.abs(ratio - 2) < 0.1 || Math.abs(ratio - 0.5) < 0.05;
    if (agrees) {
      tempoConfidence = Math.max(tempoConfidence, (tempoConfidence + essentiaBpm.confidence) / 2 + 0.25);
    } else if (octaveApart) {
      notes.push(
        `Tempo is ambiguous: ${Math.round(builtin.bpm)} or ${Math.round(essentiaBpm.bpm)} BPM. The chart uses ${Math.round(
          builtin.bpm,
        )}; the ×2 / ÷2 buttons switch it.`,
      );
    }
  }

  const detectedTempo = clampTempo(bpm);
  const tempo = settings.tempoOverride ?? detectedTempo;
  // Recover the downbeat alignment for whatever tempo we ended up with.
  const phase = estimateBeatPhase(onsets, tempo);
  const beats = beatGrid(tempo, Math.max(0, Math.min(phase, 60 / tempo)), duration);
  if (tempoConfidence < 0.25) {
    notes.push(
      `Tempo (${Math.round(detectedTempo)} BPM) is a weak guess - check it against the clip and override if needed.`,
    );
  }

  // ---- key ----------------------------------------------------------------
  const builtinKey = estimateKey(chroma.frames);
  let detectedKey: MusicalKey = builtinKey.key;
  let keyConfidence = builtinKey.confidence;
  if (backend === 'essentia') {
    const ek = await essentiaKey(mono);
    const pc = ek ? parsePitchClass(ek.tonic) : null;
    if (ek && pc !== null) {
      detectedKey = { tonic: pc, mode: ek.scale === 'minor' ? 'minor' : 'major' };
      keyConfidence = ek.strength;
    }
  }
  const key = settings.keyOverride ?? detectedKey;

  // ---- chords -------------------------------------------------------------
  onProgress({ phase: 'chords', message: 'Matching chords…' });
  // The penalty is tuned for ~46ms frames; scale it if the hop differs.
  const penaltyScale = 0.046 / chroma.hopSeconds;
  const path = decodeChordFrames(chroma.frames, {
    vocabulary: settings.vocabulary,
    key,
    transitionPenalty: settings.chordStickiness * penaltyScale,
    bassChroma: bass.frames,
  });
  const segments = framesToSegments(path, chroma.times, chroma.hopSeconds);

  onProgress({ phase: 'simplify', message: 'Simplifying to a playable progression…' });
  const bars = tidyProgression(
    simplifyToBars(segments, {
      beats,
      beatsPerBar: settings.beatsPerBar,
      stickiness: settings.chordStickiness,
      reduceToTriads: !settings.richChords,
    }),
  );
  if (bars.length === 0) {
    notes.push('No chord held long enough to place on a bar. Try a longer or cleaner section.');
  }

  // ---- melody -------------------------------------------------------------
  let riff: Arrangement['riff'] = [];
  if (settings.tier !== 'essential') {
    onProgress({ phase: 'melody', message: 'Tracking the riff / melody line…' });
    const full = settings.tier === 'full';
    // The note engine is always the built-in harmonic-sum tracker - see the
    // note in `essentia.ts` for why Essentia's melodia is not used here.
    const track = trackPitch(mono, {
      sampleRate: ANALYSIS_SAMPLE_RATE,
      minMidi: settings.melodyMinMidi,
      maxMidi: settings.melodyMaxMidi,
    });

    riff = extractRiff(track, {
      beatOffset: beats[0] ?? 0,
      tempo,
      grid: full ? Math.min(settings.quantiseGrid, 0.25) : settings.quantiseGrid,
      minConfidence: full ? settings.noteConfidence * 0.7 : settings.noteConfidence,
      minMidi: settings.melodyMinMidi,
      maxMidi: settings.melodyMaxMidi,
      beatsPerBar: settings.beatsPerBar,
      maxNotesPerBeat: full ? 8 : 2,
    });

    if (full) {
      const bp = basicPitchAvailability();
      if (!bp.available) notes.push(bp.reason);
    }
    if (riff.length === 0) {
      notes.push('No melodic line stood out. Narrow the pitch range to the guitar register, or lower the note-engine confidence.');
    }
  }

  // ---- assemble -----------------------------------------------------------
  const arrangement: Arrangement = {
    tier: settings.tier,
    tempo,
    beatsPerBar: settings.beatsPerBar,
    beatUnit: 4,
    key,
    tuningId: 'standard',
    capo: 0,
    transpose: 0,
    chords: bars,
    riff,
    strumPatternId: suggestStrumPattern({
      tempo,
      beatsPerBar: settings.beatsPerBar,
      onsetDensity: onsets.density,
    }).id,
    clipDuration: duration,
    beatOffset: beats[0] ?? 0,
    notes,
  };

  withFretPositions(arrangement);

  if (tuningOffset !== 0 && Math.abs(tuningOffset) > 0.15) {
    arrangement.notes.push(
      `The recording sits about ${(tuningOffset * 100).toFixed(0)} cents off concert pitch - chord names may read a semitone out if it is further off than that.`,
    );
  }

  const flats = shouldPreferFlats(key.tonic, key.mode);
  onProgress({ phase: 'done', message: 'Done.' });

  return {
    arrangement,
    backend,
    backendNote,
    detectedTempo,
    tempoConfidence,
    detectedKey,
    keyConfidence,
    tuningOffsetSemitones: tuningOffset,
    onsetDensity: onsets.density,
    rawSegments: segments.map((s) => ({
      start: s.start,
      end: s.end,
      name: s.chord ? chordName(s.chord, flats) : null,
      confidence: s.confidence,
    })),
  };
}

function clampTempo(bpm: number): number {
  let t = bpm;
  while (t > 200) t /= 2;
  while (t > 0 && t < 50) t *= 2;
  return Number.isFinite(t) && t > 0 ? Math.round(t * 10) / 10 : 120;
}
