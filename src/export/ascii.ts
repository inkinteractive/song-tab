/**
 * Plain-text exports: the chord chart a teacher prints, and ASCII tab.
 */

import { displayName, preferFlats, soundingName, toBars, uniqueShapes } from '../music/arrangement';
import { keyName, midiToName } from '../music/theory';
import { buildTabGrid } from '../render/tabGrid';
import { patternById, patternToString } from '../music/strumming';
import { tuningById } from '../music/fretboard';
import type { Arrangement } from '../types';

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

  // The same grid the page draws, printed instead of coloured.
  for (const system of buildTabGrid(a).systems) {
    lines.push(system.chordLine.text.replace(/\s+$/, ''));
    for (const line of system.stringLines) lines.push(line.text);
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
