import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

export type DocumentActor = {
  type: 'user' | 'public' | 'system' | 'ai';
  id: number | null;
};

export interface DossierInstanceRef {
  id: number;
  organization_id: number;
  store_id: number;
  title: string;
  subject_type: string | null;
  subject_id: number | null;
}

export interface AddFileItemInput {
  dossier_id: number;
  file_id: number;
  stage_key: string;
  /** Exactly one of the two (the caller validates the XOR). */
  requirement_key?: string | null;
  field_key?: string | null;
  actor: DocumentActor;
}

export interface AddDocumentItemInput {
  dossier_id: number;
  kind: 'issued_document' | 'signed_document';
  issued_document_id: number;
  file_id: number;
  stage_key?: string | null;
  requirement_key?: string | null;
  actor: DocumentActor;
}

const ACTIVE = ['received', 'validated'];

/** Dossier (expediente) per workflow instance and its items. */
@Injectable()
export class DossiersService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id };
  }

  /**
   * `EXP-` + zero-padded per-store sequence. Same lock-then-read strategy as
   * the workflow reference: the store row is locked inside the caller's
   * transaction, so concurrent creations of one store queue up.
   */
  private async nextReference(tx: any, storeId: number): Promise<string> {
    await tx.$queryRaw`SELECT id FROM stores WHERE id = ${storeId} FOR NO KEY UPDATE`;
    const rows: Array<{ n: number | bigint }> = await tx.$queryRaw`
      SELECT (COALESCE(MAX(CAST(SUBSTRING(reference FROM 5) AS INTEGER)), 0) + 1)::int AS n
      FROM dossiers
      WHERE store_id = ${storeId} AND reference ~ '^EXP-[0-9]+$'`;
    return `EXP-${String(Number(rows[0]?.n ?? 1)).padStart(6, '0')}`;
  }

  /** Called by the engine start inside its transaction. */
  async createForInstance(tx: any, instance: DossierInstanceRef) {
    const reference = await this.nextReference(tx, instance.store_id);
    return tx.dossiers.create({
      data: {
        organization_id: instance.organization_id,
        store_id: instance.store_id,
        reference,
        title: instance.title,
        subject_type: instance.subject_type,
        subject_id: instance.subject_id,
        workflow_instance_id: instance.id,
      },
    });
  }

  async getByInstance(instanceId: number, tx?: any) {
    const c = this.ctx();
    return (tx ?? this.prisma).dossiers.findFirst({
      where: { workflow_instance_id: instanceId, store_id: c.store_id },
    });
  }

  /** Items of a dossier: active first (oldest first), then the superseded chain. */
  async items(dossierId: number, tx?: any) {
    const c = this.ctx();
    const db = tx ?? this.prisma;
    const rows: any[] = await db.dossier_items.findMany({
      where: { dossier_id: dossierId, store_id: c.store_id },
      orderBy: { id: 'asc' },
    });
    const fileIds = [...new Set(rows.map((r) => r.file_id).filter(Boolean))];
    const files: any[] = fileIds.length
      ? await db.stored_files.findMany({
          where: { id: { in: fileIds }, store_id: c.store_id },
        })
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));
    const shape = (r: any) => {
      const f = r.file_id ? byId.get(r.file_id) : null;
      return {
        id: r.id,
        kind: r.kind,
        requirement_key: r.requirement_key,
        stage_key: r.stage_key,
        field_key: r.field_key,
        status: r.status,
        supersedes_id: r.supersedes_id,
        note: r.note,
        added_by_type: r.added_by_type,
        added_by_id: r.added_by_id,
        created_at: r.created_at,
        file: f
          ? {
              id: f.id,
              original_name: f.original_name,
              mime_type: f.mime_type,
              size_bytes: f.size_bytes,
              sha256: f.sha256,
            }
          : null,
      };
    };
    const active = rows.filter((r) => r.status !== 'superseded').map(shape);
    const superseded = rows.filter((r) => r.status === 'superseded').map(shape);
    return [...active, ...superseded];
  }

  async get(id: number) {
    const c = this.ctx();
    const dossier = await this.prisma.dossiers.findFirst({
      where: { id, store_id: c.store_id },
    });
    if (!dossier) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    return { ...dossier, items: await this.items(dossier.id) };
  }

  /** `{id, reference, items}` for the instance detail; null when it has none. */
  async summaryForInstance(instanceId: number) {
    const d = await this.getByInstance(instanceId);
    if (!d) return null;
    return { id: d.id, reference: d.reference, items: await this.items(d.id) };
  }

  async list(input: { page?: number; limit?: number; search?: string } = {}) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 10));
    const and: Array<Record<string, unknown>> = [{ store_id: c.store_id }];
    const q = input.search?.trim();
    if (q) {
      and.push({
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { title: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    const where = { AND: and };
    const [data, total] = await Promise.all([
      this.prisma.dossiers.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dossiers.count({ where }),
    ]);
    // Active items per dossier in one query, so the list shows the count
    // without one detail request per row.
    const ids = data.map((d: { id: number }) => d.id);
    const items: Array<{ dossier_id: number }> = ids.length
      ? await this.prisma.dossier_items.findMany({
          where: {
            store_id: c.store_id,
            dossier_id: { in: ids },
            status: { in: ['received', 'validated', 'rejected'] },
          },
          select: { dossier_id: true },
        })
      : [];
    const counts = new Map<number, number>();
    for (const item of items) {
      counts.set(item.dossier_id, (counts.get(item.dossier_id) ?? 0) + 1);
    }
    return {
      data: data.map((d: { id: number }) => ({
        ...d,
        items_count: counts.get(d.id) ?? 0,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * Adds an uploaded file. A previous ACTIVE item for the same
   * `requirement_key` (or `field_key`) becomes `superseded` and the new item
   * points at it through `supersedes_id`. Runs in the caller's transaction or
   * opens its own; the dossier row is touched first so concurrent uploads for
   * one dossier serialize.
   */
  async addFileItem(tx: any | undefined, input: AddFileItemInput) {
    if (!tx) {
      return this.prisma.$transaction((inner: any) => this.addFileItem(inner, input));
    }
    const c = this.ctx();
    const touched = await tx.dossiers.updateMany({
      where: { id: input.dossier_id, store_id: c.store_id },
      data: { updated_at: new Date() },
    });
    const file = await tx.stored_files.findFirst({
      where: { id: input.file_id, store_id: c.store_id, deleted_at: null },
      select: { id: true },
    });
    if (touched.count === 0 || !file) {
      throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    }
    const sameTarget = input.requirement_key
      ? { requirement_key: input.requirement_key }
      : { field_key: input.field_key };
    const previous: Array<{ id: number }> = await tx.dossier_items.findMany({
      where: {
        dossier_id: input.dossier_id,
        store_id: c.store_id,
        kind: 'uploaded_file',
        status: { in: ACTIVE },
        ...sameTarget,
      },
      orderBy: { id: 'desc' },
    });
    if (previous.length > 0) {
      await tx.dossier_items.updateMany({
        where: {
          id: { in: previous.map((p) => p.id) },
          store_id: c.store_id,
        },
        data: { status: 'superseded' },
      });
    }
    return tx.dossier_items.create({
      data: {
        store_id: c.store_id,
        dossier_id: input.dossier_id,
        kind: 'uploaded_file',
        requirement_key: input.requirement_key ?? null,
        stage_key: input.stage_key,
        field_key: input.field_key ?? null,
        file_id: input.file_id,
        status: 'received',
        supersedes_id: previous[0]?.id ?? null,
        added_by_type: input.actor.type,
        added_by_id: input.actor.id,
      },
    });
  }

  /**
   * P4.1/P4.2: files an issued (or sealed) document in the dossier. A previous
   * active item of the same kind for the same issued-document chain key
   * (`requirement_key`, or the document title when there is none) becomes
   * `superseded`. Runs in the caller's transaction.
   */
  async addDocumentItem(tx: any, input: AddDocumentItemInput) {
    const c = this.ctx();
    const touched = await tx.dossiers.updateMany({
      where: { id: input.dossier_id, store_id: c.store_id },
      data: { updated_at: new Date() },
    });
    if (touched.count === 0) throw new VendixHttpException(ErrorCodes.DOCUMENT_NOT_FOUND);
    const previous: Array<{ id: number }> = input.requirement_key
      ? await tx.dossier_items.findMany({
          where: {
            dossier_id: input.dossier_id,
            store_id: c.store_id,
            kind: input.kind,
            requirement_key: input.requirement_key,
            status: { in: ACTIVE },
          },
          orderBy: { id: 'desc' },
          select: { id: true },
        })
      : [];
    if (previous.length > 0) {
      await tx.dossier_items.updateMany({
        where: { id: { in: previous.map((p) => p.id) }, store_id: c.store_id },
        data: { status: 'superseded' },
      });
    }
    return tx.dossier_items.create({
      data: {
        store_id: c.store_id,
        dossier_id: input.dossier_id,
        kind: input.kind,
        requirement_key: input.requirement_key ?? null,
        stage_key: input.stage_key ?? null,
        file_id: input.file_id,
        issued_document_id: input.issued_document_id,
        status: 'received',
        supersedes_id: previous[0]?.id ?? null,
        added_by_type: input.actor.type,
        added_by_id: input.actor.id,
      },
    });
  }

  /** Active item of the dossier for a requirement (`upload` evaluation). */
  async hasActiveItem(dossierId: number, requirementKey: string, tx?: any) {
    const c = this.ctx();
    const found = await (tx ?? this.prisma).dossier_items.findFirst({
      where: {
        dossier_id: dossierId,
        store_id: c.store_id,
        requirement_key: requirementKey,
        kind: 'uploaded_file',
        status: { in: ACTIVE },
      },
      select: { id: true },
    });
    return !!found;
  }

  /**
   * P4.1/P4.2: status of the current issued document of an instance for an
   * `issued_document` requirement (the newest one that is not superseded or
   * voided), or null when none was issued.
   */
  async currentIssuedStatus(
    instanceId: number,
    requirementKey: string,
    tx?: any,
  ): Promise<string | null> {
    const c = this.ctx();
    const doc: { status: string } | null = await (tx ?? this.prisma).issued_documents.findFirst({
      where: {
        store_id: c.store_id,
        workflow_instance_id: instanceId,
        requirement_key: requirementKey,
        status: { notIn: ['superseded', 'voided'] },
      },
      orderBy: { id: 'desc' },
      select: { status: true },
    });
    return doc?.status ?? null;
  }

  /** File ids (of the given list) that are NOT part of the dossier or not usable. */
  async missingFileIds(dossierId: number, fileIds: number[], tx?: any) {
    const c = this.ctx();
    if (fileIds.length === 0) return [];
    const db = tx ?? this.prisma;
    const items: Array<{ file_id: number }> = await db.dossier_items.findMany({
      where: {
        dossier_id: dossierId,
        store_id: c.store_id,
        kind: 'uploaded_file',
        status: { in: [...ACTIVE, 'superseded'] },
        file_id: { in: fileIds },
      },
      select: { file_id: true },
    });
    const files: Array<{ id: number }> = await db.stored_files.findMany({
      where: { id: { in: fileIds }, store_id: c.store_id, deleted_at: null },
      select: { id: true },
    });
    const inDossier = new Set(items.map((i) => i.file_id));
    const exists = new Set(files.map((f) => f.id));
    return fileIds.filter((id) => !inDossier.has(id) || !exists.has(id));
  }

  /** Instance id owning the file's dossier items (download participant rule). */
  async instanceIdsOfFile(fileId: number): Promise<number[]> {
    const c = this.ctx();
    const items: Array<{ dossier_id: number }> = await this.prisma.dossier_items.findMany({
      where: { file_id: fileId, store_id: c.store_id },
      select: { dossier_id: true },
    });
    if (items.length === 0) return [];
    const dossiers: Array<{ workflow_instance_id: number | null }> =
      await this.prisma.dossiers.findMany({
        where: {
          id: { in: [...new Set(items.map((i) => i.dossier_id))] },
          store_id: c.store_id,
        },
        select: { workflow_instance_id: true },
      });
    return dossiers
      .map((d) => d.workflow_instance_id)
      .filter((v): v is number => v !== null);
  }
}
