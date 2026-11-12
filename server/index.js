#!/usr/bin/env node
// Entry point: parse CLI args, start the server, print the URL.
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { createApp } from './app.js';
import { parseArgs, USAGE } from './cli.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4330;

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(1);
}
opts.workspaceDir = resolve(opts.workspaceDir);
try {
  if (!statSync(opts.workspaceDir).isDirectory()) throw new Error();
} catch {
  console.error(`Not a directory: ${opts.workspaceDir}`);
  process.exit(1);
}

const port = Number(process.env.DRAW_PORT) || DEFAULT_PORT;
const app = await createApp(opts);
app.server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Pick another one: DRAW_PORT=<port> npm start -- <workspace-dir>`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  await app.close().catch(() => {});
  process.exit(1);
});
app.server.listen(port, HOST, () => {
  console.log(`Draw-Pipelines: http://${HOST}:${port}/  (workspace ${opts.workspaceDir})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
