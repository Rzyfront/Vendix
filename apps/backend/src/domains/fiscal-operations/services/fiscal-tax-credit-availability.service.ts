import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, tax_declaration_type_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { FiscalOperationsContext } from './fiscal-context-resolver.service';

export interface FiscalTaxCreditAvailabilityRow {
  id: number;
  source_kind: string;
  amount: string;
  applied: string;
  available: string | null;
  blockers: string[];
}

export interface FiscalTaxCreditAvailability {
  credits: FiscalTaxCreditAvailabilityRow[];
  available_total: string | null;
  complete: boolean;
}

@Injectable()
export class FiscalTaxCreditAvailabilityService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Diagnostic availability only; this does not establish a tax position or
   * legal eligibility, and never applies, creates, reverses, or nets credits.
   */
  async list(
    context: FiscalOperationsContext,
    taxType: tax_declaration_type_enum,
    jurisdictionKey: string,
    asOf: Date,
  ): Promise<FiscalTaxCreditAvailability> {
    if (!jurisdictionKey?.trim()) {
      throw new BadRequestException('A jurisdiction key is required');
    }
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new BadRequestException('A valid as-of date is required');
    }

    const credits = await this.prisma.fiscal_tax_credits.findMany({
      where: {
        organization_id: context.organization_id,
        accounting_entity_id: context.accounting_entity_id,
        store_id: context.store_id,
        tax_type: taxType,
        jurisdiction_key: jurisdictionKey,
        effective_date: { lte: asOf },
        status: 'approved',
      },
      include: {
        applications: {
          include: {
            declaration: {
              select: {
                accounting_entity_id: true,
                declaration_type: true,
                jurisdiction_key: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const rows = credits.map((credit): FiscalTaxCreditAvailabilityRow => {
      const amount = new Prisma.Decimal(credit.amount);
      const appliedApplications = credit.applications.filter(
        (application) => application.status === 'applied',
      );
      const applied = appliedApplications.reduce(
        (total, application) => total.plus(application.amount),
        new Prisma.Decimal(0),
      );
      const blockers: string[] = [];

      if (!credit.source_declaration_id && !credit.evidence_id) {
        blockers.push('missing_source_or_evidence');
      }
      if (
        appliedApplications.some(
          ({ declaration }) =>
            declaration.accounting_entity_id !== credit.accounting_entity_id ||
            declaration.declaration_type !== credit.tax_type ||
            declaration.jurisdiction_key !== credit.jurisdiction_key,
        )
      ) {
        blockers.push('application_declaration_mismatch');
      }
      if (applied.gt(amount)) blockers.push('overapplied');

      return {
        id: credit.id,
        source_kind: credit.source_kind,
        amount: amount.toFixed(2),
        applied: applied.toFixed(2),
        available: blockers.length
          ? null
          : Prisma.Decimal.max(amount.minus(applied), new Prisma.Decimal(0)).toFixed(2),
        blockers,
      };
    });

    const complete = rows.every((row) => row.blockers.length === 0);
    const availableTotal = complete
      ? rows.reduce(
          (total, row) => total.plus(row.available ?? '0'),
          new Prisma.Decimal(0),
        )
      : null;

    return {
      credits: rows,
      available_total: availableTotal?.toFixed(2) ?? null,
      complete,
    };
  }
}
