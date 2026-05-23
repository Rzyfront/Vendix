import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

type FiscalDocumentType =
  | 'sales_invoice'
  | 'credit_note'
  | 'debit_note'
  | 'support_document'
  | 'support_adjustment_note'
  | 'payroll'
  | 'payroll_adjustment';

type GenerateNextNumberOptions =
  | number
  | {
      resolution_id?: number;
      document_type?: FiscalDocumentType;
      accounting_entity_id?: number;
      organization_id?: number;
      store_id?: number | null;
    };

@Injectable()
export class InvoiceNumberGenerator {
  private readonly logger = new Logger(InvoiceNumberGenerator.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  /**
   * Atomically generates the next invoice number within the active resolution.
   * Uses a database-level atomic increment to prevent race conditions.
   */
  async generateNextNumber(resolution_id?: number): Promise<{
    invoice_number: string;
    resolution_id: number;
  }>;
  async generateNextNumber(options?: GenerateNextNumberOptions): Promise<{
    invoice_number: string;
    resolution_id: number;
  }>;
  async generateNextNumber(options?: GenerateNextNumberOptions): Promise<{
    invoice_number: string;
    resolution_id: number;
  }> {
    const normalized =
      typeof options === 'number'
        ? { resolution_id: options }
        : options || {};
    const context = RequestContextService.getContext();
    const organization_id =
      normalized.organization_id ?? context?.organization_id;
    const store_id = normalized.store_id ?? context?.store_id ?? null;
    const document_type = normalized.document_type ?? 'sales_invoice';

    if (!organization_id) {
      throw new Error('Organization context is required for fiscal numbering');
    }

    const accounting_entity_id =
      normalized.accounting_entity_id ??
      (
        await this.fiscalScope.resolveAccountingEntityForFiscal({
          organization_id,
          store_id,
        })
      ).id;

    const client = this.prisma.withoutScope();
    const updated = await client.$transaction(async (tx: any) => {
      const lockKey = `invoice_resolution:${accounting_entity_id}:${document_type}`;
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        lockKey,
      );

      const where = {
        accounting_entity_id,
        document_type,
        is_active: true,
        valid_from: { lte: new Date() },
        valid_to: { gte: new Date() },
        ...(normalized.resolution_id && { id: normalized.resolution_id }),
      };

      const resolution = await tx.invoice_resolutions.findFirst({
        where,
        orderBy: { created_at: 'desc' },
      });

      if (!resolution) {
        throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING);
      }

      const result = await tx.invoice_resolutions.updateMany({
        where: {
          id: resolution.id,
          current_number: { lt: resolution.range_to },
        },
        data: {
          current_number: { increment: 1 },
        },
      });

      if (result.count !== 1) {
        throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED);
      }

      return tx.invoice_resolutions.findUnique({
        where: { id: resolution.id },
      });
    });

    if (!updated) {
      throw new VendixHttpException(ErrorCodes.FISCAL_RESOLUTION_MISSING);
    }

    const next_number = updated.current_number;
    const invoice_number = `${updated.prefix}${next_number}`;

    this.logger.log(
      `Generated ${document_type} number: ${invoice_number} (resolution #${updated.id})`,
    );

    return {
      invoice_number,
      resolution_id: updated.id,
    };
  }
}
