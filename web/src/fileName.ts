/** Strip a typed `.dpx` or `.dpx.json` suffix; the server adds `.dpx.json` itself. */
export function fileStem(name: string): string {
  return name.trim().replace(/\.dpx(\.json)?$/i, '');
}
