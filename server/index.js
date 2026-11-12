#!/usr/bin/env node
// Entry point: parse CLI args, start the server, print the URL.
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { createApp } from './app.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4330;

function parseArgs(argv) {
  const opts = { projectDir: null, dispatch: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dispatch') opts.dispatch = argv[++i];
    else if (!opts.projectDir) opts.projectDir = a;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.projectDir) {
  console.error('Usage: npm start -- <project-dir> [--dispatch <url>]');
  process.exit(1);
}
opts.projectDir = resolve(opts.projectDir);
try {
  if (!statSync(opts.projectDir).isDirectory()) throw new Error();
} catch {
  console.error(`Not a directory: ${opts.projectDir}`);
  process.exit(1);
}

const port = Number(process.env.DRAW_PORT) || DEFAULT_PORT;
const app = await createApp(opts);
app.server.listen(port, HOST, () => {
  console.log(`Draw-Pipelines: http://${HOST}:${port}/  (watching ${opts.projectDir})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
