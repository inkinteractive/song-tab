/**
 * The tab staff, as characters.
 *
 * One builder feeds both the page and the PDF, because they are meant to be the
 * same document: a monospace grid of dashes with fret numbers on it and chord
 * names written above. The page used to draw alphaTab's engraved notation,
 * which is a different thing that happens to contain the same notes.
 *
 * Every column is one sixteenth note, so a column index converts straight to a
 * beat and back - which is what lets the playhead sit on the grid.
 */

import { displayName, toBars, tuningOf } from '../music/arrangement';
import { patternById } from '../music/strumming';
import { pitchClassName } from '../music/theory';
import type { Arrangement } from '../types';

/** Low string first, the way `tuningOf` reports them. */
const STANDARD_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

export const COLUMNS_PER_BEAT = 4;

/** What a character is, so the page can colour it and the exporter can ignore it. */
export type CharKind = 'label' | 'separator' | 'dash' | 'fret' | 'chord' | 'strum' | 'blank';

export interface TabLine {
  text: string;
  /** One entry per character of `text`. */
  kinds: CharKind[];
}

export interface TabSystem {
  bars: { index: number; startBeat: number }[];
  chordLine: TabLine;
  /** D and U under the chord names, on the column each stroke falls on. */
  strumLine: TabLine;
  /** Highest string first, the way tab is read. */
  stringLines: TabLine[];
}

export interface TabGrid {
  systems: TabSystem[];
  /** Sixteenth-note columns in one bar. */
  columnsPerBar: number;
  /** Characters before a bar's first column: the string label, a gap, and the bar line. */
  prefixColumns: number;
  /** Characters in a *full* system, including the trailing bar line. A final
   *  short system is narrower - lines are never padded out to this. */
  width: number;
  barsPerSystem: number;
}

interface Row {
  chars: string[];
  kinds: CharKind[];
}

function row(): Row {
  return { chars: [], kinds: [] };
}

function push(r: Row, text: string, kind: CharKind): void {
  for (const ch of text) {
    r.chars.push(ch);
    r.kinds.push(kind);
  }
}

function toLine(r: Row): TabLine {
  return { text: r.chars.join(''), kinds: r.kinds };
}


/**
 * Strokes for one bar, one per eighth note.
 *
 * A pattern is written for the bar length it suits - eight eighths for 4/4, six
 * for the waltz - so it is cycled to fill whatever time signature the
 * arrangement is in rather than trailing off or overrunning.
 */
function strokesForBar(a: Arrangement): ('D' | 'U' | '-')[] {
  const pattern = patternById(a.strumPatternId).strokes;
  const eighths = a.beatsPerBar * 2;
  return Array.from({ length: eighths }, (_, i) => pattern[i % pattern.length]);
}

/**
 * `maxWidth` is the widest line the caller can print. Four bars of 4/4 fit in
 * 72 characters, which is what both the PDF and a browser panel hold.
 */
export function buildTabGrid(a: Arrangement, maxWidth = 72): TabGrid {
  const bars = toBars(a);
  const tuning = tuningOf(a);
  const labels =
    a.tuningId === 'standard' ? STANDARD_LABELS : tuning.map((m) => pitchClassName(m % 12).slice(0, 2));

  const columnsPerBar = a.beatsPerBar * COLUMNS_PER_BEAT;
  const barsPerSystem = Math.max(1, Math.floor(maxWidth / (columnsPerBar + 1)));
  const labelWidth = Math.max(...labels.map((l) => l.length));
  // label, one space, then the opening bar line.
  const prefixColumns = labelWidth + 2;

  const systems: TabSystem[] = [];
  for (let i = 0; i < bars.length; i += barsPerSystem) {
    const group = bars.slice(i, i + barsPerSystem);

    // Chord names sit over the column the chord starts on. A name that would
    // run past the bar line is clipped rather than pushed into the next bar.
    const chordCells = group.map(() => new Array<string>(columnsPerBar).fill(' '));
    group.forEach((bar, b) => {
      for (const c of bar.chords) {
        const at = Math.round((c.startBeat - bar.startBeat) * COLUMNS_PER_BEAT);
        const name = displayName(c, a);
        for (let k = 0; k < name.length && at + k < columnsPerBar; k++) chordCells[b][at + k] = name[k];
      }
    });

    const chordRow = row();
    push(chordRow, ' '.repeat(prefixColumns), 'blank');
    chordCells.forEach((cells) => {
      cells.forEach((ch) => push(chordRow, ch, ch === ' ' ? 'blank' : 'chord'));
      push(chordRow, ' ', 'blank');
    });

    // The strum, on the grid rather than described in a legend: a stroke every
    // eighth note is a column every two, so you can read the rhythm straight
    // down from the chord name to the frets. Skipped eighths are left blank -
    // the strokes you can see are the strokes you play, and counting them gives
    // the number of strums in the bar.
    const strumRow = row();
    push(strumRow, ' '.repeat(prefixColumns), 'blank');
    const strokes = strokesForBar(a);
    group.forEach(() => {
      for (let col = 0; col < columnsPerBar; col++) {
        const stroke = col % 2 === 0 ? strokes[col / 2] : '-';
        const ch = stroke === '-' ? ' ' : stroke;
        push(strumRow, ch, ch === ' ' ? 'blank' : 'strum');
      }
      push(strumRow, ' ', 'blank');
    });

    // One grid per string, low to high, then reversed for printing.
    const gridLowFirst = labels.map(() => group.map(() => new Array<string>(columnsPerBar).fill('-')));
    group.forEach((bar, b) => {
      for (const n of bar.notes) {
        if (n.string === undefined || n.fret === undefined) continue;
        if (n.string < 0 || n.string >= labels.length) continue;
        const at = Math.round((n.startBeat - bar.startBeat) * COLUMNS_PER_BEAT);
        if (at < 0 || at >= columnsPerBar) continue;
        const text = String(n.fret);
        for (let k = 0; k < text.length && at + k < columnsPerBar; k++) gridLowFirst[n.string][b][at + k] = text[k];
      }
    });

    const stringLines: TabLine[] = [];
    for (let s = labels.length - 1; s >= 0; s--) {
      const r = row();
      push(r, labels[s].padEnd(labelWidth), 'label');
      push(r, ' ', 'blank');
      push(r, '|', 'separator');
      gridLowFirst[s].forEach((cells) => {
        cells.forEach((ch) => push(r, ch, ch === '-' ? 'dash' : 'fret'));
        push(r, '|', 'separator');
      });
      stringLines.push(toLine(r));
    }

    systems.push({
      bars: group.map((b) => ({ index: b.index, startBeat: b.startBeat })),
      chordLine: toLine(chordRow),
      strumLine: toLine(strumRow),
      stringLines,
    });
  }

  return {
    systems,
    columnsPerBar,
    prefixColumns,
    width: prefixColumns + barsPerSystem * (columnsPerBar + 1),
    barsPerSystem,
  };
}

/** Character column a beat lands on within its system, or null if it is elsewhere. */
export function columnForBeat(grid: TabGrid, system: TabSystem, beat: number, beatsPerBar: number): number | null {
  for (let b = 0; b < system.bars.length; b++) {
    const start = system.bars[b].startBeat;
    if (beat < start || beat >= start + beatsPerBar) continue;
    return grid.prefixColumns + b * (grid.columnsPerBar + 1) + (beat - start) * COLUMNS_PER_BEAT;
  }
  return null;
}
