import { AIToolDefinition } from '../../interfaces/ai-provider.interface';

/**
 * Versión de contrato que el registry asigna a todo tool que no declare una.
 * T2: las 70 tools existentes nacen en `'1'` sin cambio de comportamiento; todo
 * breaking futuro viaja como una versión nueva con alias durante el sunset.
 */
export const DEFAULT_TOOL_VERSION = '1';

export interface ToolExecutionContext {
  organization_id?: number;
  store_id?: number;
  user_id?: number;
  roles?: string[];
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
  /**
   * Marca el tool como deprecado. T2 solo declara el campo; el warning en el
   * stream, el marcado en el catálogo MCP y el alias post-remoción los
   * implanta T5.
   */
  deprecated?: ToolDeprecation;
  requiredPermissions?: string[];
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
   * Marks the tool as free of side effects. Surfaces that cannot show a
   * confirmation step before executing — realtime voice, where the model acts
   * on a transcription the user never reviews — expose ONLY tools with this
   * set to `true`. The flag is opt-in and fail-closed on purpose: a new tool
   * that forgets it is excluded from those surfaces rather than silently
   * reachable.
   */
  readOnly?: boolean;
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
