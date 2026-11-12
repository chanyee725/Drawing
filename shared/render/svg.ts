// Paint a Scene as a standalone SVG string. Deterministic: same scene + options → same bytes.
// No ids, no external references, no scripts: safe to inline several on one page.

import { round } from './common.ts';
import { iconFor } from './icons.ts';
import type { Point, Scene, SceneBox, SceneEdge, SceneIcon, SceneItem, SceneLine, SceneText } from './scene.ts';
import { FONT_FAMILY, linesWidth } from './text.ts';
import { THEMES, resolvePaint, strokeOf } from './theme.ts';
import type { Theme } from './theme.ts';

export interface SvgOptions {
  theme?: Theme;
  /** Fill the background with the theme colour (for export). Default: transparent. */
  background?: boolean;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number): string => String(round(v));
const pts = (ps: Point[]): string => ps.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

const RADIUS: Record<SceneBox['role'], number> = {
  node: 8,
  group: 12,
  entity: 8,
  'entity-header': 8,
  column: 8,
  activation: 2,
  frame: 6,
  legend: 8,
};

function shapeMarkup(b: SceneBox, attrs: string): string {
  const { x, y, w, h } = b;
  const poly = (ps: [number, number][]): string => `<polygon points="${ps.map(([px, py]) => `${n(px)},${n(py)}`).join(' ')}"${attrs}/>`;
  const inset = Math.min(16, w / 4);
  switch (b.shape) {
    case 'circle':
      return `<circle cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" r="${n(Math.min(w, h) / 2)}"${attrs}/>`;
    case 'ellipse':
      return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}"${attrs}/>`;
    case 'oval':
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}"${attrs}/>`;
    case 'diamond':
      return poly([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
    case 'hexagon':
      return poly([[x + inset, y], [x + w - inset, y], [x + w, y + h / 2], [x + w - inset, y + h], [x + inset, y + h], [x, y + h / 2]]);
    case 'parallelogram':
      return poly([[x + inset, y], [x + w, y], [x + w - inset, y + h], [x, y + h]]);
    case 'trapezoid':
      return poly([[x + inset, y], [x + w - inset, y], [x + w, y + h], [x, y + h]]);
    case 'triangle':
      return poly([[x + w / 2, y], [x + w, y + h], [x, y + h]]);
    case 'star': {
      const cx = x + w / 2;
      const cy = y + h / 2 + h * 0.04;
      const ro = Math.min(w, h) / 2;
      const ri = ro * 0.5;
      const ps: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? ro : ri;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        ps.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return poly(ps);
    }
    case 'cylinder': {
      const ry = Math.min(9, h / 6);
      const d = `M${n(x)} ${n(y + ry)}A${n(w / 2)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)}V${n(y + h - ry)}A${n(w / 2)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)}Z`;
      const lid = `M${n(x)} ${n(y + ry)}A${n(w / 2)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}`;
      return `<path d="${d}"${attrs}/><path d="${lid}" fill="none"${attrs.replace(/ fill="[^"]*"/, '')}/>`;
    }
    case 'document': {
      const wave = Math.min(8, h / 6);
      const d = `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h - wave)}C${n(x + w * 0.75)} ${n(y + h - wave * 2.2)} ${n(x + w * 0.25)} ${n(y + h + wave * 0.6)} ${n(x)} ${n(y + h - wave)}Z`;
      return `<path d="${d}"${attrs}/>`;
    }
    default:
      if (b.role === 'entity-header') {
        const r = RADIUS['entity-header'];
        return `<path d="M${n(x)} ${n(y + h)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h)}Z"${attrs}/>`;
      }
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${RADIUS[b.role]}"${attrs}/>`;
  }
}

function boxMarkup(b: SceneBox, theme: Theme): string {
  const t = THEMES[theme];
  const soft = b.role === 'group' || b.role === 'frame' || b.role === 'legend';
  const p = resolvePaint(b.paint, theme, soft);
  let fill = p.fill;
  let stroke = p.stroke;
  if (b.role === 'frame') fill = 'none';
  if (b.role === 'legend') {
    fill = t.fill;
    stroke = t.stroke;
  }
  if (b.role === 'activation') fill = b.paint.color ? p.fill : t.groupFill;
  const width = b.role === 'group' || b.role === 'frame' ? 1.25 : 1.5;
  const dash = b.dashed ? ' stroke-dasharray="6 4"' : '';
  const out: string[] = [];
  if (b.shadow) out.push(shapeMarkup({ ...b, x: b.x + 2, y: b.y + 3 }, ` fill="${t.shadow}" stroke="none"`));
  out.push(shapeMarkup(b, ` fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash}`));
  const id = b.id !== undefined ? ` data-id="${esc(b.id)}"` : '';
  return `<g data-role="${b.role}"${id}>${out.join('')}</g>`;
}

function textMarkup(tx: SceneText, theme: Theme): string {
  if (tx.lines.length === 0) return '';
  const t = THEMES[theme];
  let fill = tx.tone === 'muted' ? t.muted : t.text;
  if (tx.on) fill = resolvePaint(tx.on, theme).text;
  if (tx.color) fill = strokeOf(tx.color, theme);
  const out: string[] = [];
  if (tx.plate) {
    const w = linesWidth(tx.lines, tx.size, tx.font, tx.weight === 600) + 8;
    const x0 = tx.anchor === 'start' ? tx.x - 4 : tx.anchor === 'end' ? tx.x - w + 4 : tx.x - w / 2;
    out.push(`<rect x="${n(x0)}" y="${n(tx.y - 2)}" width="${n(w)}" height="${n(tx.lines.length * tx.lineHeight + 4)}" rx="4" fill="${t.plate}"/>`);
  }
  const spans = tx.lines
    .map((line, i) => `<tspan x="${n(tx.x)}" y="${n(tx.y + i * tx.lineHeight + (tx.lineHeight - tx.size) / 2 + tx.size * 0.8)}">${esc(line)}</tspan>`)
    .join('');
  const weight = tx.weight === 600 ? ' font-weight="600"' : '';
  const family = tx.font === 'clean' ? '' : ` font-family="${esc(FONT_FAMILY[tx.font])}"`;
  out.push(`<text font-size="${tx.size}"${weight}${family} fill="${fill}" text-anchor="${tx.anchor}" xml:space="preserve">${spans}</text>`);
  return out.join('');
}

/** WCAG contrast ratio between two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function iconMarkup(ic: SceneIcon, theme: Theme): string {
  const icon = iconFor(ic.name);
  const t = THEMES[theme];
  let color = ic.paint.color ? strokeOf(ic.paint.color, theme) : t.text;
  if (ic.inside && ic.paint.mode === 'bold') color = resolvePaint(ic.paint, theme).text;
  // Logos keep their brand colour unless a colour was asked for, they sit on a bold fill, or the
  // brand colour would vanish into the background (black logos on the dark theme).
  else if (icon.hex && !ic.paint.color && contrast(icon.hex, t.background) >= 3) color = icon.hex;
  const s = ic.size / 24;
  const open = `<g data-icon="${esc(ic.name)}" data-icon-set="${icon.set}" transform="translate(${n(ic.x)} ${n(ic.y)}) scale(${n(s)})">`;
  if (icon.fill) return `${open}<path d="${icon.d}" fill="${color}"/></g>`;
  const dash = icon.set === 'own' && icon.key === 'placeholder' ? ' stroke-dasharray="3 2.5"' : '';
  return (
    open +
    `<path d="${icon.d}" fill="none" stroke="${color}" stroke-width="${n(1.6 / Math.max(s, 0.5))}" stroke-linecap="round" stroke-linejoin="round"${dash}/></g>`
  );
}

/** Polyline path with rounded corners. */
function roundedPath(ps: Point[], radius: number): string {
  if (ps.length < 3) return `M${pts(ps).replace(' ', 'L')}`;
  let d = `M${n(ps[0]!.x)} ${n(ps[0]!.y)}`;
  for (let i = 1; i < ps.length - 1; i++) {
    const a = ps[i - 1]!;
    const b = ps[i]!;
    const c = ps[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y);
    const l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) {
      d += `L${n(b.x)} ${n(b.y)}`;
      continue;
    }
    const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += `L${n(p1.x)} ${n(p1.y)}Q${n(b.x)} ${n(b.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  const last = ps[ps.length - 1]!;
  return `${d}L${n(last.x)} ${n(last.y)}`;
}

/** Marker drawn at `tip`, pointing from `from` to `tip`. Returns markup and how far to pull the line back. */
function markerMarkup(kind: SceneEdge['end'], from: Point, tip: Point, color: string): { markup: string; pull: number } {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const at = (back: number, side: number): Point => ({ x: tip.x - ux * back - uy * side, y: tip.y - uy * back + ux * side });
  const line = (a: Point, b: Point): string => `<path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" stroke="${color}" stroke-width="1.5" fill="none"/>`;
  switch (kind) {
    case 'arrow': {
      const a = at(10, -4.5);
      const b = at(10, 4.5);
      return { markup: `<path d="M${n(tip.x)} ${n(tip.y)}L${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}Z" fill="${color}" stroke="${color}" stroke-width="1" stroke-linejoin="round"/>`, pull: 8 };
    }
    case 'one':
      return { markup: line(at(9, -6), at(9, 6)) + line(at(14, -6), at(14, 6)), pull: 0 };
    case 'many':
      return { markup: line(at(13, 0), at(0, -7)) + line(at(13, 0), at(0, 7)) + line(at(18, -6), at(18, 6)), pull: 0 };
    default:
      return { markup: '', pull: 0 };
  }
}

function edgeMarkup(e: SceneEdge, theme: Theme): string {
  if (e.points.length < 2) return '';
  const color = e.color ? strokeOf(e.color, theme) : THEMES[theme].edge;
  let ps = e.points.map((p) => ({ ...p }));
  const first = ps[0]!;
  const last = ps[ps.length - 1]!;
  let control: Point | undefined;
  if (e.route === 'arc' && ps.length === 2) {
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    control = { x: (first.x + last.x) / 2 - dy * 0.2, y: (first.y + last.y) / 2 + dx * 0.2 };
  }
  const startFrom = control ?? ps[1]!;
  const endFrom = control ?? ps[ps.length - 2]!;
  const sm = markerMarkup(e.start, startFrom, first, color);
  const em = markerMarkup(e.end, endFrom, last, color);
  const pull = (tip: Point, from: Point, by: number): Point => {
    const l = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
    const k = Math.min(by, l / 2) / l;
    return { x: tip.x - (tip.x - from.x) * k, y: tip.y - (tip.y - from.y) * k };
  };
  ps[0] = pull(first, startFrom, sm.pull);
  ps[ps.length - 1] = pull(last, endFrom, em.pull);
  let d: string;
  if (control) d = `M${n(ps[0]!.x)} ${n(ps[0]!.y)}Q${n(control.x)} ${n(control.y)} ${n(ps[1]!.x)} ${n(ps[1]!.y)}`;
  else if (e.route === 'elbow') d = roundedPath(ps, 8);
  else d = `M${n(ps[0]!.x)} ${n(ps[0]!.y)}L${n(ps[ps.length - 1]!.x)} ${n(ps[ps.length - 1]!.y)}`;
  ps = [];
  const dash = e.dashed ? ' stroke-dasharray="6 5"' : '';
  return `<g data-edge="${esc(e.id)}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"${dash}/>${sm.markup}${em.markup}</g>`;
}

function lineMarkup(l: SceneLine, theme: Theme): string {
  const t = THEMES[theme];
  const dash = l.dashed ? ' stroke-dasharray="5 5"' : '';
  return `<polyline points="${pts(l.points)}" fill="none" stroke="${l.tone === 'muted' ? t.stroke : t.text}" stroke-width="1.25"${dash}/>`;
}

function itemMarkup(it: SceneItem, theme: Theme): string {
  switch (it.kind) {
    case 'box':
      return boxMarkup(it, theme);
    case 'text':
      return textMarkup(it, theme);
    case 'icon':
      return iconMarkup(it, theme);
    case 'edge':
      return edgeMarkup(it, theme);
    case 'line':
      return lineMarkup(it, theme);
  }
}

export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
  const theme = options.theme ?? 'light';
  const t = THEMES[theme];
  const bg = options.background ? `<rect width="${scene.width}" height="${scene.height}" fill="${t.background}"/>` : '';
  const body = scene.items.map((it) => itemMarkup(it, theme)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` +
    `font-family="${esc(FONT_FAMILY.clean)}" data-diagram="${scene.type}" data-theme="${theme}">${bg}${body}</svg>`
  );
}
