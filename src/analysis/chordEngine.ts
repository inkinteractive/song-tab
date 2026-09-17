/**
 * Chord recognition from a chroma/HPCP sequence.
 *
 * Template matching plus a Viterbi pass. The Viterbi smoothing is what makes
 * this usable on dense, effected material: frame-level matches on a reverb-
 * soaked mix flicker constantly, and the transition penalty holds a chord until
 * the evidence for changing is genuinely strong.
 */

import {
  type Chord,
  type ChordQuality,
  type MusicalKey,
  KK_MAJOR,
  KK_MINOR,
  QUALITY_INTERVALS,
} from '../music/theory';

export type ChordVocabulary = 'simple' | 'standard' | 'rich';

const VOCABULARIES: Record<ChordVocabulary, ChordQuality[]> = {
  simple: ['maj', 'min', '5'],
  standard: ['maj', 'min', '7', 'min7', 'maj7', 'sus4', 'sus2', 'dim'],
  rich: ['maj', 'min', '7', 'min7', 'maj7', 'sus4', 'sus2', 'dim', 'aug', 'm7b5', 'add9', '6', 'min6', 'dim7'],
};

/** Per-degree weights. Roots and thirds carry the identity, so they weigh most. */
function intervalWeight(interval: number, quality: ChordQuality): number {
  if (interval === 0) return 1;
  if (interval === 3 || interval === 4) return 1;
  if (interval === 7) return 0.8;
  if (interval === 6 || interval === 8) return 0.8; // dim/aug fifths are the identity
  if (interval === 10 || interval === 11) return 0.55;
  if (quality === 'sus2' || quality === 'sus4') return 0.9;
  return 0.5;
}

export interface ChordTemplate {
  chord: Chord;
  vector: Float32Array;
}

export function buildTemplates(vocab: ChordVocabulary): ChordTemplate[] {
  const out: ChordTemplate[] = [];
  for (const quality of VOCABULARIES[vocab]) {
    for (let root = 0; root < 12; root++) {
      const v = new Float32Array(12);
      for (const i of QUALITY_INTERVALS[quality]) {
        v[(root + i) % 12] = intervalWeight(i, quality);
      }
      out.push({ chord: { root, quality }, vector: normalize(v) });
    }
  }
  return out;
}

function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
  }
  if (na === 0) return 0;
  return dot / Math.sqrt(na);
}

export interface ChordSegment {
  start: number;
  end: number;
  chord: Chord | null;
  confidence: number;
}

export interface DecodeOptions {
  vocabulary?: ChordVocabulary;
  /**
   * Chroma of the bass register, frame-aligned with the main chroma. Used to
   * reinforce the root, which is what separates C from Am7 or G from Em.
   */
  bassChroma?: Float32Array[];
  bassWeight?: number;
  /** Higher = stickier chords. Tuned for ~46ms frames. */
  transitionPenalty?: number;
  /** Below this match, the frame is called "no chord". */
  noChordThreshold?: number;
  /** Bias towards chords that live in the detected key. */
  key?: MusicalKey | null;
  keyBias?: number;
}

/**
 * Viterbi decode of a chroma sequence into a chord per frame.
 * Returns one entry per input frame.
 */
export function decodeChordFrames(
  chroma: Float32Array[],
  opts: DecodeOptions = {},
): { chord: Chord | null; confidence: number }[] {
  const templates = buildTemplates(opts.vocabulary ?? 'standard');
  const penalty = opts.transitionPenalty ?? 1.2;
  const noChord = opts.noChordThreshold ?? 0.55;
  const keyBias = opts.keyBias ?? 0.05;
  const bassWeight = opts.bassWeight ?? 1.1;
  const n = chroma.length;
  if (n === 0) return [];

  const keyPcs = opts.key ? new Set(keyPitchClasses(opts.key)) : null;
  const states = templates.length + 1; // last state = no chord
  const bias = new Float32Array(states);
  if (keyPcs) {
    templates.forEach((t, i) => {
      const pcs = QUALITY_INTERVALS[t.chord.quality].map((iv) => (t.chord.root + iv) % 12);
      const inKey = pcs.filter((p) => keyPcs.has(p)).length / pcs.length;
      bias[i] = keyBias * (inKey * 2 - 1);
    });
  }

  const emissions: Float32Array[] = chroma.map((frame, t) => {
    const e = new Float32Array(states);
    const bass = opts.bassChroma?.[Math.min(t, (opts.bassChroma?.length ?? 1) - 1)];
    for (let i = 0; i < templates.length; i++) {
      const root = templates[i].chord.root;
      // The bass term is centred on zero so it rewards a matching root without
      // inflating every template when the low end is just loud.
      const bassTerm = bass ? bassWeight * (bass[root] - 0.4) : 0;
      e[i] = cosine(frame, templates[i].vector) * 6 + bias[i] + bassTerm;
    }
    e[states - 1] = noChord * 6 - 0.2;
    return e;
  });

  const costs = new Float64Array(states);
  const back: Int16Array[] = [];
  for (let s = 0; s < states; s++) costs[s] = emissions[0][s];

  for (let t = 1; t < n; t++) {
    const next = new Float64Array(states);
    const ptr = new Int16Array(states);
    // Best predecessor overall; any change costs the same flat penalty.
    let bestPrev = -Infinity;
    let bestPrevIdx = 0;
    for (let s = 0; s < states; s++) {
      if (costs[s] > bestPrev) {
        bestPrev = costs[s];
        bestPrevIdx = s;
      }
    }
    for (let s = 0; s < states; s++) {
      const stay = costs[s];
      const move = bestPrev - penalty;
      if (stay >= move) {
        next[s] = stay + emissions[t][s];
        ptr[s] = s;
      } else {
        next[s] = move + emissions[t][s];
        ptr[s] = bestPrevIdx;
      }
    }
    costs.set(next);
    back.push(ptr);
  }

  let end = 0;
  for (let s = 1; s < states; s++) if (costs[s] > costs[end]) end = s;
  const path = new Int16Array(n);
  path[n - 1] = end;
  for (let t = n - 2; t >= 0; t--) path[t] = back[t][path[t + 1]];

  return Array.from(path).map((s, t) => {
    if (s === states - 1) return { chord: null, confidence: 0 };
    const e = emissions[t];
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < states; i++) {
      if (e[i] > max) max = e[i];
      sum += Math.exp(e[i]);
    }
    return { chord: templates[s].chord, confidence: Math.exp(e[s]) / sum };
  });
}

function keyPitchClasses(key: MusicalKey): number[] {
  const scale = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  return scale.map((i) => (key.tonic + i) % 12);
}

/** Collapse a per-frame chord path into timed segments. */
export function framesToSegments(
  path: { chord: Chord | null; confidence: number }[],
  times: number[],
  hopSeconds: number,
): ChordSegment[] {
  const segments: ChordSegment[] = [];
  let i = 0;
  while (i < path.length) {
    const cur = path[i].chord;
    let j = i;
    let confSum = 0;
    while (j < path.length && sameChord(path[j].chord, cur)) {
      confSum += path[j].confidence;
      j++;
    }
    segments.push({
      start: times[i] ?? i * hopSeconds,
      end: (times[j - 1] ?? (j - 1) * hopSeconds) + hopSeconds,
      chord: cur,
      confidence: confSum / (j - i),
    });
    i = j;
  }
  return segments;
}

function sameChord(a: Chord | null, b: Chord | null): boolean {
  if (!a || !b) return a === b;
  return a.root === b.root && a.quality === b.quality;
}

// ---------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------

export interface KeyEstimate {
  key: MusicalKey;
  confidence: number;
  /** Ranked alternatives, best first. */
  alternatives: { key: MusicalKey; score: number }[];
}

/** Krumhansl-Schmuckler on the average chroma of the clip. */
export function estimateKey(chroma: Float32Array[]): KeyEstimate {
  const avg = new Float32Array(12);
  for (const f of chroma) for (let i = 0; i < 12; i++) avg[i] += f[i];
  const scored: { key: MusicalKey; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    scored.push({ key: { tonic, mode: 'major' }, score: correlate(avg, KK_MAJOR, tonic) });
    scored.push({ key: { tonic, mode: 'minor' }, score: correlate(avg, KK_MINOR, tonic) });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const confidence = best.score <= 0 ? 0 : Math.max(0, Math.min(1, (best.score - second.score) / Math.abs(best.score)));
  return { key: best.key, confidence, alternatives: scored.slice(0, 6) };
}

function correlate(chroma: Float32Array, profile: number[], tonic: number): number {
  const rotated = profile.map((_, i) => profile[(i - tonic + 12) % 12]);
  const meanA = mean(Array.from(chroma));
  const meanB = mean(rotated);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < 12; i++) {
    const a = chroma[i] - meanA;
    const b = rotated[i] - meanB;
    num += a * b;
    da += a * a;
    db += b * b;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function mean(v: number[]): number {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
