/**
 * vendix.workflow/v1 — pure, total validator (never throws).
 *
 * Copied byte for byte into libs/shared-types/workflows/ (canonical),
 * apps/backend/src/common/workflows/contract/ and
 * apps/frontend/src/app/shared/workflows/contract/. Parity is enforced by
 * workflow-contract.parity.spec.ts (backend). Messages are user-facing Spanish.
 */
import {
  HUMAN_STAGE_TYPES,
  OPS_BY_FIELD_TYPE,
  STAGE_OUTCOMES,
  VALUELESS_OPS,
  WORKFLOW_ACTIONS,
  WORKFLOW_CONDITION_OPS,
  WORKFLOW_END_OUTCOMES,
  WORKFLOW_FIELD_TYPES,
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_LIMITS,
  WORKFLOW_REQUIREMENT_KINDS,
  WORKFLOW_SCHEMA_V1,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_SUBJECT_TYPES,
  WorkflowFieldType,
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
}

type Json = Record<string, unknown>;
type FieldMap = Map<string, { type: WorkflowFieldType }>;

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
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || v > 25) {
    c.err(
      "SHAPE_INVALID",
      path,
      "El tamaño máximo debe estar entre 1 y 25 MB.",
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
  if (op === "in" || op === "not_in") {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every(
        (x) => isStr(x) || (typeof x === "number" && Number.isFinite(x)),
      )
    ) {
      bad("debe ser una lista de textos o números");
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
  }
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
      checkKeys(c, s, ["type"], "subject");
    }
  }
  if (input["triggers"] !== undefined) {
    if (
      !Array.isArray(input["triggers"]) ||
      !input["triggers"].every(
        (t) =>
          isObj(t) && t["kind"] === "manual" && Object.keys(t).length === 1,
      )
    ) {
      c.err(
        "SHAPE_INVALID",
        "triggers",
        'Por ahora el único disparador permitido es {"kind":"manual"}.',
      );
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

  const fields = checkFields(input["fields"], c);
  const stages = checkStages(input["stages"], fields, ctx, c);
  checkGraph(stages, c);
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
      map.set(f["key"] as string, { type: f["type"] as WorkflowFieldType });
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
  return map;
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
        "outcome",
        "assignee",
        "quorum",
        "form",
        "requirements",
        "transitions",
        "due",
        "on_enter",
        "on_exit",
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
    const type = s["type"];
    if (!(WORKFLOW_STAGE_TYPES as readonly unknown[]).includes(type)) {
      c.err("SHAPE_INVALID", `${p}.type`, `${L} tiene un tipo no válido.`, sk);
      return;
    }
    const t = type as keyof typeof STAGE_OUTCOMES;
    const human = (HUMAN_STAGE_TYPES as readonly string[]).includes(t);

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
          `${L} es ${t === "end" ? "final" : "automática"} y no debe tener responsable.`,
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
      if (!human)
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
        checkKeys(c, s["form"], ["fields"], `${p}.form`, sk);
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
    checkActions(s["on_exit"], `${p}.on_exit`, L, sk, fields, ctx, c);

    // transitions
    const targets: string[] = [];
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
      checkTransitions(s["transitions"], p, L, t, sk, keys, fields, c, targets);
    }

    if (keyOk) {
      infos.push({
        key: s["key"] as string,
        name,
        type: t,
        start: s["start"] === true,
        index: i,
        targets,
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
          ["kind", "key", "label", "accept", "max_size_mb", "blocks_exit"],
          p,
          sk,
        );
        checkAccept(c, r["accept"], `${p}.accept`, sk);
        checkMaxSize(c, r["max_size_mb"], `${p}.max_size_mb`, sk);
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
  const outcomes = STAGE_OUTCOMES[t];
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
  if (t === "automatic" && !byOn.has("auto")) {
    c.err(
      "DEFAULT_BRANCH_MISSING",
      path,
      `${L} es automática y necesita una transición por defecto para "auto".`,
      sk,
    );
  }
  if (list.length > 0 && (HUMAN_STAGE_TYPES as readonly string[]).includes(t)) {
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

  // Cycles made only of automatic stages.
  const auto = new Map(
    stages.filter((s) => s.type === "automatic").map((s) => [s.key, s]),
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
            `Las etapas automáticas ${names} forman un ciclo sin tarea humana y se repetirían sin fin.`,
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

/** One readable Spanish line per error. */
export function formatWorkflowIssues(
  result: WorkflowValidationResult,
): string[] {
  return result.errors.map((e) => e.message);
}
