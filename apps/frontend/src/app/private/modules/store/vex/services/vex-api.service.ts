import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  VexBlockInteraction,
  VexPlanProposal,
  VexUiBlock,
} from '../models/vex.models';

/**
 * HTTP + SSE client for Vex, the owner/admin store agent.
 *
 * Conversations persist in `ai_conversations` with `metadata.agent_key='vex'`
 * and travel over the same `/store/ai-chat` endpoints Vexi uses, always
 * filtered by that key. Plan approval, block reads and block interactions
 * live under `/store/vex` (owner/admin only, `VexEnabledGuard`).
 */
export const VEX_AGENT_KEY = 'vex';

export interface VexBackendConversation {
  id: number;
  title: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  messages?: VexBackendMessage[];
}

export interface VexBackendMessage {
  id: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** One frame of a Vex turn, as it arrives over SSE (`ai-chunk` events). */
export interface VexStreamChunk {
  type:
    | 'text'
    | 'tool_call'
    | 'tool_result'
    | 'ui_block'
    | 'plan_approval'
    | 'done'
    | 'error';
  content?: string;
  tool?: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
    summary?: string;
    failed?: boolean;
  };
  block?: VexUiBlock;
  plan?: VexPlanProposal;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface VexAttachment {
  attachment_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface VexConversationsPage {
  data: VexBackendConversation[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

@Injectable({ providedIn: 'root' })
export class VexApiService {
  private readonly http = inject(HttpClient);
  private readonly chatBase = `${environment.apiUrl}/store/ai-chat`;
  private readonly vexBase = `${environment.apiUrl}/store/vex`;

  listConversations(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Observable<VexConversationsPage> {
    // Same flattened envelope as Vexi: the interceptor unwraps to
    // `{ data: VexBackendConversation[], meta }`.
    return this.http
      .get<{ data: VexBackendConversation[]; meta: VexConversationsPage['meta'] }>(
        `${this.chatBase}/conversations`,
        { params: { agent_key: VEX_AGENT_KEY, ...(params as Record<string, unknown>) } as never },
      )
      .pipe(
        map((res) => ({
          data: res.data ?? [],
          meta: res.meta ?? {
            total: res.data?.length ?? 0,
            page: 1,
            limit: params?.limit ?? 50,
            totalPages: 1,
          },
        })),
      );
  }

  createConversation(title?: string): Observable<VexBackendConversation> {
    return this.http
      .post<{ data: VexBackendConversation }>(`${this.chatBase}/conversations`, {
        agent_key: VEX_AGENT_KEY,
        ...(title ? { title } : {}),
      })
      .pipe(map((res) => res.data));
  }

  getConversation(id: number): Observable<VexBackendConversation> {
    return this.http
      .get<{ data: VexBackendConversation }>(`${this.chatBase}/conversations/${id}`)
      .pipe(map((res) => res.data));
  }

  archiveConversation(id: number): Observable<VexBackendConversation> {
    return this.http
      .patch<{ data: VexBackendConversation }>(
        `${this.chatBase}/conversations/${id}/archive`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Handshake that must precede `streamConversation`.
   *
   * `EventSource` cannot send a body, so the message goes over POST and the
   * stream URL carries only the opaque id this returns. Vex sends no
   * `ui_context` — it does not navigate screens.
   */
  createStreamIntent(
    conversationId: number,
    content: string,
    options?: {
      attachmentIds?: string[];
      continuation?: 'approved' | 'rejected' | 'resume';
      skipUserMessage?: boolean;
    },
  ): Observable<string> {
    return this.http
      .post<{ data: { stream_id: string } }>(
        `${this.chatBase}/conversations/${conversationId}/stream-intent`,
        {
          content: options?.continuation ? undefined : content,
          continuation: options?.continuation ?? undefined,
          attachment_ids: options?.attachmentIds?.length
            ? options.attachmentIds
            : undefined,
          skip_user_message: options?.skipUserMessage ? true : undefined,
        },
      )
      .pipe(map((res) => res.data.stream_id));
  }

  /**
   * Opens the SSE stream for a turn and turns each `ai-chunk` frame into a
   * `VexStreamChunk`. Unknown frame types are ignored, never errors, so a
   * backend that outgrows this client keeps working.
   *
   * The socket closes on `done`, on `error`, on parser failure and on
   * unsubscribe — an EventSource left open reconnects on its own.
   */
  streamConversation(
    conversationId: number,
    streamId: string,
  ): Observable<VexStreamChunk> {
    return new Observable<VexStreamChunk>((subscriber) => {
      const url = this.getStreamUrl(conversationId, streamId);
      if (!url) {
        subscriber.next({
          type: 'error',
          error: 'Sesión no válida. Vuelve a iniciar sesión.',
        });
        subscriber.complete();
        return undefined;
      }

      const source = new EventSource(url);
      const close = (): void => {
        source.close();
      };

      source.addEventListener('ai-chunk', (event) => {
        let chunk: VexStreamChunk;
        try {
          chunk = JSON.parse((event as MessageEvent).data);
        } catch {
          close();
          subscriber.error(new Error('Respuesta del servidor no válida.'));
          return;
        }

        switch (chunk.type) {
          case 'text':
          case 'tool_call':
          case 'tool_result':
          case 'ui_block':
          case 'plan_approval':
            subscriber.next(chunk);
            break;
          case 'done':
            subscriber.next(chunk);
            close();
            subscriber.complete();
            break;
          case 'error':
            subscriber.next(chunk);
            close();
            subscriber.complete();
            break;
          default:
            // Unknown frame: tolerate, do not break the turn.
            break;
        }
      });

      source.onerror = (): void => {
        close();
        subscriber.error(new Error('Se perdió la conexión con Vex.'));
      };

      return close;
    });
  }

  /**
   * Uploads a file Vex can read in the turn. Returns a handle, never a URL —
   * the bytes stay in S3 behind the handle.
   */
  uploadAttachment(
    file: File,
    conversationId?: number,
  ): Observable<VexAttachment> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (conversationId) {
      form.append('conversation_id', String(conversationId));
    }
    return this.http
      .post<{ data: VexAttachment }>(`${this.vexBase}/attachments`, form)
      .pipe(map((res) => res.data));
  }

  /**
   * Approves a whole plan at once. Reversible steps whose `(tool, args)`
   * still match run without further confirmation; irreversible steps keep
   * asking their own. Execution resumes on the same stream that emitted the
   * `plan_approval` frame; when that socket is gone the caller reopens the
   * turn with a `continuation: 'approved'` intent instead.
   */
  approvePlan(
    planId: string,
    conversationId: number,
  ): Observable<VexPlanProposal> {
    return this.http
      .post<{ data: VexPlanProposal }>(
        `${this.vexBase}/plans/${encodeURIComponent(planId)}/approve`,
        { conversation_id: conversationId },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Applies a single irreversible step the user confirmed on its own card.
   */
  applyStepConfirmation(
    tool: string,
    args: Record<string, unknown>,
    confirmationToken: string,
    conversationId: number,
  ): Observable<{ tool: string; output: string; summary?: string | null }> {
    return this.http
      .post<{ data: { tool: string; output: string; summary?: string | null } }>(
        `${this.vexBase}/confirmations/apply`,
        {
          tool,
          arguments: args,
          confirmation_token: confirmationToken,
          conversation_id: conversationId,
        },
      )
      .pipe(map((res) => res.data));
  }

  getBlock(blockId: string): Observable<VexUiBlock> {
    return this.http
      .get<{ data: VexUiBlock }>(
        `${this.vexBase}/blocks/${encodeURIComponent(blockId)}`,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Reports what the user did on a block (selected rows, clicked point) so it
   * enters as context of the next turn.
   */
  postBlockInteraction(
    blockId: string,
    interaction: VexBlockInteraction,
  ): Observable<void> {
    return this.http
      .post<{ data: unknown }>(
        `${this.vexBase}/blocks/${encodeURIComponent(blockId)}/interaction`,
        { ...interaction },
      )
      .pipe(map(() => undefined));
  }

  /**
   * Returns `''` when there is no usable token — the caller must treat that as
   * "cannot stream" rather than opening an EventSource on a malformed URL.
   */
  getStreamUrl(conversationId: number, streamId: string): string {
    const auth_state = localStorage.getItem('vendix_auth_state');
    if (!auth_state) {
      return '';
    }
    let token: string | undefined;
    try {
      token = JSON.parse(auth_state)?.tokens?.access_token;
    } catch {
      token = undefined;
    }
    if (!token) {
      return '';
    }
    return `${this.chatBase}/conversations/${conversationId}/stream?token=${token}&stream_id=${encodeURIComponent(streamId)}`;
  }
}
