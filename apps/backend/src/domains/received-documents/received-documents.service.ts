import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, tax_type_enum } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { tryResolveTenantFiscalIdentity } from '../../common/helpers/fiscal-identity.helper';
import { normalizeNit } from '../../common/utils/nit.util';
import {
  NormalizedReceivedDocument,
  ReceivedDocumentItem,
  ReceivedDocumentTax,
} from './interfaces/received-document.interface';
import {
  ManualReceivedDocumentDto,
  ReceivedDocumentItemDto,
  ReceivedDocumentQueryDto,
  ReceivedDocumentTaxDto,
  UpdateReceivedDocumentReviewDto,
} from './dto/received-document.dto';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { ReceivedDocumentParserService } from './services/received-document-parser.service';
import { ReceivedDocumentStorageService } from './services/received-document-storage.service';

export interface ReceivedDocumentsContext {
  organization_id: number;
  accounting_entity_id: number;
  store_id: number | null;
  actor_id?: number;
  is_organization: boolean;
}

interface Scope {
  context: ReceivedDocumentsContext;
  entity_store_id: number | null;
  entity_tax_id: string | null;
  store_filter?: number;
}

interface ImportResult {
  document: any;
  created: boolean;
}

const MAX_XML_BYTES = 10 * 1024 * 1024;
const MONEY_TOLERANCE = new Prisma.Decimal('0.01');
const MONEY_MAX = new Prisma.Decimal('10000000000000');
const ITEM_MAX = 500;
const HEADER_TAX_MAX = 100;
const ITEM_TAX_MAX = 20;
const EVENT_IMPORTED = 'IMPORTED';

@Injectable()
export class ReceivedDocumentsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly parser: ReceivedDocumentParserService,
    private readonly storage: ReceivedDocumentStorageService,
  ) {}

  /** Reuse the core tenant/fiscal/store ownership guard for adjacent reception settings. */
  async assertContext(ctx: ReceivedDocumentsContext): Promise<void> {
    await this.resolveScope(ctx);
  }

  async list(ctx: ReceivedDocumentsContext, query: ReceivedDocumentQueryDto) {
    const scope = await this.resolveScope(ctx, query.store_id);
    const where: Prisma.received_documentsWhereInput = {
      organization_id: ctx.organization_id,
      accounting_entity_id: ctx.accounting_entity_id,
      ...(scope.store_filter != null ? { store_id: scope.store_filter } : {}),
      ...(query.processing_status ? { processing_status: query.processing_status } : {}),
      ...(query.validation_status ? { validation_status: query.validation_status } : {}),
      ...(query.review_status ? { review_status: query.review_status } : {}),
      ...(query.fiscal_status ? { fiscal_status: query.fiscal_status } : {}),
      ...(query.source_channel ? { source_channel: query.source_channel } : {}),
      ...(query.search
        ? {
            OR: [
              { invoice_number: { contains: query.search, mode: 'insensitive' } },
              { issuer_name: { contains: query.search, mode: 'insensitive' } },
              { issuer_tax_id: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const [data, total] = await Promise.all([
      this.prisma.received_documents.findMany({
        where,
        orderBy: [{ issue_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: this.listSelect(),
      }),
      this.prisma.received_documents.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(ctx: ReceivedDocumentsContext, id: number) {
    this.assertPositiveInteger(id, 'document_id');
    const scope = await this.resolveScope(ctx);
    const document = await this.prisma.received_documents.findFirst({
      where: this.documentWhere(scope, id),
      include: {
        files: {
          select: { id: true, file_name: true, mime_type: true, file_size: true, sha256: true, role: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
        items: {
          include: { taxes: true },
          orderBy: { line_number: 'asc' },
        },
        taxes: { where: { item_id: null } },
        links: true,
        events: {
          select: { id: true, event_type: true, idempotency_key: true, status: true, result: true, actor_id: true, created_at: true },
          orderBy: { created_at: 'asc' },
        },
      },
    });
    if (!document) throw new NotFoundException('Documento recibido no encontrado.');
    return document;
  }

  async importXml(
    ctx: ReceivedDocumentsContext,
    file: Express.Multer.File,
    source = 'manual',
  ) {
    const result = await this.importXmlWithOutcome(ctx, file, source);
    return result.document;
  }

  async importXmlWithOutcome(
    ctx: ReceivedDocumentsContext,
    file: Express.Multer.File,
    source = 'manual',
  ): Promise<ImportResult> {
    const scope = await this.resolveScope(ctx);
    this.assertXmlFile(file);
    this.assertSourceChannel(source);
    const normalized = await this.validateReceiverIdentity(
      this.parser.parse(file.buffer.toString('utf8')),
      await this.expectedReceiverTaxId(scope),
    );
    const sha256 = this.sha256(file.buffer);
    const idempotencyKey = this.idempotencyKey(normalized, sha256);
    const rawPayload = {
      source_format: 'ubl_xml',
      normalized,
    };
    const recorded = await this.recordNormalized({
      scope,
      normalized,
      source,
      idempotencyKey,
      sourceHash: sha256,
      rawPayload,
      metadata: { source_format: 'ubl_xml' },
      processingStatus: 'processing',
    });
    await this.persistOriginalFile(scope, recorded.document.id, file, sha256);
    return { document: await this.findOne(ctx, recorded.document.id), created: recorded.created };
  }

  async createManual(ctx: ReceivedDocumentsContext, dto: ManualReceivedDocumentDto) {
    const scope = await this.resolveScope(ctx);
    const normalized = await this.validateReceiverIdentity(
      this.normalizeManual(dto),
      await this.expectedReceiverTaxId(scope),
    );
    const idempotencyKey = this.idempotencyKey(normalized);
    const result = await this.recordNormalized({
      scope,
      normalized,
      source: 'manual',
      idempotencyKey,
      rawPayload: { source_format: 'manual_entry', normalized },
      metadata: { source_format: 'manual_entry', ...(dto.reviewer_note ? { reviewer_note: dto.reviewer_note } : {}) },
      processingStatus: 'ready',
    });
    return this.findOne(ctx, result.document.id);
  }

  async updateReview(
    ctx: ReceivedDocumentsContext,
    id: number,
    dto: UpdateReceivedDocumentReviewDto,
  ) {
    this.assertPositiveInteger(id, 'document_id');
    this.assertPositiveInteger(dto.expected_version, 'expected_version');
    const scope = await this.resolveScope(ctx);
    const existing = await this.prisma.received_documents.findFirst({
      where: this.documentWhere(scope, id),
      include: {
        files: { select: { id: true, file_name: true, sha256: true, role: true } },
      },
    });
    if (!existing) throw new NotFoundException('Documento recibido no encontrado.');
    this.assertEditable(existing);

    const metadata = this.asObject(existing.metadata);
    const sourceFormat = this.sourceFormat(existing);
    const manualFormat = sourceFormat === 'manual_entry';
    const extractedFileFormat = sourceFormat === 'pending_file' &&
      existing.processing_status === 'ready' &&
      !!metadata.extraction_snapshot;
    if (dto.facts && !manualFormat && !extractedFileFormat) {
      throw new ConflictException('Los datos fiscales originales de este documento no pueden editarse; agregue una nota de revisión.');
    }
    const normalized = dto.facts
      ? await this.validateReceiverIdentity(
          manualFormat
            ? this.normalizeManual(dto.facts)
            : this.normalizeExtractionFacts(dto.facts),
          await this.expectedReceiverTaxId(scope),
        )
      : undefined;
    const validation = normalized?.validation;
    const nextMetadata = {
      ...metadata,
      ...(dto.reviewer_note ? { reviewer_note: dto.reviewer_note } : {}),
      ...(normalized ? { reviewed_snapshot: normalized } : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      if (normalized) {
        const storePredicate = scope.store_filter == null
          ? Prisma.empty
          : Prisma.sql`AND "store_id" = ${scope.store_filter}`;
        const locked = await tx.$queryRaw(Prisma.sql`
          SELECT "id"
          FROM "received_documents"
          WHERE "id" = ${id}
            AND "organization_id" = ${scope.context.organization_id}
            AND "accounting_entity_id" = ${scope.context.accounting_entity_id}
            ${storePredicate}
          FOR UPDATE
        `) as Array<{ id: number }>;
        if (locked.length !== 1) {
          throw new ConflictException('El documento cambió o ya no admite edición; vuelva a cargarlo.');
        }

        const allocation = await tx.received_document_match_allocations.findFirst({
          where: { document_id: id },
          select: { id: true },
        });
        const taxAllocation = await tx.received_document_match_tax_allocations.findFirst({
          where: { document_tax: { is: { document_id: id } } },
          select: { id: true },
        });
        if (allocation || taxAllocation) {
          throw new ConflictException(
            'No se pueden editar los hechos fiscales porque existe historial de asignaciones de conciliación; sólo se permite actualizar la nota de revisión.',
          );
        }
      }

      const update = await tx.received_documents.updateMany({
        where: {
          ...this.documentWhere(scope, id),
          version: dto.expected_version,
          accepted_at: null,
          fiscal_status: { notIn: ['recognized', 'accepted', 'posted'] },
          posting_status: { notIn: ['recognized', 'accepted', 'posted'] },
        },
        data: {
          ...(normalized ? this.documentColumns(normalized) : {}),
          version: { increment: 1 },
          review_status: 'reviewed',
          reviewed_by: ctx.actor_id ?? null,
          reviewed_at: new Date(),
          validation_status: validation
            ? this.validationStatus(validation)
            : existing.validation_status,
          validation_summary: validation
            ? this.json(validation)
            : existing.validation_summary,
          metadata: this.json(nextMetadata),
        },
      });
      if (update.count !== 1) {
        throw new ConflictException('El documento cambió o ya no admite edición; vuelva a cargarlo.');
      }
      if (normalized) {
        await tx.received_document_items.deleteMany({ where: { document_id: id } });
        await tx.received_document_taxes.deleteMany({ where: { document_id: id } });
        await this.createChildren(tx, id, normalized);
      }
      await tx.received_document_events.create({
        data: {
          document_id: id,
          event_type: 'UPDATED',
          idempotency_key: `review:${dto.expected_version + 1}`,
          status: 'completed',
          actor_id: ctx.actor_id ?? null,
          result: this.json({
            version: dto.expected_version + 1,
            facts_updated: !!normalized,
            reviewer_note: dto.reviewer_note ?? null,
            source_format: sourceFormat ?? null,
            source_hash: existing.source_hash ?? null,
            original_evidence: (existing.files ?? []).map((file: any) => ({
              id: file.id,
              file_name: file.file_name,
              sha256: file.sha256,
              role: file.role,
            })),
            extraction_snapshot_preserved: extractedFileFormat,
          }),
        },
      });
    });
    return this.findOne(ctx, id);
  }

  async getFile(ctx: ReceivedDocumentsContext, id: number, fileId: number): Promise<Buffer> {
    this.assertPositiveInteger(id, 'document_id');
    this.assertPositiveInteger(fileId, 'file_id');
    const scope = await this.resolveScope(ctx);
    const document = await this.prisma.received_documents.findFirst({
      where: this.documentWhere(scope, id),
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Documento recibido no encontrado.');
    const file = await this.prisma.received_document_files.findFirst({
      where: { document_id: document.id, id: fileId },
      select: { file_key: true },
    });
    if (!file) throw new NotFoundException('Archivo del documento recibido no encontrado.');
    return this.storage.download(this.storageContext(scope), id, file.file_key);
  }

  async createPendingFile(
    ctx: ReceivedDocumentsContext,
    file: Express.Multer.File,
    source = 'manual',
  ) {
    const result = await this.createPendingFileWithOutcome(ctx, file, source);
    return result.document;
  }

  async createPendingFileWithOutcome(
    ctx: ReceivedDocumentsContext,
    file: Express.Multer.File,
    source = 'manual',
  ): Promise<ImportResult> {
    const scope = await this.resolveScope(ctx);
    this.assertUploadFile(file);
    this.assertSourceChannel(source);
    const sha256 = this.sha256(file.buffer);
    const idempotencyKey = `file:${sha256}`;
    const recorded = await this.recordPendingFile(scope, source, idempotencyKey, sha256, file);
    await this.persistOriginalFile(scope, recorded.document.id, file, sha256);
    return { document: await this.findOne(ctx, recorded.document.id), created: recorded.created };
  }

  /** Pure shared normalization seam for OCR facts; invalid data is returned blocked, never thrown. */
  normalizeExtractionFacts(facts: ManualReceivedDocumentDto): NormalizedReceivedDocument {
    return this.withPendingWarnings(this.normalizeManual(facts, false));
  }

  /** Internal worker seam: callers must construct the authenticated tenant scope. */
  async replaceFromExtraction(
    ctx: ReceivedDocumentsContext,
    id: number,
    normalized: NormalizedReceivedDocument,
  ) {
    this.assertPositiveInteger(id, 'document_id');
    const scope = await this.resolveScope(ctx);
    const existing = await this.prisma.received_documents.findFirst({
      where: this.documentWhere(scope, id),
    });
    if (!existing) throw new NotFoundException('Documento recibido no encontrado.');
    if (this.sourceFormat(existing) !== 'pending_file') {
      throw new ConflictException('La extracción solo puede reemplazar un documento pendiente de OCR.');
    }
    if (existing.validation_status !== 'pending' || existing.processing_status === 'ready') {
      throw new ConflictException('La extracción de este documento ya fue persistida.');
    }
    const extracted = await this.validateReceiverIdentity(
      this.withPendingWarnings(normalized),
      await this.expectedReceiverTaxId(scope),
    );
    const validation = extracted.validation;
    const extractedKey = extracted.document_key?.trim().toLowerCase();
    if (extractedKey && /^[a-f\d]{96}$/.test(extractedKey)) {
      return this.reconcileExtractedIdentity(scope, existing, extracted, `key:${extractedKey}`);
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.received_documents.updateMany({
        where: {
          ...this.documentWhere(scope, id),
          version: existing.version,
          processing_status: { in: ['pending_ocr', 'processing', 'error'] },
        },
      data: {
        ...this.documentColumns(extracted),
          processing_status: 'ready',
          validation_status: this.validationStatus(validation),
          validation_summary: this.json(validation),
          version: { increment: 1 },
          metadata: this.json({
            ...this.asObject(existing.metadata),
            extraction_snapshot: extracted,
          }),
        },
      });
      if (updated.count !== 1) throw new ConflictException('El documento cambió durante la extracción.');
      await tx.received_document_items.deleteMany({ where: { document_id: id } });
      await tx.received_document_taxes.deleteMany({ where: { document_id: id } });
      const skippedLines = await this.createChildren(tx, id, extracted);
      if (skippedLines.length > 0) {
        await tx.received_documents.updateMany({
          where: this.documentWhere(scope, id),
          data: { metadata: this.json({
            ...this.asObject(existing.metadata),
            extraction_snapshot: extracted,
            skipped_invalid_line_numbers: skippedLines,
          }) },
        });
      }
      await tx.received_document_events.create({
        data: {
          document_id: id,
          event_type: 'EXTRACTED',
          idempotency_key: `extracted:${existing.version + 1}`,
          status: 'completed',
          actor_id: ctx.actor_id ?? null,
          result: this.json({ validation_status: this.validationStatus(validation) }),
        },
      });
    });
    return this.findOne(ctx, id);
  }

  private async reconcileExtractedIdentity(
    scope: Scope,
    pending: any,
    normalized: NormalizedReceivedDocument,
    canonicalKey: string,
  ) {
    const ctx = scope.context;
    try {
      const canonicalId = await this.prisma.$transaction(async (tx) => {
        const lockKey = `${ctx.accounting_entity_id}:${canonicalKey}`;
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        `);
        const canonical = await tx.received_documents.findFirst({
          where: {
            organization_id: ctx.organization_id,
            accounting_entity_id: ctx.accounting_entity_id,
            idempotency_key: canonicalKey,
          },
        });

        if (!canonical) {
          const changed = await tx.received_documents.updateMany({
            where: {
              ...this.documentWhere(scope, pending.id),
              version: pending.version,
              validation_status: 'pending',
              processing_status: { in: ['pending_ocr', 'processing', 'error'] },
            },
            data: {
              idempotency_key: canonicalKey,
              ...this.documentColumns(normalized),
              processing_status: 'ready',
              validation_status: this.validationStatus(normalized.validation),
              validation_summary: this.json(normalized.validation),
              version: { increment: 1 },
              metadata: this.json({
                ...this.asObject(pending.metadata),
                extraction_snapshot: normalized,
              }),
            },
          });
          if (changed.count !== 1) throw new ConflictException('El documento cambió durante la extracción.');
          await tx.received_document_items.deleteMany({ where: { document_id: pending.id } });
          await tx.received_document_taxes.deleteMany({ where: { document_id: pending.id } });
          const skippedLines = await this.createChildren(tx, pending.id, normalized);
          if (skippedLines.length > 0) {
            await tx.received_documents.updateMany({
              where: this.documentWhere(scope, pending.id),
              data: { metadata: this.json({
                ...this.asObject(pending.metadata),
                extraction_snapshot: normalized,
                skipped_invalid_line_numbers: skippedLines,
              }) },
            });
          }
          await tx.received_document_events.create({
            data: {
              document_id: pending.id,
              event_type: 'EXTRACTED',
              idempotency_key: `extracted:${pending.version + 1}`,
              status: 'completed',
              actor_id: ctx.actor_id ?? null,
              result: this.json({ validation_status: this.validationStatus(normalized.validation), canonicalized_key: true }),
            },
          });
          return pending.id;
        }

        this.assertSameNormalizedFacts(canonical, normalized);
        const originals = await tx.received_document_files.findMany({
          where: { document_id: pending.id },
          orderBy: { created_at: 'asc' },
        });
        for (const original of originals) {
          const prior = await tx.received_document_files.findFirst({
            where: { document_id: canonical.id, sha256: original.sha256 },
            select: { id: true },
          });
          if (prior) continue;
          const bytes = await this.storage.download(this.storageContext(scope), pending.id, original.file_key);
          if (this.sha256(bytes) !== original.sha256.toLowerCase()) {
            throw new ServiceUnavailableException('La huella del archivo pendiente no coincide con la evidencia original.');
          }
          const stored = await this.storage.upload(this.storageContext(scope), canonical.id, {
            buffer: bytes,
            originalname: original.file_name,
            mimetype: original.mime_type,
            size: bytes.length,
          });
          if (stored.sha256.toLowerCase() !== original.sha256.toLowerCase()) {
            throw new ServiceUnavailableException('La copia de evidencia no conservó la huella original.');
          }
          await tx.received_document_files.create({
            data: {
              document_id: canonical.id,
              file_key: stored.file_key,
              file_name: stored.file_name,
              mime_type: stored.mime_type,
              file_size: stored.file_size,
              sha256: stored.sha256.toLowerCase(),
              role: original.role,
            },
          });
          await tx.received_document_events.upsert({
            where: {
              document_id_idempotency_key: {
                document_id: canonical.id,
                idempotency_key: `merged-file:${original.sha256.toLowerCase()}`,
              },
            },
            create: {
              document_id: canonical.id,
              event_type: 'ORIGINAL_FILE_ATTACHED',
              idempotency_key: `merged-file:${original.sha256.toLowerCase()}`,
              status: 'completed',
              actor_id: ctx.actor_id ?? null,
              result: this.json({ sha256: original.sha256, merged_from_document_id: pending.id }),
            },
            update: {},
          });
        }
        const updated = await tx.received_documents.updateMany({
          where: {
            ...this.documentWhere(scope, pending.id),
            version: pending.version,
            validation_status: 'pending',
          },
          data: {
            idempotency_key: `merged:${pending.id}`,
            processing_status: 'duplicate',
            validation_status: this.validationStatus(normalized.validation),
            validation_summary: this.json(normalized.validation),
            version: { increment: 1 },
            metadata: this.json({
              ...this.asObject(pending.metadata),
              extraction_snapshot: normalized,
              merged_into_document_id: canonical.id,
            }),
          },
        });
        if (updated.count !== 1) throw new ConflictException('El documento cambió durante la extracción.');
        await tx.received_document_events.create({
          data: {
            document_id: pending.id,
            event_type: 'MERGED_DUPLICATE',
            idempotency_key: `merged:${canonical.id}:${pending.version + 1}`,
            status: 'completed',
            actor_id: ctx.actor_id ?? null,
            result: this.json({ canonical_document_id: canonical.id, copied_originals: originals.length }),
          },
        });
        return canonical.id;
      });
      return this.findOne(ctx, canonicalId);
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.markStorageFailure(scope, pending.id);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('No se pudo completar la consolidación de evidencia; el documento quedó pendiente para reintento.');
    }
  }

  private async resolveScope(
    ctx: ReceivedDocumentsContext,
    requestedStoreId?: number,
  ): Promise<Scope> {
    if (!ctx || !Number.isInteger(ctx.organization_id) || ctx.organization_id < 1 ||
      !Number.isInteger(ctx.accounting_entity_id) || ctx.accounting_entity_id < 1) {
      throw new ForbiddenException('Se requiere un contexto válido de organización y entidad fiscal.');
    }
    if (ctx.store_id != null && (!Number.isInteger(ctx.store_id) || ctx.store_id < 1)) {
      throw new ForbiddenException('El contexto de tienda no es válido.');
    }
    if (ctx.actor_id != null && (!Number.isInteger(ctx.actor_id) || ctx.actor_id < 1)) {
      throw new ForbiddenException('El actor del contexto no es válido.');
    }
    if (requestedStoreId != null) this.assertPositiveInteger(requestedStoreId, 'store_id');

    const db = this.prisma.withoutScope();
    const entity = await db.accounting_entities.findFirst({
      where: { id: ctx.accounting_entity_id, organization_id: ctx.organization_id },
      select: { id: true, organization_id: true, store_id: true, tax_id: true, is_active: true },
    });
    if (!entity) throw new ForbiddenException('La entidad fiscal no pertenece a la organización indicada.');
    if (!entity.is_active) throw new ForbiddenException('La entidad fiscal está inactiva.');

    if (ctx.is_organization && ctx.store_id != null) {
      const anchorStore = await db.stores.findFirst({
        where: { id: ctx.store_id, organization_id: ctx.organization_id },
        select: { id: true, is_active: true },
      });
      if (!anchorStore?.is_active || (entity.store_id != null && entity.store_id !== ctx.store_id)) {
        throw new ForbiddenException('La tienda del contexto no corresponde a la organización o entidad fiscal.');
      }
    }

    let storeFilter: number | undefined;
    if (!ctx.is_organization) {
      if (ctx.store_id == null) throw new ForbiddenException('El contexto de tienda es obligatorio.');
      const store = await db.stores.findFirst({
        where: { id: ctx.store_id, organization_id: ctx.organization_id },
        select: { id: true, is_active: true },
      });
      if (!store?.is_active) throw new ForbiddenException('La tienda no está activa o no pertenece a la organización indicada.');
      if (entity.store_id != null && entity.store_id !== ctx.store_id) {
        throw new ForbiddenException('La entidad fiscal no corresponde a la tienda del contexto.');
      }
      if (requestedStoreId != null && requestedStoreId !== ctx.store_id) {
        throw new ForbiddenException('No puede consultar otra tienda.');
      }
      storeFilter = ctx.store_id;
    } else {
      if (ctx.store_id != null) {
        storeFilter = ctx.store_id;
        if (requestedStoreId != null && requestedStoreId !== ctx.store_id) {
          throw new ForbiddenException('La tienda consultada difiere de la tienda seleccionada en el contexto.');
        }
      } else if (requestedStoreId != null) {
        const store = await db.stores.findFirst({
          where: { id: requestedStoreId, organization_id: ctx.organization_id },
          select: { id: true, is_active: true },
        });
        if (!store?.is_active) throw new ForbiddenException('La tienda no está activa o no pertenece a la organización indicada.');
        if (entity.store_id != null && entity.store_id !== requestedStoreId) {
          throw new ForbiddenException('La entidad fiscal pertenece a otra tienda.');
        }
        storeFilter = requestedStoreId;
      } else if (entity.store_id != null) {
        storeFilter = entity.store_id;
      }
    }
    return {
      context: ctx,
      entity_store_id: entity.store_id,
      entity_tax_id: entity.tax_id,
      store_filter: storeFilter,
    };
  }

  private async recordNormalized(input: {
    scope: Scope;
    normalized: NormalizedReceivedDocument;
    source: string;
    idempotencyKey: string;
    sourceHash?: string;
    rawPayload: unknown;
    metadata: unknown;
    processingStatus: string;
  }): Promise<ImportResult> {
    const normalized = this.withPendingWarnings(input.normalized);
    const ctx = input.scope.context;
    const storeId = ctx.store_id ?? input.scope.entity_store_id;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockKey = `${ctx.accounting_entity_id}:${input.idempotencyKey}`;
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        `);
        const existingWhere = this.idempotencyWhere(input.scope, input.idempotencyKey);
        const existing = await tx.received_documents.findFirst({ where: existingWhere });
        if (existing) {
          this.assertSameNormalizedFacts(existing, normalized);
          return { document: existing, created: false };
        }

        const document = await tx.received_documents.create({
          data: {
            organization_id: ctx.organization_id,
            store_id: storeId ?? null,
            accounting_entity_id: ctx.accounting_entity_id,
            ...this.documentColumns(normalized),
            source_channel: input.source,
            idempotency_key: input.idempotencyKey,
            source_hash: input.sourceHash ?? null,
            processing_status: input.processingStatus,
            validation_status: this.validationStatus(normalized.validation),
            review_status: 'pending',
            matching_status: 'unlinked',
            fiscal_status: 'pending',
            posting_status: 'pending',
            raw_payload: this.json(input.rawPayload),
            validation_summary: this.json(normalized.validation),
            metadata: this.json(input.metadata),
            version: 1,
            created_by: ctx.actor_id ?? null,
          },
        });
        const skippedLines = await this.createChildren(tx, document.id, normalized);
        if (skippedLines.length > 0) {
          await tx.received_documents.updateMany({
            where: this.documentWhere(input.scope, document.id),
            data: { metadata: this.json({
              ...this.asObject(input.metadata),
              skipped_invalid_line_numbers: skippedLines,
            }) },
          });
        }
        await tx.received_document_events.create({
          data: {
            document_id: document.id,
            event_type: EVENT_IMPORTED,
            idempotency_key: `${input.idempotencyKey}:created`,
            status: 'completed',
            actor_id: ctx.actor_id ?? null,
            result: this.json({
              source_channel: input.source,
              source_hash: input.sourceHash ?? null,
              validation_status: this.validationStatus(normalized.validation),
            }),
          },
        });
        return { document, created: true };
      });
    } catch (error) {
      if (this.isIdempotencyUniqueError(error)) {
        const winner = await this.prisma.received_documents.findFirst({ where: this.idempotencyWhere(input.scope, input.idempotencyKey) });
        if (winner) {
          this.assertSameNormalizedFacts(winner, normalized);
          return { document: winner, created: false };
        }
        throw new ConflictException('La clave de documento ya está registrada en esta entidad fiscal.');
      }
      throw error;
    }
  }

  private async recordPendingFile(
    scope: Scope,
    source: string,
    idempotencyKey: string,
    sha256: string,
    file: Express.Multer.File,
  ): Promise<ImportResult> {
    const ctx = scope.context;
    const storeId = ctx.store_id ?? scope.entity_store_id;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lockKey = `${ctx.accounting_entity_id}:${idempotencyKey}`;
        await tx.$executeRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtext(${lockKey}))
        `);
        let existing = await tx.received_documents.findFirst({ where: this.idempotencyWhere(scope, idempotencyKey) });
        if (!existing) {
          existing = await this.findExistingFileOwner(tx, scope, sha256);
        }
        if (existing) return { document: existing, created: false };
        const document = await tx.received_documents.create({
          data: {
            organization_id: ctx.organization_id,
            store_id: storeId ?? null,
            accounting_entity_id: ctx.accounting_entity_id,
            document_type: 'non_electronic',
            source_channel: source,
            idempotency_key: idempotencyKey,
            source_hash: sha256,
            currency: 'UNKNOWN',
            processing_status: 'processing',
            validation_status: 'pending',
            review_status: 'pending',
            matching_status: 'unlinked',
            fiscal_status: 'pending',
            posting_status: 'pending',
            raw_payload: this.json({
              source_format: 'pending_file',
              original_file_name: file.originalname ?? null,
              mime_type: file.mimetype ?? null,
              source_hash: sha256,
            }),
            metadata: this.json({ source_format: 'pending_file' }),
            version: 1,
            created_by: ctx.actor_id ?? null,
          },
        });
        await tx.received_document_events.create({
          data: {
            document_id: document.id,
            event_type: 'PENDING_FILE_RECEIVED',
            idempotency_key: `${idempotencyKey}:received`,
            status: 'completed',
            actor_id: ctx.actor_id ?? null,
            result: this.json({ source_channel: source, source_hash: sha256 }),
          },
        });
        return { document, created: true };
      });
    } catch (error) {
      if (this.isIdempotencyUniqueError(error)) {
        const winner = await this.prisma.received_documents.findFirst({ where: this.idempotencyWhere(scope, idempotencyKey) });
        if (winner) return { document: winner, created: false };
        throw new ConflictException('El archivo ya está registrado en esta entidad fiscal.');
      }
      throw error;
    }
  }

  private async persistOriginalFile(
    scope: Scope,
    documentId: number,
    file: Express.Multer.File,
    expectedSha256: string,
  ): Promise<void> {
    const where = this.documentWhere(scope, documentId);
    const existing = await this.prisma.received_documents.findFirst({
      where,
      select: { id: true, processing_status: true, metadata: true },
    });
    if (!existing) throw new NotFoundException('Documento recibido no encontrado.');
    const duplicate = await this.prisma.received_document_files.findFirst({
      where: { document_id: documentId, sha256: expectedSha256 },
      select: { id: true },
    });
    if (!duplicate) {
      try {
        const stored = await this.storage.upload(this.storageContext(scope), documentId, file);
        if (stored.sha256.toLowerCase() !== expectedSha256) {
          throw new ServiceUnavailableException('La huella del archivo almacenado no coincide con la original.');
        }
        try {
          await this.prisma.$transaction(async (tx) => {
            const owned = await tx.received_documents.findFirst({
              where: this.documentWhere(scope, documentId),
              select: { id: true },
            });
            if (!owned) throw new NotFoundException('Documento recibido no encontrado.');
            const prior = await tx.received_document_files.findFirst({
              where: { document_id: documentId, sha256: expectedSha256 },
              select: { id: true },
            });
            if (prior) return;
            await tx.received_document_files.create({
              data: {
                document_id: documentId,
                file_key: stored.file_key,
                file_name: stored.file_name,
                mime_type: stored.mime_type,
                file_size: stored.file_size,
                sha256: stored.sha256.toLowerCase(),
                role: 'original',
              },
            });
            await tx.received_document_events.create({
              data: {
                document_id: documentId,
                event_type: 'ORIGINAL_FILE_ATTACHED',
                idempotency_key: `file:${expectedSha256}`,
                status: 'completed',
                actor_id: scope.context.actor_id ?? null,
                result: this.json({ sha256: expectedSha256, mime_type: stored.mime_type, file_size: stored.file_size }),
              },
            });
          });
        } catch (error) {
          if (!this.isFileUniqueError(error)) throw error;
        }
      } catch {
        await this.markStorageFailure(
          scope,
          documentId,
          ['ready', 'duplicate'].includes(existing.processing_status),
        );
        throw new ServiceUnavailableException('No se pudo guardar el archivo original; el documento quedó pendiente para reintento.');
      }
    }
    const targetStatus = this.sourceFormat(existing) === 'pending_file' ? 'pending_ocr' : 'ready';
    if (['processing', 'error'].includes(existing.processing_status)) {
      await this.prisma.received_documents.updateMany({
        where: { ...where, processing_status: { in: ['processing', 'error'] } },
        data: { processing_status: targetStatus },
      });
    }
  }

  private async markStorageFailure(
    scope: Scope,
    documentId: number,
    preserveProcessingStatus = false,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        if (preserveProcessingStatus) {
          const owned = await tx.received_documents.findFirst({
            where: this.documentWhere(scope, documentId),
            select: { id: true },
          });
          if (!owned) throw new NotFoundException('Documento recibido no encontrado.');
        } else {
          const updated = await tx.received_documents.updateMany({
            where: this.documentWhere(scope, documentId),
            data: { processing_status: 'error' },
          });
          if (updated.count !== 1) throw new NotFoundException('Documento recibido no encontrado.');
        }
        await tx.received_document_events.upsert({
          where: {
            document_id_idempotency_key: {
              document_id: documentId,
              idempotency_key: 'original-storage-failed',
            },
          },
          create: {
            document_id: documentId,
            event_type: 'PROCESSING_FAILED',
            idempotency_key: 'original-storage-failed',
            status: 'retryable',
            actor_id: scope.context.actor_id ?? null,
            result: this.json({ reason: 'original_storage_unavailable' }),
          },
          update: { status: 'retryable' },
        });
      });
    } catch {
      // The original error remains a storage failure; do not expose database details.
    }
  }

  private async findExistingFileOwner(tx: any, scope: Scope, sha256: string): Promise<any | null> {
    const files = await tx.received_document_files.findMany({
      where: {
        sha256: sha256.toLowerCase(),
        document: {
          organization_id: scope.context.organization_id,
          accounting_entity_id: scope.context.accounting_entity_id,
          ...(scope.store_filter != null ? { store_id: scope.store_filter } : {}),
        },
      },
      select: { document_id: true },
      orderBy: { created_at: 'asc' },
    });
    for (const file of files) {
      const owner = await tx.received_documents.findFirst({
        where: this.documentWhere(scope, file.document_id),
      });
      if (!owner) continue;
      const mergedInto = this.asObject(owner.metadata).merged_into_document_id;
      if (Number.isInteger(mergedInto) && mergedInto > 0) {
        const canonical = await tx.received_documents.findFirst({
          where: this.documentWhere(scope, mergedInto),
        });
        if (canonical) return canonical;
      }
      return owner;
    }
    return null;
  }

  private assertSameNormalizedFacts(existing: any, normalized: NormalizedReceivedDocument): void {
    const payload = this.asObject(existing.raw_payload);
    const metadata = this.asObject(existing.metadata);
    const prior = (payload.normalized ?? metadata.extraction_snapshot) as NormalizedReceivedDocument | undefined;
    if (!prior || this.canonicalFacts(prior) !== this.canonicalFacts(normalized)) {
      throw new ConflictException('La misma clave de documento ya existe con datos fiscales diferentes.');
    }
  }

  private async createChildren(tx: any, documentId: number, normalized: NormalizedReceivedDocument): Promise<number[]> {
    const skippedLines: number[] = [];
    const headerTaxes = normalized.taxes.filter((tax) => tax.line_number == null && this.isPersistableTaxRow(tax));
    if (headerTaxes.length > 0) {
      await tx.received_document_taxes.createMany({
        data: headerTaxes.map((tax) => this.taxRow(documentId, null, tax)),
      });
    }
    for (const item of [...normalized.items].sort((a, b) => a.line_number - b.line_number)) {
      const quantity = this.decimal(item.quantity);
      if (!quantity.gt(0)) {
        skippedLines.push(item.line_number);
        continue;
      }
      const created = await tx.received_document_items.create({
        data: {
          document_id: documentId,
          line_number: item.line_number,
          external_code: item.external_code ?? null,
          description: item.description,
          quantity,
          unit_code: item.unit_code ?? null,
          unit_price: this.decimal(item.unit_price),
          discount_amount: this.decimal(item.discount_amount),
          net_amount: this.decimal(item.net_amount),
          total_amount: this.decimal(item.total_amount),
          product_id: null,
          product_variant_id: null,
        },
        select: { id: true },
      });
      const persistableItemTaxes = item.taxes.filter((tax) => this.isPersistableTaxRow(tax));
      if (persistableItemTaxes.length > 0) {
        await tx.received_document_taxes.createMany({
          data: persistableItemTaxes.map((tax) => this.taxRow(documentId, created.id, tax)),
        });
      }
    }
    return skippedLines;
  }

  /** Invalid/incomplete basis facts remain in immutable normalized/raw evidence, not fabricated money columns. */
  private isPersistableTaxRow(tax: ReceivedDocumentTax): boolean {
    if (!tax.base_amount || !tax.amount) return false;
    try {
      const base = new Prisma.Decimal(tax.base_amount);
      const amount = new Prisma.Decimal(tax.amount);
      const representable = (value: Prisma.Decimal) => value.isFinite() && !value.isNegative() && value.decimalPlaces() <= 2 && value.lt('10000000000000');
      return representable(base) && representable(amount);
    } catch {
      return false;
    }
  }

  private taxRow(documentId: number, itemId: number | null, tax: ReceivedDocumentTax) {
    const unclassified = tax.tax_type === 'unclassified';
    const taxBasisMetadata = {
      ...(tax.tax_basis_type ? { tax_basis_type: tax.tax_basis_type } : {}),
      ...(tax.base_quantity != null ? { base_quantity: tax.base_quantity } : {}),
      ...(tax.base_unit_code ? { base_unit_code: tax.base_unit_code } : {}),
      ...(tax.per_unit_amount != null ? { per_unit_amount: tax.per_unit_amount } : {}),
    };
    return {
      document_id: documentId,
      item_id: itemId,
      tax_type: unclassified ? null : tax.tax_type,
      scheme_code: tax.scheme_code && tax.scheme_code.length <= 30 ? tax.scheme_code : null,
      tax_name: tax.tax_name && tax.tax_name.length <= 100 ? tax.tax_name : 'Sin clasificar',
      rate: tax.rate ? this.decimal(tax.rate) : null,
      base_amount: this.decimal(tax.base_amount),
      amount: this.decimal(tax.amount),
      eligible_amount: new Prisma.Decimal(0),
      treatment: unclassified ? 'unclassified' : 'pending',
      ...(Object.keys(taxBasisMetadata).length > 0 ? { metadata: this.json(taxBasisMetadata) } : {}),
    };
  }

  private documentColumns(normalized: NormalizedReceivedDocument) {
    return {
      document_type: normalized.document_type,
      issuer_tax_id: this.columnString(normalized.issuer_tax_id, 50),
      issuer_name: this.columnString(normalized.issuer_name, 255),
      receiver_tax_id: this.columnString(normalized.receiver_tax_id, 50),
      receiver_name: this.columnString(normalized.receiver_name, 255),
      invoice_number: this.columnString(normalized.invoice_number, 100),
      document_key: this.columnString(normalized.document_key?.toLowerCase(), 128),
      original_reference_key: this.columnString(normalized.reference_key, 128),
      original_reference_number: this.columnString(normalized.reference_number, 100),
      issue_date: this.dateColumn(normalized.issue_date),
      due_date: this.dateColumn(normalized.due_date),
      currency: normalized.currency && normalized.currency.length <= 10 ? normalized.currency : 'UNKNOWN',
      subtotal_amount: this.decimal(normalized.subtotal_amount),
      discount_amount: this.decimal(normalized.discount_amount),
      tax_amount: this.decimal(normalized.tax_amount),
      total_amount: this.decimal(normalized.total_amount),
    };
  }

  private normalizeManual(
    dto: ManualReceivedDocumentDto,
    strict = true,
  ): NormalizedReceivedDocument {
    const input = (dto ?? {}) as Partial<ManualReceivedDocumentDto>;
    const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
    const errors: Array<{ code: string; message: string }> = [];
    const warnings: Array<{ code: string; message: string }> = [];
    const documentTypes: NormalizedReceivedDocument['document_type'][] = [
      'invoice', 'credit_note', 'debit_note', 'non_electronic',
    ];
    const documentType = documentTypes.includes(input.document_type as NormalizedReceivedDocument['document_type'])
      ? input.document_type as NormalizedReceivedDocument['document_type']
      : 'non_electronic';
    if (!documentTypes.includes(input.document_type as NormalizedReceivedDocument['document_type'])) {
      errors.push({ code: 'MISSING_OR_INVALID_DOCUMENT_TYPE', message: 'El tipo documental falta o no es válido.' });
    }
    const invoiceNumber = text(input.invoice_number);
    const issuerTaxId = text(input.issuer_tax_id);
    const issuerName = text(input.issuer_name);
    const receiverTaxId = text(input.receiver_tax_id);
    const receiverName = text(input.receiver_name);
    const rawCurrency = text(input.currency);
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'UNKNOWN';
    if (!invoiceNumber) errors.push({ code: 'MISSING_DOCUMENT_NUMBER', message: 'Falta el número del documento.' });
    if (!issuerTaxId) errors.push({ code: 'MISSING_ISSUER_TAX_ID', message: 'Falta el documento tributario del emisor.' });
    if (!issuerName) errors.push({ code: 'MISSING_ISSUER_NAME', message: 'Falta el nombre del emisor.' });
    if (!receiverTaxId) errors.push({ code: 'MISSING_RECEIVER_TAX_ID', message: 'Falta el documento tributario del adquirente.' });
    if (!receiverName) errors.push({ code: 'MISSING_RECEIVER_NAME', message: 'Falta el nombre del adquirente.' });
    if (!/^[A-Z]{3}$/.test(rawCurrency)) errors.push({ code: 'INVALID_CURRENCY', message: 'La moneda debe ser un código ISO de tres letras en mayúscula.' });
    const issueDateInput = text(input.issue_date);
    const dueDateInput = text(input.due_date);
    const allLineInputs = Array.isArray(input.items) ? input.items : [];
    const allTaxInputs = Array.isArray(input.taxes) ? input.taxes : [];
    if (allLineInputs.length > ITEM_MAX) {
      errors.push({ code: 'TOO_MANY_DOCUMENT_LINES', message: `El documento excede el máximo de ${ITEM_MAX} líneas; se conserva como revisión bloqueada.` });
    }
    if (allTaxInputs.length > HEADER_TAX_MAX) {
      errors.push({ code: 'TOO_MANY_HEADER_TAX_ROWS', message: `El documento excede el máximo de ${HEADER_TAX_MAX} impuestos de cabecera; se conserva como revisión bloqueada.` });
    }
    const lineInputs = allLineInputs.slice(0, ITEM_MAX);
    const taxInputs = allTaxInputs.slice(0, HEADER_TAX_MAX);
    if (lineInputs.length === 0) {
      errors.push({ code: 'MISSING_DOCUMENT_LINES', message: 'El documento requiere al menos una línea.' });
    }
    if (!issueDateInput || !this.isoDate(issueDateInput)) {
      errors.push({ code: 'MISSING_OR_INVALID_ISSUE_DATE', message: 'La fecha de emisión debe ser una fecha ISO válida.' });
    }
    if (dueDateInput && !this.isoDate(dueDateInput)) {
      errors.push({ code: 'INVALID_DUE_DATE', message: 'La fecha de vencimiento debe ser una fecha ISO válida.' });
    }
    const headerTaxes: ReceivedDocumentTax[] = taxInputs.map((tax) => this.manualTax(tax, undefined, errors));
    const items: ReceivedDocumentItem[] = lineInputs.map((item, index) => this.manualItem(item, index + 1, errors));
    const subtotal = this.manualMoney(text(input.subtotal_amount), 'SUBTOTAL', errors);
    const discount = this.manualMoney(text(input.discount_amount), 'DISCOUNT', errors);
    const charge = this.manualMoney(input.charge_amount == null ? '0' : text(input.charge_amount), 'CHARGE', errors);
    const exclusive = input.tax_exclusive_amount == null
      ? undefined
      : this.manualMoney(text(input.tax_exclusive_amount), 'TAX_EXCLUSIVE', errors);
    const taxAmount = this.manualMoney(text(input.tax_amount), 'TAX_AMOUNT', errors);
    const total = this.manualMoney(text(input.total_amount), 'TOTAL', errors);
    const prepaid = input.prepaid_amount == null ? undefined : this.manualMoney(text(input.prepaid_amount), 'PREPAID', errors);
    const rounding = input.payable_rounding_amount == null
      ? undefined
      : this.manualRounding(text(input.payable_rounding_amount), errors);
    const withholding = input.withholding_amount == null ? undefined : this.manualMoney(text(input.withholding_amount), 'WITHHOLDING', errors);
    const lineNet = items.reduce((sum, item) => sum.plus(item.net_amount), new Prisma.Decimal(0));
    if (this.differenceExceeds(subtotal, lineNet)) {
      errors.push({ code: 'LINE_SUBTOTAL_MISMATCH', message: 'El subtotal no coincide con la suma de las líneas.' });
    }
    const lineTaxes = items.flatMap((item) => item.taxes);
    const headerTaxSum = headerTaxes
      .filter((tax) => !this.isWithholding(tax.tax_type))
      .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    const lineTaxSum = lineTaxes
      .filter((tax) => !this.isWithholding(tax.tax_type))
      .reduce((sum, tax) => sum.plus(tax.amount), new Prisma.Decimal(0));
    const taxSum = headerTaxes.length > 0 ? headerTaxSum : lineTaxSum;
    if ((headerTaxes.length > 0 || lineTaxes.length > 0) && this.differenceExceeds(taxAmount, taxSum)) {
      errors.push({ code: 'DOCUMENT_TAX_TOTAL_MISMATCH', message: 'El impuesto declarado no coincide con el desglose tributario.' });
    }
    if (headerTaxes.length > 0 && lineTaxes.length > 0 && this.differenceExceeds(headerTaxSum, lineTaxSum)) {
      errors.push({ code: 'HEADER_LINE_TAX_MISMATCH', message: 'Los impuestos de cabecera y línea no coinciden.' });
    }
    const inclusive = input.tax_inclusive_amount == null
      ? subtotal.plus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN)
      : this.manualMoney(text(input.tax_inclusive_amount), 'TAX_INCLUSIVE', errors);
    if (this.differenceExceeds(inclusive, subtotal.plus(taxAmount))) {
      errors.push({ code: 'TAX_INCLUSIVE_AMOUNT_MISMATCH', message: 'El total con impuestos no coincide con subtotal más impuestos.' });
    }
    // PayableRoundingAmount adjusts the payable; prepaid and withholdings stay
    // informational under the DIAN profile and do not net the fiscal total.
    const payable = inclusive.minus(discount).plus(charge).plus(rounding ?? 0)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    if (this.differenceExceeds(total, payable)) {
      errors.push({ code: 'PAYABLE_TOTAL_MISMATCH', message: 'El total no coincide con total con impuestos menos descuento de cabecera más cargos y ajuste de redondeo.' });
    }
    for (const tax of [...headerTaxes, ...lineTaxes]) {
      if (tax.tax_type === 'unclassified') {
        errors.push({ code: 'UNCLASSIFIED_TAX_SCHEME', message: `El impuesto '${tax.scheme_code || tax.tax_name}' requiere clasificación fiscal.` });
      }
    }
    const allTaxes = [...headerTaxes, ...lineTaxes];
    if (allTaxes.length === 0) {
      warnings.push({ code: 'TAX_BREAKDOWN_MISSING', message: 'No hay desglose de impuestos; no se asumió IVA.' });
    }
    const documentKey = text(input.document_key) || undefined;
    const keyValid = !!documentKey && /^[a-f\d]{96}$/i.test(documentKey);
    if (!documentKey) warnings.push({ code: 'MISSING_DOCUMENT_KEY', message: 'No se informó UUID/clave electrónica; requiere revisión.' });
    else if (!keyValid) warnings.push({ code: 'INVALID_DOCUMENT_KEY_FORMAT', message: 'La clave no tiene el formato hexadecimal DIAN de 96 caracteres.' });

    const invalidManualFacts = errors.filter((issue) => issue.code !== 'UNCLASSIFIED_TAX_SCHEME');
    if (strict && invalidManualFacts.length > 0) {
      throw new BadRequestException({
        message: 'Los datos manuales tienen cantidades o valores inconsistentes.',
        validation_errors: invalidManualFacts.map((issue) => issue.code),
      });
    }

    return {
      document_type: documentType,
      invoice_number: invoiceNumber,
      issuer_tax_id: issuerTaxId,
      issuer_name: issuerName,
      receiver_tax_id: receiverTaxId,
      receiver_name: receiverName,
      document_key: documentKey,
      issue_date: this.isoDate(issueDateInput) ? issueDateInput : '',
      due_date: dueDateInput && this.isoDate(dueDateInput) ? dueDateInput : undefined,
      currency,
      subtotal_amount: this.moneyString(subtotal),
      discount_amount: this.moneyString(discount),
      charge_amount: input.charge_amount == null ? undefined : this.moneyString(charge),
      tax_exclusive_amount: exclusive == null ? undefined : this.moneyString(exclusive),
      tax_inclusive_amount: this.moneyString(inclusive),
      tax_amount: this.moneyString(taxAmount),
      total_amount: this.moneyString(total),
      prepaid_amount: prepaid == null ? undefined : this.moneyString(prepaid),
      payable_rounding_amount: rounding?.toFixed(2),
      withholding_amount: withholding == null ? undefined : this.moneyString(withholding),
      items,
      taxes: headerTaxes,
      reference_key: text(input.reference_key) || undefined,
      reference_number: text(input.reference_number) || undefined,
      validation: { errors, warnings, has_signature: false, document_key_format_valid: keyValid },
    };
  }

  private manualItem(
    input: ReceivedDocumentItemDto | undefined,
    lineNumber: number,
    errors: Array<{ code: string; message: string }>,
  ): ReceivedDocumentItem {
    const row = (input ?? {}) as Partial<ReceivedDocumentItemDto>;
    const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
    const quantity = this.manualDecimal(text(row.quantity), 11, 4, `LINE_${lineNumber}_QUANTITY`, errors);
    const unitPrice = this.manualDecimal(text(row.unit_price), 9, 6, `LINE_${lineNumber}_PRICE`, errors);
    const discount = this.manualMoney(text(row.discount_amount), `LINE_${lineNumber}_DISCOUNT`, errors);
    const net = this.manualMoney(text(row.net_amount), `LINE_${lineNumber}_NET`, errors);
    const total = this.manualMoney(text(row.total_amount), `LINE_${lineNumber}_TOTAL`, errors);
    if (quantity.lte(0)) errors.push({ code: 'INVALID_LINE_QUANTITY', message: `La cantidad de la línea ${lineNumber} debe ser mayor que cero.` });
    const description = text(row.description);
    if (!description) errors.push({ code: 'MISSING_LINE_DESCRIPTION', message: `Falta la descripción de la línea ${lineNumber}.` });
    const allTaxes = Array.isArray(row.taxes) ? row.taxes : [];
    if (allTaxes.length > ITEM_TAX_MAX &&
      !errors.some((issue) => issue.code === 'TOO_MANY_LINE_TAX_ROWS')) {
      errors.push({ code: 'TOO_MANY_LINE_TAX_ROWS', message: `La línea ${lineNumber} excede el máximo de ${ITEM_TAX_MAX} impuestos; se conserva como revisión bloqueada.` });
    }
    const taxes = allTaxes.slice(0, ITEM_TAX_MAX)
      .map((tax) => this.manualTax(tax, lineNumber, errors));
    const expected = quantity.mul(unitPrice).minus(discount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
    if (this.differenceExceeds(expected, net)) {
      errors.push({ code: 'LINE_AMOUNT_MISMATCH', message: `El neto de la línea ${lineNumber} no coincide con cantidad × precio menos descuento.` });
    }
    const tax = taxes.filter((row) => !this.isWithholding(row.tax_type))
      .reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    if (this.differenceExceeds(total, net.plus(tax))) {
      errors.push({ code: 'LINE_TOTAL_MISMATCH', message: `El total de la línea ${lineNumber} no coincide con neto más impuestos.` });
    }
    return {
      line_number: lineNumber,
      external_code: text(row.external_code) || undefined,
      description,
      quantity: quantity.toString(),
      unit_code: text(row.unit_code) || undefined,
      unit_price: unitPrice.toString(),
      discount_amount: this.moneyString(discount),
      net_amount: this.moneyString(net),
      total_amount: this.moneyString(total),
      taxes,
    };
  }

  private manualTax(
    input: ReceivedDocumentTaxDto | undefined,
    lineNumber: number | undefined,
    errors: Array<{ code: string; message: string }>,
  ): ReceivedDocumentTax {
    const row = (input ?? {}) as Partial<ReceivedDocumentTaxDto>;
    const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
    const errorsAtStart = errors.length;
    const amount = this.manualMoney(text(row.amount), 'TAX_AMOUNT', errors);
    const amountValid = errors.length === errorsAtStart;
    const rawTaxType = row.tax_type;
    const taxType = rawTaxType === 'unclassified' ||
      Object.values(tax_type_enum).includes(rawTaxType as tax_type_enum)
      ? rawTaxType as ReceivedDocumentTax['tax_type']
      : 'unclassified';
    const schemeCode = text(row.scheme_code);
    const taxBasis = row.tax_basis_type;
    const nominalFieldsSupplied = [row.base_quantity, row.per_unit_amount, row.base_unit_code]
      .some((value) => value != null && text(value) !== '');
    const supportedBasis = taxBasis == null || taxBasis === 'monetary' || taxBasis === 'unit';
    const isUnit = taxBasis === 'unit';
    if (!supportedBasis) {
      errors.push({ code: 'INVALID_TAX_BASIS', message: 'La base del impuesto debe ser monetaria o nominal por unidad.' });
    }
    if (taxBasis == null && nominalFieldsSupplied) {
      errors.push({ code: 'TAX_BASIS_REQUIRED', message: 'Los datos nominales requieren declarar tax_basis_type=unit.' });
    }
    if (taxBasis === 'monetary' && nominalFieldsSupplied) {
      errors.push({ code: 'CONTRADICTORY_TAX_BASIS', message: 'Un impuesto monetario no puede incluir magnitudes nominales por unidad.' });
    }

    let rate: Prisma.Decimal;
    let rateValid = true;
    if (isUnit && !text(row.rate)) {
      rate = new Prisma.Decimal(0);
    } else {
      const errorsBeforeRate = errors.length;
      rate = this.manualDecimal(text(row.rate), 4, 5, 'TAX_RATE', errors);
      rateValid = errors.length === errorsBeforeRate;
    }

    const baseQuantitySource = text(row.base_quantity);
    const perUnitSource = text(row.per_unit_amount);
    const baseUnitCode = text(row.base_unit_code);
    let baseQuantity: Prisma.Decimal | undefined;
    let perUnitAmount: Prisma.Decimal | undefined;
    let baseAmount: Prisma.Decimal | undefined;
    let baseAmountString = '';

    if (isUnit) {
      if (taxType !== 'ibua' || schemeCode !== '34') {
        errors.push({ code: 'UNSUPPORTED_UNIT_TAX', message: 'La base nominal por unidad solo se admite para IBUA con scheme_code 34.' });
      }
      if (!baseQuantitySource) {
        errors.push({ code: 'INCOMPLETE_UNIT_TAX_BASIS', message: 'El impuesto nominal requiere una cantidad base mayor que cero.' });
      } else {
        baseQuantity = this.manualDecimal(baseQuantitySource, 13, 2, 'TAX_BASE_QUANTITY', errors);
        if (!baseQuantity.gt(0)) errors.push({ code: 'INVALID_UNIT_TAX_QUANTITY', message: 'La cantidad base nominal debe ser mayor que cero.' });
      }
      if (!perUnitSource) {
        errors.push({ code: 'INCOMPLETE_UNIT_TAX_BASIS', message: 'El impuesto nominal requiere un valor por unidad.' });
      } else {
        perUnitAmount = this.manualDecimal(perUnitSource, 13, 2, 'TAX_PER_UNIT_AMOUNT', errors);
      }
      if (!baseUnitCode || baseUnitCode.length > 30) {
        errors.push({ code: 'INCOMPLETE_UNIT_TAX_BASIS', message: 'El impuesto nominal requiere un código de unidad válido.' });
      }
      if (!rate.isZero()) {
        errors.push({ code: 'UNIT_TAX_RATE_MUST_BE_ZERO', message: 'Un impuesto nominal por unidad debe tener tasa porcentual cero.' });
      }
      const suppliedBase = text(row.base_amount);
      if (suppliedBase) {
        const errorsBeforeBase = errors.length;
        baseAmount = this.manualMoney(suppliedBase, 'TAX_BASE', errors);
        if (errors.length === errorsBeforeBase) baseAmountString = this.moneyString(baseAmount);
      }
      const completeSupportedUnitTax = taxType === 'ibua' && schemeCode === '34' &&
        !!baseQuantity?.gt(0) && !!perUnitAmount && !!baseUnitCode && rate.isZero();
      if (completeSupportedUnitTax && baseQuantity && perUnitAmount) {
        const expected = baseQuantity.mul(perUnitAmount)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN)
          .div(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN);
        if (this.differenceExceeds(amount, expected)) {
          errors.push({ code: 'UNIT_TAX_AMOUNT_MISMATCH', message: 'El importe nominal no coincide con cantidad base × valor por unidad / 100.' });
        }
        if (!suppliedBase && errors.length === errorsAtStart && !this.differenceExceeds(amount, expected)) baseAmountString = '0.00';
      }
    } else if (supportedBasis) {
      const suppliedBase = text(row.base_amount);
      if (!suppliedBase) {
        errors.push({ code: 'MISSING_MONETARY_TAX_BASE', message: 'El impuesto monetario requiere una base monetaria explícita.' });
      } else {
        const errorsBeforeBase = errors.length;
        baseAmount = this.manualMoney(suppliedBase, 'TAX_BASE', errors);
        if (errors.length === errorsBeforeBase) baseAmountString = this.moneyString(baseAmount);
      }
    }

    return {
      tax_type: taxType,
      scheme_code: schemeCode,
      tax_name: text(row.tax_name) || 'Sin clasificar',
      rate: rateValid ? rate.toString() : '',
      base_amount: baseAmountString,
      amount: amountValid ? this.moneyString(amount) : '',
      tax_basis_type: taxBasis == null ? (supportedBasis ? (isUnit ? 'unit' : 'monetary') : undefined) : taxBasis as ReceivedDocumentTax['tax_basis_type'],
      ...(isUnit && baseQuantitySource ? { base_quantity: baseQuantitySource } : {}),
      ...(isUnit && baseUnitCode ? { base_unit_code: baseUnitCode } : {}),
      ...(isUnit && perUnitSource ? { per_unit_amount: perUnitSource } : {}),
      line_number: lineNumber,
    };
  }

  private listSelect() {
    return {
      id: true, store_id: true, document_type: true, source_channel: true,
      issuer_tax_id: true, issuer_name: true, invoice_number: true, document_key: true,
      issue_date: true, due_date: true, currency: true, subtotal_amount: true,
      discount_amount: true, tax_amount: true, total_amount: true,
      processing_status: true, validation_status: true, review_status: true,
      matching_status: true, fiscal_status: true, posting_status: true,
      version: true, created_at: true, updated_at: true,
    };
  }

  private documentWhere(scope: Scope, id: number): Prisma.received_documentsWhereInput {
    return {
      id,
      organization_id: scope.context.organization_id,
      accounting_entity_id: scope.context.accounting_entity_id,
      ...(scope.store_filter != null ? { store_id: scope.store_filter } : {}),
    };
  }

  private idempotencyWhere(scope: Scope, key: string): Prisma.received_documentsWhereInput {
    return {
      organization_id: scope.context.organization_id,
      accounting_entity_id: scope.context.accounting_entity_id,
      idempotency_key: key,
      ...(scope.store_filter != null ? { store_id: scope.store_filter } : {}),
    };
  }

  private storageContext(scope: Scope) {
    return {
      organization_id: scope.context.organization_id,
      store_id: scope.context.store_id ?? scope.entity_store_id,
      accounting_entity_id: scope.context.accounting_entity_id,
    };
  }

  private withPendingWarnings(source: NormalizedReceivedDocument): NormalizedReceivedDocument {
    const normalized = JSON.parse(JSON.stringify(source)) as NormalizedReceivedDocument;
    const errors = [...(normalized.validation?.errors ?? [])];
    const warnings = [...(normalized.validation?.warnings ?? [])];
    if (!normalized.document_key && !errors.some((issue) => issue.code === 'MISSING_DOCUMENT_KEY') && !warnings.some((issue) => issue.code === 'MISSING_DOCUMENT_KEY')) {
      warnings.push({ code: 'MISSING_DOCUMENT_KEY', message: 'No se informó UUID/clave electrónica; requiere revisión.' });
    }
    const hasTaxRows = normalized.taxes.length > 0 || normalized.items.some((item) => item.taxes.length > 0);
    if (!hasTaxRows && !warnings.some((issue) => issue.code === 'TAX_BREAKDOWN_MISSING')) {
      warnings.push({ code: 'TAX_BREAKDOWN_MISSING', message: 'No hay desglose tributario; no se asumió IVA.' });
    }
    if (!normalized.issue_date && !errors.some((issue) => issue.code === 'MISSING_OR_INVALID_ISSUE_DATE')) {
      errors.push({ code: 'MISSING_OR_INVALID_ISSUE_DATE', message: 'La fecha de emisión falta o no es válida.' });
    }
    const bounded = (value: string | undefined, max: number, field: string) => {
      if (value != null && value.length > max && !errors.some((issue) => issue.code === `COLUMN_OVERFLOW_${field}`)) {
        errors.push({ code: `COLUMN_OVERFLOW_${field}`, message: `${field} supera la longitud máxima admitida y requiere revisión.` });
      }
    };
    bounded(normalized.issuer_tax_id, 50, 'ISSUER_TAX_ID');
    bounded(normalized.issuer_name, 255, 'ISSUER_NAME');
    bounded(normalized.receiver_tax_id, 50, 'RECEIVER_TAX_ID');
    bounded(normalized.receiver_name, 255, 'RECEIVER_NAME');
    bounded(normalized.invoice_number, 100, 'DOCUMENT_NUMBER');
    bounded(normalized.document_key, 128, 'DOCUMENT_KEY');
    bounded(normalized.reference_key, 128, 'REFERENCE_KEY');
    bounded(normalized.reference_number, 100, 'REFERENCE_NUMBER');
    bounded(normalized.currency, 10, 'CURRENCY');
    for (const item of normalized.items) {
      bounded(item.external_code, 100, 'ITEM_EXTERNAL_CODE');
      bounded(item.unit_code, 30, 'ITEM_UNIT_CODE');
      for (const tax of item.taxes) {
        bounded(tax.scheme_code, 30, 'TAX_SCHEME_CODE');
        bounded(tax.tax_name, 100, 'TAX_NAME');
      }
    }
    for (const tax of normalized.taxes) {
      bounded(tax.scheme_code, 30, 'TAX_SCHEME_CODE');
      bounded(tax.tax_name, 100, 'TAX_NAME');
    }
    normalized.validation = {
      errors, warnings,
      has_signature: normalized.validation?.has_signature ?? false,
      document_key_format_valid: normalized.validation?.document_key_format_valid ?? false,
    };
    return normalized;
  }

  private async expectedReceiverTaxId(scope: Scope): Promise<string | undefined> {
    try {
      const db = this.prisma.withoutScope();
      const settingsRow = scope.entity_store_id == null
        ? await db.organization_settings.findFirst({
            where: { organization_id: scope.context.organization_id },
            select: { settings: true },
          })
        : await db.store_settings.findFirst({
            where: { store_id: scope.entity_store_id },
            select: { settings: true },
          });
      const fiscalData = this.asObject(this.asObject(settingsRow?.settings).fiscal_data);
      const { identity } = tryResolveTenantFiscalIdentity({
        nit: scope.entity_tax_id ?? '',
        fiscal_data: Object.keys(fiscalData).length > 0 ? fiscalData : null,
      });
      return identity.nit || undefined;
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo consultar la identidad fiscal del adquirente; reintente la recepción.',
      );
    }
  }

  private async validateReceiverIdentity(
    source: NormalizedReceivedDocument,
    expectedReceiverTaxId: string | undefined,
  ): Promise<NormalizedReceivedDocument> {
    const normalized = this.withPendingWarnings(source);
    const errors = [...normalized.validation.errors];
    const hasError = (code: string) => errors.some((issue) => issue.code === code);
    if (!expectedReceiverTaxId) {
      if (!hasError('RECEIVER_FISCAL_IDENTITY_UNCONFIGURED')) {
        errors.push({
          code: 'RECEIVER_FISCAL_IDENTITY_UNCONFIGURED',
          message: 'No se pudo resolver el NIT canónico del adquirente desde su configuración fiscal.',
        });
      }
    } else if (normalized.receiver_tax_id &&
      normalizeNit(normalized.receiver_tax_id).number !== expectedReceiverTaxId) {
      if (!hasError('RECEIVER_TAX_ID_MISMATCH')) {
        errors.push({
          code: 'RECEIVER_TAX_ID_MISMATCH',
          message: 'El NIT del adquirente del documento no coincide con el NIT de la entidad fiscal activa.',
        });
      }
    }
    return {
      ...normalized,
      validation: { ...normalized.validation, errors },
    };
  }

  private validationStatus(validation: NormalizedReceivedDocument['validation']): string {
    if (validation.errors.length > 0) return 'invalid';
    if (validation.warnings.length > 0) return 'needs_review';
    return 'valid';
  }

  private idempotencyKey(document: NormalizedReceivedDocument, fileSha256?: string): string {
    const key = document.document_key?.trim();
    if (key) return key.length <= 128 ? `key:${key.toLowerCase()}` : `key:${this.sha256(Buffer.from(key.toLowerCase(), 'utf8'))}`;
    if (document.issuer_tax_id && document.invoice_number && document.issue_date) {
      const identity = [document.issuer_tax_id.trim().toLowerCase(), document.document_type,
        document.invoice_number.trim().toLowerCase(), document.issue_date].join('|');
      return `doc:${this.sha256(Buffer.from(identity, 'utf8'))}`;
    }
    if (fileSha256) return `file:${fileSha256.toLowerCase()}`;
    return `manual:${randomUUID()}`;
  }

  private canonicalFacts(document: NormalizedReceivedDocument): string {
    const tax = (row: ReceivedDocumentTax) => ({
      line_number: row.line_number ?? null, tax_type: row.tax_type, scheme_code: row.scheme_code,
      tax_name: row.tax_name, rate: row.rate, base_amount: row.base_amount, amount: row.amount,
      // Missing basis is the legacy/manual monetary representation. Keep nominal
      // unit facts explicit so same-key documents cannot merge across tax bases.
      tax_basis_type: row.tax_basis_type ?? 'monetary',
      base_quantity: row.base_quantity ?? null,
      base_unit_code: row.base_unit_code ?? null,
      per_unit_amount: row.per_unit_amount ?? null,
    });
    return JSON.stringify({
      document_type: document.document_type,
      invoice_number: document.invoice_number,
      issuer_tax_id: document.issuer_tax_id,
      issuer_name: document.issuer_name,
      receiver_tax_id: document.receiver_tax_id,
      receiver_name: document.receiver_name,
      document_key: document.document_key?.toLowerCase() ?? null,
      issue_date: document.issue_date,
      due_date: document.due_date ?? null,
      currency: document.currency,
      subtotal_amount: document.subtotal_amount,
      discount_amount: document.discount_amount,
      charge_amount: document.charge_amount ?? '0.00',
      tax_exclusive_amount: document.tax_exclusive_amount ?? null,
      tax_inclusive_amount: document.tax_inclusive_amount ?? null,
      tax_amount: document.tax_amount,
      total_amount: document.total_amount,
      prepaid_amount: document.prepaid_amount ?? null,
      payable_rounding_amount: document.payable_rounding_amount ?? null,
      withholding_amount: document.withholding_amount ?? null,
      reference_key: document.reference_key ?? null,
      reference_number: document.reference_number ?? null,
      taxes: document.taxes.map(tax).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      items: [...document.items].sort((a, b) => a.line_number - b.line_number).map((item) => ({
        line_number: item.line_number, external_code: item.external_code ?? null,
        description: item.description, quantity: item.quantity, unit_code: item.unit_code ?? null,
        unit_price: item.unit_price, discount_amount: item.discount_amount,
        net_amount: item.net_amount, total_amount: item.total_amount,
        taxes: item.taxes.map(tax).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      })),
    });
  }

  private isIdempotencyUniqueError(error: any): boolean {
    if (error?.code !== 'P2002') return false;
    const target = JSON.stringify(error?.meta?.target ?? '');
    return target.includes('received_docs_entity_idempotency_key') ||
      (target.includes('accounting_entity_id') && target.includes('idempotency_key'));
  }

  private isFileUniqueError(error: any): boolean {
    if (error?.code !== 'P2002') return false;
    const target = JSON.stringify(error?.meta?.target ?? '');
    return target.includes('received_doc_files_document_sha256_key') ||
      (target.includes('document_id') && target.includes('sha256'));
  }

  private assertEditable(document: any): void {
    const terminal = ['recognized', 'accepted', 'posted'];
    if (document.accepted_at || terminal.includes(document.fiscal_status) || terminal.includes(document.posting_status)) {
      throw new ConflictException('El documento ya fue reconocido o contabilizado y no admite edición.');
    }
  }

  private sourceFormat(document: any): string | undefined {
    return this.asObject(document?.metadata).source_format ?? this.asObject(document?.raw_payload).source_format;
  }

  private asObject(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private decimal(value: string | number | Prisma.Decimal | null | undefined): Prisma.Decimal {
    if (value instanceof Prisma.Decimal) return value;
    return new Prisma.Decimal(value ?? 0);
  }

  private moneyString(value: Prisma.Decimal): string {
    return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_EVEN).toFixed(2);
  }

  private dateColumn(value: string | undefined): Date | null {
    return value && this.isoDate(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  }

  private columnString(value: string | undefined, maxLength: number): string | null {
    return value && value.length <= maxLength ? value : null;
  }

  private isoDate(value: string | undefined): boolean {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  private manualMoney(value: string, field: string, errors: Array<{ code: string; message: string }>): Prisma.Decimal {
    return this.manualDecimal(value, 13, 2, field, errors);
  }

  private manualRounding(value: string, errors: Array<{ code: string; message: string }>): Prisma.Decimal {
    const input = String(value ?? '').trim();
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) {
      errors.push({ code: 'INVALID_SOURCE_PAYABLE_ROUNDING', message: 'PayableRoundingAmount no es decimal válido.' });
      return new Prisma.Decimal(0);
    }
    const parsed = new Prisma.Decimal(input);
    const unsigned = input.replace(/^-/, '');
    const [integer, fraction = ''] = unsigned.split('.');
    if (integer.replace(/^0+/, '').length > 13 || fraction.length > 2) {
      errors.push({ code: 'DECIMAL_OVERFLOW_PAYABLE_ROUNDING', message: 'PayableRoundingAmount excede Decimal(15,2).' });
      return new Prisma.Decimal(0);
    }
    return parsed;
  }

  private manualDecimal(value: string, integerDigits: number, scale: number, field: string, errors: Array<{ code: string; message: string }>): Prisma.Decimal {
    const input = String(value ?? '').trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) {
      errors.push({ code: `INVALID_SOURCE_${field}`, message: `${field} no es un decimal válido.` });
      return new Prisma.Decimal(0);
    }
    const parsed = new Prisma.Decimal(input);
    const unsigned = input.replace(/^[+-]/, '');
    const [integer, fraction = ''] = unsigned.split('.');
    if (integer.replace(/^0+/, '').length > integerDigits || fraction.length > scale) {
      errors.push({ code: `DECIMAL_OVERFLOW_${field}`, message: `${field} excede la precisión decimal permitida.` });
      return new Prisma.Decimal(0);
    }
    if (parsed.isNegative()) {
      errors.push({ code: `NEGATIVE_SOURCE_${field}`, message: `${field} no puede ser negativo; use document_type para representar la polaridad.` });
      return new Prisma.Decimal(0);
    }
    return parsed;
  }

  private differenceExceeds(left: Prisma.Decimal, right: Prisma.Decimal): boolean {
    return left.minus(right).abs().gt(MONEY_TOLERANCE);
  }

  private isWithholding(type: ReceivedDocumentTax['tax_type']): boolean {
    return type === 'withholding' || type === 'reteiva' || type === 'reteica';
  }

  private sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private assertPositiveInteger(value: number, field: string): void {
    if (!Number.isInteger(value) || value < 1) throw new BadRequestException(`${field} debe ser un entero positivo.`);
  }

  private assertSourceChannel(source: string): void {
    if (!['manual', 'xml', 'email', 'api', 'automated'].includes(source)) {
      throw new BadRequestException('Canal de recepción no válido.');
    }
  }

  private assertXmlFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file?.buffer?.length) throw new BadRequestException('Se requiere un archivo XML.');
    if (file.buffer.length > MAX_XML_BYTES) throw new BadRequestException('El XML excede el límite de 10 MiB.');
    if (file.size !== file.buffer.length) throw new BadRequestException('El tamaño declarado del XML no coincide con el contenido.');
    const mime = (file.mimetype ?? '').toLowerCase();
    if (!['application/xml', 'text/xml', 'application/vnd.dian.ubl+xml', 'application/octet-stream'].includes(mime)) {
      throw new BadRequestException('El tipo de archivo no es XML.');
    }
    if (mime === 'application/octet-stream' && !file.originalname?.toLowerCase().endsWith('.xml')) {
      throw new BadRequestException('El archivo XML debe identificarse como .xml.');
    }
  }

  private assertUploadFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file?.buffer?.length) throw new BadRequestException('Se requiere un archivo.');
    if (file.buffer.length > MAX_XML_BYTES) throw new BadRequestException('El archivo excede el límite de 10 MiB.');
    if (file.size !== file.buffer.length) throw new BadRequestException('El tamaño declarado no coincide con el contenido.');
    const accepted = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/xml', 'text/xml', 'application/vnd.dian.ubl+xml'];
    if (!accepted.includes((file.mimetype ?? '').toLowerCase())) throw new BadRequestException('Tipo de archivo no soportado.');
  }
}
