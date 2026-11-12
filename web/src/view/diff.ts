// Pure cell-level diff between two snapshots of a page, used to colour flashes.
// No DOM or mxGraph imports so it can be tested with `node --test`.

export interface CellSnap {
  id: string;
  parent: string;
  value: string;
  style: string;
  /** Serialised geometry (x, y, size, points), or '' when the cell has none. */
  geo: string;
  source: string;
  target: string;
}

export interface CellDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffSnapshots(prev: Map<string, CellSnap>, next: Map<string, CellSnap>): CellDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [id, n] of next) {
    const p = prev.get(id);
    if (!p) added.push(id);
    else if (
      p.parent !== n.parent ||
      p.value !== n.value ||
      p.style !== n.style ||
      p.geo !== n.geo ||
      p.source !== n.source ||
      p.target !== n.target
    )
      changed.push(id);
  }
  for (const id of prev.keys()) if (!next.has(id)) removed.push(id);
  return { added, removed, changed };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.width);
    y2 = Math.max(y2, r.y + r.height);
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** View transform as mxGraph uses it: screen = (graph + translate) * scale. */
export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export function graphToScreen(r: Rect, v: ViewTransform): Rect {
  return { x: (r.x + v.tx) * v.scale, y: (r.y + v.ty) * v.scale, width: r.width * v.scale, height: r.height * v.scale };
}

export function screenToGraph(r: Rect, v: ViewTransform): Rect {
  return { x: r.x / v.scale - v.tx, y: r.y / v.scale - v.ty, width: r.width / v.scale, height: r.height / v.scale };
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(v: ViewTransform, factor: number, px: number, py: number, min = 0.05, max = 8): ViewTransform {
  const scale = Math.min(max, Math.max(min, v.scale * factor));
  const gx = px / v.scale - v.tx;
  const gy = py / v.scale - v.ty;
  return { scale, tx: px / scale - gx, ty: py / scale - gy };
}

/** Transform that fits graph-space `bounds` into a viewport of `w`×`h` with `margin` px. */
export function fitTransform(bounds: Rect, w: number, h: number, margin = 24, maxScale = 1.5): ViewTransform {
  const bw = Math.max(bounds.width, 1);
  const bh = Math.max(bounds.height, 1);
  const scale = Math.max(0.05, Math.min(maxScale, (w - 2 * margin) / bw, (h - 2 * margin) / bh));
  return { scale, tx: (w / scale - bw) / 2 - bounds.x, ty: (h / scale - bh) / 2 - bounds.y };
}
