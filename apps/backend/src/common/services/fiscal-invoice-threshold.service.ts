import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { FiscalGateService } from './fiscal-gate.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Art. 616-1 ET / Res. 000165 de 2023: el documento equivalente POS electrónico
 * sólo puede soportar ventas de hasta 5 UVT cuando el adquiriente no exige
 * factura. Por encima de ese valor la factura electrónica de venta es
 * obligatoria, y para emitirla hay que identificar al comprador.
 */
export const POS_EQUIVALENT_DOCUMENT_UVT_LIMIT = 5;

export interface UvtThresholdEvaluation {
  /** Whether the limit applies at all (invoicing area active + UVT configured). */
  enforced: boolean;
  /** UVT value in COP for the evaluated year, when it could be resolved. */
  uvt_value: number | null;
  /** `5 × uvt_value`, when it could be resolved. */
  limit_cop: number | null;
  /** Whether the amount exceeds the limit. `false` when not enforced. */
  exceeds: boolean;
  year: number;
}

/**
 * Single owner of the 5 UVT frontier between a POS equivalent document and a
 * nominative electronic invoice.
 *
 * WHY IT LIVES IN `common` AND NOT IN THE INVOICING DOMAIN: two independent
 * entry points must apply the identical rule — the POS payment
 * (`payments.service.ts`) and the storefront checkout
 * (`ecommerce/checkout.service.ts`). Importing `InvoicingModule` from
 * `PaymentsModule` for a threshold comparison would create a module cycle for no
 * gain, and duplicating the comparison is how the two paths drift.
 *
 * THREE DELIBERATE FAIL-OPEN CASES, each for a different reason:
 * 1. The buyer IS identified → the sale can be invoiced nominatively, so there is
 *    nothing to block regardless of the amount.
 * 2. `fiscal_status.invoicing` is not active → the store is not issuing
 *    electronic documents through Vendix at all; the DIAN rule has no subject.
 * 3. No `uvt_values` row for the year → the limit is unknown. Blocking every
 *    anonymous sale above an amount we cannot compute would be a self-inflicted
 *    outage on Jan 1st of every year. It is logged and the fiscal readiness
 *    checklist already surfaces the missing UVT (`uvt_current_year`).
 */
@Injectable()
export class FiscalInvoiceThresholdService {
  private readonly logger = new Logger(FiscalInvoiceThresholdService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly fiscalGate: FiscalGateService,
  ) {}

  /**
   * Evaluates the limit without throwing. Use it to drive UI hints; use
   * `assertInvoiceNotRequired` on the write path.
   */
  async evaluate(params: {
    organization_id: number;
    store_id: number | null;
    total_amount: number | string | Prisma.Decimal;
    has_customer: boolean;
    year?: number;
  }): Promise<UvtThresholdEvaluation> {
    const year = params.year ?? new Date().getFullYear();
    const not_enforced: UvtThresholdEvaluation = {
      enforced: false,
      uvt_value: null,
      limit_cop: null,
      exceeds: false,
      year,
    };

    if (params.has_customer) return not_enforced;

    const invoicing_enabled = await this.fiscalGate.isAreaEnabled(
      params.organization_id,
      params.store_id,
      'invoicing',
    );
    if (!invoicing_enabled) return not_enforced;

    const uvt_value = await this.resolveUvt(params.organization_id, year);
    if (uvt_value === null) {
      this.logger.warn(
        `No uvt_values row for organization #${params.organization_id} year ${year}; the 5 UVT POS limit cannot be enforced.`,
      );
      return not_enforced;
    }

    const limit_cop = uvt_value * POS_EQUIVALENT_DOCUMENT_UVT_LIMIT;
    const total = Number(params.total_amount ?? 0);

    return {
      enforced: true,
      uvt_value,
      limit_cop,
      exceeds: total > limit_cop,
      year,
    };
  }

  /**
   * Throws `FISCAL_UVT_INVOICE_REQUIRED` when an anonymous sale exceeds 5 UVT.
   *
   * Call it INSIDE the sale transaction, against the authoritative server-side
   * total. Validating the client-sent total instead would let a caller lower the
   * declared amount and slip past the limit.
   */
  async assertInvoiceNotRequired(params: {
    organization_id: number;
    store_id: number | null;
    total_amount: number | string | Prisma.Decimal;
    has_customer: boolean;
    year?: number;
    /** For the error detail: 'pos' | 'checkout' | … */
    channel?: string;
  }): Promise<UvtThresholdEvaluation> {
    const evaluation = await this.evaluate(params);
    if (!evaluation.exceeds) return evaluation;

    throw new VendixHttpException(
      ErrorCodes.FISCAL_UVT_INVOICE_REQUIRED,
      `La venta supera ${POS_EQUIVALENT_DOCUMENT_UVT_LIMIT} UVT (${this.formatCop(
        evaluation.limit_cop!,
      )}) y requiere factura electrónica de venta: identifique al adquiriente antes de cerrar la venta.`,
      {
        organization_id: params.organization_id,
        store_id: params.store_id,
        channel: params.channel ?? 'pos',
        total_amount: Number(params.total_amount ?? 0),
        uvt_value: evaluation.uvt_value,
        uvt_limit: POS_EQUIVALENT_DOCUMENT_UVT_LIMIT,
        limit_cop: evaluation.limit_cop,
        year: evaluation.year,
      },
    );
  }

  /**
   * UVT for the year. `uvt_values` is organization-scoped with an optional
   * accounting-entity override.
   *
   * Two explicit queries instead of one `orderBy: accounting_entity_id`: in
   * Postgres a `DESC` sort puts NULLs FIRST, so the "ordered" version would
   * silently prefer the org-level row and the ordering would read as intentional
   * while doing the opposite of what it says. The UVT is a national constant, so
   * the org-level row is the right default and an entity row is only a fallback
   * for organizations that never created the shared one.
   *
   * Read through `GlobalPrismaService` on purpose: this runs from inside a POS
   * transaction where the store-scoped client would take a second pool
   * connection, and the tenant filter is already explicit in `organization_id`.
   */
  private async resolveUvt(
    organization_id: number,
    year: number,
  ): Promise<number | null> {
    const row =
      (await this.globalPrisma.uvt_values.findFirst({
        where: { organization_id, year, accounting_entity_id: null },
        select: { value_cop: true },
      })) ??
      (await this.globalPrisma.uvt_values.findFirst({
        where: { organization_id, year },
        select: { value_cop: true },
      }));
    if (!row) return null;
    const value = Number(row.value_cop);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private formatCop(value: number): string {
    return `$${Math.round(value).toLocaleString('es-CO')}`;
  }
}
