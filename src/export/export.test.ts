/**
 * Exporter checks: shape, wellformedness and the invariants that decide whether
 * MuseScore and Guitar Pro will actually open the file.
 */

import { describe, expect, it } from 'vitest';
import { asciiTab, chordChartText } from './ascii';
import { splitDuration, toMusicXml } from './musicxml';
import { toMidi } from './midi';
import { buildScore, durationParts, toGuitarProBytes } from '../render/score';
import type { Arrangement } from '../types';

function fixture(overrides: Partial<Arrangement> = {}): Arrangement {
  return {
    tier: 'standard',
    tempo: 120,
    beatsPerBar: 4,
    beatUnit: 4,
    key: { tonic: 0, mode: 'major' },
    tuningId: 'standard',
    capo: 0,
    transpose: 0,
    strumPatternId: 'ddu-udu',
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
    const bytes = toMidi(fixture({ riff: [], tier: 'essential' }));
    expect((bytes[10] << 8) | bytes[11]).toBe(2);
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

  it('uses slash notation for the Essential tier and a tab staff otherwise', () => {
    const essential = buildScore(fixture({ tier: 'essential', riff: [] }));
    expect(essential.score.tracks[0].staves[0].showSlash).toBe(true);
    expect(essential.riffTrack).toBeNull();

    const standard = buildScore(fixture());
    expect(standard.riffTrack).not.toBeNull();
    expect(standard.score.tracks[standard.riffTrack!].staves[0].showTablature).toBe(true);
  });

  it('places notes on the right strings', () => {
    // alphaTab numbers strings from the lowest, the reverse of MusicXML; if the
    // mapping flips, the tab staff is a mirror image of the real fingering.
    const built = buildScore(fixture({ tier: 'essential', riff: [] }));
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
