import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, startStage } from '@common/workflows/contract';
import {
  StartWorkflowInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowInstanceRow,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { WorkflowReferenceService } from './workflow-reference.service';
import { WorkflowStageService } from './workflow-stage.service';

/** `start` inside the engine transaction. */
@Injectable()
export class WorkflowStartService {
  constructor(
    private readonly loader: WorkflowLoaderService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
    private readonly references: WorkflowReferenceService,
  ) {}

  async execute(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    actor: WorkflowActor,
    input: StartWorkflowInput,
  ): Promise<WorkflowCommandResult> {
    if (input.idempotencyKey) {
      const prev = await this.events.replay(tx, input.idempotencyKey);
      if (prev) return prev;
    }
    const def = await tx.workflow_definitions.findFirst({
      where: input.definitionId
        ? { id: input.definitionId, store_id: ctx.store_id }
        : { key: input.definitionKey, store_id: ctx.store_id },
    });
    if (!def) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    if (def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    const definition = await this.loader.loadDefinition(tx, def.published_version_id);
    await this.assertMayStart(tx, ctx, definition);
    const stage = startStage(definition);
    if (!stage) throw new VendixHttpException(ErrorCodes.WORKFLOW_STAGE_NOT_FOUND);

    const declared = new Set(definition.fields.map((f) => f.key));
    const initial: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.data ?? {})) {
      if (declared.has(k)) initial[k] = v;
    }
    const now = new Date();
    const reference = await this.references.next(tx, ctx.store_id);
    const title = (input.title?.trim() || definition.name).slice(0, 200);
    const enter = this.stages.applyActions(stage.on_enter, initial, { reference, title });
    const patch = this.stages.stagePatch(stage, now, 0);
    const subject =
      input.subject && input.subject.type !== 'none' ? input.subject : null;

    const created = (await tx.workflow_instances.create({
      data: {
        organization_id: ctx.organization_id,
        store_id: ctx.store_id,
        definition_id: def.id,
        version_id: def.published_version_id,
        reference,
        title,
        data: enter.data,
        subject_type: subject?.type ?? null,
        subject_id: subject?.id ?? null,
        started_by_type: actor.type,
        started_by_id: actor.id,
        row_version: 0,
        ...patch,
        status: patch.status ?? 'active',
      },
    })) as WorkflowInstanceRow;

    await this.events.append(tx, {
      store_id: ctx.store_id,
      instance_id: created.id,
      type: 'started',
      to_stage_key: stage.key,
      actor,
      payload: { reference, definition_key: def.key, version_id: def.published_version_id },
      idempotencyKey: input.idempotencyKey ?? null,
    });
    await this.stages.afterEnter(tx, {
      definition,
      instance: created,
      stage,
      actor,
      notifies: enter.notifies,
    });
    return {
      instance: created,
      task: null,
      advanced: true,
      replayed: false,
      from_stage_key: null,
      to_stage_key: stage.key,
    };
  }

  private async assertMayStart(
    tx: WorkflowTx,
    ctx: WorkflowCallContext,
    definition: WorkflowDefinitionV1,
  ) {
    const allowed = definition.start_roles ?? [];
    if (allowed.length === 0 || ctx.is_owner || ctx.is_super_admin) return;
    const rows: Array<{
      roles: { name: string; organization_id: number | null } | null;
    }> =
      ctx.user_id === null
        ? []
        : await tx.user_roles.findMany({
            where: {
              user_id: ctx.user_id,
              OR: [{ store_id: ctx.store_id }, { store_id: null }],
            },
            select: {
              roles: { select: { name: true, organization_id: true } },
            },
          });
    // Only system roles or roles of this organization count.
    const holds = rows.some(
      (r) =>
        r.roles &&
        allowed.includes(r.roles.name) &&
        (r.roles.organization_id === null ||
          r.roles.organization_id === ctx.organization_id),
    );
    if (!holds) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_START_FORBIDDEN);
    }
  }
}
