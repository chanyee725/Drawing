// Which panes the document screen shows (design doc 6 §6). Pure, so it is tested without a browser.

/** 문서 only, 둘 다 side by side, or 캔버스 only. */
export type View = 'doc' | 'both' | 'canvas';

/** The view shown for the stored one: narrow screens fit one pane, so 'both' shows the document. */
export const shownView = (stored: View, narrow: boolean): View => (narrow && stored === 'both' ? 'doc' : stored);

/** The view after asking to show something on the canvas: next to the document, or instead of it on a narrow screen. */
export const toCanvas = (stored: View, narrow: boolean): View => (narrow ? 'canvas' : stored === 'doc' ? 'both' : stored);
