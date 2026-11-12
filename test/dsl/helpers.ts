import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}.eraser`, import.meta.url)), 'utf8');
}

/** Compact `line:column+length message` form for exact position assertions. */
export function fmt(diagnostics: { line: number; column: number; length: number; severity: string; message: string }[]): string[] {
  return diagnostics.map((d) => `${d.severity} ${d.line}:${d.column}+${d.length} ${d.message}`);
}
