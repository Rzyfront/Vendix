/**
 * Validación en el borde del registry (T3).
 *
 * `executeTool` es el choke point de toda ejecución —agent loop, voz realtime
 * y MCP—, así que los args se validan aquí contra el JSON Schema del tool
 * ANTES de que corra cualquier `preview` o `handler`. El fallo no lanza:
 * devuelve `{error, next_step}` en español, la misma doctrina de los handlers
 * (`writes.tools.ts`), para que el modelo pueda corregirse en el turno.
 *
 * Cubre el subconjunto de JSON Schema que usan los tools: `type`
 * (string/number/integer/boolean/array/object), `enum`, `required`,
 * `properties` e `items`. Palabras desconocidas se ignoran a propósito: un
 * schema futuro con `pattern` o `format` no debe tumbar el registry.
 */

export interface ToolArgsValidation {
  ok: boolean;
  /** Mensaje en español con lo que falló. Solo cuando `ok` es false. */
  error?: string;
  /** Cómo recuperarse, con los campos esperados. Solo cuando `ok` es false. */
  next_step?: string;
}

const TYPE_LABELS: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  integer: 'un número entero',
  boolean: 'un booleano (true/false)',
  array: 'una lista',
  object: 'un objeto',
};

function typeLabel(expected: string): string {
  return TYPE_LABELS[expected] ?? `de tipo ${expected}`;
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    default:
      // Tipo desconocido: no se puede juzgar, no se bloquea.
      return true;
  }
}

/**
 * Los providers a veces serializan un número como cadena (`limit: "10"`).
 * Los handlers ya lo toleran (`clamp`, `Number()`), así que el borde lo
 * coacciona en el mismo objeto en vez de rechazar una llamada válida.
 * Devuelve false cuando no hay coerción posible.
 */
function coerceInPlace(
  holder: Record<string, any> | any[],
  key: string | number,
  value: unknown,
  expected: string,
): boolean {
  if (
    (expected === 'number' || expected === 'integer') &&
    typeof value === 'string' &&
    value.trim() !== ''
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return false;
    if (expected === 'integer' && !Number.isInteger(parsed)) return false;
    holder[key] = parsed;
    return true;
  }
  return false;
}

function checkValue(
  value: unknown,
  schema: Record<string, any>,
  path: string,
  errors: string[],
  holder?: Record<string, any> | any[],
  key?: string | number,
): void {
  const expected = schema?.type;
  if (typeof expected === 'string' && !matchesType(value, expected)) {
    const coerced =
      holder !== undefined && key !== undefined
        ? coerceInPlace(holder, key, value, expected)
        : false;
    if (!coerced) {
      errors.push(`El campo "${path}" debe ser ${typeLabel(expected)}.`);
      return;
    }
    value = holder![key!];
  }

  if (Array.isArray(schema?.enum) && !schema.enum.includes(value)) {
    errors.push(
      `El campo "${path}" tiene un valor no válido (${JSON.stringify(value)}). Valores esperados: ${schema.enum.map((option: unknown) => JSON.stringify(option)).join(', ')}.`,
    );
  }

  if (expected === 'array' && Array.isArray(value) && schema?.items) {
    value.forEach((item, index) => {
      checkValue(item, schema.items, `${path}[${index}]`, errors, value, index);
    });
  }

  if (
    expected === 'object' &&
    schema?.properties &&
    typeof value === 'object' &&
    value !== null
  ) {
    checkProperties(
      value as Record<string, any>,
      schema.properties,
      schema.required,
      path,
      errors,
    );
  }
}

function checkProperties(
  args: Record<string, any>,
  properties: Record<string, any>,
  required: unknown,
  prefix: string,
  errors: string[],
): void {
  const requiredFields = Array.isArray(required) ? required : [];
  for (const field of requiredFields) {
    const value = args?.[field];
    if (value === undefined || value === null) {
      errors.push(
        `Falta el campo obligatorio "${prefix ? `${prefix}.${field}` : field}".`,
      );
    }
  }

  for (const [field, schema] of Object.entries(properties ?? {})) {
    const value = args?.[field];
    // Ausente u opcional en null: los handlers ya tratan ambos como "no vino".
    if (value === undefined || value === null) continue;
    checkValue(
      value,
      (schema ?? {}) as Record<string, any>,
      prefix ? `${prefix}.${field}` : field,
      errors,
      args,
      field,
    );
  }
}

/** Campos esperados para el `next_step`, en español. */
function expectedFieldsLine(
  toolName: string,
  properties: Record<string, any>,
  required: unknown,
): string {
  const names = Object.keys(properties ?? {});
  if (!names.length) {
    return `La herramienta "${toolName}" no recibe parámetros con nombre: revísalos contra su descripción.`;
  }
  const requiredSet = new Set(Array.isArray(required) ? required : []);
  const mandatory = names.filter((name) => requiredSet.has(name));
  const optional = names.filter((name) => !requiredSet.has(name));
  const parts = [`los campos de "${toolName}"`];
  if (mandatory.length) parts.push(`obligatorios: ${mandatory.join(', ')}`);
  if (optional.length) parts.push(`opcionales: ${optional.join(', ')}`);
  return `Revisa ${parts.join('; ')}.`;
}

export function validateToolArgs(
  toolName: string,
  parameters: Record<string, any> | undefined | null,
  args: Record<string, any> | undefined | null,
): ToolArgsValidation {
  // Sin schema no hay nada contra qué validar: el handler juzga.
  if (!parameters || typeof parameters !== 'object') return { ok: true };

  const properties = parameters.properties;
  if (!properties || typeof properties !== 'object') return { ok: true };

  const input: Record<string, any> =
    args && typeof args === 'object' ? args : {};
  const errors: string[] = [];
  checkProperties(input, properties, parameters.required, '', errors);

  if (!errors.length) return { ok: true };
  return {
    ok: false,
    error: errors.join(' '),
    next_step: expectedFieldsLine(toolName, properties, parameters.required),
  };
}
