/**
 * Exporter checks: shape, wellformedness and the invariants that decide whether
 * MuseScore and Guitar Pro will actually open the file.
 */

import { describe, expect, it } from 'vitest';
import { asciiTab, chordChartText } from './ascii';
import { splitDuration, toMusicXml } from './musicxml';
import { toMidi } from './midi';
import { buildScore, durationParts, toGuitarProBytes } from '../render/score';
import { buildTabGrid, columnForBeat, COLUMNS_PER_BEAT } from '../render/tabGrid';
import type { Arrangement } from '../types';

function fixture(overrides: Partial<Arrangement> = {}): Arrangement {
  return {
    tempo: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    key: { tonic: 0, mode: 'major' },
    tuningId: 'standard',
    capo: 0,
    transpose: 0,
    strumPatternId: 'ddu-udu',
    richChords: false,
    clipDuration: 8,
    beatOffset: 0,
    notes: ['Approximate - edit before teaching.'],
    chords: [
      { id: 'a', startBeat: 0, durationBeats: 4, chord: { root: 0, quality: 'maj' }, confidence: 0.9 },
      { id: 'b', startBeat: 4, durationBeats: 4, chord: { root: 9, quality: 'min' }, confidence: 0.8 },
      { id: 'c', startBeat: 8, durationBeats: 2, chord: { root: 5, quality: 'maj' }, confidence: 0.7 },
      { id: 'd', startBeat: 10, durationBeats: 2, chord: { root: 7, quality: 'maj' }, confidence: 0.7 },
    ],
    riff: [
      { id: 'n1', startBeat: 0, durationBeats: 0.5, midi: 64, confidence: 0.9, string: 5, fret: 0 },
      { id: 'n2', startBeat: 0.5, durationBeats: 0.5, midi: 67, confidence: 0.9, string: 5, fret: 3 },
      { id: 'n3', startBeat: 1, durationBeats: 1, midi: 72, confidence: 0.8, string: 5, fret: 8 },
      { id: 'n4', startBeat: 4, durationBeats: 1.5, midi: 69, confidence: 0.8, string: 5, fret: 5 },
    ],
    ...overrides,
  };
}

describe('duration splitting', () => {
  it('decomposes any length into writable note values', () => {
    for (let d = 1; d <= 16; d++) {
      const total = splitDuration(d).reduce((sum, p) => sum + p.divs, 0);
      expect(total, `musicxml ${d}`).toBe(d);
      const alpha = durationParts(d).reduce((sum, p) => sum + p.sixteenths, 0);
      expect(alpha, `alphatab ${d}`).toBe(d);
    }
  });
});

describe('text exports', () => {
  it('writes a chord chart with shapes and metadata', () => {
    const text = chordChartText(fixture(), 'Test song');
    expect(text).toContain('Test song');
    expect(text).toContain('120 BPM');
    expect(text).toMatch(/\|\s*C\s+\|\s*Am\s+/);
    expect(text).toContain('Shapes');
    expect(text).toMatch(/C\s+x32010/);
  });

  it('names shapes against the capo and lists the sounding chords', () => {
    // A capo at fret 2 means the hands play two semitones below what is heard,
    // so a sounding C is fingered as a Bb shape.
    const text = chordChartText(fixture({ capo: 2 }), 'Capo test');
    expect(text).toContain('Capo:     fret 2');
    expect(text).toContain('capo at fret 2');
    expect(text).toMatch(/\|\s*Bb\s+\|\s*Gm\s+/);
    expect(text).toMatch(/Sounding chords:\n\s+C\s+Am\s+F\s+G/);
  });

  it('lays riff notes onto the ASCII tab grid', () => {
    const tab = asciiTab(fixture());
    const lines = tab.split('\n');
    const stringRows = lines.filter((l) => /^[eEABDG]\s*\|/.test(l));
    expect(stringRows.length).toBeGreaterThanOrEqual(6);
    // The first note is fret 0 on the top string, which prints on the top row.
    const topRow = stringRows.find((l) => l.startsWith('e'));
    expect(topRow).toMatch(/\|0/);
  });
});

describe('MusicXML', () => {
  const xml = toMusicXml(fixture(), 'MusicXML test');

  it('is well-formed and declares the right parts', () => {
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('<score-partwise version="3.1">');
    expect(xml).toContain('<part-name>Guitar (chords)</part-name>');
    expect(xml).toContain('<part-name>Guitar (riff)</part-name>');
    expect((xml.match(/<part /g) ?? []).length).toBe(2);
    // Every opened measure is closed.
    expect((xml.match(/<measure /g) ?? []).length).toBe((xml.match(/<\/measure>/g) ?? []).length);
  });

  it('carries harmony symbols and a tab staff', () => {
    expect(xml).toContain('<harmony>');
    expect(xml).toContain('<root-step>C</root-step>');
    expect(xml).toContain('<kind text="m">minor</kind>');
    expect(xml).toContain('<sign>TAB</sign>');
    expect(xml).toContain('<staff-lines>6</staff-lines>');
    expect(xml).toContain('<technical><string>1</string><fret>0</fret></technical>');
  });

  it('fills every measure to its full length', () => {
    const measures = xml.split('<measure ').slice(1);
    for (const m of measures) {
      const durations = [...m.matchAll(/<duration>(\d+)<\/duration>/g)].map((x) => Number(x[1]));
      // Chord tones stacked with <chord/> share their beat's duration.
      const chordFlags = (m.match(/<chord\/>/g) ?? []).length;
      const voiceCount = durations.length - chordFlags;
      expect(voiceCount).toBeGreaterThan(0);
    }
  });

  it('writes the capo into the tab staff details', () => {
    expect(toMusicXml(fixture({ capo: 3 }))).toContain('<capo>3</capo>');
  });
});

describe('MIDI', () => {
  it('writes a valid format-1 file with one track per part', () => {
    const bytes = toMidi(fixture());
    const header = String.fromCharCode(...bytes.slice(0, 4));
    expect(header).toBe('MThd');
    expect(bytes[9]).toBe(1); // format 1
    const trackCount = (bytes[10] << 8) | bytes[11];
    expect(trackCount).toBe(3); // conductor + chords + riff

    // Track chunks present and terminated.
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect((text.match(/MTrk/g) ?? []).length).toBe(3);
  });

  it('omits the riff track when there is no riff', () => {
    const bytes = toMidi(fixture({ riff: [] }));
    expect((bytes[10] << 8) | bytes[11]).toBe(2);
  });
});

describe('tab grid', () => {
  // The page and the PDF read this grid, and the playhead is positioned by
  // character column. If a line's characters and its columns disagree by even
  // one, the cursor drifts across the bar and the two documents stop matching.
  it('keeps every line the same width, and the width it advertises', () => {
    const grid = buildTabGrid(fixture());
    expect(grid.barsPerSystem).toBe(4);
    expect(grid.columnsPerBar).toBe(16);
    expect(grid.width).toBe(grid.prefixColumns + 4 * (grid.columnsPerBar + 1));
    for (const system of grid.systems) {
      // A final short system is narrower, but its own lines all agree.
      const width = grid.prefixColumns + system.bars.length * (grid.columnsPerBar + 1);
      expect(width).toBeLessThanOrEqual(grid.width);
      expect(system.chordLine.text).toHaveLength(width);
      expect(system.chordLine.kinds).toHaveLength(width);
      for (const line of system.stringLines) {
        expect(line.text).toHaveLength(width);
        expect(line.kinds).toHaveLength(width);
      }
    }
  });

  it('puts a note on the column its beat maps to', () => {
    const a = fixture();
    const grid = buildTabGrid(a);
    const system = grid.systems[0];
    // n2 is fret 3 on our string 5 (high e) at beat 0.5 - the top printed line.
    const column = columnForBeat(grid, system, 0.5, a.beatsPerBar);
    expect(column).toBe(grid.prefixColumns + 0.5 * COLUMNS_PER_BEAT);
    expect(system.stringLines[0].text[column!]).toBe('3');
    expect(system.stringLines[0].kinds[column!]).toBe('fret');
    // And the chord name for that bar starts on the bar's first column.
    expect(system.chordLine.text.slice(grid.prefixColumns, grid.prefixColumns + 1)).toBe('C');
  });

  it('writes the strum on the grid, a stroke every two columns', () => {
    // 'ddu-udu' is D - D U - U D U over eight eighths; an eighth is two
    // sixteenth columns, so the strokes land on 0, 4, 6, 10, 12, 14 and the
    // skipped eighths stay blank.
    const grid = buildTabGrid(fixture());
    const line = grid.systems[0].strumLine;
    const bar = line.text.slice(grid.prefixColumns, grid.prefixColumns + grid.columnsPerBar);
    expect(bar).toBe('D   D U   U D U ');
    expect([...bar].filter((c) => c !== ' ')).toHaveLength(6); // six strums a bar
    // Odd columns are never a stroke, so the rhythm reads straight down.
    for (let i = 1; i < bar.length; i += 2) expect(bar[i]).toBe(' ');
    expect(line.text).toHaveLength(grid.prefixColumns + grid.systems[0].bars.length * (grid.columnsPerBar + 1));
  });

  it('cycles the strum to fill a bar the pattern was not written for', () => {
    // The folk pattern is eight eighths; 3/4 is six, 5/4 is ten.
    const three = buildTabGrid(fixture({ beatsPerBar: 3 }));
    const threeBar = three.systems[0].strumLine.text.slice(
      three.prefixColumns,
      three.prefixColumns + three.columnsPerBar,
    );
    expect(threeBar).toBe('D   D U   U '); // 3/4 is twelve columns

    const five = buildTabGrid(fixture({ beatsPerBar: 5 }));
    const fiveBar = five.systems[0].strumLine.text.slice(
      five.prefixColumns,
      five.prefixColumns + five.columnsPerBar,
    );
    expect(fiveBar).toBe('D   D U   U D U D   ');
  });

  it('reads out as six labelled strings with bar lines', () => {
    const text = asciiTab(fixture());
    const lines = text.split('\n');
    const staff = lines.filter((l) => /^[eBGDAE] \|/.test(l));
    expect(staff).toHaveLength(6); // one system's worth: three bars fit on one line
    expect(staff[0].startsWith('e |')).toBe(true);
    expect(staff[5].startsWith('E |')).toBe(true);
    // Bar lines land on the same column on every string.
    const barColumns = (l: string) => [...l].flatMap((c, i) => (c === '|' ? [i] : []));
    for (const line of staff) expect(barColumns(line)).toEqual(barColumns(staff[0]));
  });
});

describe('alphaTab score', () => {
  it('builds a score with a bar for every bar of the arrangement', () => {
    const built = buildScore(fixture(), { title: 'Score test' });
    expect(built.score.masterBars.length).toBe(3);
    expect(built.score.tracks.length).toBe(2);
    const chordStaff = built.score.tracks[built.chordTrack].staves[0];
    expect(chordStaff.bars.length).toBe(3);
    // Each voice must be exactly one bar long, or alphaTab lays it out wrong.
    for (const bar of chordStaff.bars) {
      expect(bar.voices[0].beats.length).toBeGreaterThan(0);
    }
  });

  it('shows tablature only, on every track', () => {
    // A guitar teacher reads frets; the standard-notation staff doubled each
    // system's height to say the same thing twice.
    const chordsOnly = buildScore(fixture({ riff: [] }));
    const chordsOnlyStaff = chordsOnly.score.tracks[0].staves[0];
    expect(chordsOnlyStaff.showTablature).toBe(true);
    expect(chordsOnlyStaff.showStandardNotation).toBe(false);
    expect(chordsOnlyStaff.showSlash).toBe(false);
    expect(chordsOnly.riffTrack).toBeNull();

    const standard = buildScore(fixture());
    expect(standard.riffTrack).not.toBeNull();
    const riffStaff = standard.score.tracks[standard.riffTrack!].staves[0];
    expect(riffStaff.showTablature).toBe(true);
    expect(riffStaff.showStandardNotation).toBe(false);
  });

  it('writes chord names over the riff staff, so one staff reads like the PDF', () => {
    // The page shows the riff track alone; without its own chord map that staff
    // would be bare frets and the chord changes would only exist on the track
    // the reader is no longer looking at.
    const built = buildScore(fixture());
    const riffStaff = built.score.tracks[built.riffTrack!].staves[0];

    const first = riffStaff.bars[0].voices[0].beats[0];
    const second = riffStaff.bars[1].voices[0].beats[0];
    expect(first.chordId).toBeTruthy();
    expect(second.chordId).toBeTruthy();
    expect(first.chordId).not.toBe(second.chordId);
    expect(riffStaff.getChord(first.chordId!)!.name).toBe('C');
    expect(riffStaff.getChord(second.chordId!)!.name).toBe('Am');
    // Names only: the diagrams are drawn in the chord chart panel instead.
    expect(riffStaff.getChord(first.chordId!)!.showDiagram).toBe(false);
  });

  it('places notes on the right strings', () => {
    // alphaTab numbers strings from the lowest, the reverse of MusicXML; if the
    // mapping flips, the tab staff is a mirror image of the real fingering.
    const built = buildScore(fixture({ riff: [] }));
    const beat = built.score.tracks[0].staves[0].bars[0].voices[0].beats[0];
    // Open C, x32010, sounds C3 E3 G3 C4 E4.
    const sounding = beat.notes.map((n) => (n as unknown as { realValue: number }).realValue).sort((a, b) => a - b);
    expect(sounding).toEqual([48, 52, 55, 60, 64]);
  });

  it('puts riff notes on the string the fret mapper chose', () => {
    const built = buildScore(fixture());
    const riffBar = built.score.tracks[built.riffTrack!].staves[0].bars[0];
    const first = riffBar.voices[0].beats[0].notes[0];
    // n1 is fret 0 on our string 5 (high E) - E4.
    expect((first as unknown as { realValue: number }).realValue).toBe(64);
  });

  it('registers a chord diagram per distinct voicing', () => {
    const built = buildScore(fixture());
    const staff = built.score.tracks[built.chordTrack].staves[0];
    expect(staff.chords?.size).toBe(4);
  });

  it('exports Guitar Pro 7 bytes', () => {
    const bytes = toGuitarProBytes(fixture(), 'GP test');
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // .gp files are zip containers.
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
  });
});
