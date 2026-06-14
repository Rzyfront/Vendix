import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

describe('InvoicingService support adjustment notes', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const supplier = {
    id: 50,
    name: 'Proveedor No Obligado',
    tax_id: '123456789',
    document_type: 'CC',
    tax_regime: 'no_responsable_iva',
    verification_digit: null,
    addresses: {
      address_line1: 'Carrera 4 # 5-6',
      address_line2: null,
      city: 'Bogota',
      state_province: 'Bogota',
      country_code: 'CO',
      postal_code: '110111',
      municipality_code: '11001',
      phone_number: null,
    },
  };

  const dto: CreateInvoiceDto = {
    invoice_type: 'support_adjustment_note',
    supplier_id: 50,
    related_invoice_id: 100,
    issue_date: '2026-03-12',
    currency: 'COP',
    withholding_amount: 0,
    notes: 'Ajuste documento soporte',
    items: [
      {
        description: 'Ajuste servicio',
        quantity: 1,
        unit_price: 1000,
        discount_amount: 0,
        tax_amount: 0,
      },
    ],
    taxes: [],
  };

  const createService = (overrides: any = {}) => {
    const prisma = {
      suppliers: {
        findFirst: jest.fn().mockResolvedValue(supplier),
      },
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          invoice_number: 'DS100',
          invoice_type: 'support_document',
          status: 'accepted',
          cufe: 'original-cuds',
        }),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 200,
          invoice_number: data.invoice_number,
          related_invoice_id: data.related_invoice_id,
          customer_name: data.customer_name,
          customer_tax_id: data.customer_tax_id,
          customer_address: data.customer_address,
        })),
      },
      fiscal_close_sessions: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides.prisma,
    };
    const generator = {
      generateNextNumber: jest.fn().mockResolvedValue({
        invoice_number: 'NADS100',
        resolution_id: 88,
      }),
    };
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn().mockResolvedValue({ id: 77 }),
    };
    const retryQueue = {
      getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(new Map()),
      ...overrides.retryQueue,
    };

    return {
      service: new InvoicingService(
        prisma as any,
        generator as any,
        eventEmitter,
        fiscalScope as any,
        retryQueue as any,
      ),
      prisma,
      generator,
      eventEmitter,
      retryQueue,
    };
  };

  it('requires an accepted original support document', async () => {
    const { service, generator } = createService({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            id: 100,
            invoice_number: 'DS100',
            invoice_type: 'support_document',
            status: 'validated',
            cufe: null,
          }),
        },
      },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.create(dto)),
    ).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('blocks creation when the fiscal period is closed', async () => {
    const { service, generator } = createService({
      prisma: {
        fiscal_close_sessions: {
          findFirst: jest.fn().mockResolvedValue({
            id: 300,
            period_year: 2026,
            period_month: 3,
            closed_at: new Date('2026-04-05T00:00:00.000Z'),
          }),
        },
      },
    });

    await expect(
      RequestContextService.run(requestContext, () => service.create(dto)),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_ACCOUNTING_BLOCKED' });
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('links the adjustment note to the accepted original support document', async () => {
    const { service, prisma, generator } = createService();

    const result = await RequestContextService.run(requestContext, () =>
      service.create(dto),
    );

    expect(generator.generateNextNumber).toHaveBeenCalledWith({
      resolution_id: undefined,
      document_type: 'support_adjustment_note',
      accounting_entity_id: 77,
    });
    expect(prisma.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoice_number: 'NADS100',
          invoice_type: 'support_adjustment_note',
          related_invoice_id: 100,
          customer_name: 'Proveedor No Obligado',
          customer_tax_id: '123456789',
          customer_address: supplier.addresses,
        }),
      }),
    );
    expect(result.related_invoice_id).toBe(100);
  });

  describe('findAll retry_status', () => {
    const invoices = [
      {
        id: 1,
        send_status: 'sent_error',
        transmission_status: 'error',
      },
      {
        id: 2,
        send_status: 'sent_ok',
        transmission_status: 'accepted',
      },
      {
        id: 3,
        send_status: 'sent_error',
        transmission_status: 'error',
      },
    ];

    const createListService = (retryMap: Map<number, any>) =>
      createService({
        prisma: {
          invoices: {
            findMany: jest.fn().mockResolvedValue(invoices),
            count: jest.fn().mockResolvedValue(invoices.length),
          },
        },
        retryQueue: {
          getRetryStatusByInvoiceIds: jest.fn().mockResolvedValue(retryMap),
        },
      });

    it('resolves retry_status in batch only for error/pending invoices, null otherwise', async () => {
      const retry_status = {
        status: 'pending',
        attempts: 1,
        max_attempts: 3,
        last_error: 'ETIMEDOUT',
        next_retry_at: new Date('2026-06-09T12:00:00.000Z'),
      };
      const { service, retryQueue } = createListService(
        new Map([[1, retry_status]]),
      );

      const result = await service.findAll({ page: 1, limit: 10 } as any);

      // One batch call with only the error/pending IDs of the page (no N+1).
      expect(retryQueue.getRetryStatusByInvoiceIds).toHaveBeenCalledTimes(1);
      expect(retryQueue.getRetryStatusByInvoiceIds).toHaveBeenCalledWith([
        1, 3,
      ]);

      expect(result.data[0].retry_status).toEqual(retry_status);
      // Accepted invoice: never queried, retry_status null.
      expect(result.data[1].retry_status).toBeNull();
      // Error invoice not present in the queue: retry_status null.
      expect(result.data[2].retry_status).toBeNull();
    });
  });
});
