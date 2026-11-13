// The current turn and the "지금 …" line. Pure.
import { totalTok } from './format.ts';
import type { Session } from '../../../../shared/dispatch/types.ts';

type TurnFields = { turnStartedAt?: number; turnTokensBase?: number; asksUser?: boolean };

/** Current turn's start and tokens, from the server's turn baseline (none on older servers). */
export function turn(s: Session): { at?: number; tokens?: number } {
  const t = s as Session & TurnFields;
  if (!t.turnStartedAt) return {};
  return { at: t.turnStartedAt, tokens: totalTok(s.usage) - (t.turnTokensBase ?? 0) };
}

/** True when the session ended its turn asking the user and waits for an answer (not a permission prompt). */
export function awaitsAnswer(s: Session): boolean {
  const t = s as Session & TurnFields;
  return !!t.asksUser && s.state === 'waiting' && s.pending.length === 0;
}

/**
 * The "지금 …" line: what a running session is doing, from `s.activity` only. The activity is a category
 * name the server keeps in memory ("단위 테스트", "파일 수정"), never the command text, and this reads
 * nothing else (not `last`, not the transcript) so command text cannot reach the board.
 */
export function nowLine(s: Pick<Session, 'activity'>): { label: string; since: number } | null {
  const a = s.activity;
  if (!a || typeof a.label !== 'string' || !a.label) return null;
  return { label: a.label, since: a.since };
}
