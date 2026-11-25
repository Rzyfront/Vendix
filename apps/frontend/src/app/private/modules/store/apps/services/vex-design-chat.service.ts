import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { AppPageDocument, PageAppKind } from '../templates';

/** Apps que admiten el chat lateral de diseño con Vex (excluye `store_home`). */
export type DesignChatAppKind = Exclude<PageAppKind, 'store_home'>;

export function supportsVexDesignChat(kind: PageAppKind): kind is DesignChatAppKind {
  return kind !== 'store_home';
}

export interface VexDesignStreamIntentResponse {
  conversation_id: number;
  stream_id: string;
  replay_enabled?: boolean;
  draft: AppPageDocument;
  history_depth: number;
  can_discard: boolean;
}

export interface VexDesignDraftFrame {
  type: 'design_draft';
  app_kind: DesignChatAppKind;
  op: string;
  document: AppPageDocument;
  summary: string;
  touched_block_id: string | null;
  history_depth: number;
  can_discard: boolean;
}

export interface VexDesignStreamChunk {
  type: string;
  content?: string;
  error?: string;
  tool?: {
    id?: string;
    name?: string;
    summary?: string;
    failed?: boolean;
  };
  app_kind?: DesignChatAppKind;
  op?: string;
  document?: AppPageDocument;
  summary?: string;
  touched_block_id?: string | null;
  history_depth?: number;
  can_discard?: boolean;
}

export interface VexDesignDiscardResponse {
  ok: true;
  app_kind: DesignChatAppKind;
  document: AppPageDocument;
  discarded_summary: string;
  touched_block_id: string | null;
  history_depth: number;
  can_discard: boolean;
}

export interface VexDesignResetResponse {
  ok: true;
  app_kind: DesignChatAppKind;
  document: AppPageDocument;
  history_depth: 0;
  can_discard: false;
}

/**
 * Cliente HTTP + SSE del chat lateral de diseño con Vex en el constructor de
 * apps (F4). Reutiliza el handshake de dos pasos (`stream-intent` → `EventSource`)
 * para que el prompt y el borrador nunca viajen en la URL.
 */
@Injectable({ providedIn: 'root' })
export class VexDesignChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/apps/design-chat`;

  createStreamIntent(
    kind: DesignChatAppKind,
    payload: {
      content: string;
      draft: AppPageDocument;
      conversationId?: number | null;
    },
  ): Observable<VexDesignStreamIntentResponse> {
    return this.http
      .post<{ data: VexDesignStreamIntentResponse }>(`${this.baseUrl}/${kind}/stream-intent`, {
        content: payload.content,
        draft: payload.draft,
        ...(payload.conversationId ? { conversation_id: payload.conversationId } : {}),
      })
      .pipe(map((res) => res.data));
  }

  /**
   * Abre el stream SSE de diseño y cierra el `EventSource` al terminar, fallar
   * o desuscribirse (botón «Detener» o destrucción del componente).
   */
  streamDesign(
    kind: DesignChatAppKind,
    conversationId: number,
    streamId: string,
    createSource: (url: string) => EventSource = (url) => new EventSource(url),
  ): Observable<VexDesignStreamChunk> {
    return new Observable<VexDesignStreamChunk>((subscriber) => {
      const url = this.getStreamUrl(kind, conversationId, streamId);
      if (!url) {
        subscriber.error(new Error('Sesión no válida. Vuelve a iniciar sesión.'));
        return;
      }

      const source = createSource(url);
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        source.close();
      };

      source.addEventListener('ai-chunk', (event) => {
        if (closed || subscriber.closed) return;
        try {
          const chunk = JSON.parse((event as MessageEvent).data) as VexDesignStreamChunk;
          subscriber.next(chunk);
          if (chunk.type === 'done' || chunk.type === 'error') {
            close();
            subscriber.complete();
          }
        } catch {
          close();
          subscriber.error(new Error('Respuesta del servidor no válida.'));
        }
      });

      source.onerror = () => {
        if (closed || subscriber.closed) return;
        close();
        subscriber.error(new Error('Se interrumpió la conexión con Vex. Intenta nuevamente.'));
      };

      return () => {
        close();
      };
    });
  }

  discardLast(kind: DesignChatAppKind, conversationId: number): Observable<VexDesignDiscardResponse> {
    return this.http
      .post<{ data: VexDesignDiscardResponse }>(
        `${this.baseUrl}/${kind}/conversations/${conversationId}/discard`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  resetConversation(kind: DesignChatAppKind, conversationId: number): Observable<VexDesignResetResponse> {
    return this.http
      .post<{ data: VexDesignResetResponse }>(
        `${this.baseUrl}/${kind}/conversations/${conversationId}/reset`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  getStreamUrl(kind: DesignChatAppKind, conversationId: number, streamId: string): string {
    const authState = localStorage.getItem('vendix_auth_state');
    if (!authState) return '';
    try {
      const token = JSON.parse(authState)?.tokens?.access_token;
      if (!token) return '';
      return `${this.baseUrl}/${kind}/stream?conversation_id=${conversationId}&stream_id=${encodeURIComponent(streamId)}&token=${encodeURIComponent(token)}`;
    } catch {
      return '';
    }
  }
}
