import type { AuditService } from '../../../common/audit/audit.service';
import type { CustomersService } from '../../../domains/store/customers/customers.service';
import { fullName } from '../_adapters/customer.adapter';
import type {
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import {
  cleanString,
  describeError,
  toPositiveInt,
  toValidatedDto,
} from './tool-write-helpers';

/**
 * Shared plumbing of the CRM tool family (QUI-1042): customers, tags,
 * segments, pipeline, tasks, notes and campaigns for Vex and Vexi.
 *
 * ## Doctrine (same as `writes.tools.ts`)
 *
 * - Every tool calls the CRM service that owns the rule (`CustomerCrmService`,
 *   `CrmTagsService`, `CrmSegmentsService`, `CrmPipelineService`, ...). No SQL,
 *   no copy of a business rule: the service keeps the store scope
 *   (`StorePrismaService`) and the seller visibility (`crm-access.ts`).
 * - `requiredPermissions` mirror the `@Permissions` of the controller that
 *   exposes the same service method. A tool calls the service directly, so the
 *   controller guard never runs: the registry filter is the only gate.
 * - Writes are `requiresConfirmation` with a `preview` that names the human
 *   subject. The `handler` re-reads its preconditions; the preview is a
 *   projection, never a dry-run.
 * - Handlers never throw: they return `{ error, next_step }` in Spanish.
 * - Destructive or bulk writes whose service writes no `audit_logs` row call
 *   `auditCrmAgentWrite` once after applying.
 */

export { cleanString, describeError, toPositiveInt, toValidatedDto };

/** Every CRM tool lives in the customers module of the browser. */
export const CRM_TOOL_DOMAIN = 'customers';

/** Permission strings copied from the CRM controllers' `@Permissions`. */
export const CRM_PERMISSIONS = {
  CUSTOMERS_READ: 'store:customers:read',
  CUSTOMERS_UPDATE: 'store:customers:update',
  CUSTOMERS_DELETE: 'store:customers:delete',
  SEGMENTS_MANAGE: 'store:crm_segments:manage',
  PIPELINE_READ: 'store:crm_pipeline:read',
  PIPELINE_MANAGE: 'store:crm_pipeline:manage',
  TASKS_MANAGE: 'store:crm_tasks:manage',
  CAMPAIGNS_SEND: 'store:crm_campaigns:send',
} as const;

/** Max customers one bulk write touches. Larger batches split in turns. */
export const CRM_BULK_CUSTOMER_CAP = 200;

/** Max per-customer rows in a bulk preview card; the rest is summarized. */
export const CRM_PREVIEW_ROW_CAP = 25;

/** Handler failure the model can read and explain. Never thrown. */
export function crmToolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep && { next_step: nextStep }),
  });
}

/** Handler failure built from a domain exception (keeps its error code). */
export function crmToolFailure(
  action: string,
  error: unknown,
  nextStep?: string,
): string {
  const { code, message } = describeError(error);
  return crmToolError(
    `No se pudo ${action}${code ? ` (${code})` : ''}: ${message}`,
    nextStep,
  );
}

/** Preview error: the registry aborts without minting a token. */
export function crmPreviewError(target: string, message: string): ToolPreview {
  return {
    status: 'error',
    target,
    changes: [],
    message,
    domain: CRM_TOOL_DOMAIN,
  };
}

/** Successful handler payload with the shape the other write tools use. */
export function crmToolSuccess(
  summary: string,
  data: Record<string, unknown>,
  nextStep?: string,
): string {
  return JSON.stringify({
    summary,
    data,
    ...(nextStep && { next_step: nextStep }),
  });
}

/** Store id or a readable refusal: CRM data always lives inside one store. */
export function requireStoreId(
  context: ToolExecutionContext,
): { ok: true; storeId: number } | { ok: false; message: string } {
  if (!context.store_id) {
    return {
      ok: false,
      message:
        'Sin tienda en contexto: los clientes y el CRM se gestionan siempre dentro de una tienda.',
    };
  }
  return { ok: true, storeId: context.store_id };
}

/**
 * Parses a list of positive integer ids (deduplicated, order kept). Accepts
 * an array or a single value. Fails above `cap` instead of silently cutting.
 */
export function parseIdList(
  raw: unknown,
  cap: number,
  label = 'clientes',
): { ok: true; ids: number[] } | { ok: false; message: string } {
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const id = toPositiveInt(value);
    if (!id) {
      return {
        ok: false,
        message: `"${String(value)}" no es un id válido de ${label}.`,
      };
    }
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  if (ids.length > cap) {
    return {
      ok: false,
      message: `Son ${ids.length} ${label} y el máximo por operación es ${cap}. Divide la acción en tandas de ${cap}.`,
    };
  }
  return { ok: true, ids };
}

/**
 * Human names of store customers by id. Ids that are not customers of THIS
 * store come back in `missing`: a bulk tool must refuse them instead of
 * touching another tenant's row.
 */
export async function resolveCustomerLabels(
  customersService: CustomersService,
  storeId: number,
  ids: number[],
): Promise<{ labels: Map<number, string>; missing: number[] }> {
  const labels = new Map<number, string>();
  if (!ids.length) return { labels, missing: [] };
  const rows = await customersService.findCustomerNamesForAgent(storeId, ids);
  for (const row of rows ?? []) {
    labels.set(
      Number(row.id),
      fullName({
        first_name: row.first_name ?? undefined,
        last_name: row.last_name ?? undefined,
      }) || `Cliente ${row.id}`,
    );
  }
  const missing = ids.filter((id) => !labels.has(id));
  return { labels, missing };
}

/**
 * Caps the per-customer rows of a bulk preview. The summary row the caller
 * puts first is kept; the message says how many rows were left out so the
 * card never pretends the batch is smaller than it is.
 */
export function capPreviewRows(
  rows: ToolPreview['changes'],
  cap = CRM_PREVIEW_ROW_CAP,
): { changes: ToolPreview['changes']; hiddenCount: number } {
  if (rows.length <= cap) return { changes: rows, hiddenCount: 0 };
  return { changes: rows.slice(0, cap), hiddenCount: rows.length - cap };
}

export interface CrmAgentAuditEntry {
  tool: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'BULK_UPDATE';
  resource: string;
  resourceId?: number;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * One `audit_logs` row for a destructive or bulk agent write whose service
 * does not audit. Best effort by design: the write already happened, and
 * `AuditService.log` swallows its own failures; this wrapper also never
 * throws so an audit hiccup cannot turn an applied write into an error.
 */
export async function auditCrmAgentWrite(
  audit: AuditService,
  context: ToolExecutionContext,
  entry: CrmAgentAuditEntry,
): Promise<void> {
  try {
    await audit.log({
      userId: context.user_id,
      storeId: context.store_id,
      organizationId: context.organization_id,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      oldValues: entry.oldValues,
      newValues: entry.newValues,
      metadata: {
        ...(entry.metadata ?? {}),
        source: 'ai_agent',
        tool: entry.tool,
      },
    });
  } catch {
    // Never let the audit trail break an applied write.
  }
}
