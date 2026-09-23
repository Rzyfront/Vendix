import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

/**
 * `resolvePosShippingInc` — la proyección del INC del domicilio para el
 * asiento de la venta POS sin factura / a crédito. Misma definición que
 * `createFromOrder` (`shipping-inc.util`); acá se fija el cableado: qué lee,
 * cuándo NO lee nada (tiendas IVA idénticas) y que un fallo de lectura no
 * tumba la venta.
 */
describe('PaymentsService.resolvePosShippingInc', () => {
  const money = (v: number | string) => new Prisma.Decimal(v);
  const incLine = {
    total_price: money(50000),
    order_item_taxes: [
      {
        tax_type: 'inc',
        tax_amount: money(4000),
        tax_rate: money('0.08'),
        tax_rate_id: 68,
        tax_name: 'INC',
      },
    ],
  };
  const ivaLine = {
    total_price: money(50000),
    order_item_taxes: [
      {
        tax_type: 'iva',
        tax_amount: money(9500),
        tax_rate: money('0.19'),
        tax_rate_id: 1,
        tax_name: 'IVA',
      },
    ],
  };

  const build = (opts: {
    industries?: string[];
    responsibilities?: string[];
    fiscalThrows?: boolean;
  }) => {
    const service = Object.create(PaymentsService.prototype) as any;
    service.logger = { warn: jest.fn(), log: jest.fn() };
    service.settingsService = {
      getFiscalData: jest.fn(async () => {
        if (opts.fiscalThrows) throw new Error('no context');
        return { tax_responsibilities: opts.responsibilities ?? [] };
      }),
    };
    const tx = {
      stores: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ industries: opts.industries ?? ['retail'] }),
      },
    };
    const run = (shipping_cost: number, items: any[]) =>
      service.resolvePosShippingInc(tx, { id: 1, shipping_cost: money(shipping_cost) }, 105, items);
    return { service, tx, run };
  };

  it('restaurante O-33 con líneas INC: base 13.888,89 + INC 1.111,11 del domicilio de 15.000', async () => {
    const { run } = build({ industries: ['restaurant'], responsibilities: ['O-33'] });
    const result = await run(15000, [incLine]);
    expect(result).toMatchObject({
      applies: true,
      base: 13888.89,
      inc_amount: 1111.11,
      rate_fraction: 0.08,
    });
  });

  it('tienda IVA (sin líneas INC): no consulta nada y no aplica', async () => {
    const { run, tx, service } = build({ industries: ['restaurant'], responsibilities: ['O-48', 'O-33'] });
    const result = await run(15000, [ivaLine]);
    expect(result.applies).toBe(false);
    expect(tx.stores.findUnique).not.toHaveBeenCalled();
    expect(service.settingsService.getFiscalData).not.toHaveBeenCalled();
  });

  it('sin envío: no consulta nada y no aplica', async () => {
    const { run, tx } = build({ industries: ['restaurant'], responsibilities: ['O-33'] });
    expect((await run(0, [incLine])).applies).toBe(false);
    expect(tx.stores.findUnique).not.toHaveBeenCalled();
  });

  it('no restaurante: no lee fiscal_data y no aplica', async () => {
    const { run, service } = build({ industries: ['retail'], responsibilities: ['O-33'] });
    expect((await run(15000, [incLine])).applies).toBe(false);
    expect(service.settingsService.getFiscalData).not.toHaveBeenCalled();
  });

  it('emisor sin O-33: no aplica', async () => {
    const { run } = build({ industries: ['restaurant'], responsibilities: ['O-48'] });
    expect((await run(15000, [incLine])).applies).toBe(false);
  });

  it('fallo al leer fiscal_data: degrada a «no aplica» con warn, sin lanzar', async () => {
    const { run, service } = build({ industries: ['restaurant'], fiscalThrows: true });
    await expect(run(15000, [incLine])).resolves.toMatchObject({ applies: false });
    expect(service.logger.warn).toHaveBeenCalled();
  });
});
