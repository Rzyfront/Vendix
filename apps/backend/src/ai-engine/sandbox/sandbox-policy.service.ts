import { ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  RequestContext,
  RequestContextService,
} from '../../common/context/request-context.service';
import { buildActiveUserRolesWhere } from '../../common/utils/role-scope.util';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { SubscriptionAccessService } from '../../domains/store/subscriptions/services/subscription-access.service';
import { safeObjectiveArtifact } from '../tasks/agent-artifact-safety';
import { AIToolRegistry } from '../tools/ai-tool-registry';
import {
  RegisteredTool,
  ToolExecutionReceipt,
  ToolExecutionResult,
} from '../tools/interfaces/tool.interface';
import { validateToolArgs } from '../tools/tool-args.validator';

/** Release-owned semantic audit. Never extend this from env, prompts or DB. */
export const SANDBOX_READONLY_ALLOWLIST = Object.freeze([
  'list_products',
] as const);
export const SANDBOX_POLICY_VERSION = 'readonly-products-v1';

export interface SandboxScriptRequest {
  source: string;
  language: 'javascript' | 'typescript';
  purpose: 'fanout' | 'pagination' | 'join';
  tools: string[];
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Descriptions are prose, all executable schema keywords remain pinned. */
function schemaContract(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schemaContract);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => key !== 'description')
      .sort()
      .map((key) => [key, schemaContract(value[key])]),
  );
}
const hashContract = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(schemaContract(value)))
    .digest('hex');

const AUDITED_PARAMETERS = {
  type: 'object',
  properties: {
    search: { type: 'string' },
    category_id: { type: 'number' },
    brand_id: { type: 'number' },
    product_type: {
      type: 'string',
      enum: ['physical', 'service', 'prepared'],
    },
    state: { type: 'string', enum: ['active', 'inactive', 'archived'] },
    track_inventory: { type: 'boolean' },
    is_sellable: { type: 'boolean' },
    include_variants: { type: 'boolean' },
    page: { type: 'number' },
    limit: { type: 'number' },
  },
};
const AUDITED_PARAMETER_HASH = hashContract(AUDITED_PARAMETERS);
const SAFE_PRODUCT_FIELDS = [
  'product_id',
  'name',
  'sku',
  'brand',
  'state',
  'product_type',
  'net_price',
  'unit_price',
  'inventory_tracked',
  'available_stock',
  'has_variants',
  'variant_count',
  'requires_variant_selection',
] as const;

/**
 * Host authorization/JSON projection only, NOT a JavaScript security boundary.
 * The audited list_products handler calls ProductsService.findAll under strict
 * store ALS; there is no HTTP bridge, SQL or new business seam here. It hydrates
 * variants internally even when their output is omitted: 25 projected products
 * is NOT a DB/host-memory bound. Production stays gated pending Linux/DB QA.
 */
@Injectable()
export class SandboxPolicyService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly access: SubscriptionAccessService,
    private readonly registry: AIToolRegistry,
  ) {}

  validateRequest(raw: unknown): SandboxScriptRequest {
    if (
      !object(raw) ||
      !this.plainJson(raw) ||
      Object.keys(raw).some(
        (key) => !['source', 'language', 'tools', 'purpose'].includes(key),
      ) ||
      typeof raw.source !== 'string' ||
      !raw.source.trim() ||
      !['javascript', 'typescript'].includes(String(raw.language)) ||
      !['fanout', 'pagination', 'join'].includes(String(raw.purpose)) ||
      !Array.isArray(raw.tools) ||
      raw.tools.length < 1 ||
      raw.tools.length > 20 ||
      raw.tools.some((name) => !this.allowedName(name)) ||
      new Set(raw.tools).size !== raw.tools.length
    )
      this.deny();
    const source = raw.source.replace(/\r\n?/g, '\n').normalize('NFC');
    if (
      Buffer.byteLength(raw.source, 'utf8') > 32 * 1024 ||
      Buffer.byteLength(source, 'utf8') > 32 * 1024
    )
      this.deny();
    // UX rejection only. Escaped/dynamic syntax is contained by the external
    // runner's module loader and OS boundary, never by this lexical check.
    if (/\b(?:import|export)\b/.test(source)) this.deny();
    return {
      source,
      language: raw.language as SandboxScriptRequest['language'],
      purpose: raw.purpose as SandboxScriptRequest['purpose'],
      tools: [...raw.tools] as string[],
    };
  }

  eligible(tool: RegisteredTool | undefined, parallel = false): boolean {
    return !!(
      tool &&
      this.allowedName(tool.name) &&
      tool.name === 'list_products' &&
      tool.domain === 'products' &&
      tool.version === '1' &&
      tool.readOnly === true &&
      !tool.clientSide &&
      !tool.requiresConfirmation &&
      typeof tool.handler === 'function' &&
      (!parallel || tool.scheduling?.parallelSafe === true) &&
      tool.requiredPermissions?.length === 1 &&
      tool.requiredPermissions[0] === 'store:products:read' &&
      hashContract(tool.parameters) === AUDITED_PARAMETER_HASH
    );
  }

  assertArgs(name: string, args: unknown): asserts args is JsonObject {
    const tool = this.registry.get(name);
    if (
      !this.allowedName(name) ||
      !this.eligible(tool) ||
      !object(args) ||
      !this.plainJson(args)
    )
      this.deny();
    const properties = AUDITED_PARAMETERS.properties;
    for (const [key, value] of Object.entries(args)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) this.deny();
      const schema = properties[key as keyof typeof properties];
      // Strict type checks happen BEFORE the shared validator's coercion path.
      if (value === null || typeof value !== schema.type) this.deny();
      if (typeof value === 'number' && !Number.isFinite(value)) this.deny();
      if (
        ['category_id', 'brand_id', 'page'].includes(key) &&
        !positiveInteger(value)
      )
        this.deny();
      if (
        key === 'page' &&
        (value as number) > Math.floor(Number.MAX_SAFE_INTEGER / 25)
      )
        this.deny();
      if (key === 'limit' && (!positiveInteger(value) || value > 25))
        this.deny();
      if (key === 'include_variants' && value !== false) this.deny();
      if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > 512)
        this.deny();
    }
    if (!validateToolArgs(name, tool!.parameters, args).ok) this.deny();
  }

  filterResult(name: string, result: ToolExecutionResult): ToolExecutionResult {
    if (
      !this.allowedName(name) ||
      !this.eligible(this.registry.get(name)) ||
      !object(result) ||
      !this.plainJson(result)
    )
      this.deny();
    const receipt = this.receipt(result);
    // A structured domain error is never promoted into a successful read.
    if (result.status !== 'ok')
      return {
        ...receipt,
        next_action: 'Vuelve al chat para revisar esta lectura.',
        data: null,
      };
    const data = result.data;
    if (
      !object(data) ||
      data.success === false ||
      data.ok === false ||
      'error' in data ||
      !Array.isArray(data.products) ||
      data.products.length > 25 ||
      !positiveInteger(data.page) ||
      !positiveInteger(data.limit) ||
      data.limit > 25 ||
      !nonnegativeInteger(data.total) ||
      !nonnegativeInteger(data.total_pages) ||
      !nonnegativeInteger(data.returned) ||
      data.returned !== data.products.length ||
      data.returned > data.limit ||
      data.total < data.returned ||
      data.total_pages !== Math.ceil(data.total / data.limit) ||
      typeof data.has_more !== 'boolean' ||
      data.has_more !== data.page < data.total_pages
    )
      this.deny();
    const products = data.products.map((product) => this.product(product));
    const variantsOmitted = products.some(
      (product) => product.has_variants === true,
    );
    const complete =
      !data.has_more &&
      data.page === 1 &&
      data.returned === data.total &&
      !variantsOmitted &&
      receipt.freshness !== 'truncated' &&
      receipt.pagination?.complete !== false;
    return safeObjectiveArtifact({
      ...receipt,
      pagination: {
        ...(receipt.pagination ?? {}),
        next_cursor: data.has_more ? data.page + 1 : null,
        has_more: data.has_more,
        complete,
      },
      data: {
        ...(typeof data.currency === 'string' &&
        /^[A-Z]{3}$/.test(data.currency)
          ? { currency: data.currency }
          : {}),
        page: data.page,
        limit: data.limit,
        returned: data.returned,
        total: data.total,
        total_pages: data.total_pages,
        has_more: data.has_more,
        variants_omitted: variantsOmitted,
        products,
      },
    }) as ToolExecutionResult;
  }

  async authorize<T>(
    snapshot: RequestContext,
    agentKey: string,
    initialNames: string[],
    objectivePermissions: string[],
    callback: (context: RequestContext, names: string[]) => Promise<T>,
  ): Promise<T> {
    let grant: { context: RequestContext; names: string[] };
    try {
      grant = await this.resolveAuthority(
        snapshot,
        agentKey,
        initialNames,
        objectivePermissions,
      );
    } catch {
      // No DB, permission, credential or subscription details reach the guest.
      return this.deny();
    }
    return RequestContextService.runIsolated(grant.context, () =>
      callback(grant.context, grant.names),
    );
  }

  private async resolveAuthority(
    snapshot: RequestContext,
    agentKey: string,
    initialNames: string[],
    objectivePermissions: string[],
  ): Promise<{ context: RequestContext; names: string[] }> {
    if (
      !snapshot ||
      !positiveInteger(snapshot.user_id) ||
      !positiveInteger(snapshot.organization_id) ||
      !positiveInteger(snapshot.store_id) ||
      !['vex', 'vexi'].includes(agentKey) ||
      !Array.isArray(initialNames) ||
      initialNames.length === 0 ||
      initialNames.length > 20 ||
      initialNames.some((name) => !this.allowedName(name)) ||
      new Set(initialNames).size !== initialNames.length ||
      !Array.isArray(snapshot.permissions) ||
      snapshot.roles?.includes('kitchen') ||
      !snapshot.permissions.every(
        (permission) => typeof permission === 'string',
      ) ||
      !Array.isArray(objectivePermissions) ||
      !objectivePermissions.every(
        (permission) => typeof permission === 'string',
      )
    )
      this.deny();
    // Snapshot and objective are server-owned. Copy before the first await.
    const base: RequestContext = {
      user_id: snapshot.user_id,
      organization_id: snapshot.organization_id,
      store_id: snapshot.store_id,
      app_type: snapshot.app_type,
      request_id: snapshot.request_id,
      ...(snapshot.access_token ? { access_token: snapshot.access_token } : {}),
      roles: [],
      permissions: [...snapshot.permissions],
      is_super_admin: false,
      is_owner: false,
    };
    const original = new Set(base.permissions);
    const objective = new Set(objectivePermissions);
    const manifest = [...initialNames];
    const feature = agentKey === 'vex' ? 'vex_agent' : 'tool_agents';
    const [user, userRoles, store, settings, agent, gate, config] =
      await Promise.all([
        this.prisma.users.findUnique({
          where: { id: base.user_id! },
          select: {
            id: true,
            organization_id: true,
            state: true,
            locked_until: true,
          },
        }),
        // Same role-resolution seam used by JwtStrategy.validate; no role fallback.
        this.prisma.user_roles.findMany({
          where: buildActiveUserRolesWhere(base.user_id!, base.store_id!),
          include: {
            roles: {
              include: { role_permissions: { include: { permissions: true } } },
            },
          },
        }),
        this.prisma.stores.findUnique({
          where: { id: base.store_id! },
          select: { id: true, organization_id: true, is_active: true },
        }),
        this.prisma.store_settings.findUnique({
          where: { store_id: base.store_id! },
          select: { settings: true },
        }),
        this.prisma.ai_agents.findUnique({ where: { key: agentKey } }),
        this.access.canUseAIFeature(base.store_id!, feature),
        this.access.getAIFeatureConfig(base.store_id!, feature),
      ]);
    if (
      !user ||
      user.organization_id !== base.organization_id ||
      user.state !== 'active' ||
      (user.locked_until && user.locked_until.getTime() > Date.now()) ||
      !store ||
      store.organization_id !== base.organization_id ||
      !store.is_active ||
      !agent?.is_active ||
      !object(settings?.settings) ||
      !object(settings.settings[agentKey]) ||
      settings.settings[agentKey].enabled !== true ||
      gate.allowed !== true ||
      !['allow', 'warn'].includes(gate.mode) ||
      gate.reason === 'SUBSCRIPTION_INTERNAL_ERROR' ||
      !config ||
      config.enabled !== true ||
      !Array.isArray(config.tools_allowed) ||
      !config.tools_allowed.every((name) => typeof name === 'string') ||
      !Array.isArray(agent.allowed_tools) ||
      !Array.isArray(agent.denied_tools)
    )
      this.deny();
    const currentPermissions = new Set<string>();
    for (const assignment of userRoles) {
      const role = assignment.roles;
      if (
        !role ||
        assignment.user_id !== base.user_id ||
        (assignment.store_id !== null &&
          assignment.store_id !== base.store_id) ||
        (role.organization_id !== null &&
          role.organization_id !== base.organization_id) ||
        (role.store_id !== null && role.store_id !== base.store_id) ||
        (role.organization_id === null && !role.is_system_role)
      )
        continue;
      // findAll's kitchen price projection is role-based. Empty roles are
      // mandatory to prevent permission fallback; do not silently remove a
      // restrictive role while granting monetary catalog data.
      if (role.name === 'kitchen') this.deny();
      for (const mapping of role.role_permissions) {
        const permission = mapping.permissions;
        if (
          permission?.status === 'active' &&
          typeof permission.name === 'string'
        )
          currentPermissions.add(permission.name);
      }
    }
    base.permissions = [...original].filter(
      (permission) =>
        currentPermissions.has(permission) && objective.has(permission),
    );
    const planScopes = new Set(
      config.tools_allowed.map((name) => this.registry.canonicalName(name)),
    );
    const catalog = this.registry.getAgentDefinitions(base.permissions, {
      allowed_tools: agent.allowed_tools,
      denied_tools: agent.denied_tools,
    });
    const offered = new Set(
      catalog.map((definition) => definition.function.name),
    );
    const names = manifest.filter(
      (name) =>
        offered.has(name) &&
        this.eligible(this.registry.get(name)) &&
        (planScopes.has('*') || this.registry.matchesScope(name, planScopes)),
    );
    if (!names.length) this.deny();
    return { context: base, names };
  }

  private product(value: unknown): JsonObject {
    if (
      !object(value) ||
      !positiveInteger(value.product_id) ||
      typeof value.name !== 'string' ||
      Buffer.byteLength(value.name, 'utf8') > 2048 ||
      !['active', 'inactive', 'archived'].includes(String(value.state)) ||
      !['physical', 'service', 'prepared'].includes(
        String(value.product_type),
      ) ||
      typeof value.inventory_tracked !== 'boolean' ||
      typeof value.has_variants !== 'boolean' ||
      typeof value.requires_variant_selection !== 'boolean' ||
      !nonnegativeInteger(value.variant_count) ||
      value.has_variants !== value.variant_count > 0 ||
      value.requires_variant_selection !== value.has_variants
    )
      this.deny();
    for (const field of ['net_price', 'unit_price'])
      if (typeof value[field] !== 'number' || !Number.isFinite(value[field]))
        this.deny();
    if (
      value.available_stock !== null &&
      (typeof value.available_stock !== 'number' ||
        !Number.isFinite(value.available_stock))
    )
      this.deny();
    for (const field of ['sku', 'brand'])
      if (
        value[field] !== null &&
        (typeof value[field] !== 'string' ||
          Buffer.byteLength(value[field] as string, 'utf8') > 2048)
      )
        this.deny();
    return Object.fromEntries(
      SAFE_PRODUCT_FIELDS.map((field) => [field, value[field]]),
    );
  }

  private receipt(result: ToolExecutionResult): ToolExecutionReceipt {
    if (
      result.schema_version !== '1' ||
      ![
        'ok',
        'recoverable_error',
        'blocked',
        'pending_confirmation',
        'needs_user_input',
        'unknown_effect',
      ].includes(result.status) ||
      !['observed', 'unknown', 'truncated'].includes(result.freshness) ||
      !Array.isArray(result.evidence_refs) ||
      !object(result.resource_ids)
    )
      this.deny();
    return safeObjectiveArtifact({
      schema_version: '1',
      status: result.status,
      error_code: result.error_code,
      retryable: result.retryable,
      next_action: result.next_action,
      evidence_refs: result.evidence_refs,
      resource_ids: result.resource_ids,
      pagination: result.pagination,
      freshness: result.freshness,
      effect_status: result.effect_status,
    }) as ToolExecutionReceipt;
  }

  /** JSON transport cannot carry accessors, prototypes, cycles or nonfinite values. */
  private plainJson(
    value: unknown,
    depth = 0,
    seen = new Set<object>(),
  ): boolean {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object' || depth > 16 || seen.has(value))
      return false;
    if (!Array.isArray(value) && !object(value)) return false;
    seen.add(value);
    try {
      if (Object.getOwnPropertySymbols(value).length) return false;
      for (const key of Object.getOwnPropertyNames(value)) {
        if (Array.isArray(value) && key === 'length') continue;
        if (
          Array.isArray(value) &&
          (!nonnegativeInteger(Number(key)) ||
            String(Number(key)) !== key ||
            Number(key) >= value.length)
        )
          return false;
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (
          !('value' in descriptor) ||
          !descriptor.enumerable ||
          !this.plainJson(descriptor.value, depth + 1, seen)
        )
          return false;
      }
      return true;
    } finally {
      seen.delete(value);
    }
  }

  private allowedName(name: unknown): name is 'list_products' {
    return (
      typeof name === 'string' &&
      (SANDBOX_READONLY_ALLOWLIST as readonly string[]).includes(name)
    );
  }

  private deny(): never {
    throw new ForbiddenException('SANDBOX_DENIED');
  }
}
