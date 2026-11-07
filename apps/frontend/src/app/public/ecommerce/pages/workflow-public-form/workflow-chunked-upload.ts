import { HttpErrorResponse } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';

/** The three calls of a chunked upload (public form field or tracking requirement). */
export interface ChunkedUploadAdapter {
  init(input: {
    file_name: string;
    mime_type: string;
    size_bytes: number;
  }): Observable<{ upload_id: string; chunk_size: number; total_parts: number }>;
  putPart(uploadId: string, n: number, body: Blob): Observable<unknown>;
  complete(uploadId: string): Observable<unknown>;
}

export interface ChunkedUploadOptions {
  /** Extra attempts per part after the first failure. */
  retries?: number;
  retryDelayMs?: number;
  onProgress?: (percent: number) => void;
}

/** Network drops, throttling and server errors are worth another try; 4xx are not. */
export function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

/**
 * Uploads `file` part by part, in order. A failed part is retried up to
 * `retries` times (default 3) when the error is transient. Resolves with the
 * upload id once the server has joined the parts.
 */
export async function uploadInChunks(
  file: File,
  adapter: ChunkedUploadAdapter,
  options: ChunkedUploadOptions = {},
): Promise<string> {
  const retries = options.retries ?? 3;
  const delay = options.retryDelayMs ?? 800;
  const report = options.onProgress ?? (() => undefined);
  report(0);
  const session = await firstValueFrom(
    adapter.init({ file_name: file.name, mime_type: file.type, size_bytes: file.size }),
  );
  for (let n = 1; n <= session.total_parts; n++) {
    const body = file.slice((n - 1) * session.chunk_size, n * session.chunk_size);
    for (let attempt = 0; ; attempt++) {
      try {
        await firstValueFrom(adapter.putPart(session.upload_id, n, body));
        break;
      } catch (error) {
        if (attempt >= retries || !isRetryableUploadError(error)) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, delay * (attempt + 1)));
      }
    }
    report(Math.round((n / session.total_parts) * 100));
  }
  await firstValueFrom(adapter.complete(session.upload_id));
  report(100);
  return session.upload_id;
}
