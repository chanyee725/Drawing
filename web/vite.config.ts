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
// Matches both the minified prod chunk and the readable dev chunk (`"X", \`...\``).
const FALLBACK_RE = /"ASSETS_FALLBACK_URL",\s*`https:\/\/esm\.sh\/\$\{[^`]*`[^`]*`[^`]*\}\/dist\/prod\/`\)/;
const EXCALIDRAW_DIST_RE = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](dev|prod)[\\/]/;

/**
 * Excalidraw always appends https://esm.sh/... as a second font source. Point that fallback at our
 * own copy, so no font request can leave the machine. Throws if the code moves, so a dependency
 * update cannot silently bring the CDN back.
 */
function stripCdnFallback(code: string, id: string): string | null {
  if (!EXCALIDRAW_DIST_RE.test(id) || !code.includes('ASSETS_FALLBACK_URL')) return null;
  if (!code.includes('https://esm.sh/')) return null;
  const out = code.replace(FALLBACK_RE, `"ASSETS_FALLBACK_URL",window.location.origin+"${ASSET_BASE}")`);
  if (out === code || out.includes('https://esm.sh/')) throw new Error('excalidraw-assets: CDN fallback URL not found; update FALLBACK_RE');
  return out;
}

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
    transform(code, id) {
      const out = stripCdnFallback(code, id);
      return out === null ? null : { code: out, map: null };
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
  // The dev server pre-bundles Excalidraw (dist/dev/) outside the plugin pipeline above, so the
  // same rewrite runs inside the dependency optimizer too.
  optimizeDeps: {
    rolldownOptions: {
      plugins: [
        {
          name: 'excalidraw-assets-deps',
          transform(code: string, id: string) {
            const out = stripCdnFallback(code, id);
            return out === null ? null : { code: out, map: null };
          },
        },
      ],
    },
  },
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
