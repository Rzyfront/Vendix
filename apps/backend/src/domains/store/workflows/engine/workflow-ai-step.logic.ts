import {
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '@common/workflows/contract';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { WorkflowAiRunResult } from '../ai/workflow-ai.service';
import { coerceOutputFields } from './workflow-http-output';

/** Answer limits of the seeded prompt (RULES 4). */
const MAX_TEXT = 300;
const MAX_TEXTAREA = 4000;
const MAX_REASON = 300;

export type AiStepFailureCode = 'quota' | 'not_included' | 'invalid_output' | 'provider_error';

export const AI_STEP_FAILURE_REASONS: Record<AiStepFailureCode, string> = {
  quota: 'La IA no se ejecutó: el plan no tiene cupo de IA',
  not_included: 'La IA no se ejecutó: el plan no incluye IA',
  invalid_output: 'La respuesta de la IA no fue válida',
  provider_error: 'La IA no respondió tras varios intentos',
};

export interface AiStepFailure {
  reason_code: AiStepFailureCode;
  reason: string;
}

export interface AiStepAnswer {
  /** Only the declared outputs the AI filled, coerced to their field types. */
  values: Record<string, unknown>;
  /** 0..1, or null when the AI gave none. */
  confidence: number | null;
  reason: string | null;
}

export type AiStepValidation =
  | { ok: true; answer: AiStepAnswer }
  | { ok: false; failure: AiStepFailure };

export function aiStepFailure(code: AiStepFailureCode): AiStepFailure {
  return { reason_code: code, reason: AI_STEP_FAILURE_REASONS[code] };
}

/** Failure of a gateway result that is not a success. */
export function failureOfRun(
  result: Exclude<WorkflowAiRunResult, { status: 'success' }>,
): AiStepFailure {
  if (result.status === 'skipped_quota') return aiStepFailure('quota');
  return aiStepFailure(result.code === 'SUBSCRIPTION_005' ? 'not_included' : 'provider_error');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function fieldOf(definition: Pick<WorkflowDefinitionV1, 'fields'>, key: string): WorkflowFieldDef | undefined {
  return (definition.fields ?? []).find((f) => f.key === key);
}

/**
 * The user message of the seeded prompt (`workflow_ai_step`): the task, the
 * business instructions, the declared inputs with their current values and the
 * declared outputs with their type and options. One implementation for the
 * engine and for "Probar paso de IA".
 */
export function buildAiStepMessages(
  definition: Pick<WorkflowDefinitionV1, 'fields'>,
  stage: WorkflowStageDef,
  data: Record<string, unknown>,
): AIMessage[] {
  const ai = stage.ai;
  if (!ai) throw new Error(`Stage "${stage.key}" is not an AI step`);
  const inputs: Record<string, unknown> = {};
  for (const key of ai.inputs) {
    const f = fieldOf(definition, key);
    if (!f) continue;
    inputs[key] = { label: f.label, type: f.type, value: data[key] ?? null };
  }
  const outputs: Record<string, unknown> = {};
  for (const key of ai.outputs) {
    const f = fieldOf(definition, key);
    if (!f) continue;
    outputs[key] = {
      label: f.label,
      type: f.type,
      ...(f.type === 'select' ? { options: (f.options ?? []).map((o) => o.value) } : {}),
    };
  }
  return [
    {
      role: 'user',
      content: JSON.stringify({ task: ai.task, instructions: ai.instructions, inputs, outputs }),
    },
  ];
}

/**
 * Checks the AI answer (`{values, confidence, reason}`) against the declared
 * outputs: only declared keys, a select value copied verbatim from its options,
 * values coercible to the field type, text up to 300 and textarea up to 4000
 * characters. Every output is required except for `extract`, where `null`
 * means "not present in the inputs" and leaves the field untouched.
 */
export function validateAiStepAnswer(
  definition: Pick<WorkflowDefinitionV1, 'fields'>,
  stage: WorkflowStageDef,
  json: unknown,
): AiStepValidation {
  const invalid: AiStepValidation = { ok: false, failure: aiStepFailure('invalid_output') };
  const ai = stage.ai;
  if (!ai || !isObj(json) || !isObj(json.values)) return invalid;
  const raw = json.values;
  const declared = new Set(ai.outputs);
  if (Object.keys(raw).some((k) => !declared.has(k))) return invalid;

  const present: Record<string, unknown> = {};
  for (const key of ai.outputs) {
    const v = raw[key];
    if (v === null || v === undefined) {
      if (ai.task !== 'extract') return invalid;
      continue;
    }
    const f = fieldOf(definition, key);
    if (typeof v === 'string' && f) {
      if (f.type === 'text' && v.length > MAX_TEXT) return invalid;
      if (f.type === 'textarea' && v.length > MAX_TEXTAREA) return invalid;
    }
    present[key] = v;
  }
  const { coerced, dropped } = coerceOutputFields(definition, present);
  if (dropped.length > 0) return invalid;

  const c = json.confidence;
  const confidence = typeof c === 'number' && Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : null;
  const reason = typeof json.reason === 'string' ? json.reason.slice(0, MAX_REASON) : null;
  return { ok: true, answer: { values: coerced, confidence, reason } };
}
