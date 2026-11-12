// Document → Markdown (pure, no DOM). A diagram embed becomes a fenced code block with its DSL code,
// tagged with the diagram type, so the text stays readable and can be pasted back.
import type { Block } from '../api.ts';
import { DIAGRAM_NODE, type DocNode } from '../doc/model.ts';

type Mark = { type: string; attrs?: Record<string, unknown> };
type N = DocNode & { text?: string; marks?: Mark[] };

const escText = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(#{1,6} |[-+] |\d+\. )/, '\\$1');

/** A fence longer than any run of backticks inside, so the code cannot close it early. */
export function fence(code: string, info = ''): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}${info}\n${code.replace(/\n$/, '')}\n${f}`;
}

function inline(nodes: N[] | undefined): string {
  let out = '';
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out += '  \n';
      continue;
    }
    if (n.type !== 'text' || typeof n.text !== 'string') {
      out += inline(n.content as N[] | undefined);
      continue;
    }
    const marks = n.marks ?? [];
    const has = (t: string) => marks.find((m) => m.type === t);
    let t = has('code') ? `\`${n.text.replace(/`/g, '\\`')}\`` : escText(n.text);
    if (has('bold')) t = `**${t}**`;
    if (has('italic')) t = `*${t}*`;
    if (has('strike')) t = `~~${t}~~`;
    const link = has('link');
    if (link && typeof link.attrs?.href === 'string') t = `[${t}](${link.attrs.href})`;
    out += t;
  }
  return out;
}

const indent = (s: string, pad: string) => s.split('\n').map((l) => (l ? pad + l : l)).join('\n');

function list(n: N, ctx: Ctx): string {
  const kind = n.type;
  const items = (n.content as N[] | undefined) ?? [];
  return items
    .map((it, i) => {
      const bullet = kind === 'orderedList' ? `${(Number((n.attrs as { start?: number } | undefined)?.start) || 1) + i}. ` : kind === 'taskList' ? `- [${it.attrs?.checked ? 'x' : ' '}] ` : '- ';
      const parts = ((it.content as N[] | undefined) ?? []).map((c) => block(c, ctx)).filter((s) => s !== '');
      const [first = '', ...rest] = parts;
      const pad = ' '.repeat(bullet.length);
      return bullet + first.split('\n').map((l, j) => (j ? (l ? pad + l : l) : l)).join('\n') + (rest.length ? '\n' + indent(rest.join('\n'), pad) : '');
    })
    .join('\n');
}

function table(n: N): string {
  const rows = ((n.content as N[] | undefined) ?? []).map((r) => ((r.content as N[] | undefined) ?? []).map((c) => ((c.content as N[] | undefined) ?? []).map((p) => inline(p.content as N[] | undefined)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
  if (!rows.length) return '';
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
  return [pad(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(pad)].join('\n');
}

type Ctx = { blocks: Map<string, Block> };

function block(n: N, ctx: Ctx): string {
  const kids = (n.content as N[] | undefined) ?? [];
  switch (n.type) {
    case 'paragraph':
      return inline(kids);
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, Number(n.attrs?.level) || 1)))} ${inline(kids)}`;
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(n, ctx);
    case 'codeBlock':
      return fence(kids.map((k) => k.text ?? '').join(''), typeof n.attrs?.language === 'string' ? n.attrs.language : '');
    case 'blockquote':
      return kids.map((k) => block(k, ctx)).join('\n\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'horizontalRule':
      return '---';
    case 'table':
      return table(n);
    case DIAGRAM_NODE: {
      const b = typeof n.attrs?.blockId === 'string' ? ctx.blocks.get(n.attrs.blockId) : undefined;
      // An embed whose block is gone leaves nothing to write.
      return b ? fence(b.code, b.type) : '';
    }
    default:
      return kids.map((k) => block(k, ctx)).filter(Boolean).join('\n\n');
  }
}

/** The document as Markdown, with the file title as the first heading when there is one. Never throws. */
export function documentToMarkdown(title: string, document: unknown, blocks: readonly Block[]): string {
  const ctx: Ctx = { blocks: new Map(blocks.map((b) => [b.id, b])) };
  const content = document && typeof document === 'object' && Array.isArray((document as { content?: unknown }).content) ? ((document as { content: N[] }).content) : [];
  const parts = content.map((n) => block(n, ctx)).filter((s) => s !== '');
  const head = title.trim() ? [`# ${escText(title.trim())}`] : [];
  return [...head, ...parts].join('\n\n') + '\n';
}

/** A safe download name for a title: no path characters, never empty. */
export function exportName(title: string, ext: string): string {
  const stem = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+/, '') || '제목 없는 파일';
  return `${stem}.${ext}`;
}
