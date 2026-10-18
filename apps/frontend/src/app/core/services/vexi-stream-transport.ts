import { Observable } from 'rxjs';

export interface VexiReplayCursor {
  stream_id: string;
  sequence: number;
  objective_id?: string;
  checkpoint?: number;
}
export class VexiStreamTransportError extends Error {
  constructor(
    readonly replaySupported: boolean,
    message = 'Se perdió la conexión. Consulta el objetivo o la conversación antes de reintentar.',
  ) {
    super(message);
  }
}

/** A reconnect only reattaches to the SAME consumed intent. No prompt/POST/redispatch. */
export function replayEventSource<
  T extends { type: string; replay?: VexiReplayCursor },
>(
  streamId: string,
  getUrl: (cursor?: VexiReplayCursor) => string,
  replaySupported = false,
  createSource: (url: string) => EventSource = (url) => new EventSource(url),
): Observable<T> {
  return new Observable<T>((subscriber) => {
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cursor: VexiReplayCursor | undefined;
    let reconnects = 0;
    let closed = false;
    const fail = (message?: string) => {
      source?.close();
      subscriber.error(new VexiStreamTransportError(replaySupported, message));
    };
    const connect = () => {
      if (closed) return;
      const url = getUrl(
        cursor ??
          (reconnects ? { stream_id: streamId, sequence: 0 } : undefined),
      );
      if (!url) {
        fail('Sesión no válida. Vuelve a iniciar sesión.');
        return;
      }
      const connection = createSource(url);
      source = connection;
      connection.addEventListener('ai-chunk', (event) => {
        if (closed || subscriber.closed || source !== connection) return;
        let chunk: T;
        try {
          chunk = JSON.parse((event as MessageEvent).data) as T;
        } catch {
          fail('Respuesta del servidor no válida.');
          return;
        }
        if (chunk.replay) {
          const next = chunk.replay;
          replaySupported = true;
          if (
            next.stream_id !== streamId ||
            !Number.isSafeInteger(next.sequence) ||
            next.sequence < 1
          ) {
            fail();
            return;
          }
          if (next.sequence <= (cursor?.sequence ?? 0)) return;
          if (next.sequence !== (cursor?.sequence ?? 0) + 1) {
            fail();
            return;
          }
          cursor = next;
        } else if (replaySupported) {
          // A reconciliation error may be emitted before a replay session attaches.
          if (chunk.type !== 'error') {
            fail();
            return;
          }
        }
        subscriber.next(chunk);
        if (chunk.type === 'done' || chunk.type === 'error') {
          source?.close();
          subscriber.complete();
        }
      });
      connection.onerror = () => {
        if (closed || subscriber.closed || source !== connection) return;
        connection.close(); // Never allow EventSource's implicit single-use-intent retry.
        source = undefined;
        if (replaySupported && reconnects++ < 2)
          retry = setTimeout(connect, 150);
        else fail();
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close(); // Server propagates disconnect to the cooperative work signal.
    };
  });
}

/** Opaque cursor fields only. The prompt and tool arguments never enter a URL. */
export function replayStreamUrl(
  url: string,
  cursor?: VexiReplayCursor,
): string {
  if (!url || !cursor) return url;
  const query = new URLSearchParams({
    after_sequence: String(cursor.sequence),
  });
  if (cursor.objective_id) query.set('objective_id', cursor.objective_id);
  if (cursor.checkpoint !== undefined)
    query.set('checkpoint', String(cursor.checkpoint));
  return `${url}&${query.toString()}`;
}

/** A previous assistant message cannot prove THIS interrupted turn completed. */
export function isPersistedStreamReply(
  message: { role?: string; metadata?: unknown } | undefined,
  streamId?: string,
): boolean {
  if (message?.role !== 'assistant') return false;
  if (!streamId) return true; // Legacy OFF reconciliation keeps its old contract.
  return (
    !!message.metadata &&
    typeof message.metadata === 'object' &&
    (message.metadata as Record<string, unknown>)['stream_id'] === streamId
  );
}
