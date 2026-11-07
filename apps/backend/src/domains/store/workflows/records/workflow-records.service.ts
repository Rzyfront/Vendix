import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1 } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../../documents/dossiers.service';
import { StoredFilesService } from '../../documents/stored-files.service';
import { WorkflowCommandResult } from '../engine/workflow-engine.types';
import { WorkflowEngineService } from '../engine/workflow-engine.service';
import { WorkflowCollectionRow, WorkflowCollectionsService } from './workflow-collections.service';
import {
  CreateWorkflowRecordDto,
  UpdateWorkflowRecordDto,
  WorkflowRecordsQueryDto,
} from './workflow-records.dto';
import {
  FieldIssue,
  RecordValues,
  formatReference,
  prefillFlowFields,
  recordTitle,
  validateRecordValues,
} from './workflow-record-fields';

export const RECORD_SUBJECT = 'custom_record';
const RECORD_STAGE = 'record';
const DOSSIER_PREFIX = 'EXP-';

export interface WorkflowRecordRow {
  id: number;
  organization_id: number;
  store_id: number;
  collection_id: number;
  reference: string;
  title: string;
  data: Record<string, unknown>;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UploadedRecordFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const shape = (r: WorkflowRecordRow) => ({
  id: r.id,
  collection_id: r.collection_id,
  reference: r.reference,
  title: r.title,
  values: r.data ?? {},
  archived_at: r.archived_at,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

/**
 * P3.6: records of a custom collection with their dossier ("expediente") and
 * the requests that have the record as subject. Every read and write carries the
 * store of the context; a foreign id is a 404.
 */
@Injectable()
export class WorkflowRecordsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly collections: WorkflowCollectionsService,
    private readonly dossiers: DossiersService,
    private readonly files: StoredFilesService,
    private readonly engine: WorkflowEngineService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_RECORD_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
    };
  }

  async list(query: WorkflowRecordsQueryDto) {
    const { store_id } = this.ctx();
    await this.collections.get(query.collection_id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();
    const where: Record<string, unknown> = {
      store_id,
      collection_id: query.collection_id,
      ...(query.include_archived ? {} : { archived_at: null }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { reference: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workflow_records.findMany({
        where,
        orderBy: { [query.sort_by ?? 'created_at']: query.sort_order ?? 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workflow_records.count({ where }),
    ]);
    return { data: (rows as WorkflowRecordRow[]).map(shape), total, page, limit };
  }

  /**
   * Record with its collection, dossier items and the requests about it. An
   * archived record (listed with `include_archived`) is readable with the same
   * flag; every write still treats it as gone.
   */
  async get(id: number, opts: { include_archived?: boolean } = {}) {
    const record = await this.load(id, opts.include_archived === true);
    const collection = await this.collections.get(record.collection_id);
    const dossier = await this.findDossier(record.id);
    const { store_id } = this.ctx();
    const instances = await this.prisma.workflow_instances.findMany({
      where: { store_id, subject_type: RECORD_SUBJECT, subject_id: record.id },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        current_stage_key: true,
        definition_id: true,
        created_at: true,
        completed_at: true,
      },
      orderBy: { id: 'desc' },
    });
    const definitionIds = [...new Set((instances as Array<{ definition_id: number }>).map((i) => i.definition_id))];
    const defs = definitionIds.length
      ? ((await this.prisma.workflow_definitions.findMany({
          where: { store_id, id: { in: definitionIds } },
          select: { id: true, name: true },
        })) as Array<{ id: number; name: string }>)
      : [];
    const names = new Map(defs.map((d) => [d.id, d.name]));
    return {
      ...shape(record),
      collection: {
        id: collection.id,
        key: collection.key,
        name: collection.name,
        item_name: collection.item_name,
        icon: collection.icon,
        fields: collection.fields,
        title_field: collection.title_field,
      },
      dossier: dossier
        ? {
            id: dossier.id,
            reference: dossier.reference,
            items: await this.dossiers.items(dossier.id),
          }
        : null,
      instances: (instances as Array<Record<string, unknown> & { definition_id: number }>).map((i) => ({
        ...i,
        definition_name: names.get(i.definition_id) ?? null,
      })),
      /** Published, switched-on flows of this collection ("Iniciar flujo"). */
      flows: await this.startableFlows(collection.key),
    };
  }

  private async startableFlows(collectionKey: string) {
    const { store_id } = this.ctx();
    const defs = (await this.prisma.workflow_definitions.findMany({
      where: {
        store_id,
        status: 'active',
        is_enabled: true,
        published_version_id: { not: null },
      },
      select: { id: true, key: true, name: true, published_version_id: true },
      orderBy: { name: 'asc' },
    })) as Array<{ id: number; key: string; name: string; published_version_id: number }>;
    if (defs.length === 0) return [];
    const versions = (await this.prisma.workflow_versions.findMany({
      where: { store_id, id: { in: defs.map((d) => d.published_version_id) } },
      select: { id: true, definition: true },
    })) as Array<{ id: number; definition: WorkflowDefinitionV1 }>;
    const own = new Set(
      versions
        .filter(
          (v) =>
            v.definition?.subject?.type === RECORD_SUBJECT &&
            v.definition.subject.collection === collectionKey,
        )
        .map((v) => v.id),
    );
    return defs
      .filter((d) => own.has(d.published_version_id))
      .map((d) => ({ id: d.id, key: d.key, name: d.name }));
  }

  async create(dto: CreateWorkflowRecordDto) {
    const { store_id, organization_id, user_id } = this.ctx();
    if (user_id === null) throw new VendixHttpException(ErrorCodes.WORKFLOW_RECORD_NOT_FOUND);
    const collection = await this.collections.get(dto.collection_id);
    if (collection.is_archived) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_ARCHIVED);
    }
    const values = this.parseValues(collection, dto.values);
    const created = await this.prisma.$transaction(async (tx: any) => {
      // Atomic correlative: the UPDATE locks the collection row until commit,
      // so two concurrent creations never read the same number.
      const rows: Array<{ n: number | bigint }> = await tx.$queryRaw`
        UPDATE workflow_collections
        SET next_number = next_number + 1, updated_at = now()
        WHERE id = ${collection.id} AND store_id = ${store_id}
        RETURNING next_number - 1 AS n`;
      if (!rows[0]) throw new VendixHttpException(ErrorCodes.WORKFLOW_COLLECTION_NOT_FOUND);
      const reference = formatReference(collection.reference_prefix, Number(rows[0].n));
      return tx.workflow_records.create({
        data: {
          organization_id,
          store_id,
          collection_id: collection.id,
          reference,
          title: recordTitle(collection.title_field, values, reference),
          data: values,
          created_by_user_id: user_id,
        },
      });
    });
    return shape(created as WorkflowRecordRow);
  }

  /**
   * `values` are merged over the stored ones; `null` clears an optional value.
   * Values of fields the collection no longer declares (a field was removed)
   * are kept as they are and not validated: the form cannot show or send them,
   * so they must not block editing the fields it does show.
   */
  async update(id: number, dto: UpdateWorkflowRecordDto) {
    const { store_id, user_id } = this.ctx();
    const record = await this.load(id);
    const collection = await this.collections.get(record.collection_id);
    const declared = new Set(collection.fields.map((f) => f.key));
    const merged: Record<string, unknown> = {};
    // Stored values were validated when written: scalars only.
    const retired: RecordValues = {};
    for (const [k, v] of Object.entries(record.data ?? {})) {
      if (declared.has(k)) merged[k] = v;
      else retired[k] = v as RecordValues[string];
    }
    for (const [k, v] of Object.entries(dto.values)) {
      if (v === null) {
        delete merged[k];
        delete retired[k];
      } else {
        merged[k] = v;
      }
    }
    const values = this.parseValues(collection, merged);
    await this.prisma.workflow_records.updateMany({
      where: { id, store_id, archived_at: null },
      data: {
        data: { ...retired, ...values },
        title: recordTitle(collection.title_field, values, record.reference),
        updated_by_user_id: user_id,
        updated_at: new Date(),
      },
    });
    return shape(await this.load(id));
  }

  /** Archive instead of delete: requests and the dossier keep their subject. */
  async archive(id: number) {
    const { store_id, user_id } = this.ctx();
    await this.load(id);
    await this.prisma.workflow_records.updateMany({
      where: { id, store_id },
      data: { archived_at: new Date(), updated_by_user_id: user_id, updated_at: new Date() },
    });
    return shape(await this.load(id, true));
  }

  // ---- dossier -----------------------------------------------------------

  /** Attaches a file to the record's dossier (created with the first file). */
  async uploadFile(id: number, blob: UploadedRecordFile | undefined) {
    if (!blob?.buffer) throw new VendixHttpException(ErrorCodes.DOCUMENT_FILE_REQUIRED);
    const { store_id, organization_id, user_id } = this.ctx();
    const record = await this.load(id);
    const actor = { type: 'user' as const, id: user_id };
    const file = await this.files.upload({
      buffer: blob.buffer,
      originalName: blob.originalname,
      mimeType: blob.mimetype,
      source: 'upload',
      folder: `workflows/records/${record.id}`,
      actor,
    });
    try {
      const item = await this.prisma.$transaction(async (tx: any) => {
        // Serializes uploads of one record: two first files never create two dossiers.
        await tx.$queryRaw`SELECT id FROM workflow_records WHERE id = ${record.id} AND store_id = ${store_id} FOR NO KEY UPDATE`;
        const dossier =
          (await tx.dossiers.findFirst({
            where: {
              store_id,
              subject_type: RECORD_SUBJECT,
              subject_id: record.id,
              workflow_instance_id: null,
            },
          })) ?? (await this.createDossier(tx, record, store_id, organization_id));
        // A distinct field key per file: a new upload never supersedes another.
        return this.dossiers.addFileItem(tx, {
          dossier_id: dossier.id,
          file_id: file.id,
          stage_key: RECORD_STAGE,
          field_key: `file_${file.id}`,
          actor,
        });
      });
      return {
        file_id: file.id,
        item_id: item.id,
        original_name: file.original_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
      };
    } catch (e) {
      await this.files.discard(file);
      throw e;
    }
  }

  /** Signed URL of a file that belongs to the record's dossier; 404 otherwise. */
  async downloadFile(id: number, fileId: number) {
    const { store_id } = this.ctx();
    const record = await this.load(id, true);
    const dossier = await this.findDossier(record.id);
    const item = dossier
      ? await this.prisma.dossier_items.findFirst({
          where: { store_id, dossier_id: dossier.id, file_id: fileId },
          select: { id: true },
        })
      : null;
    if (!item) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return this.files.signedDownloadUrl(fileId);
  }

  // ---- flows on a record -------------------------------------------------

  /**
   * Starts a flow with the record as subject (same path as a manual start:
   * the engine checks permission, publication and that the record belongs to
   * the flow's collection). Pre-fill rule: record values whose key equals a
   * flow field key are copied when the types are compatible (see
   * `prefillFlowFields`).
   */
  async startFlow(
    id: number,
    definitionId: number,
    idempotencyKey?: string,
  ): Promise<WorkflowCommandResult> {
    const { store_id } = this.ctx();
    const record = await this.load(id);
    const collection = await this.collections.get(record.collection_id);
    const def = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id },
      select: { id: true, status: true, published_version_id: true },
    });
    if (!def) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    if (def.status !== 'active' || !def.published_version_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    }
    const version = (await this.prisma.workflow_versions.findFirst({
      where: { id: def.published_version_id, store_id },
      select: { definition: true },
    })) as { definition: WorkflowDefinitionV1 } | null;
    const definition = version?.definition;
    if (!definition) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_ACTIVE);
    if (
      definition.subject?.type !== RECORD_SUBJECT ||
      definition.subject.collection !== collection.key
    ) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_SUBJECT_NOT_FOUND,
        'Este flujo no es de la colección de este registro.',
      );
    }
    return this.engine.start({
      definitionId: def.id,
      subject: { type: RECORD_SUBJECT, id: record.id },
      data: prefillFlowFields(collection.fields, record.data ?? {}, definition.fields),
      idempotencyKey,
    });
  }

  // ---- internals ---------------------------------------------------------

  private async load(id: number, includeArchived = false): Promise<WorkflowRecordRow> {
    const { store_id } = this.ctx();
    const row = await this.prisma.workflow_records.findFirst({
      where: { id, store_id, ...(includeArchived ? {} : { archived_at: null }) },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_RECORD_NOT_FOUND);
    return row as WorkflowRecordRow;
  }

  private parseValues(collection: WorkflowCollectionRow, input: unknown): RecordValues {
    const r = validateRecordValues(collection.fields, input ?? {});
    if (!r.ok) {
      const errors: FieldIssue[] = r.errors;
      throw new VendixHttpException(ErrorCodes.WORKFLOW_RECORD_INVALID, errors[0]?.message, { errors });
    }
    return r.values;
  }

  private findDossier(recordId: number) {
    const { store_id } = this.ctx();
    return this.prisma.dossiers.findFirst({
      where: {
        store_id,
        subject_type: RECORD_SUBJECT,
        subject_id: recordId,
        workflow_instance_id: null,
      },
    });
  }

  /**
   * Dossier of a record (no instance). `DossiersService.createForInstance`
   * always binds an instance, so the subject-only dossier is created here with
   * the same `EXP-` per-store sequence and the same store lock.
   */
  private async createDossier(
    tx: any,
    record: WorkflowRecordRow,
    storeId: number,
    organizationId: number,
  ) {
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId} FOR NO KEY UPDATE`;
    const rows: Array<{ n: number | bigint }> = await tx.$queryRaw`
      SELECT (COALESCE(MAX(CAST(SUBSTRING(reference FROM 5) AS INTEGER)), 0) + 1)::int AS n
      FROM dossiers
      WHERE store_id = ${storeId} AND reference ~ '^EXP-[0-9]+$'`;
    return tx.dossiers.create({
      data: {
        organization_id: organizationId,
        store_id: storeId,
        reference: `${DOSSIER_PREFIX}${String(Number(rows[0]?.n ?? 1)).padStart(6, '0')}`,
        title: record.title,
        subject_type: RECORD_SUBJECT,
        subject_id: record.id,
      },
    });
  }
}
