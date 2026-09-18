/**
 * Plain-text exports: the chord chart a teacher prints, and ASCII tab.
 */

import {
  displayName,
  preferFlats,
  soundingName,
  toBars,
  tuningOf,
  uniqueShapes,
} from '../music/arrangement';
import { keyName, midiToName, pitchClassName } from '../music/theory';
import { patternById, patternToString } from '../music/strumming';
import { tuningById } from '../music/fretboard';
import type { Arrangement } from '../types';

const STRING_LABELS_STANDARD = ['E', 'A', 'D', 'G', 'B', 'e'];

function header(a: Arrangement, title: string): string[] {
  const tuning = tuningById(a.tuningId);
  const lines = [
    title,
    '='.repeat(title.length),
    '',
    `Key:      ${keyName({ tonic: (a.key.tonic + a.transpose + 12) % 12, mode: a.key.mode })}`,
    `Tempo:    ${Math.round(a.tempo)} BPM, ${a.beatsPerBar}/${a.beatUnit}`,
    `Tuning:   ${tuning.name}`,
    `Capo:     ${a.capo === 0 ? 'none' : `fret ${a.capo}`}`,
  ];
  if (a.transpose !== 0) {
    lines.push(`Transposed: ${a.transpose > 0 ? '+' : ''}${a.transpose} semitones from the recording`);
  }
  lines.push(`Strum:    ${patternById(a.strumPatternId).name}  |  ${patternToString(patternById(a.strumPatternId))}`);
  lines.push('');
  return lines;
}

function fretString(frets: (number | null)[]): string {
  return frets.map((f) => (f === null ? 'x' : String(f))).join('');
}

/** Chord chart: names on a bar grid plus a shape legend. */
export function chordChartText(a: Arrangement, title = 'Simplified chord chart'): string {
  const lines = header(a, title);
  const bars = toBars(a);
  const barsPerLine = 4;

  lines.push('Progression');
  lines.push('-----------');
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const row = bars.slice(i, i + barsPerLine);
    const cells = row.map((bar) => {
      const names = bar.chords.map((c) => displayName(c, a));
      return (names.length ? names.join(' ') : '%').padEnd(14);
    });
    lines.push(`| ${cells.join('| ')}|`);
  }
  lines.push('');

  lines.push('Shapes');
  lines.push('------');
  for (const { name, shape } of uniqueShapes(a)) {
    const barre = shape.barre ? `, barre fret ${shape.barre.fret}` : '';
    lines.push(`  ${name.padEnd(8)} ${fretString(shape.frets).padEnd(8)} (${shape.kind}${barre})`);
  }

  if (a.capo > 0) {
    lines.push('');
    lines.push(`Shapes above are what you play with the capo at fret ${a.capo}. Sounding chords:`);
    const sounding = new Set(a.chords.map((c) => soundingName(c, a)));
    lines.push(`  ${[...sounding].join('  ')}`);
  }

  if (a.notes.length) {
    lines.push('');
    lines.push('Notes');
    lines.push('-----');
    for (const n of a.notes) lines.push(`  - ${n}`);
  }
  return lines.join('\n');
}

/** ASCII tab. Chord names sit above the staff; riff notes land on the grid. */
export function asciiTab(a: Arrangement, title = 'Simplified tab'): string {
  const lines = header(a, title);
  const bars = toBars(a);
  const tuning = tuningOf(a);
  const labels =
    a.tuningId === 'standard'
      ? STRING_LABELS_STANDARD
      : tuning.map((m) => pitchClassName(m % 12).padEnd(1).slice(0, 2));

  const subdivisions = 4; // sixteenth-note columns
  const barWidth = a.beatsPerBar * subdivisions;
  const barsPerLine = Math.max(1, Math.floor(72 / (barWidth + 1)));

  for (let i = 0; i < bars.length; i += barsPerLine) {
    const row = bars.slice(i, i + barsPerLine);
    const chordLine: string[] = [];
    const stringLines: string[][] = labels.map(() => []);

    for (const bar of row) {
      // Chord names above the bar.
      const cells = new Array(barWidth).fill(' ');
      for (const c of bar.chords) {
        const col = Math.round((c.startBeat - bar.startBeat) * subdivisions);
        const name = displayName(c, a);
        for (let k = 0; k < name.length && col + k < barWidth; k++) cells[col + k] = name[k];
      }
      chordLine.push(cells.join(''));

      // Tab rows.
      const grid = labels.map(() => new Array(barWidth).fill('-'));
      for (const n of bar.notes) {
        if (n.string === undefined || n.fret === undefined) continue;
        const col = Math.round((n.startBeat - bar.startBeat) * subdivisions);
        if (col < 0 || col >= barWidth) continue;
        const text = String(n.fret);
        // Reverse so the high string prints on top, as tab is read.
        const rowIdx = labels.length - 1 - n.string;
        for (let k = 0; k < text.length && col + k < barWidth; k++) grid[rowIdx][col + k] = text[k];
      }
      grid.forEach((g, idx) => stringLines[idx].push(g.join('')));
    }

    lines.push(`   ${chordLine.join(' ')}`);
    labels
      .slice()
      .reverse()
      .forEach((label, idx) => {
        lines.push(`${label.padEnd(2)}|${stringLines[idx].join('|')}|`);
      });
    lines.push('');
  }

  if (a.riff.length === 0) {
    lines.push('(No riff was extracted - the chord grid above is the arrangement.)');
  }
  return lines.join('\n');
}

/** A compact "what am I actually playing" listing, handy for lesson notes. */
export function riffNoteList(a: Arrangement): string {
  if (a.riff.length === 0) return 'No riff notes.';
  return a.riff
    .map((n) => {
      const pos = n.string !== undefined && n.fret !== undefined ? `str ${n.string + 1} fret ${n.fret}` : 'unplayable';
      return `bar ${Math.floor(n.startBeat / a.beatsPerBar) + 1} beat ${(n.startBeat % a.beatsPerBar) + 1}: ${midiToName(
        n.midi + a.transpose,
        preferFlats(a),
      )} (${pos})`;
    })
    .join('\n');
}

/** Voicing summary, used by the PDF legend and the clipboard copy. */
export function shapeLegend(a: Arrangement): { name: string; frets: string; kind: string }[] {
  return uniqueShapes(a).map(({ name, shape }) => ({
    name,
    frets: fretString(shape.frets),
    kind: shape.kind,
  }));
}
