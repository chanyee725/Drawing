import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LazyBoundary } from './LazyBoundary';
import './index.css';

// Excalidraw loads its fonts from here (bundled by vite.config.ts) instead of a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

// The Dispatch screens load only on /dispatch, so the editor bundle does not carry them.
const DispatchApp = lazy(() => import('./dispatch/index'));
const isDispatch = /^\/dispatch(\/|$)/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDispatch ? (
      <LazyBoundary>
        <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">불러오는 중이에요…</p>}>
          <DispatchApp />
        </Suspense>
      </LazyBoundary>
    ) : (
      <App />
    )}
  </StrictMode>,
);
