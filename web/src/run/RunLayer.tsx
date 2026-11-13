// The progress board layer (design §5.1): one transparent SVG over a block picture, in the picture's own (scene)
// coordinates, so it scales with the picture. Draws rings, a glyph corner badge and a "state · agent" label per step
// and traces active edges. Never touches the picture, the canvas elements or the file.
// The same component draws on the canvas (RunOverlay) and in the document's diagram embed (DiagramView).
import { useMemo } from 'react';
import type { Scene } from '../../../shared/render/index.ts';
import { overlayModel, pathData, type OverlayNode, type RunStep } from './overlayModel';
import { setStill, useStill } from './runStore';

type Props = {
  scene: Scene;
  steps: readonly RunStep[];
  /** Where the picture's top-left sits in the positioned parent, in CSS px. */
  left: number;
  top: number;
  /** CSS px per scene unit (picture scale × zoom). */
  scale: number;
};

/** Below this scale the labels are too small to read and hidden (§5 "hidden below 40 % zoom"). */
const MIN_LABEL_SCALE = 0.4;
const PAD = 5;
const LABEL_FONT = 11;

/** Rough text width for the label plate: Hangul and other wide characters about one em, the rest about 0.6 em. */
export function textWidth(s: string, size = LABEL_FONT): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.6;
  return Math.ceil(w);
}

export function RunLayer({ scene, steps, left, top, scale }: Props) {
  const model = useMemo(() => overlayModel(scene, steps), [scene, steps]);
  const still = useStill();
  if (!model.nodes.length) return null;
  const moving = model.nodes.some((n) => n.live) || model.edges.some((e) => e.kind === 'flow');
  const labels = scale >= MIN_LABEL_SCALE;
  return (
    <div className="run-layer" data-run-layer="" data-still={still ? '' : undefined} style={{ left, top, width: scene.width * scale, height: scene.height * scale }}>
      <svg role="group" aria-label="실행 상태" viewBox={`0 0 ${scene.width} ${scene.height}`} width="100%" height="100%" overflow="visible">
        {model.edges.map((e) => (
          <path key={e.key} className="run-edge" data-edge-kind={e.kind} d={pathData(e.points)} stroke={e.color} />
        ))}
        {model.nodes.map((n) => (
          <Step key={n.node} n={n} labels={labels} />
        ))}
      </svg>
      {moving && (
        <button type="button" className="run-motion" onClick={() => setStill(!still)}>
          {still ? '움직임 켜기' : '움직임 멈추기'}
        </button>
      )}
    </div>
  );
}

function Step({ n, labels }: { n: OverlayNode; labels: boolean }) {
  const { x, y, w, h } = n.rect;
  const text = n.waiting ? `${n.glyph} ${n.text} · 사람 기다림` : `${n.glyph} ${n.text}`;
  const tw = textWidth(text) + 12;
  const cx = x + w / 2;
  const ly = y + h + PAD + 4;
  return (
    <g role="img" aria-label={n.label} data-step={n.step} data-view={n.view} style={{ color: n.color }}>
      <rect className={`run-ring${n.live ? ' is-live' : ''}`} data-view={n.view} x={x - PAD} y={y - PAD} width={w + PAD * 2} height={h + PAD * 2} rx={10} />
      <g className="run-corner" aria-hidden="true">
        <circle cx={x + w + PAD} cy={y - PAD} r={9} />
        <text x={x + w + PAD} y={y - PAD} textAnchor="middle" dominantBaseline="central">
          {n.glyph}
        </text>
      </g>
      {labels && (
        <g className="run-label" aria-hidden="true">
          <rect x={cx - tw / 2} y={ly} width={tw} height={18} rx={9} />
          <text x={cx} y={ly + 9} textAnchor="middle" dominantBaseline="central">
            {text}
          </text>
        </g>
      )}
    </g>
  );
}
