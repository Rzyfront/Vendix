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
  type:
    | 'text'
    | 'tool_call'
    | 'tool_result'
    | 'done'
    | 'error'
    // Only present when the turn asked to be spoken. `audio` carries one
    // synthesized segment, `timing` one latency mark — neither renders as
    // content, and both are ignored by the chat mode.
    | 'audio'
    | 'timing';
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
  /** Playback order of an `audio` frame. Assigned when the segment was cut. */
  index?: number;
  audio_base64?: string;
  content_type?: string;
  /** True for the human filler that covers the thinking window. */
  filler?: boolean;
  /** Name of a `timing` mark, and its milliseconds from stream open. */
  mark?: string;
  ms?: number;
}

/**
 * A document staged for Vexi, as the panel knows it.
 *
 * `attachment_id` is the opaque handle the turn carries; there is deliberately no URL
 * here, because the panel shows the file the user just picked from their own `File`
 * object and has no reason to fetch it back.
 */
export interface VexiAttachment {
  attachment_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
}

/** Background task Vexi left running, as the panel polls it. */
export interface VexiTask {
  id: number;
  goal: string;
  status: string;
  job_id: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  live_status?: string;
}

/**
 * One thing Vexi did, as the review screen shows it.
 *
 * Mirrors the backend `ActivityEntry`. `applied` is the field that matters: the feed
 * lists proposals as well as writes, and a proposal the person rejected must not read
 * as a change to the business.
 */
export interface VexiActivityEntry {
  at: string;
  conversation_id: number;
  tool: string;
  operation: string;
  applied: boolean;
  document?: {
    attachment_id: string;
    original_name: string;
  };
  linked_entity_type?: string;
  linked_entity_id?: number;
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
    attachmentIds?: string[],
    speak?: boolean,
    skipUserMessage?: boolean,
  ): Observable<string> {
    return this.http
      .post<{ data: { stream_id: string } }>(
        `${this.baseUrl}/conversations/${conversationId}/stream-intent`,
        {
          content,
          ui_context: uiContext,
          // Handles, never bytes: the files were uploaded ahead of the handshake
          // so this body stays small enough to send synchronously before the
          // EventSource opens.
          attachment_ids: attachmentIds?.length ? attachmentIds : undefined,
          // Per turn, not per conversation: the person can switch between chat
          // and voice inside the same thread. Omitted rather than sent as false
          // so a chat turn's body is byte-identical to what it was before.
          speak: speak ? true : undefined,
          // Set only when replaying a turn whose transport dropped: the `user`
          // row is written before the model is called, so the dead attempt
          // already left it behind. Omitted otherwise, so a normal turn's body
          // is byte-identical to what it was before recovery existed.
          skip_user_message: skipUserMessage ? true : undefined,
        },
      )
      .pipe(map((res) => res.data.stream_id));
  }

  /**
   * Uploads a document Vexi can then hand to a vision application.
   *
   * Returns a handle (`att_41`), never a URL. What the model receives must not be
   * something it can leak into a message, and the bytes stay in S3 behind the handle
   * so the conversation never carries a document no matter how many pages it has.
   */
  uploadAttachment(
    file: File,
    conversationId?: number,
  ): Observable<VexiAttachment> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (conversationId) {
      form.append('conversation_id', String(conversationId));
    }

    return this.http
      .post<{ data: VexiAttachment }>(
        `${environment.apiUrl}/store/vexi/attachments`,
        form,
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Reports what a UI command actually did, back into the turn that asked.
   *
   * The return leg of the closed loop: the agent turn is suspended on this exact
   * `(stream_id, tool_call_id)` pair, so without this call the loop waits out its
   * timeout and Vexi can only speak in intention. Not routed through
   * `/store/ai-chat` because the same channel serves the voice surface, which has no
   * conversation.
   */
  postUiResult(
    streamId: string,
    toolCallId: string,
    result: string,
  ): Observable<void> {
    return this.http
      .post<{ data: unknown }>(`${environment.apiUrl}/store/vexi/ui-result`, {
        stream_id: streamId,
        tool_call_id: toolCallId,
        result,
      })
      .pipe(map(() => undefined));
  }

  /** State of a background task, for the panel's task strip. */
  getTask(id: number): Observable<VexiTask> {
    return this.http
      .get<{ data: VexiTask }>(`${environment.apiUrl}/store/vexi/tasks/${id}`)
      .pipe(map((res) => res.data));
  }

  /**
   * What Vexi changed, for the review screen in Configuración.
   *
   * `data` is coerced to an array before it leaves here: the settings screen renders
   * it directly, and a non-array payload would turn `@for` into a runtime error on a
   * page whose whole purpose is reassuring the owner.
   */
  getActivity(limit = 50): Observable<VexiActivityEntry[]> {
    return this.http
      .get<{ data: VexiActivityEntry[] }>(
        `${environment.apiUrl}/store/vexi/activity`,
        { params: { limit: String(limit) } },
      )
      .pipe(map((res) => (Array.isArray(res.data) ? res.data : [])));
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
    conversationId?: number,
    speak?: boolean,
  ): Observable<{
    tool: string;
    output: string;
    /** The tool's own sentence about what it changed. Null when it wrote none. */
    summary?: string | null;
    /** Present only when `speak` was asked for and the synthesis succeeded. */
    audio_base64?: string;
    content_type?: string;
  }> {
    return this.http
      .post<{
        data: {
          tool: string;
          output: string;
          summary?: string | null;
          audio_base64?: string;
          content_type?: string;
        };
      }>(
        `${environment.apiUrl}/store/vexi/confirmations/apply`,
        {
          tool,
          arguments: args,
          confirmation_token: confirmationToken,
          // Sent so the applied change lands in the audit trail. The approval is a
          // request of its own, outside the turn, so this is the only thing that
          // ties the change back to what the person asked for.
          ...(conversationId ? { conversation_id: conversationId } : {}),
          // Asks for the acknowledgement as audio too. Omitted rather than sent
          // as false so a chat-mode approval's body is unchanged, and it carries
          // no text: the server speaks the summary the tool produced, so this can
          // never become a general text-to-speech surface.
          ...(speak ? { speak: true } : {}),
        },
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
