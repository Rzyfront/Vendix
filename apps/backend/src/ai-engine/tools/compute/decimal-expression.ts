import Decimal from 'decimal.js';

/**
 * Pure decimal expression evaluator for the `compute` tool (F7/T48).
 *
 * No `eval`/`Function`/`vm`: own tokenizer + recursive-descent parser over a
 * closed grammar (numbers, identifiers resolved from a map, `+ - * /`, unary
 * minus, parentheses and a fixed function list). Arithmetic runs in a cloned
 * `Decimal` so `0.1 + 0.2` is exactly `0.3`.
 *
 * Null convention ("crecimiento sin base falsa", skill vendix-analytics-metrics):
 * - `pct_change(cur, prev)` mirrors `computeGrowth`
 *   (domains/store/analytics/analytics-metrics.contract.ts:307): null when
 *   prev = 0, otherwise (cur - prev) / |prev| * 100.
 * - `margin(revenue, cost)` mirrors `computeProductMargin`/`productMarginPct`
 *   (analytics-metrics.contract.ts:356/389): null when revenue <= 0.
 * A null never turns into 0: it propagates through the whole expression.
 *
 * Bounded magnitude (no DoS): the backend is one process shared by every
 * store, and `toFixed()` materializes every zero of an exponent. So scientific
 * notation is rejected at every entry (literals, variables, block cells), the
 * clone caps the exponent at ±MAX_DECIMAL_EXPONENT, and an operation that
 * overflows or underflows yields a typed null instead of Infinity/NaN/0. The
 * longest string this module can return is ~105 characters.
 */

/** |x| must stay below 1e31 and above 1e-31 (or be exactly 0). */
export const MAX_DECIMAL_EXPONENT = 30;
/** Longest decimal string accepted as input (a full-precision result fits). */
export const MAX_DECIMAL_INPUT_LENGTH = 128;

const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP, // half away from zero, like analytics `round2`
  maxE: MAX_DECIMAL_EXPONENT,
  minE: -MAX_DECIMAL_EXPONENT,
});

export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_EXPRESSION_DEPTH = 32;

const OUT_OF_RANGE = `Fuera de rango: el cálculo se sale de ±1e${MAX_DECIMAL_EXPONENT} (o es más pequeño que 1e-${MAX_DECIMAL_EXPONENT}); no hay resultado válido.`;
const PLAIN_DECIMAL_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const NUMBER_LIKE_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Single entry for every external number (variables, block cells, filter
 * values). Returns the bounded Decimal, `null` when the value is not a number
 * at all (text, boolean, hex, "Infinity"), or `'out_of_range'` when it is a
 * number this module refuses: scientific notation in a string, too many
 * digits, or a magnitude outside ±1e30. Never builds a Decimal from a string
 * carrying an exponent, so the cost is bounded by MAX_DECIMAL_INPUT_LENGTH.
 */
export function parseBoundedDecimal(
  value: unknown,
): Decimal | null | 'out_of_range' {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return null;
    if (!Number.isFinite(value)) return 'out_of_range';
    const d = new D(value);
    return !d.isFinite() || (d.isZero() && value !== 0) ? 'out_of_range' : d;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || !NUMBER_LIKE_RE.test(text)) return null;
  if (text.length > MAX_DECIMAL_INPUT_LENGTH || !PLAIN_DECIMAL_RE.test(text)) {
    return 'out_of_range';
  }
  const d = new D(text);
  // Underflow would silently become 0: only an all-zero literal is a real 0.
  return !d.isFinite() || (d.isZero() && /[1-9]/.test(text))
    ? 'out_of_range'
    : d;
}

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

export interface DecimalExpressionResult {
  /** Decimal string (no float), or null when the result has no valid base. */
  value: string | null;
  reason?: string;
}

type Token =
  | { t: 'num'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

/** Internal value: a Decimal or a typed null carrying its reason. */
type Val = Decimal | { nil: string };
const isNil = (v: Val): v is { nil: string } => !(v instanceof D);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`Número mal formado en la posición ${i + 1}.`);
      i += m[0].length;
      if (i < src.length && /[a-zA-Z_]/.test(src[i])) {
        throw new ExpressionError(
          `Notación científica o texto pegado a un número ("${m[0]}${src[i]}…") no permitido: escribe el número completo, sin exponente.`,
        );
      }
      out.push({ t: 'num', v: m[0] });
    } else if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/(),'.includes(c)) {
      out.push({ t: 'op', v: c as '+' });
      i++;
    } else {
      throw new ExpressionError(
        `Carácter no permitido "${c}" en la posición ${i + 1}. Usa solo números, variables, + - * /, paréntesis y funciones.`,
      );
    }
  }
  return out;
}

/** Overflow (Infinity/NaN) never leaves an operation as a value. */
function bounded(v: Decimal): Val {
  return v.isFinite() ? v : { nil: OUT_OF_RANGE };
}
function mul(a: Decimal, b: Decimal): Val {
  const r = a.times(b);
  // minE underflow collapses to 0: a product is 0 only when a factor is.
  return r.isZero() && !a.isZero() && !b.isZero() ? { nil: OUT_OF_RANGE } : bounded(r);
}
/** Caller guarantees `b` is not zero. */
function div(a: Decimal, b: Decimal): Val {
  const r = a.div(b);
  return r.isZero() && !a.isZero() ? { nil: OUT_OF_RANGE } : bounded(r);
}
/** (a / b) * 100, with both steps range-checked. */
function ratio100(a: Decimal, b: Decimal): Val {
  const q = div(a, b);
  return isNil(q) ? q : mul(q, new D(100));
}

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  round: { min: 1, max: 2 },
  abs: { min: 1, max: 1 },
  min: { min: 1, max: 50 },
  max: { min: 1, max: 50 },
  sum: { min: 1, max: 50 },
  avg: { min: 1, max: 50 },
  pct: { min: 2, max: 2 },
  pct_change: { min: 2, max: 2 },
  margin: { min: 2, max: 2 },
};

function callFn(name: string, args: Val[]): Val {
  const spec = Object.prototype.hasOwnProperty.call(FUNCTIONS, name)
    ? FUNCTIONS[name]
    : undefined;
  if (!spec) {
    throw new ExpressionError(
      `Función desconocida "${name}". Disponibles: ${Object.keys(FUNCTIONS).join(', ')}.`,
    );
  }
  if (args.length < spec.min || args.length > spec.max) {
    throw new ExpressionError(
      `${name}() recibe ${spec.min === spec.max ? spec.min : `${spec.min} a ${spec.max}`} argumento(s) y llegaron ${args.length}.`,
    );
  }
  const nil = args.find(isNil);
  if (nil) return nil;
  const n = args as Decimal[];
  switch (name) {
    case 'round': {
      const places = n[1] === undefined ? 0 : n[1].toNumber();
      if (!Number.isInteger(places) || places < 0 || places > 12) {
        throw new ExpressionError('round(x, n): n debe ser un entero entre 0 y 12.');
      }
      return n[0].toDecimalPlaces(places, D.ROUND_HALF_UP);
    }
    case 'abs':
      return n[0].abs();
    case 'min':
      return D.min(...n);
    case 'max':
      return D.max(...n);
    case 'sum':
      return bounded(D.sum(...n));
    case 'avg': {
      const total = bounded(D.sum(...n));
      return isNil(total) ? total : div(total, new D(n.length));
    }
    case 'pct':
      return n[1].isZero()
        ? { nil: 'División por cero: el total es 0, no hay porcentaje.' }
        : ratio100(n[0], n[1]);
    case 'pct_change': {
      if (n[1].isZero()) {
        return { nil: 'Sin base de comparación: el periodo anterior es 0.' };
      }
      const diff = bounded(n[0].minus(n[1]));
      return isNil(diff) ? diff : ratio100(diff, n[1].abs());
    }
    case 'margin': {
      if (n[0].lte(0)) {
        return {
          nil: 'Sin ingresos: el margen no se puede medir con ingreso menor o igual a 0.',
        };
      }
      const diff = bounded(n[0].minus(n[1]));
      return isNil(diff) ? diff : ratio100(diff, n[0]);
    }
  }
  /* istanbul ignore next */
  throw new ExpressionError(`Función desconocida "${name}".`);
}

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly vars: Map<string, Decimal>,
    private readonly rejected: Set<string>,
  ) {}

  parse(): Val {
    const v = this.expr();
    if (this.pos < this.tokens.length) {
      throw new ExpressionError(`Sobra texto después de la expresión (cerca de "${this.show()}").`);
    }
    return v;
  }

  private show(): string {
    const t = this.tokens[this.pos];
    return t ? t.v : 'fin';
  }
  private peekOp(...ops: string[]): string | null {
    const t = this.tokens[this.pos];
    return t && t.t === 'op' && ops.includes(t.v) ? t.v : null;
  }
  private enter() {
    if (++this.depth > MAX_EXPRESSION_DEPTH) {
      throw new ExpressionError(`La expresión anida más de ${MAX_EXPRESSION_DEPTH} niveles; simplifícala en pasos.`);
    }
  }

  private expr(): Val {
    this.enter();
    let left = this.term();
    for (let op = this.peekOp('+', '-'); op; op = this.peekOp('+', '-')) {
      this.pos++;
      const right = this.term();
      left = this.bin(op, left, right);
    }
    this.depth--;
    return left;
  }

  private term(): Val {
    let left = this.unary();
    for (let op = this.peekOp('*', '/'); op; op = this.peekOp('*', '/')) {
      this.pos++;
      const right = this.unary();
      left = this.bin(op, left, right);
    }
    return left;
  }

  private bin(op: string, a: Val, b: Val): Val {
    if (isNil(a)) return a;
    if (isNil(b)) return b;
    if (op === '+') return bounded(a.plus(b));
    if (op === '-') return bounded(a.minus(b));
    if (op === '*') return mul(a, b);
    return b.isZero() ? { nil: 'División por cero: no hay resultado válido.' } : div(a, b);
  }

  private unary(): Val {
    if (this.peekOp('-')) {
      this.pos++;
      this.enter();
      const v = this.unary();
      this.depth--;
      return isNil(v) ? v : v.neg();
    }
    if (this.peekOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Val {
    const t = this.tokens[this.pos];
    if (!t) throw new ExpressionError('La expresión termina antes de tiempo: falta un valor.');
    if (t.t === 'num') {
      this.pos++;
      const literal = parseBoundedDecimal(t.v);
      if (literal === null || literal === 'out_of_range') {
        throw new ExpressionError(
          `El número "${t.v.length > 24 ? `${t.v.slice(0, 24)}…` : t.v}" está fuera del rango admitido (±1e${MAX_DECIMAL_EXPONENT}).`,
        );
      }
      return literal;
    }
    if (t.t === 'id') {
      this.pos++;
      if (this.peekOp('(')) {
        this.pos++;
        const args: Val[] = [];
        if (!this.peekOp(')')) {
          do {
            args.push(this.expr());
          } while (this.peekOp(',') && (this.pos++, true));
        }
        if (!this.peekOp(')')) throw new ExpressionError(`Falta cerrar el paréntesis de ${t.v}().`);
        this.pos++;
        return callFn(t.v, args);
      }
      const v = this.vars.get(t.v);
      if (!v && this.rejected.has(t.v)) {
        throw new ExpressionError(
          `La variable "${t.v}" no es un decimal admitido: sin notación científica y dentro de ±1e${MAX_DECIMAL_EXPONENT}.`,
        );
      }
      if (!v) {
        throw new ExpressionError(
          `Variable desconocida "${t.v}". Defínela en "variables" o usa el name de una expresión anterior.`,
        );
      }
      return v;
    }
    if (t.v === '(') {
      this.pos++;
      const v = this.expr();
      if (!this.peekOp(')')) throw new ExpressionError('Falta cerrar un paréntesis.');
      this.pos++;
      return v;
    }
    throw new ExpressionError(`Símbolo inesperado "${t.v}". Revisa la sintaxis.`);
  }
}

/** Evaluates `expression`; throws `ExpressionError` on invalid syntax/variables. */
export function evaluateDecimalExpression(
  expression: string,
  variables: Record<string, number | string> = {},
): DecimalExpressionResult {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new ExpressionError('La expresión está vacía.');
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(
      `La expresión supera ${MAX_EXPRESSION_LENGTH} caracteres; divídela en varias expresiones encadenadas.`,
    );
  }
  const map = new Map<string, Decimal>();
  const rejected = new Set<string>();
  for (const [k, raw] of Object.entries(variables)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
    const d = parseBoundedDecimal(raw);
    // Non-numeric variable: stays undefined, so using it is "desconocida".
    if (d === 'out_of_range') rejected.add(k);
    else if (d !== null) map.set(k, d);
  }
  const result = new Parser(tokenize(expression), map, rejected).parse();
  if (isNil(result)) return { value: null, reason: result.nil };
  // Defensive: every operation is range-checked, so this never fires.
  if (!result.isFinite()) return { value: null, reason: OUT_OF_RANGE };
  return { value: result.toFixed() };
}
