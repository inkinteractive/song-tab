/**
 * Step 2: trim to the section worth analysing.
 *
 * Canvas waveform with draggable selection handles, plus preview playback of
 * just the selection so you can confirm you grabbed the right eight bars.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computePeaks, sliceMono } from '../audio/buffer';
import { createClipPlayer, type ClipPlayer } from '../audio/player';
import { useStore } from '../state/store';

const HEIGHT = 128;

export function WaveformTrimmer() {
  const audio = useStore((s) => s.audio);
  const trim = useStore((s) => s.trim);
  const setTrim = useStore((s) => s.setTrim);
  const clearAudio = useStore((s) => s.clearAudio);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<ClipPlayer | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<'start' | 'end' | 'move' | null>(null);
  const [width, setWidth] = useState(900);

  const peaks = useMemo(
    () => (audio ? computePeaks(audio.mono, Math.max(200, Math.floor(width))) : null),
    [audio, width],
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => playerRef.current?.dispose(), []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks || !audio) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);

    ctx.fillStyle = '#151b23';
    ctx.fillRect(0, 0, width, HEIGHT);

    const x0 = (trim.start / audio.duration) * width;
    const x1 = (trim.end / audio.duration) * width;
    ctx.fillStyle = 'rgba(240, 162, 58, 0.12)';
    ctx.fillRect(x0, 0, x1 - x0, HEIGHT);

    const mid = HEIGHT / 2;
    for (let i = 0; i < peaks.min.length; i++) {
      const inSelection = i >= x0 && i <= x1;
      ctx.fillStyle = inSelection ? '#f0a23a' : '#3d4a5c';
      const top = mid - peaks.max[i] * mid * 0.95;
      const bottom = mid - peaks.min[i] * mid * 0.95;
      ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
    }

    ctx.strokeStyle = '#f0a23a';
    ctx.lineWidth = 2;
    [x0, x1].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
      ctx.stroke();
    });

    if (playhead !== null) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      const px = ((trim.start + playhead) / audio.duration) * width;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, HEIGHT);
      ctx.stroke();
    }
  }, [peaks, trim, audio, width, playhead]);

  const timeAt = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !audio) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * audio.duration;
    },
    [audio],
  );

  useEffect(() => {
    if (!drag || !audio) return;
    const onMove = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (drag === 'start') setTrim(Math.min(t, trim.end - 0.5), trim.end);
      else if (drag === 'end') setTrim(trim.start, Math.max(t, trim.start + 0.5));
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, trim, audio, setTrim, timeAt]);

  if (!audio) return null;

  const selectionLength = trim.end - trim.start;

  function stopPreview() {
    playerRef.current?.dispose();
    playerRef.current = null;
    setPlaying(false);
    setPlayhead(null);
  }

  function togglePreview() {
    if (playing) {
      stopPreview();
      return;
    }
    const clip = sliceMono(audio!.mono, audio!.sampleRate, trim.start, trim.end);
    const player = createClipPlayer(clip, audio!.sampleRate, setPlayhead, stopPreview);
    playerRef.current = player;
    setPlaying(true);
    void player.play(0);
  }

  function nudge(which: 'start' | 'end', delta: number) {
    if (which === 'start') setTrim(trim.start + delta, trim.end);
    else setTrim(trim.start, trim.end + delta);
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Trim to the section</h2>
          <p className="text-sm text-slate-400">
            {audio.label} · {formatTime(audio.duration)} total. Short, isolated sections analyse far better than a
            whole track.
          </p>
        </div>
        <button className="btn btn-ghost text-xs" onClick={clearAudio}>
          Use different audio
        </button>
      </div>

      <div ref={wrapRef} className="relative select-none">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: HEIGHT }}
          className="cursor-crosshair rounded-md"
          onPointerDown={(e) => {
            const t = timeAt(e.clientX);
            const distStart = Math.abs(t - trim.start);
            const distEnd = Math.abs(t - trim.end);
            setDrag(distStart <= distEnd ? 'start' : 'end');
            if (distStart <= distEnd) setTrim(Math.min(t, trim.end - 0.5), trim.end);
            else setTrim(trim.start, Math.max(t, trim.start + 0.5));
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <button className="btn btn-primary" onClick={togglePreview}>
          {playing ? '■ Stop' : '▶ Preview selection'}
        </button>

        <TimeField label="Start" value={trim.start} onNudge={(d) => nudge('start', d)} />
        <TimeField label="End" value={trim.end} onNudge={(d) => nudge('end', d)} />

        <span className={`chip ${selectionLength > 45 ? 'border-amber-450 text-amber-450' : ''}`}>
          {selectionLength.toFixed(1)}s selected
        </span>
        {selectionLength > 45 && (
          <span className="text-xs text-amber-450">
            Long sections blur the chord detection. Aim for one section, 10-40 seconds.
          </span>
        )}
      </div>
    </div>
  );
}

function TimeField({ label, value, onNudge }: { label: string; value: number; onNudge: (delta: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <button className="btn btn-ghost px-1.5 py-0.5 text-xs" onClick={() => onNudge(-1)} title="Back 1s">
        −
      </button>
      <span className="w-14 text-center font-mono tabular-nums text-slate-200">{formatTime(value)}</span>
      <button className="btn btn-ghost px-1.5 py-0.5 text-xs" onClick={() => onNudge(1)} title="Forward 1s">
        +
      </button>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
