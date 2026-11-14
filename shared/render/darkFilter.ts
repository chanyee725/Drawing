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

const dot3 = (r: Vec, v: Vec): number => r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
const mul = (m: Mat, v: Vec): Vec => m.map((r) => dot3(r, v)) as Vec;
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
  const [r, g, b] = rgb.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as Vec;
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
      const b = rhs.map((x, r) => x - dot3(M[r]!, c));
      const x = solveLsq(free.map((j) => M.map((row) => row[j]!)), b);
      if (!x) continue;
      free.forEach((j, k) => (c[j] = x[k]!));
      if (c.some((v) => v < -1e-9 || v > 1 + 1e-9)) continue;
    }
    // The inside, when it fits, is exact: nothing can beat it.
    if (code === 0) return c.map(clamp01) as Vec;
    candidates.push(c.map(clamp01) as Vec);
  }
  // The exact solution clamped into the cube keeps greys grey, where the least-squares ones can tint them.
  const exact = solveLsq([0, 1, 2].map((j) => M.map((row) => row[j]!)), rhs);
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
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const a = cols.map((u) => cols.map((v) => dot(u, v)));
  const y = cols.map((u) => dot(u, b));
  // Gaussian elimination with partial pivoting on the n x n normal equations (n <= 3).
  const at = (r: number, k: number): number => a[r]![k]!;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(at(r, i)) > Math.abs(at(p, i))) p = r;
    if (Math.abs(at(p, i)) < 1e-12) return null;
    [a[i], a[p]] = [a[p]!, a[i]!];
    [y[i], y[p]] = [y[p]!, y[i]!];
    for (let r = i + 1; r < n; r++) {
      const f = at(r, i) / at(i, i);
      for (let k = i; k < n; k++) a[r]![k] = at(r, k) - f * at(i, k);
      y[r] = y[r]! - f * y[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i]!;
    for (let k = i + 1; k < n; k++) v -= at(i, k) * x[k]!;
    x[i] = v / at(i, i);
  }
  return x;
}

const hex2 = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0');

/** What the dark canvas shows where nothing is drawn: the filter over Excalidraw's white background (#121212). */
export const DARK_CANVAS_BACKGROUND = `#${applyDarkFilter([1, 1, 1]).map(hex2).join('')}`;

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
    const d = hex[1]!;
    const h = d.length === 3 ? [...d].map((x) => x + x).join('') : d;
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

/** The colour the dark canvas shows for `hex` once it is pre-filtered (preDarkFilterColor), as `#rrggbb`. */
export function darkCanvasSeen(hex: string): string {
  const painted = preDarkFilterColor(hex);
  const rgb = [1, 3, 5].map((i) => parseInt(painted.slice(i, i + 2), 16) / 255) as Vec;
  return `#${applyDarkFilter(rgb).map(hex2).join('')}`;
}

/** Whether the dark filter can show `rgb` exactly, with `margin` to spare on every painted channel. */
function inDarkReach(rgb: Vec, margin: number): boolean {
  const exact = solveLsq([0, 1, 2].map((j) => M.map((row) => row[j]!)), rgb.map((x) => x - INVERT));
  return !!exact && exact.every((x) => x >= margin && x <= 1 - margin);
}

/** OKLab back to sRGB (0..1, not clamped). */
function fromOklab([L, a, b]: Vec): Vec {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.sign(x) * Math.abs(x) ** (1 / 2.4) - 0.055)) as Vec;
}

/**
 * The colour nearest `hex` with the same hue (OKLCH) that the dark canvas can show as painted, and for which
 * `ok` holds; null when none does. Used for solid fills whose colour carries meaning (badges): the filter
 * cannot show saturated colours, and its nearest pick may change the hue (a yellow went pale green) or lose
 * the text contrast. A colour inside the reach looks the same on the dark canvas and in a dark export.
 */
export function inDarkReachNear(hex: string, ok: (hex: string) => boolean = () => true): string | null {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Vec;
  const [L0, a0, b0] = oklab(rgb);
  const C0 = Math.hypot(a0, b0);
  const h = Math.atan2(b0, a0);
  const at = (L: number, C: number): Vec => fromOklab([L, C * Math.cos(h), C * Math.sin(h)]);
  // Leave a little room so the hex rounding and the pre-filter rounding cannot push it out of reach.
  const fits = (v: Vec) => v.every((x) => x >= 0 && x <= 1) && inDarkReach(v, 0.004);
  let best: string | null = null;
  let bestErr = Infinity;
  for (let L = 0.2; L <= 0.95 + 1e-9; L += 0.005) {
    if (!fits(at(L, 0))) continue;
    // The most colourful in-reach colour at this lightness, no more colourful than the original.
    let lo = 0;
    let hi = C0;
    if (!fits(at(L, hi))) {
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (fits(at(L, mid))) lo = mid;
        else hi = mid;
      }
      hi = lo;
    }
    const out = `#${at(L, hi).map(hex2).join('')}`;
    if (!ok(out)) continue;
    // Colourfulness counts double, as in preDarkFilter: keep the colour name, give up some lightness.
    const err = (L - L0) ** 2 + 4 * (hi - C0) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = out;
    }
  }
  return best;
}
