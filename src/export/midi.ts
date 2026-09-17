/**
 * Standard MIDI File export, written byte by byte (no dependency).
 *
 * Format 1: a conductor track with tempo and time signature, a strummed chord
 * track, and a melody track when there is a riff.
 */

import { resolveShape, soundingChord, toBars, tuningOf } from '../music/arrangement';
import { shapeMidiNotes } from '../music/chordShapes';
import { chordName } from '../music/theory';
import { patternById } from '../music/strumming';
import type { Arrangement } from '../types';

const TPQ = 480; // ticks per quarter note

function varLen(value: number): number[] {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function str(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

function chunk(id: string, data: number[]): number[] {
  const len = data.length;
  return [...str(id), (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...data];
}

interface Event {
  tick: number;
  /** Note-offs sort before note-ons at the same tick. */
  order: number;
  bytes: number[];
}

function track(events: Event[], name: string): number[] {
  const data: number[] = [];
  data.push(...varLen(0), 0xff, 0x03, name.length, ...str(name));
  const sorted = events.slice().sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  for (const e of sorted) {
    data.push(...varLen(Math.max(0, Math.round(e.tick - last))), ...e.bytes);
    last = e.tick;
  }
  data.push(...varLen(0), 0xff, 0x2f, 0x00);
  return chunk('MTrk', data);
}

function noteEvents(channel: number, midi: number, startTick: number, durTicks: number, velocity: number): Event[] {
  const clamped = Math.max(0, Math.min(127, Math.round(midi)));
  return [
    { tick: startTick, order: 1, bytes: [0x90 | channel, clamped, velocity] },
    { tick: startTick + Math.max(1, Math.round(durTicks)), order: 0, bytes: [0x80 | channel, clamped, 0] },
  ];
}

export function toMidi(a: Arrangement): Uint8Array {
  const beatTicks = TPQ * (4 / a.beatUnit);
  const tuning = tuningOf(a);
  const pattern = patternById(a.strumPatternId);

  // Conductor track
  const usPerQuarter = Math.round(60000000 / a.tempo);
  const conductor: Event[] = [
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
    },
    {
      tick: 0,
      order: 0,
      bytes: [0xff, 0x58, 0x04, a.beatsPerBar, Math.round(Math.log2(a.beatUnit)), 24, 8],
    },
  ];
  for (const bar of toBars(a)) {
    for (const bc of bar.chords) {
      const label = chordName(soundingChord(bc, a));
      conductor.push({
        tick: Math.round(bc.startBeat * beatTicks),
        order: 2,
        bytes: [0xff, 0x01, label.length, ...str(label)],
      });
    }
  }

  // Chord track: strummed using the suggested pattern, lightly spread.
  const chordEvents: Event[] = [{ tick: 0, order: 0, bytes: [0xc0, 25] }];
  for (const bc of a.chords) {
    const midis = shapeMidiNotes(resolveShape(bc, a), tuning, a.capo);
    const strokesPerBar = pattern.strokes.length;
    const beatsPerStroke = a.beatsPerBar / strokesPerBar;
    for (let s = 0; s < strokesPerBar; s++) {
      const stroke = pattern.strokes[s];
      if (stroke === '-') continue;
      const strokeBeat = Math.floor(bc.startBeat / a.beatsPerBar) * a.beatsPerBar + s * beatsPerStroke;
      if (strokeBeat < bc.startBeat - 1e-6 || strokeBeat >= bc.startBeat + bc.durationBeats - 1e-6) continue;
      const order = stroke === 'D' ? midis : midis.slice().reverse();
      order.forEach((midi, i) => {
        const spread = i * 0.012 * beatTicks;
        chordEvents.push(
          ...noteEvents(
            0,
            midi,
            strokeBeat * beatTicks + spread,
            beatsPerStroke * beatTicks * 0.95,
            stroke === 'D' ? 88 : 68,
          ),
        );
      });
    }
  }

  const tracks = [track(conductor, 'Conductor'), track(chordEvents, 'Guitar (chords)')];

  if (a.riff.length > 0) {
    const melody: Event[] = [{ tick: 0, order: 0, bytes: [0xc1, 25] }];
    for (const n of a.riff) {
      melody.push(
        ...noteEvents(1, n.midi + a.transpose, n.startBeat * beatTicks, n.durationBeats * beatTicks * 0.95, 96),
      );
    }
    tracks.push(track(melody, 'Guitar (riff)'));
  }

  const header = chunk('MThd', [0, 1, 0, tracks.length, (TPQ >> 8) & 0xff, TPQ & 0xff]);
  return Uint8Array.from([...header, ...tracks.flat()]);
}
