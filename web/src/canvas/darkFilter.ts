// Excalidraw's dark mode puts `invert(93%) hue-rotate(180deg)` over the whole canvas, images included (and over
// dark exports). A dark picture drawn on that canvas is therefore painted in colours that the filter turns back into
// the dark palette: C = (0.93 - H^-1 T) / 0.86, with H the hue-rotate(180deg) matrix and T the wanted colour. The
// filter works on sRGB values (Filter Effects §13.1, §13.2). It cannot make every colour (nothing darker than 7% grey,
// and less saturation than sRGB has); for those the nearest colour it can make is used.
/** The CSS filter Excalidraw uses for its dark theme (`THEME_FILTER` in Excalidraw). */
export const DARK_FILTER = 'invert(93%) hue-rotate(180deg)';
const INVERT = 0.93;

type Vec = [number, number, number];
type Mat = [Vec, Vec, Vec];

/** The hue-rotate matrix of Filter Effects §13.2 for `deg`. */
function hueRotate(deg: number): Mat {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
    [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
    [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
  ];
}

const mul = (m: Mat, v: Vec): Vec => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as Vec;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const H = hueRotate(180);

/** What the dark filter makes of an sRGB colour (channels 0..1). Each filter step clamps, like the browser. */
export function applyDarkFilter(rgb: Vec): Vec {
  const inverted = rgb.map((x) => INVERT + (1 - 2 * INVERT) * clamp01(x)) as Vec;
  return mul(H, inverted).map(clamp01) as Vec;
}

const M: Mat = H.map((r) => r.map((x) => (1 - 2 * INVERT) * x)) as Mat;
const dist2 = (a: Vec, b: Vec) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** sRGB (0..1) to OKLab, to judge how far apart two colours look. */
function oklab(rgb: Vec): Vec {
  const [r, g, b] = rgb.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675778 * s];
}

/**
 * The sRGB colour (channels 0..1) that the dark filter turns into `rgb`. When no paintable colour gets there exactly,
 * the one whose filtered colour looks nearest (OKLab) among: the least-squares solution on each face, edge and corner
 * of the unit cube (the filtered colour is affine in the painted one, F(C) = INVERT - 0.86 H C), and the exact
 * solution clamped. Clamping alone washes out saturated colours (a yellow went pale); least squares alone tints greys.
 */
export function preDarkFilter(rgb: Vec): Vec {
  const want = rgb.map(clamp01) as Vec;
  // F(C) = want  <=>  M C = want - INVERT, with M = -0.86 H.
  const rhs = want.map((x) => x - INVERT) as Vec;
  const target = oklab(want);
  const candidates: Vec[] = [];
  for (let code = 0; code < 27; code++) {
    // Per channel: 0 = free, 1 = fixed at 0, 2 = fixed at 1.
    const fix = [code % 3, Math.floor(code / 3) % 3, Math.floor(code / 9)];
    const free = [0, 1, 2].filter((i) => fix[i] === 0);
    const c: Vec = fix.map((f) => (f === 2 ? 1 : 0)) as Vec;
    if (free.length) {
      // Least squares for the free channels: (A^T A) x = A^T b, A = the free columns of M, b = rhs minus the fixed ones.
      const b = rhs.map((x, r) => x - M[r][0] * c[0] - M[r][1] * c[1] - M[r][2] * c[2]);
      const x = solveLsq(free.map((j) => M.map((row) => row[j])), b);
      if (!x) continue;
      free.forEach((j, k) => (c[j] = x[k]));
      if (c.some((v) => v < -1e-9 || v > 1 + 1e-9)) continue;
    }
    // The inside, when it fits, is exact: nothing can beat it.
    if (code === 0) return c.map(clamp01) as Vec;
    candidates.push(c.map(clamp01) as Vec);
  }
  // The exact solution clamped into the cube keeps greys grey, where the least-squares ones can tint them.
  const exact = solveLsq([0, 1, 2].map((j) => M.map((row) => row[j])), rhs);
  if (exact) candidates.push(exact.map(clamp01) as Vec);
  // Pick the one that looks nearest after the filter (OKLab), not the nearest in raw sRGB numbers.
  let best: Vec = [0, 0, 0];
  let bestErr = Infinity;
  for (const c of candidates) {
    const got = oklab(applyDarkFilter(c));
    // Hue and colourfulness count double: a block keeps its colour name a little darker rather than turn another colour.
    const err = (got[0] - target[0]) ** 2 + 4 * ((got[1] - target[1]) ** 2 + (got[2] - target[2]) ** 2);
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return best;
}

/** Least squares for the columns `cols` (each a column of the 3-row matrix) against `b`; null when singular. */
function solveLsq(cols: number[][], b: number[]): number[] | null {
  const n = cols.length;
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const a = cols.map((u) => cols.map((v) => dot(u, v)));
  const y = cols.map((u) => dot(u, b));
  // Gaussian elimination with partial pivoting on the n x n normal equations (n <= 3).
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-12) return null;
    [a[i], a[p]] = [a[p], a[i]];
    [y[i], y[p]] = [y[p], y[i]];
    for (let r = i + 1; r < n; r++) {
      const f = a[r][i] / a[i][i];
      for (let k = i; k < n; k++) a[r][k] -= f * a[i][k];
      y[r] -= f * y[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i];
    for (let k = i + 1; k < n; k++) v -= a[i][k] * x[k];
    x[i] = v / a[i][i];
  }
  return x;
}

const hex2 = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');

/**
 * `color` (`#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)`) rewritten so the dark filter shows it as given.
 * Alpha is kept: the filter is affine per pixel, so a translucent fill over a pre-filtered background blends right.
 * Anything else (`none`, `currentColor`, a name) is returned unchanged.
 */
export function preDarkFilterColor(color: string): string {
  const s = color.trim();
  let rgb: Vec | null = null;
  let alpha: string | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Vec;
  } else {
    const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/i.exec(s);
    if (fn) {
      rgb = [fn[1], fn[2], fn[3]].map((x) => Number(x) / 255) as Vec;
      alpha = fn[4] ?? null;
    }
  }
  if (!rgb) return color;
  const out = preDarkFilter(rgb);
  if (alpha === null) return `#${out.map(hex2).join('')}`;
  return `rgba(${out.map((x) => Math.round(x * 255)).join(',')},${alpha})`;
}
