// Helpers shared by the three layouts: style resolution, content placement, title/legend, bounds.

import type { Attrs, DiagramBase } from '../dsl/index.ts';
import type {
  ColorMode,
  ConnectorStyle,
  Marker,
  Paint,
  Point,
  Scene,
  SceneItem,
  SceneText,
  StyleMode,
  TextSize,
  Typeface,
} from './scene.ts';
import { FONT_SIZE, lineHeightOf, linesWidth, textWidth, wrapText } from './text.ts';
import { sanitizeColor } from './theme.ts';

export const PAD = 24;

export interface ElementStyle {
  paint: Paint;
  styleMode: StyleMode;
  typeface: Typeface;
  textSize: TextSize;
  wrap: boolean;
  connectorStyle: ConnectorStyle;
}

const pick = <T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined =>
  value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

/** Global style value in force at `line`. `wrap` and `connectorStyle` only apply to later lines (per the spec). */
function globalAt(d: DiagramBase, key: string, line: number): string | undefined {
  if (key === 'wrap' || key === 'connectorStyle') {
    let v: string | undefined;
    for (const g of d.globalStyles) if (g.key === key && g.span.line < line) v = g.value;
    return v;
  }
  return d.styles[key];
}

/**
 * Element attrs win over global styles. Defaults follow the spec except `typeface`: we default to `clean`
 * (the hand-drawn face is bundled and embedded in the SVG; whether it should be the default is a product call).
 */
export function styleFor(d: DiagramBase, attrs: Attrs, line: number): ElementStyle {
  const get = (key: string): string | undefined => attrs[key] ?? globalAt(d, key, line);
  return {
    paint: {
      color: sanitizeColor(attrs.color),
      mode: pick<ColorMode>(get('colorMode'), ['pastel', 'bold', 'outline']) ?? 'pastel',
    },
    styleMode: pick<StyleMode>(get('styleMode'), ['shadow', 'plain', 'watercolor']) ?? 'shadow',
    typeface: pick<Typeface>(get('typeface'), ['rough', 'clean', 'mono']) ?? 'clean',
    textSize: pick<TextSize>(get('textSize'), ['small', 'medium', 'large']) ?? 'small',
    wrap: get('wrap') !== 'off',
    connectorStyle: pick<ConnectorStyle>(get('connectorStyle'), ['elbow', 'straight', 'arc']) ?? 'elbow',
  };
}

export const round = (n: number): number => Math.round(n * 100) / 100;

export function textItem(
  lines: string[],
  x: number,
  y: number,
  opts: Partial<Omit<SceneText, 'kind' | 'lines' | 'x' | 'y'>> & { size: number; font: Typeface },
): SceneText {
  return {
    kind: 'text',
    x,
    y,
    lines,
    lineHeight: opts.lineHeight ?? lineHeightOf(opts.size),
    anchor: opts.anchor ?? 'middle',
    weight: opts.weight ?? 400,
    tone: opts.tone ?? 'normal',
    ...opts,
  };
}

export interface Label {
  lines: string[];
  w: number;
  h: number;
  size: number;
  lineHeight: number;
}

export function measureLabel(text: string, size: number, font: Typeface, wrap: boolean, maxWidth: number, bold = false): Label {
  const lines = text === '' ? [] : wrapText(text, maxWidth, size, font, wrap, bold);
  const lineHeight = lineHeightOf(size);
  return { lines, w: linesWidth(lines, size, font, bold), h: lines.length * lineHeight, size, lineHeight };
}

export const fontSize = (s: ElementStyle): number => FONT_SIZE[s.textSize];

/** Bounding box of a scene item (text uses the measured width). */
export function itemBounds(item: SceneItem): { x0: number; y0: number; x1: number; y1: number } {
  switch (item.kind) {
    case 'box':
      return { x0: item.x, y0: item.y, x1: item.x + item.w, y1: item.y + item.h };
    case 'icon':
      return { x0: item.x, y0: item.y, x1: item.x + item.size, y1: item.y + item.size };
    case 'text': {
      const w = linesWidth(item.lines, item.size, item.font, item.weight === 600) + (item.plate ? 8 : 0);
      const x0 = item.anchor === 'start' ? item.x : item.anchor === 'end' ? item.x - w : item.x - w / 2;
      return { x0, y0: item.y, x1: x0 + w, y1: item.y + item.lines.length * item.lineHeight };
    }
    case 'edge':
    case 'line': {
      const xs = item.points.map((p) => p.x);
      const ys = item.points.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
}

export function boundsOf(items: SceneItem[]): { x0: number; y0: number; x1: number; y1: number } {
  let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const it of items) {
    const c = itemBounds(it);
    b = { x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) };
  }
  if (!Number.isFinite(b.x0)) b = { x0: 0, y0: 0, x1: 0, y1: 0 };
  return b;
}

export function translate(items: SceneItem[], dx: number, dy: number): void {
  const mv = (p: Point): Point => ({ x: round(p.x + dx), y: round(p.y + dy) });
  for (const it of items) {
    if (it.kind === 'edge' || it.kind === 'line') it.points = it.points.map(mv);
    else {
      it.x = round(it.x + dx);
      it.y = round(it.y + dy);
    }
  }
}

/** Arrow style from a legend `connection:` symbol. */
export function symbolMarkers(symbol: string): { dashed: boolean; start: Marker; end: Marker } {
  return {
    dashed: symbol.includes('--'),
    start: symbol.startsWith('<') ? 'arrow' : 'none',
    end: symbol.endsWith('>') ? 'arrow' : 'none',
  };
}

function legendItems(d: DiagramBase): { items: SceneItem[]; w: number; h: number } | undefined {
  const entries = d.legend?.entries ?? [];
  if (entries.length === 0) return undefined;
  const size = 12;
  const lh = lineHeightOf(size);
  const rowH = Math.max(lh, 18) + 6;
  const swatchW = 28;
  // The legend reads like the title: it follows the global typeface.
  const font = pick<Typeface>(d.styles.typeface, ['rough', 'clean', 'mono']) ?? 'clean';
  let w = 0;
  for (const e of entries) w = Math.max(w, textWidth(e.label ?? '', size, font));
  const boxW = Math.ceil(16 + swatchW + 10 + w + 16);
  const boxH = 12 + entries.length * rowH + 6;
  const items: SceneItem[] = [
    { kind: 'box', role: 'legend', shape: 'rectangle', x: 0, y: 0, w: boxW, h: boxH, paint: { mode: 'pastel' }, shadow: false },
  ];
  entries.forEach((e, i) => {
    const cy = 12 + i * rowH + rowH / 2 - 3;
    const color = sanitizeColor(e.color);
    if (e.connection) {
      const m = symbolMarkers(e.connection);
      items.push({ kind: 'edge', id: `legend-${i}`, points: [{ x: 16, y: cy }, { x: 16 + swatchW, y: cy }], route: 'straight', ...m, color });
    } else if (e.icon) {
      items.push({ kind: 'icon', name: e.icon, x: 16 + swatchW / 2 - 9, y: cy - 9, size: 18, paint: { color, mode: 'pastel' } });
    } else {
      const shape = (e.shape ?? 'rectangle') as 'rectangle';
      items.push({ kind: 'box', role: 'node', shape, x: 16 + 4, y: cy - 8, w: swatchW - 8, h: 16, paint: { color, mode: 'pastel' }, shadow: false });
    }
    if (e.label) items.push(textItem([e.label], 16 + swatchW + 10, cy - lh / 2, { size, font, anchor: 'start' }));
  });
  return { items, w: boxW, h: boxH };
}

/** Add the title and legend, move everything so the scene starts at (PAD, PAD), and size it. */
export function finishScene(type: Scene['type'], d: DiagramBase, items: SceneItem[]): Scene {
  let b = boundsOf(items);
  const legend = legendItems(d);
  if (legend) {
    const pos = (d.legend?.position ?? 'top-right').toLowerCase();
    const gap = 24;
    let x: number;
    let y: number;
    if (pos === 'top' || pos === 'top-center' || pos === 'bottom' || pos === 'bottom-center') {
      x = (b.x0 + b.x1) / 2 - legend.w / 2;
      y = pos.startsWith('top') ? b.y0 - gap - legend.h : b.y1 + gap;
    } else {
      x = pos.includes('left') ? b.x0 - gap - legend.w : b.x1 + gap;
      y = pos.startsWith('bottom') ? b.y1 - legend.h : pos === 'left' || pos === 'right' ? (b.y0 + b.y1) / 2 - legend.h / 2 : b.y0;
    }
    translate(legend.items, x, y);
    items.push(...legend.items);
    b = boundsOf(items);
  }
  if (d.title) {
    const size = 18;
    const lh = lineHeightOf(size);
    items.push(textItem(d.title.split(/\r?\n/), b.x0, b.y0 - 16 - lh * d.title.split(/\r?\n/).length, { size, font: pick<Typeface>(d.styles.typeface, ['rough', 'clean', 'mono']) ?? 'clean', anchor: 'start', weight: 600, tone: 'strong' }));
    b = boundsOf(items);
  }
  const origin = { x: round(PAD - b.x0), y: round(PAD - b.y0) };
  translate(items, PAD - b.x0, PAD - b.y0);
  return { type, width: Math.ceil(b.x1 - b.x0 + PAD * 2), height: Math.ceil(b.y1 - b.y0 + PAD * 2), items, origin };
}
