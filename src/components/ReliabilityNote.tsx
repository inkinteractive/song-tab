/**
 * The honest banner.
 *
 * The chord engine does not fail quietly: on material it cannot read it still
 * emits a confident-looking chord per bar, and a teacher has no way to tell
 * that page from a good one. This says so, in the one place they cannot miss,
 * and only when the progression itself gives it away.
 *
 * It reads the arrangement rather than the analysis, so correcting bars in the
 * chart makes it re-evaluate and go away.
 */

import { useMemo, useState } from 'react';
import { assessProgression } from '../analysis/reliability';
import { keyName } from '../music/theory';
import { useStore } from '../state/store';

export function ReliabilityNote() {
  const a = useStore((s) => s.arrangement);
  const [dismissed, setDismissed] = useState(false);

  const report = useMemo(
    () => (a ? assessProgression(a.chords, a.key) : null),
    [a],
  );

  if (!a || !report || report.verdict === 'good' || dismissed) return null;

  const poor = report.verdict === 'poor';

  // Name the thing that actually failed, in the chart's own terms. The
  // decoder's confidence number is deliberately not one of these: see the note
  // on `meanConfidence` in reliability.ts.
  const reasons: string[] = [];
  if (report.diatonicFit < 0.7) {
    reasons.push(`only ${Math.round(report.diatonicFit * 100)}% of the bars fit ${keyName(a.key)}`);
  }
  if (report.rootChurn > 0.6) {
    reasons.push(`it names ${report.distinctRoots} different chords in ${a.chords.length} bars`);
  }

  return (
    <div
      className={`card border ${
        poor ? 'border-red-800 bg-red-950/40' : 'border-amber-700/60 bg-amber-950/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 text-sm">
          <p className={poor ? 'font-semibold text-red-200' : 'font-semibold text-amber-200'}>
            {poor ? 'These chords are probably wrong.' : 'Check these chords before you teach them.'}
          </p>
          <p className="text-slate-300">
            {reasons.length > 0 && <>Judging by the chart itself, {reasons.join(', and ')}. </>}
            That is what a dense mix does to the chord detector: it reads harmony from one instrument at a time,
            and a full band with vocals and heavy effects drowns the part you want.
          </p>
          <p className="text-slate-400">
            Everything below is editable. Click any bar in the chord chart to fix it - the tab, the PDF and the
            playback all follow. Re-trimming to a quieter section, or an intro before the vocal comes in, is usually
            worth a try first.
          </p>
        </div>
        <button
          className="btn btn-ghost shrink-0 px-2 py-1 text-xs"
          onClick={() => setDismissed(true)}
          title="Hide this"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
