import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import type { RegisteredTool } from './interfaces/tool.interface';

/**
 * Test-only: every tool the backend registers, built from the source tree
 * instead of a hand-kept import list, so a new factory is covered the day it
 * lands. A factory is any `export function|const create*Tool(s)` and any
 * `export const x: RegisteredTool[]` under `src/`.
 *
 * Factories only touch their deps inside handlers/previews, so they are called
 * with an inert deep proxy: building the declarations runs nothing.
 */
const SRC = join(__dirname, '../..');
const FACTORY = /export (?:async )?(?:function|const) (create[A-Za-z]*Tools?)\b/g;
const TOOL_ARRAY = /export const ([A-Za-z]+)\s*:\s*RegisteredTool\[\]/g;

export interface CatalogTool {
  tool: RegisteredTool;
  /** `src/`-relative file and export that produced it. */
  source: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '__mocks__') out.push(...sourceFiles(path));
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test-helper.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

/** Any property is another proxy; calling it returns one too; never a thenable. */
export function inertDeps(): any {
  const handler: ProxyHandler<() => void> = {
    get: (_t, prop) =>
      prop === 'then' || typeof prop === 'symbol' ? undefined : proxy,
    apply: () => proxy,
  };
  const proxy: any = new Proxy(function inert() {}, handler);
  return proxy;
}

function isTool(value: unknown): value is RegisteredTool {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as RegisteredTool).name === 'string' &&
    typeof (value as RegisteredTool).domain === 'string' &&
    // No handler requirement: client-side UI commands are declarations only,
    // and they reach the model like any other tool.
    !!(value as RegisteredTool).parameters &&
    typeof (value as RegisteredTool).parameters === 'object'
  );
}

export function collectToolCatalog(): CatalogTool[] {
  const out: CatalogTool[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const factories = [...text.matchAll(FACTORY)].map((m) => m[1]);
    const arrays = [...text.matchAll(TOOL_ARRAY)].map((m) => m[1]);
    if (!factories.length && !arrays.length) continue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file);
    const rel = relative(SRC, file);
    for (const name of factories) {
      const produced = mod[name](inertDeps(), inertDeps(), inertDeps());
      const tools = Array.isArray(produced) ? produced : [produced];
      for (const tool of tools) {
        if (isTool(tool)) out.push({ tool, source: `${rel}#${name}` });
      }
    }
    for (const name of arrays) {
      for (const tool of mod[name] as unknown[]) {
        if (isTool(tool)) out.push({ tool, source: `${rel}#${name}` });
      }
    }
  }
  return out;
}
