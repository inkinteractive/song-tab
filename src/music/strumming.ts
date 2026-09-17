/**
 * Suggested strumming patterns.
 *
 * Deliberately a small, teachable set rather than anything detected from the
 * audio: tempo and feel pick the pattern, the teacher overrides it.
 */

export interface StrumPattern {
  id: string;
  name: string;
  /** One entry per eighth note in a bar. */
  strokes: ('D' | 'U' | '-')[];
  description: string;
}

export const STRUM_PATTERNS: StrumPattern[] = [
  {
    id: 'downs',
    name: 'Straight downs',
    strokes: ['D', '-', 'D', '-', 'D', '-', 'D', '-'],
    description: 'One down per beat. Start here if the student is new.',
  },
  {
    id: 'ddu-udu',
    name: 'D DU UDU',
    strokes: ['D', '-', 'D', 'U', '-', 'U', 'D', 'U'],
    description: 'The all-purpose folk/pop pattern.',
  },
  {
    id: 'du-all',
    name: 'Continuous eighths',
    strokes: ['D', 'U', 'D', 'U', 'D', 'U', 'D', 'U'],
    description: 'Driving eighths - good for faster, steady tracks.',
  },
  {
    id: 'ballad',
    name: 'Ballad (D - DU - )',
    strokes: ['D', '-', '-', '-', 'D', 'U', '-', '-'],
    description: 'Sparse, lets a slow tune breathe.',
  },
  {
    id: 'pulse-eighths',
    name: 'Muted eighth pulse',
    strokes: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'],
    description: 'Palm-muted machine pulse - fits synth-driven darkwave/post-punk.',
  },
  {
    id: 'waltz',
    name: 'Waltz (3/4)',
    strokes: ['D', '-', 'D', 'U', 'D', 'U'],
    description: 'Three feel: bass note then two strums.',
  },
];

export function patternById(id: string): StrumPattern {
  return STRUM_PATTERNS.find((p) => p.id === id) ?? STRUM_PATTERNS[0];
}

export interface StrumContext {
  tempo: number;
  beatsPerBar: number;
  /** Onsets per second in the clip - a rough proxy for how busy the track is. */
  onsetDensity?: number;
}

export function suggestStrumPattern(ctx: StrumContext): StrumPattern {
  if (ctx.beatsPerBar === 3) return patternById('waltz');
  if (ctx.tempo < 76) return patternById('ballad');
  if (ctx.tempo > 150) return patternById('downs');
  if ((ctx.onsetDensity ?? 0) > 4.5) return patternById('pulse-eighths');
  if (ctx.tempo > 120) return patternById('du-all');
  return patternById('ddu-udu');
}

export function patternToString(p: StrumPattern): string {
  return p.strokes.map((s) => (s === '-' ? '·' : s)).join(' ');
}
