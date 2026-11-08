import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, findStage, normalizeDefinition } from '@common/workflows/contract';
import {
  WORKFLOW_AI_STEP_APP_KEY,
  WorkflowAiService,
} from '../ai/workflow-ai.service';
import {
  buildAiStepMessages,
  failureOfRun,
  validateAiStepAnswer,
} from '../engine/workflow-ai-step.logic';
import { WorkflowAiStepTestDto } from '../dto/workflow-ai-step-test.dto';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

const MAX_TEST_DATA_CHARS = 20_000;

export type AiStepTestResult =
  | {
      status: 'success';
      values: Record<string, unknown>;
      confidence: number | null;
      reason: string | null;
      model: string | null;
      tokens: number;
    }
  | { status: 'skipped_quota' | 'invalid_output' | 'failed'; message: string; tokens?: number };

const isScalar = (v: unknown) =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

/**
 * "Probar paso de IA": one REAL call of the step with sample data. It uses the
 * engine's message builder and answer validation, so what the person sees here
 * is what the step would write. Nothing is written to any request.
 */
@Injectable()
export class WorkflowAiStepTestService {
  constructor(
    private readonly definitions: WorkflowDefinitionsService,
    private readonly ai: WorkflowAiService,
  ) {}

  async test(id: number, dto: WorkflowAiStepTestDto): Promise<AiStepTestResult> {
    // Store-scoped: a foreign id is a 404 here.
    const draft = await this.definitions.getDraft(id);
    const raw = draft.definition ?? (await this.definitions.export(id)).definition;
    const definition = raw ? normalizeDefinition(raw as unknown as WorkflowDefinitionV1) : null;
    const stage = definition ? findStage(definition, dto.stage_key) : undefined;
    if (!definition || !stage || stage.type !== 'ai' || !stage.ai) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_AI_STAGE_INVALID);
    }
    const data = this.checkData(dto.data, stage.ai.inputs);

    const run = await this.ai.run({
      appKey: WORKFLOW_AI_STEP_APP_KEY,
      purpose: 'ai_step_test',
      messages: buildAiStepMessages(definition, stage, data),
      definitionId: id,
      stageKey: stage.key,
    });
    if (run.status !== 'success') {
      return { status: run.status, message: failureOfRun(run).reason };
    }
    const checked = validateAiStepAnswer(definition, stage, run.json);
    if (!checked.ok) {
      return { status: 'invalid_output', message: checked.failure.reason, tokens: run.tokens.total };
    }
    return {
      status: 'success',
      values: checked.answer.values,
      confidence: checked.answer.confidence,
      reason: checked.answer.reason,
      model: run.model,
      tokens: run.tokens.total,
    };
  }

  /** Only the step's declared inputs, with plain values, and a bounded size. */
  private checkData(data: Record<string, unknown>, inputs: string[]): Record<string, unknown> {
    const allowed = new Set(inputs);
    const valid =
      Object.entries(data).every(([k, v]) => allowed.has(k) && isScalar(v)) &&
      JSON.stringify(data).length <= MAX_TEST_DATA_CHARS;
    if (!valid) throw new VendixHttpException(ErrorCodes.WORKFLOW_AI_TEST_INVALID);
    return data;
  }
}
