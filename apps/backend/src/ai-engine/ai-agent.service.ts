import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import {
  DEGENERATE_OUTPUT_MESSAGE,
  detectDegenerateRepetition,
} from './degenerate-output.util';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { RequestContextService } from '../common/context/request-context.service';
import { SubscriptionAccessService } from '../domains/store/subscriptions/services/subscription-access.service';
import { ErrorCodes, VendixHttpException } from '../common/errors';
import { VexiUiChannelService } from '../domains/store/vexi/vexi-ui-channel.service';
import { PROPOSE_PLAN_TOOL } from './tools/domains/planning.tools';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from './tools/bridge/capability-registry.service';
import {
  AgentPlan,
  AgentPlanHook,
  isAgentPlanTool,
} from './interfaces/agent-plan.interface';
import {
  AIMessage,
  AIResponse,
  AIStreamChunk,
} from './interfaces/ai-provider.interface';

/**
 * Tool results go to the model in full; this cap applies only to the copy
 * echoed to the UI, which shows a one-line trace, not the payload.
 */
const TOOL_RESULT_SUMMARY_CHARS = 300;

/**
 * Iteration budget once a multi-step plan is on the table.
 *
 * A single question fits in ten rounds and that stays the default, because a
 * wider budget on a one-shot question buys nothing and pays for it in latency
 * and tokens. A declared plan is the opposite case: "crea el proveedor y
 * regístrale la factura" is four to six rounds per step, and hitting the ceiling
 * mid-chain used to end the turn with the work half done and no way for the model
 * to say which half.
 */
const PLANNED_MAX_ITERATIONS = 25;

/**
 * Wall-clock budget for a planned turn.
 *
 * Iterations alone are not the binding constraint once the interface is in the
 * loop: each `ui_*` command can block up to 25 s waiting for the browser, so a
 * three-step plan can legitimately spend well past the one-minute default before
 * the model has done anything wrong.
 */
const PLANNED_TIMEOUT_MS = 180_000;

/**
 * Max "keep going" nudges per turn when the model answers in prose while the
 * internal plan still has open work. Bounded so a model that keeps refusing to
 * act cannot spin the loop; past the cap the turn closes normally.
 */
const MAX_PLAN_NUDGES = 2;

/**
 * Vex's own budgets (`ai_agents.key='vex'`).
 *
 * A whole-business turn with the full catalog does not fit the one-shot
 * defaults: 40 iterations / 300 s base, widened to 60 / 600 s once a plan is
 * on the table. Vexi keeps the historical 10/60s and 25/180s.
 */
const VEX_MAX_ITERATIONS = 40;
const VEX_TIMEOUT_MS = 300_000;
const VEX_PLANNED_MAX_ITERATIONS = 60;
const VEX_PLANNED_TIMEOUT_MS = 600_000;

/**
 * Absolute wall-clock ceiling for a turn with an explicit per-agent timeout
 * (`ai_agents.timeout_seconds`, `@Max(600)` in the DTO). Plan widening never
 * pushes a row-driven timeout past it.
 */
const AGENT_TIMEOUT_CEILING_MS = 600_000;

/**
 * Absolute iteration ceiling for any agent row. Mirrors `@Max(60)` in
 * `CreateAIAgentDto` (inherited by `UpdateAIAgentDto` via `PartialType`).
 *
 * The plan widening below never exceeds it: an explicit row value amplified
 * for a planned turn is capped here via `Math.min`, so superadmin's setting
 * is respected instead of forced up to a fixed constant.
 */
const SUPERADMIN_MAX_ITERATIONS = 60;

/**
 * Tool results longer than this never travel to the model in full: they are
 * compacted to `{summary, block_id, rows}` and the complete payload is kept
 * server-side as a block when a sink is present (step 5 of the Vex plan).
 */
const TOOL_RESULT_COMPACT_CHARS = 6000;

/** Head of a compacted result shown to the model as its summary. */
const COMPACT_SUMMARY_CHARS = 600;

export interface AgentRunParams {
  goal: string;
  system_prompt?: string;
  app_key?: string;
  tools?: string[];
  max_iterations?: number;
  /**
   * Wall-clock budget for the turn. The caller resolves it from the agent
   * row when one exists; absent, Vex defaults to 300 s and everyone else to
   * 60 s. An open plan widens it alongside the iteration budget.
   */
  timeout_ms?: number;
  /**
   * Per-agent wall-clock budget in seconds (`ai_agents.timeout_seconds`).
   * When present it replaces the hardcoded 60/300 s base; an open plan widens
   * it to at most 600 s and never below this value. Absent keeps the
   * historical behavior.
   */
  agent_timeout_seconds?: number;
  config_id?: number;
  /**
   * Prior turns of the conversation, oldest first, WITHOUT the current goal —
   * that is appended as the last user message. Absent this, every question is
   * answered in isolation and "¿y de esos cuál es el más caro?" is unanswerable.
   */
  messages?: AIMessage[];
  /**
   * Interpolation variables for the application's stored `system_prompt`.
   * Only consulted when `app_key` is set, because that is the only path where
   * the prompt comes from the database instead of the caller.
   */
  variables?: Record<string, string>;
  /**
   * Correlation id of the turn's SSE stream, when there is a browser on the
   * other end.
   *
   * Present only on the chat surface. Its absence is what tells the loop that a
   * `clientSide` command has nobody to execute it — the voice bridge and MCP both
   * dispatch commands out of band — so the loop can be honest about it instead of
   * waiting on a result that will never arrive.
   */
  stream_id?: string;
  /**
   * Bridge to the conversation's persisted task list. When present the loop
   * intercepts the plan tools (they never reach the registry nor the stream) and
   * keeps the turn going while the plan has open work. Absent on surfaces with
   * no conversation, where the plan tools keep using their stateless handlers.
   */
  plan?: AgentPlanHook;
  /**
   * Polled at the start of every iteration. True means another turn replaced
   * this one, so it stops silently: no text, no error.
   */
  shouldAbort?: () => Promise<boolean>;
  /**
   * Agent identity for this turn (`ai_agents.key`). Drives the budget table
   * (Vex gets 40/300s, 60/600s with an open plan) and travels to the audit
   * trail. Absent means the historical single-agent behavior.
   */
  agent_key?: string;
  /**
   * Agent-row tool scope. Intersected with the caller's permissions and the
   * plan allowlist (`allowed_tools` when non-empty), minus `denied_tools`
   * LAST — a deny always wins, never inverted.
   */
  agent_allowed_tools?: string[];
  agent_denied_tools?: string[];
  /**
   * Whole-plan approval for this stream. When a write tool proposes
   * (`AI_AGENT_005` with a token), the loop redeems the step against the plan
   * token INSTEAD of ending the turn: `ok` executes the step right away
   * through the same choke point (permissions re-checked, single-use inner
   * token), any other outcome falls back to the step's own confirmation card.
   */
  plan_approval?: AgentPlanApprovalHook;
  /**
   * Where compacted tool payloads (>6000 chars) are kept server-side. Absent
   * on surfaces with no conversation: compaction still shrinks what the model
   * sees, but no `block_id` is issued.
   */
  block_sink?: AgentBlockSink;
  /** Conversation the sink stores blocks under. */
  conversation_id?: number;
}

/**
 * One proposed write step of a Vex turn, before the person approves the plan.
 * Same shape `PlanApprovalService` classifies and fingerprints, so the chat
 * surface can bind those methods directly.
 */
export interface AgentProposedPlanStep {
  order: number;
  tool: string;
  args: Record<string, any>;
}

/**
 * Whole-plan approval for Vex turns, without the loop importing the Vex
 * domain (that direction would close a DI cycle: VexModule imports the global
 * AIEngineModule). Implemented by the chat surface on top of
 * `PlanApprovalService` + `VexiConfirmationService` + `VexiPlanStateService`.
 *
 * Two phases share the one hook. On a PROPOSING turn (no token yet) the loop
 * accumulates every write proposal and finalizes with a single `plan_approval`
 * frame; `classifyProposedSteps` / `saveProposedSteps` back that phase. On an
 * EXECUTING turn (the client sent back the token approve minted) the loop
 * redeems each covered step via `redeem` and runs it in the same stream.
 */
export interface AgentPlanApprovalHook {
  /**
   * Approved-plan token. Present only on executing turns — the client holds
   * the token approve minted and sends it back with the approval
   * continuation. Absent on proposing turns, where there is nothing approved
   * yet and the loop accumulates instead of redeeming.
   */
  token?: string;
  /**
   * Active plan id when the caller knows it. The loop resolves it at
   * finalization from the plan snapshot when absent.
   */
  plan_id?: string;
  redeem(
    tool: string,
    args: Record<string, any>,
  ): Promise<
    'ok' | 'missing' | 'mismatch' | 'unknown_step' | 'replayed' | 'irreversible'
  >;
  issueSingleUse(tool: string, args: Record<string, any>): Promise<string>;
  /**
   * Proposal side (Vex proposing turns, backed by PlanApprovalService):
   * splits proposed steps into covered vs reconfirm so the frame flags each
   * irreversible honestly. When absent the loop classifies locally with the
   * same rule (explicit flag → domain net → bridge path/verb → unknown fails
   * closed).
   */
  classifyProposedSteps?(steps: AgentProposedPlanStep[]): {
    covered: AgentProposedPlanStep[];
    reconfirm: AgentProposedPlanStep[];
  };
  /**
   * Proposal side (backed by VexiPlanStateService): persists the ordered step
   * hashes next to the plan, so approve-time validation never trusts the
   * client re-declaration of the steps.
   */
  saveProposedSteps?(steps: AgentProposedPlanStep[]): Promise<void>;
}

/**
 * Server-side keep for payloads too large for the turn window. Returns the
 * `block_id` the compacted reference points at.
 */
export interface AgentBlockSink {
  save(input: {
    conversation_id?: number;
    kind: 'table' | 'chart' | 'kpi' | 'image' | 'file' | 'markdown';
    spec?: Record<string, any>;
    data: unknown;
  }): Promise<string>;
}

export interface AgentResult {
  content: string;
  iterations: number;
  tools_used: Array<{ name: string; args: any; result: string }>;
  total_tokens: number;
  success: boolean;
  error?: string;
  /** The turn was superseded by a newer one (`shouldAbort`); nothing was emitted. */
  aborted?: boolean;
  /**
   * The model produced degenerate repetition (`VEX_DEGENERATE_OUTPUT`): the
   * text was discarded and an `error` frame was emitted. Callers must not
   * replace the silence with a fallback answer nor persist anything.
   */
  degenerate?: boolean;
  /**
   * The budget ran out with the plan still open: the client must fire another
   * turn to continue. `content` is empty on purpose.
   */
  plan_continue?: boolean;
  /**
   * A write the agent proposed but did not execute, waiting on the user.
   *
   * Surfaced separately from `content` because the UI renders it as a diff
   * card with approve/reject buttons, not as prose — and because the token
   * has to survive the round trip to come back on the apply call.
   */
  pending_confirmation?: {
    tool: string;
    arguments: Record<string, any>;
    confirmation_token: string;
    preview?: unknown;
  };
  /**
   * A whole-plan proposal (Vex): every write step of the turn, awaiting the
   * one-click approval. The `plan_approval` frame already carried it; this is
   * the receipt for the caller. Mutually exclusive with
   * `pending_confirmation` (the single-step path).
   */
  pending_plan?: {
    plan_id: string;
    steps: Array<{
      step_id: string;
      order: number;
      tool: string;
      arguments: Record<string, any>;
      preview?: unknown;
      irreversible: boolean;
    }>;
  };
}

@Injectable()
export class AIAgentService {
  private readonly logger = new Logger(AIAgentService.name);
  private readonly DEFAULT_MAX_ITERATIONS = 10;
  private readonly DEFAULT_TIMEOUT_MS = 60000;

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly aiLogging: AILoggingService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly eventEmitter: EventEmitter2,
    private readonly uiChannel: VexiUiChannelService,
    // Mismo patrón que `AIEngineService`: `SubscriptionsModule` es `@Global()`
    // y no importa este módulo, así que inyectar el access service no cierra
    // ningún ciclo DI.
    private readonly subscriptionAccess: SubscriptionAccessService,
  ) {}

  /**
   * A provider answer that succeeded and said nothing.
   *
   * Requires all three to be absent — text, tool calls and token usage. A real
   * final answer always has content; a real tool step always has tool calls;
   * and even an empty-string completion reports prompt tokens. Zero of all
   * three is the transport dropping the response, not the model finishing.
   */
  private isEmptyCompletion(response: {
    success: boolean;
    content?: string | null;
    tool_calls?: unknown[] | null;
    usage?: { totalTokens?: number } | null;
  }): boolean {
    return (
      response.success === true &&
      !response.content?.trim() &&
      !response.tool_calls?.length &&
      !response.usage?.totalTokens
    );
  }

  /**
   * R3-A — topes `daily_messages_cap` y `monthly_tokens_cap` de `vex_agent`,
   * antes de la primera llamada al proveedor. Verifica ambos y, si pasan,
   * consume 1 mensaje del contador diario. Con `degradation: 'block'` un cap
   * agotado corta el turno con el mismo error de cuota que el resto
   * (`SUBSCRIPTION_006`); sin `block` solo se registra. Sin tienda (interno)
   * no hay metering.
   */
  private async enforceVexTurnCaps(storeId: number | undefined): Promise<void> {
    if (!storeId) return;
    const [daily, tokens] = await Promise.all([
      this.subscriptionAccess.checkExtraQuota(
        storeId,
        'vex_agent',
        'daily_messages',
      ),
      this.subscriptionAccess.checkExtraQuota(
        storeId,
        'vex_agent',
        'monthly_tokens',
      ),
    ]);
    for (const [counter, status] of [
      ['daily_messages', daily],
      ['monthly_tokens', tokens],
    ] as const) {
      if (!status.exceeded) continue;
      this.logger.warn(
        JSON.stringify({
          event: 'VEX_CAP_EXCEEDED',
          storeId,
          counter,
          cap: status.cap,
          used: status.used,
          degradation: status.degradation,
        }),
      );
      if (status.degradation === 'block') {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_006, undefined, {
          feature: 'vex_agent',
          counter,
          cap: status.cap,
          used: status.used,
        });
      }
    }
    await this.subscriptionAccess.consumeExtraQuota(
      storeId,
      'vex_agent',
      'daily_messages',
      1,
      `${RequestContextService.getRequestId() ?? `internal-${randomUUID()}`}:vex-msg`,
    );
  }

  /** R3-A — suma los tokens del turno al contador mensual de `vex_agent`. */
  private async consumeVexTurnTokens(
    storeId: number | undefined,
    tokens: number,
  ): Promise<void> {
    if (!storeId || !(tokens > 0)) return;
    try {
      await this.subscriptionAccess.consumeExtraQuota(
        storeId,
        'vex_agent',
        'monthly_tokens',
        tokens,
        `${RequestContextService.getRequestId() ?? `internal-${randomUUID()}`}:vex-tokens`,
      );
    } catch (err) {
      this.logger.warn(
        `VEX_TOKENS_CONSUMED failed for store=${storeId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Metering key for the turn: Vex burns its own `vex_agent` budget, every
   * other agent (Vexi included) keeps the historical `tool_agents` one.
   * Unknown or absent keys fall back to `tool_agents` — fail-open on
   * identity, fail-closed on the gate itself.
   */
  private quotaFeatureFor(
    agentKey: string | undefined,
  ): 'vex_agent' | 'tool_agents' {
    return agentKey === 'vex' ? 'vex_agent' : 'tool_agents';
  }

  /**
   * F3 — allowlist efectiva de tools del plan (`tools_allowed` de la feature
   * de cuota del turno: `vex_agent` en turnos Vex, `tool_agents` en el resto).
   *
   * - Sin `storeId` → `null`: llamada interna, sin alcance de plan.
   * - Gate bloqueado (feature deshabilitada → `SUBSCRIPTION_005`, cuota
   *   agotada → `SUBSCRIPTION_006`, estado terminal) → set vacío: el turno
   *   sigue sin tools en lugar de ofrecer el catálogo completo.
   * - Gate permitido + `tools_allowed` declarado → `*` habilita el catálogo
   *   permitido, un dominio habilita sus tools y un nombre solo esa tool.
   * - Gate permitido + sin lista declarada → `null` (el plan no acota).
   * - Fallo del gate → `null` + warn: no se rompe el turno por un fallo de
   *   infraestructura de metering; cada iteración sigue pasando por el gate
   *   de `run()` (F2).
   *
   * El filtrado aplica siempre, también en modo log-only: la lista es alcance
   * del plan, no enforcement — ofrecer tools que el plan no incluye sería
   * regalar capacidad que la tienda no compró.
   */
  private async resolvePlanToolAllowlist(
    storeId: number | undefined,
    agentKey?: string,
  ): Promise<Set<string> | null> {
    if (!storeId) return null;
    const feature = this.quotaFeatureFor(agentKey);
    try {
      const [gate, config] = await Promise.all([
        this.subscriptionAccess.canUseAIFeature(storeId, feature),
        this.subscriptionAccess.getAIFeatureConfig(storeId, feature),
      ]);

      this.logger.log(
        JSON.stringify({
          event: 'AI_TOOLS_GATE',
          storeId,
          feature,
          allowed: gate.allowed,
          reason: gate.reason ?? null,
          tools_allowed_declared: Array.isArray(config?.tools_allowed)
            ? config.tools_allowed.length
            : null,
        }),
      );

      if (!gate.allowed) return new Set();
      if (!config || !Array.isArray(config.tools_allowed)) return null;
      return new Set(
        config.tools_allowed.map((name) =>
          this.toolRegistry.canonicalName(name),
        ),
      );
    } catch (err) {
      this.logger.warn(
        `AI_TOOLS_GATE lookup failed for store=${storeId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * F3 — 1 unidad al contador mensual por `tool_result` exitoso,
   * post-ejecución, nunca pre-consumo (mismo Lua con dedup que el resto de
   * cuotas IA).
   *
   * El `requestId` se deriva por llamada (`turno + tool_call.id`): con el id
   * del turno a secas, el dedup colapsaría N llamadas del mismo turno en un
   * solo incremento y el contador mentiría; con uno fresco por llamada se
   * perdería la idempotencia ante reintentos. Nominalmente único por llamada
   * es el punto correcto.
   *
   * Solo ejecuciones servidoras exitosas (`executeTool` resolvió): los
   * despachos `clientSide` los ejecuta el navegador (resultado no observado),
   * las propuestas `AI_AGENT_005` aún no ejecutaron nada y los errores no
   * consumieron capacidad. Nunca lanza: el metering no rompe turnos.
   */
  private async consumeToolCallQuota(
    storeId: number | undefined,
    toolCallId: string | undefined,
    toolName: string,
    agentKey?: string,
  ): Promise<void> {
    if (!storeId) return;
    const feature = this.quotaFeatureFor(agentKey);
    try {
      const base =
        RequestContextService.getRequestId() ?? `internal-${randomUUID()}`;
      await this.subscriptionAccess.consumeAIQuota(
        storeId,
        feature,
        1,
        `${base}:tool:${toolCallId || randomUUID()}`,
      );
      this.logger.log(
        JSON.stringify({
          event: 'AI_TOOL_CONSUMED',
          storeId,
          feature,
          tool: toolName,
        }),
      );
    } catch (err) {
      this.logger.warn(
        `AI_TOOL_CONSUMED failed for store=${storeId} tool=${toolName}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * The sentence shown for a write that is proposed but not applied.
   *
   * Built from the preview the tool itself computed, so what the user reads
   * and what the approval card shows come from the same source.
   *
   * Two preview shapes are accepted because two families of tools produce
   * them: the typed tools describe *what* they touch (`target`), while
   * `write_endpoint` describes *the operation* (`label`, e.g. "Crear un
   * gasto"). Reading only `target` made every bridge write fall through to the
   * last resort, which used to name the tool — "la propuesta para
   * write_endpoint" — exactly the internal detail the agent is told never to
   * show. The fallback is now generic instead: vague beats leaking, and the
   * approval card carries the specifics regardless.
   */
  private describePendingWrite(
    pending: NonNullable<AgentResult['pending_confirmation']>,
  ): string {
    const preview = pending.preview as
      | {
          target?: unknown;
          label?: unknown;
          message?: unknown;
          changes?: Array<{ label?: unknown; from?: unknown; to?: unknown }>;
        }
      | undefined;

    const target =
      typeof preview?.target === 'string' && preview.target.trim()
        ? preview.target.trim()
        : null;

    // Labels are verb-initial by construction (`describeWrite`), so they read
    // as a clause once the leading capital is dropped.
    const label =
      typeof preview?.label === 'string' && preview.label.trim()
        ? preview.label.trim().charAt(0).toLowerCase() +
          preview.label.trim().slice(1)
        : null;

    // Una creación no tiene valor anterior, así que `from` llega `undefined` e
    // interpolarlo escribía "Nombre: undefined → Six-pack QA" en la narración,
    // mientras la tarjeta —que sí distingue el caso— mostraba "—". Sin valor
    // previo se enuncia solo el nuevo.
    const diff = (preview?.changes ?? [])
      .filter((change) => typeof change?.label === 'string')
      .map((change) =>
        change.from === undefined || change.from === null || change.from === ''
          ? `${change.label}: ${change.to}`
          : `${change.label}: ${change.from} → ${change.to}`,
      )
      .join('; ');

    const head = label
      ? `Tengo lista la propuesta: ${label}.`
      : target
        ? `Tengo lista la propuesta para ${target}.`
        : 'Tengo lista la propuesta del cambio.';

    const note =
      typeof preview?.message === 'string' && preview.message.trim()
        ? ` ${preview.message.trim()}`
        : '';

    return [
      head,
      diff ? ` ${diff}.` : '',
      note,
      ' Todavía no la apliqué: apruébala y la aplico.',
    ].join('');
  }

  /**
   * Local twin of `PlanApprovalService`'s irreversibility rule, for proposing
   * turns whose surface bound no `classifyProposedSteps`: explicit flag →
   * domain net → bridge path/verb → unknown fails closed. The approve-time
   * classification (server, full) re-checks anyway, so a drift here mislabels
   * the card at worst — never smuggles a step through the token.
   */
  private isIrreversibleProposal(
    toolName: string,
    args: Record<string, any>,
  ): boolean {
    const tool = this.toolRegistry.get(toolName) as
      | { domain?: string; irreversible?: boolean }
      | undefined;
    if (!tool) return true;
    if (tool.irreversible === true) return true;
    if (tool.domain && IRREVERSIBLE_DOMAIN_SEGMENTS.has(tool.domain)) {
      return true;
    }
    if (toolName === 'write_endpoint') {
      const segments = String(args?.path ?? '')
        .split('/')
        .filter(Boolean);
      if (segments.some((s) => IRREVERSIBLE_DOMAIN_SEGMENTS.has(s))) {
        return true;
      }
      if (String(args?.method ?? '').toUpperCase() === 'DELETE') return true;
    }
    return false;
  }

  /**
   * The sentence closing a Vex turn that recorded a plan: a compact step list
   * for the transcript (the card carries the full diffs) plus the irreversible
   * count. Composed server-side for the same reason as `describePendingWrite`:
   * with writes pending, the model is not trusted to word what happened.
   */
  private describePendingPlan(
    steps: Array<{
      order: number;
      tool: string;
      preview?: unknown;
      irreversible: boolean;
    }>,
  ): string {
    const labelOf = (tool: string, preview: unknown): string => {
      const p = preview as
        | { label?: unknown; target?: unknown }
        | undefined;
      const label =
        typeof p?.label === 'string' && p.label.trim()
          ? p.label.trim().charAt(0).toLowerCase() + p.label.trim().slice(1)
          : null;
      if (label) return label;
      const target =
        typeof p?.target === 'string' && p.target.trim()
          ? p.target.trim()
          : null;
      return target ?? tool;
    };
    const head =
      steps.length === 1
        ? 'Tengo listo un plan con 1 paso'
        : `Tengo listo un plan con ${steps.length} pasos`;
    const list = steps
      .map((s) => `${s.order}. ${labelOf(s.tool, s.preview)}`)
      .join('; ');
    const flagged = steps.filter((s) => s.irreversible).length;
    const tail =
      flagged > 0
        ? ` ${flagged} ${flagged === 1 ? 'necesita' : 'necesitan'} su propia confirmación por ser irreversible.`
        : '';
    return `${head}: ${list}.${tail} Todavía no apliqué nada: revísalo y apruébalo de una vez.`;
  }

  /**
   * Builds the whole-plan proposal from the turn's recorded writes: classifies
   * each step, resolves the plan id (hook → active plan snapshot → fresh id),
   * and persists the ordered hashes so approve validates against the server,
   * never against the client's re-declaration.
   */
  private async buildVexPlanProposal(
    proposals: Array<{
      order: number;
      step_id: string;
      tool: string;
      args: Record<string, any>;
      preview?: unknown;
    }>,
    params: AgentRunParams,
  ): Promise<NonNullable<AgentResult['pending_plan']>> {
    const hookSteps: AgentProposedPlanStep[] = proposals.map((p) => ({
      order: p.order,
      tool: p.tool,
      args: p.args,
    }));
    let reconfirmOrders: Set<number>;
    if (params.plan_approval?.classifyProposedSteps) {
      const { reconfirm } =
        params.plan_approval.classifyProposedSteps(hookSteps);
      reconfirmOrders = new Set(reconfirm.map((s) => s.order));
    } else {
      reconfirmOrders = new Set(
        hookSteps
          .filter((s) => this.isIrreversibleProposal(s.tool, s.args))
          .map((s) => s.order),
      );
    }
    const planId =
      params.plan_approval?.plan_id ??
      (await params.plan?.snapshot())?.id ??
      randomUUID();
    await params.plan_approval?.saveProposedSteps?.(hookSteps);
    const steps = proposals.map((p) => ({
      step_id: p.step_id,
      order: p.order,
      tool: p.tool,
      arguments: p.args,
      ...(p.preview !== undefined ? { preview: p.preview } : {}),
      irreversible: reconfirmOrders.has(p.order),
    }));
    return { plan_id: planId, steps };
  }

  /**
   * Closes a Vex turn that recorded write proposals with the ONE plan frame.
   * Emits `plan_approval` (plan + steps + coverage), then the narration as a
   * single text chunk, then `done`.
   */
  private async *finalizeVexPlan(input: {
    proposals: Array<{
      order: number;
      step_id: string;
      tool: string;
      args: Record<string, any>;
      preview?: unknown;
    }>;
    params: AgentRunParams;
    totalTokens: number;
    iteration: number;
    toolsUsed: AgentResult['tools_used'];
  }): AsyncGenerator<AIStreamChunk, AgentResult> {
    const { proposals, params, totalTokens, iteration, toolsUsed } = input;
    const context = RequestContextService.getContext();
    const pendingPlan = await this.buildVexPlanProposal(proposals, params);
    this.eventEmitter.emit('ai.agent.completed', {
      iterations: iteration,
      tools_used: toolsUsed.length,
      total_tokens: totalTokens,
      store_id: context?.store_id,
    });
    yield {
      type: 'plan_approval',
      plan_approval: {
        plan_id: pendingPlan.plan_id,
        steps: pendingPlan.steps,
        covered_steps: pendingPlan.steps
          .filter((s) => !s.irreversible)
          .map((s) => s.order),
        reconfirm_steps: pendingPlan.steps
          .filter((s) => s.irreversible)
          .map((s) => s.order),
      },
    };
    const narration = this.describePendingPlan(pendingPlan.steps);
    yield { type: 'text', content: narration };
    yield {
      type: 'done',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens },
    };
    return {
      content: narration,
      iterations: iteration,
      tools_used: toolsUsed,
      total_tokens: totalTokens,
      success: true,
      pending_plan: pendingPlan,
    };
  }

  /**
   * What is still owed by the plan, phrased for the internal nudge, or null when
   * the turn may end (no open step, everything verified, or the plan is waiting
   * on the person).
   */
  private nextPlanObligation(plan: AgentPlan): string | null {
    if (plan.steps.some((step) => step.status === 'waiting_user')) return null;
    const open = plan.steps.find(
      (step) => step.status === 'pending' || step.status === 'in_progress',
    );
    if (open) return `paso ${open.order}: ${open.title}`;
    if (plan.deliverables.some((d) => !d.verified)) {
      return 'verifica los entregables con verify_deliverables';
    }
    return null;
  }

  /**
   * Shrinks an oversized tool result to `{summary, block_id, rows}`.
   *
   * The model keeps a head summary plus the row count; the complete payload is
   * kept server-side as a markdown block when a sink (and a conversation) is
   * present, so a later turn can page through it with `vex_block_read`
   * instead of re-running the query. Short results pass through untouched.
   * Never throws: a sink failure degrades to a sink-less compaction.
   */
  private async compactToolResult(
    toolName: string,
    result: string,
    params: AgentRunParams,
  ): Promise<string> {
    // Vex-only: its 40-iteration turns over the full catalog are the ones that
    // drown in 100KB query results. Vexi keeps full results — its trace,
    // transcript and model all predate compaction and behave unchanged.
    if (params.agent_key !== 'vex') return result;
    if (result.length <= TOOL_RESULT_COMPACT_CHARS) return result;
    let rows: number | null = null;
    try {
      const parsed: unknown = JSON.parse(result);
      const rowsOf = (v: unknown): unknown[] | null => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          for (const key of ['rows', 'data', 'items', 'results']) {
            if (Array.isArray(o[key])) return o[key] as unknown[];
          }
          const data = o.data;
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            for (const key of ['rows', 'items', 'results']) {
              const nested = (data as Record<string, unknown>)[key];
              if (Array.isArray(nested)) return nested;
            }
          }
        }
        return null;
      };
      const found = rowsOf(parsed);
      if (found) rows = found.length;
    } catch {
      // Not JSON: no row count, still compacted.
    }
    let blockId: string | null = null;
    if (params.block_sink && params.conversation_id) {
      try {
        blockId = await params.block_sink.save({
          conversation_id: params.conversation_id,
          kind: 'markdown',
          spec: { title: `Resultado de ${toolName}`, source_tool: toolName },
          data: { text: result },
        });
      } catch (err) {
        this.logger.warn(
          `Compaction sink failed for tool "${toolName}": ${(err as Error).message}`,
        );
      }
    }
    return JSON.stringify({
      summary: result.slice(0, COMPACT_SUMMARY_CHARS),
      block_id: blockId,
      rows,
      truncated: true,
      next_step: blockId
        ? 'El resultado completo quedó guardado en el bloque block_id: léelo por partes con vex_block_read en vez de repetir la consulta.'
        : 'El resultado venía truncado: refina la consulta si necesitas el resto.',
    });
  }

  /**
   * Extracts the `ui_block` frame from a render tool's success envelope.
   *
   * Only `vex_render_*` and `vex_block_transform` produce blocks; anything
   * else — including error envelopes and non-JSON results — answers null and
   * the turn simply carries no frame for that call.
   */
  private uiBlockOf(
    toolName: string,
    result: string,
  ): AIStreamChunk['ui_block'] | null {
    const renderKind =
      toolName === 'vex_render_table'
        ? 'table'
        : toolName === 'vex_render_chart'
          ? 'chart'
          : toolName === 'vex_render_kpi'
            ? 'kpi'
            : toolName === 'vex_render_image'
              ? 'image'
              : toolName === 'vex_render_file'
                ? 'file'
                : null;
    if (!renderKind && toolName !== 'vex_block_transform') return null;
    try {
      const parsed = JSON.parse(result) as {
        data?: {
          block_id?: unknown;
          kind?: unknown;
          version?: unknown;
          block?: {
            block_id?: unknown;
            kind?: unknown;
            version?: unknown;
            spec?: unknown;
            data?: unknown;
          };
        };
      };
      const data = parsed?.data;
      if (!data || typeof data.block_id !== 'string' || !data.block_id) {
        return null;
      }
      const kind =
        renderKind ??
        (typeof data.kind === 'string' &&
        ['table', 'chart', 'kpi', 'image', 'file', 'markdown'].includes(
          data.kind,
        )
          ? (data.kind as NonNullable<AIStreamChunk['ui_block']>['kind'])
          : 'table');
      // The render tools attach the panel-ready view (`VexUiBlock`) as
      // `data.block`; without it the frame is a bare reference the panel
      // cannot draw, so legacy envelopes keep answering the old shape.
      const view =
        data.block && typeof data.block === 'object' ? data.block : null;
      const version = view?.version ?? data.version;
      return {
        block_id:
          typeof view?.block_id === 'string' && view.block_id
            ? view.block_id
            : data.block_id,
        kind,
        ...(typeof version === 'number' ? { version } : {}),
        ...(view && typeof view.spec === 'object' && view.spec !== null
          ? { spec: view.spec as Record<string, any> }
          : {}),
        ...(view && view.data !== undefined ? { data: view.data } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * Non-streaming entry point. Drains the streaming loop and keeps its return
   * value, so there is exactly one implementation of the agent protocol —
   * a second copy for the SSE path would drift the moment either is touched.
   */
  async runAgent(params: AgentRunParams): Promise<AgentResult> {
    const iterator = this.runAgentStream(params);
    let step = await iterator.next();
    while (!step.done) {
      step = await iterator.next();
    }
    return step.value;
  }

  /**
   * The agent loop, narrating itself.
   *
   * Yields `tool_call` before each execution and `tool_result` after, so the
   * UI can show what Vexi is doing instead of a 30-40s spinner. The final
   * answer arrives as `text` and then `done`.
   *
   * The final text is emitted as one chunk rather than token by token: the
   * loop cannot know which iteration is the last until the model answers
   * without tool calls, and switching that call to `runStream()` would mean
   * committing to "this is the end" before the model has said so. Narrating
   * the tools is what removes the dead air; the last paragraph arriving whole
   * is not what the wait was made of.
   */
  async *runAgentStream(
    params: AgentRunParams,
  ): AsyncGenerator<AIStreamChunk, AgentResult> {
    const startTime = Date.now();
    const isVex = params.agent_key === 'vex';
    const plannedMax = isVex
      ? VEX_PLANNED_MAX_ITERATIONS
      : PLANNED_MAX_ITERATIONS;
    const plannedTimeout = isVex ? VEX_PLANNED_TIMEOUT_MS : PLANNED_TIMEOUT_MS;
    // Not `const`: a declared plan widens it mid-turn (see PLANNED_MAX_ITERATIONS).
    // The row value comes from superadmin (`ai_agents.max_iterations`); absent,
    // the agent default holds (Vex 40, everyone else 10).
    const baseDefault = isVex ? VEX_MAX_ITERATIONS : this.DEFAULT_MAX_ITERATIONS;
    let maxIterations = params.max_iterations || baseDefault;
    // Plan-amplified budget: the row value (or the agent default) plus the
    // plan headroom, capped at the superadmin absolute max. `Math.min`, not a
    // fixed `Math.max`: forcing every planned turn up to a constant would
    // override a superadmin who deliberately set a lower row value, and would
    // let a high row value grow past the ceiling the DTO enforces for new rows.
    const plannedBudget = Math.min(
      maxIterations + (plannedMax - baseDefault),
      SUPERADMIN_MAX_ITERATIONS,
    );
    // Widened alongside the iteration budget, and for a second reason: a turn
    // that drives the interface now blocks up to 25 s per command waiting for the
    // browser, so two UI steps alone can consume the whole one-minute default and
    // abort a turn that was working correctly.
    const agentTimeoutMs =
      typeof params.agent_timeout_seconds === 'number' &&
      params.agent_timeout_seconds > 0
        ? Math.min(
            Math.floor(params.agent_timeout_seconds * 1000),
            AGENT_TIMEOUT_CEILING_MS,
          )
        : undefined;
    let timeoutMs =
      agentTimeoutMs ??
      (params.timeout_ms || (isVex ? VEX_TIMEOUT_MS : this.DEFAULT_TIMEOUT_MS));
    // Widening for an open plan. Without a row timeout it is the historical
    // `max(current, planned)`; with one it is capped at 600 s and never drops
    // below the row value.
    const widenTimeout = (current: number): number =>
      agentTimeoutMs === undefined
        ? Math.max(current, plannedTimeout)
        : Math.min(
            Math.max(current, plannedTimeout, agentTimeoutMs),
            AGENT_TIMEOUT_CEILING_MS,
          );

    const context = RequestContextService.getContext();

    // Same resolution `executeTool()` uses, and it has to be: the catalog and
    // the execution gate must authorize on identical grounds. Passing `roles`
    // here compared `['owner']` against `['store:inventory:stock_levels:read']`,
    // so `every()` never matched and the model was handed an empty toolset
    // while `executeTool()` would happily have run those same tools.
    // `[]` is truthy, so the fallback needs a length check.
    const granted = context?.permissions;
    const authScopes = granted?.length ? granted : (context?.roles ?? []);
    // Agent scope narrows the permission catalog: user perms ∩ agent
    // allowed_tools (when non-empty) − agent denied_tools, deny applied last.
    // The plan allowlist intersects below, so the final catalog is the triple
    // intersection minus the deny list. Without agent scope this is exactly
    // `getAvailableDefinitions` and Vexi behaves as before.
    const hasAgentScope =
      (params.agent_allowed_tools?.length ?? 0) > 0 ||
      (params.agent_denied_tools?.length ?? 0) > 0;
    const permissionTools =
      hasAgentScope && typeof this.toolRegistry.getAgentDefinitions === 'function'
        ? this.toolRegistry.getAgentDefinitions(authScopes, {
            allowed_tools: params.agent_allowed_tools,
            denied_tools: params.agent_denied_tools,
          })
        : this.toolRegistry.getAvailableDefinitions(authScopes);

    // F3 — el plan del tenant filtra el catálogo del turno: el modelo solo ve
    // la intersección entre los permisos del caller y `tools_allowed`. Sin
    // store_id (llamadas internas, cron, super-admin) se conserva el
    // comportamiento actual. `null` = sin alcance de plan; un `Set` (quizá
    // vacío) = alcance aplicado.
    const planAllowed = await this.resolvePlanToolAllowlist(
      context?.store_id,
      params.agent_key,
    );
    const toolDefinitions =
      planAllowed === null || planAllowed.has('*')
        ? permissionTools
        : permissionTools.filter((tool) => {
            const name = this.toolRegistry.canonicalName(tool.function.name);
            const domain = this.toolRegistry.get(name)?.domain;
            return (
              planAllowed.has(name) ||
              (domain !== undefined && planAllowed.has(domain))
            );
          });

    // Filter tools if specific ones requested
    const filteredTools = params.tools?.length
      ? toolDefinitions.filter((t) => params.tools!.includes(t.function.name))
      : toolDefinitions;

    // The plan tools are the loop's own scaffolding, not tenant capability: with
    // a hook present they must be offered even if the tenant allowlist or the
    // caller's `tools` narrowing left them out, or the model could never close
    // a plan. They come from the permission-filtered catalog so they still
    // respect the caller's scopes.
    if (params.plan) {
      const present = new Set(
        filteredTools.map((t) =>
          this.toolRegistry.canonicalName(t.function.name),
        ),
      );
      for (const def of permissionTools) {
        const name = this.toolRegistry.canonicalName(def.function.name);
        if (isAgentPlanTool(name) && !present.has(name)) {
          filteredTools.push(def);
          present.add(name);
        }
      }
    }

    // An already-active plan (a continuation turn) gets the wide budget from the
    // first iteration instead of waiting for a propose_plan that will not come.
    if (params.plan && (await params.plan.snapshot())) {
      maxIterations = Math.max(maxIterations, plannedBudget);
      timeoutMs = widenTimeout(timeoutMs);
    }

    const messages: AIMessage[] = [];

    // With an app key the system prompt lives in the database and `run()`
    // prepends it already interpolated, so pushing one here would send two
    // competing system messages and defeat the variable substitution.
    if (!params.app_key) {
      messages.push({
        role: 'system',
        content:
          params.system_prompt ??
          'You are a helpful business assistant for Vendix. Use the available tools to answer questions with real data. Always provide specific numbers and insights. Respond in the same language the user uses.',
      });
    }

    // The stored Vexi prompt describes what the product can do in general,
    // not what this subscription/user/agent can do in this particular turn.
    // Without this correction a plan with no UI tool still makes Vexi offer
    // to navigate, and an empty catalog makes it offer live lookups it cannot do.
    const offeredNames = new Set(
      filteredTools.map((tool) =>
        this.toolRegistry.canonicalName(tool.function.name),
      ),
    );
    const hasOperationalTools = [...offeredNames].some(
      (name) => !isAgentPlanTool(name),
    );
    if (!hasOperationalTools || !offeredNames.has('ui_navigate')) {
      const limits: string[] = [];
      if (!hasOperationalTools) {
        limits.push(
          'No tienes herramientas operativas para consultar datos actuales ni ejecutar acciones en este turno.',
        );
      }
      if (!offeredNames.has('ui_navigate')) {
        limits.push(
          'No puedes mover la pantalla del usuario ni ofrecer llevarlo a un módulo.',
        );
      }
      messages.push({
        role: 'system',
        content: `${limits.join(' ')} Explica esa limitación con claridad y no prometas una acción que no puedes ejecutar.`,
      });
    }

    if (params.messages?.length) {
      messages.push(...params.messages);
    }

    messages.push({ role: 'user', content: params.goal });

    const toolsUsed: AgentResult['tools_used'] = [];
    let pendingConfirmation: AgentResult['pending_confirmation'];
    /**
     * Write proposals recorded by a Vex PROPOSING turn (no plan token yet).
     * They finalize into ONE `plan_approval` frame — never one card per write
     * — once the model stops calling tools. Stays empty on every other turn.
     */
    const vexProposals: Array<{
      order: number;
      step_id: string;
      tool: string;
      args: Record<string, any>;
      preview?: unknown;
    }> = [];
    let totalTokens = 0;
    let iteration = 0;
    let timedOut = false;
    let planNudges = 0;
    // Time spent blocked on the browser (`ui_*` results). It is the person's
    // screen latency, not the model's work, so it must not eat the turn budget.
    let waitedMs = 0;

    // R3-A: vex caps gate the turn BEFORE the first provider call. Outside the
    // try on purpose: a cap breach is a quota error the caller surfaces, not a
    // loop failure to narrate.
    if (isVex) {
      await this.enforceVexTurnCaps(context?.store_id);
    }

    try {
      while (iteration < maxIterations) {
        // Another turn replaced this one: stop without a word.
        if (params.shouldAbort && (await params.shouldAbort())) {
          return {
            content: '',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: false,
            aborted: true,
          };
        }

        // Timeout check. It used to throw AI_AGENT_002, which escaped the
        // generator and cut the SSE mid-request; now it just leaves the loop
        // and the code below decides how to close (plan_continue or a kind
        // last answer).
        if (Date.now() - startTime - waitedMs > timeoutMs) {
          timedOut = true;
          break;
        }

        iteration++;

        this.eventEmitter.emit('ai.agent.iteration', {
          iteration,
          max_iterations: maxIterations,
          store_id: context?.store_id,
        });

        const toolOptions = {
          tools: filteredTools.length > 0 ? filteredTools : undefined,
          tool_choice: (filteredTools.length > 0 ? 'auto' : undefined) as
            | 'auto'
            | undefined,
        };

        // Route through `run()` whenever an application exists: it is the only
        // path that enforces the subscription gate, the rate limit and writes
        // an `ai_engine_logs` row. `chat()`/`chatWith()` skip all three, so an
        // agent that iterates ten times used to burn ten calls off the books.
        // Every iteration counts — that is the point, not a side effect.
        const callProvider = () =>
          params.app_key
            ? this.aiEngine.run(
                params.app_key,
                params.variables,
                messages,
                toolOptions,
              )
            : params.config_id
              ? this.aiEngine.chatWith(params.config_id, messages, toolOptions)
              : this.aiEngine.chat(messages, toolOptions);

        let response = await callProvider();

        // Around one call in six comes back `success` with no content, no tool
        // calls and no usage at all — a provider hiccup, not a decision. The
        // loop reads that as "the model has nothing more to say" and ends the
        // turn, so the user asks a question and gets silence. One retry costs a
        // second and turns most of those into real answers; the retry is not
        // repeated so a genuinely mute model still terminates the loop.
        if (this.isEmptyCompletion(response)) {
          this.logger.warn(
            `Empty completion at iteration ${iteration}; retrying once`,
          );
          response = await callProvider();
        }

        if (!response.success) {
          yield { type: 'error', error: response.error || 'AI request failed' };
          return {
            content: response.error || 'AI request failed',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: false,
            error: response.error,
          };
        }

        totalTokens += response.usage?.totalTokens || 0;

        // Degenerate output ("ellsellsells…" up to the token cap). `run()` hands
        // back the finished completion, so there is no provider call left to
        // abort here; what can still be avoided is painting and persisting it.
        const degeneration = detectDegenerateRepetition(response.content ?? '');
        if (degeneration.degenerate) {
          this.logger.error(
            JSON.stringify({
              event: 'VEX_DEGENERATE_OUTPUT',
              storeId: context?.store_id,
              model: response.model,
              chars: (response.content ?? '').length,
              cut_at: degeneration.cutAt,
              agent_key: params.agent_key,
              iteration,
            }),
          );
          yield { type: 'error', error: DEGENERATE_OUTPUT_MESSAGE };
          return {
            content: '',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: false,
            error: DEGENERATE_OUTPUT_MESSAGE,
            degenerate: true,
          };
        }

        // If finish_reason is 'length', the response was truncated
        if (response.finish_reason === 'length') {
          this.logger.warn(
            `Agent response truncated (max tokens) at iteration ${iteration}`,
          );
        }

        // Tool calls are honoured whatever `finish_reason` says: several
        // providers answer 'stop' with tool_calls attached, and closing the turn
        // on that dropped the calls and left compound requests half done.
        if (!response.tool_calls?.length) {
          // A Vex turn that recorded write proposals ends HERE with the single
          // plan frame — never nudged back (the person must approve first) and
          // never closed as prose (the proposals would be lost with it).
          if (isVex && vexProposals.length > 0) {
            return yield* this.finalizeVexPlan({
              proposals: vexProposals,
              params,
              totalTokens,
              iteration,
              toolsUsed,
            });
          }
          // The model spoke while the plan still has open work: push it back
          // into the loop instead of ending the turn on a status sentence.
          if (
            params.plan &&
            !pendingConfirmation &&
            planNudges < MAX_PLAN_NUDGES
          ) {
            const snap = await params.plan.snapshot();
            const next = snap ? this.nextPlanObligation(snap) : null;
            if (next) {
              planNudges++;
              if (response.content) {
                messages.push({ role: 'assistant', content: response.content });
              }
              messages.push({
                role: 'user',
                content: `(interno) Aún no terminas: ${next}. Continúa sin avisarle a la persona; solo detente para una escritura (tarjeta) o con ask_user.`,
              });
              continue;
            }
          }

          this.eventEmitter.emit('ai.agent.completed', {
            iterations: iteration,
            tools_used: toolsUsed.length,
            total_tokens: totalTokens,
            store_id: context?.store_id,
          });

          // With a write still awaiting approval, the model's own wording is
          // not trusted to describe it. Observed with weaker models: the tool
          // answers "esperando confirmación" and the reply is "ya quedó, le
          // subí el 5%" — a claim that the store's data changed when it did
          // not. The prompt forbids it and the model does it anyway, so the
          // sentence is composed from the server's own preview instead. Tone
          // loses a little; a false report about the business would cost more.
          const narration = pendingConfirmation
            ? this.describePendingWrite(pendingConfirmation)
            : response.content;

          if (narration) {
            yield { type: 'text', content: narration };
          }
          yield {
            type: 'done',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            },
          };

          return {
            content: narration || '',
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: true,
            pending_confirmation: pendingConfirmation,
          };
        }

        // Process tool calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        for (const toolCall of response.tool_calls) {
          // Normalized once, here, so the whole turn speaks one name: the
          // streamed frames, the trace, the clientSide check and the browser's
          // command dispatcher. Gemini prefixes calls with `default_api.`, and
          // a frame carrying that prefix reaches a frontend that matches on the
          // bare name — the UI command silently never runs.
          const toolName = this.toolRegistry.canonicalName(
            toolCall.function.name,
          );
          let toolArgs: Record<string, any>;

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          // Plan tools go to the hook: the task list is internal scaffolding,
          // so no frame, no trace entry and no quota for them. Handled before
          // any `tool_call` frame is emitted.
          if (params.plan && isAgentPlanTool(toolName)) {
            let planContent: string;
            try {
              const outcome = await params.plan.execute(toolName, toolArgs);
              planContent = outcome.result;

              if (toolName === PROPOSE_PLAN_TOOL) {
                maxIterations = Math.max(maxIterations, plannedBudget);
                timeoutMs = widenTimeout(timeoutMs);
              }

              if (outcome.endTurn) {
                messages.push({
                  role: 'tool',
                  content: planContent,
                  tool_call_id: toolCall.id,
                });
                this.eventEmitter.emit('ai.agent.completed', {
                  iterations: iteration,
                  tools_used: toolsUsed.length,
                  total_tokens: totalTokens,
                  store_id: context?.store_id,
                });
                const text = outcome.endTurn.text;
                // A question asked after recording writes must not drop them:
                // the frame goes out first, then the question it may answer.
                let pendingPlan: AgentResult['pending_plan'];
                if (isVex && vexProposals.length > 0) {
                  pendingPlan = await this.buildVexPlanProposal(
                    vexProposals,
                    params,
                  );
                  yield {
                    type: 'plan_approval',
                    plan_approval: {
                      plan_id: pendingPlan.plan_id,
                      steps: pendingPlan.steps,
                    },
                  };
                }
                yield { type: 'text', content: text };
                yield {
                  type: 'done',
                  usage: { promptTokens: 0, completionTokens: 0, totalTokens },
                };
                return {
                  content: text,
                  iterations: iteration,
                  tools_used: toolsUsed,
                  total_tokens: totalTokens,
                  success: true,
                  ...(pendingPlan ? { pending_plan: pendingPlan } : {}),
                };
              }
            } catch (planError: any) {
              planContent = JSON.stringify({
                error: `Plan tool error: ${planError?.message ?? 'unknown'}`,
              });
            }
            messages.push({
              role: 'tool',
              content: planContent,
              tool_call_id: toolCall.id,
            });
            continue;
          }

          // Execution backstop for the offered catalog. The model may only run
          // tools from the set it was offered this turn (permissions ∩ plan ∩
          // agent scope − denies). A call outside that set — a hallucinated
          // name or a tool denied for this agent, e.g. `ui_navigate` in a Vex
          // turn — is rejected HERE, before the clientSide branch and before
          // `executeTool`: nothing reaches the browser, nothing executes,
          // nothing consumes quota. The rejection goes back as a tool result
          // so the model can correct itself on the next iteration.
          //
          // R3-A: this runs BEFORE the `ai.agent.tool_executed` event and the
          // `tool_call` frame. The browser dispatches UI commands off that
          // frame, so emitting it first let a not-offered `ui_*` reach the
          // screen even though execution was rejected afterwards. A rejected
          // call now produces only the error `tool_result`, never a `tool_call`.
          if (!offeredNames.has(toolName)) {
            const notAllowed =
              `AI_AGENT_TOOL_NOT_ALLOWED: la herramienta "${toolName}" no ` +
              `está en el catálogo ofrecido en este turno. Usa solo las ` +
              `herramientas ofrecidas; si ninguna sirve, dilo y pide lo que falte.`;
            messages.push({
              role: 'tool',
              content: JSON.stringify({
                error: notAllowed,
                error_code: 'AI_AGENT_TOOL_NOT_ALLOWED',
              }),
              tool_call_id: toolCall.id,
            });
            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: notAllowed.slice(0, TOOL_RESULT_SUMMARY_CHARS),
                failed: true,
              },
            };
            continue;
          }

          this.logger.log(
            `Agent iteration ${iteration}: executing tool "${toolName}"`,
          );

          this.eventEmitter.emit('ai.agent.tool_executed', {
            iteration,
            tool_name: toolName,
            store_id: context?.store_id,
          });

          // T5: el deprecado se ejecuta igual (el sunset aún no vence) pero el
          // frame lo dice en voz alta, para que la traza visible y el modelo
          // migren a `replacedBy` antes de que el nombre desaparezca.
          const deprecation = this.toolRegistry.getDeprecation(toolName);
          const deprecatedWarning = deprecation
            ? `La herramienta "${toolName}" está deprecada desde v${deprecation.since}` +
              (deprecation.sunset
                ? ` y se retira en ${deprecation.sunset}`
                : '') +
              (deprecation.replacedBy
                ? `. Usa "${deprecation.replacedBy}" en su lugar.`
                : '.')
            : undefined;

          yield {
            type: 'tool_call',
            tool: {
              id: toolCall.id,
              name: toolName,
              arguments: toolArgs,
              ...(deprecatedWarning
                ? { deprecated_warning: deprecatedWarning }
                : {}),
            },
          };

          // A UI command is dispatched by the browser off the `tool_call`
          // frame just emitted; there is no router or cart in this process to
          // run it against. Calling `executeTool()` would be correct-by-
          // contract and useless here — it rejects client-side tools on
          // purpose, and the model would read that rejection as a failure and
          // apologize for something the user is watching happen. That
          // rejection still guards the surfaces that bypass this loop (voice
          // bridge, MCP), where a client that cannot dispatch must fail loudly.
          if (this.toolRegistry.isClientSide(toolName)) {
            // With a browser on the line, the turn now WAITS for what actually
            // happened on screen instead of assuming. This is the fix for the
            // loop's worst honesty defect: the old code pushed
            // `dispatched_to_client` and moved on, so the model's next thought
            // was formed with no idea whether the command found the module, hit
            // a variant picker, or failed outright — and it routinely narrated
            // success it had never observed. Now `ui_add_to_cart` on a product
            // with variants comes back `needs_user_input` and the same turn asks
            // which variant, because the answer arrived before the model spoke.
            const waitStart = Date.now();
            const uiResult = params.stream_id
              ? await this.uiChannel.awaitResult(params.stream_id, toolCall.id)
              : null;
            waitedMs += Date.now() - waitStart;

            const resultPayload =
              uiResult ??
              JSON.stringify({
                dispatched: true,
                command: toolName,
                result_unknown: true,
                // Reached in two situations that share one honest answer: no
                // browser is listening (voice, MCP), or the browser never
                // answered within the window because the user closed the panel
                // or navigated away. Either way the outcome is unobserved, and
                // saying so is the only truthful option left.
                note: `Se envió al navegador ÚNICAMENTE el comando "${toolName}" con esos argumentos y NO llegó respuesta, así que no sabes si funcionó. Habla en intención, no en hecho consumado ("te lo estoy agregando", no "ya quedó agregado"), y ofrécele verificarlo. Si tu objetivo necesita más pasos, pídelos uno por uno con su propia llamada. Nunca digas que hiciste algo cuyo resultado no viste.`,
              });

            toolsUsed.push({
              name: toolName,
              args: toolArgs,
              result: resultPayload,
            });
            messages.push({
              role: 'tool',
              content: resultPayload,
              tool_call_id: toolCall.id,
            });

            // Emitted for the real result too, so the panel's trace shows what
            // the screen answered and not just what was asked of it.
            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: resultPayload.slice(0, TOOL_RESULT_SUMMARY_CHARS),
              },
            };
            continue;
          }

          try {
            // Las `vex_*` de bloques viven bajo una conversación que el modelo
            // no conoce: el turno inyecta su id como default para que la
            // herramienta no tenga que inventarlo (y no falle validación).
            if (
              toolName.startsWith('vex_') &&
              params.conversation_id != null &&
              !Number.isInteger(toolArgs.conversation_id)
            ) {
              toolArgs = {
                ...toolArgs,
                conversation_id: params.conversation_id,
              };
            }
            const raw = await this.toolRegistry.executeTool(toolName, toolArgs);
            // Oversized results travel compacted from here on: the trace, the
            // persisted transcript and the model all see `{summary, block_id,
            // rows}`, never the full payload twice.
            const result = await this.compactToolResult(toolName, raw, params);

            toolsUsed.push({
              name: toolName,
              args: toolArgs,
              result,
            });

            // F3 — el `tool_result` exitoso suma 1 al contador mensual del
            // periodo, post-ejecución. Va después de `executeTool` a propósito:
            // propuestas, errores y despachos clientSide no consumen.
            await this.consumeToolCallQuota(
              context?.store_id,
              toolCall.id,
              toolName,
              params.agent_key,
            );

            // A plan is a promise about the rest of the turn, so the turn is
            // given room to keep it. Raised here rather than at the top because
            // the model decides mid-turn whether the request is compound: a
            // budget set before the first provider call would have to guess, and
            // guessing high makes every simple question slower.
            if (toolName === PROPOSE_PLAN_TOOL) {
              maxIterations = Math.max(maxIterations, plannedBudget);
              timeoutMs = widenTimeout(timeoutMs);
            }

            messages.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });

            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: result.slice(0, TOOL_RESULT_SUMMARY_CHARS),
              },
            };

            const uiBlock = this.uiBlockOf(toolName, raw);
            if (uiBlock) {
              yield { type: 'ui_block', ui_block: uiBlock };
            }
          } catch (error: any) {
            // A confirmation demand is not a failure — it is the proposal
            // step of the write protocol. The registry answers `AI_AGENT_005`
            // carrying the diff and a single-use token; the model needs both
            // so it can describe the change in the user's own terms, and the
            // caller needs the token so approving it can actually apply.
            const payload =
              error instanceof VendixHttpException
                ? (error.getResponse() as Record<string, any>)
                : null;

            if (payload?.error_code === 'AI_AGENT_005') {
              const details = payload.details as
                | Record<string, any>
                | undefined;

              // The token is what separates the two outcomes that share this
              // error code. `enforceConfirmation` throws it both when a change
              // is queued for approval AND when the preview already proved the
              // change impossible — and the second case deliberately mints no
              // token. Reporting both as `requires_confirmation: true` told the
              // model a rejected write was waiting on the user, so it narrated
              // approval cards that did not exist. Without a token there is no
              // proposal: it is a refusal the model can still fix and retry.
              if (!details?.confirmation_token) {
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({
                    requires_confirmation: false,
                    applied: false,
                    error: payload.message,
                    preview: details?.preview,
                    next_step:
                      'Este cambio NO quedó propuesto y no hay nada que el usuario pueda aprobar. Corrige lo que falló y vuelve a intentarlo, o dile a la persona qué dato hace falta.',
                  }),
                  tool_call_id: toolCall.id,
                });
                yield {
                  type: 'tool_result',
                  tool: {
                    id: toolCall.id,
                    name: toolName,
                    summary: 'No se pudo preparar el cambio.',
                  },
                };
                continue;
              }

              // Same-stream plan execution: the turn carries an approved plan
              // token, so a covered step runs NOW instead of ending the turn
              // on a card. `redeem` verifies the ordered canonical hashes
              // server-side; anything but `ok` (altered args, irreversible
              // step, replay, expired token) falls through to the step's own
              // proposal below. The inner single-use token keeps the choke
              // point honest: permissions + roles are re-validated and the
              // handler re-checks its preconditions on the way through.
              // Token-gated (not hook-gated): a proposing turn carries the
              // hook for its classify/save side and must accumulate below.
              if (params.plan_approval?.token) {
                let approved: Awaited<
                  ReturnType<AgentPlanApprovalHook['redeem']>
                > = 'missing';
                try {
                  approved = await params.plan_approval.redeem(
                    toolName,
                    toolArgs,
                  );
                } catch (redeemError: any) {
                  this.logger.warn(
                    `Plan redeem failed for tool "${toolName}": ${redeemError?.message ?? 'unknown'}`,
                  );
                }
                if (approved === 'ok') {
                  const singleUse =
                    await params.plan_approval.issueSingleUse(
                      toolName,
                      toolArgs,
                    );
                  const appliedRaw = await this.toolRegistry.executeTool(
                    toolName,
                    toolArgs,
                    { confirmationToken: singleUse },
                  );
                  const applied = await this.compactToolResult(
                    toolName,
                    appliedRaw,
                    params,
                  );
                  toolsUsed.push({
                    name: toolName,
                    args: toolArgs,
                    result: applied,
                  });
                  await this.consumeToolCallQuota(
                    context?.store_id,
                    toolCall.id,
                    toolName,
                    params.agent_key,
                  );
                  messages.push({
                    role: 'tool',
                    content: applied,
                    tool_call_id: toolCall.id,
                  });
                  yield {
                    type: 'tool_result',
                    tool: {
                      id: toolCall.id,
                      name: toolName,
                      summary: applied.slice(0, TOOL_RESULT_SUMMARY_CHARS),
                    },
                  };
                  const appliedBlock = this.uiBlockOf(toolName, appliedRaw);
                  if (appliedBlock) {
                    yield { type: 'ui_block', ui_block: appliedBlock };
                  }
                  continue;
                }
              }

              // Vex proposing turn (no token): the proposal is RECORDED and the
              // turn keeps going, so one turn yields ONE plan frame with every
              // write step instead of one card per write. Approval (one click)
              // and per-step execution happen after, through the plan token.
              // Executing turns (token present, redeem answered non-ok) fall
              // through to the single card below — re-planning them would orphan
              // the approval they run under.
              if (isVex && !params.plan_approval?.token) {
                const order = vexProposals.length + 1;
                vexProposals.push({
                  order,
                  step_id: `s${order}`,
                  tool: toolName,
                  args: toolArgs,
                  preview: details.preview,
                });
                messages.push({
                  role: 'tool',
                  content: JSON.stringify({
                    requires_confirmation: true,
                    proposal_recorded: true,
                    step_order: order,
                    preview: details?.preview,
                    next_step:
                      'Esta escritura quedó registrada como un paso del plan del turno. NO la repitas ni pidas aprobación en palabras: si faltan más pasos, propón el siguiente; si terminaste, cierra con un resumen corto y el plan se pedirá aprobar de una vez.',
                  }),
                  tool_call_id: toolCall.id,
                });
                yield {
                  type: 'tool_result',
                  tool: {
                    id: toolCall.id,
                    name: toolName,
                    summary: `Paso ${order} registrado en el plan.`,
                  },
                };
                continue;
              }

              pendingConfirmation = {
                tool: toolName,
                arguments: toolArgs,
                confirmation_token: details.confirmation_token,
                preview: details.preview,
              };

              messages.push({
                role: 'tool',
                content: JSON.stringify({
                  requires_confirmation: true,
                  message: payload.message,
                  preview: details?.preview,
                }),
                tool_call_id: toolCall.id,
              });
              yield {
                type: 'tool_result',
                tool: {
                  id: toolCall.id,
                  name: toolName,
                  summary: 'Esperando confirmación del usuario.',
                },
              };
              yield {
                type: 'plan_approval',
                plan_approval: {
                  tool: toolName,
                  arguments: toolArgs,
                  confirmation_token: details.confirmation_token,
                  preview: details?.preview,
                  ...(params.plan_approval?.plan_id
                    ? { plan_id: params.plan_approval.plan_id }
                    : {}),
                },
              };
              continue;
            }

            const errorMsg =
              error instanceof VendixHttpException
                ? (payload?.message ?? error.message)
                : `Tool error: ${error.message}`;

            messages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMsg }),
              tool_call_id: toolCall.id,
            });

            yield {
              type: 'tool_result',
              tool: {
                id: toolCall.id,
                name: toolName,
                summary: errorMsg.slice(0, TOOL_RESULT_SUMMARY_CHARS),
                failed: true,
              },
            };
          }
        }

        // Un turno que propone un cambio TERMINA ahí.
        //
        // Sin este corte el bucle seguía girando con `requires_confirmation:
        // true` en el último resultado, y el modelo —que no tiene forma de
        // aprobar nada— volvía a llamar la misma herramienta de escritura. Cada
        // reintento acuñaba un token nuevo, pisaba `pendingConfirmation` y
        // emitía otro "esperando confirmación": la persona veía a Vexi pidiendo
        // permiso una y otra vez dentro del mismo turno, y terminaba en la rama
        // de iteraciones agotadas. La tarjeta que sí llega al navegador es la
        // del token que sobrevivió, no la del cambio que la persona leyó
        // primero.
        //
        // La frase la compone el servidor a partir del preview, por la misma
        // razón que la salida sin tool_calls: con una escritura pendiente no se
        // le confía al modelo la redacción de lo que pasó.
        if (pendingConfirmation) {
          this.eventEmitter.emit('ai.agent.completed', {
            iterations: iteration,
            tools_used: toolsUsed.length,
            total_tokens: totalTokens,
            store_id: context?.store_id,
          });

          const narration = this.describePendingWrite(pendingConfirmation);
          yield { type: 'text', content: narration };
          yield {
            type: 'done',
            usage: {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens,
            },
          };

          return {
            content: narration,
            iterations: iteration,
            tools_used: toolsUsed,
            total_tokens: totalTokens,
            success: true,
            pending_confirmation: pendingConfirmation,
          };
        }
      }

      // Budget exhausted with recorded proposals: the plan frame goes out BEFORE
      // any plan_continue or closing text — ending without it would silently
      // drop every proposal of the turn.
      if (isVex && vexProposals.length > 0) {
        return yield* this.finalizeVexPlan({
          proposals: vexProposals,
          params,
          totalTokens,
          iteration,
          toolsUsed,
        });
      }

      // Budget exhausted (iterations or clock) with the plan still open: do not
      // close with a summary the person did not ask for. Signal the client to
      // fire another turn; the persisted plan carries the state over.
      if (params.plan && (await params.plan.snapshot())) {
        this.eventEmitter.emit('ai.agent.completed', {
          iterations: iteration,
          tools_used: toolsUsed.length,
          total_tokens: totalTokens,
          store_id: context?.store_id,
        });
        yield { type: 'plan_continue' };
        yield {
          type: 'done',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens },
        };
        return {
          content: '',
          iterations: iteration,
          tools_used: toolsUsed,
          total_tokens: totalTokens,
          success: true,
          plan_continue: true,
        };
      }

      if (timedOut) {
        this.logger.warn(`Agent timed out after ${iteration} iterations`);
      }

      // Iterations exhausted (or timed out).
      //
      // This used to throw AI_AGENT_001, which surfaced to the person as a raw
      // error at the exact moment Vexi had worked hardest — ten rounds of
      // searching and nothing to show for it but red text. And the model was
      // in the best possible position to close: it had every tool result from
      // the whole loop in `messages`.
      //
      // So instead of abandoning, it gets one last turn with the tools taken
      // away. With no tool to call it can only answer in words, which is
      // exactly the pessimistic-but-human close the situation calls for.
      // Failing THAT, the fallback below is still a sentence, never an error.
      messages.push({
        role: 'user',
        content:
          'Ya no puedes usar más herramientas en este turno. Responde ahora con lo que hayas averiguado: si encontraste algo, dilo; si no, dile con naturalidad que no diste con lo que buscaba y qué le sugieres hacer. No menciones herramientas, rutas, reintentos ni límites internos.',
      });

      let closing = '';
      try {
        const lastCall = params.app_key
          ? await this.aiEngine.run(
              params.app_key,
              params.variables,
              messages,
              {},
            )
          : params.config_id
            ? await this.aiEngine.chatWith(params.config_id, messages, {})
            : await this.aiEngine.chat(messages, {});

        totalTokens += lastCall?.usage?.totalTokens ?? 0;
        closing = (lastCall?.content ?? '').trim();
      } catch (closingError: any) {
        this.logger.warn(
          `Agent closing turn failed: ${closingError?.message ?? 'unknown'}`,
        );
      }

      const content =
        closing ||
        'Estuve buscando por varios lados y no logré dar con lo que necesitas. ¿Me lo describes de otra forma o me das algún dato más para intentarlo de nuevo?';

      yield { type: 'text', content };

      return {
        content,
        iterations: iteration,
        tools_used: toolsUsed,
        total_tokens: totalTokens,
        success: true,
        pending_confirmation: pendingConfirmation,
      };
    } catch (error: any) {
      if (error instanceof VendixHttpException) throw error;

      this.logger.error(`Agent failed: ${error.message}`);
      yield { type: 'error', error: error.message };
      return {
        content: '',
        iterations: iteration,
        tools_used: toolsUsed,
        total_tokens: totalTokens,
        success: false,
        error: error.message,
      };
    } finally {
      // R3-A: tokens (input + output) of the whole turn, whichever way it
      // ended, into the monthly counter. Never throws.
      if (isVex) {
        await this.consumeVexTurnTokens(context?.store_id, totalTokens);
      }
    }
  }
}
