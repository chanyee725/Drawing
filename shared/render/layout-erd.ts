// ERD: entity tables placed by ELK (layered, left→right) with one fixed port per field row,
// so relationship lines attach to the fields they name.

import type { ErdDiagram, ErdEndpoint, ErdEntity, ErdRelationship } from '../dsl/index.ts';
import { finishScene, fontSize, measureLabel, round, styleFor, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import { absolutePositions, edgeOffset, runElk } from './elk.ts';
import type { ElkExtendedEdge, ElkNode, ElkPort } from './elk.ts';
import type { Marker, Point, Scene, SceneItem } from './scene.ts';
import { lineHeightOf, textWidth } from './text.ts';

const ROW_H = 26;
const TYPE_SIZE = 12;
const BADGE_W = 24;

interface EntityGeom {
  entity: ErdEntity;
  style: ElementStyle;
  label: Label;
  iconSize: number;
  headerH: number;
  w: number;
  h: number;
}

const KEY_BADGE = (meta: string[]): string => (meta.includes('pk') ? 'PK' : meta.includes('fk') ? 'FK' : '');
const typeText = (meta: string[], type?: string): string => [type ?? '', ...meta.filter((m) => m !== 'pk' && m !== 'fk')].join(' ').trim();

function measureEntity(d: ErdDiagram, e: ErdEntity): EntityGeom {
  const style = styleFor(d, e.attrs, e.span.line);
  const size = fontSize(style);
  const label = measureLabel(e.label, size, style.typeface, false, Infinity, true);
  const iconSize = e.attrs.icon ? Math.round(size * 1.4) : 0;
  const headerH = Math.max(label.h, iconSize) + 18;
  let w = label.w + (iconSize ? iconSize + 8 : 0) + 32;
  for (const f of e.fields) {
    const row = BADGE_W + textWidth(f.name, size, style.typeface) + 24 + textWidth(typeText(f.meta, f.type), TYPE_SIZE, style.typeface) + 24;
    w = Math.max(w, row);
  }
  w = Math.ceil(Math.max(w, 180));
  return { entity: e, style, label, iconSize, headerH, w, h: headerH + Math.max(e.fields.length, 0) * ROW_H + (e.fields.length ? 6 : 0) };
}

function endMarkers(r: ErdRelationship): [Marker, Marker] {
  switch (r.cardinality) {
    case 'one-to-many':
      return ['one', 'many'];
    case 'many-to-one':
      return ['many', 'one'];
    case 'many-to-many':
      return ['many', 'many'];
    default:
      return ['one', 'one'];
  }
}

function chenLabels(r: ErdRelationship): [string, string] {
  switch (r.cardinality) {
    case 'one-to-many':
      return ['1', 'N'];
    case 'many-to-one':
      return ['N', '1'];
    case 'many-to-many':
      return ['M', 'N'];
    default:
      return ['1', '1'];
  }
}

export async function layoutErd(d: ErdDiagram): Promise<Scene> {
  const geoms = new Map<string, EntityGeom>();
  for (const e of d.entities) geoms.set(e.id, measureEntity(d, e));

  const rowOf = (ep: ErdEndpoint): number => {
    const g = geoms.get(ep.entity);
    if (!g || ep.field === undefined) return -1;
    return g.entity.fields.findIndex((f) => f.name === ep.field);
  };
  const portId = (entity: string, row: number, side: 'W' | 'E'): string => `p:${entity}:${row}:${side}`;

  const children: ElkNode[] = [...geoms.values()].map((g) => {
    const ports: ElkPort[] = [];
    for (let row = -1; row < g.entity.fields.length; row++) {
      const y = row < 0 ? g.headerH / 2 : g.headerH + row * ROW_H + ROW_H / 2;
      ports.push({ id: portId(g.entity.id, row, 'W'), x: 0, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } });
      ports.push({ id: portId(g.entity.id, row, 'E'), x: g.w, y, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } });
    }
    return { id: `n:${g.entity.id}`, width: g.w, height: g.h, ports, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } };
  });

  const rels = d.relationships.filter((r) => geoms.has(r.from.entity) && geoms.has(r.to.entity));
  const relLabels = new Map<ErdRelationship, ReturnType<typeof measureLabel>>();
  const edges: ElkExtendedEdge[] = rels.map((r, i) => {
    const self = r.from.entity === r.to.entity;
    const style = styleFor(d, r.attrs, r.span.line);
    const label = r.label ? measureLabel(r.label, TYPE_SIZE, style.typeface, false, Infinity) : undefined;
    if (label) relLabels.set(r, label);
    return {
      id: `e:${i}`,
      sources: [portId(r.from.entity, rowOf(r.from), 'E')],
      targets: [portId(r.to.entity, rowOf(r.to), self ? 'E' : 'W')],
      labels: label ? [{ id: `l:${i}`, text: r.label!, width: Math.ceil(label.w + 8), height: label.h + 4 }] : [],
    };
  });

  const out = await runElk({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.spacing.nodeNode': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '14',
      'elk.edgeLabels.inline': 'true',
      'elk.spacing.componentComponent': '64',
    },
    children,
    edges,
  });
  const abs = absolutePositions(out);

  const tables: SceneItem[] = [];
  const lines: SceneItem[] = [];
  const labels: SceneItem[] = [];
  for (const g of geoms.values()) {
    const p = abs.get(`n:${g.entity.id}`) ?? { x: 0, y: 0 };
    const { style } = g;
    const size = fontSize(style);
    const shadow = style.styleMode !== 'plain' && style.paint.mode !== 'outline';
    tables.push({ kind: 'box', id: g.entity.id, role: 'entity', shape: 'rectangle', x: p.x, y: p.y, w: g.w, h: g.h, paint: { mode: style.paint.mode === 'outline' ? 'outline' : 'pastel' }, shadow });
    tables.push({ kind: 'box', role: 'entity-header', shape: 'rectangle', x: p.x, y: p.y, w: g.w, h: g.headerH, paint: style.paint, shadow: false });
    const cy = p.y + g.headerH / 2;
    let x = p.x + 14;
    if (g.iconSize) {
      tables.push({ kind: 'icon', name: g.entity.attrs.icon!, x, y: cy - g.iconSize / 2, size: g.iconSize, paint: style.paint, inside: true });
      x += g.iconSize + 8;
    }
    tables.push(textItem(g.label.lines, x, cy - g.label.h / 2, { size, font: style.typeface, anchor: 'start', weight: 600, on: style.paint }));
    g.entity.fields.forEach((f, row) => {
      const ry = p.y + g.headerH + row * ROW_H;
      const lh = lineHeightOf(size);
      const badge = KEY_BADGE(f.meta);
      if (badge) tables.push(textItem([badge], p.x + 10, ry + (ROW_H - lineHeightOf(10)) / 2, { size: 10, font: style.typeface, anchor: 'start', weight: 600, tone: 'muted', color: badge === 'PK' ? 'yellow' : undefined }));
      tables.push(textItem([f.name], p.x + 10 + BADGE_W, ry + (ROW_H - lh) / 2, { size, font: style.typeface, anchor: 'start', weight: badge === 'PK' ? 600 : 400 }));
      const t = typeText(f.meta, f.type);
      if (t) tables.push(textItem([t], p.x + g.w - 12, ry + (ROW_H - lineHeightOf(TYPE_SIZE)) / 2, { size: TYPE_SIZE, font: style.typeface, anchor: 'end', tone: 'muted' }));
    });
  }

  const laid = new Map((out.edges ?? []).map((e) => [e.id, e as ElkExtendedEdge & { container?: string }]));
  rels.forEach((r, i) => {
    const le = laid.get(`e:${i}`);
    const s = le?.sections?.[0];
    if (!le || !s) return;
    const o = edgeOffset(le, abs);
    const points: Point[] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: round(p.x + o.x), y: round(p.y + o.y) }));
    const style = styleFor(d, r.attrs, r.span.line);
    const [m0, m1] = endMarkers(r);
    const crow = d.notation === 'crows-foot';
    lines.push({ kind: 'edge', id: `r${i}`, points, route: 'elbow', dashed: false, start: crow ? m0 : 'none', end: crow ? m1 : 'none', color: style.paint.color });
    if (!crow) {
      const [t0, t1] = chenLabels(r);
      const near = (a: Point, b: Point, text: string): void => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const px = a.x + ((b.x - a.x) / len) * 12;
        const py = a.y + ((b.y - a.y) / len) * 12;
        labels.push(textItem([text], px, py - 17, { size: 11, font: style.typeface, weight: 600, color: style.paint.color, tone: 'muted' }));
      };
      near(points[0]!, points[1]!, t0);
      near(points[points.length - 1]!, points[points.length - 2]!, t1);
    }
    const label = relLabels.get(r);
    if (label) {
      let best = -1;
      let at = points[0]!;
      for (let k = 1; k < points.length; k++) {
        const len = Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.y - points[k - 1]!.y);
        if (len > best + 0.5) {
          best = len;
          at = { x: (points[k]!.x + points[k - 1]!.x) / 2, y: (points[k]!.y + points[k - 1]!.y) / 2 };
        }
      }
      labels.push(textItem(label.lines, at.x, at.y - label.h / 2, { size: TYPE_SIZE, font: style.typeface, plate: true, tone: 'muted', color: style.paint.color }));
    }
  });

  return finishScene('erd', d, [...lines, ...tables, ...labels]);
}
