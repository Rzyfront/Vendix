import { HttpErrorResponse } from '@angular/common/http';
import {
  EMPTY,
  MonoTypeOperatorFunction,
  Observable,
  defer,
  expand,
  filter,
  map,
  retry,
  switchMap,
  take,
  takeWhile,
  tap,
  throwError,
  timeout,
  timer,
} from 'rxjs';

/**
 * Sondeo de un job de BullMQ expuesto por el backend como `202 { job_id }` + un
 * endpoint de estado.
 *
 * POR QUÉ EXISTE: el envío del set de pruebas DIAN construye, firma y sube 50
 * documentos UBL — ~74 s. El `location /` de nginx en producción hereda el
 * `proxy_read_timeout` por defecto de 60 s, así que el POST sincrónico devolvía
 * **504** al navegador mientras el backend terminaba bien. El handler de éxito de
 * Angular nunca corría, la UI se quedaba con el estado anterior y el toast
 * afirmaba «no se pudo enviar» sobre un lote que sí se envió y ya había quemado
 * su bloque de consecutivos autorizados.
 *
 * Vive en `core/utils` porque las tres superficies fiscales (tienda,
 * organización y plataforma) consumen el MISMO flujo del backend; una copia por
 * módulo derivaría, y la que derivara sería la que vuelva a mentirle al usuario.
 */

/** Estados de BullMQ que el backend expone al cliente. */
export type AsyncJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

export interface AsyncJobStatus<T = unknown> {
  status: AsyncJobState;
  result?: T;
  error?: string;
}

const TERMINAL_STATES: ReadonlySet<AsyncJobState> = new Set<AsyncJobState>([
  'completed',
  'failed',
]);

export function isTerminalJobState(state: AsyncJobState): boolean {
  return TERMINAL_STATES.has(state);
}

export interface PollAsyncJobOptions {
  /** Cada cuánto se pregunta. Por defecto 3 s. */
  intervalMs?: number;
  /**
   * Cuánto se espera antes de rendirse. **Debe EXCEDER el presupuesto real de
   * trabajo del worker**, no el tiempo que uno espera que tarde: un timeout más
   * corto que el trabajo reproduce el defecto original — el cliente se rinde
   * mientras la operación sigue viva y el usuario cree que no pasó nada.
   *
   * Por defecto 300 s, con el set de pruebas DIAN (~74 s, sin reintento) como
   * caso de referencia y margen para una DIAN lenta.
   */
  timeoutMs?: number;
  /**
   * Callback invocado UNA vez cuando el job lleva `elapsedMs > stallThresholdMs`
   * sin alcanzar un estado terminal. Sirve para avisar al usuario que el
   * servicio de fondo está lento (o muerto) sin esperar al timeout completo.
   *
   * Umbral por defecto: `intervalMs * 30` (90 s con defaults).
   */
  onStall?: (info: { elapsedMs: number; lastStatus: AsyncJobState }) => void;
  stallThresholdMs?: number;
  /**
   * Espera progresiva entre consultas en vez del intervalo fijo (QUI-1009):
   * `true` usa la escalera por defecto 1→2→4→10 s (tope 10 s). Cada consulta
   * se programa cuando la anterior respondió, así que un backend lento no
   * acumula peticiones. Sin definir se conserva `intervalMs`.
   */
  backoff?: boolean | { steps?: readonly number[] };
  /**
   * Límite de consultas. Si la consulta número `maxAttempts` todavía no trae un
   * estado terminal, el observable lanza `AsyncJobPollLimitError`. Sin definir
   * solo corta `timeoutMs`.
   */
  maxAttempts?: number;
}

/** El job seguía sin estado terminal al agotar `maxAttempts` consultas. */
export class AsyncJobPollLimitError extends Error {
  override readonly name = 'AsyncJobPollLimitError';
  constructor(
    readonly attempts: number,
    readonly lastStatus: AsyncJobState,
  ) {
    super(
      `El job sigue en estado "${lastStatus}" tras ${attempts} consultas`,
    );
  }
}

/**
 * Emite UNA vez, con el estado terminal del job (`completed` o `failed`).
 *
 * Un job que falla emite normalmente con `status: 'failed'` en vez de lanzar: el
 * llamador necesita distinguir «el worker falló y dijo por qué» de «se nos acabó
 * la paciencia», y un error de RxJS colapsa las dos cosas. El timeout sí lanza
 * `TimeoutError`.
 */
export function pollAsyncJob<T>(
  poll: () => Observable<AsyncJobStatus<T>>,
  options: PollAsyncJobOptions = {},
): Observable<AsyncJobStatus<T>> {
  const intervalMs = options.intervalMs ?? 3_000;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const stallThresholdMs = options.stallThresholdMs ?? intervalMs * 30;
  const onStall = options.onStall;
  const maxAttempts = options.maxAttempts;
  const startedAt = Date.now();
  let stallFired = false;

  const statuses$: Observable<AsyncJobStatus<T>> = options.backoff
    ? defer(() => poll()).pipe(
        // `expand` encadena la siguiente consulta a la respuesta de la
        // anterior; el índice de la emisión es el número de espera.
        expand((job, index) =>
          isTerminalJobState(job.status)
            ? EMPTY
            : timer(
                backoffDelayMs(
                  index + 1,
                  typeof options.backoff === 'object'
                    ? options.backoff.steps
                    : undefined,
                ),
              ).pipe(switchMap(() => poll())),
        ),
      )
    : timer(0, intervalMs).pipe(switchMap(() => poll()));

  return statuses$.pipe(
    map((job, index) => {
      if (
        maxAttempts !== undefined &&
        index + 1 >= maxAttempts &&
        !isTerminalJobState(job.status)
      ) {
        throw new AsyncJobPollLimitError(index + 1, job.status);
      }
      return job;
    }),
    tap((job) => {
      // Solo emitimos una vez, y solo si NO es terminal.
      if (stallFired || isTerminalJobState(job.status) || !onStall) return;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= stallThresholdMs) {
        stallFired = true;
        onStall({ elapsedMs, lastStatus: job.status });
      }
    }),
    // `inclusive: true` para que el estado terminal SÍ se emita antes de cerrar.
    takeWhile((job) => !isTerminalJobState(job.status), true),
    filter((job) => isTerminalJobState(job.status)),
    take(1),
    timeout(timeoutMs),
  );
}

// ── Backoff y reintentos (QUI-1009) ──────────────────────────────────────────

/**
 * Escalera de esperas por defecto: 1 s → 2 s → 4 s → 10 s. A partir del cuarto
 * intento la espera se queda en el último escalón (tope de 10 s).
 */
export const DEFAULT_BACKOFF_STEPS_MS: readonly number[] = [
  1_000, 2_000, 4_000, 10_000,
];

/**
 * Espera antes del intento `attempt` (1 = primer reintento o primera espera).
 * Más allá de la escalera devuelve su último escalón: ese es el tope.
 */
export function backoffDelayMs(
  attempt: number,
  steps: readonly number[] = DEFAULT_BACKOFF_STEPS_MS,
): number {
  const ladder = steps.length > 0 ? steps : DEFAULT_BACKOFF_STEPS_MS;
  const index = Math.min(Math.max(1, Math.floor(attempt)), ladder.length) - 1;
  return ladder[index];
}

/**
 * ¿Es un fallo técnico que vale la pena reintentar? Red (`status 0`, la
 * petición no obtuvo respuesta), 408 (timeout), 429 (el throttler global
 * frenó la ráfaga) y 5xx (incluye los 502/504 de nginx). El resto de 4xx no
 * cambia al reenviar: rechazo del contenido, sesión o permisos.
 */
export function isTransientHttpError(error: unknown): boolean {
  return (
    error instanceof HttpErrorResponse &&
    (error.status === 0 ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500)
  );
}

export interface BackoffRetryInfo {
  /** Número del reintento que está por hacerse (1..maxRetries). */
  attempt: number;
  maxRetries: number;
  /** Espera antes de ese reintento. */
  delayMs: number;
  error: unknown;
}

export interface RetryTransientOptions {
  /** Reintentos tras el intento original. Por defecto 3. */
  maxRetries?: number;
  steps?: readonly number[];
  /** Qué errores se reintentan. Por defecto `isTransientHttpError`. */
  isRetryable?: (error: unknown) => boolean;
  /** Se invoca antes de cada espera, para avisar «reintentando (n/3)». */
  onRetry?: (info: BackoffRetryInfo) => void;
}

/**
 * Re-suscribe la fuente ante errores transitorios con la escalera de backoff;
 * cualquier otro error pasa de inmediato. Al agotar `maxRetries` entrega el
 * último error tal cual, sin envolver, para que el llamador lo clasifique.
 *
 * Re-suscribir un `HttpClient` reenvía la petición: úsalo solo sobre
 * operaciones idempotentes (QUI-1009, Paso 0).
 */
export function retryTransientWithBackoff<T>(
  options: RetryTransientOptions = {},
): MonoTypeOperatorFunction<T> {
  const maxRetries = options.maxRetries ?? 3;
  const isRetryable = options.isRetryable ?? isTransientHttpError;
  return retry<T>({
    count: maxRetries,
    delay: (error: unknown, attempt: number) => {
      if (!isRetryable(error)) return throwError(() => error);
      const delayMs = backoffDelayMs(attempt, options.steps);
      options.onRetry?.({ attempt, maxRetries, delayMs, error });
      return timer(delayMs);
    },
  });
}
