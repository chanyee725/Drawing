// Mock adapter with the same shape as the real API. Used with `?mock` in the URL
// (or when the server has no /api/files yet). It edits a small fake diagram every few seconds.
import type { ChangeEvent, DataSource, FeedHandlers, FileDetail, FileSummary, Source } from './types';

interface MockCell {
  id: string;
  value: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}
interface MockEdge {
  id: string;
  source: string;
  target: string;
}
interface MockPage {
  id: string;
  name: string;
  cells: MockCell[];
  edges: MockEdge[];
}
interface MockFile {
  id: string;
  path: string;
  source: Source;
  pages: MockPage[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function pageXml(p: MockPage): string {
  const cells = p.cells.map(
    (c) =>
      `<mxCell id="${esc(c.id)}" value="${esc(c.value)}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${c.fill};" vertex="1" parent="1">` +
      `<mxGeometry x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" as="geometry"/></mxCell>`,
  );
  const edges = p.edges.map(
    (e) =>
      `<mxCell id="${esc(e.id)}" style="endArrow=classic;html=1;" edge="1" parent="1" source="${esc(e.source)}" target="${esc(e.target)}">` +
      `<mxGeometry relative="1" as="geometry"/></mxCell>`,
  );
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}${edges.join('')}</root></mxGraphModel>`;
}

function samplePages(prefix: string): MockPage[] {
  const steps = ['수집', '정제', '학습', '평가', '배포'];
  const cells = steps.map((v, i) => ({ id: `${prefix}s${i}`, value: v, x: 40 + i * 180, y: 80, w: 140, h: 60, fill: '#dae8fc' }));
  const edges = steps.slice(1).map((_, i) => ({ id: `${prefix}e${i}`, source: `${prefix}s${i}`, target: `${prefix}s${i + 1}` }));
  return [
    { id: 'p1', name: '파이프라인', cells, edges },
    {
      id: 'p2',
      name: '구성',
      cells: [
        { id: `${prefix}a`, value: 'web', x: 40, y: 40, w: 120, h: 50, fill: '#d5e8d4' },
        { id: `${prefix}b`, value: 'server', x: 240, y: 40, w: 120, h: 50, fill: '#fff2cc' },
      ],
      edges: [{ id: `${prefix}ab`, source: `${prefix}a`, target: `${prefix}b` }],
    },
  ];
}

const summary = (f: MockFile): FileSummary => ({ id: f.id, path: f.path, source: f.source, pages: f.pages.map(({ id, name }) => ({ id, name })) });

export function createMockSource({ intervalMs = 3000 } = {}): DataSource {
  const files: MockFile[] = [
    { id: 'main:docs/pipeline.drawio', path: 'docs/pipeline.drawio', source: { kind: 'main', label: 'main' }, pages: samplePages('') },
    { id: 'wt-impl:docs/pipeline.drawio', path: 'docs/pipeline.drawio', source: { kind: 'worktree', label: 'impl-2' }, pages: samplePages('') },
    { id: 'main:docs/serving.drawio', path: 'docs/serving.drawio', source: { kind: 'main', label: 'main' }, pages: samplePages('i').slice(1) },
  ];
  let tick = 0;

  function mutate(): ChangeEvent {
    const f = files[tick % 2];
    const page = f.pages[0];
    const step = tick++ % 4;
    let kinds: string[] = [];
    let cellIds: string[] = [];
    if (step === 0) {
      const c = page.cells[Math.floor(Math.random() * page.cells.length)];
      c.y = c.y === 80 ? 200 : 80;
      kinds = ['moved'];
      cellIds = [c.id];
    } else if (step === 1) {
      const c = page.cells[Math.floor(Math.random() * page.cells.length)];
      c.value = c.value.endsWith('✓') ? c.value.replace(/ ✓$/, '') : `${c.value} ✓`;
      kinds = ['text'];
      cellIds = [c.id];
    } else if (step === 2) {
      const id = `new${tick}`;
      page.cells.push({ id, value: '새 단계', x: 40 + Math.random() * 700, y: 320, w: 120, h: 50, fill: '#f8cecc' });
      kinds = ['added'];
      cellIds = [id];
    } else {
      const i = page.cells.findIndex((c) => c.id.startsWith('new'));
      if (i >= 0) {
        cellIds = [page.cells[i].id];
        page.cells.splice(i, 1);
        kinds = ['removed'];
      }
    }
    return { fileId: f.id, source: f.source, page: { id: page.id, name: page.name }, kinds, cellIds, bbox: null, at: Date.now() };
  }

  return {
    name: 'mock',
    async listFiles() {
      return files.map(summary);
    },
    async getFile(id): Promise<FileDetail> {
      const f = files.find((x) => x.id === id);
      if (!f) throw new Error(`no mock file ${id}`);
      return { id: f.id, path: f.path, source: f.source, pages: f.pages.map((p) => ({ id: p.id, name: p.name, xml: pageXml(p) })) };
    },
    subscribe(h: FeedHandlers) {
      h.onState?.('open');
      const t = setInterval(() => {
        const change = mutate();
        if (change.cellIds.length) h.onChange?.(change);
      }, intervalMs);
      return () => clearInterval(t);
    },
  };
}
