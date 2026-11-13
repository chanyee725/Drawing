// The diagram side of `planOrder` (plan.ts): node ids and edges of the block a plan is drawn in.
// Kept apart from plan.ts so the server's file model can check plans without loading the DSL parser.
import { parse, type GraphChild } from '../dsl/index.ts';
import type { Plan, PlanEdge, PlanOrder } from './plan.ts';
import { planOrder } from './plan.ts';

/** Block types (as stored in `.dpx.json`) whose code is a node-and-edge graph. */
const GRAPH_TYPES: Record<string, 'flowchart' | 'cloud-architecture'> = { flowchart: 'flowchart', architecture: 'cloud-architecture' };

function nodeIds(children: readonly GraphChild[], out: string[]): string[] {
  for (const c of children) {
    if (c.kind === 'node') out.push(c.id);
    else nodeIds(c.children, out);
  }
  return out;
}

/** Nodes and edges of `plan.block`, or null when the file has no such graph block. Parse errors keep what parsed. */
export function planDiagram(plan: Pick<Plan, 'block'>, blocks: readonly { id: string; type: string; code: string }[]): { nodes: string[]; edges: PlanEdge[] } | null {
  const block = blocks.find((b) => b.id === plan.block);
  const type = block && Object.hasOwn(GRAPH_TYPES, block.type) ? GRAPH_TYPES[block.type] : undefined;
  if (!block || !type) return null;
  const { ast } = parse(block.code, type);
  if (ast.type !== 'flowchart' && ast.type !== 'cloud-architecture') return null;
  return { nodes: nodeIds(ast.children, []), edges: ast.edges.map((e) => ({ from: e.from, to: e.to })) };
}

/** `planOrder` for a plan stored in a file with these blocks. */
export function planOrderIn(plan: Plan, blocks: readonly { id: string; type: string; code: string }[]): PlanOrder {
  return planOrder(plan, planDiagram(plan, blocks));
}
