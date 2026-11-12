// Autocomplete for the `[ ... ]` attribute lists of the diagram DSL (docs/research/eraser/02 §2).
// `attributeCompletions` is pure (line text in, options out) so it can be tested without a DOM.
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { ENUMS, GRAPH_KEYS, SEQUENCE_KEYS, ERD_KEYS, LEGEND_KEYS } from '../../../shared/dsl/common.ts';
import { LUCIDE_ICONS, SIMPLE_ICONS } from '../../../shared/render/icon-data.ts';
import { NAMED_COLOR_NAMES } from '../../../shared/render/theme.ts';

/**
 * Icon names offered in `[icon: ...]`: the bundled Lucide icons and Simple Icons logos, plus common
 * cloud-vendor names that map to a generic Lucide icon (no vendor artwork is bundled).
 */
export const ICON_NAMES: readonly string[] = [
  ...new Set([
    ...LUCIDE_ICONS.keys(),
    ...SIMPLE_ICONS.keys(),
    'aws-ec2', 'aws-lambda', 'aws-s3', 'aws-rds', 'aws-dynamodb', 'aws-sqs', 'aws-sns', 'aws-elb', 'aws-cloudfront',
    'aws-route53', 'aws-vpc', 'aws-iam', 'aws-eks', 'aws-ecs', 'aws-api-gateway',
    'gcp-compute-engine', 'gcp-cloud-sql', 'gcp-cloud-storage', 'gcp-pubsub', 'gcp-bigquery', 'gcp-gke',
    'azure-vm', 'azure-sql', 'azure-storage', 'azure-functions', 'azure-aks',
  ]),
];

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'left', 'right'];
const CONNECTIONS = ['>', '<', '<>', '-', '--', '-->', '<--', '<-->'];

const VALUES: Record<string, readonly string[]> = {
  ...ENUMS,
  icon: ICON_NAMES,
  color: NAMED_COLOR_NAMES,
  position: POSITIONS,
  connection: CONNECTIONS,
};

const KEY_DETAIL: Record<string, string> = {
  icon: '아이콘', color: '색', label: '라벨', link: '링크', shape: '모양', colorMode: '색 모드', styleMode: '스타일 모드',
  typeface: '글꼴', textSize: '글자 크기', wrap: '줄바꿈', connectorStyle: '연결선 모양', connection: '연결선', position: '위치',
};

const keysFor = (type: string, legend: boolean): string[] => {
  if (legend) return [...LEGEND_KEYS];
  const set = type === 'sequence' ? SEQUENCE_KEYS : type === 'erd' ? ERD_KEYS : GRAPH_KEYS;
  return [...set];
};

/** True when `text` ends inside an unclosed `legend ... {` block (braces in strings and comments are ignored). */
export function insideLegendBlock(text: string): boolean {
  const re = /\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|[{}]|\blegend\b/g;
  let depth = 0;
  let legendDepth = -1;
  let pendingLegend = false;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (tok === 'legend') pendingLegend = true;
    else if (tok === '{') {
      if (pendingLegend && legendDepth < 0) legendDepth = depth;
      pendingLegend = false;
      depth++;
    } else if (tok === '}') {
      depth = Math.max(0, depth - 1);
      if (legendDepth >= 0 && depth <= legendDepth) legendDepth = -1;
    }
  }
  return legendDepth >= 0;
}

export type AttrCompletion = { from: number; options: Completion[] };

/**
 * Completions for the cursor at the end of `before` (the current line up to the cursor).
 * `above` is the document text before the current line; with it, item lines inside a multi-line
 * `legend { ... }` get the legend keys. Returns null outside a `[ ... ]` list or inside a quoted string.
 * `from` is relative to the line start.
 */
export function attributeCompletions(type: string, before: string, above = ''): AttrCompletion | null {
  const open = before.lastIndexOf('[');
  if (open < 0 || before.indexOf(']', open) >= 0) return null;
  const inner = before.slice(open + 1);
  if (((inner.match(/"/g) ?? []).length & 1) === 1) return null;
  const legend = /^\s*legend\b/.test(before) || (open >= 0 && /^\s*$/.test(before.slice(0, open)) && insideLegendBlock(above));
  const segStart = inner.lastIndexOf(',') + 1;
  const seg = inner.slice(segStart);
  const colon = seg.indexOf(':');
  if (colon < 0) {
    const word = seg.trimStart();
    const from = open + 1 + segStart + (seg.length - word.length);
    if (!/^[A-Za-z]*$/.test(word)) return null;
    const options = keysFor(type, legend).map((k) => ({ label: k, type: 'property', detail: KEY_DETAIL[k], apply: `${k}: ` }));
    return { from, options };
  }
  const key = seg.slice(0, colon).trim();
  const raw = seg.slice(colon + 1);
  const word = raw.trimStart();
  if (!Object.hasOwn(VALUES, key) || /[\s,]/.test(word)) return null;
  const from = open + 1 + segStart + colon + 1 + (raw.length - word.length);
  const options = VALUES[key].map((v) => ({ label: v, type: key === 'icon' ? 'constant' : 'enum' }));
  return { from, options };
}

export function dslCompletionSource(getType: () => string) {
  return (cx: CompletionContext): CompletionResult | null => {
    const line = cx.state.doc.lineAt(cx.pos);
    const r = attributeCompletions(getType(), line.text.slice(0, cx.pos - line.from), cx.state.doc.sliceString(0, line.from));
    if (!r) return null;
    // Open on typing; Ctrl+Space (explicit) also opens right after `[`, `,` or `:`.
    const typed = cx.pos - (line.from + r.from);
    if (!cx.explicit && typed === 0) return null;
    return { from: line.from + r.from, options: r.options, validFor: /^[\w#-]*$/ };
  };
}
