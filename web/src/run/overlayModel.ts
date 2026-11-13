// Progress board overlay model (design: docs/design/dispatch-integration/2-file-format-and-live-overlay.md §5.1).
// Pure: from a laid-out scene and the run's step views, what to draw (rings, badges, edges) in scene coordinates.
// No DOM, so it runs under `node --test`. Colours are CSS expressions on the app tokens (--ok, --bad, --idle,
// --role-*), so the same model draws in light and dark.

import type { Point, Scene } from '../../../shared/render/scene.ts';
import { edgePaths, nodeRects, type Rect } from '../../../shared/render/overlay.ts';
import { STEP_VIEWS, edgeView, linkSteps, stepNode, type StepView } from '../../../shared/dispatch/step-view.ts';

/** Dispatch role ids (server/dispatch/roles.js). Unknown roles draw in the neutral `--idle` colour. */
export const ROLES = { lead: '관리자', impl: '구현자', review: '리뷰어', test: '테스터', design: '디자이너', docs: '문서화' } as const;
export type RoleId = keyof typeof ROLES;

/** One agent session working on a step. `name` is Dispatch's random short name, never a person. */
export interface RunAgent {
  name: string;
  role: string;
}

/** What the overlay needs per step: the step ↔ node link and its computed `step.view` (E24). */
export interface RunStep {
  id: string;
  /** DSL node id; defaults to `id`. */
  node?: string;
  view: StepView;
  /** A session waits on a person ("사람 기다림"). */
  waiting?: boolean;
  /** Short title for the label (defaults to the node id). */
  title?: string;
  /** Sessions on the step; the first one owns the step's colour. */
  agents?: readonly RunAgent[];
}

export interface OverlayNode {
  step: string;
  node: string;
  rect: Rect;
  view: StepView;
  glyph: string;
  /** Visible label text: `진행 · Juno`. */
  text: string;
  /** Full accessible name: `Implement · 진행 · Juno(구현자) · 사람 기다림`. */
  label: string;
  color: string;
  /** Pulsing ring (active/review). */
  live: boolean;
  waiting: boolean;
}

export interface OverlayEdge {
  key: string;
  points: Point[];
  kind: 'flow' | 'done';
  color: string;
}

export interface OverlayModel {
  nodes: OverlayNode[];
  edges: OverlayEdge[];
  /** Steps whose node is not in the diagram ("다이어그램에 없는 단계"). */
  missing: string[];
}

const STATE_COLOR: Record<StepView, string> = {
  pending: 'var(--idle)',
  active: 'var(--ok)',
  review: 'var(--ok)',
  done: 'var(--ok)',
  blocked: 'var(--bad)',
};

/** Up to 3 lightness steps per role; later sessions of the same role reuse the last step (their name tells them apart). */
const SHADES = 3;

export const roleLabel = (role: string): string => (role in ROLES ? ROLES[role as RoleId] : role);

/** Colour of one role at a lightness step: step 0 is the token, later steps move toward the text colour (more contrast in both themes). */
export function roleColor(role: string, shade = 0): string {
  const base = role in ROLES ? `var(--role-${role})` : 'var(--idle)';
  const s = Math.min(Math.max(shade, 0), SHADES - 1);
  return s === 0 ? base : `color-mix(in oklch, ${base}, var(--foreground) ${s * 25}%)`;
}

/**
 * Agent name → colour for the whole run: same role, same hue; the n-th distinct agent of a role gets lightness step n
 * (in step order, then session order), so a colour stays with its agent across steps.
 */
export function agentColors(steps: readonly RunStep[]): Map<string, string> {
  const out = new Map<string, string>();
  const perRole = new Map<string, number>();
  for (const s of steps)
    for (const a of s.agents ?? []) {
      if (out.has(a.name)) continue;
      const n = perRole.get(a.role) ?? 0;
      perRole.set(a.role, n + 1);
      out.set(a.name, roleColor(a.role, n));
    }
  return out;
}

export function overlayModel(scene: Scene, steps: readonly RunStep[]): OverlayModel {
  const rects = nodeRects(scene);
  const { linked, missing } = linkSteps(steps, rects.keys());
  const colors = agentColors(steps);
  const byNode = new Map<string, OverlayNode>();
  const nodes: OverlayNode[] = [];
  for (const s of steps) {
    const node = linked.get(s.id);
    // Two steps on one node: the first wins (the plan validator rejects that; the overlay must not draw twice).
    if (node === undefined || byNode.has(node)) continue;
    const owner = s.agents?.[0];
    const live = s.view === 'active' || s.view === 'review';
    const color = live && owner ? colors.get(owner.name)! : STATE_COLOR[s.view];
    const v = STEP_VIEWS[s.view];
    const who = (s.agents ?? []).map((a) => a.name);
    const waiting = !!s.waiting && live;
    const text = [v.label, ...(who.length > 2 ? [`${who[0]} 외 ${who.length - 1}`] : who)].join(' · ');
    const label = [s.title ?? stepNode(s), v.label, ...(s.agents ?? []).map((a) => `${a.name}(${roleLabel(a.role)})`), ...(waiting ? ['사람 기다림'] : [])].join(' · ');
    const n: OverlayNode = { step: s.id, node, rect: rects.get(node)!, view: s.view, glyph: v.glyph, text, label, color, live, waiting };
    byNode.set(node, n);
    nodes.push(n);
  }
  const edges: OverlayEdge[] = [];
  for (const [key, list] of edgePaths(scene, new Set(byNode.keys()))) {
    const a = byNode.get(list[0]!.from)!;
    const b = byNode.get(list[0]!.to)!;
    const kind = edgeView(a.view, b.view);
    if (kind === 'none') continue;
    list.forEach((p, i) => edges.push({ key: i ? `${key}#${i}` : key, points: p.points, kind, color: kind === 'done' ? 'var(--ok)' : b.color }));
  }
  return { nodes, edges, missing };
}

/** SVG path data through the edge's points (straight segments; the overlay traces, it does not redraw the connector). */
export function pathData(points: readonly Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join('');
}
