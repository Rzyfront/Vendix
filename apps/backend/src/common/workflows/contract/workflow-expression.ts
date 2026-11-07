/**
 * vendix.workflow/v1 — P2 runtime helpers: safe expressions (P2.9), cron
 * schedules (P2.10), the Colombian business-day calendar and wait deadlines
 * (P2.3). Pure and total: nothing here evaluates code, touches the network or
 * throws on bad input.
 *
 * Copied byte for byte into libs/shared-types/workflows/ (canonical),
 * apps/backend/src/common/workflows/contract/ and
 * apps/frontend/src/app/shared/workflows/contract/. Parity is enforced by
 * workflow-contract.parity.spec.ts (backend).
 */
import {
  WORKFLOW_LIMITS,
  WorkflowDefinitionV1,
  WorkflowFieldDef,
  WorkflowWaitDef,
} from "./workflow-contract";

/* ------------------------------------------------------------------ */
/* Expressions (P2.9)                                                  */
/* ------------------------------------------------------------------ */

export type WorkflowExprValue = number | string | boolean | null;

type Node =
  | { k: "lit"; v: WorkflowExprValue }
  | { k: "ref"; name: string }
  | { k: "un"; op: "-" | "!"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export interface WorkflowExpression {
  readonly ast: unknown;
  /** Field keys the expression reads. */
  readonly refs: string[];
}

export type WorkflowExprParse =
  | { ok: true; expr: WorkflowExpression }
  | { ok: false; error: string };

/** Closed function catalog: name → [min args, max args]. */
export const WORKFLOW_EXPR_FUNCTIONS: Record<string, [number, number]> = {
  round: [1, 2],
  floor: [1, 1],
  ceil: [1, 1],
  abs: [1, 1],
  min: [1, 10],
  max: [1, 10],
  if: [3, 3],
  coalesce: [1, 10],
  concat: [1, 10],
  upper: [1, 1],
  lower: [1, 1],
  trim: [1, 1],
  len: [1, 1],
  text: [1, 1],
  number: [1, 1],
  today: [0, 0],
  add_days: [2, 2],
  add_months: [2, 2],
  days_between: [2, 2],
  year: [1, 1],
  month: [1, 1],
  day: [1, 1],
};

const MAX_NODES = 200;
const MAX_DEPTH = 30;
const TOKEN_RE =
  /\s*(?:(\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([a-z_][a-z0-9_]*)|(==|!=|>=|<=|&&|\|\||[-+*/%()<>!,]))/y;

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Tok[] | string {
  const out: Tok[] = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) return `Carácter no permitido cerca de "${src.slice(pos, pos + 10).trim()}".`;
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined)
      out.push({ t: "str", v: m[2].slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3] });
    else out.push({ t: "op", v: m[4] });
  }
  return out;
}

const BIN_LEVELS: string[][] = [
  ["||"],
  ["&&"],
  ["==", "!="],
  ["<", ">", "<=", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

function bad(msg: string): Error {
  return new Error(msg);
}

/** Parses an expression of the closed grammar; never throws. */
export function parseExpression(src: unknown): WorkflowExprParse {
  if (typeof src !== "string" || src.trim() === "") {
    return { ok: false, error: "La fórmula está vacía." };
  }
  if (src.length > WORKFLOW_LIMITS.maxExpressionLength) {
    return {
      ok: false,
      error: `La fórmula supera ${WORKFLOW_LIMITS.maxExpressionLength} caracteres.`,
    };
  }
  const toks = tokenize(src);
  if (typeof toks === "string") return { ok: false, error: toks };
  let i = 0;
  let nodes = 0;
  const refs = new Set<string>();
  const count = (n: Node, depth: number): Node => {
    nodes++;
    if (nodes > MAX_NODES) throw bad("La fórmula es demasiado larga.");
    if (depth > MAX_DEPTH) throw bad("La fórmula tiene demasiados niveles.");
    return n;
  };
  const isOp = (v: string) => {
    const t = toks[i];
    return t !== undefined && t.t === "op" && t.v === v;
  };
  const primary = (depth: number): Node => {
    const t = toks[i];
    if (!t) throw bad("La fórmula termina antes de tiempo.");
    if (t.t === "num") {
      i++;
      return count({ k: "lit", v: t.v }, depth);
    }
    if (t.t === "str") {
      i++;
      return count({ k: "lit", v: t.v }, depth);
    }
    if (t.t === "op" && t.v === "(") {
      i++;
      const e = expr(0, depth + 1);
      if (!isOp(")")) throw bad('Falta cerrar un paréntesis ")".');
      i++;
      return e;
    }
    if (t.t === "op" && (t.v === "-" || t.v === "!")) {
      i++;
      return count({ k: "un", op: t.v, a: primary(depth + 1) }, depth);
    }
    if (t.t === "id") {
      i++;
      if (t.v === "true" || t.v === "false") {
        return count({ k: "lit", v: t.v === "true" }, depth);
      }
      if (t.v === "null") return count({ k: "lit", v: null }, depth);
      if (isOp("(")) {
        const arity = WORKFLOW_EXPR_FUNCTIONS[t.v];
        if (!arity) throw bad(`La función "${t.v}" no existe.`);
        i++;
        const args: Node[] = [];
        if (!isOp(")")) {
          for (;;) {
            args.push(expr(0, depth + 1));
            if (isOp(",")) {
              i++;
              continue;
            }
            break;
          }
        }
        if (!isOp(")")) throw bad(`Falta cerrar la función "${t.v}".`);
        i++;
        if (args.length < arity[0] || args.length > arity[1]) {
          throw bad(
            `La función "${t.v}" recibe ${arity[0] === arity[1] ? arity[0] : `de ${arity[0]} a ${arity[1]}`} valores.`,
          );
        }
        return count({ k: "call", fn: t.v, args }, depth);
      }
      refs.add(t.v);
      return count({ k: "ref", name: t.v }, depth);
    }
    throw bad(`No se esperaba "${t.v}".`);
  };
  const expr = (level: number, depth: number): Node => {
    if (depth > MAX_DEPTH) throw bad("La fórmula tiene demasiados niveles.");
    if (level >= BIN_LEVELS.length) return primary(depth);
    let left = expr(level + 1, depth);
    for (;;) {
      const t = toks[i];
      if (!t || t.t !== "op" || !BIN_LEVELS[level].includes(t.v)) break;
      i++;
      const right = expr(level + 1, depth);
      left = count({ k: "bin", op: t.v, a: left, b: right }, depth);
    }
    return left;
  };
  try {
    const ast = expr(0, 0);
    if (i < toks.length) {
      const t = toks[i];
      throw bad(`No se esperaba "${String(t.v)}".`);
    }
    return { ok: true, expr: { ast, refs: [...refs] } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = ISO_DATE_RE.exec(v.slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 ? d : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toNumber(v: WorkflowExprValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function toText(v: WorkflowExprValue): string {
  if (v === null) return "";
  return typeof v === "string" ? v : String(v);
}

function truthy(v: WorkflowExprValue): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  return false;
}

function clean(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1e10) / 1e10;
}

function scalar(v: unknown): WorkflowExprValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
    return v;
  }
  return null;
}

export interface WorkflowExprOptions {
  /** YYYY-MM-DD used by `today()`; default: the UTC date of now. */
  today?: string;
}

function evalNode(
  n: Node,
  data: Record<string, unknown>,
  opts: WorkflowExprOptions,
): WorkflowExprValue {
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref":
      return Object.prototype.hasOwnProperty.call(data, n.name)
        ? scalar(data[n.name])
        : null;
    case "un": {
      const a = evalNode(n.a, data, opts);
      if (n.op === "!") return !truthy(a);
      const x = toNumber(a);
      return x === null ? null : clean(-x);
    }
    case "bin":
      return evalBin(n.op, n.a, n.b, data, opts);
    case "call":
      return evalCall(n.fn, n.args, data, opts);
  }
}

function evalBin(
  op: string,
  an: Node,
  bn: Node,
  data: Record<string, unknown>,
  opts: WorkflowExprOptions,
): WorkflowExprValue {
  if (op === "&&") {
    return truthy(evalNode(an, data, opts)) && truthy(evalNode(bn, data, opts));
  }
  if (op === "||") {
    return truthy(evalNode(an, data, opts)) || truthy(evalNode(bn, data, opts));
  }
  const a = evalNode(an, data, opts);
  const b = evalNode(bn, data, opts);
  if (op === "==" || op === "!=") {
    const na = toNumber(a);
    const nb = toNumber(b);
    const eq =
      typeof a === "number" || typeof b === "number"
        ? na !== null && nb !== null && na === nb
        : a === b;
    return op === "==" ? eq : !eq;
  }
  if (op === "<" || op === ">" || op === "<=" || op === ">=") {
    if (a === null || b === null) return false;
    let cmp: number;
    if (typeof a === "string" && typeof b === "string") {
      cmp = a < b ? -1 : a > b ? 1 : 0;
    } else {
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na === null || nb === null) return false;
      cmp = na - nb;
    }
    return op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string")) {
    if (toNumber(a) === null || toNumber(b) === null) return toText(a) + toText(b);
  }
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null || y === null) return null;
  switch (op) {
    case "+":
      return clean(x + y);
    case "-":
      return clean(x - y);
    case "*":
      return clean(x * y);
    case "/":
      return y === 0 ? null : clean(x / y);
    case "%":
      return y === 0 ? null : clean(x % y);
    default:
      return null;
  }
}

function evalCall(
  fn: string,
  argNodes: Node[],
  data: Record<string, unknown>,
  opts: WorkflowExprOptions,
): WorkflowExprValue {
  if (fn === "if") {
    return truthy(evalNode(argNodes[0], data, opts))
      ? evalNode(argNodes[1], data, opts)
      : evalNode(argNodes[2], data, opts);
  }
  const args = argNodes.map((a) => evalNode(a, data, opts));
  const num = (k: number) => toNumber(args[k]);
  switch (fn) {
    case "round": {
      const x = num(0);
      const d = args.length > 1 ? num(1) : 0;
      if (x === null || d === null || d < 0 || d > 10) return null;
      const f = Math.pow(10, Math.trunc(d));
      return clean(Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f);
    }
    case "floor":
    case "ceil":
    case "abs": {
      const x = num(0);
      return x === null ? null : clean(Math[fn](x));
    }
    case "min":
    case "max": {
      const xs = args.map(toNumber);
      if (xs.some((x) => x === null)) return null;
      return clean(Math[fn](...(xs as number[])));
    }
    case "coalesce":
      return args.find((a) => a !== null && a !== "") ?? null;
    case "concat":
      return args.map(toText).join("");
    case "upper":
      return toText(args[0]).toUpperCase();
    case "lower":
      return toText(args[0]).toLowerCase();
    case "trim":
      return toText(args[0]).trim();
    case "len":
      return toText(args[0]).length;
    case "text":
      return toText(args[0]);
    case "number":
      return toNumber(args[0]);
    case "today":
      return opts.today ?? isoDate(new Date());
    case "add_days":
    case "add_months": {
      const d = parseIsoDate(args[0]);
      const n = num(1);
      if (!d || n === null) return null;
      if (fn === "add_days") d.setUTCDate(d.getUTCDate() + Math.trunc(n));
      else {
        const day = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + Math.trunc(n));
        const last = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate();
        d.setUTCDate(Math.min(day, last));
      }
      return isoDate(d);
    }
    case "days_between": {
      const a = parseIsoDate(args[0]);
      const b = parseIsoDate(args[1]);
      if (!a || !b) return null;
      return Math.round((b.getTime() - a.getTime()) / 86_400_000);
    }
    case "year":
    case "month":
    case "day": {
      const d = parseIsoDate(args[0]);
      if (!d) return null;
      return fn === "year"
        ? d.getUTCFullYear()
        : fn === "month"
          ? d.getUTCMonth() + 1
          : d.getUTCDate();
    }
    default:
      return null;
  }
}

/** Evaluates a parsed (or raw) expression against request data; never throws. */
export function evaluateExpression(
  expr: WorkflowExpression | string,
  data: Record<string, unknown>,
  opts: WorkflowExprOptions = {},
): WorkflowExprValue {
  let parsed: WorkflowExpression;
  if (typeof expr === "string") {
    const p = parseExpression(expr);
    if (!p.ok) return null;
    parsed = p.expr;
  } else {
    parsed = expr;
  }
  try {
    return evalNode(parsed.ast as Node, data ?? {}, opts);
  } catch {
    return null;
  }
}

/** Value of a computed field coerced to its declared type (null when it does not fit). */
function coerceComputed(
  def: WorkflowFieldDef,
  v: WorkflowExprValue,
): string | number | null {
  if (v === null) return null;
  if (def.type === "number" || def.type === "money") {
    const n = toNumber(v);
    if (n === null) return null;
    return def.type === "money" ? Math.round(n * 100) / 100 : n;
  }
  if (def.type === "date") {
    const d = parseIsoDate(v);
    return d ? isoDate(d) : null;
  }
  return toText(v).slice(0, 4000);
}

/** Computed fields in dependency order (cycles are left out; the validator rejects them). */
export function computedFieldOrder(fields: WorkflowFieldDef[]): WorkflowFieldDef[] {
  const computed = new Map(
    fields.filter((f) => typeof f.compute === "string").map((f) => [f.key, f]),
  );
  const deps = new Map<string, string[]>();
  for (const f of computed.values()) {
    const p = parseExpression(f.compute);
    deps.set(f.key, p.ok ? p.expr.refs.filter((r) => computed.has(r)) : []);
  }
  const out: WorkflowFieldDef[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 2) return true;
    if (state.get(k) === 1) return false;
    state.set(k, 1);
    for (const d of deps.get(k) ?? []) if (!visit(d)) return false;
    state.set(k, 2);
    out.push(computed.get(k)!);
    return true;
  };
  for (const k of computed.keys()) visit(k);
  return out;
}

/**
 * Returns a copy of `data` with every computed field recalculated. Used by
 * the engine on every write and by the forms to show the value live.
 */
export function applyComputedFields(
  definition: Pick<WorkflowDefinitionV1, "fields">,
  data: Record<string, unknown>,
  opts: WorkflowExprOptions = {},
): Record<string, unknown> {
  const order = computedFieldOrder(definition.fields ?? []);
  if (order.length === 0) return data;
  const out: Record<string, unknown> = { ...(data ?? {}) };
  for (const f of order) {
    const v = coerceComputed(f, evaluateExpression(f.compute as string, out, opts));
    if (v === null) delete out[f.key];
    else out[f.key] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cron (P2.10)                                                        */
/* ------------------------------------------------------------------ */

export interface WorkflowCron {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
  domAny: boolean;
  dowAny: boolean;
}

const CRON_FIELDS: { name: string; min: number; max: number; names?: string[] }[] = [
  { name: "minuto", min: 0, max: 59 },
  { name: "hora", min: 0, max: 23 },
  { name: "día del mes", min: 1, max: 31 },
  {
    name: "mes",
    min: 1,
    max: 12,
    names: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  },
  {
    name: "día de la semana",
    min: 0,
    max: 7,
    names: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"],
  },
];

function cronValue(raw: string, f: (typeof CRON_FIELDS)[number]): number | null {
  const lower = raw.toLowerCase();
  if (f.names) {
    const idx = f.names.indexOf(lower);
    if (idx >= 0) return idx + f.min;
  }
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= f.min && n <= f.max ? n : null;
}

/** 5-field cron (minute hour dom month dow) with *, lists, ranges, steps and names. */
export function parseCron(
  src: unknown,
): { ok: true; cron: WorkflowCron } | { ok: false; error: string } {
  if (typeof src !== "string") return { ok: false, error: "La expresión debe ser texto." };
  const parts = src.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error: "La expresión debe tener 5 partes: minuto hora día-del-mes mes día-de-la-semana.",
    };
  }
  const sets: number[][] = [];
  for (let k = 0; k < 5; k++) {
    const f = CRON_FIELDS[k];
    const out = new Set<number>();
    for (const item of parts[k].split(",")) {
      const [range, stepRaw] = item.split("/");
      const step = stepRaw === undefined ? 1 : Number(stepRaw);
      if (!Number.isInteger(step) || step < 1 || (stepRaw !== undefined && !/^\d+$/.test(stepRaw))) {
        return { ok: false, error: `El paso de "${item}" (${f.name}) no es válido.` };
      }
      let lo: number | null;
      let hi: number | null;
      if (range === "*") {
        lo = f.min;
        hi = f.max === 7 ? 6 : f.max;
      } else if (range.includes("-")) {
        const [a, b] = range.split("-");
        lo = cronValue(a, f);
        hi = cronValue(b, f);
      } else {
        lo = cronValue(range, f);
        hi = stepRaw === undefined ? lo : f.max;
      }
      if (lo === null || hi === null || lo > hi) {
        return { ok: false, error: `"${item}" no es válido para ${f.name} (${f.min}–${f.max}).` };
      }
      for (let v = lo; v <= hi; v += step) out.add(k === 4 && v === 7 ? 0 : v);
    }
    sets.push([...out].sort((a, b) => a - b));
  }
  return {
    ok: true,
    cron: {
      minute: sets[0],
      hour: sets[1],
      dom: sets[2],
      month: sets[3],
      dow: sets[4],
      domAny: parts[2] === "*",
      dowAny: parts[4] === "*",
    },
  };
}

export interface WorkflowZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

/** Wall-clock parts of an instant in an IANA time zone (UTC when unknown). */
export function zonedParts(date: Date, timeZone: string): WorkflowZonedParts {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p["year"]),
    month: Number(p["month"]),
    day: Number(p["day"]),
    hour: Number(p["hour"]) % 24,
    minute: Number(p["minute"]),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p["weekday"]),
  };
}

/** UTC instant of a wall-clock time in a time zone. */
export function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let guess = wall;
  for (let k = 0; k < 2; k++) {
    const p = zonedParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - seen;
  }
  return new Date(guess);
}

/** Vixie semantics: when both day fields are restricted, either may match. */
export function cronMatches(cron: WorkflowCron, p: WorkflowZonedParts): boolean {
  if (!cron.minute.includes(p.minute) || !cron.hour.includes(p.hour)) return false;
  if (!cron.month.includes(p.month)) return false;
  const dom = cron.dom.includes(p.day);
  const dow = cron.dow.includes(p.weekday);
  if (cron.domAny && cron.dowAny) return true;
  if (cron.domAny) return dow;
  if (cron.dowAny) return dom;
  return dom || dow;
}

const DOW_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Short Spanish description of the common shapes; the raw expression otherwise. */
export function describeCron(src: string): string {
  const parsed = parseCron(src);
  if (!parsed.ok) return parsed.error;
  const c = parsed.cron;
  const pad = (n: number) => String(n).padStart(2, "0");
  const single = c.minute.length === 1 && c.hour.length === 1;
  const at = single ? `a las ${pad(c.hour[0])}:${pad(c.minute[0])}` : null;
  const allMonths = c.month.length === 12;
  if (at && allMonths) {
    if (c.domAny && c.dowAny) return `Todos los días ${at} (hora de la tienda)`;
    if (c.domAny && c.dow.length === 1) {
      return `Cada ${DOW_ES[c.dow[0]]} ${at} (hora de la tienda)`;
    }
    if (c.dowAny && c.dom.length === 1) {
      return `El día ${c.dom[0]} de cada mes ${at} (hora de la tienda)`;
    }
  }
  if (c.minute.length === 60 && c.hour.length === 24 && c.domAny && c.dowAny && allMonths) {
    return "Cada minuto";
  }
  return `Según la expresión "${src.trim()}" (hora de la tienda)`;
}

/* ------------------------------------------------------------------ */
/* Colombian calendar and wait deadlines (P2.3)                        */
/* ------------------------------------------------------------------ */

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function nextMonday(d: Date): Date {
  const out = new Date(d.getTime());
  const wd = out.getUTCDay();
  if (wd !== 1) out.setUTCDate(out.getUTCDate() + ((8 - wd) % 7));
  return out;
}

const holidayCache = new Map<number, Set<string>>();

/** Colombian public holidays (Ley 51 de 1983 and the Easter-based ones). */
export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const out = new Set<string>();
  const fixed = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d));
  for (const [m, d] of [
    [1, 1],
    [5, 1],
    [7, 20],
    [8, 7],
    [12, 8],
    [12, 25],
  ]) {
    out.add(isoDate(fixed(m, d)));
  }
  for (const [m, d] of [
    [1, 6],
    [3, 19],
    [6, 29],
    [8, 15],
    [10, 12],
    [11, 1],
    [11, 11],
  ]) {
    out.add(isoDate(nextMonday(fixed(m, d))));
  }
  const easter = easterSunday(year);
  const shift = (days: number) => {
    const d = new Date(easter.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  };
  out.add(isoDate(shift(-3)));
  out.add(isoDate(shift(-2)));
  out.add(isoDate(nextMonday(shift(39))));
  out.add(isoDate(nextMonday(shift(60))));
  out.add(isoDate(nextMonday(shift(68))));
  holidayCache.set(year, out);
  return out;
}

export function isColombianBusinessDay(date: string): boolean {
  const d = parseIsoDate(date);
  if (!d) return false;
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !colombianHolidays(d.getUTCFullYear()).has(isoDate(d));
}

/** `date` + N business days (N ≥ 1); the start day itself never counts. */
export function addColombianBusinessDays(date: string, days: number): string | null {
  const d = parseIsoDate(date);
  if (!d || !Number.isInteger(days) || days < 0) return null;
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isColombianBusinessDay(isoDate(d))) left--;
  }
  return isoDate(d);
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isWaitTime(v: unknown): boolean {
  return typeof v === "string" && TIME_RE.test(v);
}

function hm(time: string | undefined, fallback: [number, number]): [number, number] {
  const m = time ? TIME_RE.exec(time) : null;
  return m ? [Number(m[1]), Number(m[2])] : fallback;
}

/**
 * Instant a wait stage resumes. Dates and times are wall-clock in the store's
 * time zone. A date in the past, or a field that is empty or not a date,
 * resumes at once (`now`).
 */
export function computeWaitUntil(
  wait: WorkflowWaitDef,
  ctx: { now: Date; timeZone: string; data: Record<string, unknown> },
): Date {
  const { now, timeZone } = ctx;
  const local = zonedParts(now, timeZone);
  const at = (date: Date, time: [number, number]) =>
    zonedTimeToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      time[0],
      time[1],
      timeZone,
    );
  const notBefore = (d: Date) => (d.getTime() < now.getTime() ? now : d);
  const today = new Date(Date.UTC(local.year, local.month - 1, local.day));
  switch (wait.kind) {
    case "duration": {
      const ms =
        ((wait.days ?? 0) * 1440 + (wait.hours ?? 0) * 60 + (wait.minutes ?? 0)) * 60_000;
      return new Date(now.getTime() + Math.max(ms, 60_000));
    }
    case "date": {
      const d = parseIsoDate(wait.date);
      return d ? notBefore(at(d, hm(wait.time, [0, 0]))) : now;
    }
    case "field": {
      const d = parseIsoDate(ctx.data?.[wait.field]);
      if (!d) return now;
      d.setUTCDate(d.getUTCDate() + Math.trunc(wait.offset_days ?? 0));
      return notBefore(at(d, hm(wait.time, [0, 0])));
    }
    case "business_days": {
      const target = addColombianBusinessDays(isoDate(today), wait.days);
      const d = target ? parseIsoDate(target) : null;
      return d ? notBefore(at(d, hm(wait.time, [local.hour, local.minute]))) : now;
    }
    case "day_of_month": {
      const time = hm(wait.time, [0, 0]);
      let candidate = at(
        new Date(Date.UTC(local.year, local.month - 1, wait.day)),
        time,
      );
      if (candidate.getTime() <= now.getTime()) {
        candidate = at(new Date(Date.UTC(local.year, local.month, wait.day)), time);
      }
      return candidate;
    }
    default:
      return now;
  }
}
