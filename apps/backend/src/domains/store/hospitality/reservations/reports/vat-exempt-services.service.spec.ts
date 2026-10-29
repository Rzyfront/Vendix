import { RequestContextService } from '@common/context/request-context.service';
import { LodgingVatExemptServicesService } from './vat-exempt-services.service';

describe('LodgingVatExemptServicesService (H3.9 "Servicios exentos")', () => {
  function build() {
    const prisma = {
      store_settings: {
        findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
      },
      invoices: {
        findMany: jest.fn(async () => [
          {
            id: 31,
            invoice_number: 'FEH-12',
            issue_date: new Date('2026-11-12T15:00:00Z'),
            status: 'accepted',
            order_id: 500,
            total_amount: 608000,
            invoice_taxes: [{ taxable_amount: 500000 }],
          },
        ]),
      },
      lodging_folios: {
        findMany: jest.fn(async () => [
          {
            order_id: 500,
            reservation: {
              id: 1,
              reservation_number: 'H-0001',
              guests: [
                {
                  first_name: 'John',
                  last_name: 'Smith',
                  document_type: 'PA',
                  document_number: 'X1234567',
                  nationality_country_code: 'US',
                  entry_permit_type: 'PIP-5',
                },
              ],
            },
          },
        ]),
      },
    };
    return { service: new LodgingVatExemptServicesService(prisma as any), prisma };
  }

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 3 } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('lists the invoice with the exempt base, the passport and the entry permit', async () => {
    const { service, prisma } = build();

    const result = await service.list({ from: '2026-11-01', to: '2026-11-30' });

    // U18 — the export pins its dates to the store's zone.
    expect(result.timezone).toBe('America/Bogota');
    expect(result.rows).toEqual([
      expect.objectContaining({
        invoice_number: 'FEH-12',
        reservation_number: 'H-0001',
        guest_name: 'John Smith',
        document_type: 'PA',
        document_number: 'X1234567',
        nationality_country_code: 'US',
        entry_permit_type: 'PIP-5',
        exempt_base: 500000,
        invoice_total: 608000,
      }),
    ]);
    // Only live sales invoices carrying the exempt VAT row, in the store's days.
    const where = (prisma.invoices.findMany.mock.calls[0] as any)[0].where;
    expect(where).toMatchObject({
      invoice_type: 'sales_invoice',
      status: { notIn: ['voided', 'cancelled'] },
      invoice_taxes: { some: { tax_name: 'Exento – art. 481 lit. d ET' } },
    });
    expect(where.issue_date.gte.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(where.issue_date.lt.toISOString()).toBe('2026-12-01T05:00:00.000Z');
  });
});
