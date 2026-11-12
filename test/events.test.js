import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { clientOptions, createHub } from '../server/events.js';

const fakeClient = () => {
  const req = new EventEmitter();
  const res = { out: '', writeHead() {}, write(s) { this.out += s; }, end() {} };
  return { req, res };
};

test('clientOptions: activity only with activity=1', () => {
  assert.deepEqual(clientOptions(new URL('http://h/api/events')), { activity: false });
  assert.deepEqual(clientOptions(new URL('http://h/api/events?activity=0')), { activity: false });
  assert.deepEqual(clientOptions(new URL('http://h/api/events?activity=1')), { activity: true });
  assert.deepEqual(clientOptions(undefined), { activity: false });
});

test('hub: function data is built per client options', () => {
  const hub = createHub();
  const a = fakeClient();
  const b = fakeClient();
  hub.attach(a.req, a.res, new URL('http://h/api/events'));
  hub.attach(b.req, b.res, new URL('http://h/api/events?activity=1'));
  let calls = 0;
  hub.broadcast('agents', (o) => (calls++, { line: o.activity ? 'secret line' : null }));
  hub.broadcast('file', { id: 1 });
  assert.doesNotMatch(a.res.out, /secret line/);
  assert.match(b.res.out, /secret line/);
  assert.match(a.res.out, /event: file\ndata: \{"id":1\}/);
  assert.match(b.res.out, /event: file\ndata: \{"id":1\}/);
  assert.equal(calls, 2);
  a.req.emit('close');
  b.req.emit('close');
  assert.equal(hub.size, 0);
});
