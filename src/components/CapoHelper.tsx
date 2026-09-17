/**
 * The capo / easier-key helper: one-click reframing of a barre-heavy
 * progression into open shapes.
 */

import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { suggestCapos } from '../music/capo';
import { chordWeights } from '../analysis/simplify';

export function CapoHelper() {
  const a = useStore((s) => s.arrangement);
  const suggestion = useStore((s) => s.capoSuggestion);
  const applyCapo = useStore((s) => s.applyCapo);
  const [showAll, setShowAll] = useState(false);

  const options = useMemo(() => {
    if (!a || a.chords.length === 0) return [];
    return suggestCapos({
      chords: chordWeights(a.chords, a.beatsPerBar),
      key: a.key,
      allowTranspose: true,
    }).slice(0, 8);
  }, [a]);

  if (!a || a.chords.length === 0) return null;

  const active = (capo: number, transpose: number) => a.capo === capo && a.transpose === transpose;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-200">Capo helper</h3>
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Hide options' : 'All options'}
        </button>
      </div>

      {suggestion ? (
        <div className="rounded-lg border border-amber-450/50 bg-amber-450/10 p-3">
          <p className="text-sm text-slate-100">{suggestion.summary}</p>
          <p className="mt-1 text-xs text-slate-400">
            {suggestion.openShapeCount} open shapes, {suggestion.barreCount} barres.
          </p>
          <button
            className="btn btn-primary mt-2 text-xs"
            disabled={active(suggestion.capo, suggestion.transpose)}
            onClick={() => applyCapo(suggestion.capo, suggestion.transpose)}
          >
            {active(suggestion.capo, suggestion.transpose) ? 'Applied' : 'Use this'}
          </button>
          {(a.capo !== 0 || a.transpose !== 0) && (
            <button className="btn btn-ghost mt-2 ml-2 text-xs" onClick={() => applyCapo(0, 0)}>
              Back to no capo
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          These chords are already about as easy as they get - no capo position makes a meaningful difference.
        </p>
      )}

      {showAll && (
        <table className="w-full text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1">Capo</th>
              <th>Transpose</th>
              <th>Shapes</th>
              <th className="text-right">Ease</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={`${o.capo}:${o.transpose}`} className="border-t border-ink-700">
                <td className="py-1.5 text-slate-300">{o.capo === 0 ? '—' : o.capo}</td>
                <td className="text-slate-400">{o.transpose === 0 ? 'in key' : `${o.transpose > 0 ? '+' : ''}${o.transpose}`}</td>
                <td className="font-mono text-slate-200">{[...new Set(o.shapeNames)].slice(0, 6).join(' ')}</td>
                <td className="text-right text-slate-400">{(10 - o.score).toFixed(1)}</td>
                <td className="text-right">
                  <button
                    className="btn btn-ghost px-2 py-0.5 text-xs"
                    disabled={active(o.capo, o.transpose)}
                    onClick={() => applyCapo(o.capo, o.transpose)}
                  >
                    {active(o.capo, o.transpose) ? '✓' : 'Use'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
