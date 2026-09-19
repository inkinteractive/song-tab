/**
 * Runs the analysis over real recordings in `fixtures/` and reports what it
 * heard against what was played.
 *
 * This reports rather than asserts. Every other number in the suite is measured
 * against audio this repository synthesised, which is how the chord engine came
 * to score 100% and then mis-name a C played on an actual guitar. Until there
 * are enough real clips to tune against, the useful output is the table, not a
 * pass or a fail - so an empty `fixtures/` directory is not a failure either.
 *
 *     npm run fixtures
 *
 * WAV only: there is no audio decoder in the build environment, so MP3 and M4A
 * cannot be read. See `fixtures/README.md`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeClip } from './engine';
import { chordName } from '../music/theory';
import { DEFAULT_SETTINGS } from '../types';

interface Fixture {
  file: string;
  /** What was actually played, one entry per bar. */
  chords: string[];
  note?: string;
}

const DIR = join(process.cwd(), 'fixtures');
const MANIFEST = join(DIR, 'fixtures.json');

interface Decoded {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Minimal RIFF/WAVE reader: PCM 16/24/32-bit integer and 32-bit float, mono or
 * stereo, downmixed to mono. Chunks are walked rather than assumed, because
 * plenty of recorders put LIST or fact chunks before the data.
 */
export function decodeWav(buf: Buffer): Decoded {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let format = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bits = 16;
  let data: Buffer | null = null;

  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      format = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its GUID's first two bytes.
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(body + 24);
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    at = body + size + (size % 2); // chunks are word-aligned
  }
  if (!data) throw new Error('no data chunk');

  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytes;
      if (format === 3 && bits === 32) sum += data.readFloatLE(o);
      else if (bits === 16) sum += data.readInt16LE(o) / 32768;
      else if (bits === 24) sum += ((data.readUInt8(o) | (data.readUInt8(o + 1) << 8) | (data.readInt8(o + 2) << 16)) / 8388608);
      else if (bits === 32) sum += data.readInt32LE(o) / 2147483648;
      else throw new Error(`unsupported: ${bits}-bit format ${format}`);
    }
    out[f] = sum / channels;
  }
  return { samples: out, sampleRate };
}

function loadManifest(): Fixture[] {
  if (!existsSync(MANIFEST)) return [];
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    throw new Error(`fixtures/fixtures.json is not valid JSON: ${(err as Error).message}`);
  }
}

const FIXTURES = loadManifest();

/** Builds a WAV in memory so the reader is covered without committing audio. */
function makeWav(opts: { bits: number; float?: boolean; channels: number; rate: number; frames: number[][] }): Buffer {
  const { bits, float = false, channels, rate } = opts;
  const bytes = bits / 8;
  const data = Buffer.alloc(opts.frames.length * channels * bytes);
  opts.frames.forEach((frame, f) => {
    frame.forEach((v, c) => {
      const o = (f * channels + c) * bytes;
      if (float) data.writeFloatLE(v, o);
      else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), o);
      else if (bits === 24) {
        const i = Math.round(v * 8388607);
        data.writeUInt8(i & 0xff, o);
        data.writeUInt8((i >> 8) & 0xff, o + 1);
        data.writeInt8(i >> 16, o + 2);
      } else data.writeInt32LE(Math.round(v * 2147483647), o);
    });
  });
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(float ? 3 : 1, 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * channels * bytes, 8);
  fmt.writeUInt16LE(channels * bytes, 12);
  fmt.writeUInt16LE(bits, 14);
  const head = (id: string, size: number) => {
    const b = Buffer.alloc(8);
    b.write(id, 0, 'ascii');
    b.writeUInt32LE(size, 4);
    return b;
  };
  // A LIST chunk before the data, because real recorders put one there.
  const list = Buffer.concat([head('LIST', 4), Buffer.from('INFO', 'ascii')]);
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), head('fmt ', 16), fmt, list, head('data', data.length), data]);
  return Buffer.concat([head('RIFF', body.length), body]);
}

describe('wav reader', () => {
  const ramp = Array.from({ length: 64 }, (_, i) => [(i / 64) * 2 - 1]);

  it.each([
    ['16-bit mono', 16, false],
    ['24-bit mono', 24, false],
    ['32-bit mono', 32, false],
    ['32-bit float mono', 32, true],
  ])('reads %s past a LIST chunk', (_label, bits, float) => {
    const wav = makeWav({ bits, float, channels: 1, rate: 22050, frames: ramp });
    const out = decodeWav(wav);
    expect(out.sampleRate).toBe(22050);
    expect(out.samples).toHaveLength(64);
    for (let i = 0; i < 64; i++) expect(out.samples[i]).toBeCloseTo(ramp[i][0], 3);
  });

  it('downmixes stereo to mono', () => {
    const frames = [[1, -1], [0.5, 0.5], [-0.25, 0.75]];
    const out = decodeWav(makeWav({ bits: 16, channels: 2, rate: 44100, frames }));
    expect(out.sampleRate).toBe(44100);
    expect(Array.from(out.samples)).toEqual([
      expect.closeTo(0, 3),
      expect.closeTo(0.5, 3),
      expect.closeTo(0.25, 3),
    ]);
  });

  it('refuses something that is not a WAV', () => {
    expect(() => decodeWav(Buffer.from('ID3 this is an mp3', 'ascii'))).toThrow(/RIFF/);
  });
});


describe('real recordings', () => {
  if (FIXTURES.length === 0) {
    it('has nothing to measure yet', () => {
      console.log('fixtures/ is empty. See fixtures/README.md for how to add a recording.');
      expect(FIXTURES).toEqual([]);
    });
    return;
  }

  let totalBars = 0;
  let totalHits = 0;

  it.each(FIXTURES.map((f) => [f.file, f] as const))('%s', async (_name, fixture) => {
    const path = join(DIR, fixture.file);
    expect(existsSync(path), `${fixture.file} is in the manifest but not on disk`).toBe(true);

    const { samples, sampleRate } = decodeWav(readFileSync(path));
    const seconds = samples.length / sampleRate;
    const result = await analyzeClip({ samples, sampleRate, settings: { ...DEFAULT_SETTINGS } });

    const heard = result.arrangement.chords.map((c) => chordName(c.chord));
    const played = fixture.chords;
    const compared = Math.min(played.length, heard.length);
    let hits = 0;
    const rows: string[] = [];
    for (let i = 0; i < compared; i++) {
      const ok = played[i] === heard[i];
      if (ok) hits++;
      rows.push(`  bar ${String(i + 1).padStart(2)}  played ${played[i].padEnd(7)} heard ${(heard[i] ?? '-').padEnd(7)} ${ok ? '' : '  <-'}`);
    }
    totalBars += compared;
    totalHits += hits;

    console.log(
      `\n${fixture.file}  (${seconds.toFixed(1)}s, ${sampleRate}Hz, ${result.backend})` +
        (fixture.note ? `\n  ${fixture.note}` : '') +
        `\n  tempo ${Math.round(result.arrangement.tempo)} BPM, key ${chordName({
          root: result.detectedKey.tonic,
          quality: result.detectedKey.mode === 'minor' ? 'min' : 'maj',
        })}, ${played.length} bars played / ${heard.length} heard` +
        `\n${rows.join('\n')}` +
        `\n  ${hits}/${compared} bars correct`,
    );
  }, 180000);

  it('totals', () => {
    if (totalBars > 0) {
      console.log(`\nacross all fixtures: ${totalHits}/${totalBars} bars (${Math.round((100 * totalHits) / totalBars)}%)`);
    }
    expect(totalBars).toBeGreaterThanOrEqual(0);
  });
});
