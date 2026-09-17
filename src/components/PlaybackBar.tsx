/**
 * Playback, either of the original clip (with the score cursor following) or of
 * alphaTab's synth rendering of the arrangement. Checking one against the other
 * is how you tell whether the reduction actually fits the song.
 */

import { useEffect, useRef, useState } from 'react';
import type * as alphaTab from '@coderline/alphatab';
import { useStore } from '../state/store';
import { sliceMono } from '../audio/buffer';
import { createClipPlayer, type ClipPlayer } from '../audio/player';
import type { CursorMode } from '../render/AlphaTabView';

interface Props {
  api: alphaTab.AlphaTabApi | null;
  mode: CursorMode;
  onModeChange: (m: CursorMode) => void;
  onClipTime: (sec: number) => void;
  onBeat: (beat: number | null) => void;
}

const SPEEDS = [0.5, 0.75, 1];

export function PlaybackBar({ api, mode, onModeChange, onClipTime, onBeat }: Props) {
  const audio = useStore((s) => s.audio);
  const trim = useStore((s) => s.trim);
  const a = useStore((s) => s.arrangement);

  const playerRef = useRef<ClipPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [duration, setDuration] = useState(0);

  // Rebuild the clip player whenever the selection changes.
  useEffect(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setPlaying(false);
    setPosition(0);
    if (!audio) return;
    const clip = sliceMono(audio.mono, audio.sampleRate, trim.start, trim.end);
    if (clip.length === 0) return;
    const player = createClipPlayer(
      clip,
      audio.sampleRate,
      (t) => {
        setPosition(t);
        onClipTime(t);
        if (a) onBeat(((t - a.beatOffset) * a.tempo) / 60);
      },
      () => {
        setPlaying(false);
        onBeat(null);
      },
    );
    player.setRate(speed);
    playerRef.current = player;
    setDuration(player.duration);
    return () => {
      player.dispose();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, trim.start, trim.end]);

  // Follow alphaTab's own player when it is the one making the sound.
  useEffect(() => {
    if (!api || mode !== 'synth' || !a) return;
    const handler = (args: { currentTime: number; endTime: number }) => {
      setPosition(args.currentTime / 1000);
      setDuration(args.endTime / 1000);
      onBeat((args.currentTime / 1000 / 60) * a.tempo);
    };
    api.playerPositionChanged.on(handler);
    return () => api.playerPositionChanged.off(handler);
  }, [api, mode, a, onBeat]);

  function toggle() {
    if (mode === 'clip') {
      const player = playerRef.current;
      if (!player) return;
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        void player.play();
        setPlaying(true);
      }
    } else {
      api?.playPause();
      setPlaying((v) => !v);
    }
  }

  function stop() {
    if (mode === 'clip') {
      playerRef.current?.pause();
      playerRef.current?.seek(0);
    } else {
      api?.stop();
    }
    setPlaying(false);
    setPosition(0);
    onBeat(null);
  }

  function seek(sec: number) {
    if (mode === 'clip') playerRef.current?.seek(sec);
    else if (api) api.timePosition = sec * 1000;
    setPosition(sec);
  }

  function changeSpeed(rate: number) {
    setSpeed(rate);
    if (mode === 'clip') playerRef.current?.setRate(rate);
    else if (api) api.playbackSpeed = rate;
  }

  const total = duration || (a?.clipDuration ?? 0);

  return (
    <div className="card sticky top-2 z-10 flex flex-wrap items-center gap-3 backdrop-blur">
      <div className="flex rounded-md border border-ink-600 p-0.5 text-xs">
        {(['clip', 'synth'] as CursorMode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              stop();
              onModeChange(m);
            }}
            className={`rounded px-2 py-1 ${mode === m ? 'bg-amber-450 text-ink-900' : 'text-slate-400'}`}
          >
            {m === 'clip' ? 'Original clip' : 'Synth'}
          </button>
        ))}
      </div>

      <button className="btn btn-primary px-3" onClick={toggle} disabled={mode === 'synth' && !api}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="btn px-3" onClick={stop}>
        ■
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
      <span className="w-20 font-mono text-xs tabular-nums text-slate-400">
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
