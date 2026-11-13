import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyIds, focusAfterClose, fractionFrom, LOGIN_POLL_EVERY_MS, LOGIN_POLL_LIMIT_MS, pollLogins, isSection, LOGIN_ENDED_NOTE, loginsEndedUnconnected, loginUnlessClosed, oneAtATime, providerRows, SECTIONS, wholeFrom } from '../../web/src/settings/model.ts';

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
  assert.deepEqual(busyIds({ claude: { busy: true }, gemini: { busy: true } }), ['claude', 'gemini']);
  assert.deepEqual(busyIds({}), []);
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

test('login polling end: a login that ended without connecting or an error is reported once', () => {
  // Still running: nothing to say yet.
  assert.deepEqual(loginsEndedUnconnected(['claude'], { claude: { busy: true } }), []);
  // Ended and connected, or ended with its own error (shown on the row): no extra note.
  assert.deepEqual(loginsEndedUnconnected(['claude'], { claude: { connected: true } }), []);
  assert.deepEqual(loginsEndedUnconnected(['claude'], { claude: { error: 'x' } }), []);
  // Ended (busy false) but still off: the case that used to wait forever.
  assert.deepEqual(loginsEndedUnconnected(['claude', 'openai'], { claude: {}, openai: { busy: true } }), ['claude']);
  // Not running before: never reported.
  assert.deepEqual(loginsEndedUnconnected([], { claude: {} }), []);
  assert.match(LOGIN_ENDED_NOTE, /연결되지 않았어요/);
});

test('oneAtATime drops a second call while the first runs (double click)', async () => {
  let calls = 0;
  let release!: () => void;
  const run = oneAtATime(async () => {
    calls++;
    await new Promise<void>((r) => (release = r));
  });
  const first = run();
  assert.equal(await run(), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  // Free again after the first one ends, also after a throw.
  const failing = oneAtATime(async () => {
    calls++;
    throw new Error('boom');
  });
  await assert.rejects(failing());
  await assert.rejects(failing());
  assert.equal(calls, 3);
});

test('loginUnlessClosed: a login that returns after the dialog closed is cancelled (#228 review)', async () => {
  const calls: string[] = [];
  let closed = false;
  let release!: () => void;
  const login = async (id: string) => {
    calls.push(`login ${id}`);
    await new Promise<void>((r) => (release = r));
    return { ok: true, connected: false };
  };
  const cancel = async (id: string) => void calls.push(`cancel ${id}`);
  const p = loginUnlessClosed('gemini', login, cancel, () => closed);
  closed = true; // Esc while the login request is still in flight
  release();
  assert.deepEqual(await p, { ok: true, connected: false });
  assert.deepEqual(calls, ['login gemini', 'cancel gemini']);
});

test('loginUnlessClosed: no cancel while open, or when the login already connected', async () => {
  const calls: string[] = [];
  const cancel = async (id: string) => void calls.push(`cancel ${id}`);
  await loginUnlessClosed('claude', async () => ({ connected: false }), cancel, () => false);
  await loginUnlessClosed('claude', async () => ({ connected: true }), cancel, () => true);
  assert.deepEqual(calls, []);
  // A failing cancel does not turn into an error for the closed dialog.
  await loginUnlessClosed('openai', async () => ({ connected: false }), async () => Promise.reject(new Error('x')), () => true);
});

function fakeClock() {
  let t = 0;
  const timers = new Map<number, { fn: () => void; ms: number; next: number }>();
  let id = 0;
  return {
    now: () => t,
    setInterval: (fn: () => void, ms: number) => (timers.set(++id, { fn, ms, next: t + ms }), id),
    clearInterval: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        t = due[1].next;
        due[1].next += due[1].ms;
        due[1].fn();
      }
      t = end;
    },
    get active() {
      return timers.size;
    },
  };
}

test('login polling: checks every 2 s, gives up once after 10 minutes, and a new round starts a fresh window', () => {
  const clock = fakeClock();
  let loads = 0;
  let gaveUp = 0;
  pollLogins(() => loads++, () => gaveUp++, clock);
  clock.advance(LOGIN_POLL_EVERY_MS * 3);
  assert.equal(loads, 3);
  clock.advance(LOGIN_POLL_LIMIT_MS);
  assert.equal(gaveUp, 1);
  assert.equal(clock.active, 0, 'the timer stops after giving up');
  const before = loads;
  clock.advance(60_000);
  assert.equal(loads, before, 'no checks after giving up');

  // 다시 확인: a new round polls again for another full window.
  pollLogins(() => loads++, () => gaveUp++, clock);
  clock.advance(LOGIN_POLL_LIMIT_MS - LOGIN_POLL_EVERY_MS);
  assert.ok(loads > before + 100);
  assert.equal(gaveUp, 1);
  clock.advance(LOGIN_POLL_EVERY_MS * 2);
  assert.equal(gaveUp, 2);
});

test('login polling: stop clears the timer', () => {
  const clock = fakeClock();
  let loads = 0;
  const stop = pollLogins(() => loads++, () => {}, clock);
  stop();
  clock.advance(10_000);
  assert.equal(loads, 0);
  assert.equal(clock.active, 0);
});

test('focus after settings close: keeps a real focus, else the opener, else the visible sidebar button', () => {
  const body = { name: 'body' };
  const mk = (name: string, opts: { connected?: boolean; visible?: boolean } = {}) => {
    const el = { name, isConnected: opts.connected ?? true, focused: 0, focus() { this.focused++; }, checkVisibility: () => opts.visible ?? true };
    return el;
  };
  const hidden = mk('hidden trigger', { visible: false });
  const trigger = mk('trigger');
  const root = (active: unknown) => ({ activeElement: active, body, querySelectorAll: () => [hidden, trigger] });

  const elsewhere = mk('elsewhere');
  const opener = mk('opener');
  focusAfterClose(opener, root(elsewhere));
  assert.equal(opener.focused, 0, 'focus already landed somewhere');

  focusAfterClose(opener, root(body));
  assert.equal(opener.focused, 1);

  const gone = mk('row in the closed drawer', { connected: false });
  focusAfterClose(gone, root(body));
  assert.equal(gone.focused, 0);
  assert.equal(hidden.focused, 0);
  assert.equal(trigger.focused, 1);

  focusAfterClose(null, root(null));
  assert.equal(trigger.focused, 2);
});
