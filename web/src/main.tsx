import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Excalidraw loads its fonts from here (bundled by vite.config.ts) instead of a CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';

// Dev-only check hook (stripped from builds): `?runFixture=<blockId>` shows the fixture run over that block,
// `&runBlocked` with the test step blocked. The block's code should be FIXTURE_CODE.
if (import.meta.env.DEV) {
  const q = new URLSearchParams(location.search);
  const id = q.get('runFixture');
  if (id) void import('./run/fixture').then(async (f) => (await import('./run/runStore')).setRunSteps(id, q.has('runBlocked') ? f.FIXTURE_BLOCKED : f.FIXTURE_STEPS));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
