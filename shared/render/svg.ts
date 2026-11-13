// Paint a Scene as a standalone SVG string. Deterministic: same scene + options → same bytes.
// No external references, no scripts. The one id (the edge-label mask) is derived from the content, so two
// pictures inlined on one page only share it when they are the same picture.
// Style tokens: docs/research/eraser/09-examples-style.md §2 (light measured, dark our proposal).

import { round } from './common.ts';
import { iconFor } from './icons.ts';
import { BADGE_FONT_SIZE, BADGE_FONT_WEIGHT } from './badge.ts';
import type { Point, Scene, SceneBadge, SceneBox, SceneEdge, SceneIcon, SceneItem, SceneLine, SceneText } from './scene.ts';
import { DRAWING_SANS_400_WOFF2_BASE64, DRAWING_SANS_600_WOFF2_BASE64 } from './font-clean.ts';
import { SHANTELL_SANS_WOFF2_BASE64 } from './font-rough.ts';
import { CLEAN_FONT_NAME, FONT_FAMILY, PLATE_PAD, linesWidth } from './text.ts';
import { THEMES, badgeColors, readableMuted, resolvePaint, strokeOf, strongTextOf } from './theme.ts';
import type { Theme, ThemeColors } from './theme.ts';

export interface SvgOptions {
  theme?: Theme;
  /** Fill the background with the theme colour (for export). Default: transparent. */
  background?: boolean;
  /**
   * Rewrite every paint colour (`#rrggbb` or `rgba(...)`) before it is written, e.g. to cancel a filter the
   * host puts over the picture. Not applied to the label mask, which is luminance, not colour.
   */
  mapColor?: (color: string) => string;
}

/** What every painter below needs: the theme, its colours and the colour rewrite. */
interface Ctx {
  theme: Theme;
  t: ThemeColors;
  c: (color: string) => string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number): string => String(round(v));
const pts = (ps: Point[]): string => ps.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

/** Corner radius per role; `null` = the node rule `min(12, 0.15 × the shorter side)` (§2.1). */
const RADIUS: Record<SceneBox['role'], number | null> = {
  node: null,
  group: 6,
  entity: 8,
  'entity-header': 8,
  column: null,
  activation: 2,
  frame: 6,
  legend: 6,
};
export const radiusOf = (b: Pick<SceneBox, 'role' | 'w' | 'h'>): number => RADIUS[b.role] ?? Math.min(12, 0.15 * Math.min(b.w, b.h));

/** Dash pattern shared by nodes, connectors and groups (§2.1). */
const DASH = ' stroke-dasharray="8 8.75"';
/** Line widths (§2.1): connectors 1.3, node borders 1.2, group borders 1. */
const EDGE_W = 1.3;
const BOX_W = 1.2;
const SOFT_W = 1;

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
      const ry = 0.11 * h;
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
        const r = radiusOf(b);
        return `<path d="M${n(x)} ${n(y + h)}V${n(y + r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}H${n(x + w - r)}Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}V${n(y + h)}Z"${attrs}/>`;
      }
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radiusOf(b))}"${attrs}/>`;
  }
}

function boxMarkup(b: SceneBox, { theme, t, c }: Ctx): string {
  const soft = b.role === 'group' || b.role === 'frame' || b.role === 'legend';
  const p = resolvePaint(b.paint, theme, soft, b.shadow);
  let fill = p.fill;
  let stroke = p.stroke;
  if (b.role === 'frame') fill = 'none';
  if (b.role === 'legend') {
    fill = t.fill;
    stroke = t.stroke;
  }
  if (b.role === 'activation') fill = b.paint.color ? p.fill : t.fill;
  const width = soft ? SOFT_W : BOX_W;
  const dash = b.dashed ? DASH : '';
  const out: string[] = [];
  // A solid copy of the shape moved (+4, +4), no blur; the opaque body on top hides all but the outside rim.
  if (b.shadow) out.push(shapeMarkup({ ...b, x: b.x + 4, y: b.y + 4 }, ` fill="${c(t.shadow)}" stroke="none"`));
  const f = fill === 'none' ? 'none' : c(fill);
  out.push(shapeMarkup(b, ` fill="${f}" stroke="${c(stroke)}" stroke-width="${width}" stroke-linejoin="round"${dash}`));
  const id = b.id !== undefined ? ` data-id="${esc(b.id)}"` : '';
  return `<g data-role="${b.role}"${id}>${out.join('')}</g>`;
}

/** The box an edge label cuts out of the lines under it: the label's own box, 1px larger on every side. */
function labelHole(tx: SceneText): { x: number; y: number; w: number; h: number } {
  const w = linesWidth(tx.lines, tx.size, tx.font, tx.weight === 600) + PLATE_PAD * 2;
  const h = tx.lines.length * tx.lineHeight + 4;
  const x0 = tx.anchor === 'start' ? tx.x - PLATE_PAD : tx.anchor === 'end' ? tx.x - w + PLATE_PAD : tx.x - w / 2;
  return { x: x0 - 1, y: tx.y - 3, w: w + 2, h: h + 2 };
}

function textMarkup(tx: SceneText, { theme, t, c }: Ctx): string {
  if (tx.lines.length === 0) return '';
  let fill = tx.tone === 'muted' ? t.muted : t.text;
  if (tx.on) {
    const p = resolvePaint(tx.on, theme);
    // Muted text (a node subtitle) stays grey on a pale fill, darkened just enough to read; bold fills use their contrast colour.
    fill = tx.tone === 'muted' && tx.on.mode !== 'bold' ? readableMuted(t.muted, t.text, p.fill === 'none' ? t.background : p.fill) : p.text;
  }
  if (tx.tone === 'group') fill = strongTextOf(tx.on?.color, theme);
  // Edge labels take the line colour and have no background: the line is cut under them instead (labelHole).
  if (tx.plate) fill = t.edge;
  if (tx.color) fill = strokeOf(tx.color, theme);
  const spans = tx.lines
    .map((line, i) => `<tspan x="${n(tx.x)}" y="${n(tx.y + i * tx.lineHeight + (tx.lineHeight - tx.size) / 2 + tx.size * 0.8)}">${esc(line)}</tspan>`)
    .join('');
  const weight = tx.weight === 600 ? ' font-weight="600"' : '';
  const family = tx.font === 'clean' ? '' : ` font-family="${esc(FONT_FAMILY[tx.font])}"`;
  return `<text font-size="${tx.size}"${weight}${family} fill="${c(fill)}" text-anchor="${tx.anchor}" xml:space="preserve">${spans}</text>`;
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

function iconMarkup(ic: SceneIcon, { theme, t, c }: Ctx): string {
  const icon = iconFor(ic.name);
  let color = ic.paint.color ? strokeOf(ic.paint.color, theme) : t.text;
  if (ic.inside && ic.paint.mode === 'bold') color = resolvePaint(ic.paint, theme).text;
  // Logos keep their brand colour unless a colour was asked for, they sit on a bold fill, or the
  // brand colour would vanish into the background (black logos on the dark theme).
  else if (icon.hex && !ic.paint.color && contrast(icon.hex, t.background) >= 3) color = icon.hex;
  const s = ic.size / 24;
  const open = `<g data-icon="${esc(ic.name)}" data-icon-set="${icon.set}" transform="translate(${n(ic.x)} ${n(ic.y)}) scale(${n(s)})">`;
  color = c(color);
  if (icon.fill) return `${open}<path d="${icon.d}" fill="${color}"/></g>`;
  const dash = icon.set === 'own' && icon.key === 'placeholder' ? ' stroke-dasharray="3 2.5"' : '';
  return (
    open +
    `<path d="${icon.d}" fill="none" stroke="${color}" stroke-width="${n(1.6 / Math.max(s, 0.5))}" stroke-linecap="round" stroke-linejoin="round"${dash}/></g>`
  );
}

/** Corner radius of elbow connectors (spec §1.7). */
export const BEND_RADIUS = 6;

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
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    // A right-angle corner is a circular arc (spec §1.7: `A6 6`); any other angle a quadratic curve.
    if (Math.abs(dot) < 1e-6 * l1 * l2) d += `L${n(p1.x)} ${n(p1.y)}A${n(r)} ${n(r)} 0 0 ${cross > 0 ? 1 : 0} ${n(p2.x)} ${n(p2.y)}`;
    else d += `L${n(p1.x)} ${n(p1.y)}Q${n(b.x)} ${n(b.y)} ${n(p2.x)} ${n(p2.y)}`;
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
  const line = (a: Point, b: Point): string => `<path d="M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" stroke="${color}" stroke-width="${EDGE_W}" fill="none"/>`;
  switch (kind) {
    case 'arrow': {
      // Open V, 12 long and 11 wide, in the line's colour and width (§2.1). Its mitred point is pulled 1px back so
      // it ends on the target's border, and the line stops there too.
      const back = 1;
      const a = at(12 + back, -5.5);
      const p = at(back, 0);
      const b = at(12 + back, 5.5);
      return {
        markup: `<path d="M${n(a.x)} ${n(a.y)}L${n(p.x)} ${n(p.y)}L${n(b.x)} ${n(b.y)}" fill="none" stroke="${color}" stroke-width="${EDGE_W}" stroke-linejoin="miter"/>`,
        pull: back + 0.5,
      };
    }
    case 'one':
      return { markup: line(at(9, -6), at(9, 6)) + line(at(14, -6), at(14, 6)), pull: 0 };
    case 'many':
      return { markup: line(at(13, 0), at(0, -7)) + line(at(13, 0), at(0, 7)) + line(at(18, -6), at(18, 6)), pull: 0 };
    default:
      return { markup: '', pull: 0 };
  }
}

/** Opacity of soft (straight-style) connectors: the same colour, lighter. */
const SOFT_EDGE_OPACITY = 0.55;

function edgeMarkup(e: SceneEdge, { theme, t, c }: Ctx, mask: string): string {
  if (e.points.length < 2) return '';
  const color = c(e.color ? strokeOf(e.color, theme) : t.edge);
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
  else if (e.route === 'elbow') d = roundedPath(ps, BEND_RADIUS);
  else d = `M${n(ps[0]!.x)} ${n(ps[0]!.y)}L${n(ps[ps.length - 1]!.x)} ${n(ps[ps.length - 1]!.y)}`;
  ps = [];
  const dash = e.dashed ? DASH : '';
  const soft = e.soft ? ` opacity="${SOFT_EDGE_OPACITY}"` : '';
  return `<g data-edge="${esc(e.id)}"${mask}${soft}><path d="${d}" fill="none" stroke="${color}" stroke-width="${EDGE_W}" stroke-linecap="butt" stroke-linejoin="miter"${dash}/>${sm.markup}${em.markup}</g>`;
}

function lineMarkup(l: SceneLine, { t, c }: Ctx): string {
  const dash = l.dashed ? DASH : '';
  return `<polyline points="${pts(l.points)}" fill="none" stroke="${c(l.tone === 'muted' ? t.edgeSoft : t.text)}" stroke-width="${n(l.width ?? SOFT_W)}"${dash}/>`;
}

/** A solid pill with its text centred (shared/render/badge.ts); dark fills stay in the dark filter's reach (§2.3). */
function badgeMarkup(b: SceneBadge, { c, theme }: Ctx): string {
  const { fill, text } = badgeColors(b.color, theme);
  const ty = b.y + b.h / 2 + BADGE_FONT_SIZE * 0.35;
  return (
    `<g data-badge="${esc(b.of)}"><rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${n(b.h / 2)}" fill="${c(fill)}"/>` +
    `<text x="${n(b.x + b.w / 2)}" y="${n(ty)}" font-size="${BADGE_FONT_SIZE}" font-weight="${BADGE_FONT_WEIGHT}" fill="${c(text)}" text-anchor="middle" xml:space="preserve">${esc(b.text)}</text></g>`
  );
}

function itemMarkup(it: SceneItem, ctx: Ctx, mask: string): string {
  switch (it.kind) {
    case 'box':
      return boxMarkup(it, ctx);
    case 'text':
      return textMarkup(it, ctx);
    case 'icon':
      return iconMarkup(it, ctx);
    case 'edge':
      return edgeMarkup(it, ctx, mask);
    case 'line':
      return lineMarkup(it, ctx);
    case 'badge':
      return badgeMarkup(it, ctx);
  }
}

/** FNV-1a, for an id that only another copy of the same picture shares. */
function hashOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const fontFace = (family: string, weight: number, base64: string) =>
  `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${base64}) format('woff2')}`;
const ROUGH_FONT_FACE = fontFace('Shantell Sans', 400, SHANTELL_SANS_WOFF2_BASE64);
const CLEAN_FONT_FACE = fontFace(CLEAN_FONT_NAME, 400, DRAWING_SANS_400_WOFF2_BASE64);
const CLEAN_BOLD_FONT_FACE = fontFace(CLEAN_FONT_NAME, 600, DRAWING_SANS_600_WOFF2_BASE64);
// Text in the clean face inherits the root font-family; rough and mono text name their own.
const CLEAN_TEXT = /<text (?![^>]*\sfont-family=)(?![^>]*\sfont-weight="600")/;
const CLEAN_BOLD_TEXT = /<text (?![^>]*\sfont-family=)[^>]*\sfont-weight="600"/;

export function sceneToSvg(scene: Scene, options: SvgOptions = {}): string {
  const theme = options.theme ?? 'light';
  const t = THEMES[theme];
  const ctx: Ctx = { theme, t, c: options.mapColor ?? ((x) => x) };
  // Edge labels cut the lines under them (§2.1): one luminance mask, white everywhere, black under each label.
  const holes = scene.items.flatMap((it) => (it.kind === 'text' && it.plate && it.lines.length > 0 ? [labelHole(it)] : []));
  let defs = '';
  let mask = '';
  if (holes.length) {
    const cut = holes.map((r) => `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" fill="#000"/>`).join('');
    const body = `<rect width="${scene.width}" height="${scene.height}" fill="#fff"/>${cut}`;
    const id = `label-cut-${hashOf(`${scene.width}x${scene.height}${body}${scene.items.length}`)}`;
    defs = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${scene.width}" height="${scene.height}">${body}</mask></defs>`;
    mask = ` mask="url(#${id})"`;
  }
  const bg = options.background ? `<rect width="${scene.width}" height="${scene.height}" fill="${ctx.c(t.background)}"/>` : '';
  const body = scene.items.map((it) => itemMarkup(it, ctx, mask)).join('');
  // An SVG shown as an <img> or exported cannot see page fonts, so the faces it uses travel inside it (Latin only).
  const usesRough = scene.items.some((it) => it.kind === 'text' && it.font === 'rough' && it.lines.length > 0);
  const faces = [
    usesRough ? ROUGH_FONT_FACE : '',
    CLEAN_TEXT.test(body) ? CLEAN_FONT_FACE : '',
    CLEAN_BOLD_TEXT.test(body) ? CLEAN_BOLD_FONT_FACE : '',
  ].join('');
  const style = faces ? `<style>${faces}</style>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" ` +
    `font-family="${esc(FONT_FAMILY.clean)}" letter-spacing="-0.01em" data-diagram="${scene.type}" data-theme="${theme}">${style}${defs}${bg}${body}</svg>`
  );
}
