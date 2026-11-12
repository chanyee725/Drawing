import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentToMarkdown, exportName, fence } from '../../web/src/export/markdown.ts';

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c });
const blk = (id: string, type: string, code: string) => ({ id, type, code, x: 0, y: 0, w: 0, h: 0 });

test('diagram embeds become fenced code blocks tagged with the type', () => {
  const doc = { type: 'doc', content: [p(t('앞')), { type: 'diagram', attrs: { blockId: 'b1' } }, p(t('뒤'))] };
  const md = documentToMarkdown('설계', doc, [blk('b1', 'flowchart', 'A > B\n')]);
  assert.equal(md, '# 설계\n\n앞\n\n```flowchart\nA > B\n```\n\n뒤\n');
});

test('an embed whose block is gone is dropped', () => {
  const doc = { type: 'doc', content: [p(t('x')), { type: 'diagram', attrs: { blockId: 'zz' } }] };
  assert.equal(documentToMarkdown('', doc, []), 'x\n');
});

test('code containing backticks gets a longer fence', () => {
  assert.equal(fence('a ``` b', 'x'), '````x\na ``` b\n````');
});

test('headings, marks, lists, tasks, quote, table, rule', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [t('제목')] },
      p(t('굵게', [{ type: 'bold' }]), t(' '), t('링크', [{ type: 'link', attrs: { href: 'https://example.com' } }]), t(' '), t('c', [{ type: 'code' }])),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('가'))] }, { type: 'listItem', content: [p(t('나'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('하나'))] }] },
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('끝'))] }, { type: 'taskItem', attrs: { checked: false }, content: [p(t('할 일'))] }] },
      { type: 'blockquote', content: [p(t('인용'))] },
      { type: 'horizontalRule' },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('a'))] }, { type: 'tableHeader', content: [p(t('b'))] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('1'))] }, { type: 'tableCell', content: [p(t('2|3'))] }] }] },
    ],
  };
  const md = documentToMarkdown('', doc, []);
  assert.equal(
    md,
    '## 제목\n\n**굵게** [링크](https://example.com) `c`\n\n- 가\n- 나\n\n1. 하나\n\n- [x] 끝\n- [ ] 할 일\n\n> 인용\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2\\|3 |\n',
  );
});

test('a broken or empty document does not throw', () => {
  assert.equal(documentToMarkdown('', null, []), '\n');
  assert.equal(documentToMarkdown('제목', { type: 'doc' }, []), '# 제목\n');
});

test('export names keep path characters out', () => {
  assert.equal(exportName('a/b:c', 'md'), 'a-b-c.md');
  assert.equal(exportName('  ', 'svg'), '제목 없는 파일.svg');
  assert.equal(exportName('..x', 'png'), 'x.png');
});
