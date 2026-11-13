// The canvas `/` insert menu: type `/` on the canvas, filter by typing, Enter (or a click) inserts at the pointer.
import { useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, convertToExcalidrawElements, viewportCoordsToSceneCoords } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import type { Block } from '../api';
import { TEMPLATES } from '../dsl/templates';
import { diagramBlock, filterInsert, shapeSkeleton, type InsertItem } from './insert';
import { renderBlock } from './render';
import { newBlockId } from './sync';
import { Input } from '../components/ui/input';

type Props = {
  api: ExcalidrawImperativeAPI | null;
  wrap: { current: HTMLDivElement | null };
  /** A new diagram block to add (already placed at the pointer when its picture size is known). */
  onBlock: (b: Block) => void;
};

/** Where the menu opened: client coordinates (where things go) and the menu's spot inside the canvas box. */
type Spot = { clientX: number; clientY: number; left: number; top: number };

const MENU_W = 256;
const MENU_H = 320;

const typingTarget = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable], aside');

export function CanvasInsertMenu({ api, wrap, onBlock }: Props) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const items = filterInsert(query);

  // `/` on the canvas opens the menu at the pointer (or the middle when the pointer is elsewhere).
  useEffect(() => {
    const el = wrap.current;
    if (!el || !api) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typingTarget(e.target)) return;
      if (api.getAppState().editingTextElement) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      const p = pointer.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      // Keep the menu inside the canvas box.
      const left = Math.max(8, Math.min(p.x - r.left, r.width - MENU_W - 8));
      const top = Math.max(8, Math.min(p.y - r.top, r.height - MENU_H - 8));
      setQuery('');
      setActive(0);
      setSpot({ clientX: p.x, clientY: p.y, left, top });
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('keydown', onKey, true);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('keydown', onKey, true);
    };
  }, [api, wrap]);

  // A press anywhere outside the menu closes it.
  useEffect(() => {
    if (!spot) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setSpot(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [spot]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => {
    setSpot(null);
    wrap.current?.querySelector<HTMLElement>('.excalidraw')?.focus({ preventScroll: true });
  };

  const insert = (item: InsertItem) => {
    if (!api || !spot) return;
    const at = viewportCoordsToSceneCoords({ clientX: spot.clientX, clientY: spot.clientY }, api.getAppState());
    close();
    if (item.kind === 'diagram') {
      const type = item.diagramType;
      const id = newBlockId();
      void renderBlock({ id, type, code: TEMPLATES[type], x: 0, y: 0, w: 0, h: 0 }, 'light')
        .then(
          (p) => onBlock(diagramBlock(id, type, at, p)),
          () => onBlock(diagramBlock(id, type, at, null)),
        );
      return;
    }
    const els = convertToExcalidrawElements([shapeSkeleton(item.kind, at) as unknown as ExcalidrawElementSkeleton]);
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...els],
      appState: { selectedElementIds: Object.fromEntries(els.map((e) => [e.id, true])) },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  };

  if (!spot) return null;
  return (
    <div
      ref={box}
      className="doc-slash canvas-insert absolute z-20"
      style={{ left: spot.left, top: spot.top, width: MENU_W, maxHeight: MENU_H }}
      onBlur={(e) => {
        // Tabbing out leaves the menu: close it so keys don't go somewhere unseen.
        if (!box.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        // Korean IME: the Enter that commits a syllable is not a pick (Chrome marks it composing, Safari sends keyCode 229).
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowDown' && items.length) setActive((i) => (i + 1) % items.length);
        else if (e.key === 'ArrowUp' && items.length) setActive((i) => (i - 1 + items.length) % items.length);
        else if (e.key === 'Enter' && items[active]) insert(items[active]);
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Input
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="canvas-insert-list"
        aria-activedescendant={items[active] ? `canvas-insert-${items[active].id}` : undefined}
        aria-label="넣을 것 찾기"
        placeholder="찾기…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
      />
      <div ref={list} id="canvas-insert-list" role="listbox" aria-label="캔버스에 넣기">
        {items.length === 0 ? (
          <p className="doc-slash-empty">맞는 항목이 없어요</p>
        ) : (
          items.map((it, i) => (
            <button
              key={it.id}
              id={`canvas-insert-${it.id}`}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              // Keep focus in the search box so the blur-to-close above doesn't fire on a click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(it)}
            >
              <span>{it.title}</span>
              <span className="doc-slash-hint">{it.hint}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
