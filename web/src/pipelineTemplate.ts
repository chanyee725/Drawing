// Starting content of a new pipeline file (E18): a document with 목표/단계/위험 sections and the diagram embedded,
// one flowchart block whose nodes are the steps, and a `plan` drawn in that block (docs/workspace-api.md "Pipeline `plan`").
import type { Block, DpxFile } from './api.ts';
import { fileStem } from './fileName.ts';
import { DIAGRAM_NODE, type DocNode } from './doc/model.ts';

/** Folder a pipeline goes in when its name has none. */
export const PIPELINE_DIR = 'pipelines';

/** Workspace path (no suffix) for a typed pipeline name: a bare name goes under `pipelines/`. '' when the name is empty. */
export function pipelinePath(name: string): string {
  const stem = fileStem(name).replace(/^\/+|\/+$/g, '');
  if (!stem) return '';
  return stem.includes('/') ? stem : `${PIPELINE_DIR}/${stem}`;
}

export const PIPELINE_STEPS = ['계획', '구현', '리뷰'] as const;

const FLOWCHART = `direction right

계획 [shape: oval, color: blue]
구현
리뷰 [shape: diamond, color: green]

계획 > 구현 > 리뷰
`;

const heading = (text: string): DocNode => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text }] });
const paragraph = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });

/** Template content for `api.createFile`. `blockId` is the new flowchart block's id. */
export function pipelineTemplate(blockId: string): Pick<DpxFile, 'document' | 'blocks' | 'plan'> {
  // w/h 0: the canvas places and sizes an unplaced block on first open.
  const block: Block = { id: blockId, type: 'flowchart', code: FLOWCHART, x: 0, y: 0, w: 0, h: 0 };
  return {
    document: {
      type: 'doc',
      content: [
        heading('목표'),
        paragraph('이 파이프라인으로 무엇을 끝낼지 적어 주세요.'),
        heading('단계'),
        { type: DIAGRAM_NODE, attrs: { blockId } },
        paragraph('단계마다 할 일을 적어 주세요. 화살표 순서대로 실행해요.'),
        heading('위험'),
        paragraph('막힐 만한 점과 되돌리는 방법을 적어 주세요.'),
        { type: 'paragraph' },
      ],
    },
    blocks: [block],
    plan: { v: 1, block: blockId, defaults: { perm: 'manual', n: 1 }, steps: PIPELINE_STEPS.map((s) => ({ id: s, node: s })) },
  };
}
