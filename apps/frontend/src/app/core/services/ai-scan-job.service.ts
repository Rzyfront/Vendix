import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  TimeoutError,
  defer,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { catchError, take, timeout } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { TenantFacade } from '../store/tenant/tenant.facade';
import {
  AiJobStatus,
  AiScanJobError,
  aiJobErrorFromStatus,
  aiJobStalledError,
} from '../utils/ai-job-error';
import {
  isTransientHttpError,
  pollAsyncJob,
  retryTransientWithBackoff,
} from '../utils/async-job-poll.util';

/**
 * What an AI process tells its progress bar (QUI-1020). Implemented by
 * `AiJobProgress` (`shared/utils/ai-job-progress.ts`); declared here so the
 * core service does not depend on shared UI state.
 */
export interface AiJobProgressListener {
  onUploadStart?(): void;
  /** The wait is remembered (`resumeKey`): closing the screen loses nothing. */
  onResumable?(): void;
  onEnqueued?(jobId: string): void;
  onResumed?(startedAtMs: number): void;
  onStatus?(status: AiJobStatus): void;
  onCompleted?(): void;
  onFailed?(error: unknown): void;
}

export interface AiScanJobOptions {
  /** Se invoca UNA vez si pasan `stallMs` sin estado terminal. */
  onStall?: () => void;
  /**
   * Intervalo FIJO entre polls (ms). Sin definir se usa la espera progresiva
   * 1 → 2 → 4 → 10 s (QUI-1020).
   */
  pollIntervalMs?: number;
  /** Tope de todo el ciclo encolar -> poll (ms). Por defecto 600_000. */
  timeoutMs?: number;
  /** Aviso de lentitud (ms). Por defecto 60_000. */
  stallMs?: number;
  /**
   * Recibe el `data` de la respuesta del encolado (además de `job_id`, p. ej.
   * la huella del archivo para el registro de cargas masivas, QUI-1004).
   */
  onEnqueued?: (data: Record<string, unknown>) => void;
  /** Barra de progreso compartida (QUI-1020). */
  progress?: AiJobProgressListener;
  /**
   * Reenganche tras recargar o cerrar la pantalla (QUI-1020): el trabajo se
   * recuerda por tienda con esta clave y `resume()` lo retoma. Se olvida al
   * llegar a un estado final.
   */
  resumeKey?: string;
  /**
   * JSON-serializable context stored with the remembered job (target image,
   * profile, location…), read back with {@link AiScanJobService.pendingResume}
   * so the screen can decide whether the job still applies to what it shows.
   */
  resumeMeta?: Record<string, unknown>;
  /**
   * Endpoint de estado de una cola propia del dominio (gastos, remisiones,
   * compras…) en vez de `GET /ai-scan-jobs/:id`. Acepta la respuesta pelada o
   * dentro del envelope `{ success, data }`.
   */
  statusUrl?: (jobId: string) => string;
  /**
   * El encolado respondió sin `job_id` porque no hay nada que esperar (p. ej.
   * el documento ya estaba procesado). Devuelve el resultado final para
   * terminar de inmediato, o `undefined` para tratarlo como fallo.
   */
  resultWithoutJob?: (data: Record<string, unknown>) => unknown;
}

interface EnqueueEnvelope {
  success?: boolean;
  data?: { job_id?: string } & Record<string, unknown>;
  message?: string;
}

/** Lo último que dijo el servidor del trabajo, para explicar un timeout. */
interface PollWatch {
  stalled: boolean;
  /** Job this wait is following, so it only forgets its own key. */
  jobId?: string;
}

interface StatusEnvelope<T> {
  success?: boolean;
  data?: AiJobStatus<T>;
}

interface RememberedJob {
  jobId: string;
  startedAt: number;
  /** Enqueue response `data`; empty for entries saved by older versions. */
  data: Record<string, unknown>;
  meta: Record<string, unknown> | null;
}

const STORAGE_PREFIX = 'vendix:ai-scan-job:';
/** Lo que el backend conserva un trabajo terminado (`removeOnComplete`). */
const RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_STALL_MS = 60_000;

/**
 * Cliente genérico de la cola `ai-scan`: POST a la ruta `.../async` (202 con
 * `data.job_id`) y poll de `GET /ai-scan-jobs/:id` (SIN envelope) hasta
 * completed/failed. Emite UNA vez el `result`, con la misma forma que devolvía
 * el endpoint síncrono en `data`.
 *
 * QUI-1020: el poll espera 1 → 2 → 4 → 10 s, alimenta la barra de progreso,
 * recuerda el trabajo para reengancharse y entrega los fallos como
 * {@link AiScanJobError} con su categoría (documento / Vendix / IA).
 */
@Injectable({ providedIn: 'root' })
export class AiScanJobService {
  private readonly http = inject(HttpClient);
  private readonly tenant = inject(TenantFacade);

  enqueueAndWait<T>(
    url: string,
    body: FormData | object,
    opts?: AiScanJobOptions,
  ): Observable<T> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const watch: PollWatch = { stalled: false };

    return defer(() => {
      opts?.progress?.onUploadStart?.();
      if (opts?.resumeKey) opts.progress?.onResumable?.();
      return this.http.post<EnqueueEnvelope>(url, body);
    }).pipe(
      switchMap((response) => {
        const data = response?.data ?? {};
        const jobId = data.job_id;
        if (!jobId) {
          const direct = opts?.resultWithoutJob?.(data);
          if (direct === undefined) {
            throw new Error('No se pudo iniciar el escaneo');
          }
          return of(direct as T);
        }
        opts?.onEnqueued?.(data);
        if (opts?.resumeKey) {
          this.remember(opts.resumeKey, jobId, data, opts.resumeMeta ?? null);
        }
        opts?.progress?.onEnqueued?.(jobId);
        return this.waitFor<T>(jobId, watch, opts);
      }),
      timeout({
        first: timeoutMs,
        with: () => throwError(() => this.timedOut(watch, opts)),
      }),
      take(1),
      tap({ next: () => opts?.progress?.onCompleted?.() }),
      catchError((err: unknown) => this.fail(err, opts)),
    );
  }

  /**
   * Retoma el trabajo recordado con `resumeKey`, si sigue vigente. `null`
   * cuando no hay nada que retomar (la pantalla arranca vacía).
   */
  resume<T>(
    resumeKey: string,
    opts?: Omit<AiScanJobOptions, 'resumeKey' | 'resumeMeta'>,
  ): Observable<T> | null {
    const saved = this.recall(resumeKey);
    if (!saved) return null;
    const options: AiScanJobOptions = { ...opts, resumeKey };
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const watch: PollWatch = { stalled: false };
    return defer(() => {
      options.progress?.onResumed?.(saved.startedAt);
      options.progress?.onResumable?.();
      // Same `data` the enqueue response had (e.g. QUI-1004 file hash).
      options.onEnqueued?.(saved.data);
      return this.waitFor<T>(saved.jobId, watch, options);
    }).pipe(
      timeout({
        first: timeoutMs,
        with: () => throwError(() => this.timedOut(watch, options)),
      }),
      take(1),
      tap({ next: () => options.progress?.onCompleted?.() }),
      catchError((err: unknown) => this.fail(err, options)),
    );
  }

  /** ¿Hay un trabajo recordado con esta clave? */
  hasPending(resumeKey: string): boolean {
    return this.recall(resumeKey) !== null;
  }

  /**
   * Lee lo guardado con el trabajo recordado SIN retomarlo: `data` del encolado
   * y el `resumeMeta` del que lo lanzó. `null` si no hay nada vigente.
   */
  pendingResume<M = Record<string, unknown>>(
    resumeKey: string,
  ): { data: Record<string, unknown>; meta: M | null } | null {
    const saved = this.recall(resumeKey);
    if (!saved) return null;
    return { data: saved.data, meta: saved.meta as M | null };
  }

  /**
   * Descarta el trabajo recordado (el usuario empezó otro o lo descartó). Con
   * `jobId` solo lo borra si sigue siendo ESE trabajo: la espera de un trabajo
   * viejo no debe borrar la clave de uno más nuevo.
   */
  forget(resumeKey: string, jobId?: string): void {
    try {
      const key = this.storageKey(resumeKey);
      if (jobId !== undefined) {
        const raw = localStorage.getItem(key);
        if (raw && (JSON.parse(raw) as { jobId?: unknown })?.jobId !== jobId) {
          return;
        }
      }
      localStorage.removeItem(key);
    } catch {
      // Storage no disponible: no hay nada que olvidar.
    }
  }

  private waitFor<T>(
    jobId: string,
    watch: PollWatch,
    opts?: AiScanJobOptions,
  ): Observable<T> {
    const progress = opts?.progress;
    watch.jobId = jobId;
    const url =
      opts?.statusUrl?.(jobId) ?? `${environment.apiUrl}/ai-scan-jobs/${jobId}`;
    const poll = () =>
      this.http
        .get<AiJobStatus<T> | StatusEnvelope<T>>(url)
        .pipe(
          map((body) => unwrapStatus(body)),
          // 404 = el trabajo ya no existe (o es de otro usuario): no se
          // reintenta. Red, 429 y 5xx sí, con la misma escalera.
          retryTransientWithBackoff({ maxRetries: 3 }),
          tap((status) => {
            watch.stalled = status.stalled === true;
            progress?.onStatus?.(status);
            // Dead worker or a job active too long (the backend decides): stop
            // waiting, but keep the resume key: reopening re-attaches to the
            // real job, which may still finish.
            if (
              watch.stalled &&
              status.status !== 'completed' &&
              status.status !== 'failed'
            ) {
              throw aiJobStalledError(true);
            }
          }),
        );

    return pollAsyncJob<T>(poll, {
      ...(opts?.pollIntervalMs
        ? { intervalMs: opts.pollIntervalMs }
        : { backoff: true }),
      // El tope real lo pone el `timeout` de todo el ciclo; este solo evita
      // que el poll quede vivo si alguien lo usa suelto.
      timeoutMs: (opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 60_000,
      stallThresholdMs: opts?.stallMs ?? DEFAULT_STALL_MS,
      onStall: opts?.onStall ? () => opts.onStall?.() : undefined,
    }).pipe(
      map((s) => {
        if (opts?.resumeKey) this.forget(opts.resumeKey, jobId);
        const status = s as AiJobStatus<T>;
        if (status.status === 'failed') throw aiJobErrorFromStatus(status);
        if (status.result === undefined || status.result === null) {
          throw new AiScanJobError(
            'El escaneo finalizó sin resultado',
            'technical',
          );
        }
        return status.result as T;
      }),
      catchError((err: unknown) =>
        throwError(() => this.pollFailure(err, opts, jobId)),
      ),
    );
  }

  /** Un poll que no se recuperó: el trabajo ya no se puede retomar. */
  private pollFailure(
    err: unknown,
    opts: AiScanJobOptions | undefined,
    jobId: string,
  ): unknown {
    if (!(err instanceof HttpErrorResponse)) return err;
    if (opts?.resumeKey) this.forget(opts.resumeKey, jobId);
    if (err.status === 404) {
      return new AiScanJobError(
        'El escaneo ya no está disponible. Vuelve a intentarlo.',
        'technical',
      );
    }
    if (isTransientHttpError(err)) {
      return new AiScanJobError(
        'Perdimos la conexión con Vendix mientras se analizaba. Tu archivo sigue cargado: vuelve a intentarlo.',
        'technical',
      );
    }
    return err;
  }

  /**
   * Se agotó la paciencia del cliente. Si el servidor ya marcó el trabajo como
   * colgado, el equipo fue avisado y el mensaje lo dice.
   */
  private timedOut(watch: PollWatch, opts?: AiScanJobOptions): AiScanJobError {
    if (opts?.resumeKey && watch.jobId) {
      this.forget(opts.resumeKey, watch.jobId);
    }
    return aiJobStalledError(watch.stalled);
  }

  private fail(err: unknown, opts?: AiScanJobOptions): Observable<never> {
    const normalized = this.normalizeError(err);
    opts?.progress?.onFailed?.(normalized);
    return throwError(() => normalized);
  }

  private normalizeError(err: unknown): Error | HttpErrorResponse {
    // Un HttpErrorResponse aquí es del encolado: sin envolver, el consumidor
    // aplica parseApiError.
    if (err instanceof HttpErrorResponse) return err;
    if (err instanceof TimeoutError) return aiJobStalledError(false);
    if (err instanceof Error) return err;
    return new Error('No se pudo procesar el documento. Intenta nuevamente.');
  }

  private storageKey(resumeKey: string): string {
    const storeId = this.tenant.getCurrentStoreId();
    return `${STORAGE_PREFIX}${storeId ?? 'none'}:${resumeKey}`;
  }

  private remember(
    resumeKey: string,
    jobId: string,
    data: Record<string, unknown>,
    meta: Record<string, unknown> | null,
  ): void {
    const value: RememberedJob = { jobId, startedAt: Date.now(), data, meta };
    const key = this.storageKey(resumeKey);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // A large enqueue response (e.g. a whole landing state) may not fit:
      // keep at least the job so the screen can still re-attach.
      try {
        localStorage.setItem(key, JSON.stringify({ ...value, data: {} }));
      } catch {
        // Sin storage no hay reenganche, pero el escaneo sigue.
      }
    }
  }

  private recall(resumeKey: string): RememberedJob | null {
    try {
      const raw = localStorage.getItem(this.storageKey(resumeKey));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RememberedJob>;
      if (
        typeof parsed?.jobId !== 'string' ||
        typeof parsed.startedAt !== 'number' ||
        Date.now() - parsed.startedAt > RESUME_MAX_AGE_MS
      ) {
        this.forget(resumeKey);
        return null;
      }
      const isObject = (v: unknown): v is Record<string, unknown> =>
        !!v && typeof v === 'object' && !Array.isArray(v);
      return {
        jobId: parsed.jobId,
        startedAt: parsed.startedAt,
        data: isObject(parsed.data) ? parsed.data : {},
        meta: isObject(parsed.meta) ? parsed.meta : null,
      };
    } catch {
      return null;
    }
  }
}

function unwrapStatus<T>(
  body: AiJobStatus<T> | StatusEnvelope<T> | null,
): AiJobStatus<T> {
  if (body && !('status' in body) && 'data' in body && body.data) {
    return body.data;
  }
  return body as AiJobStatus<T>;
}
