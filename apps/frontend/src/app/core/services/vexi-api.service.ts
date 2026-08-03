import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface AIConversation {
  id: number;
  store_id: number;
  organization_id: number;
  user_id: number;
  title: string | null;
  summary: string | null;
  app_key: string | null;
  status: string;
  metadata: any;
  created_at: string;
  updated_at: string;
  messages?: AIMessage[];
}

export interface AIMessage {
  id: number;
  conversation_id: number;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: any;
  tokens_used: number;
  cost_usd: number;
  metadata: any;
  created_at: string;
}

export interface SendMessageResponse {
  user_message: { role: string; content: string };
  assistant_message: {
    id: number;
    role: string;
    content: string;
    tokens_used: number;
  };
}

/**
 * What the browser tells Vexi about the screen the user is on.
 *
 * Mirrors the backend `VexiUiContext`. It is prompt material only — the server
 * interpolates it so Vexi can say "veo que estás en el POS" and explain a
 * hidden module by the layer that hides it, and it never authorizes anything.
 */
export interface VexiUiContext {
  route?: string;
  visible_modules?: string[];
  hidden_modules?: Array<{ key: string; blocked_by: string }>;
  pos?: {
    item_count?: number;
    total?: number;
    customer?: string | null;
  };
}

/** Live narration of an agent turn, as it arrives over SSE. */
export interface VexiStreamChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: {
    id: string;
    name: string;
    arguments?: Record<string, unknown>;
    summary?: string;
    failed?: boolean;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
}

export interface PaginatedConversations {
  data: AIConversation[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({ providedIn: 'root' })
export class VexiApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/ai-chat`;

  createConversation(data: {
    app_key?: string;
    title?: string;
  }): Observable<AIConversation> {
    return this.http
      .post<{ data: AIConversation }>(`${this.baseUrl}/conversations`, data)
      .pipe(map((res) => res.data));
  }

  getConversations(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Observable<PaginatedConversations> {
    // The backend service returns `{ data, meta }`, but the response
    // interceptor flattens it: the wire shape is `{ success, message, data:
    // AIConversation[], meta }` — `data` is the array itself, not a nested
    // page object. Reading `res.data.data` yields `undefined`, which then
    // poisons the reducer (`[conv, ...undefined]` → "not iterable").
    return this.http
      .get<{ data: AIConversation[]; meta: PaginatedConversations['meta'] }>(
        `${this.baseUrl}/conversations`,
        { params: params as any },
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

  getConversation(id: number): Observable<AIConversation> {
    return this.http
      .get<{ data: AIConversation }>(`${this.baseUrl}/conversations/${id}`)
      .pipe(map((res) => res.data));
  }

  sendMessage(
    conversationId: number,
    content: string,
  ): Observable<SendMessageResponse> {
    return this.http
      .post<{ data: SendMessageResponse }>(
        `${this.baseUrl}/conversations/${conversationId}/messages`,
        { content },
      )
      .pipe(map((res) => res.data));
  }

  archiveConversation(id: number): Observable<AIConversation> {
    return this.http
      .patch<{ data: AIConversation }>(
        `${this.baseUrl}/conversations/${id}/archive`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Handshake that must precede `getStreamUrl`.
   *
   * `EventSource` cannot send a body, so the message and the UI context go
   * over POST and the stream URL carries only the opaque id this returns.
   * The previous shape put the prompt in `?content=`, which meant every
   * question a user typed was written to the access log next to their JWT.
   */
  createStreamIntent(
    conversationId: number,
    content: string,
    uiContext?: VexiUiContext,
  ): Observable<string> {
    return this.http
      .post<{ data: { stream_id: string } }>(
        `${this.baseUrl}/conversations/${conversationId}/stream-intent`,
        { content, ui_context: uiContext },
      )
      .pipe(map((res) => res.data.stream_id));
  }

  /**
   * Applies a write the user approved in the confirmation card.
   *
   * Lives under `/store/vexi` and not under `/store/ai-chat` because the same
   * approval can come from voice, where there is no conversation.
   */
  applyConfirmation(
    tool: string,
    args: Record<string, unknown>,
    confirmationToken: string,
  ): Observable<{ tool: string; output: string }> {
    return this.http
      .post<{ data: { tool: string; output: string } }>(
        `${environment.apiUrl}/store/vexi/confirmations/apply`,
        { tool, arguments: args, confirmation_token: confirmationToken },
      )
      .pipe(map((res) => res.data));
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
    const token = JSON.parse(auth_state)?.tokens?.access_token;
    if (!token) {
      return '';
    }
    return `${this.baseUrl}/conversations/${conversationId}/stream?token=${token}&stream_id=${encodeURIComponent(streamId)}`;
  }
}
