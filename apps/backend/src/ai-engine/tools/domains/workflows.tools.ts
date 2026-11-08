import {
  OPS_BY_FIELD_TYPE,
  STAGE_OUTCOMES,
  WORKFLOW_ACTIONS,
  WORKFLOW_AI_FORBIDDEN_INPUT_TYPES,
  WORKFLOW_AI_OUTPUT_TYPES,
  WORKFLOW_AI_TASKS,
  WORKFLOW_END_OUTCOMES,
  WORKFLOW_ERROR_THEN,
  WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  WORKFLOW_FIELD_TYPES,
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_LIMITS,
  WORKFLOW_REQUIREMENT_KINDS,
  WORKFLOW_SCHEMA_V1,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_SUBJECT_TYPES,
  WorkflowAssigneeDef,
  WorkflowDefinitionV1,
  WorkflowIssue,
  WorkflowStageDef,
  WorkflowValidationContext,
  WorkflowValidationResult,
} from '../../../common/workflows/contract';
import { industryAllowsKey } from '../../../common/access/module-industries';
import { localCivil } from '../../../common/utils/store-timezone.util';
import { VendixHttpException } from '../../../common/errors';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { createHash, randomUUID } from 'crypto';
import type { WorkflowEngineService } from '../../../domains/store/workflows/engine/workflow-engine.service';
import type { WorkflowDefinitionsService } from '../../../domains/store/workflows/definitions/workflow-definitions.service';
import type { WorkflowInstancesService } from '../../../domains/store/workflows/instances/workflow-instances.service';
import type { WorkflowMetricsService } from '../../../domains/store/workflows/metrics/workflow-metrics.service';

export interface WorkflowsToolDeps {
  definitions: Pick<
    WorkflowDefinitionsService,
    | 'list'
    | 'create'
    | 'validate'
    | 'validateDefinition'
    | 'validationContext'
    | 'get'
    | 'getDraft'
    | 'saveDraft'
    | 'publish'
    | 'version'
  >;
  /** The same commands the UI controllers call (start / complete a task). */
  engine: Pick<WorkflowEngineService, 'start' | 'completeTask'>;
  /** `get` applies the participation rule of the caller (cross-store / non-participant = not found). */
  instances: Pick<WorkflowInstancesService, 'get'>;
  metrics: Pick<WorkflowMetricsService, 'stageMetrics'>;
  /** Instance id of the current store by its reference ("FLU-000123"), or null. */
  findInstanceIdByReference: (reference: string) => Promise<number | null>;
  /** Instance id of a task of the current store, or null. */
  findInstanceIdByTaskId: (taskId: number) => Promise<number | null>;
  storeTimezone: (store_id: number) => Promise<string>;
  /** `stores.industries` of the store; null when the store does not exist. */
  storeIndustries: (
    store_id: number,
  ) => Promise<readonly string[] | null | undefined>;
}

const DOMAIN = 'workflows';
const NOT_ADMINISTRATION =
  'El módulo de Flujos solo está disponible para tiendas con la industria Administración.';
const MAX_LIST = 50;
const MIN_DAYS = 7;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;
const TIMELINE_EVENTS = 20;
const MAX_ISSUES = 25;

function guidedError(error: string, nextStep?: string, extra?: object): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(extra ?? {}),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** `YYYY-MM-DD HH:mm` in the store timezone. */
function localStamp(value: Date | string | null | undefined, tz: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = localCivil(d, tz);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)} ${two(p.hour)}:${two(p.minute)}`;
}

const hoursBetween = (a: Date, b: Date) =>
  Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10;

// ─── Spanish rendering of a definition (preview) ─────────────────────────

const STAGE_TYPE_ES: Record<string, string> = {
  form: 'Formulario',
  approval: 'Aprobación',
  review: 'Revisión',
  automatic: 'Automática',
  ai: 'Paso de IA',
  parallel: 'Paralela',
  subflow: 'Subflujo',
  wait: 'Espera',
  loop: 'Ciclo',
  end: 'Fin',
};

const OUTCOME_ES: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
  auto: 'Automático',
};

const AI_TASK_ES: Record<string, string> = {
  classify: 'clasificar',
  extract: 'extraer datos',
  summarize: 'resumir',
  draft: 'redactar',
  decide: 'decidir rama',
};

const END_OUTCOME_ES: Record<string, string> = {
  completed: 'completado',
  rejected: 'rechazado',
  cancelled: 'cancelado',
};

function assigneeEs(a: WorkflowAssigneeDef | undefined): string {
  if (!a) return 'Sin responsable';
  switch (a.kind) {
    case 'initiator':
      return 'Quien inicia la solicitud';
    case 'role':
      return `Rol «${a.role_key}»`;
    case 'group':
      return `Grupo «${a.group_key}»`;
    case 'user':
      return `Usuario #${a.user_id}`;
    case 'field':
      return `Persona elegida en el campo «${a.field}»`;
    default:
      return 'Sin responsable';
  }
}

function describeStage(stage: WorkflowStageDef, all: WorkflowStageDef[]) {
  const nameOf = (key: string) => all.find((s) => s.key === key)?.name ?? key;
  const parts: string[] = [`Tipo: ${STAGE_TYPE_ES[stage.type] ?? stage.type}`];
  if (stage.type === 'end') {
    parts.push(
      `Resultado: ${END_OUTCOME_ES[String(stage.outcome)] ?? stage.outcome ?? 'sin definir'}`,
    );
  } else if (stage.type === 'ai' && stage.ai) {
    parts.push(`IA: ${AI_TASK_ES[stage.ai.task] ?? stage.ai.task}`);
    parts.push(`Lee: ${stage.ai.inputs.join(', ')}`);
    parts.push(`Escribe: ${stage.ai.outputs.join(', ')}`);
    if (stage.ai.review) parts.push(`Revisa: ${assigneeEs(stage.assignee)}`);
  } else if (stage.type !== 'automatic') {
    parts.push(`Responsable: ${assigneeEs(stage.assignee)}`);
  }
  if (stage.quorum)
    parts.push(`Aprobaciones requeridas: ${stage.quorum.required}`);
  if (stage.due) parts.push(`Plazo: ${stage.due.hours} h`);
  if (stage.form?.fields?.length) {
    parts.push(`Campos: ${stage.form.fields.join(', ')}`);
  }
  if (stage.requirements?.length) {
    parts.push(
      `Requisitos: ${stage.requirements.map((r) => r.label).join(', ')}`,
    );
  }
  if (stage.transitions?.length) {
    const outs = stage.transitions.map((t) => {
      const what = t.label ?? OUTCOME_ES[t.on] ?? t.on;
      return `${what}${t.when ? ' (con condición)' : ''} → ${nameOf(t.to)}`;
    });
    parts.push(`Salidas: ${outs.join('; ')}`);
  }
  return parts.join(' · ');
}

function issueLine(i: WorkflowIssue): string {
  return `${i.path ? `${i.path}: ` : ''}${i.message}`;
}

function slimIssues(issues: WorkflowIssue[]) {
  return issues.slice(0, MAX_ISSUES).map((i) => ({
    code: i.code,
    path: i.path,
    message: i.message,
    ...(i.stage_key ? { stage_key: i.stage_key } : {}),
  }));
}

// ─── Schema reference (compact, deterministic) ───────────────────────────

const SCHEMA_RULES_ES = [
  'Exactamente una etapa con `start: true`; toda etapa debe ser alcanzable desde ella.',
  'Al menos una etapa `end`, con `outcome` (completed | rejected | cancelled) y sin transiciones.',
  'Etapas form/approval/review exigen `assignee`; las `automatic` y `end` no.',
  'Cada transición usa un `on` válido para el tipo de etapa (ver `stage_outcomes`) y un `to` que exista.',
  'Si varias transiciones comparten `on`, las que tienen `when` van primero y la rama por defecto (sin `when`) va al final.',
  'Los ciclos solo se permiten si pasan por una etapa humana; una cadena de etapas automáticas no puede volver a sí misma.',
  'Las claves (flujo, etapas, campos, requisitos) cumplen `key_pattern`.',
  'Condiciones: solo campos declarados en `fields` y operadores válidos para su tipo (`ops_by_field_type`).',
  'Solo `role_key` y `group_key` de las listas de la tienda (`role_keys`, `group_keys`). Nunca inventes roles ni grupos: si no hay uno adecuado, usa `initiator` y avisa a la persona.',
  'Requisitos: `upload` y `file_field` siempre; `issued_document` solo con una `template_key` de las plantillas publicadas de la tienda (`published_template_keys`; con `auto_issue_on_enter: true` se emite al entrar a la etapa), y `signature` solo con `of` = clave de un `issued_document` de la misma etapa. Nunca inventes una plantilla: si no está publicada, avisa a la persona.',
  '`quorum.required` solo en aprobaciones. Un rechazo siempre rechaza.',
  'Etapa `ai` (paso de IA): exige el objeto `ai` (ver `ai_step`) y no admite `form` ni `requirements`. Sin `ai.review` no lleva `assignee` y sale con una transición `auto`; con `ai.review: true` lleva `assignee` (la persona revisa y puede editar lo que escribió la IA) y sale con `approve` (y `reject` opcional).',
  'Paso de IA: `inputs` son claves de campos declarados que la IA lee (nunca de tipo file ni user); `outputs` son los campos que escribe, del tipo que admite su tarea (`ai_step.output_types`) y nunca calculados. classify, decide, summarize y draft escriben exactamente un campo; extract, uno o varios.',
  'Paso de IA con `task: decide`: la transición de salida (`auto`, o `approve` con revisión) necesita al menos una rama con `when` sobre el campo que escribe la IA y una rama por defecto.',
  'Si la IA falla o no hay cupo: con `ai.review` nace la tarea de revisión para llenarlo a mano; sin revisión manda `ai.on_error.then` (continue por defecto, route a `route_to` o fail). Para un campo obligatorio usa `review: true` o `on_error` con `route` a una etapa de formulario.',
  'Tú propones el JSON; la validez la decide siempre el validador, nunca tú.',
];

function schemaReference(ctx: WorkflowValidationContext) {
  const {
    maxStages,
    maxFields,
    maxTransitionsPerStage,
    maxRequirementsPerStage,
  } = WORKFLOW_LIMITS;
  return {
    schema: WORKFLOW_SCHEMA_V1,
    top_level: {
      required: ['schema', 'key', 'name', 'fields', 'stages'],
      optional: ['description', 'subject', 'triggers', 'start_roles'],
      schema_value: WORKFLOW_SCHEMA_V1,
      subject_types: WORKFLOW_SUBJECT_TYPES,
      triggers: ['{ "kind": "manual" }', '{ "kind": "public_form" }'],
      start_roles:
        'Lista opcional de role_key que pueden iniciar el flujo (vacía = cualquiera con permiso).',
    },
    limits: {
      max_stages: maxStages,
      max_fields: maxFields,
      max_transitions_per_stage: maxTransitionsPerStage,
      max_requirements_per_stage: maxRequirementsPerStage,
    },
    key_pattern: WORKFLOW_KEY_PATTERN.source,
    field_types: WORKFLOW_FIELD_TYPES,
    field:
      '{ key, type, label, required?, help?, options?: [{value,label}] (select/multiselect), visible_when? }',
    stage_types: WORKFLOW_STAGE_TYPES,
    stage_outcomes: STAGE_OUTCOMES,
    end_outcomes: WORKFLOW_END_OUTCOMES,
    stage:
      '{ key, name, type, start?, outcome? (end), assignee?, quorum?, form?: {fields:[keys]}, requirements?, ai? (solo type "ai"), transitions?: [{to,on,when?,require_comment?,label?}], due?: {hours,on_overdue?}, on_enter?, on_exit? }',
    ai_step: {
      shape:
        '{ task, instructions, inputs: [claves], outputs: [claves], confidence_field?, review?, on_error?: { retries?, then?, route_to? } }',
      tasks: WORKFLOW_AI_TASKS,
      output_types: WORKFLOW_AI_OUTPUT_TYPES,
      forbidden_input_types: WORKFLOW_AI_FORBIDDEN_INPUT_TYPES,
      on_error_then: WORKFLOW_ERROR_THEN,
      limits: {
        max_instructions: WORKFLOW_LIMITS.maxAiInstructions,
        max_inputs: WORKFLOW_LIMITS.maxAiInputs,
        max_outputs: WORKFLOW_LIMITS.maxAiOutputs,
        max_retries: WORKFLOW_LIMITS.maxActionRetries,
      },
      confidence_field: 'Opcional: campo number no calculado, distinto de inputs y outputs, que recibe la confianza (0 a 1).',
      example: {
        key: 'clasificar',
        name: 'Clasificar con IA',
        type: 'ai',
        ai: {
          task: 'classify',
          instructions: 'Clasifica el caso como Petición, Queja o Reclamo según el asunto y el detalle.',
          inputs: ['asunto', 'detalle'],
          outputs: ['tipo'],
          on_error: { then: 'route', route_to: 'clasificar_manual' },
        },
        transitions: [{ on: 'auto', to: 'responder' }],
      },
    },
    assignee_kinds: [
      '{ "kind": "initiator" }',
      '{ "kind": "role", "role_key": "<de role_keys>" }',
      '{ "kind": "group", "group_key": "<de group_keys>", "strategy"?: "any|round_robin|least_load" }',
      '{ "kind": "field", "field": "<campo de tipo user>" }',
    ],
    condition:
      '{ "all"|"any": [ { "field", "op", "value"? } | { grupo anidado } ] } (profundidad máx. 3)',
    ops_by_field_type: OPS_BY_FIELD_TYPE,
    requirement_kinds: WORKFLOW_REQUIREMENT_KINDS,
    actions: WORKFLOW_ACTIONS,
    rules: SCHEMA_RULES_ES,
    role_keys: [...(ctx.roleKeys ?? [])],
    group_keys: [...(ctx.groupKeys ?? [])],
    published_template_keys: [...(ctx.publishedTemplateKeys ?? [])],
    example: WORKFLOW_EXAMPLE_PURCHASE_APPROVAL,
  };
}

// ─── Draft planning (shared by preview and handler) ──────────────────────

type DraftPlan =
  | {
      ok: true;
      name: string;
      description: string | null;
      definition: WorkflowDefinitionV1;
      warnings: WorkflowIssue[];
    }
  | { ok: false; error: string; next_step: string; issues?: WorkflowIssue[] };

const RETRY_STEP =
  'Corrige exactamente esos puntos y vuelve a llamar a workflows_draft_from_description UNA sola vez. Si vuelve a fallar, muestra a la persona qué sí quedó bien y qué falta; no inventes roles ni grupos (consulta workflows_schema_reference).';

async function planDraft(
  deps: WorkflowsToolDeps,
  args: Record<string, any>,
): Promise<DraftPlan> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name || name.length > 160) {
    return {
      ok: false,
      error: 'El nombre del flujo es obligatorio (máximo 160 caracteres).',
      next_step: 'Pide o propone un nombre corto para el flujo.',
    };
  }
  if (!isObj(args.definition)) {
    return {
      ok: false,
      error: 'La definición debe ser un objeto JSON vendix.workflow/v1.',
      next_step:
        'Lee workflows_schema_reference y envía la definición completa en `definition`.',
    };
  }
  const definition = args.definition as unknown as WorkflowDefinitionV1;
  const result = await deps.definitions.validateDefinition(definition);
  if (!result.valid) {
    return {
      ok: false,
      error: `La definición no es válida (${result.errors.length} ${result.errors.length === 1 ? 'problema' : 'problemas'}); no se propone nada hasta corregirla.`,
      next_step: RETRY_STEP,
      issues: result.errors,
    };
  }
  const description =
    typeof args.description === 'string' && args.description.trim()
      ? args.description.trim()
      : null;
  return { ok: true, name, description, definition, warnings: result.warnings };
}

function draftPreview(plan: DraftPlan): ToolPreview {
  if (!plan.ok) {
    const lines = (plan.issues ?? []).slice(0, MAX_ISSUES).map(issueLine);
    return {
      status: 'error',
      target: 'Nuevo flujo (borrador)',
      changes: [],
      domain: DOMAIN,
      message: [plan.error, ...lines.map((l) => `- ${l}`), plan.next_step].join(
        '\n',
      ),
    };
  }
  const { definition, warnings, name } = plan;
  const stages = definition.stages;
  const changes: ToolPreview['changes'] = [
    { field: 'name', label: 'Nombre', from: null, to: name },
    ...(plan.description
      ? [
          {
            field: 'description',
            label: 'Descripción',
            from: null,
            to: plan.description,
          },
        ]
      : []),
    {
      field: 'fields',
      label: 'Campos',
      from: null,
      to: definition.fields.length
        ? definition.fields
            .map(
              (f) =>
                `${f.label} (${f.type}${f.required ? ', obligatorio' : ''})`,
            )
            .join('; ')
        : 'Ninguno',
    },
    ...stages.map((s, i) => ({
      field: `stage:${s.key}`,
      label: `Etapa ${i + 1} · ${s.name}`,
      from: null,
      to: describeStage(s, stages),
    })),
  ];
  return {
    status: warnings.length ? 'warning' : 'ok',
    target: `Borrador de flujo «${name}»`,
    changes,
    domain: DOMAIN,
    message: warnings.length
      ? `Avisos del validador: ${warnings.map(issueLine).join(' | ')}. Se crea solo como BORRADOR: publicarlo es un clic humano en el editor.`
      : 'Se crea solo como BORRADOR: publicarlo es un clic humano en el editor.',
  };
}


// ─── Write tools: proposal helpers ───────────────────────────────────────

const PROPOSAL_TTL_MS = 60 * 60 * 1000;
const PROPOSAL_MAX = 500;
const INSTANCE_URL = (id: number) => `/admin/workflows/instances/${id}`;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const stageList = (d: unknown): WorkflowStageDef[] =>
  isObj(d) && Array.isArray(d.stages) ? (d.stages as WorkflowStageDef[]) : [];
const fieldList = (d: unknown): Array<{ key: string; label?: string }> =>
  isObj(d) && Array.isArray(d.fields)
    ? (d.fields as Array<{ key: string; label?: string }>)
    : [];

/** Spanish diff of two definitions: stages and fields added / removed / changed. */
function diffDefinitions(before: unknown, after: unknown) {
  const oldStages = new Map(stageList(before).map((s) => [s.key, s]));
  const newStages = new Map(stageList(after).map((s) => [s.key, s]));
  const stageLabel = (s: WorkflowStageDef) =>
    `${s.name} (${STAGE_TYPE_ES[s.type] ?? s.type})`;
  const added = [...newStages.values()].filter((s) => !oldStages.has(s.key));
  const removed = [...oldStages.values()].filter((s) => !newStages.has(s.key));
  const renamed: string[] = [];
  const retyped: string[] = [];
  const edited: string[] = [];
  for (const s of newStages.values()) {
    const o = oldStages.get(s.key);
    if (!o) continue;
    if (o.name !== s.name) renamed.push(`«${o.name}» → «${s.name}»`);
    if (o.type !== s.type) {
      retyped.push(
        `«${s.name}»: ${STAGE_TYPE_ES[o.type] ?? o.type} → ${STAGE_TYPE_ES[s.type] ?? s.type}`,
      );
    } else if (canonical({ ...o, name: '' }) !== canonical({ ...s, name: '' })) {
      edited.push(`«${s.name}»`);
    }
  }
  const oldFields = new Map(fieldList(before).map((f) => [f.key, f]));
  const newFields = new Map(fieldList(after).map((f) => [f.key, f]));
  const fieldLabel = (f: { key: string; label?: string }) => f.label ?? f.key;
  return {
    stagesAdded: added.map(stageLabel),
    stagesRemoved: removed.map(stageLabel),
    stagesRenamed: renamed,
    stagesRetyped: retyped,
    stagesEdited: edited,
    fieldsAdded: [...newFields.values()]
      .filter((f) => !oldFields.has(f.key))
      .map(fieldLabel),
    fieldsRemoved: [...oldFields.values()]
      .filter((f) => !newFields.has(f.key))
      .map(fieldLabel),
  };
}

const orNone = (items: string[]) => (items.length ? items.join('; ') : 'Ninguno');

interface DefinitionRef {
  id: number;
  key: string;
  name: string;
  status: string;
  is_enabled: boolean;
  version: number | null;
  has_unpublished_changes: boolean;
}

type Planned<T> = { ok: true; value: T } | { ok: false; error: string; next_step?: string; issues?: WorkflowIssue[] };

function errorPreview(target: string, plan: { error: string; next_step?: string; issues?: WorkflowIssue[] }): ToolPreview {
  const lines = (plan.issues ?? []).slice(0, MAX_ISSUES).map((i) => `- ${issueLine(i)}`);
  return {
    status: 'error',
    target,
    changes: [],
    domain: DOMAIN,
    message: [plan.error, ...lines, ...(plan.next_step ? [plan.next_step] : [])].join('\n'),
  };
}


interface DefinitionSummary {
  id: number;
  key: string;
  name: string;
  status: string;
  is_enabled?: boolean;
  published_version: { version: number } | null;
  has_unpublished_changes?: boolean;
}

/** A field the task fills, as the instance detail returns it. */
interface TaskFormField {
  key: string;
  label?: string;
  type?: string;
  options?: Array<{ value: unknown; label?: string }>;
}

interface TaskRow {
  id: number;
  status: string;
  stage_key: string;
  can_act: boolean;
  /** Fields this task fills (stage form or branch form). */
  form_fields?: TaskFormField[];
}

/** One request field a task decision writes, shown on the confirmation card. */
interface TaskValueEdit {
  key: string;
  field: TaskFormField;
  from: unknown;
  to: unknown;
}

interface InstanceDetail {
  id: number;
  reference: string;
  title: string | null;
  status: string;
  row_version: number;
  data?: Record<string, unknown>;
  stage: { key: string; name: string } | null;
  tasks: TaskRow[];
  allowed_outcomes: string[];
}

const OUTCOME_LABEL = (o: string) => OUTCOME_ES[o] ?? o;
const PENDING_TASK = ['open', 'claimed'];

/**
 * Like the screen, the task form starts from the request's current data; the
 * values Vex sends win. The engine validates only the submitted values.
 */
function taskFormValues(
  detail: InstanceDetail,
  task: TaskRow,
  given: unknown,
): Record<string, unknown> {
  const data = detail.data ?? {};
  const seeded = Object.fromEntries(
    (task.form_fields ?? [])
      .map((f) => f.key)
      .filter((key) => data[key] !== undefined && data[key] !== null)
      .map((key) => [key, data[key]]),
  );
  return { ...seeded, ...(isObj(given) ? given : {}) };
}

// ─── Tools ───────────────────────────────────────────────────────────────

/**
 * Block 11 — AI tools for Flujos (design §7.1–§7.5).
 *
 * The validator, the timeline and the SQL-derived metrics are deterministic;
 * the model only proposes JSON and narrates. Every write goes through
 * propose → confirm → execute, its card shows what it writes, and it calls
 * the same service as the screen with the user's own permissions:
 * - `workflows_draft_from_description` creates a DRAFT;
 * - `workflows_update_draft` edits a draft (diff of stages and fields);
 * - `workflows_publish_definition` publishes the draft as a new version;
 * - `workflows_start_instance` starts a request (each field with its label);
 * - `workflows_complete_task` decides a task the user is assigned to (each
 *   field it changes, current and new value; foreign keys are refused).
 * Nothing here forces a transition outside a task, cancels, deletes, or
 * touches public links / API keys.
 *
 * Industry gate: the tool registry has no per-industry visibility, so every
 * handler/preview refuses with a clear Spanish message when the store does not
 * have the `administration` industry (`industryAllowsKey('flows', …)`). There
 * is intentionally NO plan / feature-flag gate: plans only change AI quotas,
 * and AI spend is metered by the engine like any other tool.
 */
export function createWorkflowsTools(
  deps: WorkflowsToolDeps,
): RegisteredTool[] {
  async function industryError(
    context: ToolExecutionContext,
  ): Promise<string | null> {
    if (!context.store_id) {
      return 'Sin tienda en contexto: los flujos siempre viven dentro de una tienda.';
    }
    const industries = await deps.storeIndustries(context.store_id);
    return industryAllowsKey('flows', industries) ? null : NOT_ADMINISTRATION;
  }

  const gated =
    (
      run: (
        args: Record<string, any>,
        context: ToolExecutionContext,
      ) => Promise<string>,
    ): NonNullable<RegisteredTool['handler']> =>
    async (args, context) => {
      const blocked = await industryError(context);
      if (blocked) return guidedError(blocked);
      try {
        return await run(args, context);
      } catch (error) {
        return guidedError(errorMessage(error));
      }
    };


  // Values the preview captured (draft stamp, instance row_version), keyed by the
  // proposal arguments: execution passes them to the service so a change made
  // between the card and the confirmation fails cleanly instead of overwriting.
  const captured = new Map<string, { value: string | number | null; at: number }>();
  const proposalKey = (
    tool: string,
    context: ToolExecutionContext,
    args: Record<string, unknown>,
  ) =>
    createHash('sha256')
      .update(`${tool}|${context.store_id}|${context.user_id}|${canonical(args)}`)
      .digest('hex');
  function capture(key: string, value: string | number | null) {
    const now = Date.now();
    for (const [k, e] of captured) {
      if (now - e.at > PROPOSAL_TTL_MS) captured.delete(k);
    }
    while (captured.size >= PROPOSAL_MAX) {
      const oldest = captured.keys().next().value as string;
      captured.delete(oldest);
    }
    captured.set(key, { value, at: now });
  }
  function recall(key: string): { value: string | number | null } | undefined {
    const e = captured.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > PROPOSAL_TTL_MS) {
      captured.delete(key);
      return undefined;
    }
    return { value: e.value };
  }

  /** Preview wrapper: industry gate and error-to-card conversion shared by the write tools. */
  const guardedPreview =
    (
      target: string,
      build: (
        args: Record<string, any>,
        context: ToolExecutionContext,
      ) => Promise<ToolPreview>,
    ): NonNullable<RegisteredTool['preview']> =>
    async (args, context) => {
      const blocked = await industryError(context);
      if (blocked) return errorPreview(target, { error: blocked });
      try {
        return await build(args, context);
      } catch (error) {
        return errorPreview(target, { error: errorMessage(error) });
      }
    };

  const NOT_FOUND_FLOW: Planned<never> = {
    ok: false,
    error: 'No encontré ese flujo en la tienda.',
    next_step: 'Usa workflows_list para encontrar el definition_id o la clave.',
  };

  async function resolveDefinition(
    args: Record<string, any>,
  ): Promise<Planned<DefinitionRef>> {
    const hasId = args.definition_id !== undefined && args.definition_id !== null;
    let id = hasId ? toPositiveInt(args.definition_id) : null;
    const key =
      typeof args.definition_key === 'string' ? args.definition_key.trim() : '';
    if ((hasId && id === null) || (!hasId && !key)) {
      return {
        ok: false,
        error: 'Indica definition_id (número) o definition_key (texto).',
        next_step: 'Usa workflows_list para encontrar el flujo.',
      };
    }
    if (id === null) {
      const res = await deps.definitions.list({
        limit: MAX_LIST,
        page: 1,
        search: key,
      });
      id =
        (res.data as Array<{ id: number; key: string }>).find(
          (d) => d.key.toLowerCase() === key.toLowerCase(),
        )?.id ?? null;
      if (id === null) return NOT_FOUND_FLOW;
    }
    let d: DefinitionSummary;
    try {
      d = (await deps.definitions.get(id)) as unknown as DefinitionSummary;
    } catch {
      return NOT_FOUND_FLOW;
    }
    return {
      ok: true,
      value: {
        id: d.id,
        key: d.key,
        name: d.name,
        status: d.status,
        is_enabled: d.is_enabled !== false,
        version: d.published_version?.version ?? null,
        has_unpublished_changes: d.has_unpublished_changes === true,
      },
    };
  }

  const NOT_FOUND_REQUEST: Planned<never> = {
    ok: false,
    error: 'No encontré esa tarea o no tienes acceso a ella.',
    next_step:
      'Pide el task_id o la referencia exacta de la solicitud (por ejemplo FLU-000123).',
  };

  async function loadDetail(instanceId: number | null) {
    if (instanceId === null) return null;
    try {
      return (await deps.instances.get(instanceId)) as unknown as InstanceDetail;
    } catch {
      // Not found, other store or not a participant: the same answer on purpose.
      return null;
    }
  }

  async function resolveTask(
    args: Record<string, any>,
  ): Promise<Planned<{ detail: InstanceDetail; task: TaskRow }>> {
    const hasTask = args.task_id !== undefined && args.task_id !== null;
    const taskId = hasTask ? toPositiveInt(args.task_id) : null;
    const reference =
      typeof args.reference === 'string' ? args.reference.trim() : '';
    if ((hasTask && taskId === null) || (!hasTask && !reference)) {
      return {
        ok: false,
        error: 'Indica task_id (número) o la referencia de la solicitud.',
        next_step:
          'Usa workflows_explain_instance para ver la solicitud y sus tareas.',
      };
    }
    const instanceId =
      taskId !== null
        ? await deps.findInstanceIdByTaskId(taskId)
        : await deps.findInstanceIdByReference(reference);
    const detail = await loadDetail(instanceId);
    if (!detail) return NOT_FOUND_REQUEST;
    if (taskId !== null) {
      const task = detail.tasks.find((t) => t.id === taskId);
      if (!task) return NOT_FOUND_REQUEST;
      if (!PENDING_TASK.includes(task.status)) {
        return { ok: false, error: 'Esa tarea ya fue atendida.' };
      }
      return { ok: true, value: { detail, task } };
    }
    if (detail.status !== 'active') {
      return {
        ok: false,
        error: `La solicitud ${detail.reference} ya no está en curso.`,
      };
    }
    const wanted =
      typeof args.stage === 'string' ? args.stage.trim().toLowerCase() : '';
    let candidates = detail.tasks.filter(
      (t) =>
        PENDING_TASK.includes(t.status) &&
        (!wanted ||
          t.stage_key.toLowerCase() === wanted ||
          (detail.stage?.key === t.stage_key &&
            detail.stage.name.toLowerCase() === wanted)),
    );
    if (candidates.length > 1) {
      const mine = candidates.filter((t) => t.can_act);
      if (mine.length > 0) candidates = mine;
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        error: `La solicitud ${detail.reference} no tiene una tarea pendiente${wanted ? ' en esa etapa' : ''}.`,
      };
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        error: `La solicitud ${detail.reference} tiene varias tareas pendientes (ids ${candidates.map((t) => t.id).join(', ')}).`,
        next_step: 'Vuelve a llamar con el task_id exacto.',
      };
    }
    return { ok: true, value: { detail, task: candidates[0] } };
  }

  const formatValue = (v: unknown): string =>
    typeof v === 'boolean'
      ? v
        ? 'Sí'
        : 'No'
      : typeof v === 'string' || typeof v === 'number'
        ? String(v)
        : (JSON.stringify(v) ?? '');

  async function planUpdateDraft(args: Record<string, any>): Promise<
    Planned<{
      def: DefinitionRef;
      diff: ReturnType<typeof diffDefinitions>;
      draft_updated_at: string | null;
      result: WorkflowValidationResult;
    }>
  > {
    if (!isObj(args.definition)) {
      return {
        ok: false,
        error: 'La definición debe ser un objeto JSON vendix.workflow/v1.',
        next_step: 'Envía la definición COMPLETA del nuevo borrador en `definition`.',
      };
    }
    const found = await resolveDefinition(args);
    if (!found.ok) return found;
    const def = found.value;
    if (def.status === 'archived') {
      return { ok: false, error: `El flujo «${def.name}» está archivado; desarchívalo antes de editarlo.` };
    }
    const result = await deps.definitions.validateDefinition(args.definition);
    if (!result.valid) {
      return {
        ok: false,
        error: `La definición no es válida (${result.errors.length} ${result.errors.length === 1 ? 'problema' : 'problemas'}); no se propone nada hasta corregirla.`,
        next_step: RETRY_STEP,
        issues: result.errors,
      };
    }
    const draft = await deps.definitions.getDraft(def.id);
    const stamp = draft.draft_updated_at
      ? new Date(draft.draft_updated_at).toISOString()
      : null;
    return {
      ok: true,
      value: {
        def,
        diff: diffDefinitions(draft.definition, args.definition),
        draft_updated_at: stamp,
        result,
      },
    };
  }

  async function planPublish(args: Record<string, any>): Promise<
    Planned<{
      def: DefinitionRef;
      nextVersion: number;
      unchanged: boolean;
      result: WorkflowValidationResult;
    }>
  > {
    const found = await resolveDefinition(args);
    if (!found.ok) return found;
    const def = found.value;
    if (def.status === 'archived') {
      return { ok: false, error: `El flujo «${def.name}» está archivado; desarchívalo antes de publicar.` };
    }
    const draft = await deps.definitions.getDraft(def.id);
    if (!draft.definition) {
      return { ok: false, error: `El flujo «${def.name}» no tiene borrador para publicar.` };
    }
    const result = await deps.definitions.validate(def.id);
    if (!result.valid) {
      return {
        ok: false,
        error: `No se puede publicar «${def.name}»: el borrador tiene ${result.errors.length} ${result.errors.length === 1 ? 'error' : 'errores'}.`,
        next_step: 'Corrígelos con workflows_update_draft y vuelve a pedir la publicación.',
        issues: result.errors,
      };
    }
    const unchanged = def.version !== null && !def.has_unpublished_changes;
    return {
      ok: true,
      value: { def, nextVersion: (def.version ?? 0) + 1, unchanged, result },
    };
  }

  async function planStart(args: Record<string, any>): Promise<
    Planned<{
      def: DefinitionRef;
      labels: Map<string, string>;
      input: {
        definitionId: number;
        title?: string;
        data?: Record<string, unknown>;
        subject?: { type: string; id: number } | null;
        locationId?: number | null;
      };
    }>
  > {
    const found = await resolveDefinition(args);
    if (!found.ok) return found;
    const def = found.value;
    if (def.status !== 'active' || def.version === null) {
      return {
        ok: false,
        error: `El flujo «${def.name}» no está publicado, así que no admite solicitudes.`,
        next_step: 'Publícalo primero con workflows_publish_definition.',
      };
    }
    if (!def.is_enabled) {
      return { ok: false, error: `El flujo «${def.name}» está apagado.` };
    }
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (title.length > 200) {
      return { ok: false, error: 'El título admite máximo 200 caracteres.' };
    }
    if (args.data !== undefined && args.data !== null && !isObj(args.data)) {
      return { ok: false, error: 'data debe ser un objeto { clave_de_campo: valor }.' };
    }
    let subject: { type: string; id: number } | null = null;
    if (args.subject !== undefined && args.subject !== null) {
      const sid = isObj(args.subject) ? toPositiveInt(args.subject.id) : null;
      if (!isObj(args.subject) || typeof args.subject.type !== 'string' || sid === null) {
        return { ok: false, error: 'subject debe ser { type, id }.' };
      }
      subject = { type: args.subject.type, id: sid };
    }
    let locationId: number | null = null;
    if (args.location_id !== undefined && args.location_id !== null) {
      locationId = toPositiveInt(args.location_id);
      if (locationId === null) {
        return { ok: false, error: 'location_id debe ser un número entero positivo.' };
      }
    }
    const labels = new Map<string, string>();
    try {
      const v = (await deps.definitions.version(def.id, def.version)) as unknown as {
        definition?: unknown;
      };
      for (const f of fieldList(v.definition)) labels.set(f.key, f.label ?? f.key);
    } catch {
      // Labels are cosmetic: the engine validates the data on start.
    }
    return {
      ok: true,
      value: {
        def,
        labels,
        input: {
          definitionId: def.id,
          ...(title ? { title } : {}),
          ...(isObj(args.data) ? { data: args.data } : {}),
          subject,
          locationId,
        },
      },
    };
  }

  async function planComplete(args: Record<string, any>): Promise<
    Planned<{
      detail: InstanceDetail;
      task: TaskRow;
      outcome: string;
      comment: string | null;
      edits: TaskValueEdit[];
    }>
  > {
    const outcome = typeof args.outcome === 'string' ? args.outcome.trim() : '';
    if (!outcome) {
      return { ok: false, error: 'Falta la decisión (outcome): approve, reject, submit o return.' };
    }
    const comment =
      typeof args.comment === 'string' && args.comment.trim()
        ? args.comment.trim()
        : null;
    if (comment && comment.length > 2000) {
      return { ok: false, error: 'El comentario admite máximo 2000 caracteres.' };
    }
    if (args.values !== undefined && args.values !== null && !isObj(args.values)) {
      return { ok: false, error: 'values debe ser un objeto { clave_de_campo: valor }.' };
    }
    const found = await resolveTask(args);
    if (!found.ok) return found;
    const { detail, task } = found.value;
    if (!detail.allowed_outcomes.includes(outcome)) {
      return {
        ok: false,
        error: `La decisión «${OUTCOME_LABEL(outcome)}» no está disponible en esta etapa.`,
        next_step: detail.allowed_outcomes.length
          ? `Decisiones disponibles: ${detail.allowed_outcomes.map(OUTCOME_LABEL).join(', ')}.`
          : 'Esta etapa no admite decisiones manuales.',
      };
    }
    const planned = plannedEdits(detail, task, args.values);
    if (!planned.ok) return planned;
    return { ok: true, value: { ...found.value, outcome, comment, edits: planned.value } };
  }

  /**
   * The request fields this decision writes: only the task's own fields are
   * accepted (anything else is refused, never dropped in silence) and only the
   * ones whose value changes are listed, so the card shows every write.
   */
  function plannedEdits(
    detail: InstanceDetail,
    task: TaskRow,
    given: unknown,
  ): Planned<TaskValueEdit[]> {
    const values = isObj(given) ? given : {};
    const fields = new Map((task.form_fields ?? []).map((f) => [f.key, f]));
    const foreign = Object.keys(values).filter((k) => !fields.has(k));
    if (foreign.length > 0) {
      const stageName = detail.stage?.key === task.stage_key ? detail.stage.name : task.stage_key;
      return {
        ok: false,
        error: `La etapa «${stageName}» no pide ${foreign.length === 1 ? 'el campo' : 'los campos'} ${foreign.join(', ')}.`,
        next_step: fields.size
          ? `Campos que pide esta etapa: ${[...fields.values()].map((f) => `${f.key} (${f.label ?? f.key})`).join(', ')}.`
          : 'Esta etapa no pide campos: atiéndela sin values.',
      };
    }
    const data = detail.data ?? {};
    return {
      ok: true,
      value: Object.entries(values)
        .filter(([key, to]) => canonical(to) !== canonical(data[key] ?? null))
        .map(([key, to]) => ({ key, field: fields.get(key)!, from: data[key] ?? null, to })),
    };
  }

  /** A field value as the person reads it: option labels for lists, Sí/No, empty as null. */
  function shownValue(field: TaskFormField, value: unknown): unknown {
    if (value === null || value === undefined || value === '') return null;
    const optionLabel = (v: unknown) =>
      field.options?.find((o) => o.value === v)?.label ?? formatValue(v);
    if (Array.isArray(value)) return value.map(optionLabel).join(', ');
    return field.options?.length ? optionLabel(value) : formatValue(value);
  }

  return [
    {
      name: 'workflows_list',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Flujos de trabajo de la tienda: hasta 50 definiciones con su estado (draft, active, archived) y la versión publicada. Úsala para encontrar el definition_id antes de validar o analizar cuellos de botella.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['draft', 'active', 'archived'],
            description: 'Filtra por estado.',
          },
          search: { type: 'string', description: 'Busca por nombre o clave.' },
        },
      },
      requiredPermissions: ['store:workflows:read'],
      discovery: {
        synonyms: [
          'flujos',
          'procesos de aprobación',
          'workflows',
          'flujos de trabajo',
        ],
        examples: [
          {
            intent: '¿Qué flujos tengo activos?',
            arguments: { status: 'active' },
          },
        ],
      },
      handler: gated(async (args) => {
        const status = ['draft', 'active', 'archived'].includes(args.status)
          ? args.status
          : undefined;
        const res = await deps.definitions.list({
          limit: MAX_LIST,
          page: 1,
          ...(status ? { status } : {}),
          ...(typeof args.search === 'string' && args.search.trim()
            ? { search: args.search.trim() }
            : {}),
        });
        return JSON.stringify({
          total: res.total,
          returned: res.data.length,
          workflows: res.data.map((d: any) => ({
            id: d.id,
            key: d.key,
            name: d.name,
            status: d.status,
            published_version: d.published_version?.version ?? null,
            has_draft: d.has_draft,
          })),
        });
      }),
    },
    {
      name: 'workflows_schema_reference',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Resumen compacto del esquema vendix.workflow/v1 + las reglas que aplica el validador + un ejemplo completo + los role_keys y group_keys REALES de la tienda. Léela SIEMPRE antes de workflows_draft_from_description: solo se pueden usar esos roles y grupos.',
      parameters: { type: 'object', properties: {} },
      requiredPermissions: ['store:workflows:design'],
      discovery: {
        synonyms: [
          'esquema de flujos',
          'roles y grupos disponibles',
          'formato del flujo',
        ],
      },
      handler: gated(async () =>
        JSON.stringify(
          schemaReference(await deps.definitions.validationContext()),
        ),
      ),
    },
    {
      name: 'workflows_validate_definition',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Valida un flujo con el validador determinista y el contexto real de la tienda (roles, grupos, usuarios). Recibe definition_id (el borrador guardado) o definition (JSON vendix.workflow/v1). Devuelve valid, errors, warnings y la lista `messages` en español: explícalos sin cambiar el veredicto. Con definition_id también devuelve `definition` (el borrador guardado completo) y `draft_updated_at`: es la base que se edita con workflows_update_draft. Tú NUNCA decides si un flujo es válido.',
      parameters: {
        type: 'object',
        properties: {
          definition_id: {
            type: 'number',
            description: 'ID del flujo cuyo borrador se valida.',
          },
          definition: {
            type: 'object',
            description:
              'Definición vendix.workflow/v1 a validar sin guardarla.',
          },
        },
      },
      requiredPermissions: ['store:workflows:design'],
      discovery: {
        synonyms: [
          'validar flujo',
          'revisar flujo',
          'errores del flujo',
          'explicar avisos',
        ],
        examples: [
          { intent: 'Valida el flujo 12', arguments: { definition_id: 12 } },
        ],
      },
      handler: gated(async (args) => {
        const id =
          args.definition_id === undefined
            ? null
            : toPositiveInt(args.definition_id);
        const hasId =
          args.definition_id !== undefined && args.definition_id !== null;
        const hasDef =
          args.definition !== undefined && args.definition !== null;
        if (
          hasId === hasDef ||
          (hasId && id === null) ||
          (hasDef && !isObj(args.definition))
        ) {
          return guidedError(
            'Indica definition_id (número) o definition (objeto), solo uno de los dos.',
          );
        }
        const result: WorkflowValidationResult = hasId
          ? await deps.definitions.validate(id as number)
          : await deps.definitions.validateDefinition(args.definition);
        // The saved draft is what workflows_update_draft replaces whole: return it.
        const draft = hasId ? await deps.definitions.getDraft(id as number) : null;
        return JSON.stringify({
          definition_id: hasId ? id : null,
          ...(draft
            ? {
                definition: draft.definition,
                draft_updated_at: draft.draft_updated_at
                  ? new Date(draft.draft_updated_at).toISOString()
                  : null,
              }
            : {}),
          valid: result.valid,
          errors: slimIssues(result.errors),
          warnings: slimIssues(result.warnings),
          messages: [
            ...result.errors.map((e) => `Error: ${issueLine(e)}`),
            ...result.warnings.map((w) => `Aviso: ${issueLine(w)}`),
          ].slice(0, MAX_ISSUES * 2),
          note: 'Veredicto del validador determinista; explica los mensajes sin reinterpretarlos.',
        });
      }),
    },
    {
      name: 'workflows_draft_from_description',
      version: '1',
      domain: DOMAIN,
      description:
        'Crea un flujo NUEVO como BORRADOR (nunca lo publica) a partir de la definición vendix.workflow/v1 que TÚ propones. Antes de llamarla lee workflows_schema_reference (roles y grupos reales, reglas y ejemplo). La herramienta valida con el contexto de la tienda: si hay errores devuelve la lista y NO propone nada; corrige y reintenta UNA sola vez. Si es válida, la persona ve las etapas, responsables, campos y avisos y confirma; el resultado trae edit_url. Publicar es siempre un clic humano en el editor.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del flujo (máx. 160).' },
          description: {
            type: 'string',
            description: 'Para qué sirve el flujo (opcional).',
          },
          definition: {
            type: 'object',
            description:
              'Definición completa vendix.workflow/v1 (schema, key, name, fields, stages…).',
          },
        },
        required: ['name', 'definition'],
      },
      requiredPermissions: ['store:workflows:design'],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'crear flujo',
          'diseñar flujo',
          'armar proceso de aprobación',
          'borrador de flujo',
        ],
        dependencies: ['workflows_schema_reference'],
      },
      preview: async (args, context): Promise<ToolPreview> => {
        const blocked = await industryError(context);
        if (blocked) {
          return {
            status: 'error',
            target: 'Nuevo flujo (borrador)',
            changes: [],
            message: blocked,
            domain: DOMAIN,
          };
        }
        try {
          return draftPreview(await planDraft(deps, args));
        } catch (error) {
          return {
            status: 'error',
            target: 'Nuevo flujo (borrador)',
            changes: [],
            message: errorMessage(error),
            domain: DOMAIN,
          };
        }
      },
      handler: gated(async (args) => {
        const plan = await planDraft(deps, args);
        if (!plan.ok) {
          return guidedError(plan.error, plan.next_step, {
            issues: slimIssues(plan.issues ?? []),
          });
        }
        const created = await deps.definitions.create({
          name: plan.name,
          description: plan.description,
          definition: plan.definition as unknown as Record<string, unknown>,
        });
        return JSON.stringify({
          id: created.id,
          key: created.key,
          status: 'draft',
          edit_url: `/admin/workflows/${created.id}/edit`,
          warnings: slimIssues(plan.warnings),
          note: 'Quedó como borrador. Para publicarlo, la persona debe abrir el editor y pulsar Publicar.',
        });
      }),
    },
    {
      name: 'workflows_explain_instance',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Resumen determinista de una solicitud de flujo: etapa actual, quién tiene la tarea, tiempo en la etapa, vencimiento, requisitos pendientes, últimos 20 eventos con fecha en la zona de la tienda y cantidad de comentarios. Recibe instance_id o reference ("FLU-000123"). Solo ve lo que la persona puede ver. Tú redactas la explicación citando los eventos por fecha.',
      parameters: {
        type: 'object',
        properties: {
          instance_id: { type: 'number', description: 'ID de la solicitud.' },
          reference: {
            type: 'string',
            description: 'Referencia, por ejemplo FLU-000123.',
          },
        },
      },
      requiredPermissions: ['store:workflows:read'],
      discovery: {
        synonyms: [
          'estado de la solicitud',
          'dónde va mi solicitud',
          'explicar solicitud',
          'quién tiene la tarea',
        ],
        examples: [
          {
            intent: '¿En qué va la solicitud FLU-000123?',
            arguments: { reference: 'FLU-000123' },
          },
        ],
      },
      handler: gated(async (args, context) => {
        let id = toPositiveInt(args.instance_id);
        if (
          id === null &&
          typeof args.reference === 'string' &&
          args.reference.trim()
        ) {
          id = await deps.findInstanceIdByReference(args.reference.trim());
        }
        if (id === null) {
          return guidedError(
            'No encontré esa solicitud.',
            'Pide el instance_id o la referencia exacta (por ejemplo FLU-000123).',
          );
        }
        let detail: any;
        try {
          detail = await deps.instances.get(id);
        } catch {
          // Not found, other store or not a participant: the same answer on purpose.
          return guidedError(
            'No encontré esa solicitud o no tienes acceso a ella.',
            'Verifica la referencia con la persona.',
          );
        }
        const tz = await deps.storeTimezone(context.store_id!);
        const now = new Date();
        const active = detail.status === 'active';
        const entered = detail.stage_entered_at
          ? new Date(detail.stage_entered_at)
          : null;
        const due = detail.stage_due_at ? new Date(detail.stage_due_at) : null;
        const stageNames = new Map<string, string>();
        if (detail.stage) stageNames.set(detail.stage.key, detail.stage.name);
        const nameOf = (key: string | null) =>
          key ? (stageNames.get(key) ?? key) : null;
        const timeline: any[] = detail.timeline ?? [];
        const recent = timeline.slice(-TIMELINE_EVENTS);
        return JSON.stringify({
          timezone: tz,
          instance_id: detail.id,
          reference: detail.reference,
          title: detail.title,
          status: detail.status,
          flow: {
            name: detail.definition?.name ?? null,
            version: detail.definition?.version ?? null,
          },
          started_by: detail.started_by?.name ?? null,
          created_at: localStamp(detail.created_at, tz),
          completed_at: localStamp(detail.completed_at, tz),
          current_stage: detail.stage
            ? {
                key: detail.stage.key,
                name: detail.stage.name,
                type: detail.stage.type,
              }
            : { key: detail.current_stage_key, name: null, type: null },
          stage_entered_at: localStamp(entered, tz),
          hours_in_stage: active && entered ? hoursBetween(entered, now) : null,
          due: {
            due_at: localStamp(due, tz),
            overdue: active && !!due && due.getTime() < now.getTime(),
            hours_overdue:
              active && due && due.getTime() < now.getTime()
                ? hoursBetween(due, now)
                : 0,
          },
          who_has_the_task: (detail.tasks ?? []).map((t: any) => ({
            kind: t.kind,
            status: t.status,
            assignee: t.assignee
              ? { type: t.assignee.type, name: t.assignee.name }
              : null,
            due_at: localStamp(t.due_at, tz),
            can_current_user_act: !!t.can_act,
          })),
          pending_requirements: (detail.pending_requirements ?? []).map(
            (r: any) => ({
              key: r.key,
              label: r.label,
            }),
          ),
          allowed_outcomes: detail.allowed_outcomes ?? [],
          timeline_total: timeline.length,
          timeline: recent.map((e: any) => ({
            seq: e.seq,
            type: e.type,
            at: localStamp(e.occurred_at, tz),
            from_stage: nameOf(e.from_stage_key),
            to_stage: nameOf(e.to_stage_key),
            actor: e.actor_name ?? e.actor_type,
            ...(typeof e.payload?.outcome === 'string'
              ? { outcome: e.payload.outcome }
              : {}),
          })),
          comments_count: (detail.comments ?? []).length,
        });
      }),
    },
    {
      name: 'workflows_bottlenecks',
      version: '1',
      domain: DOMAIN,
      readOnly: true,
      description:
        'Cuellos de botella de un flujo con métricas calculadas en el servidor a partir de los eventos: por etapa, solicitudes en curso (wip), entradas, salidas, horas promedio y p90, vencidas ahora, y la etapa cuello (mayor p90 × wip). Con menos de 20 solicitudes completadas en la ventana responde insufficient_data=true y NO hay cuello: di "Datos insuficientes". Los números salen de aquí, nunca los calcules ni los inventes; tú aportas la narrativa y sugerencias.',
      parameters: {
        type: 'object',
        properties: {
          definition_id: {
            type: 'number',
            description: 'ID del flujo (de workflows_list).',
          },
          days: {
            type: 'number',
            description: `Ventana en días (${MIN_DAYS} a ${MAX_DAYS}, por defecto ${DEFAULT_DAYS}).`,
          },
        },
        required: ['definition_id'],
      },
      requiredPermissions: ['store:workflows:read'],
      discovery: {
        synonyms: [
          'cuello de botella',
          'dónde se atascan las solicitudes',
          'tiempos por etapa',
          'etapa más lenta',
        ],
        examples: [
          {
            intent: '¿Dónde se atasca el flujo de compras?',
            arguments: { definition_id: 3 },
          },
        ],
        dependencies: ['workflows_list'],
      },
      handler: gated(async (args, context) => {
        const definitionId = toPositiveInt(args.definition_id);
        if (definitionId === null) {
          return guidedError(
            'Falta definition_id.',
            'Usa workflows_list para encontrar el flujo.',
          );
        }
        let days = DEFAULT_DAYS;
        if (args.days !== undefined && args.days !== null) {
          const d = Number(args.days);
          if (!Number.isInteger(d) || d < MIN_DAYS || d > MAX_DAYS) {
            return guidedError(
              `La ventana debe ser un número entero de días entre ${MIN_DAYS} y ${MAX_DAYS}.`,
            );
          }
          days = d;
        }
        const to = new Date();
        const from = new Date(to.getTime() - days * 86_400_000);
        const m = await deps.metrics.stageMetrics(definitionId, { from, to });
        const tz = await deps.storeTimezone(context.store_id!);
        const bottleneck = m.stages.find(
          (s) => s.stage_key === m.bottleneck_stage_key,
        );
        return JSON.stringify({
          definition_id: m.definition_id,
          window: {
            days,
            from: localStamp(from, tz),
            to: localStamp(to, tz),
            timezone: tz,
          },
          completed_instances: m.completed_instances,
          insufficient_data: m.insufficient_data,
          ...(m.insufficient_data
            ? {
                message: `Datos insuficientes: hay ${m.completed_instances} solicitudes completadas en ${days} días y se necesitan al menos 20 para calcular el cuello de botella. Se muestran solo los conteos.`,
              }
            : {}),
          bottleneck_stage_key: m.bottleneck_stage_key,
          bottleneck_stage_name: bottleneck?.name ?? null,
          stages: m.stages,
          ...(m.truncated
            ? {
                warning:
                  'El volumen superó el tope de análisis; las cifras pueden ser parciales.',
              }
            : {}),
        });
      }),
    },
    {
      name: 'workflows_update_draft',
      version: '1',
      domain: DOMAIN,
      description:
        'Reemplaza el BORRADOR de un flujo existente por la definición vendix.workflow/v1 COMPLETA que TÚ propones (no publica). Recibe definition_id o definition_key + definition. Antes lee el borrador actual con workflows_validate_definition (definition_id): devuelve `definition` completa y `draft_updated_at`; modifica esa definición y envíala entera. Los roles y grupos reales salen de workflows_schema_reference. Si la definición no es válida no propone nada: devuelve los errores para corregir. La persona ve en la tarjeta qué etapas se agregan, quitan, renombran o cambian de tipo y los campos nuevos o retirados, y confirma. Si el borrador cambió mientras tanto, falla sin sobrescribir.',
      parameters: {
        type: 'object',
        properties: {
          definition_id: { type: 'number', description: 'ID del flujo.' },
          definition_key: {
            type: 'string',
            description: 'Clave del flujo (alternativa a definition_id).',
          },
          definition: {
            type: 'object',
            description: 'Definición completa vendix.workflow/v1 del nuevo borrador.',
          },
          expected_draft_updated_at: {
            type: 'string',
            description:
              'Opcional: fecha del borrador que viste (si cambió, no se guarda).',
          },
        },
        required: ['definition'],
      },
      requiredPermissions: ['store:workflows:design'],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'modificar flujo',
          'editar borrador',
          'agregar etapa al flujo',
          'cambiar el flujo',
        ],
        dependencies: ['workflows_list', 'workflows_schema_reference'],
      },
      preview: guardedPreview(
        'Borrador del flujo',
        async (args, context) => {
          const plan = await planUpdateDraft(args);
          if (!plan.ok) return errorPreview('Borrador del flujo', plan);
          const { def, diff, draft_updated_at, result } = plan.value;
          capture(proposalKey('workflows_update_draft', context, args), draft_updated_at);
          const rows: Array<[string, string, string[]]> = [
            ['stages_added', 'Etapas que se agregan', diff.stagesAdded],
            ['stages_removed', 'Etapas que se quitan', diff.stagesRemoved],
            ['stages_renamed', 'Etapas que cambian de nombre', diff.stagesRenamed],
            ['stages_retyped', 'Etapas que cambian de tipo', diff.stagesRetyped],
            ['stages_edited', 'Etapas con otros ajustes', diff.stagesEdited],
            ['fields_added', 'Campos que se agregan', diff.fieldsAdded],
            ['fields_removed', 'Campos que se quitan', diff.fieldsRemoved],
          ];
          const changes = rows
            .filter(([, , items]) => items.length > 0)
            .map(([field, label, items]) => ({
              field,
              label,
              from: null,
              to: orNone(items),
            }));
          const notes = [
            changes.length === 0
              ? 'No hay diferencias de etapas ni campos con el borrador guardado.'
              : 'Solo reemplaza el BORRADOR; publicarlo es otro paso con su propia confirmación.',
            ...(result.warnings.length
              ? [`Avisos del validador: ${result.warnings.map(issueLine).join(' | ')}.`]
              : []),
          ];
          return {
            status: result.warnings.length ? 'warning' : 'ok',
            target: `Borrador del flujo «${def.name}»`,
            changes,
            domain: DOMAIN,
            message: notes.join(' '),
          };
        },
      ),
      handler: gated(async (args, context) => {
        const plan = await planUpdateDraft(args);
        if (!plan.ok) return guidedError(plan.error, plan.next_step, { issues: slimIssues(plan.issues ?? []) });
        const { def, draft_updated_at } = plan.value;
        const explicit =
          typeof args.expected_draft_updated_at === 'string' &&
          args.expected_draft_updated_at.trim()
            ? args.expected_draft_updated_at.trim()
            : null;
        const seen = recall(proposalKey('workflows_update_draft', context, args));
        const expected = explicit ?? (seen ? seen.value : draft_updated_at);
        const saved = await deps.definitions.saveDraft(def.id, {
          definition: args.definition,
          ...(expected ? { expected_draft_updated_at: String(expected) } : {}),
        });
        return JSON.stringify({
          id: def.id,
          key: def.key,
          status: 'draft_saved',
          draft_updated_at: saved.draft_updated_at,
          edit_url: `/admin/workflows/${def.id}/edit`,
          message: `Borrador de «${def.name}» actualizado. Sigue sin publicarse: para publicarlo usa workflows_publish_definition.`,
        });
      }),
    },
    {
      name: 'workflows_publish_definition',
      version: '1',
      domain: DOMAIN,
      description:
        'Publica el borrador de un flujo como una nueva versión (el mismo botón Publicar del editor). Recibe definition_id o definition_key. Valida con el contexto real de la tienda y se niega si el borrador no es válido. La persona ve «Publicar «Nombre» como versión N» y confirma. Sin publicar no se pueden iniciar solicitudes.',
      parameters: {
        type: 'object',
        properties: {
          definition_id: { type: 'number', description: 'ID del flujo.' },
          definition_key: {
            type: 'string',
            description: 'Clave del flujo (alternativa a definition_id).',
          },
          changelog: {
            type: 'string',
            description: 'Nota opcional de qué cambió en esta versión.',
          },
        },
      },
      requiredPermissions: ['store:workflows:design'],
      requiresConfirmation: true,
      discovery: {
        synonyms: ['publicar flujo', 'activar flujo', 'sacar nueva versión del flujo'],
        dependencies: ['workflows_list'],
      },
      preview: guardedPreview('Publicar flujo', async (args) => {
        const plan = await planPublish(args);
        if (!plan.ok) return errorPreview('Publicar flujo', plan);
        const { def, nextVersion, result, unchanged } = plan.value;
        return {
          status: unchanged || result.warnings.length ? 'warning' : 'ok',
          target: `Publicar «${def.name}» como versión ${nextVersion}`,
          changes: [
            { field: 'name', label: 'Flujo', from: null, to: def.name },
            {
              field: 'version',
              label: 'Versión',
              from: def.version,
              to: unchanged ? def.version : nextVersion,
            },
          ],
          domain: DOMAIN,
          message: [
            unchanged
              ? 'El borrador es igual a la versión publicada: no se creará una versión nueva.'
              : 'Las solicitudes nuevas usarán esta versión; las que ya están en curso conservan la suya.',
            ...(result.warnings.length
              ? [`Avisos del validador: ${result.warnings.map(issueLine).join(' | ')}.`]
              : []),
          ].join(' '),
        };
      }),
      handler: gated(async (args) => {
        const plan = await planPublish(args);
        if (!plan.ok) return guidedError(plan.error, plan.next_step, { issues: slimIssues(plan.issues ?? []) });
        const { def } = plan.value;
        const changelog =
          typeof args.changelog === 'string' && args.changelog.trim()
            ? args.changelog.trim().slice(0, 500)
            : null;
        const res = await deps.definitions.publish(def.id, { changelog });
        const version = (res.version as { version?: number } | undefined)?.version ?? null;
        return JSON.stringify({
          id: def.id,
          key: def.key,
          status: 'active',
          version,
          unchanged: res.unchanged === true,
          warnings: slimIssues(res.warnings ?? []),
          message: res.unchanged
            ? `«${def.name}» ya estaba publicado con este contenido (versión ${version}); no se creó una versión nueva.`
            : `«${def.name}» publicado como versión ${version}. Ya se pueden iniciar solicitudes.`,
        });
      }),
    },
    {
      name: 'workflows_start_instance',
      version: '1',
      domain: DOMAIN,
      description:
        'Inicia una solicitud nueva de un flujo PUBLICADO (mismo servicio que el botón Nueva solicitud). Recibe definition_id o definition_key, title opcional y data con los valores de los campos del formulario inicial (usa las claves de los campos). La persona ve el flujo, el título y los datos con sus etiquetas y confirma; el resultado trae la referencia (FLU-…) y el enlace a la solicitud.',
      parameters: {
        type: 'object',
        properties: {
          definition_id: { type: 'number', description: 'ID del flujo publicado.' },
          definition_key: {
            type: 'string',
            description: 'Clave del flujo (alternativa a definition_id).',
          },
          title: { type: 'string', description: 'Título de la solicitud (máx. 200).' },
          data: {
            type: 'object',
            description: 'Valores de los campos del formulario inicial, por clave de campo.',
          },
          subject: {
            type: 'object',
            description: 'Registro asociado opcional: { type, id }.',
          },
          location_id: { type: 'number', description: 'Sede de la solicitud (opcional).' },
        },
      },
      requiredPermissions: ['store:workflows:start'],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'iniciar solicitud',
          'lanzar flujo',
          'crear solicitud',
          'radicar solicitud',
        ],
        dependencies: ['workflows_list'],
      },
      preview: guardedPreview('Nueva solicitud', async (args) => {
        const plan = await planStart(args);
        if (!plan.ok) return errorPreview('Nueva solicitud', plan);
        const { def, input, labels } = plan.value;
        const data = input.data ?? {};
        return {
          status: 'ok',
          target: `Nueva solicitud de «${def.name}»`,
          changes: [
            { field: 'flow', label: 'Flujo', from: null, to: def.name },
            ...(input.title
              ? [{ field: 'title', label: 'Título', from: null, to: input.title }]
              : []),
            ...Object.entries(data).map(([k, v]) => ({
              field: `data:${k}`,
              label: labels.get(k) ?? k,
              from: null,
              to: formatValue(v),
            })),
          ],
          domain: DOMAIN,
          message:
            'Nace una solicitud en la primera etapa del flujo y se notifica a quien corresponda.',
        };
      }),
      handler: gated(async (args) => {
        const plan = await planStart(args);
        if (!plan.ok) return guidedError(plan.error, plan.next_step);
        const { def, input } = plan.value;
        const res = await deps.engine.start({
          ...input,
          idempotencyKey: `vex-start-${randomUUID()}`,
        });
        return JSON.stringify({
          instance_id: res.instance.id,
          reference: res.instance.reference,
          status: res.instance.status,
          url: INSTANCE_URL(res.instance.id),
          message: `Solicitud ${res.instance.reference} creada en «${def.name}». Puedes verla en ${INSTANCE_URL(res.instance.id)}.`,
        });
      }),
    },
    {
      name: 'workflows_complete_task',
      version: '1',
      domain: DOMAIN,
      description:
        'Atiende la tarea pendiente de una solicitud con una decisión (mismo servicio que el botón de la bandeja). Recibe task_id, o la referencia de la solicitud (reference, por ejemplo FLU-000123) y opcionalmente stage. outcome: approve, reject, submit o return; comment y values son opcionales: values solo admite las claves de los campos que pide la etapa (otra clave se rechaza); el formulario parte de los datos actuales de la solicitud, como en pantalla, y values los reemplaza. Solo puede hacerlo quien es responsable de la tarea; si no, se niega igual que en pantalla. La persona ve la solicitud, la etapa, la decisión, el comentario y cada campo que cambia con su valor actual y el nuevo, y confirma.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'number', description: 'ID de la tarea.' },
          reference: {
            type: 'string',
            description: 'Referencia de la solicitud (alternativa a task_id).',
          },
          stage: {
            type: 'string',
            description: 'Clave o nombre de la etapa (con reference, si hay varias tareas).',
          },
          outcome: {
            type: 'string',
            description: 'Decisión: approve, reject, submit o return.',
          },
          comment: { type: 'string', description: 'Comentario (máx. 2000).' },
          values: {
            type: 'object',
            description: 'Valores de los campos que pide la etapa, por clave.',
          },
          expected_row_version: {
            type: 'number',
            description: 'Opcional: versión de la solicitud que viste (si cambió, falla).',
          },
        },
        required: ['outcome'],
      },
      requiredPermissions: ['store:workflows:task'],
      requiresConfirmation: true,
      discovery: {
        synonyms: [
          'aprobar tarea',
          'rechazar solicitud',
          'atender tarea',
          'completar tarea del flujo',
        ],
        examples: [
          {
            intent: 'Aprueba la solicitud FLU-000123',
            arguments: { reference: 'FLU-000123', outcome: 'approve' },
          },
        ],
        dependencies: ['workflows_explain_instance'],
      },
      preview: guardedPreview('Tarea de flujo', async (args, context) => {
        const plan = await planComplete(args);
        if (!plan.ok) return errorPreview('Tarea de flujo', plan);
        const { detail, task, outcome, comment, edits } = plan.value;
        capture(proposalKey('workflows_complete_task', context, args), detail.row_version);
        const stageName = detail.stage?.name ?? task.stage_key;
        return {
          status: task.can_act ? 'ok' : 'warning',
          target: `Solicitud ${detail.reference} · ${stageName}`,
          changes: [
            { field: 'request', label: 'Solicitud', from: null, to: `${detail.reference}${detail.title ? ` · ${detail.title}` : ''}` },
            { field: 'stage', label: 'Etapa', from: null, to: stageName },
            { field: 'outcome', label: 'Decisión', from: null, to: OUTCOME_LABEL(outcome) },
            ...edits.map((e) => ({
              field: `data:${e.key}`,
              label: e.field.label ?? e.key,
              from: shownValue(e.field, e.from),
              to: shownValue(e.field, e.to),
            })),
            ...(comment ? [{ field: 'comment', label: 'Comentario', from: null, to: comment }] : []),
          ],
          domain: DOMAIN,
          message: [
            task.can_act
              ? 'La decisión mueve la solicitud según el flujo y no se puede deshacer desde aquí.'
              : 'Aviso: no figuras como responsable de esta tarea; si no puedes atenderla, se negará igual que en pantalla.',
            ...(edits.length
              ? [`También cambia ${edits.length === 1 ? 'un campo' : `${edits.length} campos`} de la solicitud: revisa el valor actual y el nuevo.`]
              : []),
          ].join(' '),
        };
      }),
      handler: gated(async (args, context) => {
        const plan = await planComplete(args);
        if (!plan.ok) return guidedError(plan.error, plan.next_step);
        const { detail, task, outcome, comment } = plan.value;
        const explicit = args.expected_row_version === undefined || args.expected_row_version === null
          ? null
          : Number(args.expected_row_version);
        if (explicit !== null && (!Number.isInteger(explicit) || explicit < 0)) {
          return guidedError('expected_row_version debe ser un entero mayor o igual a 0.');
        }
        const seen = recall(proposalKey('workflows_complete_task', context, args));
        const expectedRowVersion =
          explicit ?? (typeof seen?.value === 'number' ? seen.value : detail.row_version);
        const values = taskFormValues(detail, task, args.values);
        const res = await deps.engine.completeTask({
          taskId: task.id,
          outcome,
          ...(Object.keys(values).length ? { values } : {}),
          comment,
          expectedRowVersion,
          idempotencyKey: `vex-task-${task.id}-${outcome}-${expectedRowVersion}`,
        });
        const after = await loadDetail(res.instance.id);
        const where = after?.stage
          ? `Ahora está en «${after.stage.name}».`
          : res.instance.status === 'active'
            ? 'La solicitud sigue en curso.'
            : `La solicitud quedó en estado «${res.instance.status}».`;
        return JSON.stringify({
          instance_id: res.instance.id,
          reference: res.instance.reference,
          task_id: task.id,
          outcome,
          advanced: res.advanced,
          replayed: res.replayed,
          status: res.instance.status,
          url: INSTANCE_URL(res.instance.id),
          message: `Tarea de ${res.instance.reference} atendida: ${OUTCOME_LABEL(outcome)}. ${where}`,
        });
      }),
    },
  ];
}
