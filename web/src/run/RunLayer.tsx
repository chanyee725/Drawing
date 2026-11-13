// The progress board layer (design §5.1): one transparent SVG over a block picture, in the picture's own (scene)
// coordinates, so it scales with the picture. Draws rings, a glyph corner badge and a "state · agent" label per step
// and traces active edges. Never touches the picture, the canvas elements or the file.
// The same component draws on the canvas (RunOverlay) and in the document's diagram embed (DiagramView).
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { progressLabel } from '../../../shared/dispatch/step-view.ts';
import type { Scene } from '../../../shared/render/index.ts';
import { badgeRect } from '../../../shared/render/badge.ts';
import { boardShown, legendOf, legendSpot, overlayModel, pathData, runProgress, type OverlayNode, type RunStep, type Size } from './overlayModel';
import { setStill, useStill } from './runStore';

type Props = {
  scene: Scene;
  steps: readonly RunStep[];
  /** Where the picture's top-left sits in the positioned parent, in CSS px. */
  left: number;
  top: number;
  /** CSS px per scene unit (picture scale × zoom). */
  scale: number;
  /** No room above the picture (it touches the top of a clipped view): the motion switch sits inside its corner. */
  motionInside?: boolean;
};

/** Below this scale the labels are too small to read and hidden (§5 "hidden below 40 % zoom"). */
const MIN_LABEL_SCALE = 0.4;
const PAD = 5;
const LABEL_FONT = 11;
/** How far a step label reaches under its node (scene units): the room the canvas legend leaves under the picture. */
const LABEL_REACH = PAD + 4 + 18;

/** Rough text width for the label plate: Hangul and other wide characters about one em, the rest about 0.6 em. */
export function textWidth(s: string, size = LABEL_FONT): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : ch === ' ' ? size * 0.3 : size * 0.6;
  return Math.ceil(w);
}

export function RunLayer({ scene, steps, left, top, scale, motionInside }: Props) {
  const model = useMemo(() => overlayModel(scene, steps), [scene, steps]);
  const still = useStill();
  if (!model.nodes.length) return null;
  const moving = model.nodes.some((n) => n.live) || model.edges.some((e) => e.kind === 'flow');
  const labels = scale >= MIN_LABEL_SCALE;
  return (
    <div className="run-layer" data-run-layer="" data-still={still ? '' : undefined} data-motion-inside={motionInside ? '' : undefined} style={{ left, top, width: scene.width * scale, height: scene.height * scale }}>
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
  // The same chip as a diagram node's `badge:` (shared/render/badge.ts), drawn as an outline in the step colour.
  const chip = badgeRect(x + w + PAD, y - PAD, textWidth(n.glyph));
  return (
    <g role="img" aria-label={n.label} data-step={n.step} data-view={n.view} style={{ color: n.color }}>
      <rect className={`run-ring${n.live ? ' is-live' : ''}`} data-view={n.view} x={x - PAD} y={y - PAD} width={w + PAD * 2} height={h + PAD * 2} rx={10} />
      <g className="run-corner" aria-hidden="true">
        <rect x={chip.x} y={chip.y} width={chip.w} height={chip.h} rx={chip.h / 2} />
        <text x={chip.x + chip.w / 2} y={chip.y + chip.h / 2} textAnchor="middle" dominantBaseline="central">
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

/**
 * The canvas legend: placed in overlay px on the side of the picture with room (`legendSpot`), measured after it
 * renders so the clamp knows its size. Shown only when the board is (`boardShown`), like the document's.
 */
export function CanvasLegend({ scene, steps, left, top, scale, area }: Omit<Props, 'motionInside'> & { area: Size }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const shown = useMemo(() => boardShown(scene, steps), [scene, steps]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((old) => (old && old.width === el.offsetWidth && old.height === el.offsetHeight ? old : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown]);
  if (!shown) return null;
  const pic = { left, top, width: scene.width * scale, height: scene.height * scale };
  const at = size && area.width > 0 ? legendSpot(pic, size, area, 12, LABEL_REACH * scale) : null;
  return <RunLegend ref={ref} steps={steps} canvas style={at ? { left: at.left, top: at.top } : { visibility: 'hidden' }} />;
}

/**
 * The board's legend (§5.1): the weighted progress bar and text, then a collapsible list of the agents and states in
 * the run. Beside the picture on the canvas (`CanvasLegend`) and under the picture in the document, so it never
 * covers a node.
 */
export function RunLegend({ steps, canvas, style, ref }: { steps: readonly RunStep[]; canvas?: boolean; style?: CSSProperties; ref?: Ref<HTMLDivElement> }) {
  const id = useId();
  const p = useMemo(() => runProgress(steps), [steps]);
  const legend = useMemo(() => legendOf(steps), [steps]);
  return (
    <div ref={ref} className="run-legend" data-run-legend="" data-canvas={canvas ? '' : undefined} style={style}>
      <p id={id} className="run-legend-progress">
        {progressLabel(p)}
      </p>
      {p.total > 0 && <progress className="run-progress" value={p.percent} max={100} aria-labelledby={id} />}
      <details open>
        <summary>범례</summary>
        <ul aria-label="에이전트">
          {legend.agents.map((a) => (
            <li key={a.name}>
              <span className="run-swatch" aria-hidden="true" style={{ background: a.color }} />
              <span>{a.name}</span>
              <span className="run-legend-dim">
                {a.roleName}
                {a.model ? ` · ${a.model}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <ul aria-label="상태">
          {legend.states.map((s) => (
            <li key={s.view}>
              <span className="run-legend-glyph" aria-hidden="true" style={{ color: s.color }}>
                {s.glyph}
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
