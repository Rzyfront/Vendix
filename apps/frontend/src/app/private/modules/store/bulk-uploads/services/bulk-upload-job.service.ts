import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AsyncJobState,
  pollAsyncJob,
  retryTransientWithBackoff,
} from '../../../../../core/utils/async-job-poll.util';
import { ERROR_MESSAGES } from '../../../../../core/utils/error-messages';
import {
  BulkUploadJobRequestMap,
  BulkUploadJobResultRow,
  BulkUploadJobStatus,
  BulkUploadJobType,
  BulkUploadJobView,
} from '../bulk-upload-log.interface';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** Ruta de encolado de cada tipo (el permiso lo valida su controlador). */
const ENQUEUE_PATHS: Record<BulkUploadJobType, string> = {
  products: 'store/products/bulk/jobs',
  employees: 'store/payroll/employees/bulk/jobs',
  inventory_adjustments: 'store/inventory/adjustments/bulk/jobs',
  customers: 'store/customers/bulk/jobs',
};

/**
 * El trabajo tiene un tope de 60 min en el servidor; el sondeo espera un poco
 * más para no rendirse mientras el trabajo sigue vivo.
 */
export const BULK_UPLOAD_JOB_POLL_TIMEOUT_MS = 65 * 60_000;

const STORAGE_PREFIX = 'vendix:bulk-upload-job:';

const TERMINAL_STATUSES: ReadonlySet<BulkUploadJobStatus> = new Set([
  'completed',
  'partial',
  'failed',
]);

export function isBulkUploadJobTerminal(view: Pick<BulkUploadJobView, 'status'>): boolean {
  return TERMINAL_STATUSES.has(view.status);
}

/** Estado del trabajo en el vocabulario de `pollAsyncJob`. */
export function toAsyncJobState(status: BulkUploadJobStatus): AsyncJobState {
  switch (status) {
    case 'queued':
      return 'waiting';
    case 'running':
      return 'active';
    case 'failed':
      return 'failed';
    default:
      return 'completed';
  }
}

/** 404 del trabajo: no existe, es de otra tienda o ya no se puede consultar. */
export function isBulkUploadJobNotFound(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 404;
}

/**
 * El servidor guarda en `error.message` el texto técnico del error (por
 * ejemplo el `devMessage` en inglés de `BULK_PROD_SESSION_EXPIRED`). Si el
 * código tiene traducción en `ERROR_MESSAGES`, el usuario ve esa.
 */
export function localizeBulkUploadJob(view: BulkUploadJobView): BulkUploadJobView {
  const code = view?.error?.code;
  const translated = code ? ERROR_MESSAGES[code] : undefined;
  if (!view?.error || !translated) return view;
  return { ...view, error: { ...view.error, message: translated } };
}

/**
 * QUI-1009 — cliente del trabajo de carga masiva del servidor.
 *
 * El navegador ya no conduce los lotes: encola (`POST …/bulk/jobs`), sigue el
 * avance (`GET store/bulk-uploads/jobs/:id`) y al terminar trae las filas. Si
 * la pestaña se recarga o se cierra, `getActive(type)` devuelve la carga en
 * curso de la tienda y `recall(type)` el último trabajo que lanzó este
 * navegador, para mostrar su resultado aunque haya terminado sin nadie mirando.
 */
@Injectable({ providedIn: 'root' })
export class BulkUploadJobService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;
  private readonly jobsUrl = `${environment.apiUrl}/store/bulk-uploads/jobs`;

  /** Encola la carga. 409 `BULK_JOB_ALREADY_ACTIVE` si ya hay una del tipo. */
  enqueue<T extends BulkUploadJobType>(
    type: T,
    body: BulkUploadJobRequestMap[T],
  ): Observable<BulkUploadJobView> {
    return this.http
      .post<ApiEnvelope<BulkUploadJobView>>(`${this.apiUrl}/${ENQUEUE_PATHS[type]}`, body)
      .pipe(
        map((res) => localizeBulkUploadJob(res.data)),
        tap((view) => this.remember(type, view.id)),
      );
  }

  /** Carga en cola o en curso de la tienda para el tipo, o `null`. */
  getActive(type: BulkUploadJobType): Observable<BulkUploadJobView | null> {
    const params = new HttpParams().set('upload_type', type);
    return this.http
      .get<ApiEnvelope<BulkUploadJobView | null>>(`${this.jobsUrl}/active`, { params })
      .pipe(map((res) => (res.data ? localizeBulkUploadJob(res.data) : null)));
  }

  get(id: number): Observable<BulkUploadJobView> {
    return this.http
      .get<ApiEnvelope<BulkUploadJobView>>(`${this.jobsUrl}/${id}`)
      .pipe(map((res) => localizeBulkUploadJob(res.data)));
  }

  /** Filas del resultado en el orden del archivo. */
  getResults(id: number): Observable<BulkUploadJobResultRow[]> {
    return this.http
      .get<ApiEnvelope<{ rows: BulkUploadJobResultRow[] }>>(`${this.jobsUrl}/${id}/results`)
      .pipe(map((res) => res.data?.rows ?? []));
  }

  /** Reanuda un `failed` técnico desde el lote que falló. */
  retry(id: number): Observable<BulkUploadJobView> {
    return this.http
      .post<ApiEnvelope<BulkUploadJobView>>(`${this.jobsUrl}/${id}/retry`, {})
      .pipe(map((res) => localizeBulkUploadJob(res.data)));
  }

  /**
   * Sigue el trabajo hasta un estado final con espera progresiva 1→2→4→10 s.
   * `onProgress` recibe cada lectura (también la final) para pintar el avance;
   * el observable emite UNA vez, con la vista final. Un corte de red o un 5xx
   * en una consulta se reintenta sin cortar el seguimiento (la consulta es un
   * GET idempotente): el trabajo sigue en el servidor aunque el navegador
   * pierda respuestas. Lo único que corta es el `timeoutMs` del sondeo.
   */
  watch(
    id: number,
    onProgress: (view: BulkUploadJobView) => void,
  ): Observable<BulkUploadJobView> {
    return pollAsyncJob<BulkUploadJobView>(
      () =>
        this.get(id).pipe(
          retryTransientWithBackoff<BulkUploadJobView>({ maxRetries: Infinity }),
          tap((view) => onProgress(view)),
          map((view) => ({ status: toAsyncJobState(view.status), result: view })),
        ),
      { backoff: true, timeoutMs: BULK_UPLOAD_JOB_POLL_TIMEOUT_MS },
    ).pipe(
      map((status) => {
        if (!status.result) throw new Error('El trabajo terminó sin estado');
        return status.result;
      }),
    );
  }

  /**
   * Trabajo que este navegador lanzó y todavía no mostró: el activo de la
   * tienda o, si no hay, el último recordado (aunque ya haya terminado). Un id
   * recordado que ya no existe se olvida.
   */
  findResumable(type: BulkUploadJobType): Observable<BulkUploadJobView | null> {
    return this.getActive(type).pipe(
      catchError(() => of(null)),
      switchMap((active) => {
        if (active) return of(active);
        const remembered = this.recall(type);
        if (remembered === null) return of(null);
        return this.get(remembered).pipe(
          map((view) => (view.upload_type === type ? view : null)),
          catchError((error: unknown) => {
            if (isBulkUploadJobNotFound(error)) this.forget(type);
            return of(null);
          }),
        );
      }),
    );
  }

  remember(type: BulkUploadJobType, id: number): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + type, String(id));
    } catch {
      // Sin almacenamiento (modo privado): solo se pierde el aviso al volver.
    }
  }

  recall(type: BulkUploadJobType): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + type);
      const id = raw === null ? NaN : Number(raw);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  forget(type: BulkUploadJobType): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + type);
    } catch {
      // nada que limpiar
    }
  }
}
