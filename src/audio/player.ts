/**
 * Clip playback.
 *
 * Drives the score cursor: `onTime` fires per animation frame with the position
 * inside the clip, which the renderer maps onto the arrangement.
 */

import { monoToAudioBuffer } from './buffer';

export interface ClipPlayer {
  play(fromSec?: number): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  readonly duration: number;
  currentTime(): number;
  isPlaying(): boolean;
  setRate(rate: number): void;
  dispose(): void;
}

export function createClipPlayer(
  mono: Float32Array,
  sampleRate: number,
  onTime: (sec: number) => void,
  onEnded: () => void,
): ClipPlayer {
  const context = new AudioContext();
  const buffer = monoToAudioBuffer(mono, sampleRate, context);
  const gain = context.createGain();
  gain.connect(context.destination);

  let node: AudioBufferSourceNode | null = null;
  let startedAt = 0;
  let offset = 0;
  let playing = false;
  let rate = 1;
  let raf = 0;

  const tick = () => {
    if (!playing) return;
    onTime(currentTime());
    raf = requestAnimationFrame(tick);
  };

  function currentTime(): number {
    if (!playing) return offset;
    return Math.min(buffer.duration, offset + (context.currentTime - startedAt) * rate);
  }

  function stopNode() {
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
      node.disconnect();
      node = null;
    }
  }

  return {
    get duration() {
      return buffer.duration;
    },
    currentTime,
    isPlaying: () => playing,
    setRate(r: number) {
      const wasPlaying = playing;
      const at = currentTime();
      rate = r;
      if (wasPlaying) {
        this.pause();
        void this.play(at);
      }
    },
    async play(fromSec?: number) {
      if (context.state === 'suspended') await context.resume();
      stopNode();
      offset = fromSec ?? offset;
      if (offset >= buffer.duration - 1e-3) offset = 0;
      node = context.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = rate;
      node.connect(gain);
      node.onended = () => {
        if (!playing) return;
        playing = false;
        cancelAnimationFrame(raf);
        offset = 0;
        onTime(0);
        onEnded();
      };
      node.start(0, offset);
      startedAt = context.currentTime;
      playing = true;
      raf = requestAnimationFrame(tick);
    },
    pause() {
      if (!playing) return;
      offset = currentTime();
      playing = false;
      cancelAnimationFrame(raf);
      stopNode();
      onTime(offset);
    },
    seek(sec: number) {
      const target = Math.max(0, Math.min(buffer.duration, sec));
      if (playing) {
        void this.play(target);
      } else {
        offset = target;
        onTime(offset);
      }
    },
    dispose() {
      cancelAnimationFrame(raf);
      stopNode();
      void context.close().catch(() => undefined);
    },
  };
}
