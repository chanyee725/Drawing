// The 완료 summary block (E28): table rows from a run record, replacing an older block, and taking it out again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationText, nodeLabels, summaryNodes, withSummary, withoutSummary, SUMMARY_HEADING_ID, type SummaryRecord } from '../../shared/dispatch/run-summary.ts';

const T0 = new Date(2026, 10, 13, 14, 5).getTime();
const MIN = 60e3;

const record: SummaryRecord = {
  startedAt: T0,
  endedAt: T0 + 67 * MIN,
  plan: {
    snapshot: {
      defaults: { role: 'impl' },
      steps: [
        { id: 'api', node: 'api', model: 'sonnet' },
        { id: 'ui', task: '로그인 화면\n자세한 설명' },
        { id: 'docs', role: 'docs', model: 'haiku' },
      ],
    },
  },
  steps: {
    api: { state: 'done', startedAt: T0, endedAt: T0 + 18 * MIN, sessions: [{ sid: 's1', model: 'sonnet', cost: 0.92 }], result: { commit: '3f2a1c0deadbeef', base: 'develop' } },
    ui: { state: 'done', startedAt: T0 + MIN, endedAt: T0 + 32 * MIN, sessions: [{ sid: 's2', model: 'sonnet', cost: 1.4, pr: { number: 92, state: 'merged' } }] },
    docs: { state: 'skipped', startedAt: null, endedAt: T0 + 60 * MIN, sessions: [], note: 'README는 다음 PR에서', result: { abandoned: true } },
  },
  totals: { cost: 2.32, mtok: 9.8 },
};

type N = { type: string; attrs?: Record<string, unknown>; content?: N[]; text?: string };
const textOf = (n: N): string => (n.text ?? '') + (n.content ?? []).map(textOf).join('');

test('summaryNodes: heading, totals, one row per step, plan differences, closing rule', () => {
  const labels = nodeLabels('api [label: "서버 API"]\nui [label: "UI"]');
  const nodes = summaryNodes(record, { labels, roleName: (r) => ({ impl: '구현자', docs: '문서화' })[r] ?? r }) as N[];
  assert.equal(nodes[0]!.type, 'heading');
  assert.equal(nodes[0]!.attrs!.id, SUMMARY_HEADING_ID);
  assert.match(textOf(nodes[0]!), /✓ 완료 · 11월 13일 14:05–15:12 \(1시간 7분\)/);
  assert.equal(textOf(nodes[1]!), '단계 3개 · 세션 2개 · $2.32 · 9.8M 토큰 · 병합 1건 (PR #92)');
  const rows = nodes[2]!.content!.map((r) => r.content!.map(textOf));
  assert.deepEqual(rows[0], ['단계', '역할', '모델', '걸린 시간', '비용', '결과']);
  assert.deepEqual(rows[1], ['1 서버 API', '구현자', 'sonnet', '18분', '$0.92', 'develop 3f2a1c0']);
  // Without a label the first line of the task is the title (the node is the id: "ui" has a label here).
  assert.deepEqual(rows[2], ['2 UI', '구현자', 'sonnet', '31분', '$1.40', 'PR #92']);
  assert.deepEqual(rows[3], ['3 docs', '문서화', 'haiku', '—', '—', '그만둠']);
  assert.equal(textOf(nodes[3]!), '계획과 달라진 점: 단계 3 그만둠 ("README는 다음 PR에서")');
  assert.equal(nodes[4]!.type, 'horizontalRule');
});

test('summary: goes first, replaces an older one, and withoutSummary takes it out', () => {
  const doc = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '메모' }] }] };
  const nodes = summaryNodes(record);
  const once = withSummary(doc, nodes);
  assert.equal(once.content!.length, nodes.length + 1);
  assert.equal(once.content![0]!.attrs!.id, SUMMARY_HEADING_ID);
  const twice = withSummary(once, nodes);
  assert.equal(twice.content!.length, once.content!.length);
  assert.deepEqual(withoutSummary(twice), doc);
  assert.deepEqual(withoutSummary(doc), doc);
  assert.deepEqual(withSummary(null, nodes).content, nodes);
});

test('durationText rounds to minutes', () => {
  assert.equal(durationText(40e3), '1분');
  assert.equal(durationText(12 * MIN), '12분');
  assert.equal(durationText(120 * MIN), '2시간');
});
