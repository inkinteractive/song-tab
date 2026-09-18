/**
 * The one export that matters in a lesson: the printable chord chart.
 *
 * jsPDF pulls in html2canvas, so it is imported only when the button is
 * pressed rather than sitting in the initial bundle.
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import { downloadBlob, safeFilename } from '../export/download';

export function PdfExportButton({ className = '' }: { className?: string }) {
  const a = useStore((s) => s.arrangement);
  const title = useStore((s) => s.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!a) return null;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { toPdf } = await import('../export/pdf');
      downloadBlob(toPdf(a!, title), `${safeFilename(title)}-chord-chart.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {error && <span className="text-xs text-red-300">{error}</span>}
      <button
        className="btn btn-primary whitespace-nowrap px-3 py-1.5 text-xs"
        disabled={busy}
        onClick={() => void download()}
        title="Diagrams, bar grid, strumming pattern and the tab - the print-and-hand-over one"
      >
        {busy ? 'Building…' : '⬇ Chord chart (PDF)'}
      </button>
    </div>
  );
}
