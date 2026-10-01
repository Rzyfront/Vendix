import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  VEX_SINGLE_PLAN_PREFIX,
  VexApiService,
  VexBackendConversation,
  VexBackendMessage,
} from '../services/vex-api.service';
import {
  VexBlockInteraction,
  VexConversation,
  VexMessage,
  VexPlanProposal,
  VexPlanStep,
  VexUiBlock,
} from '../models/vex.models';

const TITLE_MAX_LENGTH = 40;
const LIST_PAGE_SIZE = 50;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function buildMessage(
  role: VexMessage['role'],
  content: string,
  created_at: Date,
): VexMessage {
  return { id: crypto.randomUUID(), role, content, created_at };
}

function adaptMessage(row: VexBackendMessage): VexMessage | null {
  if (row.role !== 'user' && row.role !== 'assistant') return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(meta['blocks'])
    ? (meta['blocks'] as VexUiBlock[])
    : undefined;
  const plan = (meta['plan'] as VexPlanProposal | undefined) ?? null;
  return {
    id: `m-${row.id}`,
    role: row.role === 'assistant' ? 'agent' : 'user',
    content: row.content ?? '',
    created_at: new Date(row.created_at),
    blocks,
    plan,
  };
}

/**
 * Fresh single-use token answering a plan-step redeem that the plan token
 * does not cover (`AI_AGENT_005`, same `details` shape the registry uses).
 * `null` for any other error — the caller toasts those instead of routing.
 */
function readSingleUseToken(error: unknown): string | null {
  const parsed = parseApiError(error);
  if (parsed.errorCode !== 'AI_AGENT_005') return null;
  const details = parsed.details as Record<string, unknown> | null;
  const token = details?.['confirmation_token'];
  return typeof token === 'string' && token ? token : null;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
  return `{${entries.join(',')}}`;
}

/** Key-order-insensitive argument comparison for fallback token attach. */
function argsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  try {
    return stableJson(a) === stableJson(b);
  } catch {
    return false;
  }
}

function adaptConversation(
  row: VexBackendConversation,
  messages: VexMessage[] = [],
): VexConversation {
  return {
    id: String(row.id),
    title: row.title?.trim() ? row.title : 'Conversación',
    messages,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    status: row.status,
  };
}

@Injectable()
export class VexChatStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(VexApiService);
  private readonly toast = inject(ToastService);

  private stream_sub?: Subscription;
  private readonly loaded_ids = new Set<string>();
  /**
   * Plan tokens minted by approve, keyed by `plan_id`. In-memory only (TTL
   * 15 min server-side): a reload drops them and the person re-approves.
   * Plain map — never template-observed, so no signal needed.
   */
  private readonly plan_tokens = new Map<string, string>();

  private readonly _conversations = signal<VexConversation[]>([]);
  private readonly _active_id = signal<string | null>(null);
  private readonly _search_term = signal('');
  private readonly _is_agent_typing = signal(false);
  private readonly _loading_list = signal(false);
  private readonly _loading_thread = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _busy_plan_id = signal<string | null>(null);

  readonly conversations = computed(() =>
    [...this._conversations()].sort(
      (a, b) => b.updated_at.getTime() - a.updated_at.getTime(),
    ),
  );
  readonly active_id = this._active_id.asReadonly();
  readonly active_conversation = computed<VexConversation | null>(() => {
    const id = this._active_id();
    if (!id) return null;
    return this._conversations().find((c) => c.id === id) ?? null;
  });
  readonly search_term = this._search_term.asReadonly();
  readonly filtered_conversations = computed(() => {
    const term = normalizeText(this._search_term().trim());
    const all = this.conversations();
    if (!term) return all;
    return all.filter(
      (c) =>
        normalizeText(c.title).includes(term) ||
        c.messages.some((m) => normalizeText(m.content).includes(term)),
    );
  });
  readonly is_agent_typing = this._is_agent_typing.asReadonly();
  readonly loading_list = this._loading_list.asReadonly();
  readonly loading_thread = this._loading_thread.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busy_plan_id = this._busy_plan_id.asReadonly();

  constructor() {
    this.destroyRef.onDestroy(() => this.closeStream());
    void this.loadConversations();
  }

  newConversation(): void {
    this.closeStream();
    this._error.set(null);
    this._active_id.set(null);
  }

  selectConversation(id: string): void {
    if (!this._conversations().some((c) => c.id === id)) return;
    this.closeStream();
    this._error.set(null);
    this._active_id.set(id);
    if (!this.loaded_ids.has(id)) {
      void this.loadThread(id);
    }
  }

  setSearchTerm(term: string): void {
    this._search_term.set(term);
  }

  sendMessage(content: string, attachment_ids: string[] = []): void {
    const text = content.trim();
    if (!text || this._is_agent_typing()) return;
    void this.runTurn(text, attachment_ids);
  }

  deleteConversation(id: string): void {
    const numeric = Number(id);
    this._conversations.update((list) => list.filter((c) => c.id !== id));
    this.loaded_ids.delete(id);
    if (this._active_id() === id) {
      this.closeStream();
      this._active_id.set(null);
    }
    if (!Number.isFinite(numeric)) return;
    void firstValueFrom(this.api.archiveConversation(numeric)).catch((error) => {
      this.toast.error(extractApiErrorMessage(error), 'No se pudo eliminar');
      void this.loadConversations();
    });
  }

  /** Stops the live stream; the turn already persisted stays as-is. */
  stopStream(): void {
    const active = this._active_id();
    this.closeStream();
    this._is_agent_typing.set(false);
    if (active) {
      this._conversations.update((list) =>
        list.map((c) =>
          c.id === active
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.streaming ? { ...m, streaming: false } : m,
                ),
              }
            : c,
        ),
      );
    }
  }

  approvePlan(message_id: string, plan_id: string): void {
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    const plan = this.findPlan(conversation_id, message_id, plan_id);
    if (!plan || plan.status !== 'proposed') return;
    // Single-step fallback (one write proposed outside an accumulated plan,
    // so there is no bundle to approve): its own token is the approval.
    if (plan.plan_id.startsWith(VEX_SINGLE_PLAN_PREFIX)) {
      const single = plan.steps[0];
      if (single?.confirmation_token) {
        this.approveStep(
          message_id,
          plan,
          single.step_id,
          single.confirmation_token,
        );
      } else {
        this.toast.error(
          'Esta propuesta venció. Vuelve a pedirle a Vex que la proponga.',
          'No se pudo aprobar',
        );
      }
      return;
    }
    void this.runPlanApproval(conversation_id, message_id, numeric, plan);
  }

  /**
   * One click approves the bundle and drives every covered step, in order,
   * through the plan token. Steps the token does not cover (irreversibles,
   * drifted args, replays) keep their pending state and get their own card
   * with a fresh single-use token — the plan click never executes them.
   *
   * A hard failure stops the loop and settles the plan as `failed`: the
   * person re-asks Vex instead of re-approving, because a fresh token would
   * re-execute the steps that already landed. Narration reopens only on a
   * settled plan, so a new proposal never clobbers pending own-cards.
   */
  private async runPlanApproval(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan: VexPlanProposal,
  ): Promise<void> {
    this._busy_plan_id.set(plan.plan_id);
    this.patchPlan(conversation_id, message_id, { status: 'approved' });
    try {
      const payload = plan.steps.map((s, i) => ({
        order: i + 1,
        tool: s.tool,
        arguments: s.arguments ?? {},
      }));
      const approved = await firstValueFrom(
        this.api.approvePlan(plan.plan_id, numeric, payload),
      );
      this.plan_tokens.set(plan.plan_id, approved.plan_token);
      this.patchPlan(conversation_id, message_id, { status: 'executing' });
      const covered = new Set(approved.covered_steps ?? []);
      const reconfirm = new Set(approved.reconfirm_steps ?? []);
      const ignored = new Set(approved.ignored_steps ?? []);
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const order = i + 1;
        if (ignored.has(order) || (!covered.has(order) && !reconfirm.has(order))) {
          this.patchPlanStep(conversation_id, message_id, plan.plan_id, step.step_id, {
            status: 'skipped',
          });
          continue;
        }
        if (reconfirm.has(order)) {
          await this.fetchStepToken(
            conversation_id,
            message_id,
            numeric,
            plan.plan_id,
            step,
            approved.plan_token,
          );
          continue;
        }
        this.patchPlanStep(conversation_id, message_id, plan.plan_id, step.step_id, {
          status: 'running',
        });
        try {
          await firstValueFrom(
            this.api.applyPlanStep(
              step.tool,
              step.arguments ?? {},
              approved.plan_token,
              numeric,
            ),
          );
          this.patchPlanStep(conversation_id, message_id, plan.plan_id, step.step_id, {
            status: 'done',
          });
        } catch (error) {
          const token = readSingleUseToken(error);
          if (token) {
            // Routed to its own card (irreversible, drifted, replayed):
            // stays pending with a live token, the loop moves on.
            this.patchPlanStep(conversation_id, message_id, plan.plan_id, step.step_id, {
              status: 'pending',
              confirmation_token: token,
            });
            this.toast.error(
              extractApiErrorMessage(error),
              'Necesita confirmación propia',
            );
            continue;
          }
          this.patchPlanStep(conversation_id, message_id, plan.plan_id, step.step_id, {
            status: 'failed',
          });
          this.patchPlan(conversation_id, message_id, { status: 'failed' });
          this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
          this.reopenNarration(numeric, conversation_id, message_id);
          return;
        }
      }
      this.settlePlan(conversation_id, message_id, numeric);
    } catch (error) {
      this.patchPlan(conversation_id, message_id, { status: 'proposed' });
      this.toast.error(extractApiErrorMessage(error), 'No se pudo aprobar');
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * Proactive redeem of a reconfirm step: fetches its single-use token so
   * the own-card approve is one click. Redeeming an irreversible step never
   * executes (the Lua script answers without consuming), and a step the
   * token does not know answers `AI_AGENT_005` either — both land a token.
   * Anything else stays silent: the own-card click retries the redeem then.
   */
  private async fetchStepToken(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan_id: string,
    step: VexPlanStep,
    plan_token: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.api.applyPlanStep(
          step.tool,
          step.arguments ?? {},
          plan_token,
          numeric,
        ),
      );
      // Classification drifted between approve and redeem and the server ran
      // it — honor the execution.
      this.patchPlanStep(conversation_id, message_id, plan_id, step.step_id, {
        status: 'done',
      });
    } catch (error) {
      const token = readSingleUseToken(error);
      if (token) {
        this.patchPlanStep(conversation_id, message_id, plan_id, step.step_id, {
          status: 'pending',
          confirmation_token: token,
        });
      }
    }
  }

  private findPlan(
    conversation_id: string,
    message_id: string,
    plan_id: string,
  ): VexPlanProposal | null {
    const conversation = this._conversations().find(
      (c) => c.id === conversation_id,
    );
    const plan = conversation?.messages.find(
      (m) => m.id === message_id,
    )?.plan;
    return plan && plan.plan_id === plan_id ? plan : null;
  }

  cancelPlan(message_id: string, plan_id: string): void {
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    this.patchPlan(conversation_id, message_id, { status: 'rejected' });
    // The rejection reopens the turn so Vex narrates the cancellation instead
    // of leaving the thread on a dead proposal.
    this.openStream(numeric, conversation_id, message_id, {
      continuation: 'rejected',
      skipUserMessage: true,
    });
  }

  approveStep(
    message_id: string,
    plan: VexPlanProposal,
    step_id: string,
    confirmation_token?: string,
  ): void {
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    // Fresh lookup: the card's `plan` snapshot may predate a token attach.
    const current = this.findPlan(conversation_id, message_id, plan.plan_id);
    const step = current?.steps.find((s) => s.step_id === step_id);
    if (!current || !step) return;
    if (step.status === 'done' || step.status === 'running') return;
    const token = confirmation_token || step.confirmation_token;
    if (token) {
      void this.runSingleUseApply(
        conversation_id,
        message_id,
        numeric,
        current.plan_id,
        step,
        token,
      );
      return;
    }
    const plan_token = this.plan_tokens.get(current.plan_id);
    if (!plan_token) {
      this.toast.error(
        'Aprueba primero el plan para habilitar este paso.',
        'Falta la aprobación',
      );
      return;
    }
    void this.runPlanStepRedeem(
      conversation_id,
      message_id,
      numeric,
      current.plan_id,
      step,
      plan_token,
    );
  }

  /** Applies one step through its own single-use token (shared circuit). */
  private async runSingleUseApply(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan_id: string,
    step: VexPlanStep,
    confirmation_token: string,
  ): Promise<void> {
    this._busy_plan_id.set(plan_id);
    try {
      await firstValueFrom(
        this.api.applyStepConfirmation(
          step.tool,
          step.arguments ?? {},
          confirmation_token,
          numeric,
        ),
      );
      this.patchPlanStep(conversation_id, message_id, plan_id, step.step_id, {
        status: 'done',
      });
      this.settlePlan(conversation_id, message_id, numeric);
    } catch (error) {
      this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * Own-card approve without a token yet (the proactive redeem failed or the
   * plan predates it): redeems under the plan token to fetch the step's own
   * token, then holds — the person reviews the server message and clicks
   * again to apply. Never chains into execution: a `replayed` answer mints
   * a token for a step that already ran, and auto-applying it would run it
   * twice.
   */
  private async runPlanStepRedeem(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan_id: string,
    step: VexPlanStep,
    plan_token: string,
  ): Promise<void> {
    this._busy_plan_id.set(plan_id);
    try {
      await firstValueFrom(
        this.api.applyPlanStep(
          step.tool,
          step.arguments ?? {},
          plan_token,
          numeric,
        ),
      );
      this.patchPlanStep(conversation_id, message_id, plan_id, step.step_id, {
        status: 'done',
      });
      this.settlePlan(conversation_id, message_id, numeric);
    } catch (error) {
      const token = readSingleUseToken(error);
      if (token) {
        this.patchPlanStep(conversation_id, message_id, plan_id, step.step_id, {
          status: 'pending',
          confirmation_token: token,
        });
        this.toast.error(
          `${extractApiErrorMessage(error)} Revísalo y pulsa de nuevo para aplicarlo.`,
          'Necesita confirmación propia',
        );
        return;
      }
      this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * Settles a plan whose steps are all terminal (`done`/`skipped`) and
   * reopens narration so Vex tells the outcome. Plans with pending or failed
   * steps stay open: their cards still await the person.
   */
  private settlePlan(
    conversation_id: string,
    message_id: string,
    numeric: number,
  ): void {
    const plan = this._conversations()
      .find((c) => c.id === conversation_id)
      ?.messages.find((m) => m.id === message_id)?.plan;
    if (!plan) return;
    const settled = plan.steps.every(
      (s) => s.status === 'done' || s.status === 'skipped',
    );
    if (!settled) return;
    this.patchPlan(conversation_id, message_id, { status: 'done' });
    this.reopenNarration(numeric, conversation_id, message_id);
  }

  /**
   * Reopens the turn as approved so Vex narrates the outcome. Only when the
   * proposing socket is already gone — an alive stream owns the turn.
   */
  private reopenNarration(
    numeric: number,
    conversation_id: string,
    message_id: string,
  ): void {
    if (!this.stream_sub || this.stream_sub.closed) {
      this.openStream(numeric, conversation_id, message_id, {
        continuation: 'approved',
        skipUserMessage: true,
      });
    }
  }

  sendBlockInteraction(
    block_id: string,
    interaction: VexBlockInteraction,
  ): void {
    void firstValueFrom(this.api.postBlockInteraction(block_id, interaction)).catch(
      (error) => {
        this.toast.error(
          extractApiErrorMessage(error),
          'No se pudo enviar la selección',
        );
      },
    );
  }

  private loadConversations(): Promise<void> {
    this._loading_list.set(true);
    return firstValueFrom(
      this.api.listConversations({ page: 1, limit: LIST_PAGE_SIZE }),
    )
      .then((page) => {
        const active = this._active_id();
        this._conversations.set(
          page.data.map((row) => {
            const previous =
              active === String(row.id)
                ? this._conversations().find((c) => c.id === active)
                : undefined;
            // Keep live messages of the open thread; the list carries none.
            const adapted = adaptConversation(row, previous?.messages ?? []);
            if (previous) this.loaded_ids.add(adapted.id);
            return adapted;
          }),
        );
      })
      .catch((error) => {
        this._error.set(extractApiErrorMessage(error));
      })
      .finally(() => this._loading_list.set(false));
  }

  private loadThread(id: string): Promise<void> {
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) return Promise.resolve();
    this._loading_thread.set(true);
    return firstValueFrom(this.api.getConversation(numeric))
      .then((row) => {
        const messages = (row.messages ?? [])
          .map(adaptMessage)
          .filter((m): m is VexMessage => m !== null);
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === id
              ? {
                  ...c,
                  title: row.title?.trim() ? row.title : c.title,
                  messages,
                  updated_at: new Date(row.updated_at),
                }
              : c,
          ),
        );
        this.loaded_ids.add(id);
      })
      .catch((error) => {
        this.toast.error(extractApiErrorMessage(error), 'No se pudo abrir');
      })
      .finally(() => this._loading_thread.set(false));
  }

  private runTurn(text: string, attachment_ids: string[]): Promise<void> {
    this._error.set(null);
    this._is_agent_typing.set(true);

    return this
      .ensureConversation(text)
      .then((conversation_id) => {
        if (!conversation_id) {
          this._is_agent_typing.set(false);
          return;
        }
        const now = new Date();
        const user_message = buildMessage('user', text, now);
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? { ...c, messages: [...c.messages, user_message], updated_at: now }
              : c,
          ),
        );
        const agent_message = buildMessage('agent', '', now);
        const full: VexMessage = {
          ...agent_message,
          blocks: [],
          tool_steps: [],
          streaming: true,
        };
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? { ...c, messages: [...c.messages, full] }
              : c,
          ),
        );
        const numeric = Number(conversation_id);
        firstValueFrom(
          this.api.createStreamIntent(numeric, text, {
            attachmentIds: attachment_ids.length ? attachment_ids : undefined,
          }),
        )
          .then((stream_id) => {
            this.subscribeStream(
              numeric,
              conversation_id,
              full.id,
              stream_id,
            );
          })
          .catch((error) => {
            this.failMessage(
              conversation_id,
              full.id,
              extractApiErrorMessage(error),
            );
          });
      })
      .catch((error) => {
        this._is_agent_typing.set(false);
        this.toast.error(extractApiErrorMessage(error), 'No se pudo enviar');
      });
  }

  private ensureConversation(text: string): Promise<string | null> {
    const active = this._active_id();
    if (active && this._conversations().some((c) => c.id === active)) {
      return Promise.resolve(active);
    }
    return firstValueFrom(
      this.api.createConversation(text.slice(0, TITLE_MAX_LENGTH)),
    ).then(
      (row) => {
        const created = adaptConversation(row, []);
        this._conversations.update((list) => [created, ...list]);
        this.loaded_ids.add(created.id);
        this._active_id.set(created.id);
        return created.id;
      },
      () => null,
    );
  }

  private openStream(
    numeric: number,
    conversation_id: string,
    message_id: string,
    options: { continuation: 'approved' | 'rejected' | 'resume'; skipUserMessage?: boolean },
  ): void {
    this._is_agent_typing.set(true);
    this.patchMessage(conversation_id, message_id, { streaming: true, error: null });
    firstValueFrom(
      this.api.createStreamIntent(numeric, '', options),
    )
      .then((stream_id) => {
        this.subscribeStream(numeric, conversation_id, message_id, stream_id);
      })
      .catch((error) => {
        this.failMessage(conversation_id, message_id, extractApiErrorMessage(error));
      });
  }

  private subscribeStream(
    numeric: number,
    conversation_id: string,
    message_id: string,
    stream_id: string,
  ): void {
    this.closeStream();
    this.stream_sub = this.api.streamConversation(numeric, stream_id).subscribe({
      next: (chunk) => this.applyChunk(conversation_id, message_id, chunk),
      error: (error: unknown) => {
        this.failMessage(
          conversation_id,
          message_id,
          error instanceof Error ? error.message : 'Se perdió la conexión con Vex.',
        );
      },
      complete: () => {
        this.stream_sub = undefined;
      },
    });
  }

  private applyChunk(
    conversation_id: string,
    message_id: string,
    chunk: {
      type: string;
      content?: string;
      tool?: { id: string; name: string; summary?: string; failed?: boolean };
      block?: VexUiBlock;
      plan?: VexPlanProposal;
      error?: string;
    },
  ): void {
    switch (chunk.type) {
      case 'text': {
        if (!chunk.content) return;
        const delta = chunk.content;
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message_id
                      ? { ...m, content: `${m.content}${delta}` }
                      : m,
                  ),
                }
              : c,
          ),
        );
        return;
      }
      case 'tool_call': {
        if (!chunk.tool) return;
        const step = { id: chunk.tool.id, name: chunk.tool.name, status: 'running' as const };
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message_id
                      ? { ...m, tool_steps: [...(m.tool_steps ?? []), step] }
                      : m,
                  ),
                }
              : c,
          ),
        );
        return;
      }
      case 'tool_result': {
        if (!chunk.tool) return;
        const { id, summary, failed } = chunk.tool;
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message_id
                      ? {
                          ...m,
                          tool_steps: (m.tool_steps ?? []).map((s) =>
                            s.id === id
                              ? { ...s, summary, status: failed ? 'failed' as const : 'done' as const }
                              : s,
                          ),
                        }
                      : m,
                  ),
                }
              : c,
          ),
        );
        return;
      }
      case 'ui_block': {
        if (!chunk.block) return;
        const block = chunk.block;
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== message_id) return m;
                    const previous = m.blocks ?? [];
                    // A transform emits a new version of the same block: it
                    // replaces, it does not pile up.
                    const exists = previous.some((b) => b.block_id === block.block_id);
                    return {
                      ...m,
                      blocks: exists
                        ? previous.map((b) => (b.block_id === block.block_id ? block : b))
                        : [...previous, block],
                    };
                  }),
                }
              : c,
          ),
        );
        return;
      }
      case 'plan_approval': {
        if (!chunk.plan) return;
        this.mergeProposal(conversation_id, message_id, chunk.plan);
        return;
      }
      case 'done': {
        const now = new Date();
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  updated_at: now,
                  messages: c.messages.map((m) =>
                    m.id === message_id ? { ...m, streaming: false } : m,
                  ),
                }
              : c,
          ),
        );
        this._is_agent_typing.set(false);
        return;
      }
      case 'error': {
        this.failMessage(
          conversation_id,
          message_id,
          chunk.error || 'Vex no pudo completar la respuesta.',
        );
        return;
      }
      default:
        return;
    }
  }

  private failMessage(conversation_id: string, message_id: string, error: string): void {
    this.patchMessage(conversation_id, message_id, { streaming: false, error });
    this._is_agent_typing.set(false);
  }

  private patchMessage(
    conversation_id: string,
    message_id: string,
    patch: Partial<VexMessage>,
  ): void {
    this._conversations.update((list) =>
      list.map((c) =>
        c.id === conversation_id
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === message_id ? { ...m, ...patch } : m,
              ),
            }
          : c,
      ),
    );
  }

  /**
   * Folds an incoming proposal into the message's plan. A turn emits ONE
   * whole-plan frame, so it replaces whatever the card showed — a
   * re-proposal supersedes, and steps are keyed by the server `step_id`,
   * never by tool name (two `create_product` steps are two steps).
   *
   * A single-step fallback frame resumed under an open plan (same `plan_id`,
   * one step carrying its own token) attaches the token to its step —
   * matched by tool plus key-insensitive argument equality, first tokenless
   * pending step wins — instead of replacing the card. Any other fallback
   * becomes the message's plan on its own.
   */
  private mergeProposal(
    conversation_id: string,
    message_id: string,
    incoming: VexPlanProposal,
  ): void {
    this._conversations.update((list) =>
      list.map((c) => {
        if (c.id !== conversation_id) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== message_id) return m;
            const current = m.plan;
            const orphan =
              incoming.steps.length === 1 &&
              incoming.steps[0].confirmation_token
                ? incoming.steps[0]
                : null;
            if (
              orphan &&
              current &&
              current.plan_id === incoming.plan_id &&
              (current.status === 'proposed' ||
                current.status === 'approved' ||
                current.status === 'executing')
            ) {
              const idx = current.steps.findIndex(
                (s) =>
                  s.status !== 'done' &&
                  s.status !== 'skipped' &&
                  !s.confirmation_token &&
                  s.tool === orphan.tool &&
                  argsEqual(
                    s.arguments ?? {},
                    orphan.arguments ?? {},
                  ),
              );
              if (idx >= 0) {
                return {
                  ...m,
                  plan: {
                    ...current,
                    steps: current.steps.map((s, i) =>
                      i === idx
                        ? {
                            ...s,
                            confirmation_token: orphan.confirmation_token,
                          }
                        : s,
                    ),
                  },
                };
              }
            }
            return { ...m, plan: incoming };
          }),
        };
      }),
    );
  }

  private patchPlan(
    conversation_id: string,
    message_id: string,
    patch: Partial<VexPlanProposal>,
  ): void {
    this._conversations.update((list) =>
      list.map((c) =>
        c.id === conversation_id
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === message_id && m.plan
                  ? { ...m, plan: { ...m.plan, ...patch } }
                  : m,
              ),
            }
          : c,
      ),
    );
  }

  private patchPlanStep(
    conversation_id: string,
    message_id: string,
    plan_id: string,
    step_id: string,
    patch: {
      status?: VexPlanProposal['steps'][number]['status'];
      confirmation_token?: string;
    },
  ): void {
    this._conversations.update((list) =>
      list.map((c) =>
        c.id === conversation_id
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === message_id && m.plan && m.plan.plan_id === plan_id
                  ? {
                      ...m,
                      plan: {
                        ...m.plan,
                        steps: m.plan.steps.map((s) =>
                          s.step_id === step_id ? { ...s, ...patch } : s,
                        ),
                      },
                    }
                  : m,
              ),
            }
          : c,
      ),
    );
  }

  private closeStream(): void {
    this.stream_sub?.unsubscribe();
    this.stream_sub = undefined;
  }
}
