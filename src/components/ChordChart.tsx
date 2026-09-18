/**
 * The chart a teacher hands over, and the main editing surface: a bar grid of chord
 * names. Click a bar to change the chord, its voicing, or to split/clear it.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { displayName, resolveShape, shapeOptions, soundingName, timeToBeat, toBars } from '../music/arrangement';
import { getPlayheadSeconds, isPlayheadPlaying, useActiveSpanId } from '../state/playhead';
import { ChordDiagram } from '../render/ChordDiagram';
import { QUALITY_SUFFIX, SHARP_NAMES, chordName, parsePitchClass, type ChordQuality } from '../music/theory';
import type { BarChord } from '../types';

const QUALITIES = Object.keys(QUALITY_SUFFIX) as ChordQuality[];

export function ChordChart() {
  const a = useStore((s) => s.arrangement);
  const edit = useStore((s) => s.edit);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Subscribing to the id (not the time) means this only re-renders when the
  // sounding chord actually changes.
  const activeId = useActiveSpanId(a?.chords ?? [], (sec) => (a ? timeToBeat(a, sec) : 0));

  // Keep the playhead in view as the chart plays.
  //
  // This used to jump once per chord with `behavior: 'smooth'`, which fell
  // behind: a smooth scroll takes a few hundred milliseconds, a bar at any
  // brisk tempo takes barely longer, and a chord held over several bars did not
  // scroll at all - so the highlight walked off the right-hand edge. The strip
  // is now scrolled continuously from the playhead, a frame at a time, which
  // cannot lag because it is not animating towards anything.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !a) return;
    let raf = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      if (!isPlayheadPlaying()) return;
      const seconds = getPlayheadSeconds();
      if (seconds === null) return;

      const barPosition = timeToBeat(a, seconds) / a.beatsPerBar;
      const bars = strip.children;
      if (bars.length === 0) return;
      const index = Math.max(0, Math.min(bars.length - 1, Math.floor(barPosition)));
      const bar = bars[index] as HTMLElement;
      const fraction = Math.max(0, Math.min(1, barPosition - index));

      // Centre the playhead itself, not the bar, so the motion is even rather
      // than stepping once per bar.
      const x = bar.offsetLeft + bar.clientWidth * fraction;
      const target = x - strip.clientWidth / 2;
      strip.scrollLeft = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, target));
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [a]);

  if (!a) return null;
  const bars = toBars(a);
  const selected = a.chords.find((c) => c.id === selectedId) ?? null;

  function setChordField(id: string, patch: Partial<BarChord['chord']>) {
    edit((d) => {
      const target = d.chords.find((c) => c.id === id);
      if (target) target.chord = { ...target.chord, ...patch };
    });
  }

  function removeChord(id: string) {
    edit((d) => void (d.chords = d.chords.filter((c) => c.id !== id)));
    setSelectedId(null);
  }

  function splitChord(id: string) {
    edit((d) => {
      const i = d.chords.findIndex((c) => c.id === id);
      if (i < 0) return;
      const c = d.chords[i];
      if (c.durationBeats < 2) return;
      const half = c.durationBeats / 2;
      const second: BarChord = {
        ...c,
        id: `${c.id}-b${Date.now().toString(36)}`,
        startBeat: c.startBeat + half,
        durationBeats: half,
        shapeId: undefined,
      };
      c.durationBeats = half;
      d.chords.splice(i + 1, 0, second);
    });
  }

  function addChordToBar(startBeat: number) {
    edit((d) => {
      const fallback = d.chords[0]?.chord ?? { root: d.key.tonic, quality: 'maj' as ChordQuality };
      d.chords.push({
        id: `new-${startBeat}-${Date.now().toString(36)}`,
        startBeat,
        durationBeats: d.beatsPerBar,
        chord: { ...fallback },
        confidence: 1,
      });
      d.chords.sort((x, y) => x.startBeat - y.startBeat);
    });
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-200">Chord chart</h3>
          <span className="text-xs text-slate-500">
            {a.capo > 0 ? `Shapes as played with the capo at fret ${a.capo}` : 'Click a bar to edit'}
          </span>
        </div>

        {/* One row across the page, scrolling with playback. Bars stay a fixed
            width so the strip reads like a timeline rather than reflowing. */}
        <div
          ref={stripRef}
          className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:thin]"
          role="list"
          aria-label="Chord progression"
        >
          {bars.map((bar) => (
            <div
              key={bar.index}
              role="listitem"
              className="relative min-h-[132px] w-[140px] shrink-0 rounded-md border border-ink-600 bg-ink-900 p-2"
            >
              <span className="absolute left-1.5 top-1 text-[10px] text-slate-600">{bar.index + 1}</span>
              {bar.chords.length === 0 ? (
                <button
                  className="mt-10 w-full text-center text-sm text-slate-600 hover:text-amber-450"
                  onClick={() => addChordToBar(bar.startBeat)}
                >
                  + add chord
                </button>
              ) : (
                <div className="mt-4 flex flex-wrap items-start justify-center gap-1.5">
                  {bar.chords.map((c) => (
                    <button
                      key={c.id}
                      data-chord-id={c.id}
                      onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                      className={[
                        'rounded px-1 pb-1 pt-0.5 transition-colors duration-75',
                        c.id === activeId ? 'bg-amber-450 text-ink-900' : 'text-slate-100 hover:bg-ink-700',
                        c.id === selectedId ? 'ring-2 ring-amber-450' : '',
                        c.confidence < 0.25 ? 'opacity-60' : '',
                      ].join(' ')}
                      title={
                        c.detected
                          ? `detected ${chordName(c.detected)} · confidence ${(c.confidence * 100).toFixed(0)}%`
                          : undefined
                      }
                    >
                      <span className="block text-center text-lg font-semibold leading-tight">
                        {displayName(c, a)}
                      </span>
                      {/* The shape belongs next to the name it plays, not in a
                          separate legend you have to cross-reference. */}
                      <ChordDiagram
                        shape={resolveShape(c, a)}
                        width={bar.chords.length > 1 ? 52 : 64}
                        fretRows={4}
                        compact
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {selected && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-200">
              Bar {Math.floor(selected.startBeat / a.beatsPerBar) + 1} - {displayName(selected, a)}
              {a.capo > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">sounds {soundingName(selected, a)}</span>
              )}
            </h3>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setSelectedId(null)}>
              Close
            </button>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <span className="label">Root</span>
              <select
                className="input w-20"
                value={SHARP_NAMES[selected.chord.root]}
                onChange={(e) => {
                  const pc = parsePitchClass(e.target.value);
                  if (pc !== null) setChordField(selected.id, { root: pc });
                }}
              >
                {SHARP_NAMES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Quality</span>
              <select
                className="input w-32"
                value={selected.chord.quality}
                onChange={(e) => setChordField(selected.id, { quality: e.target.value as ChordQuality })}
              >
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_SUFFIX[q] || 'major'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="label">Length (beats)</span>
              <input
                className="input w-20"
                type="number"
                min={0.5}
                step={0.5}
                max={a.beatsPerBar * 4}
                value={selected.durationBeats}
                onChange={(e) =>
                  edit((d) => {
                    const t = d.chords.find((c) => c.id === selected.id);
                    if (t) t.durationBeats = Math.max(0.5, Number(e.target.value) || t.durationBeats);
                  })
                }
              />
            </div>

            {selected.detected && selected.detected.quality !== selected.chord.quality && (
              <button
                className="btn text-xs"
                onClick={() => setChordField(selected.id, { ...selected.detected })}
                title="Restore the extended chord the engine actually detected"
              >
                Use detected {chordName(selected.detected)}
              </button>
            )}
            <button className="btn text-xs" onClick={() => splitChord(selected.id)} disabled={selected.durationBeats < 2}>
              Split in half
            </button>
            <button className="btn text-xs text-red-300" onClick={() => removeChord(selected.id)}>
              Delete
            </button>
          </div>

          <div>
            <span className="label">Voicing</span>
            <div className="flex flex-wrap gap-3">
              {shapeOptions(selected, a)
                .slice(0, 8)
                .map((shape) => {
                  const active = resolveShape(selected, a).id === shape.id;
                  return (
                    <button
                      key={shape.id}
                      onClick={() =>
                        edit((d) => {
                          const t = d.chords.find((c) => c.id === selected.id);
                          if (t) t.shapeId = shape.id;
                        })
                      }
                      className={`rounded-lg border p-1 transition ${
                        active ? 'border-amber-450 bg-amber-450/10' : 'border-ink-600 hover:border-ink-500'
                      }`}
                      title={`${shape.kind}, difficulty ${shape.difficulty}`}
                    >
                      <ChordDiagram shape={shape} name={shape.label} width={80} compact />
                      <span className="block pb-1 text-center text-[10px] text-slate-500">{shape.kind}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
