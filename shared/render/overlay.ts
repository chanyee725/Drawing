// Run overlay geometry: where a step's node and a step-to-step edge sit in a laid-out scene.
// Pure data in scene coordinates; the web maps them to screen with the layout-edit frame math.

import type { Point, Scene, SceneEdge } from './scene.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Box of every diagram node, keyed by DSL node id, in scene coordinates.
 * Painted node boxes come first; icon-only nodes have no box and fall back to their drag handle.
 */
export function nodeRects(scene: Scene): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const it of scene.items) {
    if (it.kind === 'box' && it.role === 'node' && it.id !== undefined && !out.has(it.id)) out.set(it.id, { x: it.x, y: it.y, w: it.w, h: it.h });
  }
  for (const h of scene.handles ?? []) {
    if (h.kind === 'node' && !out.has(h.id)) out.set(h.id, { x: h.x, y: h.y, w: h.w, h: h.h });
  }
  return out;
}

/** Stable key of an edge between two nodes: the `from`/`to` DSL ids, never the renderer's `e1, e2…` order ids. */
export function edgeKey(from: string, to: string): string {
  return JSON.stringify([from, to]);
}

export interface EdgePath {
  from: string;
  to: string;
  points: Point[];
}

/**
 * Connector paths keyed by `edgeKey(from, to)`, in scene coordinates and paint order.
 * Parallel edges between the same pair share a key and are all listed.
 * With `only`, edges whose ends are not both in it (e.g. the plan's step nodes) are left out.
 */
export function edgePaths(scene: Scene, only?: ReadonlySet<string>): Map<string, EdgePath[]> {
  const out = new Map<string, EdgePath[]>();
  for (const it of scene.items) {
    if (it.kind !== 'edge') continue;
    const e: SceneEdge = it;
    if (e.from === undefined || e.to === undefined) continue;
    if (only && (!only.has(e.from) || !only.has(e.to))) continue;
    const key = edgeKey(e.from, e.to);
    const list = out.get(key) ?? [];
    list.push({ from: e.from, to: e.to, points: e.points.map((p) => ({ ...p })) });
    out.set(key, list);
  }
  return out;
}
