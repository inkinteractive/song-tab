/** AudioBuffer helpers: mono fold, trimming, peak extraction, WAV encoding. */

export function toMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= channels;
  return out;
}

export function sliceMono(mono: Float32Array, sampleRate: number, startSec: number, endSec: number): Float32Array {
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(mono.length, Math.ceil(endSec * sampleRate));
  if (end <= start) return new Float32Array(0);
  return mono.slice(start, end);
}

export interface Peaks {
  /** Min/max pairs per pixel column. */
  min: Float32Array;
  max: Float32Array;
}

/** Min/max envelope for waveform drawing. */
export function computePeaks(mono: Float32Array, buckets: number): Peaks {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (mono.length === 0) return { min, max };
  const per = mono.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(mono.length, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = mono[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/** 16-bit PCM WAV, for download and for the phase-2 separation service. */
export function encodeWav(mono: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const dataSize = mono.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function monoToAudioBuffer(mono: Float32Array, sampleRate: number, ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, mono.length), sampleRate);
  // `copyToChannel` is typed against Float32Array<ArrayBuffer>; a slice of a
  // worker-transferred buffer is Float32Array<ArrayBufferLike>.
  buf.copyToChannel(mono as Float32Array<ArrayBuffer>, 0);
  return buf;
}
