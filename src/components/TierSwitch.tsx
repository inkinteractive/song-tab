/**
 * Output complexity, switchable from the results.
 *
 * The lead line only exists on Standard and Full - Essential is chords by
 * design - and the tier used to be settable only before analysing, on a screen
 * you had already left. That made "where is the lead guitar?" a dead end.
 * Switching here re-runs the analysis on the same trimmed clip.
 */

import { useStore } from '../state/store';
import { TIER_LABELS, type Tier } from '../types';

const TIERS: Tier[] = ['essential', 'standard', 'full'];

const WHAT_YOU_GET: Record<Tier, string> = {
  essential: 'Chords only',
  standard: 'Chords + the lead line',
  full: 'Chords + a full transcription',
};

export function TierSwitch() {
  const tier = useStore((s) => s.settings.tier);
  const setTier = useStore((s) => s.setTier);
  const analyse = useStore((s) => s.analyse);
  const analysing = useStore((s) => s.analysing);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-ink-600 p-0.5 text-xs">
        {TIERS.map((t) => (
          <button
            key={t}
            disabled={analysing}
            title={`${TIER_LABELS[t].blurb} — switching re-analyses the clip`}
            onClick={() => {
              if (t === tier) return;
              setTier(t);
              void analyse();
            }}
            className={`whitespace-nowrap rounded px-2 py-1 transition ${
              tier === t ? 'bg-amber-450 text-ink-900' : 'text-slate-400 hover:text-slate-200'
            } ${analysing ? 'opacity-50' : ''}`}
          >
            {TIER_LABELS[t].name}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-500">
        {WHAT_YOU_GET[tier]}
        {tier === 'essential' && ' — switch to Standard for the intro riff and lead lines'}
      </span>
    </div>
  );
}
