import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, WorkflowRecordFieldDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreateWorkflowCollectionDto,
  UpdateWorkflowCollectionDto,
  WorkflowCollectionsQueryDto,
} from './workflow-records.dto';
import {
  FieldIssue,
  defaultReferencePrefix,
  validateCollectionFields,
} from './workflow-record-fields';

const RECORD_TOKEN = /\{\{\s*record\.([a-z][a-z0-9_-]*)\s*\}\}/g;

export interface WorkflowCollectionRow {
  id: number;
  organization_id: number;
  store_id: number;
  key: string;
  name: string;
  item_name: string;
  description: string | null;
  icon: string | null;
  fields: WorkflowRecordFieldDef[];
  title_field: string | null;
  reference_prefix: string;
  next_number: number;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * P3.6: user-defined collections (contracts, assets, policies...). A collection
 * is archived, never deleted; its `key` never changes because published flows
 * point at it.
 */
@Injectable()
export class WorkflowCollectionsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
    };
  }

  async list(query: WorkflowCollectionsQueryDto = {}) {
    const { store_id } = this.ctx();
    const rows = (await this.prisma.workflow_collections.findMany({
      where: {
        store_id,
        ...(query.include_archived ? {} : { is_archived: false }),
      },
      orderBy: { name: 'asc' },
    })) as WorkflowCollectionRow[];
    const counts = (await this.prisma.workflow_records.groupBy({
      by: ['collection_id'],
      where: { store_id, archived_at: null },
      _count: { _all: true },
    })) as Array<{ collection_id: number; _count: { _all: number } }>;
    const byCollection = new Map(counts.map((c) => [c.collection_id, c._count._all]));
    return rows.map((r) => ({ ...r, records_count: byCollection.get(r.id) ?? 0 }));
  }

  /** 404 for a collection of another store. */
  async get(id: number): Promise<WorkflowCollectionRow> {
    const { store_id } = this.ctx();
    const row = await this.prisma.workflow_collections.findFirst({
      where: { id, store_id },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_NOT_FOUND);
    return row as WorkflowCollectionRow;
  }

  async create(dto: CreateWorkflowCollectionDto) {
    const { store_id, organization_id, user_id } = this.ctx();
    if (user_id === null) throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_NOT_FOUND);
    const fields = this.parseFields(dto.fields);
    this.assertTitleField(fields, dto.title_field);
    const taken = await this.prisma.workflow_collections.findFirst({
      where: { store_id, key: dto.key },
      select: { id: true },
    });
    if (taken) throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_KEY_TAKEN);
    try {
      return await this.prisma.workflow_collections.create({
        data: {
          organization_id,
          store_id,
          key: dto.key,
          name: dto.name.trim(),
          item_name: dto.item_name.trim(),
          description: dto.description?.trim() || null,
          icon: dto.icon?.trim() || null,
          fields: fields as never,
          title_field: dto.title_field || null,
          reference_prefix: dto.reference_prefix ?? defaultReferencePrefix(dto.name),
          next_number: 1,
          is_archived: false,
          created_by_user_id: user_id,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_KEY_TAKEN);
      }
      throw e;
    }
  }

  async update(id: number, dto: UpdateWorkflowCollectionDto) {
    const { store_id } = this.ctx();
    const current = await this.get(id);
    const fields = dto.fields ? this.parseFields(dto.fields) : current.fields;
    const titleField = dto.title_field !== undefined ? dto.title_field || null : current.title_field;
    this.assertTitleField(fields, titleField ?? undefined);
    if (dto.fields) await this.assertFieldsFree(current, fields);
    await this.prisma.workflow_collections.updateMany({
      where: { id, store_id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.item_name !== undefined && { item_name: dto.item_name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.icon !== undefined && { icon: dto.icon.trim() || null }),
        ...(dto.reference_prefix !== undefined && { reference_prefix: dto.reference_prefix }),
        ...(dto.fields && { fields: fields as never }),
        title_field: titleField,
        updated_at: new Date(),
      },
    });
    return this.get(id);
  }

  /** Archive instead of delete: records and flows keep pointing at it. */
  async archive(id: number) {
    const { store_id } = this.ctx();
    await this.get(id);
    await this.prisma.workflow_collections.updateMany({
      where: { id, store_id },
      data: { is_archived: true, updated_at: new Date() },
    });
    return this.get(id);
  }

  private parseFields(input: unknown): WorkflowRecordFieldDef[] {
    const r = validateCollectionFields(input);
    if (!r.ok) this.invalid(r.errors);
    return (r as { fields: WorkflowRecordFieldDef[] }).fields;
  }

  private assertTitleField(fields: readonly WorkflowRecordFieldDef[], titleField?: string) {
    if (!titleField) return;
    const f = fields.find((x) => x.key === titleField);
    if (!f || f.type !== 'text') {
      this.invalid([
        { field: 'title_field', message: 'El campo título debe ser un campo de texto de la colección.' },
      ]);
    }
  }

  private invalid(errors: FieldIssue[]): never {
    throw new VendixHttpException(
      ErrorCodes.WORKFLOW_COLLECTION_INVALID,
      errors[0]?.message,
      { errors },
    );
  }

  /**
   * A field cannot be removed (nor stop being a date) while a published flow
   * of this collection reads it in a `record_date` trigger or a
   * `{{record.<key>}}` map: 409 naming the flows.
   */
  private async assertFieldsFree(
    current: WorkflowCollectionRow,
    next: readonly WorkflowRecordFieldDef[],
  ) {
    const removed = new Set<string>();
    const notDate = new Set<string>();
    for (const old of current.fields) {
      const kept = next.find((f) => f.key === old.key);
      if (!kept) removed.add(old.key);
      else if (old.type === 'date' && kept.type !== 'date') notDate.add(old.key);
    }
    if (removed.size === 0 && notDate.size === 0) return;
    const { store_id } = this.ctx();
    const defs = (await this.prisma.workflow_definitions.findMany({
      where: { store_id, status: 'active', published_version_id: { not: null } },
      select: { id: true, key: true, name: true, published_version_id: true },
    })) as Array<{ id: number; key: string; name: string; published_version_id: number }>;
    if (defs.length === 0) return;
    const versions = (await this.prisma.workflow_versions.findMany({
      where: { store_id, id: { in: defs.map((d) => d.published_version_id) } },
      select: { id: true, definition: true },
    })) as Array<{ id: number; definition: WorkflowDefinitionV1 }>;
    const byVersion = new Map(versions.map((v) => [v.id, v.definition]));
    const usedFields = new Set<string>();
    const flows: Array<{ id: number; key: string; name: string }> = [];
    for (const d of defs) {
      const definition = byVersion.get(d.published_version_id);
      if (
        definition?.subject?.type !== 'custom_record' ||
        definition.subject.collection !== current.key
      ) {
        continue;
      }
      let uses = false;
      for (const t of definition.triggers ?? []) {
        if (t.kind !== 'record_date') continue;
        if (removed.has(t.field) || notDate.has(t.field)) {
          usedFields.add(t.field);
          uses = true;
        }
        for (const template of Object.values(t.map ?? {})) {
          for (const m of template.matchAll(RECORD_TOKEN)) {
            if (removed.has(m[1])) {
              usedFields.add(m[1]);
              uses = true;
            }
          }
        }
      }
      if (uses) flows.push({ id: d.id, key: d.key, name: d.name });
    }
    if (flows.length === 0) return;
    throw new VendixHttpException(
      ErrorCodes.WORKFLOW_COLLECTION_FIELD_IN_USE,
      `Los campos ${[...usedFields].map((k) => `"${k}"`).join(', ')} los usan los flujos publicados: ${flows
        .map((f) => f.name)
        .join(', ')}.`,
      { fields: [...usedFields], flows },
    );
  }
}
