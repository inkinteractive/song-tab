import type { Step } from '../state/store';

const STEPS: { id: Step; label: string }[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'trim', label: 'Trim' },
  { id: 'analyse', label: 'Analyse' },
  { id: 'edit', label: 'Chart & edit' },
];

export function Stepper({ step, onJump }: { step: Step; onJump: (s: Step) => void }) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-sm">
      {STEPS.map((s, i) => {
        const state = i === currentIndex ? 'current' : i < currentIndex ? 'done' : 'todo';
        return (
          <li key={s.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => (state === 'done' ? onJump(s.id) : undefined)}
              disabled={state !== 'done'}
              className={[
                'rounded-full px-3 py-1 transition',
                state === 'current' && 'bg-amber-450 font-semibold text-ink-900',
                state === 'done' && 'bg-ink-700 text-slate-300 hover:bg-ink-600',
                state === 'todo' && 'text-slate-600',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="mr-1 opacity-60">{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && <span className="text-slate-700">›</span>}
          </li>
        );
      })}
    </ol>
  );
}
