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
 */

const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP, // half away from zero, like analytics `round2`
});

export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_EXPRESSION_DEPTH = 32;

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
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExpressionError(`Número mal formado en la posición ${i + 1}.`);
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
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
      return D.sum(...n);
    case 'avg':
      return D.sum(...n).div(n.length);
    case 'pct':
      return n[1].isZero()
        ? { nil: 'División por cero: el total es 0, no hay porcentaje.' }
        : n[0].div(n[1]).times(100);
    case 'pct_change':
      return n[1].isZero()
        ? { nil: 'Sin base de comparación: el periodo anterior es 0.' }
        : n[0].minus(n[1]).div(n[1].abs()).times(100);
    case 'margin':
      return n[0].lte(0)
        ? { nil: 'Sin ingresos: el margen no se puede medir con ingreso menor o igual a 0.' }
        : n[0].minus(n[1]).div(n[0]).times(100);
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
    if (op === '+') return a.plus(b);
    if (op === '-') return a.minus(b);
    if (op === '*') return a.times(b);
    return b.isZero() ? { nil: 'División por cero: no hay resultado válido.' } : a.div(b);
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
      return new D(t.v);
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
  for (const [k, raw] of Object.entries(variables)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) continue;
    try {
      const d = new D(raw as string | number);
      if (d.isFinite()) map.set(k, d);
    } catch {
      /* non-numeric variable: stays undefined, so using it is "desconocida" */
    }
  }
  const result = new Parser(tokenize(expression), map).parse();
  if (isNil(result)) return { value: null, reason: result.nil };
  return { value: result.toFixed() };
}
