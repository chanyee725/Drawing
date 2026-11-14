// Texts that changed font (cleanStyle.ts) before Excalidraw's copy of the clean font had loaded were measured with
// a fallback font. They wait here and are measured again once the font is in (E58, #305).
import { refitTexts, type FitEl } from './refit.ts';

export class RefitQueue {
  private ids = new Set<string>();
  private readonly fontLoaded: () => boolean;

  /** `fontLoaded` tells whether the clean font has loaded (injected, so tests need no browser). */
  constructor(fontLoaded: () => boolean) {
    this.fontLoaded = fontLoaded;
  }

  /** How many texts are waiting. */
  get size(): number {
    return this.ids.size;
  }

  /** The texts waiting, for tests. */
  waiting(): string[] {
    return [...this.ids];
  }

  /** Texts just measured: those measured before the clean font loaded wait for it. */
  measured(ids: Iterable<string>): void {
    if (this.fontLoaded()) return;
    for (const id of ids) this.ids.add(id);
  }

  /** Nothing waits any more (another file is shown). */
  clear(): void {
    this.ids.clear();
  }

  /**
   * `scene` with the waiting texts measured again, or null when there is nothing to do yet: no scene, nothing
   * waiting or the font not loaded. Versions stay as they are (as when opening): the new size is saved with the
   * next edit. A text not in the scene yet keeps waiting: the font can load before the opened file's texts enter
   * the scene, and the canvas runs the queue again on its next change (#305).
   */
  take<T extends FitEl>(scene: readonly T[] | null, measure: (els: T[]) => readonly T[]): { elements: readonly T[]; changed: boolean } | null {
    if (!scene || !this.ids.size || !this.fontLoaded()) return null;
    const now = new Set<string>();
    for (const e of scene) if (this.ids.delete(e.id)) now.add(e.id);
    if (!now.size) return null;
    return refitTexts(scene, now, measure);
  }
}
