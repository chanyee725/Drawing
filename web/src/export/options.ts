// Image export options: PNG scale, transparent background, light or dark. Pure helpers, so they are unit tested.
export type ExportScale = 1 | 2 | 3;
export type ExportOptions = { scale: ExportScale; transparent: boolean; dark: boolean };

export const SCALES: readonly ExportScale[] = [1, 2, 3];
export const DEFAULT_EXPORT: ExportOptions = { scale: 2, transparent: false, dark: false };

const LIGHT_BG = '#ffffff';
const DARK_BG = '#18181b';

/** Fill in anything missing or invalid with the defaults. */
export function normalizeExport(o: Partial<ExportOptions> | null | undefined): ExportOptions {
  const scale = SCALES.includes(o?.scale as ExportScale) ? (o!.scale as ExportScale) : DEFAULT_EXPORT.scale;
  return { scale, transparent: o?.transparent === true, dark: o?.dark === true };
}

/** The solid background color to paint, or null for a transparent export. */
export const exportBackground = (o: ExportOptions): string | null => (o.transparent ? null : o.dark ? DARK_BG : LIGHT_BG);

/** File name suffix for non-default choices: `@2x` is the unmarked default, `@3x`, `-dark`, `-transparent` are added. */
export function exportSuffix(o: ExportOptions, kind: 'png' | 'svg'): string {
  let s = '';
  if (kind === 'png' && o.scale !== DEFAULT_EXPORT.scale) s += `@${o.scale}x`;
  if (o.dark) s += '-dark';
  if (o.transparent) s += '-transparent';
  return s;
}

/** Short Korean summary for the menu hint, e.g. `2배 · 투명 · 다크`. */
export function describeExport(o: ExportOptions): string {
  return [`${o.scale}배`, o.dark ? '다크' : '라이트', o.transparent ? '투명 배경' : '배경 있음'].join(' · ');
}
