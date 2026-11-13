// Sequence diagram: deterministic column/row layout (no ELK).
// Text is weight 400 only, as in the reference diagrams (09-examples-style §2.1: no bold inside diagrams).

import type { SequenceBlock, SequenceDiagram, SequenceItem, SequenceMessage } from '../dsl/index.ts';
import { finishScene, fontSize, measureLabel, styleFor, textItem } from './common.ts';
import type { ElementStyle, Label } from './common.ts';
import type { Paint, Scene, SceneItem, Point } from './scene.ts';
import { lineHeightOf, textWidth } from './text.ts';

const MSG_SIZE = 12;
const SELF_W = 36;
const SELF_H = 22;
const ACT_W = 10;

interface Column {
  id: string;
  style: ElementStyle;
  label: Label;
  iconSize: number;
  w: number;
  h: number;
  x: number;
}

/** Columns a block and its children touch (for the frame width). */
function touched(items: SequenceItem[], idx: Map<string, number>, acc: Set<number>, selfs: Set<number>): void {
  for (const it of items) {
    if (it.kind === 'message') {
      const a = idx.get(it.from);
      const b = idx.get(it.to);
      if (a !== undefined) acc.add(a);
      if (b !== undefined) acc.add(b);
      if (a !== undefined && a === b) selfs.add(a);
    } else if (it.kind === 'activation') {
      const c = idx.get(it.column);
      if (c !== undefined) acc.add(c);
    } else touched(it.children, idx, acc, selfs);
  }
}

function allMessages(items: SequenceItem[], out: SequenceMessage[] = []): SequenceMessage[] {
  for (const it of items) {
    if (it.kind === 'message') out.push(it);
    else if (it.kind === 'block') allMessages(it.children, out);
  }
  return out;
}

export async function layoutSequence(d: SequenceDiagram): Promise<Scene> {
  const idx = new Map(d.columns.map((c, i) => [c.id, i]));
  const cols: Column[] = d.columns.map((c) => {
    const style = styleFor(d, c.attrs, c.span.line);
    const size = fontSize(style);
    const label = measureLabel(c.label, size, style.typeface, style.wrap, 140);
    const iconSize = c.attrs.icon ? Math.round(size * 1.5) : 0;
    const w = Math.ceil(Math.max(label.w + (iconSize ? iconSize + 8 : 0) + 32, 96));
    const h = Math.ceil(Math.max(label.h, iconSize) + 22);
    return { id: c.id, style, label, iconSize, w, h, x: 0 };
  });

  // Gaps between neighbouring column centres: room for the boxes, then for every message label.
  const gaps = cols.slice(1).map((c, i) => cols[i]!.w / 2 + c.w / 2 + 40);
  const labelText = new Map<SequenceMessage, string>();
  const numberItems = (items: SequenceItem[], prefix: string): void => {
    let k = 0;
    for (const it of items) {
      if (it.kind === 'message') {
        k++;
        const num = d.autoNumber === 'off' ? '' : d.autoNumber === 'nested' ? `${prefix}${k}` : '';
        labelText.set(it, num ? `${num}. ${it.label ?? ''}`.trimEnd() : it.label ?? '');
      } else if (it.kind === 'block') {
        if (d.autoNumber === 'nested') {
          k++;
          numberItems(it.children, `${prefix}${k}.`);
        } else numberItems(it.children, prefix);
      }
    }
  };
  numberItems(d.items, '');
  if (d.autoNumber === 'on') allMessages(d.items).forEach((m, i) => labelText.set(m, `${i + 1}. ${m.label ?? ''}`.trimEnd()));

  const msgs = allMessages(d.items)
    .map((m) => ({ m, a: idx.get(m.from), b: idx.get(m.to) }))
    .filter((x): x is { m: SequenceMessage; a: number; b: number } => x.a !== undefined && x.b !== undefined);
  const labelW = (m: SequenceMessage): number => textWidth(labelText.get(m) ?? '', MSG_SIZE, styleFor(d, m.attrs, m.span.line).typeface);
  for (const { m, a, b } of [...msgs].sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b) || x.m.span.offset - y.m.span.offset)) {
    if (a === b) {
      const need = SELF_W + 12 + labelW(m) + 24;
      if (a < gaps.length) gaps[a] = Math.max(gaps[a]!, need);
      continue;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const have = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
    const need = labelW(m) + 48;
    if (have < need) for (let i = lo; i < hi; i++) gaps[i]! += (need - have) / (hi - lo);
  }
  cols.forEach((c, i) => {
    c.x = i === 0 ? c.w / 2 : cols[i - 1]!.x + gaps[i - 1]!;
  });

  const headerH = Math.max(0, ...cols.map((c) => c.h));
  const back: SceneItem[] = [];
  const mid: SceneItem[] = [];
  const front: SceneItem[] = [];
  const active: number[][] = cols.map(() => []);
  const actDepth = (c: number): number => active[c]!.length;
  let y = headerH + 28;

  const message = (m: SequenceMessage): void => {
    const a = idx.get(m.from);
    const b = idx.get(m.to);
    if (a === undefined || b === undefined) return;
    const style = styleFor(d, m.attrs, m.span.line);
    const text = labelText.get(m) ?? '';
    const label = measureLabel(text, MSG_SIZE, style.typeface, false, Infinity);
    const x0 = cols[a]!.x;
    const x1 = cols[b]!.x;
    const common = { kind: 'edge' as const, id: `m${m.span.offset}`, dashed: m.lineStyle === 'dashed', start: m.startArrow ? ('arrow' as const) : ('none' as const), end: m.endArrow ? ('arrow' as const) : ('none' as const), color: style.paint.color };
    if (a === b) {
      const sx = x0 + (actDepth(a) ? ACT_W / 2 + (actDepth(a) - 1) * 4 : 0);
      y += 4;
      const pts: Point[] = [{ x: sx, y }, { x: x0 + SELF_W, y }, { x: x0 + SELF_W, y: y + SELF_H }, { x: sx, y: y + SELF_H }];
      mid.push({ ...common, points: pts, route: 'elbow' });
      // A plate label too, so a long one cuts the next lifeline instead of running over it. 10px out: the cut reaches
      // PLATE_PAD + 1 left of the text and must stay clear of the loop's own right side.
      if (label.lines.length) front.push(textItem(label.lines, x0 + SELF_W + 10, y + SELF_H / 2 - label.h / 2, { size: MSG_SIZE, font: style.typeface, anchor: 'start', color: style.paint.color, plate: true }));
      y += SELF_H + 20;
      return;
    }
    // The label sits centred on the line and cuts it, like graph edge labels (09-examples-style §2.1).
    if (label.lines.length) {
      y += label.h / 2 + 4;
      front.push(textItem(label.lines, (x0 + x1) / 2, y - label.h / 2, { size: MSG_SIZE, font: style.typeface, color: style.paint.color, plate: true }));
    }
    const dir = Math.sign(x1 - x0);
    const off = (c: number): number => (actDepth(c) ? ACT_W / 2 + (actDepth(c) - 1) * 4 : 0);
    mid.push({ ...common, points: [{ x: x0 + dir * off(a), y }, { x: x1 - dir * off(b), y }], route: 'straight' });
    y += label.lines.length ? label.h / 2 + 18 : 22;
  };

  const frameTab = (x0: number, top: number, b: SequenceBlock, paint: Paint, style: ElementStyle): void => {
    const kw = b.blockType;
    const kwW = textWidth(kw, MSG_SIZE, style.typeface);
    const tabW = kwW + 20;
    front.push(textItem([kw], x0 + 10, top + 4, { size: MSG_SIZE, font: style.typeface, anchor: 'start', color: paint.color }));
    back.push({ kind: 'line', points: [{ x: x0 + tabW, y: top }, { x: x0 + tabW, y: top + 16 }, { x: x0 + tabW - 6, y: top + 22 }, { x: x0, y: top + 22 }], dashed: false, tone: 'muted' });
    if (b.label) front.push(textItem([`[${b.label}]`], x0 + tabW + 10, top + 4, { size: MSG_SIZE, font: style.typeface, anchor: 'start', tone: 'muted' }));
  };

  const walk = (items: SequenceItem[], depth: number): void => {
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (it.kind === 'message') message(it);
      else if (it.kind === 'activation') {
        const c = idx.get(it.column);
        if (c === undefined) continue;
        if (it.action === 'activate') active[c]!.push(y - 10);
        else {
          const start = active[c]!.pop();
          if (start !== undefined) activation(c, start, y - 8, active[c]!.length);
        }
      } else {
        // A block plus the `else` / `and` siblings that follow it share one frame.
        const run: SequenceBlock[] = [it];
        const cont = it.blockType === 'alt' ? 'else' : it.blockType === 'par' ? 'and' : undefined;
        while (cont) {
          const next = items[i + 1];
          if (next?.kind === 'block' && next.blockType === cont) {
            run.push(next);
            i++;
          } else break;
        }
        const cols2 = new Set<number>();
        const selfs = new Set<number>();
        touched(run.flatMap((r) => r.children), idx, cols2, selfs);
        const list = [...cols2].sort((p, q) => p - q);
        const lo = list.length ? list[0]! : 0;
        const hi = list.length ? list[list.length - 1]! : 0;
        const pad = Math.max(12, 32 - depth * 8);
        const style = styleFor(d, it.attrs, it.span.line);
        const paint: Paint = { color: style.paint.color, mode: 'outline' };
        const x0 = (cols[lo]?.x ?? 0) - pad - (cols.length ? 0 : 0);
        const tabNeed = textWidth(`${it.blockType} [${it.label ?? ''}]`, MSG_SIZE, style.typeface) + 40;
        let x1 = Math.max((cols[hi]?.x ?? 0) + pad + (selfs.has(hi) ? SELF_W + 16 : 0), x0 + tabNeed);
        if (selfs.has(hi)) {
          const widest = Math.max(0, ...allMessages(run.flatMap((r) => r.children)).filter((m) => idx.get(m.from) === hi && m.from === m.to).map((m) => textWidth(labelText.get(m) ?? '', MSG_SIZE, style.typeface)));
          x1 = Math.max(x1, (cols[hi]?.x ?? 0) + SELF_W + 16 + widest);
        }
        y += 6;
        const top = y;
        run.forEach((blk, k) => {
          if (k > 0) {
            back.push({ kind: 'line', points: [{ x: x0, y }, { x: x1, y }], dashed: true, tone: 'muted' });
            if (blk.label) front.push(textItem([`[${blk.label}]`], x0 + 10, y + 4, { size: MSG_SIZE, font: style.typeface, anchor: 'start', tone: 'muted' }));
          } else frameTab(x0, top, blk, paint, style);
          y += 30;
          walk(blk.children, depth + 1);
          y += 4;
        });
        back.push({ kind: 'box', role: 'frame', shape: 'rectangle', x: x0, y: top, w: x1 - x0, h: y - top, paint, shadow: false });
        y += 14;
      }
    }
  };

  const activation = (c: number, start: number, end: number, level: number): void => {
    const col = cols[c]!;
    back.push({ kind: 'box', role: 'activation', shape: 'rectangle', x: col.x - ACT_W / 2 + level * 4, y: start, w: ACT_W, h: Math.max(end - start, 10), paint: { color: col.style.paint.color, mode: 'pastel' }, shadow: false });
  };

  walk(d.items, 0);
  active.forEach((stack, c) => {
    while (stack.length) activation(c, stack.pop()!, y - 8, stack.length);
  });
  const bottom = y + 8;

  // Lifelines are solid and end in a second copy of the participant head (09-examples-style §2.4). They sit under
  // the activation bars and heads, and a message label that spans a middle participant cuts its lifeline the way it
  // cuts its own line, so the text never reads as struck through.
  const lifelines: SceneItem[] = [];
  const heads: SceneItem[] = [];
  const head = (c: Column, top: number, id: string | undefined): void => {
    heads.push({ kind: 'box', id, role: 'column', shape: 'rectangle', x: c.x - c.w / 2, y: top, w: c.w, h: c.h, paint: c.style.paint, shadow: c.style.styleMode !== 'plain' && c.style.paint.mode !== 'outline' });
    const contentW = c.label.w + (c.iconSize ? c.iconSize + 8 : 0);
    let x = c.x - contentW / 2;
    const cy = top + c.h / 2;
    if (c.iconSize) {
      heads.push({ kind: 'icon', name: d.columns[idx.get(c.id)!]!.attrs.icon!, x, y: cy - c.iconSize / 2, size: c.iconSize, paint: c.style.paint, inside: true });
      x += c.iconSize + 8;
    }
    heads.push(textItem(c.label.lines, c.iconSize ? x : c.x, cy - c.label.h / 2, { size: c.label.size, font: c.style.typeface, anchor: c.iconSize ? 'start' : 'middle', on: c.style.paint, lineHeight: lineHeightOf(c.label.size) }));
  };
  for (const c of cols) {
    lifelines.push({ kind: 'line', points: [{ x: c.x, y: headerH }, { x: c.x, y: bottom }], dashed: false, tone: 'muted', cut: true });
    head(c, headerH - c.h, c.id);
    // The bottom copy carries no id: the top head stays the one element for this participant.
    head(c, bottom, undefined);
  }

  return finishScene('sequence', d, [...lifelines, ...back, ...heads, ...mid, ...front]);
}
