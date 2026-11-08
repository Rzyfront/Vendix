import {
  WORKFLOW_AI_FORBIDDEN_INPUT_TYPES,
  WORKFLOW_AI_OUTPUT_TYPES,
  WORKFLOW_LIMITS,
  WorkflowAiDef,
  WorkflowAiTask,
  WorkflowFieldDef,
  WorkflowStageDef,
} from '../../../../../../../../shared/workflows/contract/workflow-contract';
import { AiStepSampleValue } from '../../../../interfaces/workflow.interfaces';

/** Largest size (characters) of the sample data the backend accepts for a test. */
export const AI_TEST_MAX_CHARS = 20000;

export const AI_TASK_OPTIONS: readonly { value: WorkflowAiTask; label: string; hint: string }[] = [
  { value: 'classify', label: 'Clasificar', hint: 'Elige una opción de una lista según lo que lee (por ejemplo, el tipo de una PQR).' },
  { value: 'extract', label: 'Extraer datos', hint: 'Lee un texto y llena varios campos con los datos que encuentra.' },
  { value: 'summarize', label: 'Resumir', hint: 'Resume lo que lee en un texto corto.' },
  { value: 'draft', label: 'Redactar', hint: 'Escribe un borrador, como la respuesta a un cliente.' },
  { value: 'decide', label: 'Decidir rama', hint: 'Elige una opción para que el flujo siga por una rama u otra.' },
];

export const AI_ERROR_THEN_OPTIONS = [
  { value: 'continue', label: 'Continuar' },
  { value: 'route', label: 'Ir a una etapa' },
  { value: 'fail', label: 'Marcar con error' },
];

/** Every task writes exactly one field except "extract" (1 to maxAiOutputs). */
export function isSingleOutputTask(task: WorkflowAiTask): boolean {
  return task !== 'extract';
}

export function maxOutputsFor(task: WorkflowAiTask): number {
  return isSingleOutputTask(task) ? 1 : WORKFLOW_LIMITS.maxAiOutputs;
}

/** Fields the AI may read: never file/user, and not the ones it writes or scores. */
export function allowedInputFields(fields: readonly WorkflowFieldDef[], ai: WorkflowAiDef): WorkflowFieldDef[] {
  return fields.filter(
    (f) =>
      !(WORKFLOW_AI_FORBIDDEN_INPUT_TYPES as readonly string[]).includes(f.type) &&
      !ai.outputs.includes(f.key) &&
      f.key !== ai.confidence_field,
  );
}

/** Fields the AI may write for its task: allowed type, not calculated, not read, not the confidence one. */
export function allowedOutputFields(fields: readonly WorkflowFieldDef[], ai: WorkflowAiDef): WorkflowFieldDef[] {
  const types = WORKFLOW_AI_OUTPUT_TYPES[ai.task] as readonly string[];
  return fields.filter(
    (f) => types.includes(f.type) && !f.compute && !ai.inputs.includes(f.key) && f.key !== ai.confidence_field,
  );
}

/** Declared number fields that can receive the confidence (0..1). */
export function allowedConfidenceFields(fields: readonly WorkflowFieldDef[], ai: WorkflowAiDef): WorkflowFieldDef[] {
  return fields.filter(
    (f) => f.type === 'number' && !f.compute && !ai.inputs.includes(f.key) && !ai.outputs.includes(f.key),
  );
}

/**
 * Switches the task and keeps only the outputs the new task can write (one for
 * every task but "extract"); inputs and the rest are kept.
 */
export function withTask(ai: WorkflowAiDef, task: WorkflowAiTask, fields: readonly WorkflowFieldDef[]): WorkflowAiDef {
  const next: WorkflowAiDef = { ...ai, task };
  const valid = allowedOutputFields(fields, next).map((f) => f.key);
  return { ...next, outputs: ai.outputs.filter((k) => valid.includes(k)).slice(0, maxOutputsFor(task)) };
}

/**
 * Turns the human review of an AI step on or off and keeps the stage valid:
 * with review it needs an assignee and resolves with approve / reject; without
 * it, no assignee or deadline and only `auto` (approve becomes auto, reject goes).
 */
export function withAiReview(stage: WorkflowStageDef, review: boolean): WorkflowStageDef {
  const ai = stage.ai;
  if (!ai) return stage;
  const { assignee, due, transitions, ...rest } = stage;
  if (review) {
    return {
      ...rest,
      ai: { ...ai, review: true },
      assignee: assignee ?? { kind: 'initiator' },
      ...(due ? { due } : {}),
      ...(transitions ? { transitions: transitions.map((t) => (t.on === 'auto' ? { ...t, on: 'approve' } : t)) } : {}),
    };
  }
  const { review: _review, ...plain } = ai;
  return {
    ...rest,
    ai: plain,
    ...(transitions
      ? { transitions: transitions.filter((t) => t.on !== 'reject').map((t) => (t.on === 'approve' ? { ...t, on: 'auto' } : t)) }
      : {}),
  };
}

/** What is still missing for the step to be valid, in plain Spanish (mirrors `AI_STEP_INVALID`). */
export function aiConfigHints(ai: WorkflowAiDef): string[] {
  const hints: string[] = [];
  if (ai.instructions.trim().length === 0) hints.push('Escribe las instrucciones del paso.');
  if (ai.inputs.length === 0) hints.push('Elige al menos un campo que la IA lea.');
  if (ai.outputs.length === 0) {
    hints.push(isSingleOutputTask(ai.task) ? 'Elige el campo que escribe la IA.' : 'Elige al menos un campo que escriba la IA.');
  }
  return hints;
}

/** Sample input of one field as the scalar the backend expects. */
export function coerceSample(field: WorkflowFieldDef, raw: string | boolean): AiStepSampleValue {
  if (field.type === 'boolean') return raw === true || raw === 'true';
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return null;
  if (field.type === 'number' || field.type === 'money') {
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return text;
}

/** One entry per declared input; empty samples travel as `null`. */
export function buildTestData(
  fields: readonly WorkflowFieldDef[],
  inputs: readonly string[],
  samples: Readonly<Record<string, string | boolean>>,
): Record<string, AiStepSampleValue> {
  const data: Record<string, AiStepSampleValue> = {};
  for (const key of inputs) {
    const field = fields.find((f) => f.key === key);
    if (field) data[key] = coerceSample(field, samples[key] ?? '');
  }
  return data;
}

/** Characters the backend counts against the 20000 limit of a test. */
export function testDataSize(data: Record<string, AiStepSampleValue>): number {
  return Object.values(data).reduce<number>((sum, v) => sum + (v === null ? 0 : String(v).length), 0);
}

/** Readable text of an output value of a test result. */
export function formatOutputValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vacío)';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** "82 %" for a 0..1 confidence, `null` when the model gave none. */
export function confidenceText(confidence: number | null): string | null {
  return confidence === null || !Number.isFinite(confidence)
    ? null
    : `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)} %`;
}
