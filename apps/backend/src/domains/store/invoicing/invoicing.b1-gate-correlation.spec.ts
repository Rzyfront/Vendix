import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  InvoicingService,
  formatGateCorrelation,
  gateCorrelationDetails,
} from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';

/**
 * B.1 (F-063 + F-023) — correlación espejo↔motor en warns/422 y lectura de
 * reparo del huérfano sin filas de impuesto.
 *
 * Archivo NUEVO: no toca specs de A.1/A.2.
 */
describe('InvoicingService · correlación del gate y reparo (B.1)', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = (overrides: {
    findFirst?: (args: unknown) => Promise<unknown>;
  } = {}) => {
    const prisma = {
      invoices: {
        create: jest.fn(),
        findFirst: jest
          .fn()
          .mockImplementation((args: unknown) =>
            overrides.findFirst
              ? overrides.findFirst(args)
              : Promise.resolve(null),
          ),
      },
      fiscal_close_sessions: { findFirst: jest.fn().mockResolvedValue(null) },
      products: { findMany: jest.fn().mockResolvedValue([]) },
      withoutScope: () => ({
        dian_configurations: { findFirst: jest.fn().mockResolvedValue(null) },
        tax_rates: { findMany: jest.fn().mockResolvedValue([]) },
      }),
    };
    const generator = {
      generateNextNumber: jest.fn().mockResolvedValue({
        invoice_number: 'FV1',
        resolution_id: 88,
      }),
    };

    const service = new InvoicingService(
      prisma as any,
      generator as any,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {
        resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 77 }),
        requireFiscalScope: jest.fn().mockResolvedValue('STORE'),
        getFiscalScope: jest.fn().mockResolvedValue('STORE'),
      } as any,
      { getRetryStatusByInvoiceIds: jest.fn() } as any,
      {
        isAreaEnabled: jest.fn().mockResolvedValue(true),
        isSubflowEnabled: jest.fn().mockResolvedValue(true),
      } as any,
      {
        assertAreaActive: jest.fn().mockResolvedValue(undefined),
        assertElectronicEmissionLive: jest.fn().mockResolvedValue(undefined),
      } as any,
      {
        evaluate: jest.fn().mockResolvedValue({
          enforced: false,
          uvt_value: null,
          limit_cop: null,
          exceeds: false,
          year: 2026,
        }),
        assertInvoiceNotRequired: jest.fn(),
      } as any,
      new InvoiceCalculatorService(),
      { resolveExchangeRate: jest.fn().mockResolvedValue(null) } as any,
      {
        resolveSuffered: jest.fn().mockResolvedValue({
          lines: [],
          uvt_value_used: 0,
          counterparty_type: null,
        }),
        resolveSelf: jest.fn().mockResolvedValue({
          lines: [],
          uvt_value_used: 0,
          counterparty_type: null,
        }),
      } as any,
    );

    return { service, prisma, generator };
  };

  const withContext = async <T>(run: () => Promise<T>): Promise<T> =>
    RequestContextService.run(requestContext as any, run);

  describe('helpers puros (F-063)', () => {
    it('formatGateCorrelation sólo pinta lo definido', () => {
      expect(
        formatGateCorrelation({ store_id: 2, organization_id: 1 }),
      ).toBe(' [store=2 org=1]');
      expect(
        formatGateCorrelation({
          store_id: 2,
          organization_id: 1,
          invoice_id: 300,
        }),
      ).toBe(' [store=2 org=1 invoice=300]');
      expect(formatGateCorrelation({})).toBe('');
    });

    it('gateCorrelationDetails omite claves vacías y undefined sin nada', () => {
      expect(gateCorrelationDetails({})).toBeUndefined();
      expect(
        gateCorrelationDetails({ store_id: 2, invoice_id: 300 }),
      ).toEqual({ store_id: 2, invoice_id: 300 });
    });
  });

  describe('422 con correlación (F-063)', () => {
    it('$17/INC 8% ⇒ CALC_005 con correlation {store, org}', async () => {
      const { service, generator } = createService();

      const thrown: any = await withContext(() =>
        service
          .create({
            invoice_type: 'sales_invoice',
            customer_name: 'Cliente',
            customer_tax_id: '900123456',
            issue_date: '2026-03-12',
            currency: 'COP',
            items: [
              {
                description: 'Inalcanzable',
                quantity: 1,
                unit_price: 17,
                is_inclusive: true,
                tax_amount: 0,
                taxes: [
                  {
                    tax_name: 'INC',
                    tax_rate: 8,
                    tax_type: 'inc',
                    taxable_amount: 0,
                    tax_amount: 0,
                    is_inclusive: true,
                  },
                ],
              },
            ],
          } as CreateInvoiceDto)
          .then(
            () => null,
            (error) => error,
          ),
      );

      expect(thrown).not.toBeNull();
      expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_005' });
      const body = thrown.getResponse?.() as any;
      expect(body?.details).toMatchObject({
        line_index: 0,
        correlation: { store_id: 2, organization_id: 1 },
      });
      expect(generator.generateNextNumber).not.toHaveBeenCalled();
    });
  });

  describe('lectura de reparo del huérfano (F-023)', () => {
    it('PATCH sin líneas sobre borrador sin filas ⇒ PREVALIDATION_001 que manda re-guardar con líneas', async () => {
      const { service } = createService({
        findFirst: () =>
          Promise.resolve({
            id: 5,
            status: 'draft',
            tax_amount: new Prisma.Decimal('222.22'),
            invoice_items: [{ id: 11 }],
            invoice_taxes: [],
          }),
      });

      const thrown: any = await withContext(() =>
        service.update(5, { notes: 'solo notas' } as never).then(
          () => null,
          (error) => error,
        ),
      );

      expect(thrown).not.toBeNull();
      expect(thrown).toMatchObject({
        errorCode: 'INVOICING_PREVALIDATION_001',
      });
      const body = thrown.getResponse?.() as any;
      expect(body?.details).toMatchObject({
        invoice_id: 5,
        item_count: 1,
        tax_row_count: 0,
      });
      expect(String(body?.message ?? '')).toContain('INCLUYENDO las líneas');
    });
  });
});
