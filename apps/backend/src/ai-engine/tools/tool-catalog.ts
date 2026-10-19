import { createHash } from 'crypto';
import Ajv, { ValidateFunction } from 'ajv';
import {
  normalizeSearchText,
  tokenizeInternal,
} from '../../common/utils/search-text.util';
import { RegisteredTool } from './interfaces/tool.interface';
import { validateToolArgs } from './tool-args.validator';

export const KNOWLEDGE_DIMENSION = 1536;
export const KNOWLEDGE_TYPES = ['tool', 'skill', 'process', 'recipe'] as const;
export const BUSINESS_TYPES = [
  'product',
  'customer',
  'order',
  'supplier',
  'expense',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/** Stable hashes are cache/manifest identities, never raw prompt keys. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const catalogHash = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');

export interface ToolDocument {
  key: string;
  name: string;
  version: string;
  domain: string;
  hash: string;
  content: string;
  lexicalText: string;
  aliases: string[];
  dependencies: string[];
  metadata: Record<string, unknown>;
}
export interface ToolCatalogManifest {
  hash: string;
  documents: ToolDocument[];
}

// A synthetic example is documentation, NOT a preview/permission grant or real ID.
function sample(schema: Record<string, any>, depth = 0): unknown {
  if (depth > 5) return {};
  if (schema.enum?.length) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(
        (schema.required ?? []).map((key: string) => [
          key,
          sample(schema.properties?.[key] ?? {}, depth + 1),
        ]),
      );
    case 'array':
      return Array.from(
        { length: Math.min(5, Math.max(0, Number(schema.minItems) || 0)) },
        () => sample(schema.items ?? {}, depth + 1),
      );
    case 'integer':
    case 'number':
      return Math.max(1, Number(schema.minimum) || 1);
    case 'boolean':
      return false;
    default:
      return 'ejemplo_sintetico';
  }
}
const SECRET_FIELD =
  /^(?:password|passwd|secret|api_key|access_token|refresh_token|authorization|confirmationToken)$/i;
function safeExample(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(safeExample);
  if (value && typeof value === 'object')
    return Object.entries(value).every(
      ([key, v]) => !SECRET_FIELD.test(key) && safeExample(v),
    );
  return (
    typeof value !== 'string' ||
    !/(?:sk-[a-zA-Z0-9]{16,}|Bearer\s+[a-zA-Z0-9._-]+|-----BEGIN.*PRIVATE KEY)/.test(
      value,
    )
  );
}

const exampleValidator = new Ajv({ strict: false, validateFormats: false });
const schemaValidators = new Map<string, ValidateFunction>();
function validatesExample(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): boolean {
  const hash = catalogHash(schema);
  let validate = schemaValidators.get(hash);
  if (!validate) {
    if (schemaValidators.size >= 1000) {
      schemaValidators.clear();
      exampleValidator.removeSchema();
    }
    validate = exampleValidator.compile(structuredClone(schema));
    schemaValidators.set(hash, validate);
  }
  return validate(args) === true;
}

export function buildToolDocument(
  tool: RegisteredTool,
  aliases: string[] = [],
): ToolDocument {
  const version = tool.version ?? '1';
  const examples = tool.discovery?.examples ?? [
    {
      intent: `Usar ${tool.name.replace(/_/g, ' ')} (ejemplo sintético)`,
      arguments: sample({ type: 'object', ...tool.parameters }) as Record<
        string,
        unknown
      >,
    },
  ];
  // No execution of a preview/handler at index time. Only explicitly pure preflight.
  const validated = examples.filter(
    (example) =>
      !!example.arguments &&
      typeof example.arguments === 'object' &&
      !Array.isArray(example.arguments) &&
      safeExample(example) &&
      validatesExample(tool.parameters, example.arguments) &&
      validateToolArgs(
        tool.name,
        tool.parameters,
        structuredClone(example.arguments),
      ).ok &&
      (!tool.discovery?.preflight ||
        tool.discovery.preflight(structuredClone(example.arguments))),
  );
  if (tool.discovery?.examples && validated.length !== examples.length)
    throw new Error(`INVALID_CATALOG_EXAMPLE:${tool.name}`);
  const metadata = {
    name: tool.name,
    version,
    domain: tool.domain,
    description: tool.description,
    parameters: tool.parameters,
    required_permissions: [...(tool.requiredPermissions ?? [])].sort(),
    read_only: tool.readOnly === true,
    requires_confirmation: tool.requiresConfirmation === true,
    client_side: tool.clientSide === true,
    irreversible: tool.irreversible === true,
    aliases: [...aliases].sort(),
    deprecated: tool.deprecated ?? null,
    synonyms: tool.discovery?.synonyms ?? [],
    examples: validated,
    dependencies: [...(tool.discovery?.dependencies ?? [])].sort(),
  };
  const content = stableJson(metadata);
  // Normalizer is intentionally bounded; normalize each field chunk, not just the first 500 chars.
  const lexicalText = [
    tool.name,
    ...aliases,
    tool.domain,
    tool.description,
    ...(tool.discovery?.synonyms ?? []),
    ...validated.map((e) => e.intent),
  ]
    .map(
      (s) =>
        s
          .match(/.{1,500}/gs)
          ?.map(normalizeSearchText)
          .join(' ') ?? '',
    )
    .join(' ');
  return {
    key: `tool:${tool.name}:${version}`,
    name: tool.name,
    version,
    domain: tool.domain,
    hash: catalogHash(metadata),
    content,
    lexicalText,
    aliases: metadata.aliases,
    dependencies: metadata.dependencies,
    metadata,
  };
}

export function buildToolManifest(registry: {
  getAliases(): Record<string, string>;
  getAll(): RegisteredTool[];
}): ToolCatalogManifest {
  const aliases = registry.getAliases();
  const documents = registry
    .getAll()
    .map((tool) =>
      buildToolDocument(
        tool,
        Object.keys(aliases).filter((alias) => aliases[alias] === tool.name),
      ),
    )
    .sort((a, b) => a.key.localeCompare(b.key));
  return {
    hash: catalogHash(documents.map((d) => [d.key, d.hash])),
    documents,
  };
}

/**
 * Local lexical score per document. ts_rank is not BM25. Local branch shares
 * Spanish accent/ñ normalization. Score 0 means "no lexical evidence at all":
 * the document only appears in the ranking through the alphabetical tie-break.
 */
export function localToolScores(
  query: string,
  docs: ToolDocument[],
  domain?: string,
): Map<string, number> {
  const normalized = normalizeSearchText(query);
  const tokens = tokenizeInternal(query);
  return new Map(
    docs.map((doc) => {
      const exact = [doc.name, ...doc.aliases].some(
        (name) => normalizeSearchText(name) === normalized,
      );
      const name = normalizeSearchText([doc.name, ...doc.aliases].join(' '));
      const score =
        (exact ? 10000 : 0) +
        (domain === doc.domain || normalized === normalizeSearchText(doc.domain)
          ? 500
          : 0) +
        tokens.reduce(
          (n, token) =>
            n +
            (name.split(' ').includes(token) ? 30 : 0) +
            (doc.lexicalText.split(' ').includes(token)
              ? 5
              : doc.lexicalText.includes(token)
                ? 1
                : 0),
          0,
        );
      return [doc.name, score] as const;
    }),
  );
}

export function localToolRanking(
  query: string,
  docs: ToolDocument[],
  domain?: string,
): string[] {
  const scores = localToolScores(query, docs, domain);
  return docs
    .map((doc) => ({ name: doc.name, score: scores.get(doc.name) ?? 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((d) => d.name);
}

/**
 * Fail-closed, like the voice surface: only a tool that opted into
 * `readOnly: true` may fill the working set without lexical evidence. Writes
 * (`requiresConfirmation`), irreversible tools, UI commands (`clientSide`) and
 * any tool that forgot the flag need a score > 0 to be offered by relevance.
 */
export function mayFillWithoutEvidence(doc: ToolDocument): boolean {
  return (
    doc.metadata.read_only === true &&
    doc.metadata.requires_confirmation !== true &&
    doc.metadata.irreversible !== true &&
    doc.metadata.client_side !== true
  );
}

export function reciprocalRankFusion(rankings: string[][]): string[] {
  const scores = new Map<string, number>();
  rankings.forEach((ranking) =>
    ranking.forEach((name, i) =>
      scores.set(name, (scores.get(name) ?? 0) + 1 / (60 + i + 1)),
    ),
  );
  return [...scores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}
