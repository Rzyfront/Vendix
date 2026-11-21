import Decimal from 'decimal.js';
import {
  RegisteredTool,
  buildToolErrorEnvelope,
  buildToolSuccessEnvelope,
} from '../interfaces/tool.interface';
import {
  ExpressionError,
  evaluateDecimalExpression,
} from '../compute/decimal-expression';

export const COMPUTE_MAX_EXPRESSIONS = 20;
const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * `compute` (F7/T48): exact decimal arithmetic for percentages, variations,
 * margins and simple projections. Pure and read-only: touches no business
 * data and writes nothing, so it needs no permission (same criterion as
 * `suggest_followup`/`vex_render_*`).
 */
export function createComputeTools(): RegisteredTool[] {
  return [
    {
      name: 'compute',
      access: 'public',
      accessReason:
        'Pure arithmetic over numbers the caller already holds; reads no business data and writes nothing.',
      version: '1',
      domain: 'compute',
      readOnly: true,
      description:
        'Calcula con aritmética decimal exacta. SIEMPRE usa esta herramienta para porcentajes, variaciones entre periodos, márgenes, promedios, totales y proyecciones simples en vez de calcular de cabeza. Cada expresión usa números, variables, + - * /, paréntesis y las funciones round(x,n), abs, min, max, sum, avg, pct(parte,total), pct_change(actual,anterior) y margin(ingreso,costo). Las expresiones posteriores pueden usar el name de las anteriores. Si no hay base válida (división por cero, periodo anterior en 0) el valor es null con un motivo: dilo así, nunca lo presentes como 0 %.',
      parameters: {
        type: 'object',
        properties: {
          expressions: {
            type: 'array',
            description: `De 1 a ${COMPUTE_MAX_EXPRESSIONS} expresiones, evaluadas en orden.`,
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description:
                    'Identificador (letras, números y _) para reusar el resultado.',
                },
                expression: {
                  type: 'string',
                  description: 'Ej.: pct_change(ventas_mes, ventas_anterior).',
                },
              },
              required: ['name', 'expression'],
            },
          },
          variables: {
            type: 'object',
            description:
              'Valores numéricos con nombre, ej. {"ventas_mes": 1200000}.',
          },
          decimals: {
            type: 'integer',
            description: 'Decimales del resultado (0 a 6, por defecto 2).',
          },
        },
        required: ['expressions'],
      },
      handler: async (args) => {
        const fail = (message: string, next: string) =>
          JSON.stringify(buildToolErrorEnvelope('compute', message, next));

        const list = args.expressions;
        if (!Array.isArray(list) || list.length < 1) {
          return fail(
            'Falta expressions.',
            'Envía al menos una expresión con name y expression.',
          );
        }
        if (list.length > COMPUTE_MAX_EXPRESSIONS) {
          return fail(
            `Máximo ${COMPUTE_MAX_EXPRESSIONS} expresiones por llamada (llegaron ${list.length}).`,
            'Divide el cálculo en varias llamadas.',
          );
        }
        const decimals =
          args.decimals === undefined ? 2 : Number(args.decimals);
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
          return fail(
            'decimals debe ser un entero entre 0 y 6.',
            'Corrige decimals.',
          );
        }

        const scope: Record<string, number | string> = {};
        const rawVars = args.variables;
        if (rawVars && typeof rawVars === 'object' && !Array.isArray(rawVars)) {
          for (const [k, v] of Object.entries(
            rawVars as Record<string, unknown>,
          )) {
            if (typeof v !== 'number' && typeof v !== 'string') {
              return fail(
                `La variable "${k}" no es un número.`,
                'Las variables deben ser numéricas.',
              );
            }
            scope[k] = v;
          }
        }

        const results: Array<{
          name: string;
          value: string | null;
          reason?: string;
        }> = [];
        const seen = new Set<string>();
        for (const item of list) {
          const name = typeof item?.name === 'string' ? item.name.trim() : '';
          if (!NAME_RE.test(name)) {
            return fail(
              `El name "${String(item?.name)}" no es válido.`,
              'Usa letras, números y _, sin empezar por número.',
            );
          }
          if (seen.has(name)) {
            return fail(
              `El name "${name}" está repetido.`,
              'Usa un name distinto por expresión.',
            );
          }
          seen.add(name);
          try {
            const r = evaluateDecimalExpression(
              String(item.expression ?? ''),
              scope,
            );
            if (r.value === null) {
              results.push({ name, value: null, reason: r.reason });
            } else {
              const value = new Decimal(r.value)
                .toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
                .toFixed(decimals);
              results.push({ name, value });
              scope[name] = r.value; // later expressions chain on full precision
            }
          } catch (error) {
            if (error instanceof ExpressionError) {
              return fail(
                `"${name}": ${error.message}`,
                'Corrige la expresión y vuelve a llamar compute.',
              );
            }
            throw error;
          }
        }
        return JSON.stringify(buildToolSuccessEnvelope('compute', { results }));
      },
    },
  ];
}
