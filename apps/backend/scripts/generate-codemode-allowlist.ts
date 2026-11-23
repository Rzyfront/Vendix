/**
 * F10 (T65): regenerates `src/ai-engine/sandbox/codemode-allowlist.generated.ts`
 * from the tool DEFINITIONS (the same factories the registry uses, built with
 * inert deps). It never opens a database, starts a server or calls a provider.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/generate-codemode-allowlist.ts
 *   npx ts-node -r tsconfig-paths/register scripts/generate-codemode-allowlist.ts --check
 *
 * Review the diff of the generated file in the release PR: it is the closed
 * list of tools a Code Mode script can call. Rules and exclusions live in
 * `codemode-allowlist.derive.ts`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectToolCatalog } from '../src/ai-engine/tools/tool-catalog.test-helper';
import {
  deriveCodeModeAllowlist,
  renderCodeModeAllowlist,
} from '../src/ai-engine/sandbox/codemode-allowlist.derive';

const target = join(
  __dirname,
  '../src/ai-engine/sandbox/codemode-allowlist.generated.ts',
);
const next = renderCodeModeAllowlist(
  deriveCodeModeAllowlist(collectToolCatalog().map((entry) => entry.tool)),
);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    /* a missing file counts as stale */
  }
  if (current !== next) {
    console.error(
      'codemode-allowlist.generated.ts is stale: regenerate and review it.',
    );
    process.exit(1);
  }
  console.log('codemode-allowlist.generated.ts is up to date.');
} else {
  writeFileSync(target, next);
  console.log(`Wrote ${target}`);
}
