// Colour resolution. Light values follow the measured diagram style (docs/research/eraser/09-examples-style.md
// §2.1–§2.2); dark values are our own proposal (§2.3): the light "pale fill + strong border" pair turned around,
// drawn directly in the dark palette instead of inverting the light picture.

import type { Paint } from './scene.ts';
import { inDarkReachNear } from './darkFilter.ts';

export type Theme = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  /** Neutral node border (`styleMode plain`) and the border of a node that casts a shadow. */
  stroke: string;
  strongStroke: string;
  fill: string;
  /** Neutral group box: translucent fill, hairline border, title colour. */
  groupFill: string;
  groupStroke: string;
  groupText: string;
  /** Connector colour; labels take the line colour. */
  edge: string;
  /** Flowchart connector colour: near-black in light, the text colour in dark (brighter than node borders). */
  flowEdge: string;
  /** Lighter line (sequence lifelines, dividers). */
  edgeSoft: string;
  /** Solid offset shadow, no blur. */
  shadow: string;
  /**
   * Sequence look that differs from the other diagrams (§2.4), dark only: participant boxes are flat (no offset
   * shadow), filled with `background` and outlined with `columnStroke`, and message labels take `label` instead
   * of the line colour.
   */
  sequence?: { columnStroke: string; label: string };
}

export const THEMES: Record<Theme, ThemeColors> = {
  light: {
    background: '#ffffff',
    text: '#242424',
    muted: '#6b7280',
    stroke: '#d0d5dd',
    strongStroke: '#242424',
    fill: '#ffffff',
    groupFill: 'rgba(242,244,247,0.5)',
    groupStroke: '#eaecf0',
    groupText: '#475467',
    edge: '#667085',
    flowEdge: '#1c1c1c',
    edgeSoft: '#98a2b3',
    shadow: '#e8e8e8',
  },
  dark: {
    background: '#17191d',
    text: '#e7e9ec',
    muted: '#98a2b3',
    stroke: '#3a3f47',
    strongStroke: '#c9cdd3',
    fill: '#1f2228',
    groupFill: 'rgba(255,255,255,0.04)',
    groupStroke: '#2e3239',
    groupText: '#a7afbb',
    edge: '#8d96a5',
    flowEdge: '#e7e9ec',
    edgeSoft: '#5b6370',
    shadow: '#2b2f36',
    // Measured on the reference: the box fill is the background, so the border alone marks the box. It reads
    // 11.19:1 on the background (non-text contrast needs 3:1); the label is the text colour.
    sequence: { columnStroke: '#cfcecc', label: '#e7e9ec' },
  },
};

/** Per DSL colour name: light [fill, border, strong text], dark [border, strong text]. Dark fills mix the border in. */
interface Named {
  light: [string, string, string];
  dark: [string, string];
}

const NAMED: Record<string, Named> = {
  blue: { light: ['#eff8ff', '#2e90fa', '#1849a9'], dark: ['#53b1fd', '#84caff'] },
  indigo: { light: ['#eef4ff', '#444ce7', '#3538cd'], dark: ['#8098f9', '#a4bcfd'] },
  green: { light: ['#ecfdf3', '#079455', '#085d3a'], dark: ['#47cd89', '#75e0a7'] },
  red: { light: ['#fef3f2', '#d92d20', '#b42318'], dark: ['#f97066', '#fda29b'] },
  orange: { light: ['#fffaeb', '#dc6803', '#b54708'], dark: ['#fdb022', '#fec84b'] },
  yellow: { light: ['#fffaeb', '#fdb022', '#b54708'], dark: ['#fec84b', '#fedf89'] },
  purple: { light: ['#f4f3ff', '#6938ef', '#5925dc'], dark: ['#9b8afb', '#bdb4fe'] },
  pink: { light: ['#fdf2fa', '#dd2590', '#c11574'], dark: ['#f670c7', '#faa7e0'] },
  teal: { light: ['#f0fdf9', '#15b79e', '#107569'], dark: ['#2ed3b7', '#5fe9d0'] },
  cyan: { light: ['#ecfdff', '#06aed4', '#0e7090'], dark: ['#22ccee', '#67e3f9'] },
  gray: { light: ['#f2f4f7', '#98a2b3', '#475467'], dark: ['#98a2b3', '#d0d5dd'] },
  grey: { light: ['#f2f4f7', '#98a2b3', '#475467'], dark: ['#98a2b3', '#d0d5dd'] },
  black: { light: ['#f2f4f7', '#242424', '#101828'], dark: ['#c9cdd3', '#e7e9ec'] },
  white: { light: ['#ffffff', '#d0d5dd', '#242424'], dark: ['#e7e9ec', '#f2f4f7'] },
  brown: { light: ['#faf5f0', '#8d6342', '#6f4c32'], dark: ['#c09a78', '#dcc2aa'] },
};

/** Dark fills: the border colour mixed 14% over the background (§2.3). */
const DARK_FILL = 0.14;

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

const namedOf = (color: string): Named | undefined => (Object.hasOwn(NAMED, color) ? NAMED[color] : undefined);

export function strokeOf(color: string | undefined, theme: Theme): string {
  const t = THEMES[theme];
  if (!color) return t.stroke;
  const named = namedOf(color);
  if (named) return theme === 'light' ? named.light[1] : named.dark[0];
  return color;
}

/** Strong text in a colour (group titles): the palette's dark shade, or the colour itself for a hex. */
export function strongTextOf(color: string | undefined, theme: Theme): string {
  if (!color) return THEMES[theme].groupText;
  const named = namedOf(color);
  if (named) return theme === 'light' ? named.light[2] : named.dark[1];
  return color;
}

/** Pastel fill of a colour: the palette's pale fill (light) or the border mixed over the background. */
function pastelOf(color: string, theme: Theme): string {
  const named = namedOf(color);
  if (named && theme === 'light') return named.light[0];
  return mix(strokeOf(color, theme), THEMES[theme].background, theme === 'light' ? 0.1 : DARK_FILL);
}

const rgba = (hex: string, a: number): string => `rgba(${hexToRgb(hex).join(',')},${a})`;

export interface ResolvedPaint {
  fill: string;
  stroke: string;
  text: string;
}

/**
 * Fill, stroke and text colour for a box. `soft` boxes (groups, frames) get a translucent tint and a hairline
 * border; `shadow` boxes without a colour get the strong border that goes with the offset shadow.
 */
export function resolvePaint(paint: Paint, theme: Theme, soft = false, shadow = false): ResolvedPaint {
  const t = THEMES[theme];
  const stroke = paint.color ? strokeOf(paint.color, theme) : soft ? t.groupStroke : shadow ? t.strongStroke : t.stroke;
  if (paint.mode === 'outline') return { fill: 'none', stroke, text: t.text };
  if (!paint.color) {
    if (paint.mode === 'bold' && !soft) return { fill: t.groupText, stroke: t.groupText, text: contrastText(t.groupText) };
    return { fill: soft ? t.groupFill : t.fill, stroke, text: t.text };
  }
  if (paint.mode === 'bold' && !soft) return { fill: stroke, stroke, text: contrastText(stroke) };
  if (soft) return { fill: rgba(stroke, theme === 'light' ? 0.08 : 0.1), stroke, text: t.text };
  return { fill: paint.mode === 'bold' ? mix(stroke, t.background, 0.3) : pastelOf(paint.color, theme), stroke, text: t.text };
}
/** WCAG contrast ratio of two `#rrggbb` colours. */
const ratioOf = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * Badge chip colours (§2.1, §2.3). A palette name fills with its light border shade (Eraser's `#444CE7`,
 * `#D92D20`, ...) and white text; when white would read under 4.5:1 on it (orange, green, blue, gray), the
 * palette's darker text shade fills instead. A hex fills as written, with white or dark text, whichever reads
 * better. No colour: indigo.
 *
 * Dark: the dark canvas paints every colour through Excalidraw's filter (shared/render/darkFilter.ts), which
 * cannot show these saturated fills; its nearest pick turned red orange and a yellow pale green, and white text
 * fell to 3.6:1 (#244). So the dark fill is the nearest colour of the same hue the filter can show, still at
 * 4.5:1 or better against the text as the canvas shows it (white comes out #ededed). A dark export uses the same
 * colours, so both look alike.
 */
export function badgeColors(color: string | undefined, theme: Theme = 'light'): { fill: string; text: string } {
  const light = lightBadge(color);
  if (theme === 'light') return light;
  const cached = darkBadges.get(light.fill);
  if (cached) return cached;
  const texts = light.text === '#ffffff' ? [DARK_BADGE_WHITE, DARK_BADGE_INK] : [DARK_BADGE_INK, DARK_BADGE_WHITE];
  let out: { fill: string; text: string } | undefined;
  for (const text of texts) {
    const fill = inDarkReachNear(light.fill, (f) => ratioOf(f, text) >= 4.5);
    if (fill) {
      out = { fill, text };
      break;
    }
  }
  // Every hue reaches 4.5:1 against one of the two texts; this is only a guard.
  out ??= { fill: '#3a3f47', text: DARK_BADGE_WHITE };
  darkBadges.set(light.fill, out);
  return out;
}

/** White and dark badge text as the dark canvas shows them (the filter's lightest grey is #ededed). */
const DARK_BADGE_WHITE = '#ededed';
const DARK_BADGE_INK = '#1f2329';
const darkBadges = new Map<string, { fill: string; text: string }>();

function lightBadge(color: string | undefined): { fill: string; text: string } {
  const named = namedOf(color ?? 'indigo');
  if (named) {
    const [, border, strong] = named.light;
    return { fill: ratioOf(border, '#ffffff') >= 4.5 ? border : strong, text: '#ffffff' };
  }
  const hex = color!.length === 4 ? toHex(hexToRgb(color!)) : color!;
  return { fill: hex, text: contrastText(hex) };
}

/**
 * Muted text (a subtitle) on `fill`: `muted` itself when it reads at 4.5:1 or better, otherwise moved toward
 * `text` in 10% steps until it does. Pale tinted fills need a slightly darker grey than white does.
 */
export function readableMuted(muted: string, text: string, fill: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return muted;
  const ratio = (a: string): number => {
    const [x, y] = [luminance(a), luminance(fill)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (let k = 0; k <= 10; k++) {
    const c = k === 0 ? muted : mix(text, muted, k / 10);
    if (ratio(c) >= 4.5) return c;
  }
  return text;
}

/** Dark or white text, whichever reads better on `fill` (luminance midpoint is not enough for mid-tone fills). */
function contrastText(fill: string): string {
  const l = luminance(fill);
  const dark = luminance('#1f2329');
  const onDark = (l + 0.05) / (dark + 0.05);
  const onWhite = 1.05 / (l + 0.05);
  return onDark >= onWhite ? '#1f2329' : '#ffffff';
}
