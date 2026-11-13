import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyBusy, fractionFrom, isSection, providerRows, SECTIONS, wholeFrom } from '../../web/src/settings/model.ts';

test('sections: 일반, 모델 연결, 실행 in order; isSection guards ids', () => {
  assert.deepEqual(SECTIONS.map((s) => s.label), ['일반', '모델 연결', '실행']);
  assert.equal(isSection('models'), true);
  assert.equal(isSection('nope'), false);
});

test('provider rows: one per provider with status, action and usage windows', () => {
  const rows = providerRows(
    {
      claude: { installed: true, connected: true },
      openai: { installed: true, connected: false },
      gemini: { installed: false, connected: false },
    },
    { claude: { windows: [{ label: '5시간', used: 0.42 }, { label: '주간', used: null }] } },
  );
  assert.deepEqual(rows.map((r) => r.name), ['Claude', 'Codex', 'Gemini']);
  assert.deepEqual(rows.map((r) => r.action), ['disconnect', 'connect', null]);
  assert.deepEqual(rows[0].windows, [{ label: '5시간', pct: 42 }]);
  assert.equal(rows[0].tone, 'ok');
  assert.equal(rows[1].status, '연결 안 됨');
  assert.equal(rows[2].status, 'CLI가 설치되지 않았어요');
});

test('provider rows: a running login can be cancelled and only shows an https sign-in link', () => {
  const [c] = providerRows({ claude: { installed: true, connected: false, busy: true, url: 'https://example.test/x' } }, {});
  assert.equal(c.action, 'cancel');
  assert.equal(c.loginUrl, 'https://example.test/x');
  const [d] = providerRows({ claude: { busy: true, url: 'javascript:alert(1)' } }, {});
  assert.equal(d.loginUrl, null);
  assert.equal(anyBusy({ claude: { busy: true } }), true);
  assert.equal(anyBusy({}), false);
});

test('provider rows: near or at a limit warns; usage hidden while disconnected', () => {
  const rows = providerRows(
    { claude: { connected: true }, openai: { connected: false }, gemini: { connected: true } },
    { claude: { windows: [{ label: '5시간', used: 1 }] }, openai: { windows: [{ label: '5시간', used: 0.5 }] }, gemini: { reached: true } },
  );
  assert.equal(rows[0].tone, 'warn');
  assert.equal(rows[0].status, '한도에 닿았어요');
  assert.deepEqual(rows[1].windows, []);
  assert.equal(rows[2].status, '한도에 닿았어요');
});

test('number fields: percent to fraction and whole-number ranges', () => {
  assert.equal(fractionFrom('90'), 0.9);
  assert.equal(fractionFrom('0'), null);
  assert.equal(fractionFrom('101'), null);
  assert.equal(fractionFrom(''), null);
  assert.equal(wholeFrom('15', 2, 500), 15);
  assert.equal(wholeFrom('1', 2, 500), null);
  assert.equal(wholeFrom('2.5', 2, 500), null);
});
