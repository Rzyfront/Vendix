import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCalculatorService } from './services/invoice-calculator.service';

/**
 * A.2 — el residuo inalcanzable y la entrada inválida BLOQUEAN pre-numeración
 * (CP-facturacion-impuesto-incluido-redondeo, ADR-04, F-043/F-060).
 *
 * `recalculateDocument` es el único gate antes de `generateNextNumber`: todos
 * los carriles recalculan primero (ver el comentario de orden en `create`).
 * Sin la rama divergencia→throw, el scope nuevo caía en warn-only y el corto
 * se numeraba. Archivo NUEVO: no toca los specs de A.1.
 */
describe('InvoicingService · bloqueo pre-numeración del residuo (A.2)', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };

  const createService = () => {
    const created: any[] = [];
    const prisma = {
      invoices: {
        create: jest.fn().mockImplementation(({ data }) => {
          created.push(data);
          return { id: 300, invoice_number: data.invoice_number };
        }),
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

    return { service, prisma, generator, created };
  };

  const withContext = async <T>(run: () => Promise<T>): Promise<T> =>
    RequestContextService.run(requestContext as any, run);

  const baseDto = (
    items: CreateInvoiceDto['items'],
    extra: Partial<CreateInvoiceDto> = {},
  ): CreateInvoiceDto =>
    ({
      invoice_type: 'sales_invoice',
      customer_name: 'Cliente',
      customer_tax_id: '900123456',
      issue_date: '2026-03-12',
      currency: 'COP',
      items,
      ...extra,
    }) as CreateInvoiceDto;

  it('$17 con INC 8% ⇒ 422 INVOICING_CALC_005 SIN gastar consecutivo', async () => {
    // f(15.74) = 16.99; f(15.75) = 17.01 > 17: bruto inalcanzable, el kernel
    // persiste closest-below y el gate bloquea antes de numerar.
    const { service, generator } = createService();

    const thrown: any = await withContext(() =>
      service
        .create(
          baseDto([
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
          ] as any),
        )
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
      expected: '17.00',
      received: '16.99',
      difference: '-0.01',
    });
    expect(typeof body?.details?.input_hash).toBe('string');
    // LO IMPORTANTE: el número autorizado no se tocó.
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('entrada inválida (unit_price abc) ⇒ 422 INVOICING_CALC_006 SIN gastar consecutivo', async () => {
    const { service, generator } = createService();

    const thrown: any = await withContext(() =>
      service
        .create(
          baseDto([
            {
              description: 'Basura',
              quantity: 1,
              unit_price: 'abc',
              taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
            },
          ] as any),
        )
        .then(
          () => null,
          (error) => error,
        ),
    );

    expect(thrown).not.toBeNull();
    expect(thrown).toMatchObject({ errorCode: 'INVOICING_CALC_006' });
    const body = thrown.getResponse?.() as any;
    expect(body?.details?.line_index).toBe(0);
    expect(typeof body?.details?.detail).toBe('string');
    expect(generator.generateNextNumber).not.toHaveBeenCalled();
  });

  it('$3.000 con INC 8% cierra exacto: no bloquea, numera una vez y persiste 3000.00', async () => {
    // Contrapeso: el gate sólo muerde lo inalcanzable/inválido. Con payload
    // de panel real (placeholders en cero) la factura nace.
    const { service, generator, created } = createService();

    await withContext(() =>
      service.create(
        baseDto([
          {
            description: 'Cierra exacto',
            quantity: 1,
            unit_price: 3000,
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
        ] as any),
      ),
    );

    expect(generator.generateNextNumber).toHaveBeenCalledTimes(1);
    expect(Number(created[0].total_amount)).toBe(3000);
    expect(Number(created[0].subtotal_amount)).toBe(2777.78);
  });
});
