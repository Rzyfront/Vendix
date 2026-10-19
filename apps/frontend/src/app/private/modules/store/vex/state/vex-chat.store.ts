import { vexApplyState } from './vex-plan-state';
import { VexiVoiceSafetyService } from '../../../../../core/services/vexi-voice-safety.service';
import { VexiVoicePipelineService } from '../../../../../core/services/vexi-voice-pipeline.service';
import {
  VoiceConsentApplied,
  voiceReceiptWasApplied,
} from '../../../../../core/services/vexi-voice-consent.model';
import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  VexiApiService,
  VexiObjective,
  VexiToolExecution,
} from '../../../../../core/services/vexi-api.service';
import {
  canResumeObjective,
  objectivePointer,
} from '../../../../../core/store/vexi/vexi-objective.utils';
import { cancelVexToolSteps, settleVexToolStep } from './vex-tool-state';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { vexiObjectiveConflictNotice } from '../../../../../core/store/vexi/vexi-user-copy.utils';
import {
  VEX_SINGLE_PLAN_PREFIX,
  VexApiService,
  VexApplyStepResult,
  VexBackendConversation,
  VexBackendMessage,
} from '../services/vex-api.service';
import {
  VexBlockInteraction,
  VexConversation,
  VexMessage,
  VexPlanProposal,
  VexPlanStatus,
  VexPlanStep,
  VexPlanStepStatus,
  VexUiBlock,
} from '../models/vex.models';

const TITLE_MAX_LENGTH = 40;
const LIST_PAGE_SIZE = 50;

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function buildMessage(
  role: VexMessage['role'],
  content: string,
  created_at: Date,
): VexMessage {
  return { id: crypto.randomUUID(), role, content, created_at };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pointer the turn close persists per block (`ai-chat.service.ts`
 * `vexTurnMetadata`): just enough to rehydrate. The payload lives in
 * `ai_ui_blocks` and arrives via `GET blocks/:id` with fresh signed URLs.
 */
interface VexBlockRef {
  block_id: string;
  kind: string;
  version: number;
}

const FRONTEND_PLAN_STATUSES: readonly VexPlanStatus[] = [
  'unknown_effect',
  'proposed',
  'approved',
  'rejected',
  'executing',
  'done',
  'partially_applied',
  'failed',
];

/**
 * Splits persisted `metadata.blocks` into full blocks (already renderable,
 * kept as-is) and refs (rehydrated via `GET blocks/:id`). A ref carries no
 * `spec` — that is the discriminator, not `kind`/`version`, which both
 * shapes share. Duplicated ids collapse to the first occurrence.
 */
function splitPersistedBlocks(raw: unknown): {
  hydrated: VexUiBlock[];
  refs: VexBlockRef[];
} {
  if (!Array.isArray(raw)) return { hydrated: [], refs: [] };
  const hydrated: VexUiBlock[] = [];
  const refs: VexBlockRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const block_id = item['block_id'];
    if (typeof block_id !== 'string' || !block_id || seen.has(block_id)) {
      continue;
    }
    seen.add(block_id);
    if (isRecord(item['spec']) && isRecord(item['data'])) {
      hydrated.push(item as unknown as VexUiBlock);
      continue;
    }
    const kind = item['kind'];
    const version = item['version'];
    refs.push({
      block_id,
      kind: typeof kind === 'string' ? kind : 'markdown',
      version: typeof version === 'number' ? version : 1,
    });
  }
  return { hydrated, refs };
}

/** Backend step status → card step status (`applied` reads `done`). */
function adaptStepStatus(raw: unknown): VexPlanStepStatus | null {
  switch (raw) {
    case 'applied':
      return 'done';
    case 'unknown':
    case 'pending':
    case 'failed':
    case 'cancelled':
      return raw;
    default:
      return null;
  }
}

/** Plan statuses after which no step can run anymore. */
function isTerminalPlanStatus(status: VexPlanStatus): boolean {
  return (
    status === 'done' || status === 'partially_applied' || status === 'rejected'
  );
}

/** Backend plan status → card status. `applied` is the only foreign value. */
function adaptPlanStatus(raw: unknown): VexPlanStatus {
  if (raw === 'applied') return 'done';
  if (
    typeof raw === 'string' &&
    (FRONTEND_PLAN_STATUSES as readonly string[]).includes(raw)
  ) {
    return raw as VexPlanStatus;
  }
  return 'proposed';
}

function adaptPersistedPreview(raw: unknown): VexPlanStep['preview'] {
  if (!isRecord(raw)) return undefined;
  if (typeof raw['target'] !== 'string') return undefined;
  const status = raw['status'];
  if (status !== 'ok' && status !== 'warning' && status !== 'error') {
    return undefined;
  }
  const changes: Array<{
    field: string;
    label: string;
    from: unknown;
    to: unknown;
  }> = [];
  if (Array.isArray(raw['changes'])) {
    for (const item of raw['changes']) {
      if (
        isRecord(item) &&
        typeof item['field'] === 'string' &&
        typeof item['label'] === 'string'
      ) {
        changes.push({
          field: item['field'],
          label: item['label'],
          from: item['from'],
          to: item['to'],
        });
      }
    }
  }
  return {
    status,
    target: raw['target'],
    changes,
    message: typeof raw['message'] === 'string' ? raw['message'] : undefined,
  };
}

/**
 * One persisted plan step → card step. Raw steps (`step_id`, `order`, `tool`,
 * `arguments`, `preview`, `irreversible`) gain their summary from the preview
 * target, falling back to the tool name — the same rule the live frame
 * adapter uses. Already-adapted steps (with `summary` + `status`) pass
 * through. Status comes from the persisted step (`applied` -> `done`,
 * `failed`, `cancelled`, `pending`). `confirmation_token` never persists: a
 * pending irreversible step of an approved plan asks the server for a fresh
 * one (`steps/:step_id/confirmation`) when the person confirms it.
 */
function adaptPersistedStep(
  raw: unknown,
  index: number,
  plan_status: VexPlanStatus,
): VexPlanStep | null {
  if (!isRecord(raw) || typeof raw['tool'] !== 'string') return null;
  const step_id =
    typeof raw['step_id'] === 'string' && raw['step_id']
      ? raw['step_id']
      : `s${index + 1}`;
  const preview = adaptPersistedPreview(raw['preview']);
  const summary =
    typeof raw['summary'] === 'string' && raw['summary'].trim()
      ? raw['summary']
      : preview?.target?.trim() || raw['tool'].replace(/_/g, ' ');
  return {
    step_id,
    tool: raw['tool'],
    summary,
    arguments: isRecord(raw['arguments'])
      ? (raw['arguments'] as Record<string, unknown>)
      : {},
    preview,
    irreversible: raw['irreversible'] === true,
    // The persisted step status is the truth. Only a step that carries none
    // (a turn older than the lifecycle) falls back to the plan's outcome.
    status:
      adaptStepStatus(raw['status']) ??
      (plan_status === 'done' ? 'done' : 'pending'),
    error:
      typeof raw['error'] === 'string' && raw['error']
        ? raw['error']
        : undefined,
  };
}

/**
 * `metadata.plan` (`{plan_id, steps, status}`) → card proposal, with its
 * persisted status. Steps are raw (`VexRawPlanStep`) — never tool-name-merged:
 * the server `step_id` stays the identity, two `create_product` steps stay
 * two steps. Returns `null` without a usable `plan_id` or step list.
 */
function adaptPersistedPlan(raw: unknown): VexPlanProposal | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['plan_id'] !== 'string' || !raw['plan_id']) return null;
  if (!Array.isArray(raw['steps'])) return null;
  const status = adaptPlanStatus(raw['status']);
  const steps = raw['steps']
    .map((s, i) => adaptPersistedStep(s, i, status))
    .filter((s): s is VexPlanStep => s !== null);
  if (steps.length === 0) return null;
  const title =
    typeof raw['title'] === 'string' && raw['title'].trim()
      ? raw['title']
      : steps.length === 1 && steps[0].preview?.target?.trim()
        ? `Vex propone: ${steps[0].preview?.target?.trim()}`
        : steps.length > 1
          ? `Vex propone un plan (${steps.length} pasos)`
          : 'Vex propone un plan';
  return { plan_id: raw['plan_id'], title, steps, status };
}

function adaptMessage(row: VexBackendMessage): {
  message: VexMessage;
  refs: VexBlockRef[];
} | null {
  if (row.role !== 'user' && row.role !== 'assistant') return null;
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const { hydrated, refs } = splitPersistedBlocks(meta['blocks']);
  const plan = adaptPersistedPlan(meta['plan']);
  return {
    message: {
      id: `m-${row.id}`,
      role: row.role === 'assistant' ? 'agent' : 'user',
      content: row.content ?? '',
      created_at: new Date(row.created_at),
      blocks: hydrated.length > 0 ? hydrated : undefined,
      plan,
    },
    refs,
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
  private readonly voice = inject(VexiVoicePipelineService);
  private readonly voiceSafety = inject(VexiVoiceSafetyService);
  private readonly objectiveApi = inject(VexiApiService);
  private readonly toast = inject(ToastService);

  private stream_sub?: Subscription;
  private stream_generation = 0;
  private readonly _stream_progress = signal('');
  readonly stream_progress = this._stream_progress.asReadonly();
  private readonly loaded_ids = new Set<string>();
  /**
   * Plan tokens minted by approve, keyed by `plan_id`. In-memory only (TTL
   * 15 min server-side): a reload drops them; pending steps then mint
   * their own single-use token on demand.
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
  private readonly _objectives = signal<Record<string, VexiObjective>>({});
  private readonly _objective_loading = signal(false);
  readonly objective_loading = this._objective_loading.asReadonly();
  readonly active_objective = computed(() => {
    const id = this._active_id();
    return id ? (this._objectives()[id] ?? null) : null;
  });
  private readonly _busy_plan_id = signal<string | null>(null);

  readonly conversations = computed(() =>
    [...this._conversations()].sort(
      (a, b) => b.updated_at.getTime() - a.updated_at.getTime(),
    ),
  );
  readonly active_id = this._active_id.asReadonly();
  readonly activeNumericId = computed(() =>
    this._active_id() ? Number(this._active_id()) : null,
  );
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
    this.voiceSafety.invalidate();
    this.voice.interrupt();
    this.closeStream();
    this._error.set(null);
    this._active_id.set(null);
  }

  selectConversation(id: string): void {
    this.voiceSafety.invalidate();
    this.voice.interrupt();
    if (!this._conversations().some((c) => c.id === id)) return;
    this.closeStream();
    this._error.set(null);
    this._active_id.set(id);
    if (!this.loaded_ids.has(id)) {
      void this.loadThread(id);
    }
  }

  /** A state read only: opening a thread must never trigger an inference. */
  refreshObjective(objectiveId: string): void {
    this._objective_loading.set(true);
    void firstValueFrom(this.objectiveApi.getObjective(objectiveId, 'vex'))
      .then((objective) => this.rememberObjective(objective))
      .catch(() => this._error.set('No pude consultar el objetivo.'))
      .finally(() => this._objective_loading.set(false));
  }

  /** Resume is a specific state transition, never whole-plan/write approval. */
  resumeObjective(objectiveId: string, confirmExpired = false): void {
    const objective = this.active_objective();
    if (
      this._objective_loading() ||
      !objective ||
      objective.id !== objectiveId ||
      !canResumeObjective(objective, confirmExpired)
    ) {
      this._error.set(
        'Selecciona el objetivo y confirma explícitamente si expiró antes de reanudarlo.',
      );
      return;
    }
    this._objective_loading.set(true);
    void firstValueFrom(
      this.objectiveApi.resumeObjective(
        objectiveId,
        {
          expected_version: objective.version,
          ...(confirmExpired ? { confirm_expired: true } : {}),
        },
        'vex',
      ),
    )
      .then((resumed) => this.rememberObjective(resumed))
      .catch(() =>
        this._error.set(
          'No se reanudó el objetivo. Actualiza su estado e inténtalo de nuevo.',
        ),
      )
      .finally(() => this._objective_loading.set(false));
  }

  private rememberObjective(objective: VexiObjective): void {
    const key = String(objective.conversation_id);
    this._objectives.update((values) => ({ ...values, [key]: objective }));
  }

  setSearchTerm(term: string): void {
    this._search_term.set(term);
  }

  async ensureVoiceConversation(): Promise<number | null> {
    const id = await this.ensureConversation('Conversación por voz');
    return id ? Number(id) : null;
  }

  sendVoiceMessage(content: string): void {
    if (!content.trim() || this._is_agent_typing()) return;
    void this.runTurn(content.trim(), [], true);
  }

  /** Adopts only the receipt from the already consumed voice request; never reapplies. */
  acceptVoiceReceipt(
    message_id: string,
    plan_id: string,
    result: VoiceConsentApplied,
  ): void {
    const conversation_id = String(result.context.conversation_id);
    const plan = this.findPlan(conversation_id, message_id, plan_id);
    const step = plan?.steps.find((item) =>
      result.confirmationToken
        ? item.confirmation_token === result.confirmationToken
        : item.step_id === result.context.step_id &&
          item.tool === result.receipt.tool &&
          result.proposalArguments !== undefined &&
          argsEqual(item.arguments ?? {}, result.proposalArguments),
    );
    if (!plan || !step) return;
    const applied =
      voiceReceiptWasApplied(result.receipt) &&
      vexApplyState(result.receipt as VexApplyStepResult).step_status ===
        'done';
    // The same fail-closed fold as click, including non-applied/missing receipts.
    // Unknown consumes the local token and closes every approval path.
    this.applyServerResult(
      conversation_id,
      message_id,
      plan_id,
      step.step_id,
      result.receipt as VexApplyStepResult,
      false,
    );
    const text =
      result.receipt.summary?.trim() ||
      (applied ? 'Cambio aplicado.' : 'Resultado pendiente de verificación.');
    this._conversations.update((list) =>
      list.map((conversation) =>
        conversation.id === conversation_id
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                buildMessage('agent', text, new Date()),
              ],
            }
          : conversation,
      ),
    );
    if (
      applied &&
      this._active_id() === conversation_id &&
      result.receipt.audio_base64
    ) {
      const id = `voice-receipt-${Date.now()}`;
      this.voice.startTurn(id);
      this.voice.enqueue(id, {
        index: 0,
        audio_base64: result.receipt.audio_base64,
        content_type: result.receipt.content_type || 'audio/mpeg',
      });
      this.voice.finishTurn(id);
    }
    if (this.active_objective()?.id && this._active_id() === conversation_id)
      this.refreshObjective(this.active_objective()!.id);
  }

  acceptRealtimeVoiceReceipt(result: VoiceConsentApplied): void {
    const conversation_id = String(result.context.conversation_id);
    const applied = voiceReceiptWasApplied(result.receipt);
    const text =
      result.receipt.summary?.trim() ||
      (applied
        ? 'Cambio aplicado.'
        : 'Resultado sin verificar. Consulta el estado.');
    this._conversations.update((list) =>
      list.map((conversation) =>
        conversation.id === conversation_id
          ? {
              ...conversation,
              messages: [
                ...conversation.messages,
                buildMessage('agent', text, new Date()),
              ],
            }
          : conversation,
      ),
    );
    if (
      applied &&
      this._active_id() === conversation_id &&
      result.receipt.audio_base64
    ) {
      const id = `voice-receipt-${Date.now()}`;
      this.voice.startTurn(id);
      this.voice.enqueue(id, {
        index: 0,
        audio_base64: result.receipt.audio_base64,
        content_type: result.receipt.content_type || 'audio/mpeg',
      });
      this.voice.finishTurn(id);
    }
    const objective = this.active_objective();
    if (objective && this._active_id() === conversation_id)
      this.refreshObjective(objective.id);
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
    void firstValueFrom(this.api.archiveConversation(numeric)).catch(
      (error) => {
        this.toast.error(extractApiErrorMessage(error), 'No se pudo eliminar');
        void this.loadConversations();
      },
    );
  }

  /** Stops the live stream; the turn already persisted stays as-is. */
  stopStream(): void {
    this.voiceSafety.invalidate();
    this.voice.interrupt();
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
                  m.streaming
                    ? {
                        ...m,
                        streaming: false,
                        tool_steps: cancelVexToolSteps(m.tool_steps ?? []),
                      }
                    : m,
                ),
              }
            : c,
        ),
      );
    }
  }

  approvePlan(message_id: string, plan_id: string): void {
    this.voiceSafety.invalidate();
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
    // One irreversible step: the card IS that step's confirmation, so one
    // click chains approve -> request confirmation -> apply.
    if (plan.steps.length === 1 && plan.steps[0].irreversible) {
      void this.runSingleIrreversibleChain(
        conversation_id,
        message_id,
        numeric,
        plan,
      );
      return;
    }
    void this.runPlanApproval(conversation_id, message_id, numeric, plan);
  }

  /**
   * Approve + confirm + apply for a one-step irreversible plan. Any failure
   * leaves plan and step `failed` with the error message; nothing retries on
   * its own and the persisted state is not re-read over it.
   */
  private async runSingleIrreversibleChain(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan: VexPlanProposal,
  ): Promise<void> {
    const step = plan.steps[0];
    this._busy_plan_id.set(plan.plan_id);
    this.patchPlan(conversation_id, message_id, { status: 'executing' });
    this.patchPlanStep(
      conversation_id,
      message_id,
      plan.plan_id,
      step.step_id,
      {
        status: 'running',
      },
    );
    try {
      const approved = await firstValueFrom(
        this.api.approvePlan(plan.plan_id, numeric, [
          { order: 1, tool: step.tool, arguments: step.arguments ?? {} },
        ]),
      );
      this.plan_tokens.set(plan.plan_id, approved.plan_token);
      const confirmation = await firstValueFrom(
        this.api.requestStepConfirmation(plan.plan_id, step.step_id, numeric),
      );
      const result = await firstValueFrom(
        this.api.applyConfirmation({
          conversationId: numeric,
          planId: plan.plan_id,
          stepId: step.step_id,
          confirmationToken: confirmation.confirmation_token,
        }),
      );
      this.finishStepApply(
        conversation_id,
        message_id,
        numeric,
        plan.plan_id,
        step.step_id,
        result,
      );
    } catch (error) {
      const message = extractApiErrorMessage(error);
      this.patchPlanStep(
        conversation_id,
        message_id,
        plan.plan_id,
        step.step_id,
        {
          status: 'failed',
          error: message,
          confirmation_token: undefined,
        },
      );
      this.patchPlan(conversation_id, message_id, { status: 'failed' });
      this.toast.error(message, 'No se pudo aplicar');
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * One click covers only the first selected change. Later changes remain
   * pending and need a fresh individual confirmation. The approve request
   * EXCLUDES irreversible steps:
   * the plan token never covers them, they stay `pending` and render their own
   * card, which asks the server for a single-use confirmation when the person
   * confirms that step. Reversible steps the token does not cover (drifted
   * args, replays) get their own card with the fresh single-use token the
   * server answers.
   *
   * Each apply answers the persisted `{step_status, plan_status}`; the card
   * follows those, not a local guess. A hard failure stops the loop: the
   * server already recorded the step as `failed`, the card re-reads that
   * truth, and the person re-asks Vex instead of re-approving, because a fresh
   * token would re-execute the steps that already landed. Narration reopens
   * only on a settled plan, so a new proposal never clobbers pending
   * own-cards.
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
      // Orders stay positional over the WHOLE plan (the server hashes are keyed
      // by it); only the irreversible entries are left out of the request. A
      // plan made only of irreversible steps has nothing else to send: the
      // server needs at least one verified step to approve, and it classifies
      // those as "reconfirm" (never covered by the token), so they go as-is.
      const all = plan.steps.map((s, i) => ({
        order: i + 1,
        tool: s.tool,
        arguments: s.arguments ?? {},
        irreversible: s.irreversible,
      }));
      const reversible = all.filter((s) => !s.irreversible);
      const payload = (reversible.length > 0 ? reversible : all).map(
        ({ order, tool, arguments: args }) => ({
          order,
          tool,
          arguments: args,
        }),
      );
      const approved = await firstValueFrom(
        this.api.approvePlan(plan.plan_id, numeric, payload),
      );
      this.plan_tokens.set(plan.plan_id, approved.plan_token);
      this.patchPlan(conversation_id, message_id, { status: 'executing' });
      const covered = new Set(approved.covered_steps ?? []);
      const ignored = new Set(approved.ignored_steps ?? []);
      const reconfirm = new Set(approved.reconfirm_steps ?? []);
      let last_plan_status: VexPlanStatus = 'approved';
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const order = i + 1;
        // Irreversible: pending, own card, own confirmation. Never run here.
        if (step.irreversible || reconfirm.has(order)) {
          this.patchPlanStep(
            conversation_id,
            message_id,
            plan.plan_id,
            step.step_id,
            {
              status: 'pending',
              confirmation_token: undefined,
            },
          );
          continue;
        }
        if (ignored.has(order) || !covered.has(order)) {
          this.patchPlanStep(
            conversation_id,
            message_id,
            plan.plan_id,
            step.step_id,
            {
              status: 'skipped',
            },
          );
          continue;
        }
        this.patchPlanStep(
          conversation_id,
          message_id,
          plan.plan_id,
          step.step_id,
          {
            status: 'running',
          },
        );
        try {
          const result = await firstValueFrom(
            this.api.applyConfirmation({
              conversationId: numeric,
              planId: plan.plan_id,
              stepId: step.step_id,
              planToken: approved.plan_token,
            }),
          );
          last_plan_status = this.applyServerResult(
            conversation_id,
            message_id,
            plan.plan_id,
            step.step_id,
            result,
            true,
          );
          if (
            last_plan_status === 'unknown_effect' ||
            last_plan_status === 'failed'
          )
            return;
        } catch (error) {
          const token = readSingleUseToken(error);
          if (token) {
            // Routed to its own card (drifted, replayed): stays pending with
            // a live token, the loop moves on.
            this.patchPlanStep(
              conversation_id,
              message_id,
              plan.plan_id,
              step.step_id,
              {
                status: 'pending',
                confirmation_token: token,
              },
            );
            this.toast.error(
              extractApiErrorMessage(error),
              'Necesita confirmación propia',
            );
            continue;
          }
          this.patchPlanStep(
            conversation_id,
            message_id,
            plan.plan_id,
            step.step_id,
            {
              status: 'failed',
              error: extractApiErrorMessage(error),
            },
          );
          this.patchPlan(conversation_id, message_id, { status: 'failed' });
          this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
          // The server recorded the failure: adopt its plan state when the
          // plan was persisted (the local `failed` above is the fallback).
          await this.syncPlanFromServer(numeric, conversation_id, plan.plan_id);
          this.reopenNarration(numeric, conversation_id, message_id);
          return;
        }
      }
      if (isTerminalPlanStatus(last_plan_status)) {
        this.reopenNarration(numeric, conversation_id, message_id);
      } else {
        // Irreversible steps (or own-cards) still await the person.
        this.patchPlan(conversation_id, message_id, { status: 'approved' });
      }
    } catch (error) {
      this.patchPlan(conversation_id, message_id, { status: 'proposed' });
      this.toast.error(extractApiErrorMessage(error), 'No se pudo aprobar');
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * Folds `{step_status, plan_status}` from an apply into the card. Inside the
   * approval loop the plan keeps reading `executing` until the server reports
   * it terminal. Returns the plan status the server reported.
   */
  private applyServerResult(
    conversation_id: string,
    message_id: string,
    plan_id: string,
    step_id: string,
    result: VexApplyStepResult,
    in_loop: boolean,
  ): VexPlanStatus {
    const state = vexApplyState(result);
    const plan_status = state.plan_status;
    this.patchPlanStep(conversation_id, message_id, plan_id, step_id, {
      status: state.step_status,
      error: state.error,
      confirmation_token: undefined,
    });
    if (
      !in_loop ||
      isTerminalPlanStatus(plan_status) ||
      plan_status === 'unknown_effect' ||
      plan_status === 'failed'
    ) {
      this.patchPlan(conversation_id, message_id, { status: plan_status });
    }
    return plan_status;
  }

  /**
   * Re-reads the persisted plan (`metadata.plan`) of this conversation and
   * replaces the card's plan with it. Used after a failure whose real outcome
   * (step `failed`, plan `partially_applied`, plan already `rejected`) only the
   * server knows. Silent when the plan was never persisted or the read fails:
   * the local state stays as the caller left it.
   */
  private async syncPlanFromServer(
    numeric: number,
    conversation_id: string,
    plan_id: string,
  ): Promise<void> {
    try {
      const row = await firstValueFrom(this.api.getConversation(numeric));
      for (const message of row.messages ?? []) {
        const raw = (message.metadata ?? {})['plan'];
        if (!isRecord(raw) || raw['plan_id'] !== plan_id) continue;
        const persisted = adaptPersistedPlan(raw);
        if (!persisted) return;
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.plan && m.plan.plan_id === plan_id
                      ? {
                          ...m,
                          plan: {
                            ...persisted,
                            // Live tokens survive a sync: they are not persisted.
                            steps: persisted.steps.map((s) => ({
                              ...s,
                              confirmation_token: m.plan?.steps.find(
                                (old) => old.step_id === s.step_id,
                              )?.confirmation_token,
                            })),
                          },
                        }
                      : m,
                  ),
                }
              : c,
          ),
        );
        return;
      }
    } catch {
      // Keep the local state.
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
    const plan = conversation?.messages.find((m) => m.id === message_id)?.plan;
    return plan && plan.plan_id === plan_id ? plan : null;
  }

  /**
   * Cancels the plan for real: `POST plans/:id/reject` first, local state
   * after. The server turns pending steps into `cancelled`, keeps the applied
   * ones, and drops the hashes so the plan can never be approved again; the
   * card mirrors exactly that. A 409 (the plan already ended) re-reads the
   * persisted state instead of pretending the cancel worked. A single-step
   * fallback proposal has no server plan: cancelling it is local.
   */
  cancelPlan(message_id: string, plan_id: string): void {
    this.voiceSafety.invalidate();
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    const plan = this.findPlan(conversation_id, message_id, plan_id);
    if (!plan || isTerminalPlanStatus(plan.status)) return;
    void this.runCancel(conversation_id, message_id, numeric, plan);
  }

  private async runCancel(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan: VexPlanProposal,
  ): Promise<void> {
    this._busy_plan_id.set(plan.plan_id);
    try {
      if (!plan.plan_id.startsWith(VEX_SINGLE_PLAN_PREFIX)) {
        await firstValueFrom(this.api.rejectPlan(plan.plan_id, numeric));
      }
      this.patchPlan(conversation_id, message_id, {
        status: 'rejected',
        steps: plan.steps.map((s) =>
          s.status === 'pending' || s.status === 'running'
            ? {
                ...s,
                status: 'cancelled' as const,
                confirmation_token: undefined,
              }
            : s,
        ),
      });
      this.plan_tokens.delete(plan.plan_id);
    } catch (error) {
      this.toast.error(extractApiErrorMessage(error), 'No se pudo cancelar');
      await this.syncPlanFromServer(numeric, conversation_id, plan.plan_id);
      return;
    } finally {
      this._busy_plan_id.set(null);
    }
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
    this.voiceSafety.invalidate();
    const conversation_id = this._active_id();
    if (!conversation_id || this._busy_plan_id()) return;
    const numeric = Number(conversation_id);
    if (!Number.isFinite(numeric)) return;
    // Fresh lookup: the card's `plan` snapshot may predate a token attach.
    const current = this.findPlan(conversation_id, message_id, plan.plan_id);
    const step = current?.steps.find((s) => s.step_id === step_id);
    if (!current || !step) return;
    if (
      step.status !== 'pending' ||
      !['proposed', 'approved', 'executing'].includes(current.status)
    )
      return;
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
    if (!current.plan_id.startsWith(VEX_SINGLE_PLAN_PREFIX)) {
      // After a reload (or once the in-memory token is gone) the single-use
      // token is minted on demand from the persisted step: request, then apply
      // through `confirmations/apply`. The person already clicked this step's
      // own approve button.
      void this.runStepConfirmationApply(
        conversation_id,
        message_id,
        numeric,
        current.plan_id,
        step,
      );
      return;
    }
    this.toast.error(
      'Esta propuesta venció. Solicita una propuesta nueva.',
      'Falta la aprobación',
    );
  }

  /**
   * Applies one step through its own single-use token. A server plan applies
   * through `confirmations/apply` (the server owns the step state and answers
   * it); a single-step fallback proposal has no server plan and goes through
   * the shared single-use circuit.
   */
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
      if (plan_id.startsWith(VEX_SINGLE_PLAN_PREFIX)) {
        const result = await firstValueFrom(
          this.api.applyStepConfirmation(
            step.tool,
            step.arguments ?? {},
            confirmation_token,
            numeric,
          ),
        );
        const applied =
          result.execution?.status === 'ok' &&
          result.execution.effect_status === 'applied';
        this.finishStepApply(
          conversation_id,
          message_id,
          numeric,
          plan_id,
          step.step_id,
          {
            ...result,
            ...(applied
              ? {
                  step_status: 'applied' as const,
                  plan_status: 'applied' as const,
                }
              : {}),
          },
        );
        return;
      }
      const result = await firstValueFrom(
        this.api.applyConfirmation({
          conversationId: numeric,
          planId: plan_id,
          stepId: step.step_id,
          confirmationToken: confirmation_token,
        }),
      );
      this.finishStepApply(
        conversation_id,
        message_id,
        numeric,
        plan_id,
        step.step_id,
        result,
      );
    } catch (error) {
      await this.handleStepError(
        error,
        conversation_id,
        numeric,
        plan_id,
        step,
      );
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /**
   * Any pending server step without a live token: `steps/:step_id/confirmation`
   * mints one over the persisted tool+arguments (only for an `approved` plan
   * and a `pending` step), then `confirmations/apply` consumes it.
   */
  private async runStepConfirmationApply(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan_id: string,
    step: VexPlanStep,
  ): Promise<void> {
    this._busy_plan_id.set(plan_id);
    try {
      const confirmation = await firstValueFrom(
        this.api.requestStepConfirmation(plan_id, step.step_id, numeric),
      );
      const result = await firstValueFrom(
        this.api.applyConfirmation({
          conversationId: numeric,
          planId: plan_id,
          stepId: step.step_id,
          confirmationToken: confirmation.confirmation_token,
        }),
      );
      this.finishStepApply(
        conversation_id,
        message_id,
        numeric,
        plan_id,
        step.step_id,
        result,
      );
    } catch (error) {
      await this.handleStepError(
        error,
        conversation_id,
        numeric,
        plan_id,
        step,
      );
    } finally {
      this._busy_plan_id.set(null);
    }
  }

  /** Card follows the server's `{step_status, plan_status}`; narrates once settled. */
  private finishStepApply(
    conversation_id: string,
    message_id: string,
    numeric: number,
    plan_id: string,
    step_id: string,
    result: VexApplyStepResult,
  ): void {
    const plan_status = this.applyServerResult(
      conversation_id,
      message_id,
      plan_id,
      step_id,
      result,
      false,
    );
    // The consumed token is gone either way.
    this.patchPlanStep(conversation_id, message_id, plan_id, step_id, {
      confirmation_token: undefined,
    });
    if (isTerminalPlanStatus(plan_status)) {
      this.reopenNarration(numeric, conversation_id, message_id);
    }
  }

  /**
   * A rejected single-use confirmation (`AI_AGENT_005`: expired, already used)
   * executed nothing, so the step stays pending and only toasts. Any other
   * failure may have consumed the step on the server: toast and re-read the
   * persisted state.
   */
  private async handleStepError(
    error: unknown,
    conversation_id: string,
    numeric: number,
    plan_id: string,
    step: VexPlanStep,
  ): Promise<void> {
    const rejected = parseApiError(error).errorCode === 'AI_AGENT_005';
    if (rejected) {
      // A stale token must not keep the card on a dead one-click path.
      this.patchPlanStep(
        conversation_id,
        this.messageOfPlan(conversation_id, plan_id),
        plan_id,
        step.step_id,
        {
          confirmation_token: undefined,
        },
      );
      this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
      return;
    }
    this.toast.error(extractApiErrorMessage(error), 'No se pudo aplicar');
    await this.syncPlanFromServer(numeric, conversation_id, plan_id);
  }

  /** Id of the message carrying `plan_id` in the conversation ('' when none). */
  private messageOfPlan(conversation_id: string, plan_id: string): string {
    const conversation = this._conversations().find(
      (c) => c.id === conversation_id,
    );
    return (
      conversation?.messages.find((m) => m.plan?.plan_id === plan_id)?.id ?? ''
    );
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
    void firstValueFrom(
      this.api.postBlockInteraction(block_id, interaction),
    ).catch((error) => {
      this.toast.error(
        extractApiErrorMessage(error),
        'No se pudo enviar la selección',
      );
    });
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
        const pointer = objectivePointer(row.metadata);
        if (pointer) this.refreshObjective(pointer);
        const adapted = (row.messages ?? [])
          .map(adaptMessage)
          .filter(
            (m): m is { message: VexMessage; refs: VexBlockRef[] } =>
              m !== null,
          );
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === id
              ? {
                  ...c,
                  title: row.title?.trim() ? row.title : c.title,
                  messages: adapted.map((a) => a.message),
                  updated_at: new Date(row.updated_at),
                }
              : c,
          ),
        );
        this.loaded_ids.add(id);
        // Blocks arrive as refs; their payloads (with fresh signed URLs)
        // land per message as each read resolves. Plans need no fetch —
        // their steps + status already adapted above.
        for (const { message, refs } of adapted) {
          if (refs.length > 0) this.rehydrateBlocks(id, message.id, refs);
        }
      })
      .catch((error) => {
        this.toast.error(extractApiErrorMessage(error), 'No se pudo abrir');
      })
      .finally(() => this._loading_thread.set(false));
  }

  /**
   * Resolves persisted block refs into renderable blocks. One `GET
   * blocks/:id` per ref — the read mints fresh signed URLs for image/file
   * kinds, which is why the payload never persists inline. Failures are
   * per-block and silent: a deleted block drops out, the rest of the thread
   * still renders. Order follows the persisted refs, so a reload shows the
   * same blocks in the same sequence the turn produced.
   */
  private rehydrateBlocks(
    conversation_id: string,
    message_id: string,
    refs: VexBlockRef[],
  ): void {
    void Promise.allSettled(
      refs.map((ref) => firstValueFrom(this.api.getBlock(ref.block_id))),
    ).then((results) => {
      const fetched = new Map<string, VexUiBlock>();
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const block = result.value;
        if (!block || typeof block.block_id !== 'string' || !block.block_id) {
          continue;
        }
        fetched.set(block.block_id, block);
      }
      if (fetched.size === 0) return;
      this._conversations.update((list) =>
        list.map((c) => {
          if (c.id !== conversation_id) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== message_id) return m;
              const previous = m.blocks ?? [];
              const by_id = new Map<string, VexUiBlock>();
              for (const b of previous) by_id.set(b.block_id, b);
              for (const [id, b] of fetched) by_id.set(id, b);
              const ordered = refs
                .map((r) => by_id.get(r.block_id))
                .filter((b): b is VexUiBlock => b !== undefined);
              const extras = [...by_id.values()].filter(
                (b) => !refs.some((r) => r.block_id === b.block_id),
              );
              return { ...m, blocks: [...ordered, ...extras] };
            }),
          };
        }),
      );
    });
  }

  private runTurn(
    text: string,
    attachment_ids: string[],
    speak = false,
  ): Promise<void> {
    this.voiceSafety.invalidate();
    this.closeStream();
    const generation = this.stream_generation;
    this._error.set(null);
    this._is_agent_typing.set(true);

    return this.ensureConversation(text)
      .then((conversation_id) => {
        if (generation !== this.stream_generation) return;
        if (!conversation_id) {
          this._is_agent_typing.set(false);
          return;
        }
        const now = new Date();
        const user_message = buildMessage('user', text, now);
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: [...c.messages, user_message],
                  updated_at: now,
                }
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
            ...(speak ? { speak: true } : {}),
          }),
        )
          .then((stream_id) => {
            if (generation !== this.stream_generation) return;
            if (speak) this.voice.startTurn(stream_id);
            this.subscribeStream(numeric, conversation_id, full.id, stream_id);
          })
          .catch((error) => {
            if (generation !== this.stream_generation) return;
            this.failFromError(conversation_id, full.id, error);
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

  /**
   * Reopens the turn after a plan decision. The narration is a NEW assistant
   * message inserted right after `anchor_message_id` (the one holding the
   * plan card): the proposal message keeps its text and card untouched and
   * the stream never appends to it. The backend persists the continuation
   * as its own `ai_messages` row (`metadata.continuation_of`), so a reload
   * shows the same order.
   */
  private openStream(
    numeric: number,
    conversation_id: string,
    anchor_message_id: string,
    options: {
      continuation: 'approved' | 'rejected' | 'resume';
      skipUserMessage?: boolean;
    },
  ): void {
    this.closeStream();
    const generation = this.stream_generation;
    this._is_agent_typing.set(true);
    const continuation_message: VexMessage = {
      ...buildMessage('agent', '', new Date()),
      blocks: [],
      tool_steps: [],
      streaming: true,
    };
    const message_id = continuation_message.id;
    this._conversations.update((list) =>
      list.map((c) => {
        if (c.id !== conversation_id) return c;
        const index = c.messages.findIndex((m) => m.id === anchor_message_id);
        const messages =
          index < 0
            ? [...c.messages, continuation_message]
            : [
                ...c.messages.slice(0, index + 1),
                continuation_message,
                ...c.messages.slice(index + 1),
              ];
        return { ...c, messages };
      }),
    );
    firstValueFrom(this.api.createStreamIntent(numeric, '', options))
      .then((stream_id) => {
        if (generation !== this.stream_generation) return;
        this.subscribeStream(
          numeric,
          conversation_id,
          message_id,
          stream_id,
          true,
        );
      })
      .catch((error) => {
        if (generation !== this.stream_generation) return;
        this.failFromError(conversation_id, message_id, error);
      });
  }

  private subscribeStream(
    numeric: number,
    conversation_id: string,
    message_id: string,
    stream_id: string,
    adopt_server_id = false,
  ): void {
    this.closeStream();
    // Continuations adopt the server id of the new row (frame `message_id`)
    // when the backend reports it; otherwise the local id stays.
    let target = message_id;
    let reconcileRequired = false;
    this.stream_sub = this.api
      .streamConversation(numeric, stream_id)
      .subscribe({
        next: (chunk) => {
          reconcileRequired ||= chunk.reconcile_required === true;
          if (
            adopt_server_id &&
            chunk.message_id !== undefined &&
            chunk.message_id !== null
          ) {
            const server_id = String(chunk.message_id);
            if (server_id && server_id !== target) {
              this.renameMessage(conversation_id, target, server_id);
              target = server_id;
            }
          }
          if (chunk.type === 'audio' && chunk.audio_base64)
            this.voice.enqueue(stream_id, {
              index: chunk.index ?? 0,
              audio_base64: chunk.audio_base64,
              content_type: chunk.content_type || 'audio/mpeg',
              filler: chunk.filler,
            });
          if (chunk.type === 'done' || chunk.type === 'error')
            this.voice.finishTurn(stream_id);
          this.applyChunk(conversation_id, target, chunk);
          if (
            reconcileRequired &&
            (chunk.type === 'done' || chunk.type === 'error')
          ) {
            void this.loadThread(conversation_id);
          }
        },
        error: (error: unknown) => {
          this.failMessage(
            conversation_id,
            target,
            error instanceof Error
              ? error.message
              : 'Se perdió la conexión con Vex.',
          );
        },
        complete: () => {
          this.stream_sub = undefined;
        },
      });
  }

  private renameMessage(
    conversation_id: string,
    from: string,
    to: string,
  ): void {
    this._conversations.update((list) =>
      list.map((c) =>
        c.id === conversation_id && !c.messages.some((m) => m.id === to)
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === from ? { ...m, id: to } : m,
              ),
            }
          : c,
      ),
    );
  }

  private applyChunk(
    conversation_id: string,
    message_id: string,
    chunk: {
      type: string;
      content?: string;
      tool?: {
        id: string;
        name: string;
        summary?: string;
        failed?: boolean;
        execution?: VexiToolExecution;
      };
      block?: VexUiBlock;
      plan?: VexPlanProposal;
      error?: string;
      objective?: VexiObjective;
    },
  ): void {
    if (chunk.objective?.conversation_id === Number(conversation_id)) {
      this.rememberObjective(chunk.objective);
    }
    switch (chunk.type) {
      case 'progress':
        this._stream_progress.set(chunk.content ?? '');
        return;
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
        const step = {
          id: chunk.tool.id,
          name: chunk.tool.name,
          status: 'running' as const,
        };
        this._conversations.update((list) =>
          list.map((c) =>
            c.id === conversation_id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === message_id
                      ? {
                          ...m,
                          tool_steps: [
                            ...(m.tool_steps ?? []).filter(
                              (existing) => existing.id !== step.id,
                            ),
                            step,
                          ],
                        }
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
        const tool = chunk.tool;
        this._conversations.update((list) =>
          list.map((conversation) =>
            conversation.id === conversation_id
              ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                    message.id === message_id
                      ? {
                          ...message,
                          tool_steps: settleVexToolStep(
                            message.tool_steps ?? [],
                            tool,
                          ),
                        }
                      : message,
                  ),
                }
              : conversation,
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
                    const exists = previous.some(
                      (b) => b.block_id === block.block_id,
                    );
                    return {
                      ...m,
                      blocks: exists
                        ? previous.map((b) =>
                            b.block_id === block.block_id ? block : b,
                          )
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
        this._stream_progress.set('');
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
        const conflict = vexiObjectiveConflictNotice(chunk);
        if (conflict) {
          this.failMessage(conversation_id, message_id, conflict, true);
          return;
        }
        // Closed catalog, like Vexi: the frame's text comes from the provider
        // or an exception and is written for the logs, never for the person.
        this.failMessage(
          conversation_id,
          message_id,
          'Vex no pudo completar la respuesta.',
        );
        return;
      }
      default:
        return;
    }
  }

  private failMessage(
    conversation_id: string,
    message_id: string,
    error: string,
    restart_suggested = false,
  ): void {
    this._stream_progress.set('');
    this.patchMessage(conversation_id, message_id, {
      streaming: false,
      error,
      restart_suggested,
    });
    this._is_agent_typing.set(false);
  }

  /**
   * A 409 of a blocked or busy conversation becomes a human notice with the
   * "Empezar de nuevo" action; anything else keeps the usual API message.
   */
  private failFromError(
    conversation_id: string,
    message_id: string,
    error: unknown,
  ): void {
    const conflict = vexiObjectiveConflictNotice(error);
    if (conflict) {
      this.failMessage(conversation_id, message_id, conflict, true);
      return;
    }
    this.failMessage(
      conversation_id,
      message_id,
      extractApiErrorMessage(error),
    );
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
                  argsEqual(s.arguments ?? {}, orphan.arguments ?? {}),
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
      error?: string;
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
    this.stream_generation++;
    this._stream_progress.set('');
    this.stream_sub?.unsubscribe();
    this.stream_sub = undefined;
  }
}
