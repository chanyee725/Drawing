// Persistent diff highlight for a past version, drawn over the diagram.
// Render as a child of DiagramView; follows pan/zoom through DiagramApi.
import { useEffect, useReducer, useRef } from 'react';
import type { DiagramApi, Rect } from '../view/DiagramView';
import { unionRects } from '../view/diff';
import { highlightKind, type HighlightCell } from './timeline';

const STYLE = {
  added: 'border-2 border-green-600 bg-green-500/15',
  changed: 'border-2 border-amber-600 bg-amber-500/15',
  removed: 'border-2 border-dashed border-red-600 bg-red-500/20',
} as const;

export function HistoryHighlight({ api, cells, viewKey }: { api: DiagramApi | null; cells: HighlightCell[] | null; viewKey: string | null }) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => api?.onViewChange(redraw), [api]);

  // Bring the changed cells into view once per shown version (server boxes, so this
  // does not depend on the model swap having happened yet).
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  useEffect(() => {
    if (!api || !viewKey) return;
    const boxes = (cellsRef.current ?? []).flatMap((c) => (c.box ? [{ x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h }] : []));
    const u = unionRects(boxes);
    if (u) api.reveal(api.graphToScreen(u));
  }, [api, viewKey]);
  if (!api || !cells?.length) return null;
  return (
    <div data-testid="history-highlight">
      {cells.map((c) => {
        const kind = highlightKind(c.kinds);
        // Live cell state first (exact for edges); a removed cell is not in the model, use its old box.
        const r: Rect | null =
          (kind !== 'removed' ? api.getCellRect(c.id) : null) ??
          (c.box ? api.graphToScreen({ x: c.box.x, y: c.box.y, width: c.box.w, height: c.box.h }) : null);
        if (!r) return null;
        return (
          <div
            key={c.id}
            data-hl={kind}
            data-cell-id={c.id}
            className={`absolute left-0 top-0 rounded ${STYLE[kind]}`}
            style={{ transform: `translate(${r.x - 3}px, ${r.y - 3}px)`, width: r.width + 6, height: r.height + 6 }}
          />
        );
      })}
    </div>
  );
}
