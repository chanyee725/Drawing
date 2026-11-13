// Headless browser check that diagram text keeps its letter spacing when a picture is drawn small (E63, #274).
// Runs on request only:
//   DRAW_E2E=1 CHROME=/path/to/chrome-headless-shell PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core npm test
// No server: the pictures are drawn on a blank page the way the canvas draws them (an SVG image, source-rect drawImage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderDiagram, sceneToSvg } from '../../shared/render/index.ts';
import { textWidth } from '../../shared/render/text.ts';
import { scaleSvg, svgDataURL } from '../../web/src/canvas/resolution.ts';
import { fixture } from '../dsl/helpers.ts';

const ON = process.env.DRAW_E2E === '1' && process.env.CHROME && process.env.PLAYWRIGHT_CORE;
const SKIP = { skip: !ON && 'set DRAW_E2E=1, CHROME and PLAYWRIGHT_CORE to run', timeout: 120_000 };

const FIXTURES = ['architecture-web-service', 'flowchart-ticket-workflow', 'sequence-login', 'erd-billing'];
// The labels of the report: at fit zoom they read "Need identi fied" and "Raise a requisition" with gaps.
const REPORT = 'direction right\nNeed identified [shape: oval, color: green]\nRaise a requisition\nNeed identified > Raise a requisition: The supplier ships';
/** Picture variants the canvas shows when zoomed out (resolution.ts), and the reference: big enough that rounding is gone.
 *  4x, not 8x: the whole picture is drawn at this size (up to ~9.5k px wide at 8x), which can time out on a busy machine. */
const SMALL = [1, 0.5];
const REFERENCE = 4;

/** Where each single-line text sits (picture units), with room around it; texts whose rooms touch are left out. */
function textRooms(scene) {
  const rooms = scene.items
    .filter((it) => it.kind === 'text' && it.lines.length === 1 && it.lines[0].trim().length >= 6)
    .map((tx) => {
      const w = textWidth(tx.lines[0], tx.size, tx.font, tx.weight === 600) * 1.3 + 12;
      const x = tx.anchor === 'start' ? tx.x - 6 : tx.anchor === 'end' ? tx.x - w + 6 : tx.x - w / 2;
      return { label: tx.lines[0], x, y: tx.y - 2, w, h: tx.lineHeight + 4 };
    });
  const apart = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  return rooms.filter((a) => rooms.every((b) => a === b || apart(a, b)));
}

/** Width of the ink in each room (picture units) with the picture drawn at `k` times its size. */
const inkWidths = (page, svg, scene, rooms, k) =>
  page.evaluate(
    async ({ url, W, H, rooms, k }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.ceil(W * k);
      c.height = Math.ceil(H * k);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, W * k, H * k);
      return rooms.map((r) => {
        const x0 = Math.max(0, Math.floor(r.x * k));
        const y0 = Math.max(0, Math.floor(r.y * k));
        const w = Math.min(c.width - x0, Math.ceil(r.w * k));
        const h = Math.min(c.height - y0, Math.ceil(r.h * k));
        const d = g.getImageData(x0, y0, w, h).data;
        let lo = -1;
        let hi = -1;
        for (let x = 0; x < w; x++) {
          for (let y = 0; y < h; y++) {
            const i = (y * w + x) * 4;
            if (765 - d[i] - d[i + 1] - d[i + 2] > 60) {
              if (lo < 0) lo = x;
              hi = x;
              break;
            }
          }
        }
        return lo < 0 ? 0 : (hi - lo + 1) / k;
      });
    },
    { url: svgDataURL(scaleSvg(svg, k)), W: scene.width, H: scene.height, rooms, k },
  );

test('diagram text is as wide drawn small as drawn big: no gaps inside words', SKIP, async (t) => {
  const { chromium } = await import(pathToFileURL(join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).slice(0, 400)));

  const sources = [['report', REPORT, 'flowchart'], ...FIXTURES.map((name) => [name, fixture(name), undefined])];
  let checked = 0;
  for (const [name, code, type] of sources) {
    const { scene } = await renderDiagram(code, type ? { type } : {});
    // Text only, on white: boxes and lines would count as ink.
    const svg = sceneToSvg({ ...scene, items: scene.items.filter((it) => it.kind === 'text') }, { theme: 'light' });
    const rooms = textRooms(scene);
    assert.ok(rooms.length > 0, `${name}: has texts to check`);
    const want = await inkWidths(page, svg, scene, rooms, REFERENCE);
    for (const k of SMALL) {
      const got = await inkWidths(page, svg, scene, rooms, k);
      // One device pixel of rounding at each end, plus 2% of the width.
      rooms.forEach((r, i) => {
        const slack = 2 / k + want[i] * 0.02;
        assert.ok(Math.abs(got[i] - want[i]) <= slack, `${name} at ${k}x: "${r.label}" is ${got[i]} wide, ${want[i].toFixed(2)} drawn big (slack ${slack.toFixed(2)})`);
        checked++;
      });
    }
  }
  assert.ok(checked >= 20, `checked ${checked} texts`);
  assert.deepEqual(errors, []);
});
