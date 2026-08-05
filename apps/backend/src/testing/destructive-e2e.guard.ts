/**
 * Compuerta para specs que escriben (y BORRAN) en una base real.
 *
 * ## Por qué existe
 *
 * Cuatro specs de `domains/auth` limpian su estado con `deleteMany()` sin
 * `where` sobre `organizations`, `stores`, `users`, `user_roles`,
 * `user_settings`, `store_users`, `refresh_tokens`, `login_attempts` y
 * `email_verification_tokens`, resolviendo el cliente Prisma desde el módulo
 * real. Es decir: apuntan a la base que diga `DATABASE_URL` en ese momento, que
 * en una máquina de desarrollo es `vendix_db` — la base sembrada con la
 * organización demo, las tiendas por industria y los usuarios de prueba. Con las
 * FKs en cascada desde `organizations`, un solo `beforeEach` se lleva el grafo
 * completo del tenant.
 *
 * Nunca lo hicieron porque venían fallando antes de llegar al `beforeEach` (DI
 * incompleta, OOM del worker, un import roto). Eso no es una salvaguarda: es
 * suerte. Cualquiera que arregle la construcción del módulo — como pasó al
 * corregir el import privado de `@nestjs/swagger` — desbloquea el borrado sin
 * darse cuenta.
 *
 * ## Cómo se usa
 *
 * ```ts
 * import { describeDestructiveE2E, assertDisposableDatabase } from '../../testing/destructive-e2e.guard';
 *
 * describeDestructiveE2E('Login Flow - Integration', () => {
 *   beforeAll(async () => {
 *     assertDisposableDatabase();
 *     // ...
 *   });
 * });
 * ```
 *
 * Por defecto el bloque queda en `skip`, así que la corrida unitaria no toca la
 * base. Para correrlos de verdad hacen falta DOS cosas, no una:
 *
 * ```bash
 * VENDIX_DESTRUCTIVE_E2E=1 \
 * DATABASE_URL='postgresql://...@localhost:5432/vendix_test' \
 *   npm run buildcheck:test -- src/domains/auth
 * ```
 *
 * El segundo cinturón (`assertDisposableDatabase`) es lo que impide que un
 * `VENDIX_DESTRUCTIVE_E2E=1` puesto en un `.env` y olvidado borre una base que
 * no era desechable.
 */

/** Nombres de base que se consideran desechables. Todo lo demás se rechaza. */
const DISPOSABLE_DATABASE_NAMES = [
  'vendix_test',
  'vendix_e2e',
  'vendix_db_test',
];

export const DESTRUCTIVE_E2E_ENABLED =
  process.env.VENDIX_DESTRUCTIVE_E2E === '1';

/**
 * `describe` que solo corre con `VENDIX_DESTRUCTIVE_E2E=1`. Sin la variable el
 * bloque se salta — no falla, para que la suite unitaria siga siendo una
 * compuerta usable.
 */
/**
 * El global `describe` se resuelve con una forma sin `.skip` en el tsconfig de
 * build — que excluye `**\/*spec.ts` pero SÍ compila este helper, porque no es un
 * spec. El cast recupera la forma de jest, que es la que existe en tiempo de
 * ejecución (bajo `ts-jest` los tipos ya son los correctos).
 */
const jest_describe = describe as unknown as jest.Describe;

export const describeDestructiveE2E: jest.Describe = DESTRUCTIVE_E2E_ENABLED
  ? jest_describe
  : jest_describe.skip;

/** Extrae el nombre de la base de una URL de conexión de Postgres. */
function databaseNameOf(url: string): string | undefined {
  // `postgresql://user:pass@host:5432/nombre?schema=public`
  const match = /^[^:]+:\/\/[^/]+\/([^?#]+)/.exec(url);
  return match?.[1];
}

/**
 * Aborta si `DATABASE_URL` no apunta a una base desechable.
 *
 * Llamar en el `beforeAll` de todo spec destructivo, ANTES de construir el
 * módulo: es la única verificación que sigue en pie cuando alguien deja
 * `VENDIX_DESTRUCTIVE_E2E=1` fijo en su entorno.
 */
export function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Spec destructivo sin DATABASE_URL. Apunta explícitamente a una base desechable ' +
        `(${DISPOSABLE_DATABASE_NAMES.join(' | ')}) antes de correrlo.`,
    );
  }

  const name = databaseNameOf(url);

  if (!name || !DISPOSABLE_DATABASE_NAMES.includes(name)) {
    throw new Error(
      `Spec destructivo apuntando a la base "${name ?? url}", que no está en la lista de ` +
        `bases desechables (${DISPOSABLE_DATABASE_NAMES.join(' | ')}). Este spec borra ` +
        'organizations, stores y users sin WHERE; correrlo aquí se lleva los datos de ' +
        'desarrollo por cascada. Crea una base de prueba y pásala en DATABASE_URL.',
    );
  }
}
