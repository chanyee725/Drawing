/** Copies text to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not allowed (no permission, or no clipboard API): fall back to a hidden selection.
    // Selecting the textarea steals focus and the selection from the editor; put both back afterwards.
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sel = document.getSelection();
    const ranges = sel ? Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)) : [];
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    if (active && active !== document.body && active.isConnected) active.focus({ preventScroll: true });
    if (sel && ranges.length) {
      sel.removeAllRanges();
      for (const r of ranges) sel.addRange(r);
    }
    return ok;
  }
}
