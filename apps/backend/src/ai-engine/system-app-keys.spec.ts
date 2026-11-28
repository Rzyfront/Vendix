import * as fs from 'fs';
import * as path from 'path';
import { SYSTEM_AI_APP_KEYS, isSystemAppKey } from './system-app-keys';

const SRC_ROOT = path.resolve(__dirname, '..');
const SEEDS_ROOT = path.resolve(__dirname, '../../prisma/seeds');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.testing.ts')
      ? [full]
      : [];
  });
}

const KEY = `'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'`;

/**
 * Ways the backend names an app it resolves by key. A key found by any of
 * these must be protected from deletion in Super Admin.
 */
const PATTERNS: RegExp[] = [
  // export const FOO_APP_KEY = 'foo'; const APP_KEY = 'foo';
  new RegExp(`APP_KEY\\s*=\\s*${KEY}`, 'g'),
  // { appKey: 'foo' } and { app_key: 'foo' } (not ai_app_key labels)
  new RegExp(`\\b(?:appKey|app_key):\\s*${KEY}`, 'g'),
  // aiEngine.run('foo', …), runSpeech('foo', …), runEmbedding(\n 'foo', …)
  new RegExp(`\\.run[A-Za-z]*\\(\\s*${KEY}`, 'g'),
  // fallbacks: agent?.app_key || 'chat_assistant'
  new RegExp(`\\b(?:app_key|appKey|AppKey|APP_KEY)\\b[^\\n;]*?(?:\\|\\||\\?\\?)\\s*${KEY}`, 'g'),
];

/** Toolbox maps `kind → app key` (DOCUMENT_KIND_TO_APP, …). */
const KIND_MAP = /_TO_APP[^=]*=\s*\{([^}]*)\}/g;

function keysUsedInCode(): Map<string, string> {
  const found = new Map<string, string>();
  const files = [...sourceFiles(SRC_ROOT), ...sourceFiles(SEEDS_ROOT)].filter(
    (file) =>
      !file.startsWith(SEEDS_ROOT) || file.endsWith('.application.ts'),
  );
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const add = (key: string) =>
      found.has(key) || found.set(key, path.relative(SRC_ROOT, file));
    for (const pattern of PATTERNS) {
      for (const match of text.matchAll(pattern)) add(match[1]);
    }
    for (const block of text.matchAll(KIND_MAP)) {
      for (const match of block[1].matchAll(new RegExp(`:\\s*${KEY}`, 'g'))) {
        add(match[1]);
      }
    }
    // `*.application.ts` seeds declare an app row with `key: 'foo'`.
    if (file.endsWith('.application.ts')) {
      for (const match of text.matchAll(new RegExp(`\\bkey:\\s*${KEY}`, 'g'))) {
        add(match[1]);
      }
    }
  }
  return found;
}

describe('SYSTEM_AI_APP_KEYS', () => {
  it('incluye toda clave de aplicación que el código resuelve por clave', () => {
    const used = keysUsedInCode();
    // Sanity: the scan must actually see the code it guards.
    expect(used.has('vexi_voice_tts')).toBe(true);
    expect(used.has('vex_classifier')).toBe(true);

    const missing = [...used.entries()]
      .filter(([key]) => !SYSTEM_AI_APP_KEYS.has(key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });

  it('protege las apps que pidió Rafael por nombre', () => {
    for (const key of [
      'vex_assistant',
      'vex_analysis',
      'vexi_storefront',
      'vexi_voice_tts',
      'vexi_voice_stt',
      'chat_assistant',
      'vex_classifier',
    ]) {
      expect(isSystemAppKey(key)).toBe(true);
    }
  });

  it('no marca como sistema una app creada a mano ni una clave vacía', () => {
    expect(isSystemAppKey('mi_app_personalizada')).toBe(false);
    expect(isSystemAppKey(null)).toBe(false);
    expect(isSystemAppKey('')).toBe(false);
  });
});
