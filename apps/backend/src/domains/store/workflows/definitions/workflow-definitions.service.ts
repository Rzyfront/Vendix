import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WORKFLOW_KEY_PATTERN,
  WORKFLOW_SCHEMA_V1,
  WorkflowDefinitionV1,
  WorkflowValidationContext,
  WorkflowValidationResult,
  canonicalJson,
  normalizeDefinition,
  validateWorkflowDefinition,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowTx } from '../engine/workflow-engine.types';

export const MAX_DRAFT_BYTES = 256 * 1024;

type Json = Record<string, unknown>;

export interface CreateDefinitionInput {
  name: string;
  key?: string;
  description?: string | null;
  category?: string | null;
  definition?: Json;
  /** P5.4: gallery template the flow was activated from. */
  source_template_key?: string | null;
}

export interface ListDefinitionsInput {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'draft' | 'active' | 'archived';
}

const LIST_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  category: true,
  status: true,
  draft_updated_at: true,
  published_version_id: true,
  source_template_key: true,
  is_enabled: true,
  created_by_user_id: true,
  updated_by_user_id: true,
  created_at: true,
  updated_at: true,
};

const VERSION_SUMMARY = {
  id: true,
  version: true,
  schema_version: true,
  definition_hash: true,
  published_by_user_id: true,
  published_at: true,
  changelog: true,
};

/** Lowercase slug that satisfies WORKFLOW_KEY_PATTERN, or '' when impossible. */
export function slugifyKey(text: string): string {
  let s = (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) return '';
  if (!/^[a-z]/.test(s)) s = `f_${s}`;
  s = s.slice(0, 80).replace(/_+$/g, '');
  return WORKFLOW_KEY_PATTERN.test(s) ? s : '';
}

const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Draft CRUD, validation, publishing and versioning of workflow definitions. */
@Injectable()
export class WorkflowDefinitionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id,
    };
  }

  // ---- reads -------------------------------------------------------------

  async list(input: ListDefinitionsInput = {}) {
    const { store_id } = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 10));
    const where: Json = { store_id };
    if (input.status) where.status = input.status;
    if (input.search?.trim()) {
      const q = input.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.workflow_definitions.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workflow_definitions.count({ where }),
    ]);
    const versions = await this.versionSummaries(
      this.prisma,
      store_id,
      rows.map((r: any) => r.published_version_id),
    );
    return {
      data: rows.map((r: any) => this.present(r, versions.get(r.published_version_id) ?? null)),
      total,
      page,
      limit,
    };
  }

  async get(id: number) {
    const { store_id } = this.ctx();
    const row = await this.load(this.prisma, store_id, id);
    const version = row.published_version_id
      ? ((await this.versionSummaries(this.prisma, store_id, [row.published_version_id])).get(
          row.published_version_id,
        ) ?? null)
      : null;
    return {
      ...this.present(row, version),
      has_unpublished_changes: this.hasUnpublishedChanges(row, version),
    };
  }

  async getDraft(id: number) {
    const { store_id } = this.ctx();
    const row = await this.load(this.prisma, store_id, id);
    return {
      id: row.id,
      key: row.key,
      definition: row.draft_definition ?? null,
      draft_updated_at: row.draft_updated_at,
    };
  }

  async versions(id: number) {
    const { store_id } = this.ctx();
    await this.load(this.prisma, store_id, id);
    return this.prisma.workflow_versions.findMany({
      where: { definition_id: id, store_id },
      select: VERSION_SUMMARY,
      orderBy: { version: 'desc' },
    });
  }

  async version(id: number, versionNumber: number) {
    const { store_id } = this.ctx();
    await this.load(this.prisma, store_id, id);
    const v = await this.prisma.workflow_versions.findFirst({
      where: { definition_id: id, store_id, version: versionNumber },
    });
    if (!v) throw new VendixHttpException(ErrorCodes.WORKFLOW_VERSION_NOT_FOUND);
    return v;
  }

  /** The published JSON (or a given version); the draft when nothing is published. */
  async export(id: number, opts: { version?: number } = {}) {
    const { store_id } = this.ctx();
    const row = await this.load(this.prisma, store_id, id);
    if (opts.version !== undefined) {
      const v = await this.version(id, opts.version);
      return { source: 'version', version: v.version, definition: v.definition };
    }
    if (row.published_version_id) {
      const v = await this.prisma.workflow_versions.findFirst({
        where: { id: row.published_version_id, store_id },
      });
      if (v) return { source: 'published', version: v.version, definition: v.definition };
    }
    return { source: 'draft', version: null, definition: row.draft_definition ?? null };
  }

  // ---- writes ------------------------------------------------------------

  async create(input: CreateDefinitionInput) {
    const { store_id, organization_id, user_id } = this.ctx();
    const name = input.name.trim();
    let key = input.key?.trim() ?? '';
    const explicit = key.length > 0;
    if (explicit) {
      if (!WORKFLOW_KEY_PATTERN.test(key)) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'La clave solo admite minúsculas, números, guion y guion bajo, y debe empezar con una letra.',
        );
      }
    } else {
      key = slugifyKey(name) || 'flujo';
    }
    if (input.definition !== undefined) this.assertDraftShape(input.definition);
    key = explicit ? key : await this.freeKey(store_id, key);
    const draft = this.forceKey(input.definition ?? this.skeleton(key, name), key);
    this.assertDraftShape(draft);
    const row = await this.insertDraft({
      store_id,
      organization_id,
      user_id,
      key,
      name,
      description: input.description ?? null,
      category: input.category ?? null,
      source_template_key: input.source_template_key ?? null,
      draft,
    });
    return this.present(row, null);
  }

  async saveDraft(
    id: number,
    input: { definition: Json; expected_draft_updated_at?: string | Date | null },
  ) {
    const { store_id, user_id } = this.ctx();
    this.assertDraftShape(input.definition);
    const row = await this.load(this.prisma, store_id, id);
    if (input.expected_draft_updated_at) {
      const expected = new Date(input.expected_draft_updated_at).getTime();
      const actual = row.draft_updated_at
        ? new Date(row.draft_updated_at).getTime()
        : null;
      if (Number.isNaN(expected) || actual !== expected) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_DRAFT_CONFLICT);
      }
    }
    const now = new Date();
    const res = await this.prisma.workflow_definitions.updateMany({
      where: { id, store_id, draft_updated_at: row.draft_updated_at ?? null },
      data: {
        draft_definition: this.forceKey(input.definition, row.key),
        draft_updated_at: now,
        updated_by_user_id: user_id,
      },
    });
    if (res.count === 0) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DRAFT_CONFLICT);
    }
    return { id, draft_updated_at: now };
  }

  async validate(id: number): Promise<WorkflowValidationResult> {
    const { store_id, organization_id } = this.ctx();
    const row = await this.load(this.prisma, store_id, id);
    return this.validateAgainstStore(
      this.prisma,
      store_id,
      organization_id,
      this.forceKey(row.draft_definition ?? null, row.key),
    );
  }

  async validateDefinition(definition: unknown): Promise<WorkflowValidationResult> {
    const { store_id, organization_id } = this.ctx();
    return this.validateAgainstStore(this.prisma, store_id, organization_id, definition);
  }

  async publish(id: number, input: { changelog?: string | null } = {}) {
    const { store_id, organization_id, user_id } = this.ctx();
    try {
      return await this.prisma.$transaction(async (tx: WorkflowTx) => {
        const row = await this.load(tx, store_id, id);
        if (row.status === 'archived') {
          throw new VendixHttpException(
            ErrorCodes.WORKFLOW_NOT_ACTIVE,
            'El flujo está archivado; desarchívalo antes de publicar.',
          );
        }
        const draft = this.forceKey(row.draft_definition ?? null, row.key);
        const result = await this.validateAgainstStore(tx, store_id, organization_id, draft);
        if (!result.valid) {
          throw new VendixHttpException(
            ErrorCodes.WORKFLOW_INVALID,
            undefined,
            { errors: result.errors, warnings: result.warnings },
          );
        }
        const definition = normalizeDefinition(draft as unknown as WorkflowDefinitionV1);
        const hash = createHash('sha256').update(canonicalJson(definition)).digest('hex');

        const current = row.published_version_id
          ? await tx.workflow_versions.findFirst({
              where: { id: row.published_version_id, store_id },
              select: VERSION_SUMMARY,
            })
          : null;
        if (current && current.definition_hash === hash) {
          return { unchanged: true, version: current, warnings: result.warnings };
        }
        const last = await tx.workflow_versions.findFirst({
          where: { definition_id: id, store_id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await tx.workflow_versions.create({
          data: {
            store_id,
            definition_id: id,
            version: (last?.version ?? 0) + 1,
            schema_version: WORKFLOW_SCHEMA_V1,
            definition,
            definition_hash: hash,
            published_by_user_id: user_id,
            changelog: input.changelog?.trim() || null,
          },
        });
        const upd = await tx.workflow_definitions.updateMany({
          where: { id, store_id },
          data: {
            published_version_id: created.id,
            status: 'active',
            name: definition.name,
            updated_by_user_id: user_id,
          },
        });
        if (upd.count === 0) {
          throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
        }
        const { definition: _body, ...summary } = created;
        return { unchanged: false, version: summary, warnings: result.warnings };
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
      throw e;
    }
  }

  /**
   * Imports a definition JSON as a new draft. Only the SHAPE is validated here
   * (no store context), the result is returned so the UI can show which roles,
   * groups or users still need remapping.
   */
  async import(input: { definition: Json; name?: string }) {
    const { store_id, organization_id, user_id } = this.ctx();
    this.assertDraftShape(input.definition);
    const structural = validateWorkflowDefinition(input.definition);
    const contextual = await this.validateAgainstStore(
      this.prisma,
      store_id,
      organization_id,
      input.definition,
    );
    const name =
      input.name?.trim() ||
      (typeof input.definition.name === 'string' && input.definition.name.trim()) ||
      'Flujo importado';
    const wanted =
      typeof input.definition.key === 'string' &&
      WORKFLOW_KEY_PATTERN.test(input.definition.key)
        ? input.definition.key
        : slugifyKey(name) || 'flujo';
    const key = await this.freeKey(store_id, wanted);
    const draft = this.forceKey({ ...input.definition, name }, key);
    this.assertDraftShape(draft);
    const row = await this.insertDraft({
      store_id,
      organization_id,
      user_id,
      key,
      name: name.slice(0, 160),
      description: null,
      category: null,
      draft,
    });
    return {
      definition: this.present(row, null),
      validation: { structural, store: contextual },
    };
  }

  async archive(id: number) {
    return this.setStatus(id, 'archived');
  }

  /**
   * P2.11: the switch. Off = no new requests from any trigger (manual, public
   * form, events, schedule, subflows) and the flow governs no operation; live
   * requests keep going.
   */
  async setEnabled(id: number, enabled: boolean) {
    const { store_id, user_id } = this.ctx();
    await this.load(this.prisma, store_id, id);
    await this.prisma.workflow_definitions.updateMany({
      where: { id, store_id },
      data: { is_enabled: enabled, updated_by_user_id: user_id },
    });
    return this.get(id);
  }

  /** Back to `active` when it has a published version, else `draft`. */
  async unarchive(id: number) {
    const { store_id } = this.ctx();
    const row = await this.load(this.prisma, store_id, id);
    return this.setStatus(id, row.published_version_id ? 'active' : 'draft');
  }

  // ---- internals ---------------------------------------------------------

  private async setStatus(id: number, status: 'draft' | 'active' | 'archived') {
    const { store_id, user_id } = this.ctx();
    await this.load(this.prisma, store_id, id);
    await this.prisma.workflow_definitions.updateMany({
      where: { id, store_id },
      data: { status, updated_by_user_id: user_id },
    });
    return this.get(id);
  }

  private async load(db: WorkflowTx, storeId: number, id: number) {
    const row = await db.workflow_definitions.findFirst({
      where: { id, store_id: storeId },
    });
    if (!row) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return row;
  }

  private async versionSummaries(
    db: WorkflowTx,
    storeId: number,
    ids: Array<number | null | undefined>,
  ) {
    const wanted = ids.filter((i): i is number => !!i);
    const out = new Map<number, any>();
    if (wanted.length === 0) return out;
    const rows = await db.workflow_versions.findMany({
      where: { id: { in: wanted }, store_id: storeId },
      select: VERSION_SUMMARY,
    });
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  /** Row without the (large) draft body. */
  private present(row: any, publishedVersion: any) {
    const { draft_definition, published_version_id, ...rest } = row;
    return {
      ...rest,
      has_draft: draft_definition !== undefined ? draft_definition !== null : !!rest.draft_updated_at,
      published_version: publishedVersion,
    };
  }

  private hasUnpublishedChanges(row: any, version: any): boolean {
    if (!row.draft_definition) return false;
    if (!version) return true;
    try {
      const norm = normalizeDefinition(row.draft_definition as WorkflowDefinitionV1);
      const hash = createHash('sha256').update(canonicalJson(norm)).digest('hex');
      return hash !== version.definition_hash;
    } catch {
      return true;
    }
  }

  private assertDraftShape(def: unknown): asserts def is Json {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(def) ?? '', 'utf8');
    } catch {
      bytes = Infinity;
    }
    if (!isObj(def) || bytes > MAX_DRAFT_BYTES) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DRAFT_INVALID);
    }
  }

  /** The stored definition key always equals the row key. */
  private forceKey<T>(def: T, key: string): T {
    return isObj(def) ? ({ ...def, key } as T) : def;
  }

  private skeleton(key: string, name: string): Json {
    return {
      schema: WORKFLOW_SCHEMA_V1,
      key,
      name,
      fields: [],
      stages: [
        {
          key: 'request',
          name: 'Solicitud',
          type: 'form',
          start: true,
          assignee: { kind: 'initiator' },
          form: { fields: [] },
          transitions: [{ on: 'submit', to: 'done' }],
        },
        { key: 'done', name: 'Completada', type: 'end', outcome: 'completed' },
      ],
    };
  }

  private async freeKey(storeId: number, wanted: string): Promise<string> {
    const taken = new Set<string>(
      (
        await this.prisma.workflow_definitions.findMany({
          where: { store_id: storeId, key: { contains: wanted } },
          select: { key: true },
        })
      ).map((r: { key: string }) => r.key),
    );
    if (!taken.has(wanted)) return wanted;
    for (let n = 2; n < 1000; n++) {
      const suffix = `_${n}`;
      const candidate = `${wanted.slice(0, 80 - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
    throw new VendixHttpException(ErrorCodes.WORKFLOW_KEY_TAKEN);
  }

  private async insertDraft(p: {
    store_id: number;
    organization_id: number;
    user_id: number;
    key: string;
    name: string;
    description: string | null;
    category: string | null;
    source_template_key?: string | null;
    draft: Json;
  }) {
    try {
      return await this.prisma.workflow_definitions.create({
        data: {
          store_id: p.store_id,
          organization_id: p.organization_id,
          key: p.key,
          name: p.name.slice(0, 160),
          description: p.description,
          category: p.category,
          source_template_key: p.source_template_key ?? null,
          status: 'draft',
          draft_definition: p.draft,
          draft_updated_at: new Date(),
          created_by_user_id: p.user_id,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_KEY_TAKEN);
      }
      throw e;
    }
  }

  /**
   * Context built from the DB. `publishedTemplateKeys` are the keys of the
   * store's templates with a published version (P4.1): a requirement that
   * references any other template fails closed.
   */
  private async validateAgainstStore(
    db: WorkflowTx,
    storeId: number,
    organizationId: number,
    definition: unknown,
  ): Promise<WorkflowValidationResult> {
    return validateWorkflowDefinition(
      definition,
      await this.buildValidationContext(db, storeId, organizationId),
    );
  }

  /** Role and group keys the validator accepts for this store (also read by the AI tools). */
  async validationContext(): Promise<WorkflowValidationContext> {
    const { store_id, organization_id } = this.ctx();
    return this.buildValidationContext(this.prisma, store_id, organization_id);
  }

  private async buildValidationContext(
    db: WorkflowTx,
    storeId: number,
    organizationId: number,
  ): Promise<WorkflowValidationContext> {
    const [roles, groups, members, storeUsers, flows] = await Promise.all([
      db.roles.findMany({
        where: {
          OR: [
            { organization_id: null },
            {
              organization_id: organizationId,
              OR: [{ store_id: null }, { store_id: storeId }],
            },
          ],
        },
        select: { name: true },
      }),
      db.work_groups.findMany({
        where: { store_id: storeId, is_active: true },
        select: { id: true, key: true },
      }),
      db.work_group_members.findMany({
        where: { store_id: storeId, is_available: true },
        select: { work_group_id: true },
      }),
      db.store_users.findMany({
        where: { store_id: storeId },
        select: { user_id: true },
      }),
      // P2.2: only a published, active flow can start as a child.
      db.workflow_definitions.findMany({
        where: { store_id: storeId, status: 'active', published_version_id: { not: null } },
        select: { key: true },
      }),
    ]);
    const templates = await db.document_templates.findMany({
      where: { store_id: storeId, status: 'published', published_version_id: { not: null } },
      select: { key: true },
    });
    const withMembers = new Set<number>(members.map((m: any) => m.work_group_id));
    // P3.2: `{{secrets.NAME}}` must name a secret of this store (names only).
    const secrets = await db.workflow_secrets.findMany({
      where: { store_id: storeId },
      select: { name: true },
    });
    // P3.6: custom collections of the store (archived ones no longer validate).
    const collections = await db.workflow_collections.findMany({
      where: { store_id: storeId, is_archived: false },
      select: { key: true, fields: true },
    });
    return {
      secretNames: secrets.map((s: { name: string }) => s.name),
      collections: Object.fromEntries(
        collections.map((c: { key: string; fields: unknown }) => [
          c.key,
          ((c.fields ?? []) as Array<{ key: string; type: string }>).map((f) => ({
            key: f.key,
            type: f.type,
          })),
        ]),
      ),
      roleKeys: [...new Set<string>(roles.map((r: any) => r.name))],
      groupKeys: groups.filter((g: any) => withMembers.has(g.id)).map((g: any) => g.key),
      userIds: storeUsers.map((u: any) => u.user_id),
      publishedTemplateKeys: templates.map((t: { key: string }) => t.key),
      // P2.2: subflows may only launch published flows of this store.
      flowKeys: flows.map((f: any) => f.key),
    };
  }
}
