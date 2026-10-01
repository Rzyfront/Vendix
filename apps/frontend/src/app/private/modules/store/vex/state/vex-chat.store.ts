import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  VexApiService,
  VexBackendConversation,
  VexBackendMessage,
} from '../services/vex-api.service';
import {
  VexBlockInteraction,
  VexConversation,
  VexMessage,
  VexPlanProposal,
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

  private readonly _conversations = signal<VexConversation[]>([]);
  private readonly _active_id = signal<string | null>(null);
  private readonly _search_term = signal('');
  private readonly _is_agent_typing = signal(false);
  private readonly _selected_model_id = signal('vex-flash');
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
  readonly selected_model_id = this._selected_model_id.asReadonly();
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

  /** Kept for compatibility; the model is governed by superadmin now. */
  setModel(id: string): void {
    this._selected_model_id.set(id);
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
    this._busy_plan_id.set(plan_id);
    this.patchPlan(conversation_id, message_id, { status: 'approved' });
    void firstValueFrom(this.api.approvePlan(plan_id, numeric))
      .then(() => {
        // Execution resumes on the same stream that emitted the proposal.
        // When that socket is already gone, reopen the turn as approved.
        this.patchPlan(conversation_id, message_id, { status: 'executing' });
        if (!this.stream_sub || this.stream_sub.closed) {
          this.openStream(numeric, conversation_id, message_id, {
            continuation: 'approved',
            skipUserMessage: true,
          });
        }
      })
      .catch((error) => {
        this.patchPlan(conversation_id, message_id, { status: 'proposed' });
        this.toast.error(extractApiErrorMessage(error), 'No se pudo aprobar');
      })
      .finally(() => this._busy_plan_id.set(null));
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
    // Without a step token there is nothing to apply on its own: approving
    // any reversible step approves the whole plan, which is the same outcome.
    if (!confirmation_token) {
      this.approvePlan(message_id, plan.plan_id);
      return;
    }
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    const step = plan.steps.find((s) => s.step_id === step_id);
    if (!step) return;
    this._busy_plan_id.set(plan.plan_id);
    void firstValueFrom(
      this.api.applyStepConfirmation(
        step.tool,
        step.arguments ?? {},
        confirmation_token,
        numeric,
      ),
    )
      .then(() => {
        this.patchPlanStep(conversation_id, message_id, plan.plan_id, step_id, {
          status: 'done',
        });
        if (!this.stream_sub || this.stream_sub.closed) {
          this.openStream(numeric, conversation_id, message_id, {
            continuation: 'approved',
            skipUserMessage: true,
          });
        }
      })
      .catch((error) => {
        this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
      })
      .finally(() => this._busy_plan_id.set(null));
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
        this.patchMessage(conversation_id, message_id, { plan: chunk.plan });
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
    patch: { status: VexPlanProposal['steps'][number]['status'] },
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
