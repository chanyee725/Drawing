import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('../public', import.meta.url));
// Excalidraw's own fonts (OFL/MIT, shipped in the npm package). Served from /excalidraw/fonts/
// so the canvas never falls back to its CDN.
const excalidrawFonts = fileURLToPath(new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts', import.meta.url));
const ASSET_BASE = '/excalidraw/';
const FONT_PREFIX = `${ASSET_BASE}fonts/`;
const FALLBACK_RE = /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/\$\{[^`]*`[^`]*`[^`]*\}\/dist\/prod\/`\)/;

function excalidrawAssets(): Plugin {
  return {
    name: 'excalidraw-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(FONT_PREFIX)) return next();
        const file = normalize(join(excalidrawFonts, decodeURIComponent(url.slice(FONT_PREFIX.length))));
        if (!file.startsWith(excalidrawFonts + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    // Excalidraw always appends https://esm.sh/... as a second font source. Point that fallback at
    // our own copy too, so no font request can leave the machine. Fails the build if the code moves.
    transform(code, id) {
      if (!id.includes('/@excalidraw/excalidraw/dist/prod/') || !code.includes('ASSETS_FALLBACK_URL",`https://esm.sh/')) return null;
      const out = code.replace(FALLBACK_RE, `"ASSETS_FALLBACK_URL",window.location.origin+"${ASSET_BASE}")`);
      if (out === code) this.error('excalidraw-assets: CDN fallback URL not found; update FALLBACK_RE');
      return { code: out, map: null };
    },
    writeBundle() {
      cpSync(excalidrawFonts, join(outDir, FONT_PREFIX), { recursive: true });
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), excalidrawAssets()],
  publicDir: false,
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: '127.0.0.1',
    // changeOrigin: the server rejects Host headers other than its own port.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.DRAW_PORT ?? 4330}`, changeOrigin: true } },
  },
});
