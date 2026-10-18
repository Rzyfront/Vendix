import type { RegisteredTool } from '../tools/interfaces/tool.interface';
import type { CatalogEntry } from '../tools/bridge/api-catalog.service';
import { catalogHash } from '../tools/tool-catalog';
import { PLAYBOOK_VERIFIERS } from './playbook-verifiers';
import {
  PlaybookDocument,
  PlaybookGap,
  PlaybookMetadata,
  PlaybookContract,
} from './playbook.interface';

const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const REQUIRED_SECTIONS = [
  'activation',
  'inputs',
  'setup',
  'steps',
  'approvals',
  'recovery',
  'verification',
  'alternative',
];
function fail(code: string, detail: string): never {
  throw new Error(`${code}:${detail}`);
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function string(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    fail('PLAYBOOK_SCHEMA', label);
}
function strings(value: unknown, label: string): asserts value is string[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v.trim()) ||
    new Set(value).size !== value.length
  )
    fail('PLAYBOOK_SCHEMA', label);
}
function safe(value: unknown, path = ''): void {
  if (Array.isArray(value))
    return value.forEach((v, i) => safe(v, `${path}.${i}`));
  if (object(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        fail('PLAYBOOK_UNSAFE_CONTENT', `${path}.${key}`);
      if (
        /^(?:store_id|organization_id|user_id|storeId|organizationId|userId|authorization|password|confirmationToken|api_key|access_token|refresh_token)$/i.test(
          key,
        )
      )
        fail('PLAYBOOK_UNSAFE_CONTENT', `${path}.${key}`);
      // IDs must be resolved at run time. Synthetic fixtures belong exclusively in examples.
      if (
        /(?:^|_)id$/.test(key) &&
        (typeof v === 'number' ||
          (typeof v === 'string' &&
            /^(?:[0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,})$/i.test(v)))
      )
        fail('PLAYBOOK_FIXED_ID', `${path}.${key}`);
      safe(v, `${path}.${key}`);
    }
    return;
  }
  if (
    typeof value === 'string' &&
    /(?:Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{16,}|-----BEGIN.*PRIVATE KEY|https?:\/\/[^\s]+(?:X-Amz-|token=))/i.test(
      value,
    )
  )
    fail('PLAYBOOK_UNSAFE_CONTENT', path);
}

/** Validate literal DTO shape while allowing symbolic values resolved at run time. */
function validateArguments(
  value: unknown,
  schema: Record<string, unknown>,
  label: string,
): void {
  if (typeof value === 'string' && value.includes('${')) return;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:enum`);
  if (schema.type === 'object') {
    if (!object(value)) fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:object`);
    if (Array.isArray(schema.required))
      for (const key of schema.required)
        if (typeof key === 'string' && !(key in value))
          fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:${key}:required`);
    if (object(schema.properties))
      for (const [key, child] of Object.entries(value)) {
        if (!(key in schema.properties))
          fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:${key}:unknown`);
        validateArguments(
          child,
          object(schema.properties[key]) ? schema.properties[key] : {},
          `${label}:${key}`,
        );
      }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:array`);
    if (object(schema.items))
      value.forEach((child, index) =>
        validateArguments(
          child,
          schema.items as Record<string, unknown>,
          `${label}:${index}`,
        ),
      );
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      (schema.type === 'integer' && !Number.isInteger(value))
    )
      fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:number`);
  } else if (schema.type === 'string' && typeof value !== 'string')
    fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:string`);
  else if (schema.type === 'boolean' && typeof value !== 'boolean')
    fail('PLAYBOOK_TOOL_ARGUMENT', `${label}:boolean`);
}
function references(
  value: unknown,
  callback: (kind: string, key: string) => void,
): void {
  if (Array.isArray(value)) value.forEach((v) => references(v, callback));
  else if (object(value))
    Object.values(value).forEach((v) => references(v, callback));
  else if (typeof value === 'string') {
    const matches = [
      ...value.matchAll(
        /\$\{(inputs|steps)\.([a-zA-Z0-9_-]+)(?:\.[a-zA-Z0-9_.-]+)?\}/g,
      ),
    ];
    if ((value.match(/\$\{/g) ?? []).length !== matches.length)
      fail('PLAYBOOK_SYMBOL', 'invalid symbolic expression');
    for (const match of matches) callback(match[1], match[2]);
  }
}

/** JSON frontmatter is deliberately the accepted YAML subset; no parser/code execution. */
export function parsePlaybookMarkdown(
  markdown: string,
  source: string,
): PlaybookDocument {
  if (
    typeof markdown !== 'string' ||
    Buffer.byteLength(markdown, 'utf8') > 150000
  )
    fail('PLAYBOOK_SCHEMA', 'size');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(markdown);
  if (!match) fail('PLAYBOOK_FRONTMATTER', source);
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = JSON.parse(match[1]);
  } catch {
    fail('PLAYBOOK_FRONTMATTER_JSON', source);
  }
  if (!object(frontmatter!)) fail('PLAYBOOK_SCHEMA', 'frontmatter');
  string(frontmatter!.name, 'name');
  string(frontmatter!.description, 'description');
  if (
    frontmatter!.name.length > 64 ||
    frontmatter!.description.length > 1024 ||
    !IDENTIFIER.test(frontmatter!.name)
  )
    fail('PLAYBOOK_SCHEMA', 'name');
  const m = frontmatter!.metadata;
  const c = frontmatter!.vendix_contract;
  if (!object(m) || !object(c)) fail('PLAYBOOK_SCHEMA', 'metadata/contract');
  for (const key of ['version', 'owner', 'workflow_key'])
    string(m[key], `metadata.${key}`);
  if (!/^\d+(?:\.\d+){0,2}$/.test(String(m.version)))
    fail('PLAYBOOK_SCHEMA', 'version');
  if (m.workflow_key !== frontmatter!.name)
    fail('PLAYBOOK_SCHEMA', 'workflow_key');
  strings(m.industry, 'industry');
  strings(m.required_permissions, 'permissions');
  strings(m.verifier_ids, 'verifiers');
  if (
    !m.industry.length ||
    !m.verifier_ids.length ||
    !Array.isArray(m.tool_contracts) ||
    !m.tool_contracts.length
  )
    fail('PLAYBOOK_SCHEMA', 'nonempty catalog metadata');
  for (const tool of m.tool_contracts) {
    if (!object(tool)) fail('PLAYBOOK_SCHEMA', 'tool_contract');
    string(tool.name, 'tool.name');
    string(tool.version, 'tool.version');
  }
  if (
    new Set(m.tool_contracts.map((t) => t.name)).size !==
    m.tool_contracts.length
  )
    fail('PLAYBOOK_SCHEMA', 'duplicate tool');
  if (
    c.schema_version !== '1' ||
    !['executable', 'preparation_only'].includes(String(c.mode))
  )
    fail('PLAYBOOK_SCHEMA', 'contract version/mode');
  strings(c.gaps, 'gaps');
  if (
    !Array.isArray(c.inputs) ||
    !Array.isArray(c.steps) ||
    !c.steps.length ||
    !Array.isArray(c.examples)
  )
    fail('PLAYBOOK_SCHEMA', 'contract arrays');
  for (const input of c.inputs) {
    if (!object(input)) fail('PLAYBOOK_SCHEMA', 'input');
    string(input.key, 'input.key');
    string(input.description, 'input.description');
    if (
      typeof input.required !== 'boolean' ||
      !['user', 'lookup'].includes(String(input.source))
    )
      fail('PLAYBOOK_SCHEMA', 'input source');
    if (/^(?:store_id|organization_id|user_id)$/.test(input.key))
      fail('PLAYBOOK_UNSAFE_CONTENT', input.key);
  }
  if (new Set(c.inputs.map((i) => i.key)).size !== c.inputs.length)
    fail('PLAYBOOK_SCHEMA', 'duplicate input');
  for (const step of c.steps) {
    if (!object(step)) fail('PLAYBOOK_SCHEMA', 'step');
    for (const key of ['id', 'section', 'instruction'])
      string(step[key], `step.${key}`);
    if (
      !IDENTIFIER.test(step.id as string) ||
      !['none', 'individual'].includes(String(step.approval))
    )
      fail('PLAYBOOK_SCHEMA', 'step id/approval');
    strings(step.depends_on, 'depends_on');
    if (step.tool !== undefined) string(step.tool, 'step.tool');
    if (step.arguments !== undefined && !object(step.arguments))
      fail('PLAYBOOK_SCHEMA', 'arguments');
    if (
      step.bridge !== undefined &&
      (!object(step.bridge) ||
        !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(
          String(step.bridge.method),
        ) ||
        typeof step.bridge.path !== 'string')
    )
      fail('PLAYBOOK_SCHEMA', 'bridge');
    safe(step.arguments);
  }
  for (const example of c.examples) {
    if (
      !object(example) ||
      !['happy', 'sad'].includes(String(example.kind)) ||
      !['verified', 'not_verified'].includes(String(example.expected)) ||
      !object(example.input) ||
      !Array.isArray(example.observations)
    )
      fail('PLAYBOOK_SCHEMA', 'example');
    string(example.description, 'example.description');
    // Examples have synthetic identifiers only; scope and secrets are still prohibited.
    for (const key of Object.keys(example.input))
      if (/^(?:store_id|organization_id|user_id)$/.test(key))
        fail('PLAYBOOK_UNSAFE_CONTENT', key);
    for (const observation of example.observations) {
      if (
        !object(observation) ||
        !object(observation.resource_ids) ||
        !['ok', 'error', 'pending_confirmation', 'unknown_effect'].includes(
          String(observation.status),
        ) ||
        typeof observation.fresh !== 'boolean' ||
        typeof observation.complete !== 'boolean'
      )
        fail('PLAYBOOK_SCHEMA', 'observation');
      string(observation.step_id, 'observation.step_id');
      string(observation.tool, 'observation.tool');
    }
  }
  if (
    !c.examples.some((e) => e.kind === 'happy' && e.expected === 'verified') ||
    !c.examples.some((e) => e.kind === 'sad' && e.expected === 'not_verified')
  )
    fail('PLAYBOOK_SCHEMA', 'happy/sad required');
  const body = match[2].trim();
  if (
    /\b(?:store_id|organization_id|user_id)\s*[:=]\s*[0-9]+/.test(body) ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(body)
  )
    fail('PLAYBOOK_UNSAFE_CONTENT', 'body identity');
  const headings = [...body.matchAll(/^## ([a-z][a-z0-9-]*)\s*$/gm)];
  const sections = headings.map((heading, index) => ({
    id: heading[1],
    title: heading[1],
    body: body
      .slice(
        heading.index! + heading[0].length,
        headings[index + 1]?.index ?? body.length,
      )
      .trim(),
    steps: (c.steps as unknown as PlaybookContract['steps']).filter(
      (step) => step.section === heading[1],
    ),
  }));
  if (
    new Set(sections.map((s) => s.id)).size !== sections.length ||
    REQUIRED_SECTIONS.some((id) => !sections.some((s) => s.id === id && s.body))
  )
    fail('PLAYBOOK_SCHEMA', 'sections');
  const doc: PlaybookDocument = {
    id: frontmatter!.name,
    name: frontmatter!.name,
    description: frontmatter!.description,
    metadata: m as unknown as PlaybookMetadata,
    contract: c as unknown as PlaybookContract,
    body,
    sections,
    source,
    hash: catalogHash({ frontmatter, body }),
  };
  safe(doc.metadata);
  return doc;
}

export interface PlaybookValidationCatalog {
  tools: RegisteredTool[];
  endpoints: CatalogEntry[];
  verifierIds?: string[];
}
/** Called AFTER domain factories and ApiCatalog bootstrap. Never uses an actor's filtered subset. */
export function validatePlaybookCatalog(
  documents: PlaybookDocument[],
  catalog: PlaybookValidationCatalog,
): { playbooks: PlaybookDocument[]; gaps: PlaybookGap[] } {
  const tools = new Map(catalog.tools.map((tool) => [tool.name, tool]));
  const verifiers = new Set(
    catalog.verifierIds ?? Object.keys(PLAYBOOK_VERIFIERS),
  );
  const gaps: PlaybookGap[] = [];
  const ids = new Set<string>();
  const playbooks = documents.map((original) => {
    const doc = structuredClone(original);
    if (ids.has(doc.id)) fail('PLAYBOOK_DUPLICATE', doc.id);
    ids.add(doc.id);
    for (const id of doc.metadata.verifier_ids)
      if (!verifiers.has(id))
        fail('PLAYBOOK_VERIFIER_MISSING', `${doc.id}:${id}`);
    const declared = new Set(doc.metadata.required_permissions);
    const contracts = new Map(
      doc.metadata.tool_contracts.map((c) => [c.name, c.version]),
    );
    for (const [name, version] of contracts) {
      const tool = tools.get(name);
      if (!tool) fail('PLAYBOOK_TOOL_MISSING', `${doc.id}:${name}`);
      if ((tool.version ?? '1') !== version)
        fail('PLAYBOOK_TOOL_VERSION', `${doc.id}:${name}`);
      for (const permission of tool.requiredPermissions ?? [])
        if (!declared.has(permission))
          fail('PLAYBOOK_PERMISSION', `${doc.id}:${permission}`);
    }
    // Backticked tool-like identifiers are release references, not permission-granting prose.
    const proseReferences = [
      ...doc.body.matchAll(
        /`((?:get|find|list|create|update|delete|approve|send|close|pay|refund|collect|manage|preview|check|record|validate|export|analyze|fire|calculate|call|write|upsert|reschedule|transition)_[a-z0-9_]+)`/g,
      ),
    ];
    for (const [, name] of proseReferences)
      if (
        !doc.contract.inputs.some((input) => input.key === name) &&
        !tools.has(name)
      )
        fail('PLAYBOOK_TOOL_MISSING', `${doc.id}:${name}`);
    const steps = new Map(doc.contract.steps.map((s) => [s.id, s]));
    if (steps.size !== doc.contract.steps.length)
      fail('PLAYBOOK_DEPENDENCY', `${doc.id}:duplicate step`);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) fail('PLAYBOOK_CYCLE', `${doc.id}:${id}`);
      const step = steps.get(id);
      if (!step) fail('PLAYBOOK_DEPENDENCY', `${doc.id}:${id}`);
      visiting.add(id);
      step.depends_on.forEach(visit);
      visiting.delete(id);
      visited.add(id);
    };
    doc.contract.steps.forEach((s) => visit(s.id));
    for (const step of doc.contract.steps) {
      if (!doc.sections.some((s) => s.id === step.section))
        fail('PLAYBOOK_SCHEMA', `${doc.id}:step section`);
      if (!step.tool) continue;
      if (!contracts.has(step.tool))
        fail('PLAYBOOK_TOOL_UNDECLARED', `${doc.id}:${step.tool}`);
      const tool = tools.get(step.tool)!;
      validateArguments(
        step.arguments ?? {},
        tool.parameters,
        `${doc.id}:${step.id}`,
      );
      references(step.arguments, (kind, key) => {
        if (
          kind === 'inputs' &&
          !doc.contract.inputs.some((i) => i.key === key)
        )
          fail('PLAYBOOK_SYMBOL', `${doc.id}:${step.id}:${key}`);
        if (kind === 'steps' && (!steps.has(key) || key === step.id))
          fail('PLAYBOOK_SYMBOL', `${doc.id}:${step.id}:${key}`);
      });
      if (tool.clientSide)
        fail('PLAYBOOK_TOOL_CLIENT_SIDE', `${doc.id}:${step.tool}`);
      if (tool.readOnly !== true) {
        if (step.approval !== 'individual')
          fail('PLAYBOOK_APPROVAL', `${doc.id}:${step.id}`);
        if (!tool.requiresConfirmation || typeof tool.preview !== 'function') {
          doc.contract.mode = 'preparation_only';
          gaps.push({
            playbook_id: doc.id,
            code: 'WRITE_PREFLIGHT_MISSING',
            step_id: step.id,
            detail: `${step.tool}: falta preview de dominio; no ejecutar escrituras de este proceso.`,
          });
        }
      } else if (step.approval !== 'none')
        fail('PLAYBOOK_APPROVAL', `${doc.id}:${step.id}:read`);
      if (['call_endpoint', 'write_endpoint'].includes(step.tool)) {
        if (!step.bridge)
          fail('PLAYBOOK_ENDPOINT_REQUIRED', `${doc.id}:${step.id}`);
        const endpoint = catalog.endpoints.find(
          (e) =>
            e.path === step.bridge!.path && e.method === step.bridge!.method,
        );
        if (!endpoint)
          fail('PLAYBOOK_ENDPOINT_MISSING', `${doc.id}:${step.bridge.path}`);
        if (
          (step.tool === 'call_endpoint') !== (step.bridge.method === 'GET') ||
          (step.tool === 'write_endpoint' &&
            step.arguments?.method !== step.bridge.method)
        )
          fail('PLAYBOOK_ENDPOINT_METHOD', `${doc.id}:${step.id}`);
        const pattern = step.bridge.path.split('/');
        const supplied =
          typeof step.arguments?.path === 'string'
            ? step.arguments.path.split('/')
            : [];
        if (
          pattern.length !== supplied.length ||
          pattern.some((part, index) =>
            part.startsWith(':')
              ? !/^\$\{(?:inputs|steps)\.[a-zA-Z0-9_.-]+\}$/.test(
                  supplied[index] ?? '',
                )
              : part !== supplied[index],
          )
        )
          fail('PLAYBOOK_ENDPOINT_PATH', `${doc.id}:${step.id}`);
        for (const permission of endpoint.requiredPermissions)
          if (!declared.has(permission))
            fail('PLAYBOOK_PERMISSION', `${doc.id}:${permission}`);
      } else if (step.bridge)
        fail('PLAYBOOK_ENDPOINT_TOOL', `${doc.id}:${step.id}`);
    }
    for (const gap of doc.contract.gaps)
      gaps.push({
        playbook_id: doc.id,
        code: 'DOMAIN_CAPABILITY_GAP',
        detail: gap,
      });
    if (
      doc.contract.mode === 'preparation_only' &&
      !gaps.some((g) => g.playbook_id === doc.id)
    )
      fail('PLAYBOOK_PREPARATION_GAP_REQUIRED', doc.id);
    return doc;
  });
  return { playbooks, gaps };
}
