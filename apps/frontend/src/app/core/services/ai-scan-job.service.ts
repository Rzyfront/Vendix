import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  Subject,
  finalize,
  map,
  switchMap,
  takeUntil,
  throwError,
  timer,
} from 'rxjs';
import {
  catchError,
  exhaustMap,
  filter,
  retry,
  take,
  takeWhile,
  timeout,
} from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { ERROR_MESSAGES } from '../utils/error-messages';
import { AsyncJobStatus } from '../utils/async-job-poll.util';

export interface AiScanJobOptions {
  /** Se invoca UNA vez si pasan `stallMs` sin estado terminal. */
  onStall?: () => void;
  /** Intervalo entre polls (ms). Por defecto 2500. */
  pollIntervalMs?: number;
  /** Tope de todo el ciclo encolar -> poll (ms). Por defecto 600_000. */
  timeoutMs?: number;
  /** Aviso de lentitud (ms). Por defecto 60_000. */
  stallMs?: number;
}

interface EnqueueEnvelope {
  success?: boolean;
  data?: { job_id?: string };
  message?: string;
}

/**
 * Cliente genérico de la cola `ai-scan`: POST a la ruta `.../async` (202 con
 * `data.job_id`) y poll de `GET /ai-scan-jobs/:id` (SIN envelope) hasta
 * completed/failed. Emite UNA vez el `result`, con la misma forma que devolvía
 * el endpoint síncrono en `data`.
 */
@Injectable({ providedIn: 'root' })
export class AiScanJobService {
  private readonly http = inject(HttpClient);

  enqueueAndWait<T>(
    url: string,
    body: FormData | object,
    opts?: AiScanJobOptions,
  ): Observable<T> {
    const pollIntervalMs = opts?.pollIntervalMs ?? 2500;
    const timeoutMs = opts?.timeoutMs ?? 600_000;
    const stallMs = opts?.stallMs ?? 60_000;

    return this.http.post<EnqueueEnvelope>(url, body).pipe(
      map((response) => {
        const jobId = response?.data?.job_id;
        if (!jobId) throw new Error('No se pudo iniciar el escaneo');
        return jobId;
      }),
      switchMap((jobId) => {
        const done$ = new Subject<void>();
        if (opts?.onStall) {
          const onStall = opts.onStall;
          timer(stallMs)
            .pipe(takeUntil(done$))
            .subscribe(() => onStall());
        }
        return timer(0, pollIntervalMs).pipe(
          exhaustMap(() =>
            this.http
              .get<AsyncJobStatus<T>>(
                `${environment.apiUrl}/ai-scan-jobs/${jobId}`,
              )
              .pipe(
                retry({
                  count: 2,
                  delay: (err: unknown) =>
                    err instanceof HttpErrorResponse && err.status === 404
                      ? throwError(() => err)
                      : timer(1000),
                }),
              ),
          ),
          takeWhile(
            (s) => s.status !== 'completed' && s.status !== 'failed',
            true,
          ),
          filter((s) => s.status === 'completed' || s.status === 'failed'),
          map((s) => {
            if (s.status === 'failed') {
              throw new Error(
                ERROR_MESSAGES[s.error ?? ''] ??
                  'No se pudo procesar el documento. Intenta nuevamente.',
              );
            }
            if (s.result === undefined || s.result === null) {
              throw new Error('El escaneo finalizó sin resultado');
            }
            return s.result as T;
          }),
          finalize(() => done$.next()),
        );
      }),
      timeout({
        first: timeoutMs,
        with: () =>
          throwError(
            () => new Error('El escaneo tardó demasiado. Intenta nuevamente.'),
          ),
      }),
      take(1),
      catchError((err: unknown) => throwError(() => this.normalizeError(err))),
    );
  }

  private normalizeError(err: unknown): Error | HttpErrorResponse {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404 && err.url?.includes('/ai-scan-jobs/')) {
        return new Error(
          'El escaneo ya no está disponible. Vuelve a intentarlo.',
        );
      }
      // Sin envolver: el consumidor aplica parseApiError.
      return err;
    }
    if (err instanceof Error) return err;
    return new Error('No se pudo procesar el documento. Intenta nuevamente.');
  }
}
