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

/**
 * Plazo corto de CADA intento de `/health`. Si el intento se agota por tiempo
 * (la petición puede quedar en la cola de conexiones del navegador) se
 * reintenta una vez antes de dar el backend por caído.
 */
export const BACKEND_HEALTH_TIMEOUT_MS = 4_000;

/** Intentos de `/health` cuando el anterior se agotó por tiempo. */
export const BACKEND_HEALTH_ATTEMPTS = 2;

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

type HealthProbeResult = 'up' | 'down' | 'timeout';

async function probeHealthOnce(
  apiUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<HealthProbeResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(`${apiUrl}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return response?.ok ? 'up' : 'down';
  } catch {
    return timedOut ? 'timeout' : 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `true` si `GET {apiUrl}/health` responde 2xx. Va por `fetch` directo (sin
 * interceptores de auth/tenant) y nunca lanza. Cada intento tiene su propio
 * plazo corto; si se agota por tiempo se reintenta (hasta `attempts`) antes de
 * declarar caída. Un fallo rápido (error de red, 5xx) es caída sin reintento.
 */
export async function isBackendReachable(
  apiUrl: string,
  timeoutMs: number = BACKEND_HEALTH_TIMEOUT_MS,
  fetchImpl: FetchLike | undefined = typeof fetch === 'function'
    ? (fetch as unknown as FetchLike)
    : undefined,
  attempts: number = BACKEND_HEALTH_ATTEMPTS,
): Promise<boolean> {
  if (!fetchImpl) return false;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    const result = await probeHealthOnce(apiUrl, timeoutMs, fetchImpl);
    if (result === 'up') return true;
    if (result === 'down') return false;
  }
  return false;
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
