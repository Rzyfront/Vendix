import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { S3Service } from '../../../../common/services/s3.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateVendorSupportDocumentDto } from './dto/create-vendor-support-document.dto';
import { UpdateVendorSupportDocumentDto } from './dto/update-vendor-support-document.dto';
import { QueryVendorSupportDocumentDto } from './dto/query-vendor-support-document.dto';

const INCLUDE_FULL = {
  organization: { select: { id: true, name: true, legal_name: true } },
  approved_journal_entry: {
    select: { id: true, entry_number: true, status: true, entry_date: true },
  },
  paid_journal_entry: {
    select: { id: true, entry_number: true, status: true, entry_date: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
};

const VENDOR_DOC_ACCEPTED_CONTENT_TYPES = new Set(['application/pdf']);

@Injectable()
export class VendorSupportDocumentsService {
  private readonly logger = new Logger(VendorSupportDocumentsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrgService: PlatformOrgService,
    private readonly s3Service: S3Service,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async requirePlatformContext() {
    const ctx = await this.platformOrgService.getPlatformContext();
    if (!ctx) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Vendix platform organization is not bootstrapped',
      );
    }
    return ctx;
  }

  private async requireAccountCodeExists(
    organization_id: number,
    accounting_entity_id: number,
    account_code: string,
  ): Promise<void> {
    const account = await this.prisma
      .withoutScope()
      .chart_of_accounts.findFirst({
        where: {
          organization_id,
          accounting_entity_id,
          code: account_code,
        },
        select: { id: true },
      });
    if (!account) {
      throw new VendixHttpException(
        ErrorCodes.ACC_FIND_001,
        `Account code '${account_code}' not found in platform chart of accounts`,
      );
    }
  }

  private async findDocOrThrow(id: number, organization_id: number) {
    const doc = await this.prisma
      .withoutScope()
      .vendor_support_documents.findFirst({
        where: { id, organization_id },
        include: INCLUDE_FULL,
      });
    if (!doc) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `Vendor support document #${id} not found`,
      );
    }
    return doc;
  }

  async findAll(query: QueryVendorSupportDocumentDto) {
    const ctx = await this.requirePlatformContext();
    const {
      status,
      vendor_nit,
      date_from,
      date_to,
      search,
      page = 1,
      limit = 10,
      sort_by = 'issue_date',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.vendor_support_documentsWhereInput = {
      organization_id: ctx.organization_id,
      ...(status && { status: status as any }),
      ...(vendor_nit && {
        vendor_nit: { contains: vendor_nit, mode: 'insensitive' as const },
      }),
      ...((date_from || date_to) && {
        issue_date: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to) }),
        },
      }),
      ...(search && {
        OR: [
          { vendor_name: { contains: search, mode: 'insensitive' as const } },
          { invoice_number: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.withoutScope().vendor_support_documents.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: INCLUDE_FULL,
      }),
      this.prisma.withoutScope().vendor_support_documents.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async findOne(id: number) {
    const ctx = await this.requirePlatformContext();
    return this.findDocOrThrow(id, ctx.organization_id);
  }

  async create(dto: CreateVendorSupportDocumentDto, userId: number | null) {
    const ctx = await this.requirePlatformContext();

    await this.requireAccountCodeExists(
      ctx.organization_id,
      ctx.accounting_entity_id,
      dto.account_code,
    );

    const created = await this.prisma
      .withoutScope()
      .vendor_support_documents.create({
        data: {
          organization_id: ctx.organization_id,
          vendor_nit: dto.vendor_nit,
          vendor_name: dto.vendor_name,
          invoice_number: dto.invoice_number,
          issue_date: new Date(dto.issue_date),
          subtotal: dto.subtotal != null ? new Prisma.Decimal(dto.subtotal) : null,
          tax_amount:
            dto.tax_amount != null ? new Prisma.Decimal(dto.tax_amount) : null,
          total: new Prisma.Decimal(dto.total),
          currency: dto.currency ?? 'COP',
          account_code: dto.account_code,
          description: dto.description ?? null,
          status: 'pending',
          created_by_user_id: userId ?? null,
        },
        include: INCLUDE_FULL,
      });

    return created;
  }

  async update(
    id: number,
    dto: UpdateVendorSupportDocumentDto,
    userId: number | null,
  ) {
    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    if (doc.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Vendor support document #${id} cannot be edited in status '${doc.status}'`,
      );
    }

    if (dto.account_code) {
      await this.requireAccountCodeExists(
        ctx.organization_id,
        ctx.accounting_entity_id,
        dto.account_code,
      );
    }

    const updated = await this.prisma
      .withoutScope()
      .vendor_support_documents.update({
        where: { id: doc.id },
        data: {
          ...(dto.vendor_nit != null && { vendor_nit: dto.vendor_nit }),
          ...(dto.vendor_name != null && { vendor_name: dto.vendor_name }),
          ...(dto.invoice_number != null && {
            invoice_number: dto.invoice_number,
          }),
          ...(dto.issue_date != null && {
            issue_date: new Date(dto.issue_date),
          }),
          ...(dto.subtotal != null && {
            subtotal: new Prisma.Decimal(dto.subtotal),
          }),
          ...(dto.tax_amount != null && {
            tax_amount: new Prisma.Decimal(dto.tax_amount),
          }),
          ...(dto.total != null && { total: new Prisma.Decimal(dto.total) }),
          ...(dto.currency != null && { currency: dto.currency }),
          ...(dto.account_code != null && { account_code: dto.account_code }),
          ...(dto.description != null && { description: dto.description }),
          updated_at: new Date(),
        },
        include: INCLUDE_FULL,
      });

    return updated;
  }

  async approve(id: number, userId: number | null) {
    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    if (doc.status === 'approved' || doc.status === 'paid') {
      return doc;
    }

    if (doc.status === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot approve a void vendor support document`,
      );
    }

    if (doc.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Vendor support document #${id} is in an unexpected state '${doc.status}'`,
      );
    }

    const eventPayload = {
      expense_id: doc.id,
      organization_id: ctx.organization_id,
      store_id: undefined,
      amount: Number(doc.total),
      user_id: userId ?? undefined,
    };

    try {
      await this.eventEmitter.emitAsync('expense.approved', eventPayload);
    } catch (error: any) {
      this.logger.error(
        `expense.approved emission failed for vendor support document #${doc.id}: ${error?.message ?? error}`,
        error?.stack,
      );
    }

    const entry = await this.waitForAutoEntry(
      ctx.organization_id,
      'expense.approved',
      doc.id,
    );

    const updated = await this.prisma
      .withoutScope()
      .vendor_support_documents.update({
        where: { id: doc.id },
        data: {
          status: 'approved',
          approved_journal_entry_id: entry?.id ?? null,
          updated_at: new Date(),
        },
        include: INCLUDE_FULL,
      });

    if (!entry) {
      this.logger.warn(
        `Vendor support document #${doc.id} approved but no accounting_entries row found for source_type=expense.approved; listener may have skipped (fiscal gate disabled or mapping missing).`,
      );
    }

    return updated;
  }

  async markPaid(id: number, userId: number | null) {
    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    if (doc.status === 'paid') {
      return doc;
    }

    if (doc.status === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot mark-paid a void vendor support document`,
      );
    }

    if (doc.status !== 'approved') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Vendor support document #${id} must be approved before mark-paid (current status: '${doc.status}')`,
      );
    }

    const eventPayload = {
      expense_id: doc.id,
      organization_id: ctx.organization_id,
      store_id: undefined,
      amount: Number(doc.total),
      user_id: userId ?? undefined,
    };

    try {
      await this.eventEmitter.emitAsync('expense.paid', eventPayload);
    } catch (error: any) {
      this.logger.error(
        `expense.paid emission failed for vendor support document #${doc.id}: ${error?.message ?? error}`,
        error?.stack,
      );
    }

    const entry = await this.waitForAutoEntry(
      ctx.organization_id,
      'expense.paid',
      doc.id,
    );

    const updated = await this.prisma
      .withoutScope()
      .vendor_support_documents.update({
        where: { id: doc.id },
        data: {
          status: 'paid',
          paid_journal_entry_id: entry?.id ?? null,
          updated_at: new Date(),
        },
        include: INCLUDE_FULL,
      });

    if (!entry) {
      this.logger.warn(
        `Vendor support document #${doc.id} marked paid but no accounting_entries row found for source_type=expense.paid; listener may have skipped (fiscal gate disabled or mapping missing).`,
      );
    }

    return updated;
  }

  async void(id: number, userId: number | null) {
    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    if (doc.status === 'void') {
      return doc;
    }

    if (doc.status === 'paid') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Cannot void a paid vendor support document (status: '${doc.status}')`,
      );
    }

    const updated = await this.prisma
      .withoutScope()
      .vendor_support_documents.update({
        where: { id: doc.id },
        data: {
          status: 'void',
          updated_at: new Date(),
        },
        include: INCLUDE_FULL,
      });

    return updated;
  }

  async remove(id: number, userId: number | null) {
    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    if (doc.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Vendor support document #${id} can only be removed in status 'pending' (current: '${doc.status}')`,
      );
    }

    if (doc.pdf_s3_key) {
      try {
        await this.s3Service.deleteFile(doc.pdf_s3_key);
      } catch (error: any) {
        this.logger.warn(
          `Failed to delete S3 file ${doc.pdf_s3_key} for vendor support document #${id}: ${error?.message ?? error}`,
        );
      }
    }

    await this.prisma
      .withoutScope()
      .vendor_support_documents.delete({ where: { id: doc.id } });

    return { id: doc.id, deleted: true };
  }

  async uploadPdf(id: number, file: Express.Multer.File) {
    if (!file) {
      throw new VendixHttpException(
        ErrorCodes.MEDIA_FILE_REQUIRED_001,
        'PDF file is required (multipart field "file")',
      );
    }

    const contentType = file.mimetype?.toLowerCase();
    if (!contentType || !VENDOR_DOC_ACCEPTED_CONTENT_TYPES.has(contentType)) {
      throw new VendixHttpException(
        ErrorCodes.VALIDATION_FILE_TYPE,
        `Unsupported file type '${contentType}'. Only application/pdf is accepted.`,
      );
    }

    const ctx = await this.requirePlatformContext();
    const doc = await this.findDocOrThrow(id, ctx.organization_id);

    const originalName = (file.originalname || `document-${id}.pdf`)
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(-120);
    const fileName = `${Date.now()}-${originalName}`;
    const key = `vendor-docs/${ctx.organization_id}/${id}/${fileName}`;

    const storedKey = await this.s3Service.uploadFile(
      file.buffer,
      key,
      contentType,
    );

    if (doc.pdf_s3_key && doc.pdf_s3_key !== storedKey) {
      try {
        await this.s3Service.deleteFile(doc.pdf_s3_key);
      } catch (error: any) {
        this.logger.warn(
          `Failed to delete previous S3 file ${doc.pdf_s3_key} for vendor support document #${id}: ${error?.message ?? error}`,
        );
      }
    }

    const updated = await this.prisma
      .withoutScope()
      .vendor_support_documents.update({
        where: { id: doc.id },
        data: {
          pdf_s3_key: storedKey,
          updated_at: new Date(),
        },
        include: INCLUDE_FULL,
      });

    return updated;
  }

  private async waitForAutoEntry(
    organization_id: number,
    source_type: string,
    source_id: number,
  ): Promise<{ id: number } | null> {
    const maxAttempts = 4;
    const delayMs = 250;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const entry = await this.prisma
        .withoutScope()
        .accounting_entries.findFirst({
          where: {
            organization_id,
            source_type,
            source_id,
          },
          select: { id: true },
          orderBy: { id: 'desc' },
        });
      if (entry) return entry;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return null;
  }
}
