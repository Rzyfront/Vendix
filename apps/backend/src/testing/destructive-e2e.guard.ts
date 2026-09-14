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
 *   npm run test:path -- src/domains/auth
 * ```
 *
 * El segundo cinturón (`assertDisposableDatabase`) es lo que impide que un
 * `VENDIX_DESTRUCTIVE_E2E=1` puesto en un `.env` y olvidado borre una base que
 * no era desechable.
 *
 * El nombre de la base NO basta: un `vendix_test` alojado en la RDS de
 * producción tiene un nombre desechable en un host que no lo es. Por eso
 * `assertDisposableDatabase` valida las dos mitades de la URL — nombre Y host
 * — y rechaza explícitamente cualquier host de RDS, sin importar el nombre.
 */

/** Nombres de base que se consideran desechables. Todo lo demás se rechaza. */
const DISPOSABLE_DATABASE_NAMES = [
  'vendix_test',
  'vendix_e2e',
  'vendix_db_test',
];

/**
 * Hosts desechables: loopback local y el servicio de Postgres del
 * `docker-compose.yml` del repo (servicio `db`, `container_name:
 * vendix_postgres`; se acepta también el alias genérico `postgres` usado por
 * otros compose de la comunidad). Cualquier otro host se rechaza — en
 * particular, más abajo, cualquier `*.rds.amazonaws.com` se nombra
 * explícitamente en el mensaje: ese es el accidente real que este guard debe
 * atrapar.
 */
const DISPOSABLE_DATABASE_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'db',
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

/**
 * Parsea `DATABASE_URL` con el `URL` nativo. `postgresql://` no es un
 * "special scheme" para WHATWG URL, pero con `//` tras el esquema igual
 * expone `hostname`/`port`/`pathname` sin problema — se valida en la sonda de
 * verificación. Si la URL viene malformada, `undefined`: nunca se debe
 * interpolar `url` crudo en un mensaje (ver `redactedUrl`).
 */
function parseDatabaseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** Nombre de la base a partir de la URL ya parseada (sin el `/` inicial). */
function databaseNameOf(parsed: URL | undefined): string | undefined {
  const raw = parsed?.pathname?.replace(/^\//, '');
  return raw ? raw : undefined;
}

/**
 * Versión segura de la URL para mensajes de error: nunca usuario/contraseña.
 * Si la URL no se pudo parsear, ni siquiera intenta reconstruirla.
 */
function redactedUrl(url: string, parsed: URL | undefined): string {
  if (!parsed) {
    return '<URL ilegible>';
  }
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//***@${parsed.hostname}${port}${parsed.pathname}`;
}

/**
 * Aborta si `DATABASE_URL` no apunta a una base desechable.
 *
 * Llamar en el `beforeAll` de todo spec destructivo, ANTES de construir el
 * módulo: es la única verificación que sigue en pie cuando alguien deja
 * `VENDIX_DESTRUCTIVE_E2E=1` fijo en su entorno.
 *
 * Valida nombre Y host — ver el comentario de `DISPOSABLE_DATABASE_HOSTS` —
 * y nunca imprime la URL cruda (que trae usuario/contraseña) en un mensaje:
 * siempre pasa por `redactedUrl`.
 */
export function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'Spec destructivo sin DATABASE_URL. Apunta explícitamente a una base desechable ' +
        `(${DISPOSABLE_DATABASE_NAMES.join(' | ')}) antes de correrlo.`,
    );
  }

  const parsed = parseDatabaseUrl(url);
  const name = databaseNameOf(parsed);
  const host = parsed?.hostname;
  const safeUrl = redactedUrl(url, parsed);

  // Chequeo explícito primero: un nombre desechable en un host de RDS no es
  // desechable. Este es el accidente real que el guard debe nombrar.
  if (host && /\.rds\.amazonaws\.com$/i.test(host)) {
    throw new Error(
      `Spec destructivo apuntando a un host de RDS de producción ("${host}"), que nunca es ` +
        `desechable sin importar el nombre de la base ("${name ?? '<sin nombre>'}"). URL: ` +
        `${safeUrl}. Este spec borra organizations, stores y users sin WHERE; correrlo aquí ` +
        'es un incidente de producción. Usa una base y un host desechables.',
    );
  }

  if (!name || !DISPOSABLE_DATABASE_NAMES.includes(name)) {
    throw new Error(
      `Spec destructivo apuntando a la base "${name ?? safeUrl}", que no está en la lista de ` +
        `bases desechables (${DISPOSABLE_DATABASE_NAMES.join(' | ')}). Este spec borra ` +
        'organizations, stores y users sin WHERE; correrlo aquí se lleva los datos de ' +
        'desarrollo por cascada. Crea una base de prueba y pásala en DATABASE_URL.',
    );
  }

  if (!host || !DISPOSABLE_DATABASE_HOSTS.includes(host)) {
    throw new Error(
      `Spec destructivo apuntando al host "${host ?? safeUrl}", que no está en la lista de ` +
        `hosts desechables (${DISPOSABLE_DATABASE_HOSTS.join(' | ')}). Este spec borra ` +
        'organizations, stores y users sin WHERE; un nombre de base desechable en un host ' +
        'que no lo es (por ejemplo, una RDS) igual se lleva los datos por delante. Usa un ' +
        'host desechable en DATABASE_URL.',
    );
  }
}
