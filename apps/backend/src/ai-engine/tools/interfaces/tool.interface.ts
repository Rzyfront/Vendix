import type { DiscrepancySignal } from '../discrepancy-signal';

/**
 * Versión de contrato que el registry asigna a todo tool que no declare una.
 * T2: las 70 tools existentes nacen en `'1'` sin cambio de comportamiento; todo
 * breaking futuro viaja como una versión nueva con alias durante el sunset.
 */
export const DEFAULT_TOOL_VERSION = '1';

/** D0 is opt-in; executeTool/string handlers and MCP keep their legacy ABI. */

export type ToolExecutionStatus =
  | 'ok'
  | 'recoverable_error'
  | 'blocked'
  | 'pending_confirmation'
  | 'needs_user_input'
  | 'unknown_effect';

export interface ToolExecutionReceipt {
  schema_version: '1';
  status: ToolExecutionStatus;
  error_code: string | null;
  retryable: boolean;
  next_action: string | null;
  evidence_refs: string[];
  resource_ids: Record<string, string | number>;
  pagination: {
    next_cursor?: string | number | null;
    has_more?: boolean;
    complete: boolean;
  } | null;
  freshness: 'observed' | 'unknown' | 'truncated';
  /**
   * Transport compaction (>6000 chars): the full payload was persisted and the
   * model received a bounded summary plus a reference. It is NOT a partial
   * read: freshness stays `observed` and no recovery is triggered.
   */
  compacted?: boolean;
  effect_status:
    | 'not_applicable'
    | 'unverified'
    | 'not_applied'
    | 'pending'
    | 'applied'
    | 'unknown';
}

/** ok means a tool answered, NEVER that the business objective was verified. */
export type ToolExecutionResult<T = unknown> = ToolExecutionReceipt & {
  data: T;
};

export interface AgentExecutionSummary {
  schema_version: '1';
  error_code?: string;
  outcome:
    | 'completed_verified'
    | 'partial'
    | 'blocked'
    | 'pending_confirmation'
    | 'needs_user_input'
    | 'unknown_effect'
    | 'failed'
    | 'cancelled';
  next_action: string;
  evidence_refs: string[];
  resource_ids: Record<string, string | number>;
}

export interface ToolExecutionContext {
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  roles?: string[];
  /**
   * Conversation of the agent turn running the tool, from
   * `ToolExecutionOptions.conversationId` (the server's turn binding). Never
   * a tool argument; absent outside a turn (MCP, scripts).
   */
  conversation_id?: number;
  /** Cooperative cancellation only; never an authority or rollback guarantee. */
  signal?: AbortSignal;
  deadlineMs?: number;
}

export interface RegisteredTool {
  name: string;
  domain: string;
  description: string;
  parameters: Record<string, any>;
  /**
   * Versión del contrato (parámetros + forma de salida). Opcional en la
   * declaración porque el registry la defaultea a `DEFAULT_TOOL_VERSION`;
   * los factories la escriben explícita para que el catálogo MCP y el
   * envelope la porten sin depender del default.
   */
  version?: string;
  /** Release-owned discovery data only. Never fill this from customer prompts. */
  discovery?: {
    synonyms?: string[];
    examples?: Array<{ intent: string; arguments: Record<string, unknown> }>;
    dependencies?: string[];
    /** Pure validation for synthetic examples: no DB, credentials or side effects. */
    preflight?: (args: Record<string, unknown>) => boolean;
  };
  /**
   * Marca el tool como deprecado. T2 solo declara el campo; el warning en el
   * stream, el marcado en el catálogo MCP y el alias post-remoción los
   * implanta T5.
   */
  deprecated?: ToolDeprecation;
  /**
   * T13 (N4) — the user's role is the only limit on a tool; the plan never
   * removes one. Every tool declares exactly one of:
   *  - `requiredPermissions`: every listed permission must be held, or
   *  - `access: 'public'` + `accessReason`: no role can be denied it. Only for
   *    agent scaffolding (planning, discovery, blocks) and data already scoped
   *    to the caller (own reminders, own attachments); never for business data.
   * `AIToolRegistry.register` throws on a tool that declares neither, so the
   * backend does not boot with an open tool.
   */
  requiredPermissions?: string[];
  access?: 'public';
  /** Written reason a public tool needs no permission. Required with `access`. */
  accessReason?: string;
  requiresConfirmation?: boolean;
  /**
   * Marks a write whose effect cannot be walked back (DIAN issuance/voids,
   * payments/refunds, payroll settlement, fiscal/cash/period closings,
   * voids, deletes/archives).
   *
   * Read by whole-plan approval: an irreversible step always asks for its own
   * confirmation card even inside an approved plan. Opt-in and fail-open on
   * purpose — the plan service ALSO matches the tool's domain and, for
   * `write_endpoint`, the path segments, so a tool that forgets the flag is
   * still caught by its domain.
   */
  irreversible?: boolean;
  /**
   * F5 (T36) — honest inverse of this write, used ONLY by Vex write batches to
   * offer "Deshacer". Declare it only when the inverse restores the previous
   * state without losing data (restore the previous value, archive what was
   * just created). Never on an `irreversible` tool. A tool without it is
   * reported as "no reversible desde Vex".
   */
  compensate?: ToolCompensation;
  /**
   * Where a confirmed write lands. Default (absent): IN PROCESS — the handler
   * awaits a domain service, so returning a structured result without a
   * protocol failure is definitive evidence that the change was applied and the
   * registry stamps `applied: true` on it. `'http'` marks a transport boundary
   * (the generic `write_endpoint` bridge) where an HTTP 200 or `success` proves
   * nothing: that handler must report `applied` itself.
   */
  effectTransport?: 'http';
  /**
   * Marks the tool as free of side effects. Surfaces that cannot show a
   * confirmation step before executing — realtime voice, where the model acts
   * on a transcription the user never reviews — expose ONLY tools with this
   * set to `true`. The flag is opt-in and fail-closed on purpose: a new tool
   * that forgets it is excluded from those surfaces rather than silently
   * reachable.
   */
  readOnly?: boolean;
  /** Audited, release-owned opt-in. readOnly alone is NEVER sufficient. */
  scheduling?: {
    parallelSafe: true;
    idempotent_read: true;
    resource_keys: string[];
    depends_on?: string[];
    max_result_bytes: number;
    heavy?: boolean;
  };
  /**
   * Marks a tool that acts on the user interface rather than on data:
   * navigating, explaining a module, driving the POS.
   *
   * There is no router and no cart in this process, so the server cannot run
   * it — `executeTool()` rejects it outright. The declaration exists so the
   * tool still reaches the model's catalog (including the voice surface,
   * where "llévame a inventario" is the natural case) and so the browser has
   * a schema to dispatch against.
   *
   * A tool is never `clientSide` and data-mutating at once. If it writes to
   * the database it goes through the confirmation circuit instead.
   */
  clientSide?: boolean;
  /**
   * Computes what `handler` *would* change, without changing it.
   *
   * Run by the registry when a `requiresConfirmation` tool is invoked without
   * a token: the resulting diff is what the user approves. It is a projection,
   * not a dry-run transaction — by the time the apply runs the world may have
   * moved, so `handler` must re-verify its own preconditions rather than trust
   * this. Same doctrine as `products-bulk-edit.service.ts`.
   */
  preview?: (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ) => Promise<ToolPreview>;
  /**
   * Absent for `clientSide` tools: they are dispatched in the browser, so
   * there is nothing for the server to call.
   */
  handler?: (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ) => Promise<string>;
}

/**
 * Shape of a proposed change, mirroring `BulkEditPreviewItemDto` so the
 * frontend confirmation card can render agent proposals and bulk-edit
 * previews with one component.
 */
/**
 * F5 (T36) — inverse operation a write tool declares so a Vex write batch can
 * undo it. Contract:
 *  - `capture` runs right BEFORE the handler, with the same args and context,
 *    and returns the state needed to undo (e.g. the previous price). Returning
 *    `null` means "nothing to undo for these args": the step is then reported
 *    as not reversible. It must not write.
 *  - `undo` runs later (only inside the batch's undo window) with that
 *    snapshot plus the handler's output, re-verifies its own preconditions
 *    (the record may have changed since) and returns a human one-liner. It
 *    throws when the inverse is no longer honest (e.g. the value was edited
 *    again after the batch): the step then stays applied.
 *  - `undo` runs through the same permission gate as the tool itself.
 */
export interface ToolCompensation {
  /** Human label of the inverse: "Restaurar el precio anterior". */
  label: string;
  capture: (
    args: Record<string, any>,
    context: ToolExecutionContext,
  ) => Promise<unknown | null>;
  undo: (input: {
    args: Record<string, any>;
    snapshot: unknown;
    handlerOutput: string;
    context: ToolExecutionContext;
  }) => Promise<string>;
}

export interface ToolPreview {
  status: 'ok' | 'warning' | 'error';
  /** Human-readable subject of the change: "Coca Cola 1L", not "#4821". */
  target: string;
  changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
  /** Why this cannot proceed, or what the user should watch out for. */
  message?: string;
  /**
   * Data domain this write touches, so the browser knows which module to
   * refresh once it is applied.
   */
  domain?: string;
  /**
   * Pre-verificación guiada: el valor real difiere del esperado por encima de
   * la tolerancia. Solo viaja en previews `error`; el modelo guía a la persona
   * antes de reintentar con `discrepancy_reviewed=true`.
   */
  discrepancy?: DiscrepancySignal;
}

export interface ToolRegistrationFn {
  (registry: any, prisma: any): void;
}

/**
 * Ventana de deprecación de un tool. `since` es la versión que lo marcó,
 * `sunset` la versión en que el nombre viejo deja de resolver (el alias
 * sobrevive a la remoción del handler porque turnos persistidos en
 * `ai_messages.tool_calls` referencian nombres viejos) y `replacedBy` el
 * nombre al que `registerAlias` redirige durante la ventana.
 */
export interface ToolDeprecation {
  since: string;
  sunset?: string;
  replacedBy?: string;
}

/**
 * Envelope versionado de salida de un tool (T2).
 *
 * `{tool, version, data}` en éxito, `{tool, version, error, next_step}` en
 * fallo recuperable — la misma doctrina `{error, next_step}` en español de
 * los handlers, con el nombre y la versión del contrato que la produjo.
 * `executeTool()` sigue devolviendo el string del handler intacto; el
 * envelope es el contrato que las tools nuevas construyen con los builders
 * de abajo, no un re-wrap del choke point.
 */
export interface ToolSuccessEnvelope<T = unknown> {
  tool: string;
  version: string;
  data: T;
}

export interface ToolErrorEnvelope {
  tool: string;
  version: string;
  error: string;
  next_step: string;
}

export type ToolOutputEnvelope<T = unknown> =
  | ToolSuccessEnvelope<T>
  | ToolErrorEnvelope;

export function buildToolSuccessEnvelope<T>(
  tool: string,
  data: T,
  version: string = DEFAULT_TOOL_VERSION,
): ToolSuccessEnvelope<T> {
  return { tool, version, data };
}

export function buildToolErrorEnvelope(
  tool: string,
  error: string,
  nextStep: string,
  version: string = DEFAULT_TOOL_VERSION,
): ToolErrorEnvelope {
  return { tool, version, error, next_step: nextStep };
}
