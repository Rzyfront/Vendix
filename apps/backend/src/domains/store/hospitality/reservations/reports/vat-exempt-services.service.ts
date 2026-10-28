import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  localDateString,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { VAT_EXEMPTION_TAX_NAME } from '../guests/lodging-vat-exemption';
import { VatExemptServicesQueryDto } from './vat-exempt-services.dto';

const FOLIO_HOLDER_SELECT = {
  order_id: true,
  reservation: {
    select: {
      id: true,
      reservation_number: true,
      guests: {
        where: { is_primary: true },
        select: {
          first_name: true,
          last_name: true,
          document_type: true,
          document_number: true,
          nationality_country_code: true,
          entry_permit_type: true,
        },
        take: 1,
      },
    },
  },
} satisfies Prisma.lodging_foliosSelect;

type FolioHolderRow = Prisma.lodging_foliosGetPayload<{ select: typeof FOLIO_HOLDER_SELECT }>;

/** One invoice of the "Servicios exentos" report. */
export interface VatExemptServiceRow {
  invoice_id: number;
  invoice_number: string | null;
  issue_date: Date;
  status: string;
  reservation_id: number | null;
  reservation_number: string | null;
  guest_name: string | null;
  document_type: string | null;
  document_number: string | null;
  nationality_country_code: string | null;
  entry_permit_type: string | null;
  exempt_base: number;
  invoice_total: number;
}

/**
 * Hospitality Suite (H3.9) — "Servicios exentos": every folio invoice whose
 * nights went out with VAT 0 % "Exento – art. 481 lit. d ET", with the
 * holder's passport and entry permit kept in `lodging_guests` as support.
 */
@Injectable()
export class LodgingVatExemptServicesService {
  constructor(private readonly prisma: StorePrismaService) {}

  async list(query: VatExemptServicesQueryDto): Promise<{ from: string; to: string; rows: VatExemptServiceRow[] }> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const tz = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), tz);
    // Default period: the current month of the store.
    const from = query.from ?? `${today.slice(0, 8)}01`;
    const to = query.to ?? today;
    const start = this.localMidnight(from, tz);
    const end = this.localMidnight(to, tz, 1);

    const invoices = await this.prisma.invoices.findMany({
      where: {
        invoice_type: 'sales_invoice',
        status: { notIn: ['voided', 'cancelled'] },
        issue_date: { gte: start, lt: end },
        invoice_taxes: { some: { tax_name: VAT_EXEMPTION_TAX_NAME } },
      },
      select: {
        id: true,
        invoice_number: true,
        issue_date: true,
        status: true,
        order_id: true,
        total_amount: true,
        invoice_taxes: {
          where: { tax_name: VAT_EXEMPTION_TAX_NAME },
          select: { taxable_amount: true },
        },
      },
      orderBy: { issue_date: 'desc' },
    });

    const orderIds = invoices.map((i) => i.order_id).filter((id): id is number => id !== null);
    const folios: FolioHolderRow[] = await this.prisma.lodging_folios.findMany({
      where: { order_id: { in: orderIds } },
      select: FOLIO_HOLDER_SELECT,
    });
    const byOrder = new Map(folios.map((f) => [f.order_id, f.reservation]));

    const rows = invoices.map((invoice): VatExemptServiceRow => {
      const reservation = invoice.order_id !== null ? byOrder.get(invoice.order_id) : undefined;
      const holder = reservation?.guests[0];
      const base = invoice.invoice_taxes.reduce((sum, t) => sum + Number(t.taxable_amount), 0);
      return {
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        issue_date: invoice.issue_date,
        status: invoice.status,
        reservation_id: reservation?.id ?? null,
        reservation_number: reservation?.reservation_number ?? null,
        guest_name: holder ? `${holder.first_name} ${holder.last_name}`.trim() : null,
        document_type: holder?.document_type ?? null,
        document_number: holder?.document_number ?? null,
        nationality_country_code: holder?.nationality_country_code ?? null,
        entry_permit_type: holder?.entry_permit_type ?? null,
        exempt_base: Math.round(base * 100) / 100,
        invoice_total: Number(invoice.total_amount),
      };
    });
    return { from, to, rows };
  }

  /** UTC instant of the store's local midnight of `date` (+ `days`). */
  private localMidnight(date: string, tz: string, days = 0): Date {
    const [y, m, d] = date.split('-').map(Number);
    const civil = new Date(Date.UTC(y, m - 1, d + days));
    return zonedWallClockToUtc(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), 0, 0, 0, 0, tz);
  }
}
