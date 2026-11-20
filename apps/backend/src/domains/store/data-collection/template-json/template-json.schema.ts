/**
 * JSON Schema (draft 2020-12) of `vendix.data-collection-template/v1`, built
 * from the contract constants so it never drifts from `validateTemplateJson`.
 *
 * It describes the SHAPE the AI must produce; `validateTemplateJson` stays the
 * domain validator (it also checks cross-field rules a schema cannot express:
 * unique keys per entity, `tabs` xor `sections`, total limits).
 *
 * Backend only: it is not part of the byte-identical contract copy shared with
 * the frontend.
 */
import {
  DOCUMENT_KIND_KEYS,
  DOCUMENT_MAX_FILES,
  DOCUMENT_MAX_SIZE_MB_LIMIT,
  TEMPLATE_ENTITY_TYPES,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_ITEM_WIDTHS,
  TEMPLATE_JSON_LIMITS,
  TEMPLATE_JSON_SCHEMA_ID,
} from './template-json.contract';

type JsonSchema = Record<string, unknown>;

const text = (maxLength: number = TEMPLATE_JSON_LIMITS.maxTextLength): JsonSchema => ({
  type: 'string',
  minLength: 1,
  maxLength,
});

const optionalText = (maxLength: number): JsonSchema => ({ type: 'string', maxLength });

const fieldSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'type', 'label'],
  properties: {
    key: {
      type: 'string',
      pattern: '^[a-z0-9_]+$',
      maxLength: TEMPLATE_JSON_LIMITS.maxKeyLength,
      description: 'Stable snake_case key, unique per entity_type in the template.',
    },
    type: { enum: [...TEMPLATE_FIELD_TYPES] },
    label: text(),
    entity_type: {
      enum: [...TEMPLATE_ENTITY_TYPES],
      description: "Only when the answer belongs to another entity than the template's.",
    },
    description: optionalText(5000),
    options: {
      type: 'array',
      minItems: 1,
      maxItems: TEMPLATE_JSON_LIMITS.maxSelectOptions,
      items: text(),
      description: 'Required for type "select"; forbidden otherwise.',
    },
  },
};

const documentsSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Only for type "file" (Documentos / adjuntos).',
  properties: {
    multiple: { type: 'boolean', description: `Up to ${DOCUMENT_MAX_FILES} files when true.` },
    accept: { type: 'array', minItems: 1, items: { enum: [...DOCUMENT_KIND_KEYS] } },
    max_size_mb: { type: 'number', minimum: 1, maximum: DOCUMENT_MAX_SIZE_MB_LIMIT },
  },
};

const itemSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field'],
  properties: {
    field: fieldSchema,
    required: { type: 'boolean' },
    include_in_summary: { type: 'boolean' },
    help_text: optionalText(5000),
    placeholder: optionalText(TEMPLATE_JSON_LIMITS.maxTextLength),
    width: { enum: [...TEMPLATE_ITEM_WIDTHS], description: 'Percentage of the row.' },
    icon: optionalText(100),
    documents: documentsSchema,
  },
};

const sectionProperties = (withChildren: boolean): JsonSchema => ({
  title: text(),
  description: optionalText(5000),
  icon: optionalText(100),
  items: { type: 'array', items: itemSchema },
  ...(withChildren
    ? {
        child_sections: {
          type: 'array',
          description: 'One level of nesting only.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: sectionProperties(false),
          },
        },
      }
    : {}),
});

const sectionSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: sectionProperties(true),
};

/** JSON Schema of the portable template contract (`vendix.data-collection-template/v1`). */
export const TEMPLATE_JSON_SCHEMA: Readonly<JsonSchema> = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: TEMPLATE_JSON_SCHEMA_ID,
  title: 'Vendix data collection template',
  type: 'object',
  additionalProperties: false,
  required: ['schema', 'name', 'entity_type'],
  description: 'Use either "tabs" (steps) or "sections", never both.',
  properties: {
    schema: { const: TEMPLATE_JSON_SCHEMA_ID },
    name: text(),
    description: optionalText(5000),
    icon: optionalText(100),
    entity_type: { enum: [...TEMPLATE_ENTITY_TYPES] },
    tabs: {
      type: 'array',
      minItems: 1,
      maxItems: TEMPLATE_JSON_LIMITS.maxTabs,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'sections'],
        properties: {
          title: text(),
          icon: optionalText(100),
          sections: { type: 'array', minItems: 1, items: sectionSchema },
        },
      },
    },
    sections: { type: 'array', minItems: 1, items: sectionSchema },
  },
});

/** Compact text of the schema, for prompts. */
export function templateJsonSchemaText(): string {
  return JSON.stringify(TEMPLATE_JSON_SCHEMA);
}
