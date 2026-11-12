import { lazy, Suspense } from 'react';
import type { Block } from './api';
import type { CanvasData } from './canvas/ExcalidrawCanvas';

// Excalidraw is large; load it only when a canvas is shown.
const ExcalidrawCanvas = lazy(() => import('./canvas/ExcalidrawCanvas'));

type Props = {
  /** Changes when a different file (or a fresh copy from disk) is loaded; the canvas restarts. */
  fileKey: string | null;
  canvas: unknown;
  blocks: Block[];
  dark: boolean;
  onChange: (patch: { canvas?: CanvasData; blocks?: Block[] }) => void;
};

const asCanvas = (c: unknown): CanvasData => {
  const o = (c && typeof c === 'object' ? c : {}) as Partial<CanvasData>;
  return { elements: Array.isArray(o.elements) ? o.elements : [], appState: o.appState && typeof o.appState === 'object' ? o.appState : {} };
};

export function CanvasPane({ fileKey, canvas, blocks, dark, onChange }: Props) {
  if (fileKey === null)
    return (
      <main className="flex h-full min-h-64 flex-1 items-center justify-center p-6" aria-label="캔버스">
        <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>
          파일을 고르면 여기에 그려져요.
        </p>
      </main>
    );
  return (
    <main className="relative h-full min-h-96 flex-1" aria-label="캔버스">
      <Suspense
        fallback={
          <p className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            캔버스를 불러오는 중이에요…
          </p>
        }
      >
        <ExcalidrawCanvas key={fileKey} canvas={asCanvas(canvas)} blocks={blocks} dark={dark} onChange={onChange} />
      </Suspense>
    </main>
  );
}
