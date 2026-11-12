/** What the open canvas offers to the rest of the app (export, palette, shortcuts). Set while a canvas is mounted. */
export type CanvasHandle = {
  /** How many things an export would contain: the selection, or everything when nothing is selected. */
  scope(): { selected: boolean; count: number };
  /** The scope as SVG text with its size, or null when the canvas is empty. */
  svg(): Promise<{ svg: string; width: number; height: number } | null>;
  /** The scope as a PNG, or null when the canvas is empty. */
  png(): Promise<Blob | null>;
  /** Send a key to the canvas as if typed there (tool keys, zoom, undo...). */
  key(k: { key: string; code?: string; ctrl?: boolean; shift?: boolean; alt?: boolean }): void;
};
