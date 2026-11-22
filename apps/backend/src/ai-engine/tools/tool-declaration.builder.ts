/**
 * JSON Schema → TypeScript declaration (pure, deterministic, no I/O).
 *
 * Used by `describe_tool` so the model (or, later, a Code Mode script) gets a
 * compact signature instead of a raw JSON Schema. Unknown or unsupported
 * keywords degrade to `unknown`; output is bounded so a huge schema can never
 * flood the context.
 */
export const TOOL_DECLARATION_LIMITS = {
  /** Maximum nesting rendered; deeper levels collapse to `unknown`. */
  maxDepth: 6,
  /** Maximum characters of the whole declaration. */
  maxChars: 6000,
  /** Maximum length of a description rendered as a comment. */
  maxCommentChars: 200,
  /** Maximum enum members / union branches rendered. */
  maxUnion: 20,
} as const;

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function comment(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/\*\//g, '* /')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TOOL_DECLARATION_LIMITS.maxCommentChars);
  return text;
}

const literal = (value: unknown): string | null =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'
    ? JSON.stringify(value)
    : value === null
      ? 'null'
      : null;

function union(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (!unique.length) return 'unknown';
  const shown = unique.slice(0, TOOL_DECLARATION_LIMITS.maxUnion);
  if (unique.length > shown.length) shown.push('unknown');
  return shown.join(' | ');
}

function render(schema: unknown, depth: number, indent: string): string {
  if (!isSchema(schema) || depth > TOOL_DECLARATION_LIMITS.maxDepth)
    return 'unknown';
  if (Array.isArray(schema.enum)) {
    const members = schema.enum.map(literal);
    return members.every((m) => m !== null)
      ? union(members as string[])
      : 'unknown';
  }
  if ('const' in schema) return literal(schema.const) ?? 'unknown';
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches))
    return union(branches.map((b) => render(b, depth + 1, indent)));
  const type = schema.type;
  if (Array.isArray(type))
    return union(
      type.map((t) => render({ ...schema, type: t }, depth + 1, indent)),
    );
  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const item = render(schema.items, depth + 1, indent);
      return /[|&]/.test(item) ? `Array<${item}>` : `${item}[]`;
    }
    case 'object':
      return renderObject(schema, depth, indent);
    default:
      return schema.properties
        ? renderObject(schema, depth, indent)
        : 'unknown';
  }
}

function renderObject(schema: Schema, depth: number, indent: string): string {
  const properties = isSchema(schema.properties) ? schema.properties : {};
  const names = Object.keys(properties).sort((a, b) => a.localeCompare(b));
  if (!names.length)
    return schema.additionalProperties === false
      ? 'Record<string, never>'
      : 'Record<string, unknown>';
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]) : [],
  );
  const inner = `${indent}  `;
  const lines = names.map((name) => {
    const prop = properties[name];
    const note = isSchema(prop) ? comment(prop.description) : '';
    const key = IDENTIFIER.test(name) ? name : JSON.stringify(name);
    const optional = required.has(name) ? '' : '?';
    const doc = note ? `${inner}/** ${note} */\n` : '';
    return `${doc}${inner}${key}${optional}: ${render(prop, depth + 1, inner)};`;
  });
  return `{\n${lines.join('\n')}\n${indent}}`;
}

/** TypeScript signature of a tool: `declare function name(args: {...}): Promise<unknown>;`. */
export function buildToolDeclaration(
  name: string,
  parameters: Record<string, unknown> | undefined,
  description?: string,
): string {
  const safeName = IDENTIFIER.test(name) ? name : 'tool';
  const args = render({ type: 'object', ...(parameters ?? {}) }, 0, '');
  const note = comment(description);
  const out = `${note ? `/** ${note} */\n` : ''}declare function ${safeName}(args: ${args}): Promise<unknown>;`;
  return out.length > TOOL_DECLARATION_LIMITS.maxChars
    ? `${out.slice(0, TOOL_DECLARATION_LIMITS.maxChars)}\n/* declaración truncada */`
    : out;
}
