/** The diagram strip: every shape the arrangement needs, once. */

import { useStore } from '../state/store';
import { uniqueShapes } from '../music/arrangement';
import { ChordDiagram } from '../render/ChordDiagram';

export function ShapeStrip() {
  const a = useStore((s) => s.arrangement);
  if (!a || a.chords.length === 0) return null;
  const shapes = uniqueShapes(a);

  return (
    <div className="card">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-semibold text-slate-200">Shapes</h3>
        {a.capo > 0 && <span className="text-xs text-slate-500">fingered with the capo at fret {a.capo}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {shapes.map(({ shape, name }) => (
          <div key={shape.id} className="rounded-lg border border-ink-600 bg-ink-900 px-1 pb-1">
            <ChordDiagram shape={shape} name={name} width={96} />
          </div>
        ))}
      </div>
    </div>
  );
}
