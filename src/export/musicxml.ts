/**
 * MusicXML 3.1 export (score-partwise), targeted at MuseScore.
 *
 * Part 1 is the strummed chord part: harmony symbols over the actual voicing.
 * Part 2, when there is a riff, is a tab staff carrying string/fret for every
 * note so MuseScore renders real tab rather than a bare treble line.
 */

import {
  displayName,
  groupRiffIntoChords,
  preferFlats,
  resolveShape,
  soundingChord,
  toBars,
  tuningOf,
} from '../music/arrangement';
import { FLAT_NAMES, QUALITY_SUFFIX, SHARP_NAMES, type ChordQuality } from '../music/theory';
import { shapeMidiNotes } from '../music/chordShapes';
import type { Arrangement } from '../types';

const DIVISIONS = 4; // per quarter note -> sixteenth resolution

interface NoteValue {
  divs: number;
  type: string;
  dots: number;
}

const DURATION_TABLE: NoteValue[] = [
  { divs: 16, type: 'whole', dots: 0 },
  { divs: 12, type: 'half', dots: 1 },
  { divs: 8, type: 'half', dots: 0 },
  { divs: 6, type: 'quarter', dots: 1 },
  { divs: 4, type: 'quarter', dots: 0 },
  { divs: 3, type: 'eighth', dots: 1 },
  { divs: 2, type: 'eighth', dots: 0 },
  { divs: 1, type: '16th', dots: 0 },
];

/** Greedy split of a duration into writable note values (tied together). */
export function splitDuration(divs: number): NoteValue[] {
  const out: NoteValue[] = [];
  let remaining = Math.max(1, Math.round(divs));
  let guard = 0;
  while (remaining > 0 && guard++ < 64) {
    const fit = DURATION_TABLE.find((d) => d.divs <= remaining);
    if (!fit) break;
    out.push(fit);
    remaining -= fit.divs;
  }
  return out.length ? out : [DURATION_TABLE[DURATION_TABLE.length - 1]];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function spell(midiOrPc: number, flats: boolean): { step: string; alter: number } {
  const name = (flats ? FLAT_NAMES : SHARP_NAMES)[((midiOrPc % 12) + 12) % 12];
  return { step: name[0], alter: name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0 };
}

function pitchXml(midi: number, flats: boolean): string {
  const { step, alter } = spell(midi, flats);
  const octave = Math.floor(midi / 12) - 1;
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${octave}</octave></pitch>`;
}

const HARMONY_KIND: Record<ChordQuality, string> = {
  maj: 'major',
  min: 'minor',
  dim: 'diminished',
  aug: 'augmented',
  '7': 'dominant',
  maj7: 'major-seventh',
  min7: 'minor-seventh',
  dim7: 'diminished-seventh',
  m7b5: 'half-diminished',
  sus2: 'suspended-second',
  sus4: 'suspended-fourth',
  add9: 'major',
  '6': 'major-sixth',
  min6: 'minor-sixth',
  '5': 'power',
};

function harmonyXml(rootPc: number, quality: ChordQuality, flats: boolean): string {
  const { step, alter } = spell(rootPc, flats);
  const degree =
    quality === 'add9'
      ? '        <degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>'
      : '';
  return [
    '      <harmony>',
    `        <root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ''}</root>`,
    `        <kind text="${esc(QUALITY_SUFFIX[quality])}">${HARMONY_KIND[quality]}</kind>`,
    degree,
    '      </harmony>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Circle-of-fifths signature for the sounding key. */
function fifthsFor(a: Arrangement): number {
  const tonic = (a.key.tonic + a.transpose + 12) % 12;
  const majorTonic = a.key.mode === 'minor' ? (tonic + 3) % 12 : tonic;
  const table: Record<number, number> = {
    0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1,
  };
  return table[majorTonic] ?? 0;
}

function attributesXml(a: Arrangement, tab: boolean): string {
  const tuning = tuningOf(a);
  const staffDetails = tab
    ? [
        '        <staff-details>',
        `          <staff-lines>${tuning.length}</staff-lines>`,
        ...tuning.map((m, i) => {
          const { step, alter } = spell(m, false);
          return [
            `          <staff-tuning line="${i + 1}">`,
            `            <tuning-step>${step}</tuning-step>`,
            alter ? `            <tuning-alter>${alter}</tuning-alter>` : '',
            `            <tuning-octave>${Math.floor(m / 12) - 1}</tuning-octave>`,
            '          </staff-tuning>',
          ]
            .filter(Boolean)
            .join('\n');
        }),
        a.capo > 0 ? `          <capo>${a.capo}</capo>` : '',
        '        </staff-details>',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return [
    '      <attributes>',
    `        <divisions>${DIVISIONS}</divisions>`,
    `        <key><fifths>${fifthsFor(a)}</fifths><mode>${a.key.mode}</mode></key>`,
    `        <time><beats>${a.beatsPerBar}</beats><beat-type>${a.beatUnit}</beat-type></time>`,
    tab
      ? '        <clef><sign>TAB</sign><line>5</line></clef>'
      : '        <clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>',
    staffDetails,
    '      </attributes>',
  ]
    .filter(Boolean)
    .join('\n');
}

function restXml(divs: number): string {
  return splitDuration(divs)
    .map(
      (d) =>
        `      <note><rest/><duration>${d.divs}</duration><voice>1</voice><type>${d.type}</type>${'<dot/>'.repeat(
          d.dots,
        )}</note>`,
    )
    .join('\n');
}

/** Tie elements for note `index` of a chain of `total` tied note values. */
function tieXml(index: number, total: number): { ties: string; notations: string } {
  if (total <= 1) return { ties: '', notations: '' };
  const parts: string[] = [];
  const tied: string[] = [];
  if (index > 0) {
    parts.push('        <tie type="stop"/>');
    tied.push('<tied type="stop"/>');
  }
  if (index < total - 1) {
    parts.push('        <tie type="start"/>');
    tied.push('<tied type="start"/>');
  }
  return { ties: parts.join('\n'), notations: tied.join('') };
}

function noteXml(opts: {
  pitch: string;
  value: NoteValue;
  index: number;
  total: number;
  chordFlag?: boolean;
  technical?: string;
}): string {
  const { ties, notations } = tieXml(opts.index, opts.total);
  const inner = [notations, opts.technical ?? ''].filter(Boolean).join('');
  return [
    '      <note>',
    opts.chordFlag ? '        <chord/>' : '',
    `        ${opts.pitch}`,
    `        <duration>${opts.value.divs}</duration>`,
    ties,
    '        <voice>1</voice>',
    `        <type>${opts.value.type}</type>`,
    '        <dot/>'.repeat(opts.value.dots),
    inner ? `        <notations>${inner}</notations>` : '',
    '      </note>',
  ]
    .filter(Boolean)
    .join('\n');
}

function chordPartMeasures(a: Arrangement, flats: boolean): string {
  const tuning = tuningOf(a);
  const barDivs = a.beatsPerBar * DIVISIONS;
  return toBars(a)
    .map((bar, i) => {
      const lines: string[] = [`    <measure number="${i + 1}">`];
      if (i === 0) lines.push(attributesXml(a, false));
      let cursor = 0;

      for (const bc of bar.chords) {
        const offset = Math.round((bc.startBeat - bar.startBeat) * DIVISIONS);
        if (offset > cursor) {
          lines.push(restXml(offset - cursor));
          cursor = offset;
        }
        const sounding = soundingChord(bc, a);
        lines.push(harmonyXml(sounding.root, sounding.quality, flats));

        // The voicing is fingered against the capo, so these are already the
        // sounding pitches.
        const midis = shapeMidiNotes(resolveShape(bc, a), tuning, a.capo);
        const durDivs = Math.min(Math.round(bc.durationBeats * DIVISIONS), barDivs - cursor);
        if (durDivs <= 0) continue;
        const values = splitDuration(durDivs);
        values.forEach((value, vi) => {
          midis.forEach((midi, ni) => {
            lines.push(
              noteXml({
                pitch: pitchXml(midi, flats),
                value,
                index: vi,
                total: values.length,
                chordFlag: ni > 0,
              }),
            );
          });
          cursor += value.divs;
        });
      }
      if (cursor < barDivs) lines.push(restXml(barDivs - cursor));
      lines.push('    </measure>');
      return lines.join('\n');
    })
    .join('\n');
}

function tabPartMeasures(a: Arrangement, flats: boolean): string {
  const stringCount = tuningOf(a).length;
  const barDivs = a.beatsPerBar * DIVISIONS;
  return toBars(a)
    .map((bar, i) => {
      const lines: string[] = [`    <measure number="${i + 1}">`];
      if (i === 0) lines.push(attributesXml(a, true));
      let cursor = 0;
      // Notes that start together are one stacked event, not a run of
      // overlapping ones - a hand-edited riff can stack notes.
      for (const group of groupRiffIntoChords(bar.notes)) {
        const offset = Math.round((group.startBeat - bar.startBeat) * DIVISIONS);
        if (offset > cursor) {
          lines.push(restXml(offset - cursor));
          cursor = offset;
        }
        if (barDivs - cursor <= 0) break;
        const durDivs = Math.max(1, Math.min(Math.round(group.durationBeats * DIVISIONS), barDivs - cursor));
        const values = splitDuration(durDivs);
        values.forEach((value, vi) => {
          group.notes.forEach((n, ni) => {
            // MusicXML numbers string 1 as the highest sounding string.
            const technical =
              n.string !== undefined && n.fret !== undefined
                ? `<technical><string>${stringCount - n.string}</string><fret>${n.fret}</fret></technical>`
                : '';
            lines.push(
              noteXml({
                pitch: pitchXml(n.midi + a.transpose, flats),
                value,
                index: vi,
                total: values.length,
                chordFlag: ni > 0,
                technical: vi === 0 ? technical : '',
              }),
            );
          });
          cursor += value.divs;
        });
      }
      if (cursor < barDivs) lines.push(restXml(barDivs - cursor));
      lines.push('    </measure>');
      return lines.join('\n');
    })
    .join('\n');
}

export function toMusicXml(a: Arrangement, title = 'Simplified arrangement'): string {
  const flats = preferFlats(a);
  const includeTab = a.riff.length > 0;
  const first = a.chords[0];
  const subtitle = first ? `Starts on ${displayName(first, a)}${a.capo ? ` (capo ${a.capo})` : ''}` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${esc(title)}</work-title></work>
  <identification>
    <encoding>
      <software>Song to Tab</software>
      <encoding-description>${esc(subtitle)}</encoding-description>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Guitar (chords)</part-name>
      <score-instrument id="P1-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>26</midi-program></midi-instrument>
    </score-part>${
      includeTab
        ? `
    <score-part id="P2">
      <part-name>Guitar (riff)</part-name>
      <score-instrument id="P2-I1"><instrument-name>Acoustic Guitar</instrument-name></score-instrument>
      <midi-instrument id="P2-I1"><midi-channel>2</midi-channel><midi-program>26</midi-program></midi-instrument>
    </score-part>`
        : ''
    }
  </part-list>
  <part id="P1">
${chordPartMeasures(a, flats)}
  </part>${
    includeTab
      ? `
  <part id="P2">
${tabPartMeasures(a, flats)}
  </part>`
      : ''
  }
</score-partwise>
`;
}
