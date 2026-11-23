import type { JsonSchema } from './ai-extraction.service';

/**
 * Lax building blocks for the schema of a scanner that already had its own
 * hand-written normalizer (plan ia-cargas F3/F5).
 *
 * The schema only checks the SHAPE the app prompt always asked for. A leaf
 * value may be a string, a number, a boolean or null, so ajv (`coerceTypes`)
 * never converts it: "24.990", 24990 and "900123456" reach the normalizer
 * exactly as the model wrote them, and the normalizer decides as before. For
 * the same model answer the scanner result is identical.
 */
export const LAX_VALUE: JsonSchema = { type: ['string', 'number', 'boolean', 'null'] };

/**
 * A list of leaves (codes, responsibilities); a lone value is left to the
 * normalizer. `number`/`boolean` are listed so ajv never coerces a lone 13
 * into "13" (the normalizer ignores a non-array, as before).
 */
export const LAX_LIST: JsonSchema = {
  type: ['array', 'string', 'number', 'boolean', 'null'],
  items: LAX_VALUE,
};

/** `{ "<dotted path>": 0-100 }`: any key, leaf values. */
export const LAX_CONFIDENCE_MAP: JsonSchema = {
  type: ['object', 'null'],
  additionalProperties: LAX_VALUE,
};

/** An object whose listed keys are leaves (or the given schemas); nothing required. */
export function laxObject(
  keys: readonly string[],
  overrides: Record<string, JsonSchema> = {},
  nullable = false,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const key of keys) properties[key] = overrides[key] ?? LAX_VALUE;
  for (const [key, schema] of Object.entries(overrides)) properties[key] = schema;
  return { type: nullable ? ['object', 'null'] : 'object', properties };
}
