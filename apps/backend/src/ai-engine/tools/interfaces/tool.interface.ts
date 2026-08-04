import { AIToolDefinition } from '../../interfaces/ai-provider.interface';

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
  requiredPermissions?: string[];
  requiresConfirmation?: boolean;
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
