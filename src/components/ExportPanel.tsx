/**
 * Exports. Everything is generated client-side from the edited arrangement.
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import { asciiTab, chordChartText } from '../export/ascii';
import { toMusicXml } from '../export/musicxml';
import { toMidi } from '../export/midi';
import { guitarProStatus, toAlphaTexSource, toGuitarPro } from '../export/guitarpro';
import { downloadBlob, downloadText, safeFilename } from '../export/download';

type Preview = { label: string; text: string } | null;

export function ExportPanel() {
  const a = useStore((s) => s.arrangement);
  const title = useStore((s) => s.title);
  const [preview, setPreview] = useState<Preview>(null);
  const [error, setError] = useState<string | null>(null);
  const gp = guitarProStatus();

  if (!a) return null;
  const base = safeFilename(title);

  const guard = (fn: () => void | Promise<void>) => () => {
    setError(null);
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((err) => setError(err instanceof Error ? err.message : String(err)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-slate-200">Export</h3>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ExportButton
          title="Chord chart (PDF)"
          hint="Diagrams, bar grid, strumming pattern. The print-and-hand-over one."
          onClick={guard(async () => {
            // jsPDF drags in html2canvas; keep it out of the initial bundle.
            const { toPdf } = await import('../export/pdf');
            downloadBlob(toPdf(a, title), `${base}-chord-chart.pdf`);
          })}
        />
        <ExportButton
          title="Chord chart (text)"
          hint="Plain text for lesson notes or a message."
          onClick={guard(() => downloadText(chordChartText(a, title), `${base}-chords.txt`))}
          onPreview={() => setPreview({ label: 'Chord chart', text: chordChartText(a, title) })}
        />
        <ExportButton
          title="ASCII tab"
          hint="The forum-style tab layout."
          onClick={guard(() => downloadText(asciiTab(a, title), `${base}-tab.txt`))}
          onPreview={() => setPreview({ label: 'ASCII tab', text: asciiTab(a, title) })}
        />
        <ExportButton
          title="MusicXML"
          hint="Opens in MuseScore; Guitar Pro 7+ imports it too."
          onClick={guard(() => downloadText(toMusicXml(a, title), `${base}.musicxml`, 'application/vnd.recordare.musicxml+xml'))}
        />
        <ExportButton
          title="MIDI"
          hint="Strummed chords plus the riff, at the arrangement tempo."
          onClick={guard(() => downloadBlob(new Blob([toMidi(a) as BlobPart], { type: 'audio/midi' }), `${base}.mid`))}
        />
        <ExportButton
          title="Guitar Pro (.gp)"
          hint={gp.reason}
          disabled={!gp.available}
          onClick={guard(async () => downloadBlob(await toGuitarPro(a, title), `${base}.gp`))}
        />
        <ExportButton
          title="alphaTex"
          hint="The source alphaTab renders from - handy for debugging."
          onClick={guard(async () => downloadText(await toAlphaTexSource(a, title), `${base}.alphatex`))}
          onPreview={() => {
            void toAlphaTexSource(a, title).then((text) => setPreview({ label: 'alphaTex', text }));
          }}
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-200">
          Export failed: {error}
        </div>
      )}

      {preview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-500">{preview.label} preview</span>
            <div className="flex gap-2">
              <button
                className="btn btn-ghost px-2 py-1 text-xs"
                onClick={() => void navigator.clipboard?.writeText(preview.text)}
              >
                Copy
              </button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md border border-ink-600 bg-ink-900 p-3 font-mono text-xs leading-relaxed text-slate-300">
            {preview.text}
          </pre>
        </div>
      )}
    </div>
  );
}

function ExportButton({
  title,
  hint,
  onClick,
  onPreview,
  disabled,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  onPreview?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-ink-600 bg-ink-900 p-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-slate-100">{title}</span>
        {onPreview && !disabled && (
          <button className="text-xs text-slate-500 hover:text-amber-450" onClick={onPreview}>
            preview
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      <button className="btn mt-2 w-full text-xs" onClick={onClick} disabled={disabled}>
        Download
      </button>
    </div>
  );
}
