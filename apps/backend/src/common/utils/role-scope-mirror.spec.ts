import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guard espejo de la matriz de asignación (QUI-581 / QUI-730b).
 *
 * `ASSIGNABLE_SYSTEM_ROLES` existe dos veces: en el backend
 * (`apps/backend/src/common/utils/role-scope.util.ts`, fuente de verdad que
 * autoriza) y en el frontend
 * (`apps/frontend/src/app/shared/constants/role-scope.constant.ts`, que solo
 * oculta acciones). Si el frontend va por detrás, los roles nuevos se ven
 * bloqueados en la UI aunque el backend los acepta — fue exactamente el caso
 * de `waiter`/`kitchen`: el seed QUI-730b y el backend los declararon
 * asignables, pero el espejo frontend no, así que ningún restaurante podía
 * asignar mesero/cocina desde la tienda, con o sin industria `restaurant`.
 *
 * La constante se parsea del fuente en ambos lados (igual que el drift guard
 * de panel_ui): importar TS del frontend arrastraría el grafo Angular al test
 * de Nest, y leer el backend del fuente evita instanciar Prisma.
 */
describe('ASSIGNABLE_SYSTEM_ROLES ↔ espejo frontend', () => {
  const BACKEND_FILE = join(__dirname, 'role-scope.util.ts');
  const FRONTEND_FILE = join(
    __dirname,
    '../../../../frontend/src/app/shared/constants/role-scope.constant.ts',
  );

  function levelsOf(source: string): Record<'organization' | 'store', string[]> {
    const start = source.indexOf('ASSIGNABLE_SYSTEM_ROLES');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n};', start);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);
    const levels = {} as Record<'organization' | 'store', string[]>;
    for (const level of ['organization', 'store'] as const) {
      const match = block.match(new RegExp(`${level}:\\s*\\[([\\s\\S]*?)\\]`));
      expect(match).not.toBeNull();
      levels[level] = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(levels[level].length).toBeGreaterThan(0);
    }
    return levels;
  }

  it('el espejo frontend coincide EXACTO con el backend (organization + store)', () => {
    const backend = levelsOf(readFileSync(BACKEND_FILE, 'utf8'));
    const frontend = levelsOf(readFileSync(FRONTEND_FILE, 'utf8'));

    expect(frontend.organization).toEqual(backend.organization);
    expect(frontend.store).toEqual(backend.store);
  });

  it('waiter/kitchen son asignables en tienda (QUI-730b)', () => {
    const frontend = levelsOf(readFileSync(FRONTEND_FILE, 'utf8'));
    expect(frontend.store).toEqual(
      expect.arrayContaining(['waiter', 'kitchen']),
    );
    expect(frontend.organization).toEqual(
      expect.arrayContaining(['waiter', 'kitchen']),
    );
  });
});
