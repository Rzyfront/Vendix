import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  VexBlockInteraction,
  VexPlanProposal,
  VexPlanStep,
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

/**
 * Prefix for client-side plan ids. A Vex turn emits ONE `plan_approval` frame
 * with every write step (`steps` + server `plan_id`); only a single-step
 * fallback frame (a write proposed outside an accumulated plan) arrives
 * without `plan_id`, and the adapter groups it under this synthetic id so the
 * card still renders. The store applies that lone step through its own
 * single-use token — never through the plan endpoint, which would 404 on a
 * synthetic id. Whole-plan frames keep their server `plan_id` and approve
 * through `POST /store/vex/plans/:id/approve`.
 */
export const VEX_SINGLE_PLAN_PREFIX = 'single-';

interface VexRawPreview {
  status: 'ok' | 'warning' | 'error';
  target: string;
  changes: Array<{
    field: string;
    label: string;
    from: unknown;
    to: unknown;
  }>;
  message?: string;
}

interface VexRawPlanStep {
  step_id: string;
  order: number;
  tool: string;
  arguments: Record<string, unknown>;
  preview?: VexRawPreview;
  irreversible: boolean;
}

/** Backend `plan_approval` payload shape (`AIStreamChunk.plan_approval`). */
interface VexRawPlanApproval {
  /** Single-step fallback only; absent on whole-plan frames. */
  tool?: string;
  arguments?: Record<string, unknown>;
  confirmation_token?: string;
  preview?: VexRawPreview;
  plan_id?: string;
  covered_steps?: number[];
  reconfirm_steps?: number[];
  /** Whole-plan proposal (Vex only); absent on single-step frames. */
  steps?: VexRawPlanStep[];
}

/** Backend `ui_block` payload shape (`AIStreamChunk.ui_block`). */
interface VexRawUiBlock {
  block_id: string;
  kind: VexUiBlock['kind'];
  version?: number;
  spec?: Record<string, unknown>;
  data?: unknown;
}

function adaptPreview(
  preview: VexRawPreview | undefined,
): VexPlanStep['preview'] {
  if (!preview) return undefined;
  return {
    status: preview.status,
    target: preview.target,
    changes: preview.changes ?? [],
    message: preview.message,
  };
}

function stepSummary(tool: string, preview?: VexRawPreview): string {
  return preview?.target?.trim() || tool.replace(/_/g, ' ');
}

function adaptPlanStep(step: VexRawPlanStep): VexPlanStep {
  return {
    // The server id (`s1`, `s2`, …) is the merge key — never the tool name:
    // two `create_product` steps are two steps, not one.
    step_id: step.step_id,
    tool: step.tool,
    summary: stepSummary(step.tool, step.preview),
    arguments: step.arguments ?? {},
    preview: adaptPreview(step.preview),
    irreversible: step.irreversible === true,
    status: 'pending',
  };
}

function adaptFallbackStep(payload: VexRawPlanApproval): VexPlanStep {
  const tool = payload.tool ?? 'unknown_tool';
  return {
    step_id: `s1-${tool}`,
    tool,
    summary: stepSummary(tool, payload.preview),
    arguments: payload.arguments ?? {},
    preview: adaptPreview(payload.preview),
    // A fallback step always redeems its own single-use token, so it is
    // confirmed individually either way.
    irreversible: false,
    confirmation_token: payload.confirmation_token,
    status: 'pending',
  };
}

/**
 * Turns a `plan_approval` frame into the card's proposal. Whole-plan frames
 * (with `steps`) keep the server `plan_id` and per-step flags; single-step
 * fallback frames become a one-step synthetic plan carrying their own token.
 * Returns `null` for a frame with neither — malformed, ignored by the stream.
 */
function adaptPlanProposal(payload: VexRawPlanApproval): VexPlanProposal | null {
  if (Array.isArray(payload.steps) && payload.steps.length > 0) {
    const steps = payload.steps.map(adaptPlanStep);
    const target = payload.steps.length === 1
      ? payload.steps[0].preview?.target?.trim()
      : undefined;
    return {
      plan_id: payload.plan_id ?? `${VEX_SINGLE_PLAN_PREFIX}plan`,
      title: target
        ? `Vex propone: ${target}`
        : steps.length > 1
          ? `Vex propone un plan (${steps.length} pasos)`
          : 'Vex propone un plan',
      steps,
      status: 'proposed',
    };
  }
  if (typeof payload.tool === 'string') {
    const target = payload.preview?.target?.trim();
    return {
      plan_id: payload.plan_id ?? `${VEX_SINGLE_PLAN_PREFIX}${payload.tool}`,
      title: target ? `Vex propone: ${target}` : 'Vex propone un plan',
      steps: [adaptFallbackStep(payload)],
      status: 'proposed',
    };
  }
  return null;
}

function adaptUiBlock(payload: VexRawUiBlock): VexUiBlock {
  return {
    block_id: payload.block_id,
    kind: payload.kind,
    spec: (payload.spec ?? {}) as unknown as VexUiBlock['spec'],
    data: (payload.data ?? {}) as Record<string, unknown>,
    version: payload.version ?? 1,
  };
}

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

/** `POST /store/vex/plans/:id/approve` response (`ApprovePlanResult`). */
export interface VexApprovePlanResult {
  plan_id: string;
  /** Single-use plan token (TTL 15 min); the caller keeps it for `applyPlanStep`. */
  plan_token: string;
  expires_in_seconds: number;
  /** Step orders the plan token covers (run with no further confirmation). */
  covered_steps: number[];
  /** Step orders needing their own confirmation card. */
  reconfirm_steps: number[];
  /** Client orders matching no server hash (altered, invented, or stale). */
  ignored_steps: number[];
}

/** `POST /store/vex/plans/:id/steps/:step_id/confirmation` response. */
export interface VexStepConfirmation {
  confirmation_token: string;
  /** Seconds the single-use token stays valid. */
  expires_in: number;
}

/** Persisted step state as the server reports it (`metadata.plan.steps[].status`). */
export type VexServerStepStatus =
  | 'pending'
  | 'applied'
  | 'failed'
  | 'cancelled';

/** Persisted plan state as the server reports it (`metadata.plan.status`). */
export type VexServerPlanStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'applied'
  | 'partially_applied';

/** `POST /store/vex/confirmations/apply` response (per-step path). */
export interface VexApplyStepResult {
  tool: string;
  output: string;
  summary?: string | null;
  step_status: VexServerStepStatus;
  plan_status: VexServerPlanStatus;
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
  private readonly vexiBase = `${environment.apiUrl}/store/vexi`;

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
        let raw: Record<string, unknown>;
        try {
          raw = JSON.parse((event as MessageEvent).data);
        } catch {
          close();
          subscriber.error(new Error('Respuesta del servidor no válida.'));
          return;
        }

        // The backend names the payloads `plan_approval` / `ui_block`
        // (`AIStreamChunk`); this client consumes them as `plan` / `block`.
        // Adapt here so a frame the server added never dies silently.
        const chunk = { ...(raw as unknown as VexStreamChunk) };
        if (chunk.type === 'plan_approval') {
          const payload = (raw as { plan_approval?: VexRawPlanApproval })
            .plan_approval;
          if (!payload) return;
          const plan = adaptPlanProposal(payload);
          if (!plan) return;
          chunk.plan = plan;
        } else if (chunk.type === 'ui_block') {
          const payload = (raw as { ui_block?: VexRawUiBlock }).ui_block;
          if (!payload || typeof payload.block_id !== 'string') return;
          chunk.block = adaptUiBlock(payload);
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
   * Approves a whole SERVER plan at once (`plan_id` came in the frame) and
   * mints its single-use plan token (TTL 15 min, bound to user + plan +
   * ORDERED step hashes). The steps travel with the approval only as a
   * subset selector: the server verifies each one against the hashes the
   * proposing turn persisted, and anything unverifiable lands in
   * `ignored_steps`. `covered_steps` (orders) run under the plan token with
   * no further confirmation; `reconfirm_steps` always get their own card.
   * The caller keeps `plan_token` and drives each step through
   * `applyPlanStep`; when the turn's socket is gone it reopens narration
   * with a `continuation: 'approved'` intent instead.
   */
  approvePlan(
    planId: string,
    conversationId: number,
    steps: Array<{
      order: number;
      tool: string;
      arguments: Record<string, unknown>;
    }>,
  ): Observable<VexApprovePlanResult> {
    return this.http
      .post<{ data: VexApprovePlanResult }>(
        `${this.vexBase}/plans/${encodeURIComponent(planId)}/approve`,
        { conversation_id: conversationId, steps },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Cancels a plan on the server (`POST plans/:id/reject`): pending steps
   * become `cancelled`, the plan `rejected`, and its hashes are dropped so it
   * can never be approved again. 409 when it already ended (`applied`,
   * `partially_applied`, `rejected`); steps already applied keep their state.
   */
  rejectPlan(
    planId: string,
    conversationId: number,
  ): Observable<{ plan_id: string; status: 'rejected' }> {
    return this.http
      .post<{ data: { plan_id: string; status: 'rejected' } }>(
        `${this.vexBase}/plans/${encodeURIComponent(planId)}/reject`,
        { conversation_id: conversationId },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Mints the single-use confirmation token of ONE irreversible step of an
   * approved plan (`POST plans/:id/steps/:step_id/confirmation`). What a
   * reloaded page needs: in-memory tokens do not survive it. The server mints
   * it over the tool+arguments it persisted, only for an `approved` plan and a
   * `pending` irreversible step.
   */
  requestStepConfirmation(
    planId: string,
    stepId: string,
    conversationId: number,
  ): Observable<VexStepConfirmation> {
    return this.http
      .post<{ data: VexStepConfirmation }>(
        `${this.vexBase}/plans/${encodeURIComponent(planId)}/steps/${encodeURIComponent(stepId)}/confirmation`,
        { conversation_id: conversationId },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Applies one step of an approved plan (`POST confirmations/apply`, per-step
   * path): the server takes tool and arguments from the plan it persisted, and
   * EXACTLY ONE of `plan_token` (the token approve minted, reversible steps)
   * or `confirmation_token` (single-use, from `requestStepConfirmation` or a
   * `AI_AGENT_005` answer) authorizes it. Answers the tool result plus the
   * persisted `{step_status, plan_status}`.
   *
   * A non-`ok` plan-token outcome answers `AI_AGENT_005` carrying a FRESH
   * single-use token in `details`: the step needs its own card.
   */
  applyConfirmation(input: {
    conversationId: number;
    planId: string;
    stepId: string;
    planToken?: string;
    confirmationToken?: string;
  }): Observable<VexApplyStepResult> {
    return this.http
      .post<{ data: VexApplyStepResult }>(
        `${this.vexBase}/confirmations/apply`,
        {
          conversation_id: input.conversationId,
          plan_id: input.planId,
          step_id: input.stepId,
          ...(input.planToken ? { plan_token: input.planToken } : {}),
          ...(input.confirmationToken
            ? { confirmation_token: input.confirmationToken }
            : {}),
        },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Applies a single-step fallback proposal (no server plan, so no `plan_id`)
   * through its own single-use token.
   *
   * This goes to the SHARED single-use circuit (`/store/vexi/…`): the token
   * was minted by the registry for exactly this tool+args, and there is no
   * persisted plan state for `confirmations/apply` to resolve. Permissions are
   * re-checked on the way through either way.
   */
  applyStepConfirmation(
    tool: string,
    args: Record<string, unknown>,
    confirmationToken: string,
    conversationId: number,
  ): Observable<{ tool: string; output: string; summary?: string | null }> {
    return this.http
      .post<{ data: { tool: string; output: string; summary?: string | null } }>(
        `${this.vexiBase}/confirmations/apply`,
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
