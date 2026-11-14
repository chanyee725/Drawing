// Texts that changed font (cleanStyle.ts) before Excalidraw's copy of the clean font had loaded would be measured
// with a fallback font (and could grow their shape for good). They wait here and are measured once the font is in
// (E58, #305).
import { refitTexts, type FitEl } from './refit.ts';

export class RefitQueue {
  /** Waiting text id → whether its measured size is a new version (a paste, saved then) or not (opening). */
  private ids = new Map<string, boolean>();
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
    return [...this.ids.keys()];
  }

  /**
   * Texts that changed font wait for the clean font, unless it has loaded. `bump`: their measured size becomes a
   * new version (a paste); otherwise versions stay (opening writes nothing). A text queued both ways is bumped.
   */
  wait(ids: Iterable<string>, bump = false): void {
    if (this.fontLoaded()) return;
    for (const id of ids) this.ids.set(id, bump || !!this.ids.get(id));
  }

  /** Nothing waits any more (another file is shown). */
  clear(): void {
    this.ids.clear();
  }

  /**
   * `scene` with the waiting texts measured, or null when there is nothing to do yet: no scene, nothing waiting or
   * the font not loaded. Texts queued without `bump` keep their versions (the new size is saved with the next edit);
   * those queued with it go through `bumped`, required so a pasted text is never saved without a new version. A text
   * not in the scene yet keeps waiting: the font can load before the opened file's texts enter the scene, and the
   * canvas runs the queue again on its next change (#305).
   */
  take<T extends FitEl>(
    scene: readonly T[] | null,
    measure: (els: T[]) => readonly T[],
    bumped: (el: T, patch: Partial<FitEl>) => T,
  ): { elements: readonly T[]; changed: boolean } | null {
    if (!scene || !this.ids.size || !this.fontLoaded()) return null;
    const kept = new Set<string>();
    const bump = new Set<string>();
    for (const e of scene) {
      const b = this.ids.get(e.id);
      if (b === undefined) continue;
      this.ids.delete(e.id);
      (b ? bump : kept).add(e.id);
    }
    if (!kept.size && !bump.size) return null;
    const first = kept.size ? refitTexts(scene, kept, measure) : { elements: scene, changed: false };
    const second = bump.size ? refitTexts(first.elements, bump, measure, bumped) : { elements: first.elements, changed: false };
    return { elements: second.elements, changed: first.changed || second.changed };
  }
}
