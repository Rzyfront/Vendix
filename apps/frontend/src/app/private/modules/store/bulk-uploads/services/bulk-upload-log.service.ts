import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, firstValueFrom, map, of } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import {
  BULK_UPLOAD_STATUS_LABELS,
  BulkUploadDuplicateInfo,
  BulkUploadLog,
  BulkUploadLogQuery,
  BulkUploadStatus,
  BulkUploadType,
  RegisterBulkUploadRequest,
} from '../bulk-upload-log.interface';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number; totalPages?: number };
}

const SPREADSHEET_EXTENSION = /\.(xlsx|xlsm|xls|csv|ods)$/i;

/**
 * QUI-1004 — registro liviano de cargas masivas.
 *
 * - `fingerprint(file)`: huella del contenido normalizado (el mismo algoritmo
 *   del backend), para las cargas que el navegador lee (compras, clientes).
 * - `checkDuplicate` / `register`: contra `store/bulk-uploads`; la tienda la
 *   pone el backend desde el contexto.
 * - `confirmDuplicate(dup)`: el aviso «Este archivo ya se cargó…» con
 *   Cancelar (por defecto) o Cargar igual.
 *
 * El registro es accesorio: si una llamada falla, la carga sigue igual.
 */
@Injectable({ providedIn: 'root' })
export class BulkUploadLogService {
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(DialogService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly apiUrl = `${environment.apiUrl}/store/bulk-uploads`;

  list(query: BulkUploadLogQuery): Observable<{
    data: BulkUploadLog[];
    total: number;
    page: number;
    limit: number;
  }> {
    let params = new HttpParams()
      .set('page', String(query.page ?? 1))
      .set('limit', String(query.limit ?? 20));
    if (query.upload_type) params = params.set('upload_type', query.upload_type);
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);
    return this.http
      .get<ApiEnvelope<BulkUploadLog[]>>(this.apiUrl, { params })
      .pipe(
        map((res) => ({
          data: res.data ?? [],
          total: res.meta?.total ?? 0,
          page: res.meta?.page ?? 1,
          limit: res.meta?.limit ?? 20,
        })),
      );
  }

  /** `null` si es un archivo nuevo o si la consulta falla (no bloquea). */
  checkDuplicate(
    upload_type: BulkUploadType,
    file_hash: string | null,
  ): Observable<BulkUploadDuplicateInfo | null> {
    if (!file_hash) return of(null);
    return this.http
      .post<ApiEnvelope<{ duplicate_of: BulkUploadDuplicateInfo | null }>>(
        `${this.apiUrl}/check-duplicate`,
        { upload_type, file_hash },
      )
      .pipe(
        map((res) => res.data?.duplicate_of ?? null),
        catchError(() => of(null)),
      );
  }

  /** Registra una carga hecha en el navegador; un fallo no se propaga. */
  register(request: RegisterBulkUploadRequest): Observable<boolean> {
    return this.http.post(this.apiUrl, request).pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Aviso de archivo repetido. Resuelve `true` solo con «Cargar igual»;
   * cancelar o cerrar el aviso deja la carga sin hacer.
   */
  async confirmDuplicate(
    duplicate: BulkUploadDuplicateInfo | null | undefined,
  ): Promise<boolean> {
    if (!duplicate) return true;
    return this.dialog.confirm(
      {
        title: 'Archivo ya cargado',
        message: this.duplicateMessage(duplicate),
        confirmText: 'Cargar igual',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      },
      { size: 'sm' },
    );
  }

  duplicateMessage(duplicate: BulkUploadDuplicateInfo): string {
    const when = formatStoreDateTime(
      duplicate.created_at,
      this.settings.timezone(),
    );
    const who = duplicate.user_name || 'un usuario';
    const result =
      duplicate.result_reference ||
      BULK_UPLOAD_STATUS_LABELS[duplicate.status as BulkUploadStatus] ||
      duplicate.status;
    return `Este archivo ya se cargó el ${when} por ${who} (${result}). ¿Quieres cargarlo de nuevo?`;
  }

  /**
   * Huella SHA-256 del archivo. Hoja de cálculo: filas normalizadas (celdas
   * como texto recortado, sin filas ni celdas vacías al final). Otro formato:
   * sus bytes. `null` si el navegador no puede calcularla.
   */
  async fingerprint(file: File): Promise<string | null> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (SPREADSHEET_EXTENSION.test(file.name)) {
        try {
          const XLSX = await import('xlsx');
          const workbook = XLSX.read(bytes, { type: 'array' });
          const sheets = workbook.SheetNames.map((name) =>
            normalizeSheetRows(
              XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
                header: 1,
                raw: false,
                defval: '',
                blankrows: false,
              }),
            ),
          );
          return sha256Hex(new TextEncoder().encode(JSON.stringify(sheets)));
        } catch {
          // Si no se deja leer como hoja, se reconoce por sus bytes.
        }
      }
      return sha256Hex(bytes);
    } catch {
      return null;
    }
  }

  /** `checkDuplicate` + `confirmDuplicate` en un paso. */
  async confirmFileIsNew(
    upload_type: BulkUploadType,
    file_hash: string | null,
  ): Promise<boolean> {
    const duplicate = await firstValueFrom(
      this.checkDuplicate(upload_type, file_hash),
    );
    return this.confirmDuplicate(duplicate);
  }
}

export function normalizeSheetRows(rows: unknown[][]): string[][] {
  const normalized: string[][] = [];
  for (const row of rows) {
    const cells = (Array.isArray(row) ? row : []).map((cell) =>
      String(cell ?? '').trim(),
    );
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length > 0) normalized.push(cells);
  }
  return normalized;
}

async function sha256Hex(data: Uint8Array): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    data as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
