/**
 * Riff / melody editing: retune, retime, delete, add.
 *
 * A table rather than a piano roll on purpose - during a lesson you want to fix
 * one wrong note fast, not sculpt a MIDI clip.
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import { preferFlats, timeToBeat, tuningOf } from '../music/arrangement';
import { useActiveSpanId } from '../state/playhead';
import { midiToName } from '../music/theory';
import { isPlayable } from '../music/fretboard';
import type { RiffNote } from '../types';

export function RiffEditor() {
  const a = useStore((s) => s.arrangement);
  const edit = useStore((s) => s.edit);
  const [showAll, setShowAll] = useState(false);
  // Collapsed by default: a busy clip can produce hundreds of rows, which
  // buried the score under a table nobody had asked to see.
  const [open, setOpen] = useState(false);
  // Re-renders when the sounding note changes, not on every animation frame.
  const activeId = useActiveSpanId(a?.riff ?? [], (sec) => (a ? timeToBeat(a, sec) : 0));
  if (!a) return null;

  const flats = preferFlats(a);
  const tuning = tuningOf(a);
  const visible = showAll ? a.riff : a.riff.slice(0, 24);

  function patch(id: string, p: Partial<RiffNote>) {
    edit((d) => {
      const n = d.riff.find((x) => x.id === id);
      if (n) Object.assign(n, p);
      d.riff.sort((x, y) => x.startBeat - y.startBeat);
    });
  }

  function remove(id: string) {
    edit((d) => void (d.riff = d.riff.filter((n) => n.id !== id)));
  }

  function add() {
    edit((d) => {
      const last = d.riff[d.riff.length - 1];
      const startBeat = last ? last.startBeat + last.durationBeats : 0;
      d.riff.push({
        id: `manual-${Date.now().toString(36)}`,
        startBeat,
        durationBeats: 0.5,
        midi: last?.midi ?? 64,
        confidence: 1,
      });
    });
  }

  return (
    <div className={`card ${open ? 'space-y-3' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="w-3 shrink-0 text-xs text-slate-500">{open ? '▾' : '▸'}</span>
          <h3 className="truncate font-semibold text-slate-200">
            Riff / melody <span className="text-xs font-normal text-slate-500">({a.riff.length} notes)</span>
          </h3>
        </button>
        {open && (
          <div className="flex shrink-0 gap-2">
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={add}>
              + note
            </button>
            {a.riff.length > 0 && (
              <button
                className="btn btn-ghost px-2 py-1 text-xs text-red-300"
                onClick={() => edit((d) => void (d.riff = []))}
              >
                Clear riff
              </button>
            )}
          </div>
        )}
      </div>


      {!open ? null : a.riff.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing melodic came through. Narrow the melody pitch range to the guitar register, lower the note-engine
          confidence, and re-analyse - or add notes by hand.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1">Bar.beat</th>
                  <th>Pitch</th>
                  <th>Length</th>
                  <th>String / fret</th>
                  <th>Conf.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((n) => {
                  const active = n.id === activeId;
                  const playable = isPlayable(n.midi, { tuning, capo: a.capo });
                  return (
                    <tr
                      key={n.id}
                      className={`border-t border-ink-700 ${active ? 'bg-amber-450/10' : ''}`}
                    >
                      <td className="py-1 font-mono text-slate-400">
                        {Math.floor(n.startBeat / a.beatsPerBar) + 1}.{((n.startBeat % a.beatsPerBar) + 1).toFixed(2)}
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button
                            className="btn btn-ghost px-1 py-0 text-xs"
                            onClick={() => patch(n.id, { midi: n.midi - 1 })}
                          >
                            ♭
                          </button>
                          <span className="w-12 text-center font-mono text-slate-200">
                            {midiToName(n.midi + a.transpose, flats)}
                          </span>
                          <button
                            className="btn btn-ghost px-1 py-0 text-xs"
                            onClick={() => patch(n.id, { midi: n.midi + 1 })}
                          >
                            ♯
                          </button>
                          <button
                            className="btn btn-ghost px-1 py-0 text-[10px] text-slate-500"
                            title="Down an octave"
                            onClick={() => patch(n.id, { midi: n.midi - 12 })}
                          >
                            8vb
                          </button>
                          <button
                            className="btn btn-ghost px-1 py-0 text-[10px] text-slate-500"
                            title="Up an octave"
                            onClick={() => patch(n.id, { midi: n.midi + 12 })}
                          >
                            8va
                          </button>
                        </div>
                      </td>
                      <td>
                        <select
                          className="input w-20 py-0.5"
                          value={n.durationBeats}
                          onChange={(e) => patch(n.id, { durationBeats: Number(e.target.value) })}
                        >
                          {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="font-mono text-slate-300">
                        {playable && n.string !== undefined && n.fret !== undefined ? (
                          `${n.string + 1} / ${n.fret}`
                        ) : (
                          <span className="text-amber-450">out of range</span>
                        )}
                      </td>
                      <td className="text-slate-500">{(n.confidence * 100).toFixed(0)}%</td>
                      <td className="text-right">
                        <button className="btn btn-ghost px-2 py-0 text-xs text-red-300" onClick={() => remove(n.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {a.riff.length > 24 && (
            <button className="btn btn-ghost text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${a.riff.length} notes`}
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              onChange={(e) => {
                const threshold = e.target.checked ? 0.5 : 0;
                edit((d) => void (d.riff = d.riff.filter((n) => n.confidence >= threshold)));
              }}
            />
            Drop notes below 50% confidence (cannot be undone except with Undo)
          </label>
        </>
      )}
    </div>
  );
}
