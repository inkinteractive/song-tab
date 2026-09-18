/**
 * Transport.
 *
 * Two sources: the original clip as captured, and alphaTab playing the
 * arrangement back.
 *
 * Position is pushed into the playhead store rather than into React state, so
 * the chart highlight tracks the audio instead of the render queue.
 */

import { useEffect, useRef, useState } from 'react';
import type * as alphaTab from '@coderline/alphatab';
import { useStore } from '../state/store';
import { sliceMono } from '../audio/buffer';
import { createClipPlayer, type ClipPlayer } from '../audio/player';
import { setPlayheadPlaying, setPlayheadSeconds, usePlayheadSeconds } from '../state/playhead';

export type PlaybackSource = 'clip' | 'synth';

interface Props {
  api: alphaTab.AlphaTabApi | null;
  source: PlaybackSource;
  onSourceChange: (s: PlaybackSource) => void;
}

const SPEEDS = [0.5, 0.75, 1];

export function PlaybackBar({ api, source, onSourceChange }: Props) {
  const audio = useStore((s) => s.audio);
  const trim = useStore((s) => s.trim);
  const a = useStore((s) => s.arrangement);

  const playerRef = useRef<ClipPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [duration, setDuration] = useState(0);
  const position = usePlayheadSeconds() ?? 0;

  // Views that follow the playhead need to know when to stop following.
  useEffect(() => {
    setPlayheadPlaying(playing);
    return () => setPlayheadPlaying(false);
  }, [playing]);

  // Rebuild the audio player when the source, the selection or the stem changes.
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setPlaying(false);
    setPlayheadSeconds(0);
    if (!audio || source === 'synth') return;

    const clip = sliceMono(audio.mono, audio.sampleRate, trim.start, trim.end);
    const sampleRate = audio.sampleRate;
    if (clip.length === 0) return;

    const player = createClipPlayer(
      clip,
      sampleRate,
      (t) => setPlayheadSeconds(t),
      () => {
        setPlaying(false);
        setPlayheadSeconds(null);
      },
    );
    player.setRate(speed);
    player.setLoop(loop);
    playerRef.current = player;
    setDuration(player.duration);
    return () => {
      player.dispose();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, trim.start, trim.end, source]);

  // Follow alphaTab's own player when it is the one making the sound.
  useEffect(() => {
    if (!api || source !== 'synth' || !a) return;
    const handler = (args: { currentTime: number; endTime: number }) => {
      setDuration(args.endTime / 1000);
      // alphaTab's timeline starts at bar 1; the clip's does not.
      setPlayheadSeconds(args.currentTime / 1000 + a.beatOffset);
    };
    api.playerPositionChanged.on(handler);
    return () => api.playerPositionChanged.off(handler);
  }, [api, source, a]);

  // Keep alphaTab's own looping in step with the transport.
  useEffect(() => {
    if (!api) return;
    api.isLooping = loop;
  }, [api, loop]);

  function toggle() {
    if (source === 'synth') {
      api?.playPause();
      setPlaying((v) => !v);
      return;
    }
    const player = playerRef.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      void player.play();
      setPlaying(true);
    }
  }

  function stop() {
    if (source === 'synth') api?.stop();
    else {
      playerRef.current?.pause();
      playerRef.current?.seek(0);
    }
    setPlaying(false);
    setPlayheadSeconds(null);
  }

  function seek(sec: number) {
    if (source === 'synth' && api) {
      api.timePosition = Math.max(0, (sec - (a?.beatOffset ?? 0)) * 1000);
    } else {
      playerRef.current?.seek(sec);
    }
    setPlayheadSeconds(sec);
  }

  function changeSpeed(rate: number) {
    setSpeed(rate);
    if (source === 'synth') {
      if (api) api.playbackSpeed = rate;
    } else {
      playerRef.current?.setRate(rate);
    }
  }

  function toggleLoop() {
    const next = !loop;
    setLoop(next);
    playerRef.current?.setLoop(next);
    if (api) api.isLooping = next;
  }

  const total = duration || (a?.clipDuration ?? 0);
  const sources: { id: PlaybackSource; label: string; title: string }[] = [
    { id: 'clip', label: 'Original clip', title: 'The audio as captured' },
    { id: 'synth', label: 'Synth', title: 'alphaTab playing the arrangement' },
  ];

  return (
    <div className="card sticky top-2 z-20 flex flex-wrap items-center gap-3 backdrop-blur">
      <div className="flex rounded-md border border-ink-600 p-0.5 text-xs">
        {sources.map((s) => (
          <button
            key={s.id}
            title={s.title}
            onClick={() => {
              stop();
              onSourceChange(s.id);
            }}
            className={`rounded px-2 py-1 transition ${
              source === s.id ? 'bg-amber-450 text-ink-900' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <button className="btn btn-primary px-3" onClick={toggle} disabled={source === 'synth' && !api}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="btn px-3" onClick={stop} title="Stop">
        ■
      </button>
      <button
        className={`btn px-3 ${loop ? 'border-amber-450 text-amber-450' : ''}`}
        onClick={toggleLoop}
        title={loop ? 'Looping - click to play once' : 'Loop the clip'}
        aria-pressed={loop}
      >
        ⟳
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(0.1, total)}
        step={0.01}
        value={Math.min(position, total)}
        onChange={(e) => seek(Number(e.target.value))}
        className="min-w-[140px] flex-1 accent-amber-450"
      />
      <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-slate-400">
        {position.toFixed(1)} / {total.toFixed(1)}s
      </span>

      <div className="flex items-center gap-1 text-xs text-slate-400">
        speed
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => changeSpeed(s)}
            className={`rounded px-1.5 py-0.5 ${speed === s ? 'bg-ink-600 text-slate-100' : 'hover:bg-ink-700'}`}
          >
            {s}×
          </button>
        ))}
      </div>

    </div>
  );
}
