// The canvas notice for a block that could not be drawn from its current code (pure, so it can be tested).

export type BrokenBlock = { id: string; type: string; errors: number; /** The picture shown is an earlier good one. */ lastGood: boolean; /** The renderer itself failed. */ failed: boolean };

/** Which block, when there are several: its type label and its 1-based position among blocks of that type. Empty for a lone block. */
export function blockLabel(block: { id: string; type: string }, blocks: readonly { id: string; type: string }[], typeLabel: string): string {
  if (blocks.length < 2) return '';
  const i = blocks.filter((b) => b.type === block.type).findIndex((b) => b.id === block.id);
  return `${typeLabel} ${i < 0 ? 1 : i + 1} · `;
}

/** One line for the notice button. `label` comes from `blockLabel`. */
export function brokenNotice(b: BrokenBlock, label = ''): string {
  const what = b.failed ? '그리지 못했어요' : `오류 ${b.errors}개`;
  const shown = b.lastGood ? '마지막으로 그린 모습이에요' : '아직 그린 적이 없어요';
  return `${label}${what} · ${shown}. 눌러서 코드를 고쳐요`;
}
