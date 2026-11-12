import { useRef, type ReactNode } from 'react';

type Props = { ratio: number; onRatio: (r: number) => void; left: ReactNode; right: ReactNode };

/** Two panes with a draggable divider. `ratio` is the left pane's share (0.2 to 0.8). */
export function Splitter({ ratio, onRatio, left, right }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const clamp = (r: number) => Math.min(0.8, Math.max(0.2, r));
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId) || !box.current) return;
    const r = box.current.getBoundingClientRect();
    onRatio(clamp((e.clientX - r.left) / r.width));
  };
  return (
    <div ref={box} className="flex min-h-0 flex-1">
      <div className="min-w-0 overflow-auto" style={{ width: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="문서와 캔버스 사이 분할선"
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onRatio(clamp(ratio - 0.02));
          if (e.key === 'ArrowRight') onRatio(clamp(ratio + 0.02));
        }}
        className="w-1.5 shrink-0 cursor-col-resize touch-none hover:opacity-100"
        style={{ background: 'var(--border)' }}
      />
      <div className="min-w-0 flex-1 overflow-auto">{right}</div>
    </div>
  );
}
