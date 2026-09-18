/**
 * The playhead lives outside React.
 *
 * Driving the highlight through component state meant a setState on every
 * animation frame, which re-rendered the whole chord chart and the riff table
 * sixty times a second. That render work *was* the lag: the highlight arrived
 * visibly after the chord you could hear.
 *
 * Components now subscribe here and snapshot a primitive - the id of the chord
 * or note under the playhead - so React bails out until that id actually
 * changes. Re-renders drop from once a frame to roughly once a bar.
 */

import { useSyncExternalStore } from 'react';

let seconds: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called from the audio clock, not from React. */
export function setPlayheadSeconds(next: number | null): void {
  if (seconds === next) return;
  seconds = next;
  emit();
}

export function getPlayheadSeconds(): number | null {
  return seconds;
}

export interface Span {
  id: string;
  startBeat: number;
  durationBeats: number;
}

/**
 * Id of the span under the playhead. Returns a string, so React's Object.is
 * comparison skips the re-render while the same chord is still sounding.
 */
export function useActiveSpanId(spans: Span[], beatAt: (sec: number) => number): string | null {
  const getSnapshot = (): string | null => {
    if (seconds === null) return null;
    const beat = beatAt(seconds);
    for (const span of spans) {
      if (beat >= span.startBeat && beat < span.startBeat + span.durationBeats) return span.id;
    }
    return null;
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * Playhead position for transport readouts, quantised so the numbers tick at a
 * readable rate rather than at frame rate.
 */
export function usePlayheadSeconds(precision = 0.05): number | null {
  const getSnapshot = (): number | null =>
    seconds === null ? null : Math.round(seconds / precision) * precision;
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
