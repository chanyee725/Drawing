// Headless browser check for export and shortcuts (E7). Needs a Chromium and playwright-core, so it only runs on request:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// It starts its own server on a free port against a scratch workspace in a temp dir, and refuses to go on
// unless the server's own log names that port and folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const freePort = () =>
  new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });

test('export and shortcuts in a headless browser', { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 180_000 }, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const ws = mkdtempSync(join(tmpdir(), 'draw-e7-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['server/index.js', ws], { env: { ...process.env, DRAW_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const BASE = `http://127.0.0.1:${port}`;
  let browser;
  t.after(async () => {
    await browser?.close();
    server.kill();
    rmSync(ws, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !log.includes('workspace'); i++) await new Promise((r) => setTimeout(r, 100));
  // Only go on when the log shows our own server on our own port and folder (another session may own a port).
  assert.ok(log.includes(`http://127.0.0.1:${port}/`) && log.includes(`workspace ${ws}`), `unexpected server log: ${log}`);

  const call = async (m, u, b) => {
    const r = await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json', 'x-drawing': '1' }, body: b && JSON.stringify(b) });
    return r.json();
  };
  let f = await call('POST', '/api/file', { path: 'e7', title: 'E7 내보내기' });
  const code1 = 'A [icon: aws-ec2]\nB [icon: aws-s3]\nA > B';
  f = await call('PUT', '/api/file?path=e7', {
    ...f,
    version: 2,
    blocks: [
      { id: 'b1', type: 'flowchart', code: code1, x: 0, y: 0, w: 0, h: 0 },
      { id: 'b2', type: 'sequence', code: 'Client > Server: GET\nServer > Client: 200', x: 0, y: 0, w: 0, h: 0 },
    ],
    document: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '개요' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '본문 ' }, { type: 'text', text: '굵게', marks: [{ type: 'bold' }] }] },
        { type: 'diagram', attrs: { blockId: 'b1' } },
        { type: 'diagram', attrs: { blockId: 'b2' } },
      ],
    },
  });

  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  let step = 'load';
  const origins = new Set();
  const errors = [];
  page.on('request', (r) => !/^(data|blob):/.test(r.url()) && origins.add(new URL(r.url()).origin));
  page.on('pageerror', (e) => errors.push(`[${step}] ${e.stack}`.slice(0, 400)));
  await page.goto(`${BASE}/#file=e7`);
  await page.waitForSelector('.excalidraw canvas', { timeout: 30000 });
  await page.waitForSelector('.doc-diagram-pic img', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // Canvas only: wide enough for Excalidraw's zoom controls.
  await page.getByRole('button', { name: '캔버스', exact: true }).click();
  await page.waitForTimeout(500);
  const saved = async () => {
    await page.waitForTimeout(1200); // autosave is debounced
    const g = await call('GET', '/api/file?path=e7');
    return { free: (g.canvas.elements ?? []).filter((e) => !e.isDeleted).length, blocks: g.blocks.length };
  };
  const tool = (name) => page.locator(`input[data-testid="toolbar-${name}"]`).isChecked();
  const zoom = async () => parseInt(await page.locator('.reset-zoom-button').first().innerText(), 10);
  const box = await page.locator('[data-canvas]').boundingBox();
  const empty = { x: box.x + box.width - 120, y: box.y + box.height - 120 };

  await t.test('tool keys', async () => {
    step = 'tool keys';
    await page.mouse.click(empty.x, empty.y);
    for (const [k, name] of [['r', 'rectangle'], ['d', 'diamond'], ['o', 'ellipse'], ['a', 'arrow'], ['l', 'line'], ['p', 'freedraw'], ['t', 'text'], ['e', 'eraser'], ['h', 'hand'], ['v', 'selection']]) {
      await page.keyboard.press(k);
      assert.ok(await tool(name), `key ${k} should pick ${name}`);
      if (k === 't') await page.keyboard.press('Escape');
    }
  });

  await t.test('draw, duplicate, undo, redo, delete, select all', async () => {
    step = 'draw, duplicate, undo, redo, delete, select all';
    await page.keyboard.press('r');
    await page.mouse.move(empty.x - 80, empty.y - 60);
    await page.mouse.down();
    await page.mouse.move(empty.x, empty.y, { steps: 5 });
    await page.mouse.up();
    assert.deepEqual(await saved(), { free: 1, blocks: 2 });
    await page.keyboard.press('Control+d');
    assert.equal((await saved()).free, 2);
    await page.keyboard.press('Control+z');
    assert.equal((await saved()).free, 1);
    await page.keyboard.press('Control+Shift+z');
    assert.equal((await saved()).free, 2);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    assert.deepEqual(await saved(), { free: 0, blocks: 0 });
    await page.keyboard.press('Control+z');
    assert.deepEqual(await saved(), { free: 2, blocks: 2 });
  });

  await t.test('zoom keys', async () => {
    step = 'zoom keys';
    await page.keyboard.press('Control+0');
    assert.equal(await zoom(), 100);
    await page.keyboard.press('Control+Equal');
    const up = await zoom();
    assert.ok(up > 100, `zoom in gave ${up}`);
    await page.keyboard.press('Control+Minus');
    await page.keyboard.press('Control+Minus');
    assert.ok((await zoom()) < up - 10);
    await page.keyboard.press('Control+0');
    assert.equal(await zoom(), 100);
  });

  await t.test('command palette', async () => {
    step = 'command palette';
    await page.keyboard.press('Control+k');
    const dlg = page.getByRole('dialog', { name: '명령 팔레트' });
    await dlg.waitFor();
    // Excalidraw's own Ctrl+K (link editor) must not have opened.
    assert.equal(await page.locator('.excalidraw .Modal, .excalidraw .hyperlinkContainer').count(), 0);
    await page.keyboard.type('사각형');
    assert.equal(await dlg.locator('[role=option]').count(), 1);
    await page.keyboard.press('Enter');
    await dlg.waitFor({ state: 'detached' });
    await page.waitForTimeout(100);
    assert.ok(await tool('rectangle'));
    // Palette zoom command and Escape to close.
    await page.keyboard.press('Control+k');
    await dlg.waitFor();
    await page.keyboard.type('확대');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.ok((await zoom()) > 100);
    await page.keyboard.press('Control+k');
    await dlg.waitFor();
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
    await page.keyboard.press('Control+0');
  });

  const downloadVia = async (item) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export="${item}"]`).click()]);
    return { name: dl.suggestedFilename(), data: readFileSync(await dl.path()) };
  };

  await t.test('export the whole canvas as SVG and PNG', async () => {
    step = 'export the whole canvas as SVG and PNG';
    await page.mouse.click(empty.x, empty.y);
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+e');
    const menu = page.getByRole('menu', { name: '내보내기' });
    await menu.waitFor();
    assert.match(await menu.innerText(), /캔버스 전체/);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-export')), 'svg', 'Ctrl+E focuses the first export action, not an option pill');
    const svg = await downloadVia('svg');
    assert.equal(svg.name, 'E7 내보내기.svg');
    const text = svg.data.toString('utf8');
    assert.match(text, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.ok((text.match(/<image/g) ?? []).length >= 2, 'both diagram pictures are in the SVG');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(text), 'no external address in the SVG');

    await page.keyboard.press('Control+e');
    const png = await downloadVia('png');
    assert.equal(png.name, 'E7 내보내기.png');
    assert.equal(png.data.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.data.readUInt32BE(16) > 50 && png.data.readUInt32BE(20) > 50, 'PNG has a size');
  });

  await t.test('PNG options: scale, transparent, dark', async () => {
    step = 'PNG options';
    const opt = async (sel) => {
      await page.locator(sel).click();
    };
    const open = async () => {
      // The previous menu may still be playing its close animation; reopening now would race it (#218).
      await page.getByRole('menu', { name: '내보내기' }).waitFor({ state: 'detached' });
      await page.keyboard.press('Control+e');
      await page.getByRole('menu', { name: '내보내기' }).waitFor();
    };
    // First pixel's [r, g, b, a] of a PNG, decoded in the page.
    const corner = (data) =>
      page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const x = c.getContext('2d');
        x.drawImage(bmp, 0, 0);
        return [...x.getImageData(0, 0, 1, 1).data];
      }, data.toString('base64'));
    const w = (d) => d.readUInt32BE(16);

    await open();
    const x2 = await downloadVia('png');
    assert.equal(x2.name, 'E7 내보내기.png');
    await open();
    await opt('[data-export-scale="1"]');
    const x1 = await downloadVia('png');
    assert.equal(x1.name, 'E7 내보내기@1x.png');
    assert.ok(Math.abs(w(x2.data) - 2 * w(x1.data)) <= 2, `2x is twice 1x (${w(x2.data)} vs ${w(x1.data)})`);
    await open();
    await opt('[data-export-scale="3"]');
    // The pills are radio items: role, group name and checked state reach assistive tech (#120).
    const menu = page.getByRole('menu', { name: '내보내기' });
    await menu.getByRole('group', { name: 'PNG 크기' }).getByRole('menuitemradio', { name: '3배', checked: true }).waitFor();
    assert.equal(await menu.getByRole('menuitemradio', { name: '1배', checked: false }).count(), 1, '1x is no longer checked');
    const x3 = await downloadVia('png');
    assert.equal(x3.name, 'E7 내보내기@3x.png');
    assert.ok(Math.abs(w(x3.data) - 3 * w(x1.data)) <= 3, `3x is three times 1x (${w(x3.data)} vs ${w(x1.data)})`);
    assert.deepEqual(await corner(x3.data), [255, 255, 255, 255], 'light PNG has a white background');

    await open();
    await opt('[data-export-transparent]');
    const tr = await downloadVia('png');
    assert.equal(tr.name, 'E7 내보내기@3x-transparent.png');
    assert.equal((await corner(tr.data))[3], 0, 'transparent PNG has an empty corner');

    await open();
    await opt('[data-export-transparent]');
    await opt('[data-export-dark="true"]');
    await menu.getByRole('group', { name: '색상' }).getByRole('menuitemradio', { name: '다크', checked: true }).waitFor();
    assert.equal(await menu.getByRole('menuitemradio', { name: '라이트', checked: false }).count(), 1, 'light is no longer checked');
    const dk = await downloadVia('png');
    assert.equal(dk.name, 'E7 내보내기@3x-dark.png');
    const [r, g, b, a] = await corner(dk.data);
    assert.ok(a === 255 && r < 60 && g < 60 && b < 60, `dark PNG has a dark background, got ${[r, g, b, a]}`);

    await open();
    const dsvg = await downloadVia('svg');
    assert.equal(dsvg.name, 'E7 내보내기-dark.svg');

    // Back to the defaults for the tests that follow.
    await open();
    await opt('[data-export-scale="2"]');
    await opt('[data-export-dark="false"]');
    await page.keyboard.press('Escape');
  });

  await t.test('export only the selected diagram', async () => {
    step = 'export only the selected diagram';
    await page.getByRole('button', { name: '둘 다', exact: true }).click();
    await page.waitForSelector('.doc-diagram-pic img');
    await page.waitForTimeout(1000);
    await page.locator('.doc-diagram-pic').first().click();
    await page.waitForTimeout(800);
    await page.keyboard.press('Control+e');
    const menu = page.getByRole('menu', { name: '내보내기' });
    await menu.waitFor();
    assert.match(await menu.innerText(), /선택한 것/);
    const svg = await downloadVia('svg');
    assert.equal((svg.data.toString('utf8').match(/<image/g) ?? []).length, 1);
  });

  await t.test('copy as image (Shift+Alt+C and menu)', async () => {
    step = 'copy as image (Shift+Alt+C and menu)';
    await page.keyboard.press('Shift+Alt+c');
    await page.getByText('이미지로 복사했어요').first().waitFor({ timeout: 10000 });
    const type = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const blob = await items[0].getType('image/png');
      return { type: items[0].types.join(','), size: blob.size };
    });
    assert.match(type.type, /image\/png/);
    assert.ok(type.size > 100);
  });

  await t.test('export the document as Markdown', async () => {
    step = 'export the document as Markdown';
    await page.keyboard.press('Control+e');
    await page.getByRole('menu', { name: '내보내기' }).waitFor();
    const md = await downloadVia('md');
    assert.equal(md.name, 'E7 내보내기.md');
    assert.equal(md.data.toString('utf8'), `# E7 내보내기\n\n## 개요\n\n본문 **굵게**\n\n\`\`\`flowchart\n${code1}\n\`\`\`\n\n\`\`\`sequence\nClient > Server: GET\nServer > Client: 200\n\`\`\`\n`);
  });

  await t.test('export one diagram from the document', async () => {
    step = 'export one diagram from the document';
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-block="svg"]').first().click()]);
    const text = readFileSync(await dl.path(), 'utf8');
    assert.match(text, /^<svg/);
    assert.ok(text.length > 500);
    const [pdl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-export-block="png"]').first().click()]);
    assert.equal(readFileSync(await pdl.path()).subarray(1, 4).toString(), 'PNG');
  });

  await t.test('Ctrl+E and Shift+Alt+C stay with the document editor', async () => {
    step = 'editor keys';
    await page.getByRole('button', { name: '문서', exact: true }).click();
    const para = page.locator('.ProseMirror p', { hasText: '본문' }).first();
    await para.waitFor();
    await para.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(400);
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('menu', { name: '내보내기' }).count(), 0, 'Ctrl+E in the editor must not open the export menu');
    assert.ok((await page.locator('.ProseMirror code').count()) >= 1, 'Ctrl+E in the editor toggles the code mark');
    await page.keyboard.press('Control+e');
    await page.keyboard.press('Shift+Alt+c');
    await page.waitForTimeout(600);
    assert.equal(await page.getByText('이미지로 복사했어요').count(), 0, 'Shift+Alt+C in the editor must not copy an image');
    // The menu button still opens it.
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.getByRole('menu', { name: '내보내기' }).waitFor();
    await page.keyboard.press('Escape');
  });

  await t.test('Ctrl+E does nothing when the export menu is hidden (narrow window)', async () => {
    step = 'narrow';
    await page.setViewportSize({ width: 600, height: 900 });
    await page.mouse.click(5, 450);
    await page.keyboard.press('Control+e');
    await page.waitForTimeout(300);
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole('menu', { name: '내보내기' }).count(), 0, 'the hidden menu must not have been opened');
  });

  await t.test('Mac: Cmd keys work, Ctrl keys do not', async () => {
    step = 'mac';
    const mctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    await mctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }));
    const mp = await mctx.newPage();
    mp.on('pageerror', (e) => errors.push(`[mac] ${e.stack}`.slice(0, 400)));
    await mp.goto(`${BASE}/#file=e7`);
    await mp.waitForSelector('.excalidraw canvas', { timeout: 30000 });
    await mp.waitForTimeout(1000);
    await mp.getByRole('button', { name: '캔버스', exact: true }).click();
    await mp.waitForTimeout(500);
    const mzoom = async () => parseInt(await mp.locator('.reset-zoom-button').first().innerText(), 10);
    const dlg = mp.getByRole('dialog', { name: '명령 팔레트' });
    const run = async (q) => {
      await mp.keyboard.press('Meta+k');
      await dlg.waitFor();
      await mp.keyboard.type(q);
      await mp.keyboard.press('Enter');
      await dlg.waitFor({ state: 'detached' });
      await mp.waitForTimeout(250);
    };
    // Ctrl+K is not the Mac shortcut.
    await mp.keyboard.press('Control+k');
    await mp.waitForTimeout(300);
    assert.equal(await dlg.count(), 0, 'Ctrl+K must not open the palette on a Mac');
    await run('화면 크기 100%');
    assert.equal(await mzoom(), 100);
    await run('확대');
    const up = await mzoom();
    assert.ok(up > 100, `palette zoom in on a Mac gave ${up}`);
    await run('축소');
    assert.ok((await mzoom()) < up, 'palette zoom out on a Mac');
    await run('화면 크기 100%');
    assert.equal(await mzoom(), 100);
    // Cmd+E opens the menu with a Mac tooltip; Ctrl+E does not.
    assert.equal(await mp.getByRole('button', { name: '내보내기', exact: true }).getAttribute('title'), '내보내기 (⌘E)');
    await mp.mouse.click(1300, 800);
    await mp.keyboard.press('Control+e');
    await mp.waitForTimeout(300);
    assert.equal(await mp.getByRole('menu', { name: '내보내기' }).count(), 0, 'Ctrl+E must not open the menu on a Mac');
    await mp.keyboard.press('Meta+e');
    await mp.getByRole('menu', { name: '내보내기' }).waitFor();
    await mctx.close();
  });

  assert.deepEqual([...origins], [BASE], 'no request left this server');
  assert.deepEqual(errors, []);
});
