import { EMPTY, Observable, defer, of } from 'rxjs';
import { catchError, concatMap, map } from 'rxjs/operators';

/** Tamaño de lote estándar de las cargas masivas (tope por request del backend). */
export const DEFAULT_BULK_CHUNK_SIZE = 100;

/** Máximo de registros que una carga masiva acepta en total. */
export const MAX_BULK_RECORDS = 10000;

/**
 * Progreso emitido por `runChunked` después de cada lote.
 * `processed` cuenta los items ya enviados con éxito; `failedAt` es el offset
 * desde donde hay que reintentar (`items.slice(failedAt)`).
 */
export interface ChunkProgress<R> {
  processed: number;
  total: number;
  chunkIndex: number;
  chunkCount: number;
  results: R[];
  done: boolean;
  failedAt?: number;
  error?: unknown;
}

/**
 * Parte un arreglo en lotes de `size` (por defecto 100). Lanza si `size < 1`.
 */
export function chunkArray<T>(
  items: readonly T[],
  size: number = DEFAULT_BULK_CHUNK_SIZE,
): T[][] {
  if (!Number.isFinite(size) || size < 1) {
    throw new Error(`chunkArray: size must be >= 1 (received ${size})`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Envía `items` en lotes, en serie (`concatMap`), y emite progreso tras cada
 * lote. Si un lote falla emite un progreso final con `done: true`, `failedAt`
 * (offset del lote) y `error`, y completa sin lanzar: el consumidor decide si
 * reintenta con `items.slice(failedAt)`. Con `items` vacío emite un único
 * progreso `done: true`.
 */
export function runChunked<T, R>(
  items: readonly T[],
  send: (chunk: T[], offset: number) => Observable<R>,
  size: number = DEFAULT_BULK_CHUNK_SIZE,
): Observable<ChunkProgress<R>> {
  const chunks = chunkArray(items, size);
  const total = items.length;
  const chunkCount = chunks.length;

  if (chunkCount === 0) {
    return of<ChunkProgress<R>>({
      processed: 0,
      total: 0,
      chunkIndex: 0,
      chunkCount: 0,
      results: [],
      done: true,
    });
  }

  return defer(() => {
    const results: R[] = [];
    let processed = 0;
    let failed = false;

    return of(...chunks.map((chunk, chunkIndex) => ({ chunk, chunkIndex }))).pipe(
      concatMap(({ chunk, chunkIndex }) => {
        if (failed) {
          return EMPTY;
        }
        const offset = chunkIndex * size;
        return send(chunk, offset).pipe(
          map((result): ChunkProgress<R> => {
            results.push(result);
            processed += chunk.length;
            return {
              processed,
              total,
              chunkIndex,
              chunkCount,
              results: [...results],
              done: chunkIndex === chunkCount - 1,
            };
          }),
          catchError((error: unknown) => {
            failed = true;
            return of<ChunkProgress<R>>({
              processed,
              total,
              chunkIndex,
              chunkCount,
              results: [...results],
              done: true,
              failedAt: offset,
              error,
            });
          }),
        );
      }),
    );
  });
}
