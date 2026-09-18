/**
 * PDF chord chart via jsPDF - the thing that gets printed and handed over.
 */

import { jsPDF } from 'jspdf';
import { displayName, soundingName, toBars, uniqueShapes } from '../music/arrangement';
import { keyName } from '../music/theory';
import { patternById, patternToString } from '../music/strumming';
import { tuningById } from '../music/fretboard';
import { asciiTab } from './ascii';
import type { Arrangement } from '../types';
import type { ChordShape } from '../music/chordShapes';

const MARGIN = 48;
const PAGE_WIDTH = 595; // A4 portrait, points
const PAGE_HEIGHT = 842;

interface Cursor {
  y: number;
}

function ensureSpace(doc: jsPDF, cur: Cursor, needed: number) {
  if (cur.y + needed > PAGE_HEIGHT - MARGIN) {
    doc.addPage();
    cur.y = MARGIN;
  }
}

/** One chord box: nut or fret number, dots, barre, open/muted markers. */
function drawDiagram(doc: jsPDF, shape: ChordShape, name: string, x: number, y: number, width: number): number {
  const strings = shape.frets.length;
  const fretRows = 5;
  const colGap = width / (strings - 1);
  const rowGap = 15;
  const gridTop = y + 22;

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(name, x + width / 2, y + 12, { align: 'center' });
  doc.setFont('helvetica', 'normal');

  const openPosition = shape.baseFret <= 1;
  doc.setLineWidth(openPosition ? 2.2 : 0.7);
  doc.line(x, gridTop, x + width, gridTop);
  doc.setLineWidth(0.7);
  for (let r = 1; r <= fretRows; r++) {
    doc.line(x, gridTop + r * rowGap, x + width, gridTop + r * rowGap);
  }
  for (let s = 0; s < strings; s++) {
    doc.line(x + s * colGap, gridTop, x + s * colGap, gridTop + fretRows * rowGap);
  }

  if (!openPosition) {
    doc.setFontSize(8);
    doc.text(`${shape.baseFret}fr`, x + width + 6, gridTop + rowGap - 4);
  }

  // Open / muted markers above the nut.
  doc.setFontSize(9);
  shape.frets.forEach((f, s) => {
    const cx = x + s * colGap;
    if (f === null) doc.text('x', cx, gridTop - 4, { align: 'center' });
    else if (f === 0) doc.text('o', cx, gridTop - 4, { align: 'center' });
  });

  if (shape.barre) {
    const rel = shape.barre.fret - shape.baseFret + 1;
    if (rel >= 1 && rel <= fretRows) {
      const cy = gridTop + (rel - 0.5) * rowGap;
      const x1 = x + shape.barre.fromString * colGap;
      const x2 = x + shape.barre.toString * colGap;
      doc.setLineWidth(6);
      doc.setLineCap('round');
      doc.line(x1, cy, x2, cy);
      doc.setLineWidth(0.7);
    }
  }

  shape.frets.forEach((f, s) => {
    if (f === null || f === 0) return;
    const rel = f - shape.baseFret + 1;
    if (rel < 1 || rel > fretRows) return;
    const cx = x + s * colGap;
    const cy = gridTop + (rel - 0.5) * rowGap;
    doc.setFillColor(20, 20, 20);
    doc.circle(cx, cy, 4.2, 'F');
    const finger = shape.fingers[s];
    if (finger) {
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.text(String(finger), cx, cy + 2.4, { align: 'center' });
      doc.setTextColor(0, 0, 0);
    }
  });

  return gridTop + fretRows * rowGap + 14;
}

export function toPdf(a: Arrangement, title = 'Simplified chord chart'): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const cur: Cursor = { y: MARGIN };
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(title, MARGIN, cur.y);
  cur.y += 22;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const soundingKey = keyName({ tonic: (a.key.tonic + a.transpose + 12) % 12, mode: a.key.mode });
  const pattern = patternById(a.strumPatternId);
  const meta = [
    `${soundingKey}   ·   ${Math.round(a.tempo)} BPM   ·   ${a.beatsPerBar}/${a.beatUnit}`,
    `${tuningById(a.tuningId).name}   ·   ${a.capo === 0 ? 'no capo' : `capo fret ${a.capo}`}${
      a.transpose !== 0 ? `   ·   transposed ${a.transpose > 0 ? '+' : ''}${a.transpose}` : ''
    }`,
    `Strum: ${pattern.name}  (${patternToString(pattern)})`,
  ];
  for (const line of meta) {
    doc.text(line, MARGIN, cur.y);
    cur.y += 14;
  }
  cur.y += 8;

  // ---- diagrams -----------------------------------------------------------
  const shapes = uniqueShapes(a);
  if (shapes.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Shapes', MARGIN, cur.y);
    doc.setFont('helvetica', 'normal');
    cur.y += 10;

    const perRow = 6;
    const cellWidth = contentWidth / perRow;
    const diagramWidth = cellWidth - 26;
    for (let i = 0; i < shapes.length; i += perRow) {
      ensureSpace(doc, cur, 120);
      const row = shapes.slice(i, i + perRow);
      let bottom = cur.y;
      row.forEach((s, j) => {
        const b = drawDiagram(doc, s.shape, s.name, MARGIN + j * cellWidth, cur.y, diagramWidth);
        bottom = Math.max(bottom, b);
      });
      cur.y = bottom + 6;
    }
    cur.y += 6;
  }

  // ---- progression grid ---------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  ensureSpace(doc, cur, 40);
  doc.text('Progression', MARGIN, cur.y);
  doc.setFont('helvetica', 'normal');
  cur.y += 12;

  const bars = toBars(a);
  const barsPerRow = 4;
  const barWidth = contentWidth / barsPerRow;
  const barHeight = 42;
  for (let i = 0; i < bars.length; i += barsPerRow) {
    ensureSpace(doc, cur, barHeight + 8);
    const row = bars.slice(i, i + barsPerRow);
    row.forEach((bar, j) => {
      const x = MARGIN + j * barWidth;
      doc.setDrawColor(150);
      doc.rect(x, cur.y, barWidth, barHeight);
      doc.setFontSize(7);
      doc.setTextColor(140);
      doc.text(String(bar.index + 1), x + 4, cur.y + 9);
      doc.setTextColor(0);
      doc.setFontSize(14);
      const names = bar.chords.map((c) => displayName(c, a));
      doc.text(names.length ? names.join('   ') : '%', x + barWidth / 2, cur.y + 27, { align: 'center' });
    });
    cur.y += barHeight;
  }
  cur.y += 16;

  if (a.capo > 0) {
    ensureSpace(doc, cur, 30);
    doc.setFontSize(9);
    const sounding = [...new Set(a.chords.map((c) => soundingName(c, a)))].join('  ');
    doc.text(`Shapes above are fingered with the capo at fret ${a.capo}. They sound as: ${sounding}`, MARGIN, cur.y);
    cur.y += 18;
  }

  // ---- tab ----------------------------------------------------------------
  if (a.riff.length > 0) {
    doc.addPage();
    cur.y = MARGIN;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Riff / melody', MARGIN, cur.y);
    cur.y += 16;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    const tab = asciiTab(a).split('\n');
    // Skip the text header; the PDF already carries that information.
    const body = tab.slice(tab.findIndex((l) => l.trim() === '') + 1);
    for (const line of body) {
      ensureSpace(doc, cur, 12);
      doc.text(line, MARGIN, cur.y);
      cur.y += 9.6;
    }
  }

  // ---- caveats ------------------------------------------------------------
  if (a.notes.length) {
    ensureSpace(doc, cur, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    cur.y += 10;
    doc.text('Notes', MARGIN, cur.y);
    cur.y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const n of a.notes) {
      const wrapped = doc.splitTextToSize(`• ${n}`, contentWidth) as string[];
      for (const line of wrapped) {
        ensureSpace(doc, cur, 12);
        doc.text(line, MARGIN, cur.y);
        cur.y += 11;
      }
    }
  }

  return doc.output('blob');
}
