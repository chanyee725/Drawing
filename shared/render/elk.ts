// One shared ELK instance (in-thread, no worker) for every layout call.

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

let instance: InstanceType<typeof ELK> | undefined;

export function runElk(graph: ElkNode): Promise<ElkNode> {
  instance ??= new ELK();
  return instance.layout(graph);
}

export type { ElkNode, ElkExtendedEdge, ElkLabel, ElkPort } from 'elkjs/lib/elk-api';

/**
 * ELK reports edge coordinates relative to the edge's container (the lowest common ancestor of its ends,
 * or the end itself when one end contains the other), not to the root. The spike in `research/spikes/dsl`
 * found this; ELK names the container on each laid-out edge, so we add that node's absolute position.
 */
export function absolutePositions(root: ElkNode): Map<string, { x: number; y: number }> {
  const abs = new Map<string, { x: number; y: number }>();
  abs.set(root.id, { x: 0, y: 0 });
  const walk = (n: ElkNode, ox: number, oy: number): void => {
    for (const c of n.children ?? []) {
      const x = ox + (c.x ?? 0);
      const y = oy + (c.y ?? 0);
      abs.set(c.id, { x, y });
      walk(c, x, y);
    }
  };
  walk(root, 0, 0);
  return abs;
}

export function edgeOffset(edge: { container?: string }, abs: Map<string, { x: number; y: number }>): { x: number; y: number } {
  return (edge.container !== undefined && abs.get(edge.container)) || { x: 0, y: 0 };
}
