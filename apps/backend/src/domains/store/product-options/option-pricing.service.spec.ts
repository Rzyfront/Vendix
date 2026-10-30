import { Prisma } from '@prisma/client';
import { OptionPricingService, resolveOptionSelection } from './option-pricing.service';
import { ProductOptionsService } from './product-options.service';

type Group = Parameters<typeof resolveOptionSelection>[0][number];

function option(id: number, name: string, price: number, quantity = 1): Group['options'][number] {
  return {
    id,
    name,
    price_delta: new Prisma.Decimal(price),
    component_type: 'ingredient',
    component_product_id: 100 + id,
    component_variant_id: null,
    quantity: new Prisma.Decimal(quantity),
    uom: 'g',
  };
}

const frutas: Group = {
  id: 1,
  name: 'Frutas',
  min_select: 0,
  max_select: 2,
  is_required: false,
  scope: 'per_unit',
  options: [option(11, 'Fresas', 5000, 80), option(12, 'Durazno', 4000, 60), option(13, 'Mora', 3000, 50)],
};
const cubierta: Group = {
  id: 2,
  name: 'Cubierta',
  min_select: 1,
  max_select: 1,
  is_required: true,
  scope: 'per_unit',
  options: [option(21, 'Chantilly', 0, 150), option(22, 'Ganache', 6000, 150)],
};
const velas: Group = {
  id: 3,
  name: 'Velas',
  min_select: 0,
  max_select: 1,
  is_required: false,
  scope: 'per_line',
  options: [option(31, 'Vela número', 3000)],
};

describe('resolveOptionSelection', () => {
  it('suma el delta por unidad y congela el snapshot (Fresas + Ganache = +11.000)', () => {
    const result = resolveOptionSelection([frutas, cubierta], [11, 22], 1);
    expect(result.unit_price_delta.toFixed(2)).toBe('11000.00');
    expect(result.snapshots).toEqual([
      expect.objectContaining({ option_id: 11, group_name: 'Frutas', option_name: 'Fresas', scope: 'per_unit' }),
      expect.objectContaining({ option_id: 22, group_name: 'Cubierta', option_name: 'Ganache' }),
    ]);
    expect(result.snapshots[0].quantity.toNumber()).toBe(80);
  });

  it('rechaza un grupo obligatorio sin elegir con el mensaje del selector', () => {
    expect(() => resolveOptionSelection([frutas, cubierta], [11], 1)).toThrow('Elige 1 opción en Cubierta');
  });

  it('rechaza pasar el máximo del grupo', () => {
    expect(() => resolveOptionSelection([frutas, cubierta], [11, 12, 13, 21], 1)).toThrow(
      'Puedes elegir máximo 2 en Frutas',
    );
  });

  it('rechaza ids ajenos al producto y repetidos', () => {
    expect(() => resolveOptionSelection([cubierta], [21, 999], 1)).toThrow(
      'Una de las adiciones elegidas no está disponible para este producto.',
    );
    expect(() => resolveOptionSelection([cubierta], [21, 21], 1)).toThrow('Una adición está repetida.');
  });

  it('per_line reparte su precio en el unitario; per_unit no depende de la cantidad', () => {
    const result = resolveOptionSelection([cubierta, velas], [22, 31], 2);
    // 6000 por unidad + 3000 / 2 unidades.
    expect(result.unit_price_delta.toFixed(2)).toBe('7500.00');
    expect(result.snapshots.find((s) => s.option_id === 31)?.scope).toBe('per_line');
  });

  it('per_line que no divide exacto redondea al centavo hacia arriba: la línea nunca cobra menos', () => {
    const torta: Group = { ...velas, options: [option(31, 'Topper', 10000)] };
    const result = resolveOptionSelection([torta], [31], 3);
    // 10000 / 3 = 3333.33… → 3333.34; × 3 = 10000.02, nunca 9999.99.
    expect(result.unit_price_delta.toFixed(2)).toBe('3333.34');
    expect(result.unit_price_delta.mul(3).gte(10000)).toBe(true);
  });

  it('el delta sale del servidor: el precio de la opción en base manda, no el cliente', () => {
    const caro: Group = { ...cubierta, options: [option(22, 'Ganache', 9000, 150)] };
    expect(resolveOptionSelection([caro], [22], 1).unit_price_delta.toFixed(2)).toBe('9000.00');
  });
});

describe('OptionPricingService.resolve', () => {
  function build(enabled: boolean, groups: Group[]) {
    const productOptions = {
      isEnabled: jest.fn().mockResolvedValue(enabled),
      applicableForProduct: jest.fn().mockResolvedValue(groups),
    } as unknown as ProductOptionsService;
    return new OptionPricingService(productOptions);
  }

  it('sin ids y sin grupos deja la línea como hoy', async () => {
    const result = await build(true, []).resolve(1, 5, undefined, 1, { scheduled: true });
    expect(result.unit_price_delta.toNumber()).toBe(0);
    expect(result.snapshots).toEqual([]);
  });

  it('con el ajuste apagado ignora la línea sin ids y rechaza ids enviados', async () => {
    const service = build(false, [cubierta]);
    expect((await service.resolve(1, 5, undefined, 1, { scheduled: true })).snapshots).toEqual([]);
    await expect(service.resolve(1, 5, [21], 1, { scheduled: true })).rejects.toThrow();
  });

  it('en una venta sin pedido programado rechaza adiciones: no habría quién las descuente', async () => {
    await expect(build(true, [frutas]).resolve(1, 5, [11], 1, { scheduled: false })).rejects.toMatchObject({
      errorCode: 'OPT_REQUIRES_SCHEDULE',
    });
  });

  it('en una venta sin pedido programado y sin ids vende el producto solo, aun con grupo obligatorio', async () => {
    const result = await build(true, [cubierta]).resolve(1, 5, [], 1, { scheduled: false });
    expect(result.unit_price_delta.toNumber()).toBe(0);
    expect(result.snapshots).toEqual([]);
  });

  it('un borrador sin agendamiento guarda las adiciones elegidas (se agenda al cobrarlo)', async () => {
    const result = await build(true, [frutas]).resolve(1, 5, [11], 1, { scheduled: false, draft: true });
    expect(result.snapshots.map((x) => x.option_id)).toEqual([11]);
  });

  it('un borrador sin agendamiento y sin ids no exige el grupo obligatorio, igual que hoy', async () => {
    const result = await build(true, [cubierta]).resolve(1, 5, [], 1, { scheduled: false, draft: true });
    expect(result.snapshots).toEqual([]);
  });

  it('con grupo obligatorio y sin ids rechaza la venta', async () => {
    await expect(build(true, [cubierta]).resolve(1, 5, [], 1, { scheduled: true })).rejects.toThrow('Elige 1 opción en Cubierta');
  });
});
