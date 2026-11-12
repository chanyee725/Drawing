import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../../web/src/doc/clipboard.ts';

// Minimal DOM stand-ins: just what the textarea fallback touches.
class FakeEl {
  isConnected = true;
  focused = false;
  style: Record<string, string> = {};
  value = '';
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  select() { fake.active = this; }
  remove() { this.isConnected = false; }
  focus() { fake.active = this; }
}
const fake = { active: null as FakeEl | null, ranges: [] as string[], copied: '' };

test('the clipboard fallback gives focus and the selection back to the editor', async () => {
  const editor = new FakeEl();
  fake.active = editor;
  fake.ranges = ['range-1'];
  const sel = {
    get rangeCount() { return fake.ranges.length; },
    getRangeAt: (i: number) => fake.ranges[i],
    removeAllRanges: () => { fake.ranges = []; },
    addRange: (r: string) => { fake.ranges.push(r); },
  };
  const g = globalThis as Record<string, unknown>;
  const saved = { navigator: g.navigator, document: g.document, HTMLElement: g.HTMLElement };
  g.HTMLElement = FakeEl;
  Object.defineProperty(g, 'navigator', { value: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } }, configurable: true });
  g.document = {
    get activeElement() { return fake.active; },
    body: new FakeEl(),
    getSelection: () => sel,
    createElement: () => new FakeEl(),
    execCommand: (cmd: string) => {
      assert.equal(cmd, 'copy');
      // While copying, the textarea holds focus and the selection.
      assert.notEqual(fake.active, editor);
      fake.ranges = ['textarea'];
      fake.copied = 'ok';
      return true;
    },
  };
  (g.document as { body: FakeEl & { appendChild?: (e: FakeEl) => void } }).body.appendChild = () => {};
  try {
    assert.equal(await copyText('link'), true);
    assert.equal(fake.active, editor, 'focus is back on the editor');
    assert.deepEqual(fake.ranges, ['range-1'], 'selection is back');
  } finally {
    Object.defineProperty(g, 'navigator', { value: saved.navigator, configurable: true });
    g.document = saved.document;
    g.HTMLElement = saved.HTMLElement;
  }
});
