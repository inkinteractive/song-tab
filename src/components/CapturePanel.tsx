/**
 * Step 1: get audio in.
 *
 * Microphone is the primary path (the student plays, or a phone speaker points
 * at the mic). Tab audio covers the web players. File import exists so a
 * teacher can work from something already on disk.
 */

import { useEffect, useRef, useState } from 'react';
import { CaptureError, captureBlockedByEmbedder, decodeToBuffer, startCapture, startRecording, type CaptureSession, type Recorder } from '../audio/capture';
import { toMono } from '../audio/buffer';
import { useStore } from '../state/store';

type Phase = 'idle' | 'armed' | 'recording' | 'decoding';

export function CapturePanel() {
  const setAudio = useStore((s) => s.setAudio);
  const setTitle = useStore((s) => s.setTitle);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ message: string; hint: string } | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Capture is gated by the embedding page's permissions policy, so say so
  // before the teacher clicks a button that cannot work here.
  const embedded = captureBlockedByEmbedder('mic') || captureBlockedByEmbedder('tab');

  const sessionRef = useRef<CaptureSession | null>(null);
  const recorderRef = useRef<Recorder | null>(null);
  const rafRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      sessionRef.current?.stop();
    },
    [],
  );

  const meter = () => {
    const session = sessionRef.current;
    if (!session) return;
    const buf = new Float32Array(session.analyser.fftSize);
    session.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    setElapsed((performance.now() - startedAtRef.current) / 1000);
    rafRef.current = requestAnimationFrame(meter);
  };

  async function arm(source: 'mic' | 'tab') {
    setError(null);
    try {
      const session = await startCapture(source);
      sessionRef.current = session;
      setPhase('armed');
      startedAtRef.current = performance.now();
      rafRef.current = requestAnimationFrame(meter);
      // A shared tab can be stopped from the browser's own bar.
      session.stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current) void finish();
        else reset();
      });
    } catch (err) {
      if (err instanceof CaptureError) setError({ message: err.message, hint: err.hint });
      else setError({ message: 'Could not start capture', hint: err instanceof Error ? err.message : String(err) });
      setPhase('idle');
    }
  }

  function record() {
    const session = sessionRef.current;
    if (!session) return;
    try {
      recorderRef.current = startRecording(session.stream);
      startedAtRef.current = performance.now();
      setPhase('recording');
    } catch (err) {
      setError({ message: 'Recording failed to start', hint: err instanceof Error ? err.message : String(err) });
    }
  }

  async function finish() {
    const recorder = recorderRef.current;
    const session = sessionRef.current;
    if (!recorder || !session) return;
    setPhase('decoding');
    cancelAnimationFrame(rafRef.current);
    try {
      const blob = await recorder.stop();
      const buffer = await decodeToBuffer(blob);
      const mono = toMono(buffer);
      setAudio({
        mono,
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        origin: session.source,
        label: session.source === 'mic' ? 'Microphone recording' : 'Tab / system audio',
      });
    } catch (err) {
      setError({
        message: 'Could not decode the recording',
        hint: err instanceof Error ? err.message : String(err),
      });
    } finally {
      reset();
    }
  }

  function reset() {
    cancelAnimationFrame(rafRef.current);
    sessionRef.current?.stop();
    sessionRef.current = null;
    recorderRef.current = null;
    setPhase('idle');
    setLevel(0);
    setElapsed(0);
  }

  async function importFile(file: File) {
    setError(null);
    setPhase('decoding');
    try {
      const buffer = await decodeToBuffer(file);
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      setAudio({
        mono: toMono(buffer),
        sampleRate: buffer.sampleRate,
        duration: buffer.duration,
        origin: 'file',
        label: file.name,
      });
    } catch (err) {
      setError({
        message: 'Could not read that file',
        hint: err instanceof Error ? err.message : 'The browser could not decode it. Try WAV, MP3, M4A or FLAC.',
      });
    } finally {
      setPhase('idle');
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-100">Get the song in</h2>
        <p className="mt-1 text-sm text-slate-400">
          Play the section out loud and capture it, or share the browser tab it is streaming from. Thirty seconds of
          the verse or chorus reads far better than a whole track.
        </p>

        {embedded && (
          <div className="mt-4 rounded-md border border-amber-450/50 bg-amber-450/10 px-3 py-2 text-sm text-amber-100">
            <strong>Running in an embedded preview.</strong> Microphone and tab capture are blocked by the page that
            frames this one, and there is no permission you can grant from here. <strong>Import a file</strong> works
            normally; for live capture, open the app in its own browser tab or run it locally.
          </div>
        )}

        {phase === 'idle' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              className={`btn h-20 flex-col ${embedded ? 'opacity-60' : 'btn-primary'}`}
              onClick={() => arm('mic')}
            >
              <span className="text-base">Microphone</span>
            </button>
            <button className={`btn h-20 flex-col ${embedded ? 'opacity-60' : ''}`} onClick={() => arm('tab')}>
              <span className="text-base">Browser tab audio</span>
            </button>
            <label className={`btn h-20 cursor-pointer flex-col ${embedded ? 'btn-primary' : ''}`}>
              <span className="text-base">Import a file</span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        )}

        {(phase === 'armed' || phase === 'recording') && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-900">
                <div
                  className={`h-full transition-[width] duration-75 ${level > 0.9 ? 'bg-red-500' : 'bg-amber-450'}`}
                  style={{ width: `${Math.round(level * 100)}%` }}
                />
              </div>
              <span className="w-16 text-right font-mono text-sm tabular-nums text-slate-300">
                {formatTime(phase === 'recording' ? elapsed : 0)}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {phase === 'armed'
                ? 'Input is live. Check the meter is moving, then start recording.'
                : 'Recording. Stop when you have the section you want to teach.'}
            </p>
            <div className="flex gap-2">
              {phase === 'armed' ? (
                <button className="btn btn-primary" onClick={record}>
                  ● Start recording
                </button>
              ) : (
                <button className="btn btn-primary" onClick={() => void finish()}>
                  ■ Stop and use this
                </button>
              )}
              <button className="btn btn-ghost" onClick={reset}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'decoding' && <p className="mt-4 text-sm text-slate-400">Decoding audio…</p>}

        {error && (
          <div className="mt-4 rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm">
            <strong className="text-red-200">{error.message}.</strong>{' '}
            <span className="text-red-300/80">{error.hint}</span>
          </div>
        )}
      </div>

    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
