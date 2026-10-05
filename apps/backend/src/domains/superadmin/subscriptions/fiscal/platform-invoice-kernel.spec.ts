import { SubscriptionFiscalService } from './subscription-fiscal.service';
import { CreatePlatformInvoiceDto } from './dto/subscription-fiscal.dto';
import { CustomerFiscalIdentityValidator } from '../../../store/invoicing/validators/customer-fiscal-identity.validator';
import { FiscalDocumentValidator } from '../../../store/invoicing/validators/fiscal-document.validator';
import { InvoiceCalculatorService } from '../../../store/invoicing/services/invoice-calculator.service';
import {
  dianLineExtension,
  dianLineExtensionTotal,
  dianSum,
} from '../../../store/invoicing/utils/dian-money.util';
import { VendixHttpException } from '../../../../common/errors';

/**
 * FASE 1.1 / 1.2 — la factura de plataforma calcula con el MISMO motor que el
 * riel de tiendas, y valida los totales ANTES de reservar consecutivo.
 *
 * Antes: `Math.round` por línea (redondeo, no truncado) y `base × tarifa` en
 * flotante. Una línea de 3 × 10,005 daba 30,02 contra los 30,01 de la DIAN.
 */

const TECHNICAL_KEY = 'a'.repeat(64);

function resolutionRow() {
  const now = new Date();
  return {
    id: 77,
    resolution_number: '18760000001',
    prefix: 'FE',
    range_from: 1,
    range_to: 1000,
    current_number: 0,
    valid_from: new Date(now.getFullYear() - 1, 0, 1),
    valid_to: new Date(now.getFullYear() + 1, 11, 31),
    is_active: true,
    technical_key: TECHNICAL_KEY,
    document_type: 'sales_invoice',
  };
}

function makeService(prisma: any = {}) {
  const unused = {};
  return Reflect.construct(SubscriptionFiscalService, [
    prisma,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    { reveal: () => TECHNICAL_KEY },
    new CustomerFiscalIdentityValidator(),
    new FiscalDocumentValidator(),
    unused,
    unused,
  ]) as SubscriptionFiscalService;
}

type Item = CreatePlatformInvoiceDto['items'][number];
const iva = (is_inclusive = false) => ({
  tax_type: 'IVA',
  rate: 0.19,
  is_inclusive,
});

const CASES: Array<{ name: string; items: Item[] }> = [
  {
    name: 'exclusivo 19 %',
    items: [
      { description: 'Implementación', quantity: 1, unit_price: 100000, taxes: [iva()] },
    ],
  },
  {
    name: 'incluido 19 % con descuento (3 × 40.000 − 10.000)',
    items: [
      {
        description: 'Licencia',
        quantity: 3,
        unit_price: 40000,
        discount_amount: 10000,
        taxes: [iva(true)],
      },
    ],
  },
  {
    name: 'dos líneas de 10,005 (truncar hoja por hoja, no redondear)',
    items: [
      { description: 'A', quantity: 1, unit_price: 10.005, taxes: [iva()] },
      { description: 'B', quantity: 1, unit_price: 10.005, taxes: [iva()] },
    ],
  },
  {
    name: 'cuatro decimales de cantidad y precio',
    items: [
      { description: 'Horas', quantity: 7.3333, unit_price: 12345.6789, taxes: [iva()] },
    ],
  },
  {
    name: 'mezcla IVA incluido + línea sin impuestos + INC 8 %',
    items: [
      { description: 'Plan', quantity: 2, unit_price: 119000, taxes: [iva(true)] },
      { description: 'Excluido', quantity: 1, unit_price: 50000 },
      {
        description: 'Consumo',
        quantity: 3,
        unit_price: 10800,
        taxes: [{ tax_type: 'INC', rate: 0.08, is_inclusive: true }],
      },
    ],
  },
  {
    name: 'sin impuestos (excluido art. 476)',
    items: [{ description: 'Capacitación', quantity: 4, unit_price: 250000 }],
  },
];

function storeCalc(items: Item[]) {
  return new InvoiceCalculatorService().calculate({
    items: items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      discount_amount: it.discount_amount ?? 0,
      taxes: (it.taxes ?? []).map((t) => ({
        tax_name: t.tax_type,
        tax_type: t.tax_type.toLowerCase(),
        tax_rate: t.rate * 100,
        rate_basis: 'percent' as const,
        is_inclusive: t.is_inclusive === true,
      })),
    })),
  } as any);
}

describe('Factura de plataforma — cálculo por kernel DIAN (F1.1)', () => {
  const service = makeService();

  it.each(CASES)('$name: totales idénticos a los del riel tienda', ({ items }) => {
    const mine = service.computePlatformInvoiceTotals({ items });
    const store = storeCalc(items);

    expect(mine.subtotal).toBe(store.totals.total_before_tax);
    expect(mine.taxTotal).toBe(store.totals.tax_amount);
    expect(mine.payable).toBe(store.totals.total_amount);
    mine.lineItems.forEach((line, i) => {
      expect(line.tax_amount).toBe(store.lines[i].tax_amount);
      expect(dianLineExtension(line)).toBe(store.lines[i].line_extension_amount);
    });
  });

  it.each(CASES)('$name: la cabecera es la Σ de lo que las líneas declaran', ({ items }) => {
    const mine = service.computePlatformInvoiceTotals({ items });
    expect(mine.subtotal).toBe(dianLineExtensionTotal(mine.lineItems));
    expect(mine.taxTotal).toBe(dianSum(mine.lineItems.map((l) => l.tax_amount)));
    expect(mine.payable).toBe(dianSum([mine.subtotal, mine.taxTotal]));
    // El impuesto de cabecera = Σ de las filas de impuestos que viajan.
    expect(mine.taxTotal).toBe(
      dianSum(mine.lineItems.flatMap((l) => (l.taxes ?? []).map((t) => t.tax_amount))),
    );
  });

  it('dos líneas de 10,005 + 19 %: 20,00 + 3,80 = 23,80 (el redondeo daba 20,02)', () => {
    const r = service.computePlatformInvoiceTotals({ items: CASES[2].items });
    expect(r.subtotal).toBe('20.00');
    expect(r.taxTotal).toBe('3.80');
    expect(r.payable).toBe('23.80');
  });

  it('el snapshot guarda lo que se FIRMÓ (precio despejado) y la tarifa en fracción', () => {
    const r = service.computePlatformInvoiceTotals({ items: CASES[1].items });
    expect(r.snapshotItems[0].line_total).toBe(Number(dianLineExtension(r.lineItems[0])));
    expect(r.snapshotItems[0].unit_price).toBe(Number(r.lineItems[0].unit_price));
    expect(r.snapshotItems[0].taxes[0]).toMatchObject({
      tax_type: 'IVA',
      rate: 0.19,
      is_inclusive: true,
    });
  });

  it('línea sin taxes calla su grupo; con taxes lo emite', () => {
    const r = service.computePlatformInvoiceTotals({ items: CASES[4].items });
    expect(r.lineItems.map((l) => l.omit_tax_total)).toEqual([false, true, false]);
    expect(r.hasAnyTax).toBe(true);
  });

  it('lo que el cliente mande en tax_amount / taxable_amount se IGNORA', () => {
    const honest = service.computePlatformInvoiceTotals({ items: CASES[0].items });
    const forged = service.computePlatformInvoiceTotals({
      items: [
        {
          ...CASES[0].items[0],
          taxes: [{ ...iva(), tax_amount: 1, taxable_amount: 5 }],
        },
      ],
    });
    expect(forged.taxTotal).toBe(honest.taxTotal);
  });

  it('un impuesto incluido irreducible a centavos ($17 @ 8 %) se rechaza antes de numerar', () => {
    const items: Item[] = [
      {
        description: 'Cargo',
        quantity: 1,
        unit_price: 17,
        taxes: [{ tax_type: 'INC', rate: 0.08, is_inclusive: true }],
      },
    ];
    let error: unknown;
    try {
      service.computePlatformInvoiceTotals({ items });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VendixHttpException);
  });
});

describe('Factura de plataforma — compuerta de totales previa al consecutivo (F1.2)', () => {
  function providerFor(items: Item[]) {
    const service = makeService();
    const c = service.computePlatformInvoiceTotals({ items });
    const data = (service as any).buildPlatformProviderData(
      { customer: { legal_name: 'X', tax_id: '902056589' }, items },
      'FE1',
      resolutionRow(),
      new Date(),
      '10:00:00-05:00',
      '2026-09-18',
      '2026-09-11',
      c.lineItems,
      c.subtotal,
      c.taxTotal,
      c.payable,
      0,
      c.hasAnyTax,
      'nota',
    );
    return { service: service as any, data };
  }

  it.each(CASES)('$name: el documento coherente pasa la compuerta', ({ items }) => {
    const { service, data } = providerFor(items);
    expect(() => service.assertPlatformTotalsCoherent(data)).not.toThrow();
  });

  it('un total que no es la suma de sus partes => INVOICING_VALIDATE_001', () => {
    const { service, data } = providerFor(CASES[0].items);
    data.total_amount = '1.00';
    expect(() => service.assertPlatformTotalsCoherent(data)).toThrow(
      VendixHttpException,
    );
  });

  it('createPlatformInvoice incoherente NO abre la transacción (no gasta consecutivo)', async () => {
    const transaction = jest.fn();
    const prisma = {
      withoutScope: () => ({
        invoice_resolutions: { findFirst: jest.fn().mockResolvedValue(resolutionRow()) },
      }),
      $transaction: transaction,
    };
    const service: any = makeService(prisma);
    jest.spyOn(service, 'getSettings').mockResolvedValue({
      is_enabled: true,
      platform_organization_id: 1,
      accounting_entity_id: 5,
      dian_configuration_id: 9,
      invoice_resolution_id: 77,
    });
    const real = service.computePlatformInvoiceTotals.bind(service);
    jest.spyOn(service, 'computePlatformInvoiceTotals').mockImplementation(
      (dto: any) => {
        const r = real(dto);
        return { ...r, subtotal: dianSum([r.subtotal, '1.00']) };
      },
    );

    let error: any;
    try {
      await service.createPlatformInvoice({
        customer: {
          legal_name: 'Comercializadora Andina S.A.S.',
          tax_id: '902056589',
          tax_id_dv: '9',
          email: 'facturacion@andina.co',
          document_type: '31',
          person_type: '1',
          tax_regime_code: '48',
          fiscal_responsibilities: ['O-13'],
        },
        items: CASES[0].items,
      } as CreatePlatformInvoiceDto);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(VendixHttpException);
    // Lo corta la puerta de pre-emisión (FAU02) o la compuerta de totales: lo
    // que importa es que ocurre ANTES de abrir la transacción.
    expect(transaction).not.toHaveBeenCalled();
  });
});
