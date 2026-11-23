import {
  MonoTypeOperatorFunction,
  Observable,
  TimeoutError,
  catchError,
  filter,
  firstValueFrom,
  map,
  of,
  throwError,
  timeout,
} from 'rxjs';

/**
 * Disponibilidad del backend: una sola fuente de verdad para decidir cuándo
 * la app puede decir "el servidor no responde" (la pantalla global del gato,
 * `<app-domain-resolution-error>`).
 *
 * Regla: el gato solo se muestra si el backend de verdad no responde. Una
 * petición puntual que falla (400 de una prueba, status 0 de un guardado) se
 * queda en su pantalla como toast/mensaje; nunca escala a la pantalla global.
 */

/** Plazo para que `/health` conteste antes de considerar el backend caído. */
export const BACKEND_HEALTH_TIMEOUT_MS = 5_000;

/**
 * Margen extra que se le da a la resolución del dominio cuando el arranque se
 * demora pero `/health` confirma que el backend está vivo (p. ej. el navegador
 * tiene la cola de conexiones ocupada por streams abiertos en otras pestañas).
 */
export const APP_INIT_GRACE_MS = 20_000;

/** Plazo por defecto de una acción de usuario (guardar, crear, borrar). */
export const USER_ACTION_TIMEOUT_MS = 30_000;

export const USER_ACTION_TIMEOUT_MESSAGE =
  'La operación tardó demasiado y se canceló. Tu conexión o el servidor van lentos; inténtalo de nuevo en un momento.';

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; cache?: RequestCache },
) => Promise<{ ok: boolean }>;

/**
 * `true` si `GET {apiUrl}/health` responde 2xx dentro del plazo. Va por
 * `fetch` directo (sin interceptores de auth/tenant) y nunca lanza.
 */
export async function isBackendReachable(
  apiUrl: string,
  timeoutMs: number = BACKEND_HEALTH_TIMEOUT_MS,
  fetchImpl: FetchLike | undefined = typeof fetch === 'function'
    ? (fetch as unknown as FetchLike)
    : undefined,
): Promise<boolean> {
  if (!fetchImpl) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${apiUrl}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return !!response?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Qué hacer cuando el arranque (resolución de dominio → rutas) superó su
 * plazo. Antes se mostraba el gato de inmediato; ahora se confirma con
 * `/health`:
 * - backend caído → `onFailure()` (gato) al instante;
 * - backend vivo → se espera `graceMs` más a que las rutas queden listas y
 *   solo si tampoco llegan se declara el fallo.
 * Si la resolución falla de verdad (error HTTP tras reintentos) el effect de
 * config ya marca el error por su cuenta; esto solo cubre el caso "lento".
 * Siempre resuelve `true` para no bloquear el bootstrap.
 */
export async function settleSlowAppInit(options: {
  routesConfigured$: Observable<boolean>;
  probeBackend: () => Promise<boolean>;
  onFailure: () => void;
  graceMs?: number;
}): Promise<boolean> {
  const alive = await options.probeBackend().catch(() => false);
  if (!alive) {
    options.onFailure();
    return true;
  }

  const configured = await firstValueFrom(
    options.routesConfigured$.pipe(
      filter((value) => value === true),
      timeout(options.graceMs ?? APP_INIT_GRACE_MS),
      map(() => true),
      catchError(() => of(false)),
    ),
  );
  if (!configured) options.onFailure();
  return true;
}

/**
 * Corta una acción de usuario que se queda colgada (p. ej. la petición nunca
 * sale del navegador) y la convierte en un error legible para el toast de la
 * pantalla. Al desuscribirse, HttpClient aborta la petición y libera la
 * conexión. Otros errores pasan intactos.
 */
export function withUserActionTimeout<T>(
  ms: number = USER_ACTION_TIMEOUT_MS,
  message: string = USER_ACTION_TIMEOUT_MESSAGE,
): MonoTypeOperatorFunction<T> {
  return (source) =>
    source.pipe(
      timeout({ first: ms }),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError ? new Error(message) : error,
        ),
      ),
    );
}
