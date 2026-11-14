// The /dispatch screen: opens the event stream and shows the session board (cards or timeline), the usage screen
// or the always-on screen, picked by the URL hash (#timeline, #usage, #tv), with the session sheet on top.
// Loaded lazily from main.tsx so the editor bundle does not carry it.
import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { Alert } from '../components/ui/alert';
import { cn } from '../lib/utils';
import { useTheme } from '../theme';
import { AlwaysOnView } from './AlwaysOnView';
import { hashOf, viewOf, type View } from './lib/usage.ts';
import { SessionSheet } from './SessionSheet';
import { SessionsPage } from './SessionsPage';
import { SessionTimeline } from './SessionTimeline';
import { TaskBoardButton } from './TaskBoard';
import { UsagePage } from './UsagePage';
import { connect, useDispatch } from './store';

export { connect };

const NAV: { view: View; label: string }[] = [
  { view: 'sessions', label: '세션' },
  { view: 'timeline', label: '타임라인' },
  { view: 'usage', label: '사용량' },
];

/** The hash-picked view, following back/forward and links. */
function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => viewOf(location.hash));
  useEffect(() => {
    const on = () => setView(viewOf(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (v: View) => {
    const h = hashOf(v);
    if (h) location.hash = h;
    else history.pushState(null, '', location.pathname + location.search);
    setView(v);
  };
  return [view, go];
}

export default function DispatchApp() {
  useTheme();
  const ready = useDispatch(s => s.ready);
  const online = useDispatch(s => s.online);
  const unavailable = useDispatch(s => s.unavailable);
  const [open, setOpen] = useState<string | null>(null);
  const [view, go] = useView();
  useEffect(() => connect(), []);

  const offline = ready && !online && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>;
  const sheet = <SessionSheet id={open} onClose={() => setOpen(null)} />;

  if (view === 'tv' && ready && !unavailable) {
    return (
      <>
        {offline}
        {/* Opening a tile leaves the always-on screen, so Esc in the sheet never also closes the wall view. */}
        <AlwaysOnView onExit={() => go('sessions')} onOpen={id => { go('sessions'); setOpen(id); }} />
        {sheet}
      </>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6 max-md:px-4">
        <nav aria-label="세션 화면" className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {NAV.map(n => (
            <a
              key={n.view}
              href={hashOf(n.view) || location.pathname}
              aria-current={view === n.view ? 'page' : undefined}
              onClick={e => { e.preventDefault(); go(n.view); }}
              className={cn(
                'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                view === n.view && 'bg-muted text-foreground',
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <a
          href="#tv"
          onClick={e => { e.preventDefault(); go('tv'); }}
          title="벽 화면처럼 크게 띄워 둬요"
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Monitor aria-hidden className="size-3.5" />
          상시 화면
        </a>
      </header>
      {offline}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {unavailable ? (
          <p className="p-6 text-sm text-muted-foreground">이 서버에서는 세션 화면을 쓸 수 없어요.</p>
        ) : !ready ? (
          <p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>
        ) : view === 'usage' ? (
          <UsagePage />
        ) : view === 'timeline' ? (
          <SessionTimeline onOpen={setOpen} />
        ) : (
          <SessionsPage onOpen={setOpen} onUsage={() => go('usage')} actions={<TaskBoardButton />} />
        )}
      </main>
      {sheet}
    </div>
  );
}
