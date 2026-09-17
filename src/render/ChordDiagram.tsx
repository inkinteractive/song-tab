/**
 * SVG chord diagram. Used in the shape strip and in the per-chord editor.
 */

import type { ChordShape } from '../music/chordShapes';

interface Props {
  shape: ChordShape;
  name?: string;
  width?: number;
  fretRows?: number;
  muted?: boolean;
  compact?: boolean;
}

export function ChordDiagram({ shape, name, width = 92, fretRows = 5, compact = false }: Props) {
  const strings = shape.frets.length;
  const padX = 12;
  const padTop = compact ? 14 : 26;
  const gridWidth = width - padX * 2;
  const colGap = gridWidth / (strings - 1);
  const rowGap = compact ? 12 : 15;
  const gridHeight = rowGap * fretRows;
  const height = padTop + gridHeight + 12;
  const openPosition = shape.baseFret <= 1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${name ?? shape.label} chord diagram`}
      className="select-none"
    >
      {!compact && (
        <text
          x={width / 2}
          y={14}
          textAnchor="middle"
          className="fill-slate-100"
          style={{ fontSize: 13, fontWeight: 600 }}
        >
          {name ?? shape.label}
        </text>
      )}

      {/* nut or top fret line */}
      <line
        x1={padX}
        y1={padTop}
        x2={padX + gridWidth}
        y2={padTop}
        stroke="currentColor"
        strokeWidth={openPosition ? 3.5 : 1}
        className="text-slate-300"
      />
      {Array.from({ length: fretRows }, (_, r) => (
        <line
          key={`f${r}`}
          x1={padX}
          y1={padTop + (r + 1) * rowGap}
          x2={padX + gridWidth}
          y2={padTop + (r + 1) * rowGap}
          stroke="currentColor"
          strokeWidth={1}
          className="text-slate-600"
        />
      ))}
      {Array.from({ length: strings }, (_, s) => (
        <line
          key={`s${s}`}
          x1={padX + s * colGap}
          y1={padTop}
          x2={padX + s * colGap}
          y2={padTop + gridHeight}
          stroke="currentColor"
          strokeWidth={1}
          className="text-slate-600"
        />
      ))}

      {!openPosition && (
        <text
          x={padX + gridWidth + 4}
          y={padTop + rowGap - 3}
          className="fill-slate-400"
          style={{ fontSize: 9 }}
        >
          {shape.baseFret}fr
        </text>
      )}

      {/* open / muted markers */}
      {shape.frets.map((f, s) =>
        f === null || f === 0 ? (
          <text
            key={`m${s}`}
            x={padX + s * colGap}
            y={padTop - 4}
            textAnchor="middle"
            className={f === null ? 'fill-slate-500' : 'fill-slate-300'}
            style={{ fontSize: 10 }}
          >
            {f === null ? '×' : '○'}
          </text>
        ) : null,
      )}

      {shape.barre &&
        (() => {
          const rel = shape.barre.fret - shape.baseFret + 1;
          if (rel < 1 || rel > fretRows) return null;
          return (
            <line
              x1={padX + shape.barre.fromString * colGap}
              y1={padTop + (rel - 0.5) * rowGap}
              x2={padX + shape.barre.toString * colGap}
              y2={padTop + (rel - 0.5) * rowGap}
              stroke="currentColor"
              strokeWidth={rowGap * 0.55}
              strokeLinecap="round"
              className="text-amber-450"
            />
          );
        })()}

      {shape.frets.map((f, s) => {
        if (f === null || f === 0) return null;
        const rel = f - shape.baseFret + 1;
        if (rel < 1 || rel > fretRows) return null;
        const cx = padX + s * colGap;
        const cy = padTop + (rel - 0.5) * rowGap;
        const finger = shape.fingers[s];
        return (
          <g key={`d${s}`}>
            <circle cx={cx} cy={cy} r={rowGap * 0.33} className="fill-amber-450" />
            {finger && !compact && (
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                className="fill-ink-900"
                style={{ fontSize: 8, fontWeight: 700 }}
              >
                {finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
