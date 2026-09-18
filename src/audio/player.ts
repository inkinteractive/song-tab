/**
 * Clip playback.
 *
 * Two details matter for the cursor lining up with what a teacher hears:
 *
 * - `currentTime()` reports the audio *being heard*, not the audio being
 *   scheduled. The graph's own latency plus the device's output latency sit
 *   between the two, typically 10-50ms, and a cursor that ignores them runs
 *   ahead of the sound.
 * - Looping is done on the source node rather than by restarting on `ended`,
 *   so a bar-long riff repeats gaplessly instead of hiccuping every pass.
 */

import { monoToAudioBuffer } from './buffer';

export interface ClipPlayer {
  play(fromSec?: number): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  readonly duration: number;
  /** Position of the audio currently reaching the speakers. */
  currentTime(): number;
  isPlaying(): boolean;
  setRate(rate: number): void;
  setLoop(loop: boolean): void;
  isLooping(): boolean;
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
  let looping = false;
  let rate = 1;
  let raf = 0;

  /** Seconds between scheduling a sample and hearing it. */
  function latency(): number {
    const base = context.baseLatency || 0;
    const output = (context as AudioContext & { outputLatency?: number }).outputLatency || 0;
    return base + output;
  }

  /** Media position that has been scheduled so far - used for bookkeeping. */
  function scheduledTime(): number {
    return offset + (context.currentTime - startedAt) * rate;
  }

  function wrap(t: number): number {
    if (buffer.duration <= 0) return 0;
    if (looping) return ((t % buffer.duration) + buffer.duration) % buffer.duration;
    return Math.max(0, Math.min(buffer.duration, t));
  }

  function currentTime(): number {
    if (!playing) return offset;
    return wrap(scheduledTime() - latency() * rate);
  }

  const tick = () => {
    if (!playing) return;
    onTime(currentTime());
    raf = requestAnimationFrame(tick);
  };

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

  const player: ClipPlayer = {
    get duration() {
      return buffer.duration;
    },
    currentTime,
    isPlaying: () => playing,
    isLooping: () => looping,
    setRate(r: number) {
      const wasPlaying = playing;
      const at = currentTime();
      rate = r;
      if (wasPlaying) {
        player.pause();
        void player.play(at);
      }
    },
    setLoop(loop: boolean) {
      looping = loop;
      // Live on the running node, so toggling mid-pass takes effect at the
      // end of the current lap rather than needing a restart.
      if (node) node.loop = loop;
    },
    async play(fromSec?: number) {
      if (context.state === 'suspended') await context.resume();
      stopNode();
      offset = fromSec ?? offset;
      if (offset >= buffer.duration - 1e-3) offset = 0;
      node = context.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = rate;
      node.loop = looping;
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
      // Bookkeeping uses the scheduled position so repeated pause/resume does
      // not creep backwards by the output latency each time.
      offset = wrap(scheduledTime());
      playing = false;
      cancelAnimationFrame(raf);
      stopNode();
      onTime(offset);
    },
    seek(sec: number) {
      const target = Math.max(0, Math.min(buffer.duration, sec));
      if (playing) {
        void player.play(target);
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

  return player;
}
