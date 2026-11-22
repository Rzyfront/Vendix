import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import {
  AIToolRegistry,
  toolPreviewHash,
} from '../../../../ai-engine/tools/ai-tool-registry';
import type { RegisteredTool } from '../../../../ai-engine/tools/interfaces/tool.interface';
import { PlanApprovalService } from './plan-approval.service';
import { VexBlockService, type VexUiBlockView } from './vex-block.service';
import {
  WRITE_BATCH_MAX_RECORDS,
  WRITE_BATCH_MAX_STEPS,
  WRITE_BATCH_STALE_EXECUTING_MS,
  WRITE_BATCH_TTL_MS,
  WRITE_BATCH_UNDO_WINDOW_MS,
} from './write-batch.types';
import type {
  WriteBatchStatus,
  WriteBatchStepInput,
  WriteBatchStepPreview,
  WriteBatchStepRecord,
  WriteBatchSummary,
  WriteBatchView,
} from './write-batch.types';

/** Name of the proposing tool itself: it can never be a step of a batch. */
export const PROPOSE_WRITE_BATCH_TOOL = 'propose_write_batch';

/** Result of `propose`: one entry per part (more than 25 steps → several parts). */
export interface WriteBatchProposal {
  group_id: string | null;
  batches: Array<{
    batch_id: string;
    part_index: number;
    part_total: number;
    step_count: number;
    block_id?: string;
    /** Panel-ready view of the part's `write_batch` block (stream frame). */
    block?: VexUiBlockView;
  }>;
}

/**
 * Raised (as a value, not thrown) when a batch cannot be proposed: a step the
 * role cannot run, an irreversible step, a read-only tool, an invalid preview
 * or a limit breach. `explanation` is the human line Vex repeats verbatim.
 */
export interface WriteBatchRefusal {
  refused: true;
  reason:
    | 'empty'
    | 'unknown_tool'
    | 'not_a_write'
    | 'irreversible'
    | 'permission_denied'
    | 'invalid_arguments'
    | 'preview_error'
    | 'too_many_records'
    | 'no_conversation';
  /** 1-based order of the offending step, when one step caused it. */
  step_order?: number;
  explanation: string;
}

/** Row of `ai_agent_write_batches` as the services read it. */
export interface WriteBatchRow {
  id: string;
  store_id: number;
  organization_id: number;
  user_id: number;
  conversation_id: number | null;
  goal: string;
  status: WriteBatchStatus;
  steps: WriteBatchStepRecord[];
  step_count: number;
  affected_records: number;
  part_index: number;
  part_total: number;
  group_id: string | null;
  version: number;
  approved_by_user_id: number | null;
  approved_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  summary: WriteBatchSummary | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Structural view of the `ai_agent_write_batches` delegate (registered in
 * `StorePrismaService`). Every query below filters by `store_id` explicitly
 * on top of the extension's own scoping, so a cross-store id is a 404.
 */
interface AiAgentWriteBatchesDelegate {
  createMany(args: any): Promise<{ count: number }>;
  findFirst(args: any): Promise<WriteBatchRow | null>;
  updateMany(args: any): Promise<{ count: number }>;
}

/**
 * Same function as `plan-approval.service.ts` (`canonicalJson`): object keys
 * sorted at every depth, arrays kept in order. Duplicated because that module
 * keeps it private and `args_hash` must be comparable with the plan hashes.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

/** sha256 of canonical JSON of `{tool, arguments}`. */
export function writeBatchArgsHash(
  tool: string,
  args: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(canonicalJson({ tool, arguments: args }))
    .digest('hex');
}

/**
 * Heuristic: how many records a step reaches. A write tool that acts on many
 * records takes them as an id array (`product_ids`, `ids`, ...), so the step
 * reaches the length of the LARGEST such array; anything else touches one.
 * It is a ceiling check for D1 (500 records per batch), not an audit: a tool
 * that batches by another shape counts as 1 and is bounded by the 25 steps.
 */
export function estimateAffectedRecords(args: Record<string, unknown>): number {
  let largest = 0;
  for (const [key, value] of Object.entries(args ?? {})) {
    if ((key === 'ids' || key.endsWith('_ids')) && Array.isArray(value)) {
      largest = Math.max(largest, value.length);
    }
  }
  return Math.max(1, largest);
}

/** Spanish area names for the permission segment the role is missing. */
const AREA_LABELS: Record<string, string> = {
  products: 'productos',
  orders: 'órdenes',
  customers: 'clientes',
  inventory: 'inventario',
  pricing: 'precios',
  promotions: 'promociones',
  suppliers: 'proveedores',
  purchase_orders: 'compras',
  accounting: 'contabilidad',
  payments: 'pagos',
  expenses: 'gastos',
  settings: 'configuración',
  users: 'usuarios',
  invoicing: 'facturación',
  dispatch: 'despachos',
  categories: 'categorías',
  brands: 'marcas',
  reports: 'reportes',
};

/** `store:products:update` → "productos". Falls back to the raw segment. */
function areaOfPermission(permission: string): string {
  const parts = permission.split(':');
  const segment = parts.length >= 2 ? parts[1] : permission;
  return AREA_LABELS[segment] ?? segment.replace(/_/g, ' ');
}

const fmtStep = (order: number, label: string) => `paso ${order}: ${label}`;

/**
 * T34 — proposes and reads Vex write batches. Signatures of `propose`,
 * `loadOwned` and `getView` are the shared contract with the executor (T35)
 * and the compensation service (T36).
 *
 * Nothing here executes a write: a batch is only a persisted proposal whose
 * every step already passed the T13 role gate and the tool's own `preview()`.
 */
@Injectable()
export class WriteBatchService {
  private readonly logger = new Logger(WriteBatchService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly registry: AIToolRegistry,
    private readonly planApproval: PlanApprovalService,
    private readonly blocks: VexBlockService,
  ) {}

  private get batches(): AiAgentWriteBatchesDelegate {
    return this.prisma
      .ai_agent_write_batches as unknown as AiAgentWriteBatchesDelegate;
  }

  async propose(input: {
    conversationId: number | null;
    goal: string;
    steps: WriteBatchStepInput[];
  }): Promise<WriteBatchProposal | WriteBatchRefusal> {
    const context = RequestContextService.asyncLocalStorage.getStore();
    const storeId = context?.store_id;
    const organizationId = context?.organization_id;
    const userId = context?.user_id;
    // Fail-closed: without a full tenant/user context nothing is proposed.
    if (!storeId || !organizationId || !userId) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }

    // The conversation anchors the card, the receipts and the durable
    // objective: it must be this user's, in this store. The agent always
    // passes the turn's id (`withTurnConversation`); this also covers any
    // other caller. 404-style refusal: a foreign id is not confirmed to exist.
    const conversationId = input.conversationId;
    const ownConversation =
      typeof conversationId === 'number' &&
      Number.isInteger(conversationId) &&
      conversationId > 0
        ? await this.prisma.ai_conversations.findFirst({
            where: { id: conversationId, user_id: userId, store_id: storeId },
            select: { id: true },
          })
        : null;
    if (!ownConversation) {
      return {
        refused: true,
        reason: 'no_conversation',
        explanation:
          'No encontré la conversación de Vex donde mostrar la tarjeta. No propuse el lote; vuelve a pedirlo desde Vex.',
      };
    }

    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      return {
        refused: true,
        reason: 'empty',
        explanation:
          'No hay ningún cambio que proponer: el lote necesita al menos un paso.',
      };
    }

    // 1. Validate EVERY step before persisting anything.
    const granted = context.permissions?.length
      ? context.permissions
      : (context.roles ?? []);
    const prepared: WriteBatchStepRecord[] = [];
    for (let index = 0; index < input.steps.length; index++) {
      const step = input.steps[index];
      const refusal = await this.prepareStep(step, index + 1, granted);
      if ('refused' in refusal) return refusal;
      prepared.push(refusal.record);
    }

    const totalRecords = prepared.reduce((n, s) => n + s.affected_records, 0);
    if (totalRecords > WRITE_BATCH_MAX_RECORDS) {
      return {
        refused: true,
        reason: 'too_many_records',
        explanation: `Este lote alcanzaría ${totalRecords} registros y el máximo por lote es ${WRITE_BATCH_MAX_RECORDS}. No propuse el lote; divídelo en partes más pequeñas.`,
      };
    }

    // 2. Split into parts of at most WRITE_BATCH_MAX_STEPS steps.
    const parts: WriteBatchStepRecord[][] = [];
    for (let i = 0; i < prepared.length; i += WRITE_BATCH_MAX_STEPS) {
      parts.push(prepared.slice(i, i + WRITE_BATCH_MAX_STEPS));
    }
    const groupId = parts.length > 1 ? randomUUID() : null;
    const expiresAt = new Date(Date.now() + WRITE_BATCH_TTL_MS);
    const goal = String(input.goal ?? '')
      .trim()
      .slice(0, 500);

    const rows = parts.map((partSteps, i) => {
      const id = randomUUID();
      const steps = partSteps.map((step, j) => ({
        ...step,
        order: j + 1,
        operation_id: undefined,
      }));
      return {
        id,
        store_id: storeId,
        organization_id: organizationId,
        user_id: userId,
        conversation_id: ownConversation.id,
        goal,
        status: 'proposed' as const,
        steps: steps.map(({ operation_id: _omit, ...rest }) => rest),
        step_count: steps.length,
        affected_records: steps.reduce((n, s) => n + s.affected_records, 0),
        part_index: i + 1,
        part_total: parts.length,
        group_id: groupId,
        expires_at: expiresAt,
      };
    });

    // One statement: every part exists or none does.
    await this.batches.createMany({ data: rows });

    // 3. One block per part so the card survives a reload.
    const result: WriteBatchProposal['batches'] = [];
    for (const row of rows) {
      let blockId: string | undefined;
      let blockView: VexUiBlockView | undefined;
      try {
        const block = await this.blocks.create({
          conversation_id: ownConversation.id,
          kind: 'write_batch',
          data: {
            batch_id: row.id,
            goal: row.goal,
            part_index: row.part_index,
            part_total: row.part_total,
            step_count: row.step_count,
          },
        });
        blockId = block.id;
        blockView = await this.blocks.toUiBlock(block);
      } catch (error) {
        // The batch is valid and approvable by id; only the reload-proof
        // card is missing. Never fail the proposal for it.
        this.logger.warn(
          `write_batch block not created for batch ${row.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
      result.push({
        batch_id: row.id,
        part_index: row.part_index,
        part_total: row.part_total,
        step_count: row.step_count,
        ...(blockId ? { block_id: blockId } : {}),
        ...(blockView ? { block: blockView } : {}),
      });
    }
    return { group_id: groupId, batches: result };
  }

  /**
   * Gates one step. Order: tool exists → is a write → is reversible → role
   * (T13) → arguments + real `preview()` through `previewForConsent`.
   */
  private async prepareStep(
    step: WriteBatchStepInput,
    order: number,
    granted: string[],
  ): Promise<{ record: WriteBatchStepRecord } | WriteBatchRefusal> {
    const label = String(step?.label ?? step?.tool ?? '').trim();
    const where = fmtStep(order, label);
    const refuse = (
      reason: WriteBatchRefusal['reason'],
      explanation: string,
    ): WriteBatchRefusal => ({
      refused: true,
      reason,
      step_order: order,
      explanation,
    });

    const toolName = this.registry.canonicalName(String(step?.tool ?? ''));
    const tool: RegisteredTool | undefined = this.registry.get(toolName);
    if (!tool) {
      return refuse(
        'unknown_tool',
        `La herramienta "${step?.tool}" no existe (${where}). No propuse el lote.`,
      );
    }
    const args =
      step.arguments &&
      typeof step.arguments === 'object' &&
      !Array.isArray(step.arguments)
        ? step.arguments
        : {};

    if (
      toolName === PROPOSE_WRITE_BATCH_TOOL ||
      tool.requiresConfirmation !== true ||
      !tool.preview ||
      tool.clientSide === true ||
      tool.readOnly === true
    ) {
      return refuse(
        'not_a_write',
        `"${label}" no es un cambio que se pueda aprobar en lote (${where}). No propuse el lote.`,
      );
    }

    if (
      this.registry.isIrreversible(toolName) ||
      tool.irreversible === true ||
      this.planApproval.classifySteps([{ order, tool: toolName, args }])
        .reconfirm.length > 0
    ) {
      return refuse(
        'irreversible',
        `"${label}" no se puede deshacer, así que va sola con su propia tarjeta de confirmación (${where}). No la incluí en el lote.`,
      );
    }

    // Role gate, classified here only to name the area; the gate itself is
    // `previewForConsent` below (it re-checks the same permissions).
    const missing =
      tool.access === 'public'
        ? []
        : (tool.requiredPermissions ?? []).filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      return refuse(
        'permission_denied',
        `Tu rol no permite ${areaOfPermission(missing[0])} (${where}). No propuse el lote; pídeselo al dueño.`,
      );
    }

    let consent: Awaited<ReturnType<AIToolRegistry['previewForConsent']>>;
    try {
      consent = await this.registry.previewForConsent(toolName, args);
    } catch (error) {
      if (error instanceof VendixHttpException) {
        const message = String(
          (error.getResponse() as { message?: unknown })?.message ?? '',
        );
        if (error.errorCode === ErrorCodes.AI_AGENT_005.code) {
          return refuse(
            'preview_error',
            `${message || 'No hay una propuesta válida para este cambio.'} (${where}). No propuse el lote.`,
          );
        }
        if (error.errorCode === ErrorCodes.AI_AGENT_004.code) {
          return refuse(
            'invalid_arguments',
            `Los datos de este cambio no son válidos${message ? `: ${message}` : ''} (${where}). No propuse el lote; corrígelo y vuelve a intentar.`,
          );
        }
      }
      throw error;
    }

    const preview: WriteBatchStepPreview = {
      status: consent.preview.status === 'warning' ? 'warning' : 'ok',
      target: consent.preview.target,
      changes: consent.preview.changes,
      ...(consent.preview.message ? { message: consent.preview.message } : {}),
      ...(consent.preview.domain ? { domain: consent.preview.domain } : {}),
    };
    return {
      record: {
        step_id: `s${order}`,
        order,
        tool: toolName,
        arguments: args,
        label,
        ...(step.depends_on?.length ? { depends_on: step.depends_on } : {}),
        args_hash: writeBatchArgsHash(toolName, args),
        preview_hash: toolPreviewHash(consent.preview),
        tool_version: this.registry.getToolVersion(toolName),
        preview,
        affected_records: estimateAffectedRecords(args),
        compensable: !!tool.compensate,
        status: 'pending',
      },
    };
  }

  /** Loads the batch row of the current store; 404 when absent, 403 when another user's. */
  async loadOwned(
    batchId: string,
    userId: number | undefined,
  ): Promise<WriteBatchRow> {
    const context = RequestContextService.asyncLocalStorage.getStore();
    const storeId = context?.store_id;
    if (!storeId) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const row = await this.batches.findFirst({
      where: {
        id: batchId,
        store_id: storeId,
        ...(context.organization_id
          ? { organization_id: context.organization_id }
          : {}),
      },
    });
    if (!row) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Lote no encontrado.',
      );
    }
    // Fail-closed: no user in the context is never "the owner".
    if (userId === undefined || userId === null || row.user_id !== userId) {
      throw new VendixHttpException(
        ErrorCodes.SYS_FORBIDDEN_001,
        'Este lote es de otra persona.',
      );
    }
    return row;
  }

  /** Client-safe view; expires a stale `proposed` batch first. */
  async getView(
    batchId: string,
    userId: number | undefined,
  ): Promise<WriteBatchView> {
    let row = await this.loadOwned(batchId, userId);
    const now = new Date();
    if (row.status === 'proposed' && row.expires_at.getTime() <= now.getTime()) {
      const steps = (row.steps ?? []).map((step) => ({
        ...step,
        status:
          step.status === 'pending' ? ('cancelled' as const) : step.status,
      }));
      // Conditional: a concurrent approval (status already `executing`) wins.
      const { count } = await this.batches.updateMany({
        where: { id: row.id, store_id: row.store_id, status: 'proposed' },
        data: { status: 'expired', steps, updated_at: now },
      });
      row =
        count > 0
          ? { ...row, status: 'expired', steps }
          : await this.loadOwned(batchId, userId);
    }
    if (
      row.status === 'executing' &&
      row.started_at &&
      now.getTime() - new Date(row.started_at).getTime() >
        WRITE_BATCH_STALE_EXECUTING_MS
    ) {
      row = await this.reconcileInterrupted(row, now, userId);
    }
    return toWriteBatchView(row, now);
  }

  /**
   * A run that died with the process (deploy, OOM) leaves the batch
   * `executing`. Nothing is retried: the step that was running may have landed,
   * so it becomes `unknown` (needs review), never-run steps become `skipped`,
   * and the batch `unknown_effect`. Conditional on `version`, so a live
   * executor that is merely slow keeps ownership if it writes first.
   */
  private async reconcileInterrupted(
    row: WriteBatchRow,
    now: Date,
    userId: number | undefined,
  ): Promise<WriteBatchRow> {
    const steps = (row.steps ?? []).map((step) =>
      step.status === 'running'
        ? {
            ...step,
            status: 'unknown' as const,
            error:
              step.error ??
              'No se pudo confirmar si este cambio se aplicó; revísalo antes de reintentar.',
            finished_at: now.toISOString(),
          }
        : step.status === 'pending'
          ? { ...step, status: 'skipped' as const }
          : step,
    );
    const summary = summarizeInterrupted(steps);
    const { count } = await this.batches.updateMany({
      where: {
        id: row.id,
        store_id: row.store_id,
        status: 'executing',
        version: row.version,
      },
      data: {
        status: 'unknown_effect',
        steps,
        summary,
        finished_at: now,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    return count > 0
      ? {
          ...row,
          status: 'unknown_effect',
          steps,
          summary,
          finished_at: now,
          version: row.version + 1,
        }
      : this.loadOwned(row.id, userId);
  }
}

/** D2 sentence for a run interrupted mid-way (see `reconcileInterrupted`). */
function summarizeInterrupted(
  steps: WriteBatchStepRecord[],
): WriteBatchSummary {
  const count = (status: WriteBatchStepRecord['status']) =>
    steps.filter((s) => s.status === status).length;
  const applied = steps.filter((s) => s.status === 'applied');
  const unknownStep = steps.find((s) => s.status === 'unknown');
  const appliedThrough = applied.reduce((max, s) => Math.max(max, s.order), 0);
  return {
    applied: applied.length,
    failed: count('failed'),
    unknown: count('unknown'),
    skipped: count('skipped'),
    unselected: count('unselected'),
    compensable: applied.filter((s) => s.compensable).length,
    applied_through_order: appliedThrough,
    message: unknownStep
      ? `El paso ${unknownStep.order} quedó sin verificar; revisa antes de reintentar. El resto se omitió.`
      : applied.length > 0
        ? `Se aplicó hasta el paso ${appliedThrough}, el resto se omitió.`
        : 'No se aplicó ningún cambio.',
  };
}

/**
 * Pure projection row → client view. Strips `compensation_snapshot`,
 * `compensation_output`, `args_hash` and `preview_hash`. A step offers undo only when it is applied,
 * its tool is compensable, a snapshot was captured and the window is open.
 */
export function toWriteBatchView(
  row: WriteBatchRow,
  now: Date,
): WriteBatchView {
  const finishedAt = row.finished_at ? new Date(row.finished_at) : null;
  const undoUntil = finishedAt
    ? new Date(finishedAt.getTime() + WRITE_BATCH_UNDO_WINDOW_MS)
    : null;
  const windowOpen = !!undoUntil && now.getTime() < undoUntil.getTime();
  let anyUndo = false;
  const steps = (row.steps ?? []).map((step) => {
    const {
      compensation_snapshot,
      compensation_output: _compensationOutput,
      args_hash: _argsHash,
      preview_hash: _previewHash,
      ...safe
    } = step;
    const canUndo =
      step.status === 'applied' &&
      step.compensable === true &&
      compensation_snapshot !== undefined &&
      compensation_snapshot !== null &&
      windowOpen;
    if (canUndo) anyUndo = true;
    return { ...safe, can_undo: canUndo };
  });
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    goal: row.goal,
    status: row.status,
    part_index: row.part_index,
    part_total: row.part_total,
    group_id: row.group_id,
    step_count: row.step_count,
    affected_records: row.affected_records,
    steps,
    summary: row.summary ?? null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    finished_at: finishedAt ? finishedAt.toISOString() : null,
    expires_at: new Date(row.expires_at).toISOString(),
    undo_until: anyUndo && undoUntil ? undoUntil.toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}
