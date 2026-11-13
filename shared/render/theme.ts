// Colour resolution. Our own palette (not Eraser's values): named colours from the DSL map to a
// stroke/fill pair per theme; hex colours are mixed with the theme background.

import type { Paint } from './scene.ts';

export type Theme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  /** Neutral node stroke and fill. */
  stroke: string;
  fill: string;
  /** Group box fill when uncoloured. */
  groupFill: string;
  edge: string;
  shadow: string;
  plate: string;
  /** Hairline around an edge label's pill. */
  plateStroke: string;
}

export const THEMES: Record<Theme, ThemeColors> = {
  light: {
    background: '#ffffff',
    text: '#1f2329',
    muted: '#6b7280',
    stroke: '#8a919c',
    fill: '#ffffff',
    groupFill: '#f6f7f9',
    edge: '#7b828d',
    shadow: 'rgba(15,23,42,0.10)',
    plate: '#ffffff',
    plateStroke: '#e3e6ea',
  },
  dark: {
    background: '#17191d',
    text: '#e7e9ec',
    muted: '#9aa1ab',
    stroke: '#6d7480',
    fill: '#23262c',
    groupFill: '#1d2025',
    edge: '#9198a3',
    shadow: 'rgba(0,0,0,0.45)',
    plate: '#17191d',
    plateStroke: '#2e3239',
  },
};

/** Base hue per DSL colour name: [light stroke, dark stroke]. */
const NAMED: Record<string, [string, string]> = {
  blue: ['#3d7be0', '#6fa0f0'],
  green: ['#2f9e5b', '#5cc486'],
  red: ['#d9434b', '#ef7a80'],
  orange: ['#e2731f', '#f39a55'],
  yellow: ['#c9a00c', '#e5c44a'],
  purple: ['#8a52d6', '#ad86ec'],
  pink: ['#d4478f', '#ec7fb5'],
  teal: ['#1f9a9a', '#4fc4c4'],
  cyan: ['#1b98c4', '#58bfe3'],
  gray: ['#7b828d', '#9aa1ab'],
  grey: ['#7b828d', '#9aa1ab'],
  black: ['#2a2e35', '#c9cdd3'],
  white: ['#a3a9b2', '#e7e9ec'],
  brown: ['#8d6342', '#b78d6a'],
};

/** Palette color names, for editor completion. */
export const NAMED_COLOR_NAMES: readonly string[] = Object.keys(NAMED);

/** Accept only palette names and `#rgb`/`#rrggbb`. Anything else becomes neutral (and can't inject markup). */
export function sanitizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (Object.hasOwn(NAMED, v)) return v;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) return v;
  return undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const toHex = (rgb: number[]): string => '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** `amount` of `a` over `b`. */
function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex(x.map((c, i) => c * amount + y[i]! * (1 - amount)));
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function strokeOf(color: string | undefined, theme: Theme): string {
  const t = THEMES[theme];
  if (!color) return t.stroke;
  const named = (Object.hasOwn(NAMED, color) ? NAMED[color] : undefined);
  if (named) return theme === 'light' ? named[0] : named[1];
  return color;
}

export interface ResolvedPaint {
  fill: string;
  stroke: string;
  text: string;
}

/** Fill, stroke and text colour for a box. `soft` boxes (groups, frames) get a lighter tint. */
export function resolvePaint(paint: Paint, theme: Theme, soft = false): ResolvedPaint {
  const t = THEMES[theme];
  const stroke = strokeOf(paint.color, theme);
  if (paint.mode === 'outline') return { fill: 'none', stroke, text: t.text };
  if (!paint.color) {
    if (paint.mode === 'bold') return { fill: t.stroke, stroke: t.stroke, text: contrastText(t.stroke) };
    return { fill: soft ? t.groupFill : t.fill, stroke, text: t.text };
  }
  if (paint.mode === 'bold' && !soft) return { fill: stroke, stroke, text: contrastText(stroke) };
  const amount = theme === 'light' ? (soft ? 0.07 : 0.16) : soft ? 0.12 : 0.24;
  return { fill: mix(stroke, t.background, paint.mode === 'bold' ? amount * 2 : amount), stroke, text: t.text };
}

/** Dark or white text, whichever reads better on `fill` (luminance midpoint is not enough for mid-tone fills). */
function contrastText(fill: string): string {
  const l = luminance(fill);
  const dark = luminance('#1f2329');
  const onDark = (l + 0.05) / (dark + 0.05);
  const onWhite = 1.05 / (l + 0.05);
  return onDark >= onWhite ? '#1f2329' : '#ffffff';
}
