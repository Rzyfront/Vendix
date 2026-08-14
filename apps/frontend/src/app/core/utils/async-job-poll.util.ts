import { Observable, filter, switchMap, take, takeWhile, tap, timeout, timer } from 'rxjs';

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
  const startedAt = Date.now();
  let stallFired = false;

  return timer(0, intervalMs).pipe(
    switchMap(() => poll()),
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
