/**
 * vendix.workflow/v1 — pure runtime helpers shared by the engine, the
 * simulator and the editor (single implementation).
 *
 * Copied byte for byte into libs/shared-types/workflows/ (canonical),
 * apps/backend/src/common/workflows/contract/ and
 * apps/frontend/src/app/shared/workflows/contract/. Parity is enforced by
 * workflow-contract.parity.spec.ts (backend).
 */
import {
  HUMAN_STAGE_TYPES,
  OPS_BY_FIELD_TYPE,
  STAGE_OUTCOMES,
  WorkflowAssigneeDef,
  WorkflowConditionGroup,
  WorkflowConditionNode,
  WorkflowConditionRule,
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowStageDef,
  WorkflowTransitionDef,
} from "./workflow-contract";

type Json = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\s-]{7,20}$/;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmptyValue(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isValidIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === m - 1 &&
    t.getUTCDate() === d
  );
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

/** -1 / 0 / 1, or null when the operands are not comparable for the type. */
function compare(type: string, a: unknown, b: unknown): number | null {
  if (type === "number" || type === "money") {
    const x = toNumber(a);
    const y = toNumber(b);
    if (x === null || y === null) return null;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (type === "date") {
    if (!isValidIsoDate(a) || !isValidIsoDate(b)) return null;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (type === "user") {
    const x = toNumber(a);
    const y = toNumber(b);
    if (x === null || y === null) return null;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return null;
}

function evaluateRule(
  rule: WorkflowConditionRule,
  data: Record<string, unknown>,
  fields: WorkflowFieldDef[],
): boolean {
  if (!isObj(rule) || typeof rule.field !== "string") return false;
  const def = fields.find((f) => f.key === rule.field);
  if (!def) return false;
  const allowed = OPS_BY_FIELD_TYPE[def.type];
  if (!allowed || !allowed.includes(rule.op)) return false;
  const left = data[rule.field];
  const right = rule.value;

  switch (rule.op) {
    case "is_empty":
      return isEmptyValue(left);
    case "is_not_empty":
      return !isEmptyValue(left);
    case "is_true":
      return left === true;
    case "is_false":
      return left === false;
    default:
      break;
  }

  // Every remaining operator needs a present left operand (fail closed).
  if (isEmptyValue(left)) return false;

  switch (rule.op) {
    case "eq":
    case "neq": {
      const c = compare(def.type, left, right);
      if (c === null) return false;
      return rule.op === "eq" ? c === 0 : c !== 0;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const c = compare(def.type, left, right);
      if (c === null) return false;
      if (rule.op === "gt") return c > 0;
      if (rule.op === "gte") return c >= 0;
      if (rule.op === "lt") return c < 0;
      return c <= 0;
    }
    case "in":
    case "not_in": {
      if (!Array.isArray(right) || typeof left !== "string") return false;
      const hit = right.some((r) => String(r) === left);
      return rule.op === "in" ? hit : !hit;
    }
    case "contains": {
      if (def.type === "multiselect") {
        return Array.isArray(left) && typeof right === "string"
          ? left.includes(right)
          : false;
      }
      if (typeof left !== "string" || typeof right !== "string") return false;
      return left.toLowerCase().includes(right.toLowerCase());
    }
    default:
      return false;
  }
}

function evaluateNode(
  node: WorkflowConditionNode,
  data: Record<string, unknown>,
  fields: WorkflowFieldDef[],
): boolean {
  if (!isObj(node)) return false;
  if ("all" in node || "any" in node) {
    return evaluateCondition(node as WorkflowConditionGroup, data, fields);
  }
  return evaluateRule(node as WorkflowConditionRule, data, fields);
}

/** Fails closed: unknown field, disallowed operator or type mismatch → false. */
export function evaluateCondition(
  group: WorkflowConditionGroup,
  data: Record<string, unknown>,
  fields: WorkflowFieldDef[],
): boolean {
  if (!isObj(group) || !isObj(data) || !Array.isArray(fields)) return false;
  const g = group as { all?: unknown; any?: unknown };
  if (Array.isArray(g.all)) {
    return (
      g.all.length > 0 &&
      g.all.every((n) => evaluateNode(n as WorkflowConditionNode, data, fields))
    );
  }
  if (Array.isArray(g.any)) {
    return (
      g.any.length > 0 &&
      g.any.some((n) => evaluateNode(n as WorkflowConditionNode, data, fields))
    );
  }
  return false;
}

/** First transition for `outcome` whose `when` is absent or true. */
export function resolveTransition(
  stage: WorkflowStageDef,
  outcome: string,
  data: Record<string, unknown>,
  fields: WorkflowFieldDef[],
): WorkflowTransitionDef | null {
  for (const t of stage.transitions ?? []) {
    if (t.on !== outcome) continue;
    if (!t.when || evaluateCondition(t.when, data, fields)) return t;
  }
  return null;
}

export function findStage(
  def: WorkflowDefinitionV1,
  key: string,
): WorkflowStageDef | undefined {
  return def.stages.find((s) => s.key === key);
}

export function startStage(
  def: WorkflowDefinitionV1,
): WorkflowStageDef | undefined {
  return def.stages.find((s) => s.start === true);
}

export function stageOutcomes(stage: WorkflowStageDef): readonly string[] {
  return STAGE_OUTCOMES[stage.type] ?? [];
}

export function isHumanStage(stage: WorkflowStageDef): boolean {
  return HUMAN_STAGE_TYPES.includes(stage.type);
}

/** Keys of the stage form fields whose `visible_when` passes for `data`. */
export function visibleFieldKeys(
  def: WorkflowDefinitionV1,
  stage: WorkflowStageDef,
  data: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const key of stage.form?.fields ?? []) {
    const f = def.fields.find((x) => x.key === key);
    if (!f) continue;
    if (
      !f.visible_when ||
      evaluateCondition(f.visible_when, data, def.fields)
    ) {
      out.push(key);
    }
  }
  return out;
}

export interface WorkflowFormError {
  field: string;
  message: string;
}

export interface WorkflowFormResult {
  ok: boolean;
  errors: WorkflowFormError[];
  values: Record<string, unknown>;
}

function coerceField(
  f: WorkflowFieldDef,
  v: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const bad = (m: string) => ({ ok: false as const, message: m });
  const good = (value: unknown) => ({ ok: true as const, value });
  const label = `El campo "${f.label}"`;
  switch (f.type) {
    case "number":
    case "money": {
      const n = toNumber(v);
      return n === null ? bad(`${label} debe ser un número válido.`) : good(n);
    }
    case "date":
      return isValidIsoDate(v)
        ? good(v)
        : bad(`${label} debe ser una fecha válida (AAAA-MM-DD).`);
    case "boolean":
      if (typeof v === "boolean") return good(v);
      if (v === "true") return good(true);
      if (v === "false") return good(false);
      return bad(`${label} debe ser verdadero o falso.`);
    case "select": {
      const ok =
        typeof v === "string" && (f.options ?? []).some((o) => o.value === v);
      return ok ? good(v) : bad(`${label} tiene una opción no válida.`);
    }
    case "multiselect": {
      if (!Array.isArray(v))
        return bad(`${label} debe ser una lista de opciones.`);
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      if (!v.every((x) => typeof x === "string" && allowed.has(x))) {
        return bad(`${label} tiene una opción no válida.`);
      }
      return good(Array.from(new Set(v as string[])));
    }
    case "email":
      return typeof v === "string" && v.length <= 254 && EMAIL.test(v)
        ? good(v)
        : bad(`${label} debe ser un correo electrónico válido.`);
    case "phone":
      return typeof v === "string" && PHONE.test(v)
        ? good(v)
        : bad(`${label} debe ser un teléfono válido.`);
    case "text":
      return typeof v === "string" && v.length <= 2000
        ? good(v)
        : bad(`${label} debe ser texto de hasta 2000 caracteres.`);
    case "textarea":
      return typeof v === "string" && v.length <= 10000
        ? good(v)
        : bad(`${label} debe ser texto de hasta 10000 caracteres.`);
    case "file":
      if (isPositiveInt(v)) return good(v);
      if (Array.isArray(v) && v.length > 0 && v.every(isPositiveInt)) {
        return good(v);
      }
      return bad(`${label} debe referenciar un archivo cargado.`);
    case "user":
      return isPositiveInt(v)
        ? good(v)
        : bad(`${label} debe ser un usuario válido.`);
    default:
      return bad(`${label} tiene un tipo no soportado.`);
  }
}

/**
 * Validates and coerces the values submitted for a stage form. Only the
 * visible fields of that form are accepted; anything else is rejected.
 */
export function validateFormValues(
  def: WorkflowDefinitionV1,
  stage: WorkflowStageDef,
  values: Record<string, unknown>,
): WorkflowFormResult {
  const errors: WorkflowFormError[] = [];
  const out: Record<string, unknown> = {};
  if (!isObj(values)) {
    return {
      ok: false,
      errors: [
        { field: "", message: "Los valores del formulario no son válidos." },
      ],
      values: out,
    };
  }
  const formKeys = new Set(stage.form?.fields ?? []);
  const visible = new Set(visibleFieldKeys(def, stage, values));

  for (const key of Object.keys(values)) {
    if (!formKeys.has(key)) {
      errors.push({
        field: key,
        message: `El campo "${key}" no pertenece al formulario de la etapa "${stage.name}".`,
      });
    } else if (!visible.has(key) && !isEmptyValue(values[key])) {
      errors.push({
        field: key,
        message: `El campo "${key}" no está disponible con los datos actuales.`,
      });
    }
  }

  for (const key of visible) {
    const f = def.fields.find((x) => x.key === key);
    if (!f) continue;
    const v = values[key];
    if (isEmptyValue(v)) {
      if (f.required) {
        errors.push({
          field: key,
          message: `El campo "${f.label}" es obligatorio.`,
        });
      }
      continue;
    }
    const r = coerceField(f, v);
    if (r.ok) out[key] = r.value;
    else errors.push({ field: key, message: r.message });
  }

  return { ok: errors.length === 0, errors, values: out };
}

/** `{{ path }}` (no expressions, no filters, no code). */
export const WORKFLOW_TOKEN_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Hard cap of a resolved string, whatever the data holds. */
export const WORKFLOW_TOKEN_MAX_LENGTH = 4000;

export interface WorkflowTokenContext {
  /** Instance data, addressed as `{{fields.<key>}}`. */
  fields?: Record<string, unknown>;
  /** `{{instance.reference}}`, `{{instance.title}}` and `{{instance.subject_id}}`. */
  instance?: {
    reference?: string | null;
    title?: string | null;
    subject_id?: number | null;
  };
  /** Flat event context, addressed as `{{event.<key>}}`. */
  event?: Record<string, unknown>;
  /**
   * When present, only these `event.<key>` / `fields.<key>` paths resolve;
   * anything else becomes an empty string.
   */
  allowed?: readonly string[];
}

function tokenValue(path: string, ctx: WorkflowTokenContext): string {
  if (ctx.allowed && !ctx.allowed.includes(path)) return "";
  const dot = path.indexOf(".");
  if (dot <= 0) return "";
  const root = path.slice(0, dot);
  const key = path.slice(dot + 1);
  if (key === "" || key.includes(".")) return "";
  let source: unknown;
  if (root === "fields") source = ctx.fields;
  else if (root === "event") source = ctx.event;
  else if (root === "instance") source = ctx.instance;
  else return "";
  if (!isObj(source) || !Object.prototype.hasOwnProperty.call(source, key)) {
    return "";
  }
  const v = source[key];
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * Replaces `{{root.key}}` tokens in a string. Pure and total: strings only
 * (the action parses numbers), unknown or unavailable paths become "", values
 * that are not scalar become "", and the result is capped. Used by the engine
 * and the simulator.
 */
export function resolveTokens(
  template: string,
  ctx: WorkflowTokenContext,
): string {
  if (typeof template !== "string") return "";
  const out = template.replace(WORKFLOW_TOKEN_PATTERN, (_m, path: string) =>
    tokenValue(path, ctx),
  );
  return out.length > WORKFLOW_TOKEN_MAX_LENGTH
    ? out.slice(0, WORKFLOW_TOKEN_MAX_LENGTH)
    : out;
}

/** Deterministic JSON: object keys sorted at every level, no whitespace. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v === null || typeof v !== "object") {
      const s = JSON.stringify(v);
      return s === undefined ? "null" : s;
    }
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
    const o = v as Json;
    const parts: string[] = [];
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined || typeof o[k] === "function") continue;
      parts.push(`${JSON.stringify(k)}:${walk(o[k])}`);
    }
    return `{${parts.join(",")}}`;
  };
  return walk(value);
}

function normAssignee<T extends WorkflowAssigneeDef | undefined>(a: T): T {
  if (a && a.kind === "group" && a.strategy === undefined) {
    return { ...a, strategy: "any" } as T;
  }
  return a;
}

/** Deep copy with defaults filled; use before hashing / publishing. */
export function normalizeDefinition(
  def: WorkflowDefinitionV1,
): WorkflowDefinitionV1 {
  const copy: WorkflowDefinitionV1 = JSON.parse(JSON.stringify(def));
  copy.triggers = copy.triggers ?? [{ kind: "manual" }];
  for (const s of copy.stages ?? []) {
    if (s.assignee) s.assignee = normAssignee(s.assignee);
    if (s.due?.on_overdue?.escalate_to) {
      s.due.on_overdue.escalate_to = normAssignee(s.due.on_overdue.escalate_to);
    }
    for (const a of [...(s.on_enter ?? []), ...(s.on_exit ?? [])]) {
      if (a.action === "notify") a.to = normAssignee(a.to);
      if (
        a.action === "vendix.crm_task.create" &&
        isObj(a.map) &&
        isObj(a.map["assignee"])
      ) {
        a.map["assignee"] = normAssignee(a.map["assignee"] as WorkflowAssigneeDef);
      }
    }
    for (const r of s.requirements ?? []) {
      if (
        (r.kind === "upload" || r.kind === "signature") &&
        r.blocks_exit === undefined
      ) {
        r.blocks_exit = true;
      }
    }
  }
  return copy;
}
