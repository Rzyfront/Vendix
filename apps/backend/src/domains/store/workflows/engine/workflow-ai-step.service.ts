import { Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  findStage,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WORKFLOW_AI_STEP_APP_KEY, WorkflowAiService, WorkflowAiTokens } from '../ai/workflow-ai.service';
import {
  AiStepAnswer,
  AiStepFailure,
  aiStepFailure,
  buildAiStepMessages,
  failureOfRun,
  validateAiStepAnswer,
} from './workflow-ai-step.logic';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowEngineService } from './workflow-engine.service';
import {
  WorkflowIdempotencyConflict,
  WorkflowInstanceRow,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowEventsService } from './workflow-events.service';
import { systemIdempotencyKey } from './workflow-idempotency';
import { WorkflowLoaderService } from './workflow-loader.service';
import { WorkflowStageService } from './workflow-stage.service';
import { WorkflowTickService } from './workflow-tick.service';

/** What the dispatcher hands over: the claimed `ai_step` outbox row. */
export interface AiStepRow {
  id: number;
  store_id: number;
  instance_id: number | null;
  payload: Record<string, unknown>;
}

interface LoadedAiStep {
  instance: WorkflowInstanceRow;
  definition: WorkflowDefinitionV1;
  stage: WorkflowStageDef;
}

type Settlement =
  | { answer: AiStepAnswer; model: string | null; tokens: WorkflowAiTokens }
  | { failure: AiStepFailure };

const SYSTEM = { type: 'system', id: null } as const;

/**
 * P6.1: runs the AI of an `ai` stage from its `ai_step` outbox row. The model
 * call goes through the metered gateway OUTSIDE any transaction; only its
 * validated answer (or the failure) is written, in one transaction under the
 * instance lock, and the request never stays stuck: a person fills the fields
 * by hand (review) or the stage's error policy decides.
 */
@Injectable()
export class WorkflowAiStepService {
  private readonly logger = new Logger(WorkflowAiStepService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly loader: WorkflowLoaderService,
    private readonly events: WorkflowEventsService,
    private readonly stages: WorkflowStageService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly ticker: WorkflowTickService,
    private readonly engine: WorkflowEngineService,
    private readonly ai: WorkflowAiService,
  ) {}

  /** A retryable provider failure throws so the outbox retries with backoff. */
  async execute(row: AiStepRow): Promise<void> {
    const loaded = await this.load(row);
    if (!loaded) return;
    const { instance, definition, stage } = loaded;
    const result = await this.ai.run({
      appKey: WORKFLOW_AI_STEP_APP_KEY,
      purpose: 'ai_step',
      messages: buildAiStepMessages(definition, stage, instance.data ?? {}),
      definitionId: instance.definition_id,
      instanceId: instance.id,
      stageKey: stage.key,
    });
    if (result.status === 'success') {
      const checked = validateAiStepAnswer(definition, stage, result.json);
      await this.settle(
        loaded,
        checked.ok
          ? { answer: checked.answer, model: result.model, tokens: result.tokens }
          : { failure: checked.failure },
      );
      return;
    }
    if (result.status === 'failed' && result.retryable) throw new Error(result.error);
    await this.settle(loaded, { failure: failureOfRun(result) });
  }

  /** The outbox row ran out of attempts: degrade like any other failure. */
  async onDead(row: AiStepRow): Promise<void> {
    const loaded = await this.load(row);
    if (loaded) await this.settle(loaded, { failure: aiStepFailure('provider_error') });
  }

  private async load(row: AiStepRow): Promise<LoadedAiStep | null> {
    const storeId = this.loader.context().store_id;
    const instanceId = Number(row.payload.instance_id ?? row.instance_id);
    const instance = (await this.prisma.workflow_instances.findFirst({
      where: { id: instanceId, store_id: storeId },
    })) as WorkflowInstanceRow | null;
    if (
      !instance ||
      instance.status !== 'active' ||
      instance.current_stage_key !== row.payload.stage_key ||
      instance.stage_entry_seq !== Number(row.payload.stage_entry_seq)
    ) {
      this.logger.log(`ai_step ${row.id} skipped: the request is no longer at that stage entry`);
      return null;
    }
    const definition = await this.loader.loadDefinition(this.prisma, instance.version_id);
    const stage = findStage(definition, instance.current_stage_key);
    if (!stage?.ai) {
      this.logger.warn(`ai_step ${row.id} skipped: stage "${instance.current_stage_key}" is not an AI step`);
      return null;
    }
    const done = await this.prisma.workflow_instance_events.findFirst({
      where: { store_id: storeId, idempotency_key: this.resolutionKey(instance) },
      select: { id: true },
    });
    if (done) {
      this.logger.log(`ai_step ${row.id} skipped: this stage entry was already resolved`);
      return null;
    }
    return { instance, definition, stage };
  }

  private resolutionKey(instance: Pick<WorkflowInstanceRow, 'id' | 'stage_entry_seq'>): string {
    return systemIdempotencyKey(`ai_step:${instance.id}:${instance.stage_entry_seq}`);
  }

  private async settle(loaded: LoadedAiStep, outcome: Settlement): Promise<void> {
    const { instance, definition, stage } = loaded;
    try {
      await this.prisma.$transaction(async (tx: WorkflowTx) => {
        await this.events.lockInstance(tx, instance.store_id, instance.id);
        const fresh = (await tx.workflow_instances.findFirst({
          where: { id: instance.id, store_id: instance.store_id },
        })) as WorkflowInstanceRow | null;
        if (
          !fresh ||
          fresh.status !== 'active' ||
          fresh.current_stage_key !== stage.key ||
          fresh.stage_entry_seq !== instance.stage_entry_seq
        ) {
          return;
        }
        if ('answer' in outcome) {
          await this.writeAnswer(tx, fresh, definition, stage, outcome);
        } else {
          await this.degrade(tx, fresh, definition, stage, outcome.failure);
        }
      });
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) return; // already resolved
      throw e;
    }
  }

  private async writeAnswer(
    tx: WorkflowTx,
    fresh: WorkflowInstanceRow,
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    outcome: Extract<Settlement, { answer: AiStepAnswer }>,
  ): Promise<void> {
    const ai = stage.ai!;
    const { answer } = outcome;
    const merged = {
      ...(fresh.data ?? {}),
      ...answer.values,
      ...(ai.confidence_field && answer.confidence !== null
        ? { [ai.confidence_field]: answer.confidence }
        : {}),
    };
    const data = await this.stages.computeFields(definition, merged, fresh.store_id);
    const saved = await tx.workflow_instances.updateMany({
      where: { id: fresh.id, store_id: fresh.store_id, row_version: fresh.row_version },
      data: { data, row_version: { increment: 1 } },
    });
    if (saved.count === 0) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    }
    await this.events.append(tx, {
      store_id: fresh.store_id,
      instance_id: fresh.id,
      type: 'ai_step_completed',
      from_stage_key: stage.key,
      to_stage_key: stage.key,
      actor: SYSTEM,
      payload: {
        task: ai.task,
        output_keys: Object.keys(answer.values),
        confidence: answer.confidence,
        reason: answer.reason,
        model: outcome.model,
        tokens: outcome.tokens.total,
      },
      idempotencyKey: this.resolutionKey(fresh),
    });
    await this.continueFlow(tx, { ...fresh, data, row_version: fresh.row_version + 1 }, stage);
  }

  /** With review a person decides next; without it the request moves on. */
  private async continueFlow(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stage: WorkflowStageDef,
  ): Promise<void> {
    if (stage.ai?.review) {
      await this.stages.openAiReviewTask(tx, { instance, stage });
      return;
    }
    await this.enqueueAdvance(tx, instance, stage);
  }

  private async enqueueAdvance(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stage: WorkflowStageDef,
  ): Promise<void> {
    await this.events.enqueue(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      kind: 'advance',
      payload: {
        instance_id: instance.id,
        stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
      },
    });
  }

  private async degrade(
    tx: WorkflowTx,
    fresh: WorkflowInstanceRow,
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    failure: AiStepFailure,
  ): Promise<void> {
    const ai = stage.ai!;
    await this.events.append(tx, {
      store_id: fresh.store_id,
      instance_id: fresh.id,
      type: 'ai_step_failed',
      from_stage_key: stage.key,
      to_stage_key: stage.key,
      actor: SYSTEM,
      payload: { task: ai.task, reason_code: failure.reason_code, reason: failure.reason },
      idempotencyKey: this.resolutionKey(fresh),
    });
    const owners = await this.engine.flowOwners(tx, fresh);
    if (owners.length > 0) {
      await this.events.enqueue(tx, {
        store_id: fresh.store_id,
        instance_id: fresh.id,
        kind: 'notify',
        payload: {
          title: `${fresh.reference} · ${fresh.title}`,
          message: `Paso de IA fallido en "${stage.name}": ${failure.reason}. ${
            ai.review
              ? 'La tarea de revisión quedó abierta para llenarlo a mano.'
              : 'La solicitud siguió según la política de error del paso.'
          }`,
          user_ids: owners,
        },
      });
    }
    if (ai.review) {
      await this.stages.openAiReviewTask(tx, { instance: fresh, stage });
      return;
    }
    const policy = ai.on_error ?? {};
    const route =
      policy.then === 'route' && policy.route_to && policy.route_to !== stage.key
        ? findStage(definition, policy.route_to)
        : undefined;
    if (route) {
      await this.advancer.advance({
        tx,
        instance: fresh,
        definition,
        fromStage: stage,
        toStageKey: route.key,
        data: fresh.data ?? {},
        actor: SYSTEM,
        expectedRowVersion: fresh.row_version,
        runExitHooks: false,
        event: {
          type: 'error_routed',
          payload: { action: 'ai_step', to: route.key, error: failure.reason },
        },
      });
    } else if (policy.then === 'fail') {
      await this.ticker.fail(tx, fresh, 'ai_step_failed', new Date());
    } else {
      await this.enqueueAdvance(tx, fresh, stage);
    }
  }
}
