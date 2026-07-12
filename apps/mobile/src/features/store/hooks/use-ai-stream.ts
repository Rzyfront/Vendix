/**
 * useAiStream — React hook que envuelve el SSE consumer
 * (`AnunciosService.streamGenerate`) con state reactivo: status,
 * último evento, error. Reusable para cualquier SSE en mobile.
 *
 * El hook se preocupa de:
 *  - Mantener un cleanup en `useEffect` unmount para cerrar la conexión.
 *  - Exponer `status` y `lastEvent` para que el caller renderice progreso.
 *  - Asegurar idempotencia: llamar `start()` múltiples veces es no-op
 *    mientras el stream está abierto (mismo guard que el web
 *    `if (this.generatingId()) return`).
 *
 * El backend emite eventos `ai-chunk` con payloads JSON con la shape
 * `AdCreativeStreamEvent`. Ver `docs/parity-audit-anuncios.md` §8.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import type {
  AdCreativeStreamEvent,
  MarketingAdCreative,
} from '@/features/store/types/anuncios.types';
import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';

export type AiStreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'done'
  | 'error';

export interface UseAiStreamOptions {
  /** Creative id (path param del endpoint SSE). */
  id: number;
  /** Optional user-supplied correction. */
  correction?: string;
  /** Optional pre-generated request id; si se omite, se genera client-side. */
  requestId?: string;
  /** Enable flag — when false, the hook no-op y no abre conexión. */
  enabled?: boolean;
}

export interface UseAiStreamResult {
  status: AiStreamStatus;
  lastEvent: AdCreativeStreamEvent | null;
  message: string;
  result: MarketingAdCreative | null;
  postCopy: string | null;
  errorMessage: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const DEFAULT_MESSAGE = ANUNCIO_LABELS.generationPreparing;

export function useAiStream(options: UseAiStreamOptions): UseAiStreamResult {
  const { id, correction, requestId, enabled = true } = options;

  const [status, setStatus] = useState<AiStreamStatus>('idle');
  const [lastEvent, setLastEvent] = useState<AdCreativeStreamEvent | null>(null);
  const [message, setMessage] = useState<string>(DEFAULT_MESSAGE);
  const [result, setResult] = useState<MarketingAdCreative | null>(null);
  const [postCopy, setPostCopy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const closeRef = useRef<(() => void) | null>(null);
  const startedRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (closeRef.current) {
      try {
        closeRef.current();
      } catch {
        // best effort
      }
      closeRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    startedRef.current = false;
    setStatus('idle');
  }, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    startedRef.current = false;
    setStatus('idle');
    setLastEvent(null);
    setMessage(DEFAULT_MESSAGE);
    setResult(null);
    setPostCopy(null);
    setErrorMessage(null);
  }, [cleanup]);

  const start = useCallback(() => {
    if (!enabled) return;
    if (startedRef.current) return; // idempotent
    startedRef.current = true;
    setStatus('connecting');
    setMessage(DEFAULT_MESSAGE);
    setErrorMessage(null);
    setResult(null);
    setPostCopy(null);

    closeRef.current = AnunciosService.streamGenerate(id, {
      requestId,
      correction,
      onOpen: () => {
        setStatus('streaming');
      },
      onEvent: (event) => {
        setLastEvent(event);
        if (event.type === 'progress') {
          setMessage(event.message ?? ANUNCIO_LABELS.generationPreparing);
        } else if (event.type === 'partial_image') {
          setMessage(ANUNCIO_LABELS.generationReception);
        } else if (event.type === 'completed') {
          if (event.creative) {
            setResult(event.creative);
          }
          if (event.post_copy) {
            setPostCopy(event.post_copy);
          }
          setMessage(ANUNCIO_LABELS.generationReady);
        } else if (event.type === 'post_copy') {
          if (event.post_copy) {
            setPostCopy(event.post_copy);
          }
          if (event.creative) {
            setResult(event.creative);
          }
          setMessage(ANUNCIO_LABELS.generationReady);
        } else if (event.type === 'done') {
          setStatus('done');
        } else if (event.type === 'error') {
          setStatus('error');
          setErrorMessage(event.error ?? ANUNCIO_LABELS.toastErrGenerate);
        }
      },
      onError: () => {
        setStatus('error');
        setErrorMessage(ANUNCIO_LABELS.toastErrConnectStream);
      },
    });
  }, [id, correction, requestId, enabled]);

  // Auto-start cuando se monta con enabled=true.
  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current) return;
    start();
    return () => {
      cleanup();
      startedRef.current = false;
    };
    // start depende de id/correction/requestId/enabled — re-ejecutar
    // si cambia alguno de estos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id, correction, requestId]);

  return {
    status,
    lastEvent,
    message,
    result,
    postCopy,
    errorMessage,
    start,
    stop,
    reset,
  };
}
