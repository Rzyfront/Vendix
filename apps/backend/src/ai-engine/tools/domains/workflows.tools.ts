import {
  OPS_BY_FIELD_TYPE,
  STAGE_OUTCOMES,
  WORKFLOW_ACTIONS,
  WORKFLOW_END_OUTCOMES,
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
import type { WorkflowDefinitionsService } from '../../../domains/store/workflows/definitions/workflow-definitions.service';
import type { WorkflowInstancesService } from '../../../domains/store/workflows/instances/workflow-instances.service';
import type { WorkflowMetricsService } from '../../../domains/store/workflows/metrics/workflow-metrics.service';

export interface WorkflowsToolDeps {
  definitions: Pick<
    WorkflowDefinitionsService,
    'list' | 'create' | 'validate' | 'validateDefinition' | 'validationContext'
  >;
  /** `get` applies the participation rule of the caller (cross-store / non-participant = not found). */
  instances: Pick<WorkflowInstancesService, 'get'>;
  metrics: Pick<WorkflowMetricsService, 'stageMetrics'>;
  /** Instance id of the current store by its reference ("FLU-000123"), or null. */
  findInstanceIdByReference: (reference: string) => Promise<number | null>;
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
  end: 'Fin',
};

const OUTCOME_ES: Record<string, string> = {
  submit: 'Enviar',
  approve: 'Aprobar',
  reject: 'Rechazar',
  return: 'Devolver',
  auto: 'Automático',
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
      '{ key, name, type, start?, outcome? (end), assignee?, quorum?, form?: {fields:[keys]}, requirements?, transitions?: [{to,on,when?,require_comment?,label?}], due?: {hours,on_overdue?}, on_enter?, on_exit? }',
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

// ─── Tools ───────────────────────────────────────────────────────────────

/**
 * Block 11 — AI tools for Flujos (design §7.1–§7.5).
 *
 * The validator, the timeline and the SQL-derived metrics are deterministic;
 * the model only proposes JSON and narrates. Nothing here publishes, forces a
 * transition, cancels, deletes, or touches public links / API keys. The only
 * write (`workflows_draft_from_description`) goes through propose → confirm →
 * execute and creates a DRAFT.
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
        'Valida un flujo con el validador determinista y el contexto real de la tienda (roles, grupos, usuarios). Recibe definition_id (el borrador guardado) o definition (JSON vendix.workflow/v1). Devuelve valid, errors, warnings y la lista `messages` en español: explícalos sin cambiar el veredicto. Tú NUNCA decides si un flujo es válido.',
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
        return JSON.stringify({
          definition_id: hasId ? id : null,
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
  ];
}
