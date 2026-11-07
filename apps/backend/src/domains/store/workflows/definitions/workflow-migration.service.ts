import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  WorkflowInstanceRow,
  WorkflowTx,
} from '../engine/workflow-engine.types';
import { WorkflowEventsService } from '../engine/workflow-events.service';
import { WorkflowStageService } from '../engine/workflow-stage.service';

/** Live requests moved per call (each in its own transaction). */
export const MIGRATION_BATCH = 500;

export interface MigrationInput {
  from_version_id: number;
  /** Old stage key → stage key of the published version. Missing keys keep their key. */
  stage_map?: Record<string, string>;
}

export interface MigrationPlanStage {
  from_stage_key: string;
  from_stage_name: string;
  count: number;
  to_stage_key: string | null;
  to_stage_name: string | null;
  ok: boolean;
  reason: string | null;
  /** Requests of this stage still waiting for live child requests: they are skipped. */
  waiting_children: number;
}

/** Why a request that waits for its children is not moved. */
export const MIGRATION_WAITING_CHILDREN =
  'Espera solicitudes hijas en curso; ciérralas o cancélalas antes de migrarla.';

/**
 * P2.8: moves the live requests of an older version to the published one with
 * an explicit stage → stage map. Nothing is rewritten in the history: each
 * request gets a `migrated` event, its open tasks are cancelled and the target
 * stage is entered again (new tasks, wait or children), without re-running
 * the `on_enter` hooks. Every request moves in its own transaction with a CAS
 * on `row_version`, so a request that changes meanwhile is reported, not
 * overwritten.
 */
@Injectable()
export class WorkflowMigrationService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    return { store_id: c.store_id, user_id: c.user_id ?? null };
  }

  async preview(definitionId: number, input: MigrationInput) {
    const { store_id } = this.ctx();
    const { from, to, target } = await this.versions(store_id, definitionId, input);
    const source = from.definition as WorkflowDefinitionV1;
    const groups: Array<{ current_stage_key: string; _count: { _all: number } }> =
      await this.prisma.workflow_instances.groupBy({
        by: ['current_stage_key'],
        where: {
          store_id,
          definition_id: definitionId,
          version_id: from.id,
          status: 'active',
        },
        _count: { _all: true },
      });
    const waiting = await this.waitingParents(store_id, definitionId, from.id);
    const stages: MigrationPlanStage[] = groups.map((g) => ({
      ...this.planStage(source, target, g.current_stage_key, g._count._all, input.stage_map),
      waiting_children: waiting.filter((w) => w.stage_key === g.current_stage_key).length,
    }));
    const total = stages.reduce((n, s) => n + s.count, 0);
    return {
      from_version: { id: from.id, version: from.version },
      to_version: { id: to.id, version: to.version },
      total,
      ready: total > 0 && stages.every((s) => s.ok),
      stages,
      target_stages: target.stages.map((s) => ({ key: s.key, name: s.name, type: s.type })),
    };
  }

  async migrate(definitionId: number, input: MigrationInput) {
    const plan = await this.preview(definitionId, input);
    if (!plan.ready) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_MIGRATION_INVALID,
        plan.total === 0
          ? 'No hay solicitudes vivas en esa versión.'
          : 'Cada etapa con solicitudes vivas necesita una etapa destino válida.',
        { stages: plan.stages },
      );
    }
    const { store_id, user_id } = this.ctx();
    const map = new Map(plan.stages.map((s) => [s.from_stage_key, s.to_stage_key as string]));
    const ids: Array<{ id: number; reference: string }> =
      await this.prisma.workflow_instances.findMany({
        where: {
          store_id,
          definition_id: definitionId,
          version_id: plan.from_version.id,
          status: 'active',
        },
        select: { id: true, reference: true },
        orderBy: { id: 'asc' },
        take: MIGRATION_BATCH,
      });
    let migrated = 0;
    const failed: Array<{ instance_id: number; reference: string; error: string }> = [];
    for (const row of ids) {
      try {
        const moved = await this.prisma.$transaction((tx: WorkflowTx) =>
          this.moveOne(tx, store_id, user_id, row.id, plan.from_version, plan.to_version, map),
        );
        if (moved) migrated++;
        else failed.push({ instance_id: row.id, reference: row.reference, error: 'La solicitud cambió mientras se migraba.' });
      } catch (e) {
        failed.push({
          instance_id: row.id,
          reference: row.reference,
          error: ((e as Error)?.message ?? String(e)).slice(0, 300),
        });
      }
    }
    return { migrated, failed };
  }

  private async moveOne(
    tx: WorkflowTx,
    storeId: number,
    userId: number | null,
    id: number,
    from: { id: number; version: number },
    to: { id: number; version: number },
    map: Map<string, string>,
  ): Promise<boolean> {
    const instance = (await tx.workflow_instances.findFirst({
      where: { id, store_id: storeId },
    })) as WorkflowInstanceRow | null;
    if (!instance || instance.status !== 'active' || instance.version_id !== from.id) return false;
    // P2.2: moving a parent off its subflow stage would orphan the children it
    // waits for (their "closed" signal carries the old entry) or start them twice.
    const liveChildren = await tx.workflow_instances.count({
      where: {
        store_id: storeId,
        parent_instance_id: id,
        parent_stage_key: instance.current_stage_key,
        parent_entry_seq: instance.stage_entry_seq,
        status: 'active',
      },
    });
    if (liveChildren > 0) throw new Error(MIGRATION_WAITING_CHILDREN);
    const targetKey = map.get(instance.current_stage_key);
    if (!targetKey) return false;
    const version = await tx.workflow_versions.findFirst({
      where: { id: to.id, store_id: storeId },
      select: { definition: true },
    });
    const definition = version?.definition as WorkflowDefinitionV1 | undefined;
    const stage = definition ? findStage(definition, targetKey) : undefined;
    if (!definition || !stage) return false;
    const patch = this.stages.stagePatch(stage, new Date(), instance.stage_entry_seq);
    const cas = await tx.workflow_instances.updateMany({
      where: {
        id,
        store_id: storeId,
        row_version: instance.row_version,
        status: 'active',
        version_id: from.id,
      },
      data: { ...patch, version_id: to.id, row_version: { increment: 1 } },
    });
    if (cas.count === 0) return false;
    const updated: WorkflowInstanceRow = {
      ...instance,
      ...(patch as unknown as Partial<WorkflowInstanceRow>),
      version_id: to.id,
      row_version: instance.row_version + 1,
    };
    await this.stages.cancelOpenTasks(tx, storeId, id);
    const actor = userId === null ? { type: 'system' as const, id: null } : { type: 'user' as const, id: userId };
    await this.events.append(tx, {
      store_id: storeId,
      instance_id: id,
      type: 'migrated',
      from_stage_key: instance.current_stage_key,
      to_stage_key: stage.key,
      actor,
      payload: {
        from_version: from.version,
        to_version: to.version,
        from_version_id: from.id,
        to_version_id: to.id,
        from_stage_key: instance.current_stage_key,
        to_stage_key: stage.key,
      },
    });
    await this.stages.afterEnter(tx, {
      definition,
      instance: updated,
      stage,
      actor,
      notifies: [],
      vendix: [],
    });
    return true;
  }

  /** Live requests of the version whose current stage waits for active children. */
  private async waitingParents(
    storeId: number,
    definitionId: number,
    versionId: number,
  ): Promise<Array<{ id: number; stage_key: string }>> {
    const parents: Array<{ id: number; current_stage_key: string; stage_entry_seq: number }> =
      await this.prisma.workflow_instances.findMany({
        where: { store_id: storeId, definition_id: definitionId, version_id: versionId, status: 'active' },
        select: { id: true, current_stage_key: true, stage_entry_seq: true },
      });
    if (parents.length === 0) return [];
    const children: Array<{
      parent_instance_id: number | null;
      parent_stage_key: string | null;
      parent_entry_seq: number | null;
    }> = await this.prisma.workflow_instances.findMany({
      where: {
        store_id: storeId,
        status: 'active',
        parent_instance_id: { in: parents.map((p) => p.id) },
      },
      select: { parent_instance_id: true, parent_stage_key: true, parent_entry_seq: true },
    });
    return parents
      .filter((p) =>
        children.some(
          (c) =>
            c.parent_instance_id === p.id &&
            c.parent_stage_key === p.current_stage_key &&
            c.parent_entry_seq === p.stage_entry_seq,
        ),
      )
      .map((p) => ({ id: p.id, stage_key: p.current_stage_key }));
  }

  private planStage(
    source: WorkflowDefinitionV1,
    target: WorkflowDefinitionV1,
    fromKey: string,
    count: number,
    stageMap: Record<string, string> | undefined,
  ): MigrationPlanStage {
    const fromStage = findStage(source, fromKey);
    const wanted = stageMap?.[fromKey] ?? (findStage(target, fromKey) ? fromKey : null);
    const toStage = wanted ? findStage(target, wanted) : undefined;
    let reason: string | null = null;
    if (!wanted) reason = 'Elige la etapa de la nueva versión a la que pasan.';
    else if (!toStage) reason = `La etapa "${wanted}" no existe en la versión publicada.`;
    else if (toStage.type === 'end') reason = 'No se puede migrar a una etapa final.';
    return {
      from_stage_key: fromKey,
      from_stage_name: fromStage?.name ?? fromKey,
      count,
      to_stage_key: toStage ? toStage.key : null,
      to_stage_name: toStage?.name ?? null,
      ok: reason === null,
      reason,
      waiting_children: 0,
    };
  }

  private async versions(storeId: number, definitionId: number, input: MigrationInput) {
    const def = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id: storeId },
      select: { id: true, published_version_id: true },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    if (!def.published_version_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    const [from, to] = await Promise.all([
      this.prisma.workflow_versions.findFirst({
        where: { id: input.from_version_id, definition_id: definitionId, store_id: storeId },
        select: { id: true, version: true, definition: true },
      }),
      this.prisma.workflow_versions.findFirst({
        where: { id: def.published_version_id, store_id: storeId },
        select: { id: true, version: true, definition: true },
      }),
    ]);
    if (!from || !to) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    if (from.id === to.id) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_MIGRATION_INVALID,
        'Las solicitudes de esa versión ya están en la versión publicada.',
      );
    }
    return { from, to, target: to.definition as WorkflowDefinitionV1 };
  }
}
