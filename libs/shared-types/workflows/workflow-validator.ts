/**
 * vendix.workflow/v1 — pure, total validator (never throws).
 *
 * Copied byte for byte into libs/shared-types/workflows/ (canonical),
 * apps/backend/src/common/workflows/contract/ and
 * apps/frontend/src/app/shared/workflows/contract/. Parity is enforced by
 * workflow-contract.parity.spec.ts (backend). Messages are user-facing Spanish.
 */
import { WORKFLOW_TOKEN_PATTERN } from "./workflow-runtime";
import { isWaitTime, parseCron, parseExpression } from "./workflow-expression";
import {
  HUMAN_STAGE_TYPES,
  OPS_BY_FIELD_TYPE,
  STAGE_OUTCOMES,
  VALUELESS_OPS,
  WORKFLOW_ACTIONS,
  WORKFLOW_CONDITION_OPS,
  WORKFLOW_END_OUTCOMES,
  WORKFLOW_EVENT_TOKENS,
  WORKFLOW_INSTANCE_TOKENS,
  WORKFLOW_TRIGGER_EVENTS,
  WORKFLOW_VENDIX_ACTIONS,
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_GATE_OPERATIONS,
  WORKFLOW_GATE_OPERATION_KEYS,
  WORKFLOW_VENDIX_ACTION_MAP_KEYS,
  WorkflowActionInputSpec,
  WorkflowGateOperation,
  WorkflowTriggerEvent,
  gateOperationTokens,
  WorkflowVendixActionName,
  WORKFLOW_FIELD_TYPES,
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_LIMITS,
  WORKFLOW_REQUIREMENT_KINDS,
  WORKFLOW_SCHEMA_V1,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_SUBJECT_TYPES,
  WORKFLOW_WAIT_KINDS,
  WORKFLOW_ERROR_THEN,
  WORKFLOW_AI_TASKS,
  WORKFLOW_AI_OUTPUT_TYPES,
  WORKFLOW_AI_FORBIDDEN_INPUT_TYPES,
  WorkflowAiTask,
  SYSTEM_STAGE_TYPES,
  WorkflowFieldType,
  WORKFLOW_EMAIL_TOKENS,
  WORKFLOW_HTTP_OUTPUT_PATH,
  WORKFLOW_RECORD_TOKENS,
  WORKFLOW_SECRET_INPUTS,
  WORKFLOW_SECRET_NAME_PATTERN,
  WORKFLOW_KEY_PATTERN as RECORD_KEY_PATTERN,
} from "./workflow-contract";

export const WORKFLOW_ISSUE_CODES = [
  "SHAPE_INVALID",
  "SCHEMA_MISMATCH",
  "KEY_INVALID",
  "DUPLICATE_KEY",
  "LIMIT_EXCEEDED",
  "START_COUNT",
  "END_MISSING",
  "UNREACHABLE_STAGE",
  "DEAD_END",
  "TRANSITION_TARGET_UNKNOWN",
  "OUTCOME_INVALID",
  "END_HAS_TRANSITIONS",
  "END_OUTCOME_MISSING",
  "DEFAULT_BRANCH_MISSING",
  "DEFAULT_BRANCH_NOT_LAST",
  "AUTOMATIC_LOOP",
  "ASSIGNEE_MISSING",
  "ASSIGNEE_NOT_ALLOWED",
  "ROLE_UNKNOWN",
  "GROUP_UNKNOWN",
  "USER_UNKNOWN",
  "FIELD_UNKNOWN",
  "FIELD_TYPE_MISMATCH",
  "CONDITION_OP_INVALID",
  "CONDITION_VALUE_INVALID",
  "CONDITION_TOO_DEEP",
  "QUORUM_INVALID",
  "ACTION_UNKNOWN",
  "REQUIREMENT_INVALID",
  "TEMPLATE_NOT_PUBLISHED",
  "OUTCOME_UNREACHABLE",
  "TOKEN_UNKNOWN",
  "EVENT_UNKNOWN",
  "MAP_INVALID",
  "GATE_OPERATION_UNKNOWN",
  "GATE_END_MISSING",
  "VISIBILITY_CYCLE",
  "PARALLEL_INVALID",
  "SUBFLOW_INVALID",
  "WAIT_INVALID",
  "LOOP_LIMIT_MISSING",
  "GUARD_INVALID",
  "EXPRESSION_INVALID",
  "COMPUTE_CYCLE",
  "SCHEDULE_INVALID",
  "ERROR_POLICY_INVALID",
  "TRIGGER_INVALID",
  "HTTP_OUTPUT_INVALID",
  "SECRET_UNKNOWN",
  "FORM_STEPS_INVALID",
  "COLLECTION_UNKNOWN",
  "AI_STEP_INVALID",
] as const;

export type WorkflowIssueCode = (typeof WORKFLOW_ISSUE_CODES)[number];

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** JSON-pointer-like, e.g. stages[2].transitions[0].to */
  path: string;
  message: string;
  stage_key?: string;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowIssue[];
  warnings: WorkflowIssue[];
}

export interface WorkflowValidationContext {
  roleKeys?: readonly string[];
  /** Groups with at least one available member. */
  groupKeys?: readonly string[];
  userIds?: readonly number[];
  /** Undefined is treated as [] (fail closed). */
  publishedTemplateKeys?: readonly string[];
  /**
   * P2.2: keys of the store's flows a subflow may launch. Undefined skips the
   * check (the editor without a store); the server always passes it.
   */
  flowKeys?: readonly string[];
  /**
   * P3.6: the store's custom collections and their fields. Undefined skips
   * the check (the editor without a store); the server always passes it.
   */
  collections?: Readonly<
    Record<string, readonly { key: string; type: string }[]>
  >;
  /**
   * P3.2: names of the store's secrets. Undefined skips the check; the server
   * passes it on publish.
   */
  secretNames?: readonly string[];
}

type Json = Record<string, unknown>;
type FieldMap = Map<
  string,
  { type: WorkflowFieldType; options?: readonly string[]; computed?: boolean }
>;

const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNonEmptyStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v);
const isIsoDate = (v: unknown): boolean => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
};

class Collector {
  errors: WorkflowIssue[] = [];
  warnings: WorkflowIssue[] = [];
  /** Stage keys of the definition (error-policy routes check against them). */
  stageKeys = new Set<string>();
  /** Key of the definition (a subflow may not launch its own flow). */
  flowKey = "";
  err(
    code: WorkflowIssueCode,
    path: string,
    message: string,
    stage_key?: string,
  ) {
    this.errors.push(
      stage_key ? { code, path, message, stage_key } : { code, path, message },
    );
  }
  warn(
    code: WorkflowIssueCode,
    path: string,
    message: string,
    stage_key?: string,
  ) {
    this.warnings.push(
      stage_key ? { code, path, message, stage_key } : { code, path, message },
    );
  }
}

function checkKeys(
  c: Collector,
  o: Json,
  allowed: readonly string[],
  path: string,
  stageKey?: string,
) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) {
      c.err(
        "SHAPE_INVALID",
        path ? `${path}.${k}` : k,
        `La propiedad "${k}" no es válida en este lugar.`,
        stageKey,
      );
    }
  }
}

function checkAccept(
  c: Collector,
  v: unknown,
  path: string,
  stageKey?: string,
) {
  if (v === undefined) return;
  if (
    !Array.isArray(v) ||
    !v.every((x) => isNonEmptyStr(x) && /^[\w.+-]+\/(\*|[\w.+-]+)$/.test(x))
  ) {
    c.err(
      "SHAPE_INVALID",
      path,
      'Los tipos de archivo aceptados deben ser tipos MIME como "application/pdf" o "image/*".',
      stageKey,
    );
  }
}

function checkMaxSize(
  c: Collector,
  v: unknown,
  path: string,
  stageKey?: string,
) {
  if (v === undefined) return;
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < 1 ||
    v > WORKFLOW_LIMITS.maxFileSizeMb
  ) {
    c.err(
      "SHAPE_INVALID",
      path,
      `El tamaño máximo debe estar entre 1 y ${WORKFLOW_LIMITS.maxFileSizeMb} MB.`,
      stageKey,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

interface CondCtx {
  c: Collector;
  fields: FieldMap;
  selfKey?: string;
  label: string;
  stageKey?: string;
  rules: number;
  tooDeepReported: boolean;
}

function checkCondition(
  group: unknown,
  path: string,
  depth: number,
  cc: CondCtx,
) {
  if (!isObj(group)) {
    cc.c.err(
      "SHAPE_INVALID",
      path,
      `${cc.label}: la condición no es válida.`,
      cc.stageKey,
    );
    return;
  }
  if (depth > WORKFLOW_LIMITS.maxConditionDepth) {
    if (!cc.tooDeepReported) {
      cc.tooDeepReported = true;
      cc.c.err(
        "CONDITION_TOO_DEEP",
        path,
        `${cc.label}: la condición tiene más de ${WORKFLOW_LIMITS.maxConditionDepth} niveles de anidación.`,
        cc.stageKey,
      );
    }
    return;
  }
  const kind = "all" in group ? "all" : "any" in group ? "any" : null;
  if (
    !kind ||
    Object.keys(group).length !== 1 ||
    !Array.isArray(group[kind]) ||
    (group[kind] as unknown[]).length === 0
  ) {
    cc.c.err(
      "SHAPE_INVALID",
      path,
      `${cc.label}: la condición debe ser un grupo "all" o "any" con al menos una regla.`,
      cc.stageKey,
    );
    return;
  }
  (group[kind] as unknown[]).forEach((node, i) => {
    const p = `${path}.${kind}[${i}]`;
    if (isObj(node) && ("all" in node || "any" in node)) {
      checkCondition(node, p, depth + 1, cc);
    } else {
      checkRule(node, p, cc);
    }
  });
}

function checkRule(rule: unknown, path: string, cc: CondCtx) {
  const { c, label, stageKey } = cc;
  if (!isObj(rule)) {
    c.err(
      "SHAPE_INVALID",
      path,
      `${label}: una regla de la condición no es válida.`,
      stageKey,
    );
    return;
  }
  cc.rules++;
  if (cc.rules === WORKFLOW_LIMITS.maxConditionRules + 1) {
    c.err(
      "LIMIT_EXCEEDED",
      path,
      `${label}: la condición supera el máximo de ${WORKFLOW_LIMITS.maxConditionRules} reglas.`,
      stageKey,
    );
  }
  checkKeys(c, rule, ["field", "op", "value"], path, stageKey);
  const fieldKey = rule["field"];
  if (!isStr(fieldKey) || !cc.fields.has(fieldKey) || fieldKey === cc.selfKey) {
    c.err(
      "FIELD_UNKNOWN",
      `${path}.field`,
      isStr(fieldKey) && fieldKey === cc.selfKey
        ? `${label}: un campo no puede depender de sí mismo ("${fieldKey}").`
        : `${label}: la condición usa el campo "${String(fieldKey)}", que no está declarado.`,
      stageKey,
    );
    return;
  }
  const type = cc.fields.get(fieldKey)!.type;
  const op = rule["op"];
  if (
    !isStr(op) ||
    !(WORKFLOW_CONDITION_OPS as readonly string[]).includes(op)
  ) {
    c.err(
      "CONDITION_OP_INVALID",
      `${path}.op`,
      `${label}: el operador "${String(op)}" no existe.`,
      stageKey,
    );
    return;
  }
  if (!(OPS_BY_FIELD_TYPE[type] as readonly string[]).includes(op)) {
    c.err(
      "CONDITION_OP_INVALID",
      `${path}.op`,
      `${label}: el operador "${op}" no se puede usar con el campo "${fieldKey}" (tipo ${type}).`,
      stageKey,
    );
    return;
  }
  const value = rule["value"];
  const bad = (why: string) =>
    c.err(
      "CONDITION_VALUE_INVALID",
      `${path}.value`,
      `${label}: el valor de la condición sobre "${fieldKey}" ${why}.`,
      stageKey,
    );
  if ((VALUELESS_OPS as readonly string[]).includes(op)) {
    if (value !== undefined) bad(`no debe indicarse con el operador "${op}"`);
    return;
  }
  if (value === undefined) {
    bad(`es obligatorio con el operador "${op}"`);
    return;
  }
  const options = cc.fields.get(fieldKey)!.options;
  const outsideOptions = (x: unknown) =>
    options !== undefined && !options.includes(String(x));
  if (op === "in" || op === "not_in") {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every(
        (x) => isStr(x) || (typeof x === "number" && Number.isFinite(x)),
      )
    ) {
      bad("debe ser una lista de textos o números");
    } else if (value.some(outsideOptions)) {
      bad("usa una opción que el campo no tiene");
    }
    return;
  }
  if (type === "number" || type === "money") {
    if (typeof value !== "number" || !Number.isFinite(value))
      bad("debe ser un número");
  } else if (type === "date") {
    if (!isIsoDate(value)) bad("debe ser una fecha AAAA-MM-DD");
  } else if (type === "user") {
    if (typeof value !== "number" || !Number.isInteger(value))
      bad("debe ser el id numérico de un usuario");
  } else if (!isStr(value)) {
    bad("debe ser un texto");
  } else if (outsideOptions(value)) {
    bad("usa una opción que el campo no tiene");
  }
}

/** Keys of the fields a condition reads, however nested. */
function conditionFieldKeys(group: unknown, out = new Set<string>()): Set<string> {
  if (!isObj(group)) return out;
  if (isStr(group["field"])) out.add(group["field"]);
  for (const kind of ["all", "any"]) {
    const nodes = group[kind];
    if (Array.isArray(nodes)) nodes.forEach((n) => conditionFieldKeys(n, out));
  }
  return out;
}

/** A field hidden by a field hidden by itself never shows: one error per cycle. */
function checkVisibilityCycles(
  c: Collector,
  fields: ReadonlyArray<{ f: Json; i: number }>,
) {
  const reads = new Map(
    fields.map(({ f }) => [
      f["key"] as string,
      conditionFieldKeys(f["visible_when"]),
    ]),
  );
  const indexOf = new Map(fields.map(({ f, i }) => [f["key"] as string, i]));
  const done = new Set<string>();
  const visit = (key: string, trail: string[]) => {
    const at = trail.indexOf(key);
    if (at >= 0) {
      const cycle = trail.slice(at);
      c.err(
        "VISIBILITY_CYCLE",
        `fields[${indexOf.get(key)}].visible_when`,
        `Los campos ${cycle.map((k) => `"${k}"`).join(", ")} dependen entre sí para mostrarse: ninguno aparecería nunca.`,
      );
      return;
    }
    if (done.has(key)) return;
    for (const next of reads.get(key) ?? []) {
      if (reads.has(next)) visit(next, [...trail, key]);
    }
    done.add(key);
  };
  for (const key of reads.keys()) visit(key, []);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

export function validateWorkflowDefinition(
  input: unknown,
  ctx: WorkflowValidationContext = {},
): WorkflowValidationResult {
  const c = new Collector();
  try {
    run(input, ctx ?? {}, c);
  } catch {
    c.err(
      "SHAPE_INVALID",
      "",
      "La definición del flujo no se pudo analizar: tiene una estructura inválida.",
    );
  }
  return {
    valid: c.errors.length === 0,
    errors: c.errors,
    warnings: c.warnings,
  };
}

function run(input: unknown, ctx: WorkflowValidationContext, c: Collector) {
  if (!isObj(input)) {
    c.err(
      "SHAPE_INVALID",
      "",
      "La definición del flujo debe ser un objeto JSON.",
    );
    return;
  }
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    c.err("SHAPE_INVALID", "", "La definición del flujo no es JSON válido.");
    return;
  }
  if (bytes > WORKFLOW_LIMITS.maxJsonBytes) {
    c.err(
      "LIMIT_EXCEEDED",
      "",
      `La definición pesa ${Math.ceil(bytes / 1024)} KB y el máximo es ${WORKFLOW_LIMITS.maxJsonBytes / 1024} KB.`,
    );
    return;
  }

  checkKeys(
    c,
    input,
    [
      "schema",
      "key",
      "name",
      "description",
      "subject",
      "fields",
      "stages",
      "triggers",
      "governs",
      "start_roles",
    ],
    "",
  );
  if (input["schema"] !== WORKFLOW_SCHEMA_V1) {
    c.err(
      "SCHEMA_MISMATCH",
      "schema",
      `El esquema debe ser "${WORKFLOW_SCHEMA_V1}".`,
    );
  }
  if (!isStr(input["key"]) || !WORKFLOW_KEY_PATTERN.test(input["key"])) {
    c.err(
      "KEY_INVALID",
      "key",
      'La clave del flujo debe empezar con una letra minúscula y usar solo minúsculas, números, "_" o "-" (máximo 80).',
    );
  }
  if (!isNonEmptyStr(input["name"]) || input["name"].length > 200) {
    c.err(
      "SHAPE_INVALID",
      "name",
      "El flujo necesita un nombre de hasta 200 caracteres.",
    );
  }
  if (
    input["description"] !== undefined &&
    (!isStr(input["description"]) || input["description"].length > 2000)
  ) {
    c.err(
      "SHAPE_INVALID",
      "description",
      "La descripción debe ser texto de hasta 2000 caracteres.",
    );
  }
  if (input["subject"] !== undefined) {
    const s = input["subject"];
    if (
      !isObj(s) ||
      !(WORKFLOW_SUBJECT_TYPES as readonly unknown[]).includes(s["type"])
    ) {
      c.err(
        "SHAPE_INVALID",
        "subject.type",
        `El sujeto debe ser uno de: ${WORKFLOW_SUBJECT_TYPES.join(", ")}.`,
      );
    } else {
      checkKeys(c, s, ["type", "collection"], "subject");
      checkSubjectCollection(s, ctx, c);
    }
  }
  if (input["triggers"] !== undefined) {
    if (
      !Array.isArray(input["triggers"]) ||
      !input["triggers"].every(
        (t) =>
          isObj(t) &&
          (t["kind"] === "manual"
            ? Object.keys(t).length === 1
            : t["kind"] === "event"
              ? Object.keys(t).every(
                  (k) => k === "kind" || k === "event" || k === "map",
                )
              : t["kind"] === "schedule"
                ? Object.keys(t).every((k) => k === "kind" || k === "cron") &&
                  isStr(t["cron"])
                : t["kind"] === "webhook"
                  ? Object.keys(t).length === 1
                  : t["kind"] === "email"
                    ? Object.keys(t).every((k) => k === "kind" || k === "map")
                    : t["kind"] === "record_date"
                      ? Object.keys(t).every(
                          (k) =>
                            k === "kind" ||
                            k === "field" ||
                            k === "days_before" ||
                            k === "map",
                        )
                      : t["kind"] === "public_form" &&
                        Object.keys(t).every(
                          (k) => k === "kind" || k === "stage",
                        ) &&
                        (t["stage"] === undefined || isStr(t["stage"]))),
      )
    ) {
      c.err(
        "SHAPE_INVALID",
        "triggers",
        'Los disparadores permitidos son {"kind":"manual"}, {"kind":"public_form"}, {"kind":"event"}, {"kind":"schedule","cron":"…"}, {"kind":"webhook"}, {"kind":"email"} y {"kind":"record_date","field":"…","days_before":N}.',
      );
    } else {
      for (const kind of ["public_form", "webhook", "email"]) {
        if (input["triggers"].filter((t) => t["kind"] === kind).length > 1) {
          c.err(
            "SHAPE_INVALID",
            "triggers",
            kind === "public_form"
              ? "Solo puede haber un disparador de formulario público."
              : kind === "webhook"
                ? "Solo puede haber un disparador de webhook de entrada."
                : "Solo puede haber un disparador de correo entrante.",
          );
        }
      }
    }
  }
  if (input["start_roles"] !== undefined) {
    if (
      !Array.isArray(input["start_roles"]) ||
      !input["start_roles"].every(isNonEmptyStr)
    ) {
      c.err(
        "SHAPE_INVALID",
        "start_roles",
        "Los roles que pueden iniciar el flujo deben ser una lista de textos.",
      );
    } else if (ctx.roleKeys) {
      input["start_roles"].forEach((r: string, i: number) => {
        if (!ctx.roleKeys!.includes(r)) {
          c.err(
            "ROLE_UNKNOWN",
            `start_roles[${i}]`,
            `El rol "${r}" que puede iniciar el flujo no existe en la tienda.`,
          );
        }
      });
    }
  }

  c.flowKey = isStr(input["key"]) ? input["key"] : "";
  const fields = checkFields(input["fields"], c);
  const stages = checkStages(input["stages"], fields, ctx, c);
  checkGraph(stages, c);
  checkPublicFormTrigger(input, c);
  checkEventTriggers(input, fields, c);
  checkScheduleTriggers(input, c);
  checkExternalTriggers(input, fields, ctx, c);
  checkGoverns(input, fields, c);
}

/** P3.6: `subject.collection` names a collection, only for `custom_record`. */
function checkSubjectCollection(
  s: Json,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  const collection = s["collection"];
  if (s["type"] !== "custom_record") {
    if (collection !== undefined) {
      c.err(
        "SHAPE_INVALID",
        "subject.collection",
        "Solo un flujo sobre un registro personalizado indica su colección.",
      );
    }
    return;
  }
  if (!isStr(collection) || !RECORD_KEY_PATTERN.test(collection)) {
    c.err(
      "COLLECTION_UNKNOWN",
      "subject.collection",
      "Un flujo sobre un registro personalizado necesita la clave de su colección.",
    );
    return;
  }
  if (ctx.collections && !ctx.collections[collection]) {
    c.err(
      "COLLECTION_UNKNOWN",
      "subject.collection",
      `La colección "${collection}" no existe en la tienda.`,
    );
  }
}

/**
 * P3.1 / P3.3 / P3.6: webhook, email and record-date triggers start as
 * `system` (nobody "initiates" them). Email and record-date maps only use
 * their own tokens; a record-date trigger needs a date field of the flow's
 * collection and 0..365 days.
 */
function checkExternalTriggers(
  input: Json,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  const triggers = input["triggers"];
  if (!Array.isArray(triggers)) return;
  const stages = Array.isArray(input["stages"])
    ? (input["stages"] as unknown[]).filter(isObj)
    : [];
  const start = stages.find((st) => st["start"] === true);
  const subject = isObj(input["subject"]) ? input["subject"] : undefined;
  const recordDateFields = new Set<string>();
  triggers.forEach((t, index) => {
    if (!isObj(t)) return;
    const kind = t["kind"];
    if (kind !== "webhook" && kind !== "email" && kind !== "record_date") {
      return;
    }
    const path = `triggers[${index}]`;
    const assignee = start?.["assignee"];
    if (start && isObj(assignee) && assignee["kind"] === "initiator") {
      c.err(
        "ASSIGNEE_NOT_ALLOWED",
        path,
        "Este disparador no tiene a nadie que inicie la solicitud: la etapa inicial no puede estar asignada a quien inicia (usa un rol, un grupo, un usuario o un campo).",
        isStr(start["key"]) ? start["key"] : undefined,
      );
    }
    if (kind === "email") {
      checkTokenMap(
        t["map"],
        `${path}.map`,
        fields,
        WORKFLOW_EMAIL_TOKENS.map((e) => `email.${e.key}`),
        "un correo entrante",
        c,
      );
      return;
    }
    if (kind !== "record_date") return;
    const days = t["days_before"];
    if (!isInt(days) || days < 0 || days > WORKFLOW_LIMITS.maxRecordDateDaysBefore) {
      c.err(
        "TRIGGER_INVALID",
        `${path}.days_before`,
        `Los días de anticipación deben ser un entero entre 0 y ${WORKFLOW_LIMITS.maxRecordDateDaysBefore}.`,
      );
    }
    const collection =
      subject?.["type"] === "custom_record" && isStr(subject["collection"])
        ? subject["collection"]
        : undefined;
    if (!collection) {
      c.err(
        "TRIGGER_INVALID",
        path,
        "El disparador por fecha de un registro necesita un flujo sobre un registro personalizado (sujeto con su colección).",
      );
      return;
    }
    const recordFields = ctx.collections?.[collection];
    if (!isStr(t["field"]) || !RECORD_KEY_PATTERN.test(t["field"])) {
      c.err(
        "TRIGGER_INVALID",
        `${path}.field`,
        "El disparador por fecha necesita el campo de fecha del registro.",
      );
    } else {
      // One request per record and date: a second trigger on the same field
      // would never start (same key) nor use its own map.
      if (recordDateFields.has(t["field"])) {
        c.err(
          "TRIGGER_INVALID",
          `${path}.field`,
          `Ya hay un disparador por la fecha "${t["field"]}": cada fecha inicia una sola solicitud. Usa otro campo de fecha.`,
        );
      }
      recordDateFields.add(t["field"]);
      const f = recordFields?.find((rf) => rf.key === t["field"]);
      if (recordFields && (!f || f.type !== "date")) {
        c.err(
          "TRIGGER_INVALID",
          `${path}.field`,
          `El campo "${t["field"]}" no es un campo de fecha de la colección "${collection}".`,
        );
      }
    }
    const allowed = [
      ...WORKFLOW_RECORD_TOKENS,
      ...(recordFields ?? []).map((rf) => `record.${rf.key}`),
    ];
    if (recordFields) {
      checkTokenMap(t["map"], `${path}.map`, fields, allowed, "un registro", c);
    } else if (t["map"] !== undefined) {
      // Without the store's collections only the shape and fixed tokens are
      // known: any `{{record.<key>}}` passes here, the server re-checks it.
      checkTokenMap(
        t["map"],
        `${path}.map`,
        fields,
        [
          ...allowed,
          ...Object.values(isObj(t["map"]) ? t["map"] : {})
            .filter(isStr)
            .flatMap((v) => tokensOf(v))
            .filter((tok) => /^record\.[a-z][a-z0-9_-]{0,79}$/.test(tok)),
        ],
        "un registro",
        c,
      );
    }
  });
}

/** P2.10: cron triggers start as `system`, so nobody "initiates" them. */
function checkScheduleTriggers(input: Json, c: Collector) {
  const triggers = input["triggers"];
  if (!Array.isArray(triggers)) return;
  const schedules = triggers.filter(
    (t) => isObj(t) && t["kind"] === "schedule",
  );
  if (schedules.length > WORKFLOW_LIMITS.maxSchedules) {
    c.err(
      "SCHEDULE_INVALID",
      "triggers",
      `Un flujo admite hasta ${WORKFLOW_LIMITS.maxSchedules} disparadores programados.`,
    );
  }
  triggers.forEach((t, index) => {
    if (!isObj(t) || t["kind"] !== "schedule") return;
    const path = `triggers[${index}].cron`;
    const parsed = parseCron(t["cron"]);
    if (!parsed.ok) {
      c.err(
        "SCHEDULE_INVALID",
        path,
        `La programación no es válida: ${parsed.error}`,
      );
    }
    const stages = Array.isArray(input["stages"])
      ? (input["stages"] as unknown[]).filter(isObj)
      : [];
    const start = stages.find((s) => s["start"] === true);
    const assignee = start?.["assignee"];
    if (start && isObj(assignee) && assignee["kind"] === "initiator") {
      c.err(
        "ASSIGNEE_NOT_ALLOWED",
        `triggers[${index}]`,
        "Un disparador programado no tiene a nadie que inicie la solicitud: la etapa inicial no puede estar asignada a quien inicia (usa un rol, un grupo, un usuario o un campo).",
        isStr(start["key"]) ? start["key"] : undefined,
      );
    }
  });
}

/** Lists `{{path}}` tokens found in a string. */
function tokensOf(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(WORKFLOW_TOKEN_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** True when text still has braces after the well-formed tokens are removed. */
function hasStrayBraces(text: string): boolean {
  return /[{}]/.test(text.replace(new RegExp(WORKFLOW_TOKEN_PATTERN.source, "g"), ""));
}

/**
 * `event` triggers: a known event, a `map` from declared fields to literals or
 * `{{event.<path>}}` tokens of that event's catalog, and a start stage that a
 * person other than "the initiator" fills (nobody initiates a system start).
 */
function checkEventTriggers(input: Json, fields: FieldMap, c: Collector) {
  const triggers = input["triggers"];
  if (!Array.isArray(triggers)) return;
  const seen = new Set<string>();
  triggers.forEach((t, index) => {
    if (!isObj(t) || t["kind"] !== "event") return;
    const path = `triggers[${index}]`;
    const event = t["event"];
    if (
      !isStr(event) ||
      !(WORKFLOW_TRIGGER_EVENTS as readonly string[]).includes(event)
    ) {
      c.err(
        "EVENT_UNKNOWN",
        `${path}.event`,
        `El evento "${String(event)}" no existe (permitidos: ${WORKFLOW_TRIGGER_EVENTS.join(", ")}).`,
      );
      return;
    }
    if (seen.has(event)) {
      c.err(
        "SHAPE_INVALID",
        `${path}.event`,
        `El evento "${event}" ya tiene un disparador en este flujo.`,
      );
    }
    seen.add(event);
    const allowed = WORKFLOW_EVENT_TOKENS[event as WorkflowTriggerEvent].map(
      (k) => `event.${k}`,
    );
    checkTokenMap(t["map"], `${path}.map`, fields, allowed, `el evento "${event}"`, c);
    const stages = Array.isArray(input["stages"])
      ? (input["stages"] as unknown[]).filter(isObj)
      : [];
    const start = stages.find((s) => s["start"] === true);
    const assignee = start?.["assignee"];
    if (start && isObj(assignee) && assignee["kind"] === "initiator") {
      c.err(
        "ASSIGNEE_NOT_ALLOWED",
        path,
        "Un disparador por evento no tiene a nadie que inicie la solicitud: la etapa inicial no puede estar asignada a quien inicia (usa un rol, un grupo, un usuario o un campo).",
        isStr(start["key"]) ? start["key"] : undefined,
      );
    }
  });
}

/**
 * `map` of an event trigger or of `governs`: declared field → literal or
 * `{{event.<key>}}` tokens of `allowed` only.
 */
function checkTokenMap(
  map: unknown,
  path: string,
  fields: FieldMap,
  allowed: readonly string[],
  source: string,
  c: Collector,
) {
  if (map === undefined) return;
  if (!isObj(map)) {
    c.err("MAP_INVALID", path, "El mapa debe ser un objeto.");
    return;
  }
  for (const [key, value] of Object.entries(map)) {
    const p = `${path}.${key}`;
    const f = fields.get(key);
    if (!f) {
      c.err("FIELD_UNKNOWN", p, `El mapa llena el campo "${key}", que no está declarado.`);
    } else if (f.type === "file" || f.type === "multiselect") {
      c.err(
        "FIELD_TYPE_MISMATCH",
        p,
        `El mapa no puede llenar el campo "${key}" (los campos de tipo ${f.type} no admiten datos de ${source}).`,
      );
    }
    if (!isStr(value) || value.length > 500) {
      c.err("MAP_INVALID", p, `El valor de "${key}" debe ser texto de hasta 500 caracteres.`);
      continue;
    }
    if (hasStrayBraces(value)) {
      c.err("TOKEN_UNKNOWN", p, `El valor de "${key}" tiene llaves que no forman un token válido {{...}}.`);
    }
    for (const tok of tokensOf(value)) {
      if (!allowed.includes(tok)) {
        c.err(
          "TOKEN_UNKNOWN",
          p,
          `El token "{{${tok}}}" no existe para ${source} (permitidos: ${allowed.map((a) => `{{${a}}}`).join(", ")}).`,
        );
      }
    }
  }
}

/**
 * `governs` (approval gate, P1.3): a known operation, a minimum amount >= 0, a
 * map from the operation's tokens, a subject compatible with the operation,
 * a start stage someone other than "the initiator" fills, and both an end
 * `completed` (releases the operation) and an end `rejected` (voids it).
 */
function checkGoverns(input: Json, fields: FieldMap, c: Collector) {
  const g = input["governs"];
  if (g === undefined) return;
  if (!isObj(g)) {
    c.err("SHAPE_INVALID", "governs", "El candado de aprobación debe ser un objeto.");
    return;
  }
  checkKeys(c, g, ["operation", "min_amount", "map"], "governs");
  const op = g["operation"];
  if (
    !isStr(op) ||
    !(WORKFLOW_GATE_OPERATION_KEYS as readonly string[]).includes(op)
  ) {
    c.err(
      "GATE_OPERATION_UNKNOWN",
      "governs.operation",
      `La operación "${String(op)}" no se puede gobernar (permitidas: ${WORKFLOW_GATE_OPERATION_KEYS.join(", ")}).`,
    );
    return;
  }
  const spec = WORKFLOW_GATE_OPERATIONS[op as WorkflowGateOperation];
  const min = g["min_amount"];
  if (
    min !== undefined &&
    (typeof min !== "number" || !Number.isFinite(min) || min < 0)
  ) {
    c.err(
      "SHAPE_INVALID",
      "governs.min_amount",
      `El umbral (${spec.amount_label.toLowerCase()}) debe ser un número mayor o igual a 0.`,
    );
  }
  const allowed = gateOperationTokens(op as WorkflowGateOperation).map(
    (k) => `event.${k}`,
  );
  checkTokenMap(g["map"], "governs.map", fields, allowed, `la operación "${spec.label}"`, c);
  const subject = isObj(input["subject"]) ? input["subject"]["type"] : undefined;
  if (
    subject !== undefined &&
    subject !== "none" &&
    spec.subject !== "none" &&
    subject !== spec.subject
  ) {
    c.err(
      "SHAPE_INVALID",
      "subject.type",
      `Un flujo que gobierna "${spec.label}" trata sobre "${spec.subject}", no sobre "${String(subject)}".`,
    );
  }
  const stages = Array.isArray(input["stages"])
    ? (input["stages"] as unknown[]).filter(isObj)
    : [];
  const start = stages.find((s) => s["start"] === true);
  const assignee = start?.["assignee"];
  if (start && isObj(assignee) && assignee["kind"] === "initiator") {
    c.err(
      "ASSIGNEE_NOT_ALLOWED",
      "governs",
      "Un candado de aprobación inicia la solicitud el sistema: la etapa inicial no puede estar asignada a quien inicia (usa un rol, un grupo, un usuario o un campo).",
      isStr(start["key"]) ? start["key"] : undefined,
    );
  }
  for (const outcome of ["completed", "rejected"]) {
    const has = stages.some(
      (s) =>
        s["type"] === "end" &&
        (s["outcome"] === outcome ||
          (outcome === "completed" && s["outcome"] === undefined)),
    );
    if (!has) {
      c.err(
        "GATE_END_MISSING",
        "governs",
        outcome === "completed"
          ? "Un flujo que gobierna una operación necesita una etapa final «completado» que la libere."
          : "Un flujo que gobierna una operación necesita una etapa final «rechazado» que la anule.",
      );
    }
  }
}

/** `public_form`: the start stage must be a `form` stage filled by the initiator. */
function checkPublicFormTrigger(input: Json, c: Collector) {
  const triggers = input["triggers"];
  if (!Array.isArray(triggers) || !Array.isArray(input["stages"])) return;
  const index = triggers.findIndex(
    (t) => isObj(t) && t["kind"] === "public_form",
  );
  if (index < 0) return;
  const path = `triggers[${index}]`;
  const trigger = triggers[index] as Json;
  const stages = (input["stages"] as unknown[]).filter(isObj);
  const start = stages.find((s) => s["start"] === true);
  if (!start) return;
  if (trigger["stage"] !== undefined && trigger["stage"] !== start["key"]) {
    c.err(
      "SHAPE_INVALID",
      `${path}.stage`,
      "El formulario público debe apuntar a la etapa inicial del flujo.",
    );
    return;
  }
  const assignee = start["assignee"];
  if (
    start["type"] !== "form" ||
    !isObj(assignee) ||
    assignee["kind"] !== "initiator"
  ) {
    c.err(
      "SHAPE_INVALID",
      path,
      "El formulario público exige que la etapa inicial sea de tipo formulario y que la complete quien inicia la solicitud.",
      isStr(start["key"]) ? start["key"] : undefined,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function checkFields(raw: unknown, c: Collector): FieldMap {
  const map: FieldMap = new Map();
  if (!Array.isArray(raw)) {
    c.err(
      "SHAPE_INVALID",
      "fields",
      "Los campos del flujo deben ser una lista.",
    );
    return map;
  }
  if (raw.length > WORKFLOW_LIMITS.maxFields) {
    c.err(
      "LIMIT_EXCEEDED",
      "fields",
      `El flujo tiene ${raw.length} campos y el máximo es ${WORKFLOW_LIMITS.maxFields}.`,
    );
  }
  const seen = new Set<string>();
  const valid: { f: Json; i: number }[] = [];
  raw.forEach((f, i) => {
    const p = `fields[${i}]`;
    if (!isObj(f)) {
      c.err("SHAPE_INVALID", p, `El campo #${i + 1} no es válido.`);
      return;
    }
    checkKeys(
      c,
      f,
      [
        "key",
        "type",
        "label",
        "required",
        "help",
        "options",
        "accept",
        "max_size_mb",
        "visible_when",
        "compute",
      ],
      p,
    );
    let keyOk = false;
    if (!isStr(f["key"]) || !WORKFLOW_KEY_PATTERN.test(f["key"])) {
      c.err(
        "KEY_INVALID",
        `${p}.key`,
        `La clave del campo #${i + 1} no es válida (minúsculas, números, "_" o "-").`,
      );
    } else if (seen.has(f["key"])) {
      c.err(
        "DUPLICATE_KEY",
        `${p}.key`,
        `La clave de campo "${f["key"]}" está repetida.`,
      );
    } else {
      keyOk = true;
      seen.add(f["key"]);
    }
    const typeOk = (WORKFLOW_FIELD_TYPES as readonly unknown[]).includes(
      f["type"],
    );
    if (!typeOk)
      c.err(
        "SHAPE_INVALID",
        `${p}.type`,
        `El campo "${String(f["key"])}" tiene un tipo no válido.`,
      );
    if (!isNonEmptyStr(f["label"]))
      c.err(
        "SHAPE_INVALID",
        `${p}.label`,
        `El campo "${String(f["key"])}" necesita una etiqueta.`,
      );
    if (f["required"] !== undefined && typeof f["required"] !== "boolean")
      c.err(
        "SHAPE_INVALID",
        `${p}.required`,
        `El campo "${String(f["key"])}": "required" debe ser verdadero o falso.`,
      );
    if (f["help"] !== undefined && !isStr(f["help"]))
      c.err(
        "SHAPE_INVALID",
        `${p}.help`,
        `El campo "${String(f["key"])}": la ayuda debe ser texto.`,
      );
    const isSel = f["type"] === "select" || f["type"] === "multiselect";
    if (isSel) {
      const o = f["options"];
      if (
        !Array.isArray(o) ||
        o.length === 0 ||
        o.length > WORKFLOW_LIMITS.maxSelectOptions ||
        !o.every(
          (x) =>
            isObj(x) && isNonEmptyStr(x["value"]) && isNonEmptyStr(x["label"]),
        )
      ) {
        c.err(
          "SHAPE_INVALID",
          `${p}.options`,
          `El campo "${String(f["key"])}" necesita entre 1 y ${WORKFLOW_LIMITS.maxSelectOptions} opciones con valor y etiqueta.`,
        );
      } else if (new Set(o.map((x: Json) => x["value"])).size !== o.length) {
        c.err(
          "DUPLICATE_KEY",
          `${p}.options`,
          `El campo "${String(f["key"])}" tiene opciones con valores repetidos.`,
        );
      }
    } else if (f["options"] !== undefined) {
      c.err(
        "SHAPE_INVALID",
        `${p}.options`,
        `El campo "${String(f["key"])}" no admite opciones (solo selección).`,
      );
    }
    if (f["type"] === "file") {
      checkAccept(c, f["accept"], `${p}.accept`);
      checkMaxSize(c, f["max_size_mb"], `${p}.max_size_mb`);
    } else {
      if (f["accept"] !== undefined)
        c.err(
          "SHAPE_INVALID",
          `${p}.accept`,
          `El campo "${String(f["key"])}" no admite tipos de archivo (solo archivos).`,
        );
      if (f["max_size_mb"] !== undefined)
        c.err(
          "SHAPE_INVALID",
          `${p}.max_size_mb`,
          `El campo "${String(f["key"])}" no admite tamaño máximo (solo archivos).`,
        );
    }
    if (keyOk && typeOk) {
      const options = f["options"];
      map.set(f["key"] as string, {
        type: f["type"] as WorkflowFieldType,
        ...(f["type"] === "select" && Array.isArray(options)
          ? {
              options: options
                .filter(isObj)
                .map((o) => String(o["value"])),
            }
          : {}),
        ...(f["compute"] !== undefined ? { computed: true } : {}),
      });
      valid.push({ f, i });
    }
  });
  for (const { f, i } of valid) {
    if (f["visible_when"] === undefined) continue;
    checkCondition(f["visible_when"], `fields[${i}].visible_when`, 1, {
      c,
      fields: map,
      selfKey: f["key"] as string,
      label: `El campo "${String(f["key"])}"`,
      rules: 0,
      tooDeepReported: false,
    });
  }
  checkVisibilityCycles(c, valid);
  checkComputedFields(c, valid, map);
  return map;
}

const COMPUTABLE_TYPES = ["number", "money", "text", "date"];

/** P2.9: closed-grammar formulas over declared fields, without cycles. */
function checkComputedFields(
  c: Collector,
  valid: { f: Json; i: number }[],
  map: FieldMap,
) {
  const deps = new Map<string, string[]>();
  const index = new Map<string, number>();
  for (const { f, i } of valid) {
    if (f["compute"] === undefined) continue;
    const key = f["key"] as string;
    const L = `El campo "${String(f["label"] ?? key)}"`;
    const path = `fields[${i}].compute`;
    if (!COMPUTABLE_TYPES.includes(String(f["type"]))) {
      c.err(
        "EXPRESSION_INVALID",
        path,
        `${L} es de un tipo que no se puede calcular (solo número, dinero, texto o fecha).`,
      );
      continue;
    }
    const parsed = parseExpression(f["compute"]);
    if (!parsed.ok) {
      c.err("EXPRESSION_INVALID", path, `${L} tiene una fórmula no válida: ${parsed.error}`);
      continue;
    }
    for (const ref of parsed.expr.refs) {
      if (ref === key) {
        c.err("COMPUTE_CYCLE", path, `${L} no puede usarse a sí mismo en su fórmula.`);
      } else if (!map.has(ref)) {
        c.err(
          "FIELD_UNKNOWN",
          path,
          `${L} usa "${ref}" en su fórmula, que no es un campo declarado (las claves con "-" no se pueden usar en fórmulas).`,
        );
      }
    }
    deps.set(key, parsed.expr.refs.filter((r) => r !== key));
    index.set(key, i);
  }
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (k: string, stack: string[]) => {
    state.set(k, 1);
    stack.push(k);
    for (const d of deps.get(k) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 1) {
        const cycle = stack.slice(stack.indexOf(d));
        if (!cycle.some((x) => reported.has(x))) {
          cycle.forEach((x) => reported.add(x));
          c.err(
            "COMPUTE_CYCLE",
            `fields[${index.get(d)}].compute`,
            `Las fórmulas de ${cycle.map((x) => `"${x}"`).join(" → ")} dependen unas de otras en círculo.`,
          );
        }
      } else if (!state.has(d)) visit(d, stack);
    }
    stack.pop();
    state.set(k, 2);
  };
  for (const k of deps.keys()) if (!state.has(k)) visit(k, []);
}

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

interface StageInfo {
  key: string;
  name: string;
  type: string;
  start: boolean;
  index: number;
  targets: string[];
  /** P6.1: an `ai` stage with a person reviewing its outputs. */
  aiReview?: boolean;
}

function checkStages(
  raw: unknown,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
): StageInfo[] {
  const infos: StageInfo[] = [];
  if (!Array.isArray(raw)) {
    c.err(
      "SHAPE_INVALID",
      "stages",
      "Las etapas del flujo deben ser una lista.",
    );
    return infos;
  }
  if (raw.length > WORKFLOW_LIMITS.maxStages) {
    c.err(
      "LIMIT_EXCEEDED",
      "stages",
      `El flujo tiene ${raw.length} etapas y el máximo es ${WORKFLOW_LIMITS.maxStages}.`,
    );
  }
  const keys = new Set<string>();
  raw.forEach((s) => {
    if (isObj(s) && isStr(s["key"]) && WORKFLOW_KEY_PATTERN.test(s["key"]))
      keys.add(s["key"]);
  });
  c.stageKeys = keys;
  const seen = new Set<string>();

  raw.forEach((s, i) => {
    const p = `stages[${i}]`;
    if (!isObj(s)) {
      c.err("SHAPE_INVALID", p, `La etapa #${i + 1} no es válida.`);
      return;
    }
    checkKeys(
      c,
      s,
      [
        "key",
        "name",
        "type",
        "description",
        "start",
        "ui",
        "outcome",
        "assignee",
        "quorum",
        "form",
        "requirements",
        "transitions",
        "due",
        "on_enter",
        "on_submit",
        "on_complete",
        "on_exit",
        "guards",
        "parallel",
        "subflow",
        "wait",
        "loop",
        "ai",
      ],
      p,
    );
    const name = isNonEmptyStr(s["name"])
      ? s["name"]
      : isStr(s["key"])
        ? s["key"]
        : `#${i + 1}`;
    const L = `La etapa "${name}"`;
    let keyOk = false;
    if (!isStr(s["key"]) || !WORKFLOW_KEY_PATTERN.test(s["key"])) {
      c.err(
        "KEY_INVALID",
        `${p}.key`,
        `${L} tiene una clave no válida (minúsculas, números, "_" o "-").`,
      );
    } else if (seen.has(s["key"])) {
      c.err("DUPLICATE_KEY", `${p}.key`, `${L} repite la clave "${s["key"]}".`);
    } else {
      keyOk = true;
      seen.add(s["key"]);
    }
    const sk = keyOk ? (s["key"] as string) : undefined;
    if (!isNonEmptyStr(s["name"]) || s["name"].length > 200)
      c.err(
        "SHAPE_INVALID",
        `${p}.name`,
        `${L} necesita un nombre de hasta 200 caracteres.`,
        sk,
      );
    if (
      s["description"] !== undefined &&
      (!isStr(s["description"]) || s["description"].length > 2000)
    )
      c.err(
        "SHAPE_INVALID",
        `${p}.description`,
        `${L}: la descripción debe ser texto de hasta 2000 caracteres.`,
        sk,
      );
    if (s["start"] !== undefined && typeof s["start"] !== "boolean")
      c.err(
        "SHAPE_INVALID",
        `${p}.start`,
        `${L}: "start" debe ser verdadero o falso.`,
        sk,
      );
    if (s["ui"] !== undefined) {
      const ui = s["ui"];
      const inRange = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 20000;
      if (!isObj(ui) || !inRange(ui["x"]) || !inRange(ui["y"])) {
        c.err(
          "SHAPE_INVALID",
          `${p}.ui`,
          `${L}: la posición en el lienzo debe tener "x" e "y" numéricos entre 0 y 20000.`,
          sk,
        );
      } else {
        checkKeys(c, ui, ["x", "y"], `${p}.ui`, sk);
      }
    }
    const type = s["type"];
    if (!(WORKFLOW_STAGE_TYPES as readonly unknown[]).includes(type)) {
      c.err("SHAPE_INVALID", `${p}.type`, `${L} tiene un tipo no válido.`, sk);
      return;
    }
    const t = type as keyof typeof STAGE_OUTCOMES;
    const aiReview =
      t === "ai" && isObj(s["ai"]) && s["ai"]["review"] === true;
    const human =
      (HUMAN_STAGE_TYPES as readonly string[]).includes(t) || aiReview;

    if (t === "end") {
      if (
        !(WORKFLOW_END_OUTCOMES as readonly unknown[]).includes(s["outcome"])
      ) {
        c.err(
          "END_OUTCOME_MISSING",
          `${p}.outcome`,
          `${L} es final y debe declarar su resultado (completed, rejected o cancelled).`,
          sk,
        );
      }
    } else if (s["outcome"] !== undefined) {
      c.err(
        "SHAPE_INVALID",
        `${p}.outcome`,
        `${L} no es final, por lo que no admite "outcome".`,
        sk,
      );
    }

    // assignee
    if (s["assignee"] !== undefined) {
      if (!human)
        c.err(
          "ASSIGNEE_NOT_ALLOWED",
          `${p}.assignee`,
          `${L} es ${t === "end" ? "final" : t === "parallel" ? "paralela (cada rama tiene su responsable)" : t === "ai" ? "un paso de IA sin revisión humana" : "automática"} y no debe tener responsable.`,
          sk,
        );
      else checkAssignee(s["assignee"], `${p}.assignee`, L, sk, fields, ctx, c);
    } else if (human) {
      c.err(
        "ASSIGNEE_MISSING",
        `${p}.assignee`,
        `${L} no tiene responsable.`,
        sk,
      );
    }

    // quorum
    if (s["quorum"] !== undefined) {
      const a = isObj(s["assignee"]) ? s["assignee"]["kind"] : undefined;
      if (t !== "approval")
        c.err(
          "QUORUM_INVALID",
          `${p}.quorum`,
          `${L} no es de aprobación: el quórum solo aplica a etapas de aprobación.`,
          sk,
        );
      else if (a !== "role" && a !== "group")
        c.err(
          "QUORUM_INVALID",
          `${p}.quorum`,
          `${L}: el quórum requiere un responsable de tipo rol o grupo.`,
          sk,
        );
      else if (
        !isObj(s["quorum"]) ||
        !isInt(s["quorum"]["required"]) ||
        s["quorum"]["required"] < 1
      )
        c.err(
          "QUORUM_INVALID",
          `${p}.quorum.required`,
          `${L}: el quórum debe ser un número entero de al menos 1.`,
          sk,
        );
      else checkKeys(c, s["quorum"], ["required"], `${p}.quorum`, sk);
    }

    // due
    if (s["due"] !== undefined)
      checkDue(s["due"], `${p}.due`, L, human, sk, fields, ctx, c);

    // form
    if (s["form"] !== undefined) {
      if (t === "ai")
        c.err(
          "SHAPE_INVALID",
          `${p}.form`,
          `${L} es un paso de IA: quien revisa edita los campos que escribe la IA y no admite formulario propio.`,
          sk,
        );
      else if (!human)
        c.err(
          "SHAPE_INVALID",
          `${p}.form`,
          `${L} no es una etapa humana y no admite formulario.`,
          sk,
        );
      else if (
        !isObj(s["form"]) ||
        !Array.isArray(s["form"]["fields"]) ||
        !s["form"]["fields"].every(isStr)
      )
        c.err(
          "SHAPE_INVALID",
          `${p}.form.fields`,
          `${L}: el formulario debe listar las claves de campos.`,
          sk,
        );
      else {
        checkKeys(c, s["form"], ["fields", "steps"], `${p}.form`, sk);
        checkFormSteps(s["form"], `${p}.form`, L, sk, c);
        const used = new Set<string>();
        (s["form"]["fields"] as string[]).forEach((fk, j) => {
          if (!fields.has(fk))
            c.err(
              "FIELD_UNKNOWN",
              `${p}.form.fields[${j}]`,
              `${L} usa el campo "${fk}", que no está declarado.`,
              sk,
            );
          else if (used.has(fk))
            c.err(
              "DUPLICATE_KEY",
              `${p}.form.fields[${j}]`,
              `${L} repite el campo "${fk}" en su formulario.`,
              sk,
            );
          used.add(fk);
        });
      }
    }

    if (t === "ai" && s["requirements"] !== undefined)
      c.err(
        "SHAPE_INVALID",
        `${p}.requirements`,
        `${L} es un paso de IA y no admite requisitos.`,
        sk,
      );
    else
      checkRequirements(
        s["requirements"],
        `${p}.requirements`,
        L,
        sk,
        fields,
        ctx,
        c,
      );
    checkActions(s["on_enter"], `${p}.on_enter`, L, sk, fields, ctx, c);
    checkActions(s["on_submit"], `${p}.on_submit`, L, sk, fields, ctx, c);
    checkActions(s["on_complete"], `${p}.on_complete`, L, sk, fields, ctx, c);
    checkActions(s["on_exit"], `${p}.on_exit`, L, sk, fields, ctx, c);
    if (
      s["on_submit"] !== undefined &&
      !human &&
      t !== "parallel"
    ) {
      c.err(
        "SHAPE_INVALID",
        `${p}.on_submit`,
        `${L} no recibe envíos de personas: "al enviar" solo aplica a etapas humanas o paralelas.`,
        sk,
      );
    }

    // P2.1 / P2.2 / P2.3 / P2.4: per-type configuration.
    const targets: string[] = [];
    checkTypeConfig(s, t, p, L, sk, fields, ctx, c);
    checkGuards(s["guards"], aiReview ? "review" : t, p, L, sk, keys, fields, c, targets);
    if (t === "ai" && isObj(s["ai"]) && isObj(s["ai"]["on_error"])) {
      const to = s["ai"]["on_error"]["route_to"];
      if (isStr(to) && keys.has(to)) targets.push(to);
    }
    for (const hook of ["on_enter", "on_submit", "on_complete", "on_exit"]) {
      const list = s[hook];
      if (!Array.isArray(list)) continue;
      for (const a of list) {
        if (isObj(a) && isObj(a["on_error"]) && isStr(a["on_error"]["route_to"])) {
          if (keys.has(a["on_error"]["route_to"])) targets.push(a["on_error"]["route_to"]);
        }
      }
    }

    // transitions
    if (t === "end") {
      if (
        s["transitions"] !== undefined &&
        !(Array.isArray(s["transitions"]) && s["transitions"].length === 0)
      ) {
        c.err(
          "END_HAS_TRANSITIONS",
          `${p}.transitions`,
          `${L} es final y no puede tener transiciones.`,
          sk,
        );
      }
    } else {
      const required =
        t === "subflow" && isObj(s["subflow"]) && s["subflow"]["wait"] === false
          ? ["completed"]
          : t === "ai"
            ? [aiReview ? "approve" : "auto"]
            : (SYSTEM_STAGE_TYPES as readonly string[]).includes(t) || t === "parallel"
              ? [...STAGE_OUTCOMES[t]]
              : [];
      checkTransitions(s["transitions"], p, L, t, sk, keys, fields, c, targets, required, aiReview);
      if (t === "ai") checkAiDecide(s, p, L, sk, aiReview, c);
    }

    if (keyOk) {
      infos.push({
        key: s["key"] as string,
        name,
        type: t,
        start: s["start"] === true,
        index: i,
        targets,
        ...(aiReview ? { aiReview: true } : {}),
      });
    }
  });
  return infos;
}

function checkAssignee(
  a: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (!isObj(a) || !isStr(a["kind"])) {
    c.err("SHAPE_INVALID", path, `${L}: el responsable no es válido.`, sk);
    return;
  }
  switch (a["kind"]) {
    case "initiator":
      checkKeys(c, a, ["kind"], path, sk);
      return;
    case "role":
      checkKeys(c, a, ["kind", "role_key"], path, sk);
      if (!isNonEmptyStr(a["role_key"]))
        c.err(
          "SHAPE_INVALID",
          `${path}.role_key`,
          `${L}: el responsable de tipo rol necesita "role_key".`,
          sk,
        );
      else if (ctx.roleKeys && !ctx.roleKeys.includes(a["role_key"]))
        c.err(
          "ROLE_UNKNOWN",
          `${path}.role_key`,
          `${L} usa el rol "${a["role_key"]}", que no existe en la tienda.`,
          sk,
        );
      return;
    case "group":
      checkKeys(c, a, ["kind", "group_key", "strategy"], path, sk);
      if (!isNonEmptyStr(a["group_key"]))
        c.err(
          "SHAPE_INVALID",
          `${path}.group_key`,
          `${L}: el responsable de tipo grupo necesita "group_key".`,
          sk,
        );
      else if (ctx.groupKeys && !ctx.groupKeys.includes(a["group_key"]))
        c.err(
          "GROUP_UNKNOWN",
          `${path}.group_key`,
          `${L} usa el grupo "${a["group_key"]}", que no existe o no tiene miembros disponibles.`,
          sk,
        );
      if (
        a["strategy"] !== undefined &&
        !["any", "round_robin", "least_load"].includes(a["strategy"] as string)
      )
        c.err(
          "SHAPE_INVALID",
          `${path}.strategy`,
          `${L}: la estrategia del grupo debe ser any, round_robin o least_load.`,
          sk,
        );
      return;
    case "user":
      checkKeys(c, a, ["kind", "user_id"], path, sk);
      if (!isInt(a["user_id"]) || a["user_id"] < 1)
        c.err(
          "SHAPE_INVALID",
          `${path}.user_id`,
          `${L}: el responsable de tipo usuario necesita un "user_id" entero positivo.`,
          sk,
        );
      else if (ctx.userIds && !ctx.userIds.includes(a["user_id"]))
        c.err(
          "USER_UNKNOWN",
          `${path}.user_id`,
          `${L} usa el usuario ${a["user_id"]}, que no existe en la tienda.`,
          sk,
        );
      return;
    case "field": {
      checkKeys(c, a, ["kind", "field"], path, sk);
      const f = isStr(a["field"]) ? fields.get(a["field"]) : undefined;
      if (!f)
        c.err(
          "FIELD_UNKNOWN",
          `${path}.field`,
          `${L} toma el responsable del campo "${String(a["field"])}", que no está declarado.`,
          sk,
        );
      else if (f.type !== "user")
        c.err(
          "FIELD_TYPE_MISMATCH",
          `${path}.field`,
          `${L} toma el responsable del campo "${String(a["field"])}", que no es de tipo usuario.`,
          sk,
        );
      return;
    }
    default:
      c.err(
        "SHAPE_INVALID",
        `${path}.kind`,
        `${L}: el tipo de responsable "${a["kind"]}" no existe.`,
        sk,
      );
  }
}

function checkDue(
  d: unknown,
  path: string,
  L: string,
  human: boolean,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (!human) {
    c.err(
      "SHAPE_INVALID",
      path,
      `${L} no es una etapa humana y no admite vencimiento.`,
      sk,
    );
    return;
  }
  if (!isObj(d) || !isInt(d["hours"]) || d["hours"] < 1 || d["hours"] > 8760) {
    c.err(
      "SHAPE_INVALID",
      `${path}.hours`,
      `${L}: el vencimiento debe ser un número entero de horas entre 1 y 8760.`,
      sk,
    );
    return;
  }
  checkKeys(c, d, ["hours", "on_overdue"], path, sk);
  if (d["on_overdue"] === undefined) return;
  const o = d["on_overdue"];
  if (!isObj(o)) {
    c.err(
      "SHAPE_INVALID",
      `${path}.on_overdue`,
      `${L}: "on_overdue" no es válido.`,
      sk,
    );
    return;
  }
  checkKeys(
    c,
    o,
    ["remind_every_hours", "escalate_to"],
    `${path}.on_overdue`,
    sk,
  );
  if (
    o["remind_every_hours"] !== undefined &&
    (!isInt(o["remind_every_hours"]) ||
      o["remind_every_hours"] < 1 ||
      o["remind_every_hours"] > 720)
  ) {
    c.err(
      "SHAPE_INVALID",
      `${path}.on_overdue.remind_every_hours`,
      `${L}: el recordatorio debe ser un entero de horas entre 1 y 720.`,
      sk,
    );
  }
  if (o["escalate_to"] !== undefined)
    checkAssignee(
      o["escalate_to"],
      `${path}.on_overdue.escalate_to`,
      L,
      sk,
      fields,
      ctx,
      c,
    );
}

function checkRequirements(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    c.err(
      "REQUIREMENT_INVALID",
      path,
      `${L}: los requisitos deben ser una lista.`,
      sk,
    );
    return;
  }
  if (raw.length > WORKFLOW_LIMITS.maxRequirementsPerStage) {
    c.err(
      "LIMIT_EXCEEDED",
      path,
      `${L} tiene ${raw.length} requisitos y el máximo es ${WORKFLOW_LIMITS.maxRequirementsPerStage}.`,
      sk,
    );
  }
  const published = ctx.publishedTemplateKeys ?? [];
  const keys = new Set<string>();
  const issued = new Set<string>();
  raw.forEach((r) => {
    if (isObj(r) && r["kind"] === "issued_document" && isStr(r["key"]))
      issued.add(r["key"]);
  });
  raw.forEach((r, i) => {
    const p = `${path}[${i}]`;
    if (
      !isObj(r) ||
      !(WORKFLOW_REQUIREMENT_KINDS as readonly unknown[]).includes(r["kind"])
    ) {
      c.err(
        "REQUIREMENT_INVALID",
        p,
        `${L}: el requisito #${i + 1} no es válido (tipos: ${WORKFLOW_REQUIREMENT_KINDS.join(", ")}).`,
        sk,
      );
      return;
    }
    if (!isStr(r["key"]) || !WORKFLOW_KEY_PATTERN.test(r["key"])) {
      c.err(
        "KEY_INVALID",
        `${p}.key`,
        `${L}: el requisito #${i + 1} tiene una clave no válida.`,
        sk,
      );
    } else if (keys.has(r["key"])) {
      c.err(
        "DUPLICATE_KEY",
        `${p}.key`,
        `${L} repite el requisito "${r["key"]}".`,
        sk,
      );
    } else keys.add(r["key"]);
    if (!isNonEmptyStr(r["label"]))
      c.err(
        "REQUIREMENT_INVALID",
        `${p}.label`,
        `${L}: el requisito "${String(r["key"])}" necesita una etiqueta.`,
        sk,
      );
    const rk = String(r["key"]);
    switch (r["kind"]) {
      case "upload":
        checkKeys(
          c,
          r,
          [
            "kind",
            "key",
            "label",
            "accept",
            "max_size_mb",
            "blocks_exit",
            "external",
          ],
          p,
          sk,
        );
        checkAccept(c, r["accept"], `${p}.accept`, sk);
        checkMaxSize(c, r["max_size_mb"], `${p}.max_size_mb`, sk);
        if (r["external"] !== undefined && typeof r["external"] !== "boolean") {
          c.err(
            "REQUIREMENT_INVALID",
            `${p}.external`,
            `${L}: "external" debe ser verdadero o falso.`,
            sk,
          );
        }
        break;
      case "file_field": {
        checkKeys(c, r, ["kind", "key", "label", "field"], p, sk);
        const f = isStr(r["field"]) ? fields.get(r["field"]) : undefined;
        if (!f)
          c.err(
            "FIELD_UNKNOWN",
            `${p}.field`,
            `${L}: el requisito "${rk}" usa el campo "${String(r["field"])}", que no está declarado.`,
            sk,
          );
        else if (f.type !== "file")
          c.err(
            "FIELD_TYPE_MISMATCH",
            `${p}.field`,
            `${L}: el requisito "${rk}" necesita un campo de tipo archivo y "${String(r["field"])}" no lo es.`,
            sk,
          );
        break;
      }
      case "issued_document":
        checkKeys(
          c,
          r,
          ["kind", "key", "label", "template_key", "auto_issue_on_enter"],
          p,
          sk,
        );
        if (!isNonEmptyStr(r["template_key"]))
          c.err(
            "REQUIREMENT_INVALID",
            `${p}.template_key`,
            `${L}: el requisito "${rk}" necesita "template_key".`,
            sk,
          );
        else if (!published.includes(r["template_key"]))
          c.err(
            "TEMPLATE_NOT_PUBLISHED",
            `${p}.template_key`,
            `${L}: la plantilla "${r["template_key"]}" del requisito "${rk}" no está publicada.`,
            sk,
          );
        break;
      case "signature":
        checkKeys(
          c,
          r,
          ["kind", "key", "label", "of", "accept", "blocks_exit"],
          p,
          sk,
        );
        if (!isStr(r["of"]) || !issued.has(r["of"]))
          c.err(
            "REQUIREMENT_INVALID",
            `${p}.of`,
            `${L}: la firma "${rk}" debe referirse a un requisito de documento emitido de la misma etapa.`,
            sk,
          );
        checkAccept(c, r["accept"], `${p}.accept`, sk);
        break;
    }
    if (r["blocks_exit"] !== undefined && typeof r["blocks_exit"] !== "boolean")
      c.err(
        "SHAPE_INVALID",
        `${p}.blocks_exit`,
        `${L}: "blocks_exit" debe ser verdadero o falso.`,
        sk,
      );
    if (
      r["auto_issue_on_enter"] !== undefined &&
      typeof r["auto_issue_on_enter"] !== "boolean"
    )
      c.err(
        "SHAPE_INVALID",
        `${p}.auto_issue_on_enter`,
        `${L}: "auto_issue_on_enter" debe ser verdadero o falso.`,
        sk,
      );
  });
}

function checkActions(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    c.err("SHAPE_INVALID", path, `${L}: las acciones deben ser una lista.`, sk);
    return;
  }
  if (raw.length > WORKFLOW_LIMITS.maxActionsPerHook) {
    c.err(
      "LIMIT_EXCEEDED",
      path,
      `${L} tiene ${raw.length} acciones en ${path.split(".").pop()} y el máximo es ${WORKFLOW_LIMITS.maxActionsPerHook}.`,
      sk,
    );
  }
  raw.forEach((a, i) => {
    const p = `${path}[${i}]`;
    if (
      !isObj(a) ||
      !(WORKFLOW_ACTIONS as readonly unknown[]).includes(a["action"])
    ) {
      c.err(
        "ACTION_UNKNOWN",
        p,
        `${L}: la acción "${isObj(a) ? String(a["action"]) : ""}" no está permitida (permitidas: ${WORKFLOW_ACTIONS.join(", ")}).`,
        sk,
      );
      return;
    }
    if (a["action"] === "notify") {
      checkKeys(c, a, ["action", "to", "message"], p, sk);
      checkAssignee(a["to"], `${p}.to`, L, sk, fields, ctx, c);
      if (
        !isStr(a["message"]) ||
        a["message"].length < 1 ||
        a["message"].length > 500
      ) {
        c.err(
          "SHAPE_INVALID",
          `${p}.message`,
          `${L}: el mensaje de la notificación debe tener entre 1 y 500 caracteres.`,
          sk,
        );
      }
    } else if (
      (WORKFLOW_VENDIX_ACTIONS as readonly unknown[]).includes(a["action"])
    ) {
      checkVendixAction(a, p, L, sk, fields, ctx, c);
    } else {
      checkKeys(c, a, ["action", "field", "value"], p, sk);
      if (!isStr(a["field"]) || !fields.has(a["field"]))
        c.err(
          "FIELD_UNKNOWN",
          `${p}.field`,
          `${L}: la acción set_field usa el campo "${String(a["field"])}", que no está declarado.`,
          sk,
        );
      const v = a["value"];
      if (
        !(
          v === null ||
          isStr(v) ||
          typeof v === "boolean" ||
          (typeof v === "number" && Number.isFinite(v))
        )
      ) {
        c.err(
          "SHAPE_INVALID",
          `${p}.value`,
          `${L}: el valor de set_field debe ser texto, número, booleano o nulo.`,
          sk,
        );
      }
    }
  });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Checks a literal (no tokens) against the input type of the registry. */
function literalError(spec: WorkflowActionInputSpec, value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : value;
  switch (spec.type) {
    case "id":
    case "int":
    case "number":
    case "money": {
      const n = typeof text === "number" ? text : Number(text);
      const min = spec.min ?? (spec.type === "id" ? 1 : undefined);
      const integer = spec.type === "id" || spec.type === "int";
      if (
        text === "" ||
        typeof text === "boolean" ||
        !Number.isFinite(n) ||
        (min !== undefined && n < min) ||
        (integer && !Number.isInteger(n))
      ) {
        return `debe ser un número${integer ? " entero" : ""}${min !== undefined ? ` mayor o igual a ${min}` : ""}`;
      }
      if (spec.max !== undefined && n > spec.max) {
        return `debe ser menor o igual a ${spec.max}`;
      }
      return null;
    }
    case "date":
      return typeof text === "string" && ISO_DATE.test(text)
        ? null
        : "debe ser una fecha AAAA-MM-DD";
    case "boolean":
      return typeof value === "boolean" || text === "true" || text === "false"
        ? null
        : "debe ser verdadero o falso";
    case "enum":
      return typeof text === "string" && (spec.values ?? []).includes(text)
        ? null
        : `debe ser uno de: ${(spec.values ?? []).join(", ")}`;
    case "assignee":
      return "debe ser un responsable (rol, grupo, usuario o campo)";
    default:
      return null;
  }
}

/**
 * P3.2: `output` of the HTTP node maps response paths (`status`, `body`,
 * `body.<path>`, `headers.<name>`) to declared, non-file fields. Any other
 * action rejects it.
 */
function checkHttpOutput(
  a: Json,
  name: WorkflowVendixActionName,
  p: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  c: Collector,
) {
  const output = a["output"];
  if (output === undefined) return;
  if (name !== "vendix.http.request") {
    c.err(
      "HTTP_OUTPUT_INVALID",
      p,
      `${L}: solo la llamada HTTP guarda su respuesta en campos.`,
      sk,
    );
    return;
  }
  if (!isObj(output) || Object.keys(output).length > WORKFLOW_LIMITS.maxHttpOutputs) {
    c.err(
      "HTTP_OUTPUT_INVALID",
      p,
      `${L}: la respuesta se guarda en un objeto campo → ruta de hasta ${WORKFLOW_LIMITS.maxHttpOutputs} entradas.`,
      sk,
    );
    return;
  }
  for (const [field, path] of Object.entries(output)) {
    const f = fields.get(field);
    if (!f || f.type === "file" || f.type === "user" || f.type === "multiselect") {
      c.err(
        "FIELD_UNKNOWN",
        `${p}.${field}`,
        `${L}: la respuesta no puede guardarse en "${field}" (debe ser un campo declarado de texto, número, fecha, booleano o selección).`,
        sk,
      );
    }
    if (!isStr(path) || !WORKFLOW_HTTP_OUTPUT_PATH.test(path)) {
      c.err(
        "HTTP_OUTPUT_INVALID",
        `${p}.${field}`,
        `${L}: "${String(path)}" no es una ruta de respuesta válida (status, body, body.a.b o headers.nombre).`,
        sk,
      );
    }
  }
}

/**
 * `vendix.*` actions: `map` values are literals or tokens of the closed
 * catalog `{{fields.<declared field>}}`, `{{instance.reference}}`,
 * `{{instance.title}}`. Required keys must be present; unknown keys and tokens
 * are rejected. The actions run through the outbox, never inline.
 */
function checkVendixAction(
  a: Json,
  p: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  const name = a["action"] as WorkflowVendixActionName;
  checkKeys(c, a, ["action", "map", "on_error", "output"], p, sk);
  if (a["on_error"] !== undefined) checkErrorPolicy(a["on_error"], `${p}.on_error`, L, sk, c);
  checkHttpOutput(a, name, `${p}.output`, L, sk, fields, c);
  const secretInputs = WORKFLOW_SECRET_INPUTS[name] ?? [];
  const map = a["map"];
  if (!isObj(map)) {
    c.err(
      "MAP_INVALID",
      `${p}.map`,
      `${L}: la acción ${name} necesita un "map" (objeto).`,
      sk,
    );
    return;
  }
  const spec = WORKFLOW_VENDIX_ACTION_MAP_KEYS[name];
  const known = [...spec.required, ...spec.optional];
  for (const key of spec.required) {
    const v = map[key];
    if (v === undefined || v === null || (isStr(v) && v.trim() === "")) {
      c.err(
        "MAP_INVALID",
        `${p}.map.${key}`,
        `${L}: la acción ${name} necesita el valor "${key}" en su mapa.`,
        sk,
      );
    }
  }
  for (const [key, value] of Object.entries(map)) {
    const vp = `${p}.map.${key}`;
    if (!known.includes(key)) {
      c.err(
        "MAP_INVALID",
        vp,
        `${L}: la clave "${key}" no existe en la acción ${name} (permitidas: ${known.join(", ")}).`,
        sk,
      );
      continue;
    }
    if (value === undefined || value === null) continue;
    const input = (
      WORKFLOW_ACTION_CATALOG[name].inputs as Record<string, WorkflowActionInputSpec>
    )[key];
    if (input.type === "assignee") {
      checkAssignee(value, vp, L, sk, fields, ctx, c);
      continue;
    }
    if (isObj(value) || Array.isArray(value)) {
      c.err(
        "MAP_INVALID",
        vp,
        `${L}: el valor de "${key}" debe ser un texto, número o booleano.`,
        sk,
      );
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      c.err("MAP_INVALID", vp, `${L}: el valor de "${key}" no es un número válido.`, sk);
      continue;
    }
    if (isStr(value)) {
      if (value.length > 2000) {
        c.err("MAP_INVALID", vp, `${L}: el valor de "${key}" supera los 2000 caracteres.`, sk);
        continue;
      }
      // The HTTP body is usually JSON: its braces are content, not tokens.
      if (!secretInputs.includes(key) && hasStrayBraces(value)) {
        c.err("TOKEN_UNKNOWN", vp, `${L}: el valor de "${key}" tiene llaves que no forman un token válido {{...}}.`, sk);
      }
      const tokens = tokensOf(value);
      for (const tok of tokens) {
        const isField =
          tok.startsWith("fields.") && fields.has(tok.slice("fields.".length));
        if (tok.startsWith("secrets.") && secretInputs.includes(key)) {
          const secret = tok.slice("secrets.".length);
          if (!WORKFLOW_SECRET_NAME_PATTERN.test(secret)) {
            c.err(
              "SECRET_UNKNOWN",
              vp,
              `${L}: "{{${tok}}}" no es un nombre de secreto válido (MAYÚSCULAS, números y "_").`,
              sk,
            );
          } else if (ctx.secretNames && !ctx.secretNames.includes(secret)) {
            c.err(
              "SECRET_UNKNOWN",
              vp,
              `${L}: el secreto "${secret}" no existe en la tienda.`,
              sk,
            );
          }
          continue;
        }
        if (!isField && !WORKFLOW_INSTANCE_TOKENS.includes(tok)) {
          c.err(
            "TOKEN_UNKNOWN",
            vp,
            `${L}: el token "{{${tok}}}" no existe (permitidos: {{fields.<campo declarado>}}, ${WORKFLOW_INSTANCE_TOKENS.map((t) => `{{${t}}}`).join(", ")}).`,
            sk,
          );
        }
      }
      if (tokens.length > 0) continue;
    }
    const problem = literalError(input, value);
    if (problem) {
      c.err("MAP_INVALID", vp, `${L}: "${key}" ${problem}.`, sk);
    }
  }
}

function checkTransitions(
  raw: unknown,
  p: string,
  L: string,
  t: keyof typeof STAGE_OUTCOMES,
  sk: string | undefined,
  stageKeys: Set<string>,
  fields: FieldMap,
  c: Collector,
  targets: string[],
  requiredOutcomes: string[] = [],
  aiReview = false,
) {
  const path = `${p}.transitions`;
  const list: unknown[] =
    raw === undefined ? [] : Array.isArray(raw) ? raw : [];
  if (raw !== undefined && !Array.isArray(raw)) {
    c.err(
      "SHAPE_INVALID",
      path,
      `${L}: las transiciones deben ser una lista.`,
      sk,
    );
    return;
  }
  if (list.length > WORKFLOW_LIMITS.maxTransitionsPerStage) {
    c.err(
      "LIMIT_EXCEEDED",
      path,
      `${L} tiene ${list.length} transiciones y el máximo es ${WORKFLOW_LIMITS.maxTransitionsPerStage}.`,
      sk,
    );
  }
  const outcomes =
    t === "ai"
      ? aiReview
        ? ["approve", "reject"]
        : ["auto"]
      : STAGE_OUTCOMES[t];
  const byOn = new Map<string, { hasWhen: boolean }[]>();
  list.forEach((tr, i) => {
    const tp = `${path}[${i}]`;
    if (!isObj(tr)) {
      c.err(
        "SHAPE_INVALID",
        tp,
        `${L}: la transición #${i + 1} no es válida.`,
        sk,
      );
      return;
    }
    checkKeys(c, tr, ["to", "on", "when", "require_comment", "label"], tp, sk);
    if (!isStr(tr["to"]) || !stageKeys.has(tr["to"])) {
      c.err(
        "TRANSITION_TARGET_UNKNOWN",
        `${tp}.to`,
        `${L} tiene una transición hacia "${String(tr["to"])}", que no existe.`,
        sk,
      );
    } else targets.push(tr["to"]);
    if (!isStr(tr["on"]) || !outcomes.includes(tr["on"])) {
      c.err(
        "OUTCOME_INVALID",
        `${tp}.on`,
        `${L} usa el resultado "${String(tr["on"])}", que no corresponde a una etapa de este tipo (permitidos: ${outcomes.join(", ")}).`,
        sk,
      );
    }
    if (tr["when"] !== undefined) {
      checkCondition(tr["when"], `${tp}.when`, 1, {
        c,
        fields,
        label: L,
        stageKey: sk,
        rules: 0,
        tooDeepReported: false,
      });
    }
    if (
      tr["require_comment"] !== undefined &&
      typeof tr["require_comment"] !== "boolean"
    )
      c.err(
        "SHAPE_INVALID",
        `${tp}.require_comment`,
        `${L}: "require_comment" debe ser verdadero o falso.`,
        sk,
      );
    if (tr["label"] !== undefined && !isStr(tr["label"]))
      c.err(
        "SHAPE_INVALID",
        `${tp}.label`,
        `${L}: la etiqueta de la transición debe ser texto.`,
        sk,
      );
    if (isStr(tr["on"])) {
      const g = byOn.get(tr["on"]) ?? [];
      g.push({ hasWhen: tr["when"] !== undefined });
      byOn.set(tr["on"], g);
    }
  });

  for (const [on, g] of byOn) {
    const firstDefault = g.findIndex((x) => !x.hasWhen);
    if (g.some((x) => x.hasWhen) && firstDefault === -1) {
      c.err(
        "DEFAULT_BRANCH_MISSING",
        path,
        `${L}: las ramas con condición del resultado "${on}" necesitan una rama por defecto (sin condición) al final.`,
        sk,
      );
    } else if (firstDefault !== -1 && firstDefault !== g.length - 1) {
      c.err(
        "DEFAULT_BRANCH_NOT_LAST",
        path,
        `${L}: la rama por defecto del resultado "${on}" debe ser la última; las que le siguen nunca se evaluarían.`,
        sk,
      );
    }
  }
  for (const o of requiredOutcomes) {
    if (byOn.has(o)) continue;
    c.err(
      "DEFAULT_BRANCH_MISSING",
      path,
      t === "automatic"
        ? `${L} es automática y necesita una transición por defecto para "auto".`
        : t === "ai" && !aiReview
          ? `${L} es un paso de IA sin revisión y necesita una transición para "auto".`
          : `${L} necesita una transición para el resultado "${o}".`,
      sk,
    );
  }
  if (
    list.length > 0 &&
    ((HUMAN_STAGE_TYPES as readonly string[]).includes(t) || aiReview)
  ) {
    for (const o of outcomes) {
      if (!byOn.has(o)) {
        c.warn(
          "OUTCOME_UNREACHABLE",
          path,
          `${L} no tiene transición para el resultado "${o}": si alguien lo elige, el flujo no podrá avanzar.`,
          sk,
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

function checkGraph(stages: StageInfo[], c: Collector) {
  const byKey = new Map(stages.map((s) => [s.key, s]));
  const starts = stages.filter((s) => s.start);
  const ends = stages.filter((s) => s.type === "end");

  if (starts.length !== 1) {
    c.err(
      "START_COUNT",
      "stages",
      starts.length === 0
        ? "El flujo debe tener exactamente una etapa inicial y no tiene ninguna."
        : `El flujo debe tener exactamente una etapa inicial y tiene ${starts.length}.`,
    );
  } else if (starts[0].type === "end") {
    c.err(
      "START_COUNT",
      `stages[${starts[0].index}].start`,
      `La etapa "${starts[0].name}" es final y no puede ser la etapa inicial.`,
      starts[0].key,
    );
  }
  if (ends.length === 0)
    c.err(
      "END_MISSING",
      "stages",
      "El flujo debe tener al menos una etapa final.",
    );

  if (starts.length === 1) {
    const seen = new Set<string>([starts[0].key]);
    const queue = [starts[0].key];
    while (queue.length) {
      const cur = byKey.get(queue.shift()!)!;
      for (const t of cur.targets) {
        if (!seen.has(t) && byKey.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    for (const s of stages) {
      if (!seen.has(s.key))
        c.err(
          "UNREACHABLE_STAGE",
          `stages[${s.index}]`,
          `La etapa "${s.name}" no es alcanzable desde la etapa inicial.`,
          s.key,
        );
    }
  }

  // Reverse reachability from end stages.
  const rev = new Map<string, string[]>();
  for (const s of stages)
    for (const t of s.targets) {
      if (!rev.has(t)) rev.set(t, []);
      rev.get(t)!.push(s.key);
    }
  const canEnd = new Set<string>(ends.map((e) => e.key));
  const q = [...canEnd];
  while (q.length) {
    for (const prev of rev.get(q.shift()!) ?? []) {
      if (!canEnd.has(prev)) {
        canEnd.add(prev);
        q.push(prev);
      }
    }
  }
  for (const s of stages) {
    if (s.type !== "end" && !canEnd.has(s.key)) {
      c.err(
        "DEAD_END",
        `stages[${s.index}]`,
        `Desde la etapa "${s.name}" no se puede llegar a ninguna etapa final.`,
        s.key,
      );
    }
  }

  // Cycles made only of stages the engine resolves by itself. A loop stage
  // bounds its own cycle (`max_iterations`), so it breaks the chain.
  const auto = new Map(
    stages
      .filter(
        (s) =>
          s.type !== "loop" &&
          ((SYSTEM_STAGE_TYPES as readonly string[]).includes(s.type) ||
            (s.type === "ai" && !s.aiReview)),
      )
      .map((s) => [s.key, s]),
  );
  const state = new Map<string, 1 | 2>();
  const reported = new Set<string>();
  const visit = (key: string, stack: string[]) => {
    state.set(key, 1);
    stack.push(key);
    for (const t of auto.get(key)!.targets) {
      if (!auto.has(t)) continue;
      if (state.get(t) === 1) {
        const cycle = stack.slice(stack.indexOf(t));
        if (!cycle.some((k) => reported.has(k))) {
          cycle.forEach((k) => reported.add(k));
          const names = cycle.map((k) => `"${auto.get(k)!.name}"`).join(" → ");
          c.err(
            "AUTOMATIC_LOOP",
            `stages[${auto.get(t)!.index}]`,
            `Las etapas automáticas ${names} forman un ciclo sin tarea humana ni bucle con límite y se repetirían sin fin.`,
            t,
          );
        }
      } else if (!state.has(t)) visit(t, stack);
    }
    stack.pop();
    state.set(key, 2);
  };
  for (const k of auto.keys()) if (!state.has(k)) visit(k, []);
}

/* ------------------------------------------------------------------ */
/* P2: per-type configuration, guards and error policies               */
/* ------------------------------------------------------------------ */

const TYPE_CONFIG: Record<string, string> = {
  parallel: "parallel",
  subflow: "subflow",
  wait: "wait",
  loop: "loop",
  ai: "ai",
};

function checkTypeConfig(
  s: Json,
  t: string,
  p: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  for (const [type, key] of Object.entries(TYPE_CONFIG)) {
    if (s[key] !== undefined && t !== type) {
      c.err(
        "SHAPE_INVALID",
        `${p}.${key}`,
        `${L} no es de tipo "${type}" y no admite "${key}".`,
        sk,
      );
    }
  }
  if (t === "parallel") checkParallel(s["parallel"], `${p}.parallel`, L, sk, fields, ctx, c);
  if (t === "subflow") checkSubflow(s["subflow"], `${p}.subflow`, L, sk, fields, ctx, c);
  if (t === "wait") checkWait(s["wait"], `${p}.wait`, L, sk, fields, c);
  if (t === "loop") checkLoop(s["loop"], `${p}.loop`, L, sk, fields, c);
  if (t === "ai") checkAi(s["ai"], `${p}.ai`, L, sk, fields, c);
}

/** P6.1: shape and field rules of an `ai` stage. */
function checkAi(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  c: Collector,
) {
  const bad = (sub: string, message: string) =>
    c.err("AI_STEP_INVALID", sub ? `${path}.${sub}` : path, `${L}: ${message}`, sk);
  if (!isObj(raw)) {
    bad("", "el paso de IA necesita su configuración (tarea, instrucciones, campos que lee y campos que escribe).");
    return;
  }
  checkKeys(
    c,
    raw,
    ["task", "instructions", "inputs", "outputs", "confidence_field", "review", "on_error"],
    path,
    sk,
  );
  const task = raw["task"];
  const taskOk = (WORKFLOW_AI_TASKS as readonly unknown[]).includes(task);
  if (!taskOk) {
    bad("task", `la tarea de IA debe ser ${WORKFLOW_AI_TASKS.join(", ")}.`);
  }
  const ins = raw["instructions"];
  if (
    !isNonEmptyStr(ins) ||
    ins.length > WORKFLOW_LIMITS.maxAiInstructions
  ) {
    bad(
      "instructions",
      `las instrucciones son obligatorias y admiten hasta ${WORKFLOW_LIMITS.maxAiInstructions} caracteres.`,
    );
  }
  const keyList = (name: "inputs" | "outputs", max: number, min: number) => {
    const v = raw[name];
    const label = name === "inputs" ? "campos que lee" : "campos que escribe";
    if (!Array.isArray(v) || !v.every(isStr) || v.length < min || v.length > max) {
      bad(
        name,
        min === max
          ? `los ${label} deben ser exactamente ${min}.`
          : `los ${label} deben ser entre ${min} y ${max}.`,
      );
      return [] as string[];
    }
    const seen = new Set<string>();
    for (const k of v as string[]) {
      if (seen.has(k)) bad(name, `el campo "${k}" se repite en los ${label}.`);
      seen.add(k);
    }
    return [...seen];
  };
  const inputs = keyList("inputs", WORKFLOW_LIMITS.maxAiInputs, 1);
  const single =
    taskOk && (task === "classify" || task === "decide" || task === "summarize" || task === "draft");
  const outputs = keyList(
    "outputs",
    single ? 1 : WORKFLOW_LIMITS.maxAiOutputs,
    1,
  );
  if (single && Array.isArray(raw["outputs"]) && raw["outputs"].length > 1) {
    bad("outputs", "esta tarea escribe exactamente un campo.");
  }
  for (const k of inputs) {
    const f = fields.get(k);
    if (!f) {
      c.err("FIELD_UNKNOWN", `${path}.inputs`, `${L} lee el campo "${k}", que no está declarado.`, sk);
    } else if ((WORKFLOW_AI_FORBIDDEN_INPUT_TYPES as readonly string[]).includes(f.type)) {
      bad("inputs", `el campo "${k}" es de tipo ${f.type} y la IA no lo puede leer.`);
    }
  }
  for (const k of outputs) {
    const f = fields.get(k);
    if (!f) {
      c.err("FIELD_UNKNOWN", `${path}.outputs`, `${L} escribe el campo "${k}", que no está declarado.`, sk);
      continue;
    }
    if (f.computed) bad("outputs", `el campo "${k}" es calculado y la IA no puede escribirlo.`);
    if (inputs.includes(k)) bad("outputs", `el campo "${k}" no puede ser a la vez de lectura y de escritura.`);
    if (
      taskOk &&
      !WORKFLOW_AI_OUTPUT_TYPES[task as WorkflowAiTask].includes(f.type)
    ) {
      bad(
        "outputs",
        `el campo "${k}" es de tipo ${f.type} y la tarea "${String(task)}" solo escribe campos de tipo ${WORKFLOW_AI_OUTPUT_TYPES[task as WorkflowAiTask].join(", ")}.`,
      );
    }
  }
  const cf = raw["confidence_field"];
  if (cf !== undefined) {
    const f = isStr(cf) ? fields.get(cf) : undefined;
    if (!f) {
      c.err("FIELD_UNKNOWN", `${path}.confidence_field`, `${L} guarda la confianza en un campo que no está declarado.`, sk);
    } else if (f.type !== "number" || f.computed) {
      bad("confidence_field", "el campo de confianza debe ser numérico y no calculado.");
    } else if (outputs.includes(cf as string) || inputs.includes(cf as string)) {
      bad("confidence_field", "el campo de confianza debe ser distinto de los que lee y escribe.");
    }
  }
  if (raw["review"] !== undefined && typeof raw["review"] !== "boolean") {
    bad("review", '"review" debe ser verdadero o falso.');
  }
  if (raw["on_error"] !== undefined) {
    checkErrorPolicy(raw["on_error"], `${path}.on_error`, L, sk, c);
  }
}

function conditionUsesField(node: unknown, key: string): boolean {
  if (!isObj(node)) return false;
  if (isStr(node["field"])) return node["field"] === key;
  const group = node["all"] ?? node["any"];
  return Array.isArray(group) && group.some((n) => conditionUsesField(n, key));
}

/**
 * P6.1: `decide` routes the request on the answer, so the outcome that leaves
 * the stage needs a branch conditioned on the output field plus a default.
 */
function checkAiDecide(
  s: Json,
  p: string,
  L: string,
  sk: string | undefined,
  aiReview: boolean,
  c: Collector,
) {
  const ai = s["ai"];
  if (!isObj(ai) || ai["task"] !== "decide") return;
  const out = Array.isArray(ai["outputs"]) ? ai["outputs"][0] : undefined;
  const outcome = aiReview ? "approve" : "auto";
  const list = (Array.isArray(s["transitions"]) ? s["transitions"] : []).filter(
    (tr): tr is Json => isObj(tr) && tr["on"] === outcome,
  );
  const conditioned = list.some(
    (tr) => tr["when"] !== undefined && isStr(out) && conditionUsesField(tr["when"], out),
  );
  if (!conditioned) {
    c.err(
      "AI_STEP_INVALID",
      `${p}.transitions`,
      `${L} decide la rama: necesita al menos una transición de "${outcome}" con condición sobre el campo que escribe la IA${isStr(out) ? ` ("${out}")` : ""} y una rama por defecto.`,
      sk,
    );
  }
}

/** P3.4: steps list exactly the form's fields, each once and in order. */
function checkFormSteps(
  form: Json,
  path: string,
  L: string,
  sk: string | undefined,
  c: Collector,
) {
  const steps = form["steps"];
  if (steps === undefined) return;
  const p = `${path}.steps`;
  if (
    !Array.isArray(steps) ||
    steps.length < 1 ||
    steps.length > WORKFLOW_LIMITS.maxFormSteps ||
    !steps.every(
      (st) =>
        isObj(st) &&
        isNonEmptyStr(st["title"]) &&
        (st["title"] as string).length <= 80 &&
        Array.isArray(st["fields"]) &&
        st["fields"].length > 0 &&
        st["fields"].every(isStr) &&
        Object.keys(st).every((k) => k === "title" || k === "fields"),
    )
  ) {
    c.err(
      "FORM_STEPS_INVALID",
      p,
      `${L}: los pasos del formulario deben ser de 1 a ${WORKFLOW_LIMITS.maxFormSteps}, cada uno con un título (máximo 80) y al menos un campo.`,
      sk,
    );
    return;
  }
  const flat = (steps as Json[]).flatMap((st) => st["fields"] as string[]);
  const fields = form["fields"] as string[];
  if (
    flat.length !== fields.length ||
    flat.some((fk, i) => fk !== fields[i])
  ) {
    c.err(
      "FORM_STEPS_INVALID",
      p,
      `${L}: los pasos deben repartir exactamente los campos del formulario, cada uno una vez y en el mismo orden.`,
      sk,
    );
  }
}

function checkFormFields(
  form: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  c: Collector,
) {
  if (form === undefined) return;
  if (!isObj(form) || !Array.isArray(form["fields"]) || !form["fields"].every(isStr)) {
    c.err("SHAPE_INVALID", `${path}.fields`, `${L}: el formulario debe listar las claves de campos.`, sk);
    return;
  }
  checkKeys(c, form, ["fields"], path, sk);
  const used = new Set<string>();
  (form["fields"] as string[]).forEach((fk, j) => {
    if (!fields.has(fk))
      c.err("FIELD_UNKNOWN", `${path}.fields[${j}]`, `${L} usa el campo "${fk}", que no está declarado.`, sk);
    else if (used.has(fk))
      c.err("DUPLICATE_KEY", `${path}.fields[${j}]`, `${L} repite el campo "${fk}" en su formulario.`, sk);
    used.add(fk);
  });
}

function checkParallel(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (!isObj(raw)) {
    c.err("PARALLEL_INVALID", path, `${L} es paralela y necesita sus ramas y su regla de unión.`, sk);
    return;
  }
  checkKeys(c, raw, ["branches", "join", "required"], path, sk);
  const branches = raw["branches"];
  if (
    !Array.isArray(branches) ||
    branches.length < 2 ||
    branches.length > WORKFLOW_LIMITS.maxBranches
  ) {
    c.err(
      "PARALLEL_INVALID",
      `${path}.branches`,
      `${L} necesita entre 2 y ${WORKFLOW_LIMITS.maxBranches} ramas.`,
      sk,
    );
  }
  const list = Array.isArray(branches) ? branches : [];
  const seen = new Set<string>();
  list.forEach((b, j) => {
    const bp = `${path}.branches[${j}]`;
    if (!isObj(b)) {
      c.err("PARALLEL_INVALID", bp, `${L}: la rama #${j + 1} no es válida.`, sk);
      return;
    }
    checkKeys(c, b, ["key", "name", "assignee", "form"], bp, sk);
    if (!isStr(b["key"]) || !WORKFLOW_KEY_PATTERN.test(b["key"])) {
      c.err("KEY_INVALID", `${bp}.key`, `${L}: la rama #${j + 1} tiene una clave no válida.`, sk);
    } else if (seen.has(b["key"])) {
      c.err("DUPLICATE_KEY", `${bp}.key`, `${L} repite la rama "${b["key"]}".`, sk);
    } else seen.add(b["key"]);
    const BL = `${L}, rama "${isNonEmptyStr(b["name"]) ? b["name"] : `#${j + 1}`}"`;
    if (!isNonEmptyStr(b["name"]) || b["name"].length > 200) {
      c.err("SHAPE_INVALID", `${bp}.name`, `${L}: la rama #${j + 1} necesita un nombre.`, sk);
    }
    if (b["assignee"] === undefined) {
      c.err("ASSIGNEE_MISSING", `${bp}.assignee`, `${BL} no tiene responsable.`, sk);
    } else checkAssignee(b["assignee"], `${bp}.assignee`, BL, sk, fields, ctx, c);
    checkFormFields(b["form"], `${bp}.form`, BL, sk, fields, c);
  });
  const join = raw["join"];
  if (join !== "all" && join !== "any" && join !== "n_of_m") {
    c.err(
      "PARALLEL_INVALID",
      `${path}.join`,
      `${L}: la unión debe ser "all" (todas), "any" (cualquiera) o "n_of_m" (N de M).`,
      sk,
    );
  } else if (join === "n_of_m") {
    const r = raw["required"];
    if (!isInt(r) || r < 1 || r > list.length) {
      c.err(
        "PARALLEL_INVALID",
        `${path}.required`,
        `${L}: con la unión "N de M" indica cuántas ramas bastan (1 a ${list.length}).`,
        sk,
      );
    }
  } else if (raw["required"] !== undefined) {
    c.err(
      "PARALLEL_INVALID",
      `${path}.required`,
      `${L}: "required" solo aplica a la unión "N de M".`,
      sk,
    );
  }
}

function checkSubflow(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  ctx: WorkflowValidationContext,
  c: Collector,
) {
  if (!isObj(raw)) {
    c.err("SUBFLOW_INVALID", path, `${L} es un subflujo y necesita los flujos que lanza.`, sk);
    return;
  }
  checkKeys(c, raw, ["flows", "wait", "output"], path, sk);
  const flows = raw["flows"];
  if (!Array.isArray(flows) || flows.length < 1 || flows.length > WORKFLOW_LIMITS.maxSubflows) {
    c.err(
      "SUBFLOW_INVALID",
      `${path}.flows`,
      `${L} debe lanzar entre 1 y ${WORKFLOW_LIMITS.maxSubflows} flujos.`,
      sk,
    );
  }
  const keys = new Set<string>();
  const parentTokens = [
    ...[...fields.keys()].map((k) => `fields.${k}`),
    ...WORKFLOW_INSTANCE_TOKENS,
  ];
  (Array.isArray(flows) ? flows : []).forEach((f, j) => {
    const fp = `${path}.flows[${j}]`;
    if (!isObj(f)) {
      c.err("SUBFLOW_INVALID", fp, `${L}: el subflujo #${j + 1} no es válido.`, sk);
      return;
    }
    checkKeys(c, f, ["flow_key", "map"], fp, sk);
    const key = f["flow_key"];
    if (!isStr(key) || !WORKFLOW_KEY_PATTERN.test(key)) {
      c.err("SUBFLOW_INVALID", `${fp}.flow_key`, `${L}: el subflujo #${j + 1} necesita la clave de un flujo.`, sk);
      return;
    }
    if (key === c.flowKey) {
      c.err("SUBFLOW_INVALID", `${fp}.flow_key`, `${L}: un flujo no puede lanzarse a sí mismo como subflujo.`, sk);
    } else if (ctx.flowKeys && !ctx.flowKeys.includes(key)) {
      c.err("SUBFLOW_INVALID", `${fp}.flow_key`, `${L} lanza el flujo "${key}", que no existe o no está publicado en la tienda.`, sk);
    }
    keys.add(key);
    const map = f["map"];
    if (map === undefined) return;
    if (!isObj(map)) {
      c.err("MAP_INVALID", `${fp}.map`, `${L}: el mapa del subflujo debe ser un objeto.`, sk);
      return;
    }
    for (const [childField, tpl] of Object.entries(map)) {
      if (!WORKFLOW_KEY_PATTERN.test(childField)) {
        c.err("MAP_INVALID", `${fp}.map.${childField}`, `${L}: "${childField}" no es una clave de campo válida del subflujo.`, sk);
      }
      if (!isStr(tpl) || tpl.length > 500) {
        c.err("MAP_INVALID", `${fp}.map.${childField}`, `${L}: el valor de "${childField}" debe ser texto de hasta 500 caracteres.`, sk);
        continue;
      }
      if (hasStrayBraces(tpl)) {
        c.err("MAP_INVALID", `${fp}.map.${childField}`, `${L}: el valor de "${childField}" tiene llaves sueltas.`, sk);
      }
      for (const tok of tokensOf(tpl)) {
        if (!parentTokens.includes(tok)) {
          c.err("TOKEN_UNKNOWN", `${fp}.map.${childField}`, `${L}: la variable {{${tok}}} no existe en este flujo.`, sk);
        }
      }
    }
  });
  if (raw["wait"] !== undefined && typeof raw["wait"] !== "boolean") {
    c.err("SUBFLOW_INVALID", `${path}.wait`, `${L}: "wait" debe ser verdadero o falso.`, sk);
  }
  const output = raw["output"];
  if (output === undefined) return;
  if (raw["wait"] === false) {
    c.err("SUBFLOW_INVALID", `${path}.output`, `${L} no espera a sus hijos, así que no puede recibir variables de vuelta.`, sk);
    return;
  }
  if (!isObj(output)) {
    c.err("MAP_INVALID", `${path}.output`, `${L}: las variables de vuelta deben ser un objeto.`, sk);
    return;
  }
  for (const [parentField, src] of Object.entries(output)) {
    if (!fields.has(parentField)) {
      c.err("FIELD_UNKNOWN", `${path}.output.${parentField}`, `${L} devuelve al campo "${parentField}", que no está declarado.`, sk);
    }
    const parts = isStr(src) ? src.split(".") : [];
    if (
      parts.length !== 2 ||
      !keys.has(parts[0]) ||
      !WORKFLOW_KEY_PATTERN.test(parts[1])
    ) {
      c.err(
        "MAP_INVALID",
        `${path}.output.${parentField}`,
        `${L}: la variable de vuelta de "${parentField}" debe tener la forma "<flujo>.<campo>" con un flujo que este subflujo lanza.`,
        sk,
      );
    }
  }
}

function checkWait(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  c: Collector,
) {
  if (!isObj(raw) || !(WORKFLOW_WAIT_KINDS as readonly unknown[]).includes(raw["kind"])) {
    c.err(
      "WAIT_INVALID",
      path,
      `${L} es una espera y necesita su tipo (${WORKFLOW_WAIT_KINDS.join(", ")}).`,
      sk,
    );
    return;
  }
  const bad = (field: string, msg: string) =>
    c.err("WAIT_INVALID", `${path}.${field}`, `${L}: ${msg}`, sk);
  const intIn = (v: unknown, lo: number, hi: number) => isInt(v) && v >= lo && v <= hi;
  if (raw["time"] !== undefined && !isWaitTime(raw["time"])) {
    bad("time", 'la hora debe tener la forma "HH:mm" (00:00 a 23:59).');
  }
  switch (raw["kind"]) {
    case "duration": {
      checkKeys(c, raw, ["kind", "days", "hours", "minutes"], path, sk);
      const d = raw["days"] ?? 0;
      const h = raw["hours"] ?? 0;
      const m = raw["minutes"] ?? 0;
      if (!intIn(d, 0, 365) || !intIn(h, 0, 8760) || !intIn(m, 0, 525600)) {
        bad("days", "los días (0–365), horas y minutos deben ser enteros no negativos.");
      } else if ((d as number) * 1440 + (h as number) * 60 + (m as number) < 1) {
        bad("minutes", "la espera debe durar al menos 1 minuto.");
      }
      break;
    }
    case "date":
      checkKeys(c, raw, ["kind", "date", "time"], path, sk);
      if (!isIsoDate(raw["date"])) bad("date", "la fecha debe tener la forma AAAA-MM-DD.");
      break;
    case "field": {
      checkKeys(c, raw, ["kind", "field", "offset_days", "time"], path, sk);
      const f = isStr(raw["field"]) ? fields.get(raw["field"]) : undefined;
      if (!f) bad("field", `el campo "${String(raw["field"])}" no está declarado.`);
      else if (f.type !== "date") bad("field", `el campo "${String(raw["field"])}" debe ser de tipo fecha.`);
      if (raw["offset_days"] !== undefined && !intIn(raw["offset_days"], -365, 365)) {
        bad("offset_days", "el desfase debe ser un entero entre -365 y 365 días.");
      }
      break;
    }
    case "business_days":
      checkKeys(c, raw, ["kind", "days", "time"], path, sk);
      if (!intIn(raw["days"], 1, 365)) bad("days", "los días hábiles deben ser un entero entre 1 y 365.");
      break;
    case "day_of_month":
      checkKeys(c, raw, ["kind", "day", "time"], path, sk);
      if (!intIn(raw["day"], 1, 28)) bad("day", "el día del mes debe ser un entero entre 1 y 28.");
      break;
  }
}

function checkLoop(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  fields: FieldMap,
  c: Collector,
) {
  const o = isObj(raw) ? raw : {};
  if (isObj(raw)) checkKeys(c, raw, ["while", "max_iterations"], path, sk);
  const max = o["max_iterations"];
  if (!isInt(max) || max < 1 || max > WORKFLOW_LIMITS.maxLoopIterations) {
    c.err(
      "LOOP_LIMIT_MISSING",
      `${path}.max_iterations`,
      `${L}: el bucle necesita un límite de vueltas (1 a ${WORKFLOW_LIMITS.maxLoopIterations}).`,
      sk,
    );
  }
  if (o["while"] === undefined) {
    c.err("SHAPE_INVALID", `${path}.while`, `${L}: el bucle necesita la condición para repetir.`, sk);
  } else {
    checkCondition(o["while"], `${path}.while`, 1, {
      c,
      fields,
      label: L,
      stageKey: sk,
      rules: 0,
      tooDeepReported: false,
    });
  }
}

/** Stage types a person submits: only there may a guard just block. */
const GUARD_HUMAN_STAGE_TYPES: ReadonlySet<string> = new Set(["form", "approval", "review"]);

function checkGuards(
  raw: unknown,
  t: string,
  p: string,
  L: string,
  sk: string | undefined,
  stageKeys: Set<string>,
  fields: FieldMap,
  c: Collector,
  targets: string[],
) {
  if (raw === undefined) return;
  const path = `${p}.guards`;
  if (t === "end") {
    c.err("GUARD_INVALID", path, `${L} es final y no admite guardas.`, sk);
    return;
  }
  if (!Array.isArray(raw)) {
    c.err("GUARD_INVALID", path, `${L}: las guardas deben ser una lista.`, sk);
    return;
  }
  if (raw.length > WORKFLOW_LIMITS.maxGuards) {
    c.err("LIMIT_EXCEEDED", path, `${L} tiene ${raw.length} guardas y el máximo es ${WORKFLOW_LIMITS.maxGuards}.`, sk);
  }
  raw.forEach((g, j) => {
    const gp = `${path}[${j}]`;
    if (!isObj(g)) {
      c.err("GUARD_INVALID", gp, `${L}: la guarda #${j + 1} no es válida.`, sk);
      return;
    }
    checkKeys(c, g, ["when", "message", "redirect_to"], gp, sk);
    if (g["when"] === undefined) {
      c.err("GUARD_INVALID", `${gp}.when`, `${L}: la guarda #${j + 1} necesita su condición.`, sk);
    } else {
      checkCondition(g["when"], `${gp}.when`, 1, {
        c,
        fields,
        label: L,
        stageKey: sk,
        rules: 0,
        tooDeepReported: false,
      });
    }
    if (!isNonEmptyStr(g["message"]) || g["message"].length > 300) {
      c.err("GUARD_INVALID", `${gp}.message`, `${L}: la guarda #${j + 1} necesita un mensaje de hasta 300 caracteres.`, sk);
    }
    if (g["redirect_to"] === undefined && !GUARD_HUMAN_STAGE_TYPES.has(t)) {
      // Nobody submits a system stage: a guard that only blocks would leave the
      // request stopped with no task and no notice.
      c.err(
        "GUARD_INVALID",
        `${gp}.redirect_to`,
        `${L}: nadie envía esta etapa, así que la guarda #${j + 1} debe redirigir a otra etapa.`,
        sk,
      );
    } else if (g["redirect_to"] !== undefined) {
      if (!isStr(g["redirect_to"]) || !stageKeys.has(g["redirect_to"])) {
        c.err(
          "TRANSITION_TARGET_UNKNOWN",
          `${gp}.redirect_to`,
          `${L}: la guarda #${j + 1} redirige a "${String(g["redirect_to"])}", que no existe.`,
          sk,
        );
      } else if (g["redirect_to"] === sk) {
        c.err("GUARD_INVALID", `${gp}.redirect_to`, `${L}: una guarda no puede redirigir a su propia etapa.`, sk);
      } else targets.push(g["redirect_to"]);
    }
  });
}

function checkErrorPolicy(
  raw: unknown,
  path: string,
  L: string,
  sk: string | undefined,
  c: Collector,
) {
  if (!isObj(raw)) {
    c.err("ERROR_POLICY_INVALID", path, `${L}: la política de error debe ser un objeto.`, sk);
    return;
  }
  checkKeys(c, raw, ["retries", "then", "route_to"], path, sk);
  const r = raw["retries"];
  if (r !== undefined && (!isInt(r) || r < 0 || r > WORKFLOW_LIMITS.maxActionRetries)) {
    c.err(
      "ERROR_POLICY_INVALID",
      `${path}.retries`,
      `${L}: los reintentos deben ser un entero entre 0 y ${WORKFLOW_LIMITS.maxActionRetries}.`,
      sk,
    );
  }
  const then = raw["then"];
  if (then !== undefined && !(WORKFLOW_ERROR_THEN as readonly unknown[]).includes(then)) {
    c.err(
      "ERROR_POLICY_INVALID",
      `${path}.then`,
      `${L}: tras fallar, la acción debe "continue" (seguir), "route" (ir a la ruta de error) o "fail" (terminar la solicitud).`,
      sk,
    );
  }
  if (then === "route") {
    const to = raw["route_to"];
    if (!isStr(to) || !c.stageKeys.has(to)) {
      c.err(
        "ERROR_POLICY_INVALID",
        `${path}.route_to`,
        `${L}: la ruta de error necesita una etapa existente en "route_to".`,
        sk,
      );
    }
  } else if (raw["route_to"] !== undefined) {
    c.err(
      "ERROR_POLICY_INVALID",
      `${path}.route_to`,
      `${L}: "route_to" solo aplica cuando la política es "route".`,
      sk,
    );
  }
}

/** One readable Spanish line per error. */
export function formatWorkflowIssues(
  result: WorkflowValidationResult,
): string[] {
  return result.errors.map((e) => e.message);
}
