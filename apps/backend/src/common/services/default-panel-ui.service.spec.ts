import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Drift guard between the two halves of the panel_ui contract.
 *
 * `PANEL_UI_FALLBACK` (backend) decides which module keys default to `true`
 * for a user whose stored `panel_ui` predates them. `APP_MODULES.STORE_ADMIN`
 * (frontend) decides which keys the "Módulos del Panel" editor renders. A key
 * present only in the frontend list is a module the editor offers and the
 * backend never enables by default — it stays invisible for every existing
 * user, with no layer to point at when they ask why. That is precisely the
 * failure Vexi's visibility diagnostic cannot explain, so it is caught here.
 *
 * The frontend constant is parsed from disk rather than imported: the two apps
 * are separate TypeScript projects and a cross-app import would drag the whole
 * Angular graph into a Nest unit test. Parsing keeps the check honest — it
 * reads the same file the editor compiles.
 */
describe('PANEL_UI_FALLBACK ↔ APP_MODULES drift', () => {
  const FRONTEND_CONSTANT = join(
    __dirname,
    '../../../../frontend/src/app/shared/constants/app-modules.constant.ts',
  );

  function frontendStoreAdminKeys(): string[] {
    const source = readFileSync(FRONTEND_CONSTANT, 'utf8');
    const start = source.indexOf('STORE_ADMIN: [');
    expect(start).toBeGreaterThan(-1);
    return [...source.slice(start).matchAll(/key:\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
  }

  const BACKEND_CONSTANT = join(__dirname, 'default-panel-ui.service.ts');

  function fallbackStoreAdminKeys(): string[] {
    // `PANEL_UI_FALLBACK` is a private field and the service needs Prisma to
    // construct, so it is read the same way as the frontend list: from source.
    // Symmetric, dependency-free, and it cannot go stale against the runtime
    // value because it *is* the runtime value's declaration.
    const source = readFileSync(BACKEND_CONSTANT, 'utf8');
    const start = source.indexOf('STORE_ADMIN: {');
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf('\n      },', start));
    return [...block.matchAll(/^\s*([a-z0-9_]+):\s*(?:true|false)/gm)].map(
      (match) => match[1],
    );
  }

  it('todo módulo que el editor renderiza tiene default en el backend', () => {
    const fallback = new Set(fallbackStoreAdminKeys());
    const missing = frontendStoreAdminKeys().filter(
      (key) => !fallback.has(key),
    );

    expect(missing).toEqual([]);
  });

  it('el fallback no está vacío (protege contra un parseo que silencie el test)', () => {
    expect(fallbackStoreAdminKeys().length).toBeGreaterThan(50);
    expect(frontendStoreAdminKeys().length).toBeGreaterThan(50);
  });
});
