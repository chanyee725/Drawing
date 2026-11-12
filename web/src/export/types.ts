import type { ExportOptions } from './options';

/** What the open canvas offers to the rest of the app (export, palette, shortcuts). Set while a canvas is mounted. */
export type CanvasHandle = {
  /** How many things an export would contain: the selection, or everything when nothing is selected. */
  scope(): { selected: boolean; count: number };
  /** The scope as SVG text with its size, or null when the canvas is empty. */
  svg(o?: ExportOptions): Promise<{ svg: string; width: number; height: number } | null>;
  /** The scope as a PNG, or null when the canvas is empty. */
  png(o?: ExportOptions): Promise<Blob | null>;
  /** Send a key to the canvas as if typed there (tool keys, zoom, undo...). */
  key(k: { key: string; code?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean }): void;
  /** Layout edit mode for the one selected diagram block (design §5). */
  layout: {
    /** Whether one block is selected (or edited), edit mode is on, and that block has a moved layout. */
    state(): { block: boolean; graph: boolean; editing: boolean; moved: boolean };
    /** Enter edit mode for the selected block (or say why not on the canvas); leave it when already on. */
    edit(): void;
    /** Drop the block's moved layout, as one undo step. */
    reset(): void;
    /** Replace the selected graph block with plain shapes, as one undo step (or say why not on the canvas). */
    freeform(): void;
  };
};
