// Small shared pieces of the Dispatch screens: state badge, usage meter, model tag.
import { Circle, CircleAlert, CircleCheck, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { cn } from '../lib/utils';
import { STATE, TONE_TEXT, level, levelTone, type Tone } from './lib/format.ts';
import type { SessionState } from './types';

const PROVIDER: Record<string, string> = { claude: 'Claude', openai: 'GPT', gemini: 'Gemini' };

/** Provider and model as one neutral tag. No provider colours: the name says which one it is. */
export function ModelTag({ provider, label, className }: { provider: string; label: string; className?: string }) {
  return (
    <Badge variant="secondary" title={label} className={cn('max-w-full min-w-0 shrink gap-1 rounded-md px-1.5 font-normal', className)}>
      <span className="shrink-0 font-semibold">{PROVIDER[provider] ?? provider}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </Badge>
  );
}

// Shape per state, so a badge reads without colour (shape + colour + label).
const STATE_ICON: Record<SessionState, LucideIcon> = {
  working: LoaderCircle, waiting: CircleAlert, stuck: TriangleAlert, failed: CircleX, resting: Circle, done: CircleCheck,
};

export function StatusBadge({ state, className }: { state: SessionState; className?: string }) {
  const s = STATE[state] ?? STATE.resting;
  const Icon = STATE_ICON[state] ?? Circle;
  return (
    <Badge variant="outline" data-state={state} className={cn('gap-1 pl-1.5 text-foreground/80', className)}>
      <Icon aria-hidden className={cn('size-3.5!', TONE_TEXT[s.tone])} strokeWidth={s.tone === 'warn' || s.tone === 'bad' ? 2.5 : 2} />
      {s.label}
    </Badge>
  );
}

const FILL: Record<Tone | 'none', string> = {
  ok: '[&>[data-slot=progress-indicator]]:bg-ok',
  warn: '[&>[data-slot=progress-indicator]]:bg-warn',
  bad: '[&>[data-slot=progress-indicator]]:bg-destructive',
  idle: '[&>[data-slot=progress-indicator]]:bg-muted-foreground',
  none: '[&>[data-slot=progress-indicator]]:bg-muted-foreground',
};

/**
 * Thin bar (0–1). By default the fill follows the usage-limit ok / warn / failure thresholds; `neutral` is for
 * shares of a whole (cost per role or session), where a full bar is not a warning.
 */
export function Meter({ value, label, className, neutral }: { value: number | null; label: string; className?: string; neutral?: boolean }) {
  const v = Math.min(1, Math.max(0, value ?? 0));
  return (
    <Progress
      value={Math.round(v * 100)}
      aria-label={label}
      data-tone={neutral ? 'neutral' : levelTone(level(value))}
      className={cn('h-1.5 bg-muted', FILL[neutral ? 'none' : levelTone(level(value))], className)}
    />
  );
}
