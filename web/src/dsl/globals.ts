// Global style lines of the Eraser-compatible DSL (`colorMode bold`, `direction right`, ...):
// read them from the code and write a changed value back as a code edit.
// A line counts only at the top level (outside `{ }`) and outside `//` comments.

export type PropOption = { value: string; label: string };
export type PropDef = { key: string; label: string; options: PropOption[]; types: string[] };

const GRAPH = ['architecture', 'flowchart'];
const ALL = ['architecture', 'flowchart', 'sequence', 'erd'];

/** First option of each property is the DSL default (see docs/research/eraser/02 attribute table). */
export const PROPS: PropDef[] = [
  { key: 'direction', label: '방향', types: GRAPH, options: [{ value: 'down', label: '아래' }, { value: 'up', label: '위' }, { value: 'left', label: '왼쪽' }, { value: 'right', label: '오른쪽' }] },
  { key: 'colorMode', label: '색 모드', types: ALL, options: [{ value: 'pastel', label: '파스텔' }, { value: 'bold', label: '진하게' }, { value: 'outline', label: '윤곽선' }] },
  { key: 'styleMode', label: '스타일', types: ALL, options: [{ value: 'shadow', label: '그림자' }, { value: 'plain', label: '단순' }, { value: 'watercolor', label: '수채화' }] },
  { key: 'typeface', label: '글꼴', types: ALL, options: [{ value: 'rough', label: '손글씨' }, { value: 'clean', label: '깔끔' }, { value: 'mono', label: '고정폭' }] },
  { key: 'textSize', label: '글자 크기', types: ALL, options: [{ value: 'small', label: '작게' }, { value: 'medium', label: '보통' }, { value: 'large', label: '크게' }] },
  { key: 'connectorStyle', label: '연결선', types: GRAPH, options: [{ value: 'elbow', label: '꺾은선' }, { value: 'straight', label: '직선' }, { value: 'arc', label: '곡선' }] },
];

/** Defaults the parser/renderer assume when a line is absent. direction's default depends on the type. */
export const defaultFor = (def: PropDef, type: string): string =>
  def.key === 'direction' ? (type === 'flowchart' ? 'down' : 'right') : def.options[0]!.value;

export const propsFor = (type: string): PropDef[] => PROPS.filter((p) => p.types.includes(type));

const lineRe = (key: string) => new RegExp(`^(\\s*)${key}(\\s*:\\s*|\\s+)(\\S+)\\s*$`);

/** Strip a trailing `//` comment (outside quotes) and count the net `{ }` depth change of the rest. */
function scanLine(raw: string): { code: string; delta: number } {
  let quote = '';
  let delta = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '/' && raw[i + 1] === '/') return { code: raw.slice(0, i), delta };
    else if (ch === '{') delta++;
    else if (ch === '}') delta--;
  }
  return { code: raw, delta };
}

const splitLines = (code: string) => code.split(/\r?\n/);
const eolOf = (code: string) => (/\r\n/.test(code) ? '\r\n' : '\n');

/** Line indexes of top-level global lines for `key`. */
function findLines(lines: string[], key: string): number[] {
  const re = lineRe(key);
  const out: number[] = [];
  let depth = 0;
  lines.forEach((raw, i) => {
    const { code, delta } = scanLine(raw);
    if (depth === 0 && re.test(code)) out.push(i);
    depth = Math.max(0, depth + delta);
  });
  return out;
}

/** Value of the last global line for `key`, or null when the code has none. */
export function readGlobal(code: string, key: string): string | null {
  const lines = splitLines(code);
  const found = findLines(lines, key);
  if (found.length === 0) return null;
  const v = lineRe(key).exec(scanLine(lines[found[found.length - 1]!]!).code)![3]!;
  // The parser accepts a quoted value (`typeface "mono"`); the picker shows the bare one.
  return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
}

/** Index to insert a new global line: after leading `title` / comment lines. */
function insertIndex(lines: string[]): number {
  let i = 0;
  while (i < lines.length && /^\s*(title(\s*:\s*|\s+)\S.*|\/\/.*)$/.test(lines[i]!) && lines[i]!.trim() !== '') i++;
  return i;
}

/**
 * Return `code` with global `key` set to `value`. `value` null removes the line(s).
 * A single existing line keeps its position and spacing. A global line only affects elements after it,
 * so duplicates are all removed and one line goes below the title. Line endings (LF/CRLF) are kept.
 */
export function writeGlobal(code: string, key: string, value: string | null): string {
  const eol = eolOf(code);
  const lines = splitLines(code);
  const found = findLines(lines, key);
  if (value === null) {
    return found.length === 0 ? code : lines.filter((_, i) => !found.includes(i)).join(eol);
  }
  if (found.length === 1) {
    const i = found[0]!;
    const { code: body } = scanLine(lines[i]!);
    const m = lineRe(key).exec(body)!;
    // Keep a trailing `// comment` (and the spacing before it) as the user wrote it.
    const comment = lines[i]!.slice(body.length);
    const gap = comment ? (/\s*$/.exec(body)![0] || ' ') : '';
    lines[i] = `${m[1]}${key}${m[2]}${value}${gap}${comment}`;
    return lines.join(eol);
  }
  const rest = lines.filter((_, i) => !found.includes(i));
  rest.splice(insertIndex(rest), 0, `${key} ${value}`);
  return rest.join(eol);
}
