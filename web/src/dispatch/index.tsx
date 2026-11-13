// The /dispatch screen: opens the event stream and shows the session board with the session sheet.
// Loaded lazily from main.tsx so the editor bundle does not carry it.
import { useEffect, useState } from 'react';
import { Alert } from '../components/ui/alert';
import { useTheme } from '../theme';
import { SessionSheet } from './SessionSheet';
import { SessionsPage } from './SessionsPage';
import { connect, useDispatch } from './store';

export { connect };

export default function DispatchApp() {
  useTheme();
  const ready = useDispatch(s => s.ready);
  const online = useDispatch(s => s.online);
  const unavailable = useDispatch(s => s.unavailable);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => connect(), []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6 max-md:px-4">
        <h1 className="text-sm font-semibold">세션</h1>
      </header>
      {ready && !online && <Alert variant="destructive">서버와 연결이 끊겼어요. 다시 연결하는 중이에요.</Alert>}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {unavailable ? (
          <p className="p-6 text-sm text-muted-foreground">이 서버에서는 세션 화면을 쓸 수 없어요.</p>
        ) : !ready ? (
          <p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>
        ) : (
          <SessionsPage onOpen={setOpen} />
        )}
      </main>
      <SessionSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
