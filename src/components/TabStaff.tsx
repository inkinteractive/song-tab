/**
 * The tab, drawn as the monospace grid a guitarist expects: six dashed lines,
 * fret numbers on them, chord names above, bar lines between.
 *
 * This is the same grid the PDF prints - both come out of `buildTabGrid` - so
 * what is on screen and what is handed to the student are the same document.
 *
 * The playhead is positioned in `ch` units, which is exactly one character in a
 * monospace font, and moved by writing to the DOM on an animation frame. Taking
 * it through React state would re-render every character of every system sixty
 * times a second, which is the lag it is supposed to be tracking.
 */

import { useEffect, useMemo, useRef } from 'react';
import { timeToBeat } from '../music/arrangement';
import { getPlayheadSeconds, isPlayheadPlaying } from '../state/playhead';
import { buildTabGrid, columnForBeat, type CharKind, type TabLine } from '../render/tabGrid';
import type { Arrangement } from '../types';

const KIND_CLASS: Record<CharKind, string> = {
  label: 'text-slate-400',
  separator: 'text-cyan-700',
  dash: 'text-slate-300',
  fret: 'font-semibold text-slate-900',
  chord: 'font-semibold text-amber-700',
  blank: '',
};

/** One line, as runs of same-coloured characters - not one span per character. */
function Line({ line }: { line: TabLine }) {
  const runs: { text: string; kind: CharKind }[] = [];
  for (let i = 0; i < line.text.length; i++) {
    const kind = line.kinds[i];
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.text += line.text[i];
    else runs.push({ text: line.text[i], kind });
  }
  return (
    <div className="whitespace-pre">
      {runs.map((r, i) => (
        <span key={i} className={KIND_CLASS[r.kind]}>
          {r.text}
        </span>
      ))}
    </div>
  );
}

export function TabStaff({ arrangement: a }: { arrangement: Arrangement }) {
  const grid = useMemo(() => buildTabGrid(a), [a]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const systemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cursorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    let shownSystem = -1;
    let scrolledTo = -1;

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const seconds = getPlayheadSeconds();
      const beat = seconds === null ? null : timeToBeat(a, seconds);

      let active = -1;
      if (beat !== null && beat >= 0) {
        for (let i = 0; i < grid.systems.length; i++) {
          const column = columnForBeat(grid, grid.systems[i], beat, a.beatsPerBar);
          if (column === null) continue;
          active = i;
          const cursor = cursorRefs.current[i];
          const bar = barRefs.current[i];
          if (cursor) cursor.style.left = `${column}ch`;
          if (bar) {
            // Shade the whole bar the cursor is inside, as the engraved view did.
            const barIndex = Math.floor(column / (grid.columnsPerBar + 1));
            bar.style.left = `${grid.prefixColumns + barIndex * (grid.columnsPerBar + 1)}ch`;
            bar.style.width = `${grid.columnsPerBar}ch`;
          }
          break;
        }
      }

      if (active !== shownSystem) {
        for (let i = 0; i < grid.systems.length; i++) {
          const visible = i === active ? '1' : '0';
          if (cursorRefs.current[i]) cursorRefs.current[i]!.style.opacity = visible;
          if (barRefs.current[i]) barRefs.current[i]!.style.opacity = visible;
        }
        shownSystem = active;
      }

      // Follow the music down the page, but never fight a teacher scrolling it
      // by hand while it is stopped.
      if (active >= 0 && active !== scrolledTo && isPlayheadPlaying()) {
        scrolledTo = active;
        systemRefs.current[active]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (active < 0) {
        scrolledTo = -1;
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [a, grid]);

  return (
    <div
      ref={scrollRef}
      className="max-h-[70vh] overflow-auto rounded-lg bg-white px-4 py-3 text-[13px] leading-[1.5]"
    >
      <div className="inline-block font-mono tabular-nums">
        {grid.systems.map((system, i) => (
          <div
            key={i}
            ref={(el) => {
              systemRefs.current[i] = el;
            }}
            className="relative mb-4 last:mb-0"
          >
            <div
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className="pointer-events-none absolute bottom-0 top-0 bg-amber-400/15 opacity-0"
              style={{ width: `${grid.columnsPerBar}ch` }}
            />
            <div
              ref={(el) => {
                cursorRefs.current[i] = el;
              }}
              className="pointer-events-none absolute bottom-0 top-0 z-10 w-[2px] bg-amber-500 opacity-0"
            />
            <div className="relative">
              <Line line={system.chordLine} />
              {system.stringLines.map((line, j) => (
                <Line key={j} line={line} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {a.riff.length === 0 && (
        <p className="mt-3 whitespace-normal font-sans text-xs text-slate-500">
          No riff was extracted, so the staff is empty - the chord names above it are the arrangement. Trimming to a
          section where the lead line is clearer and analysing again is usually the fix.
        </p>
      )}
    </div>
  );
}
