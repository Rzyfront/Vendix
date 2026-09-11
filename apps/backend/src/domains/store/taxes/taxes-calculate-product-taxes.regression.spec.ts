import { TaxesService } from './taxes.service';
import { resolveLineTotals as resolveLineTotalsPure } from './utils/tax-inclusive-math.util';

/**
 * Regresión A.6 — contrato por-tasa de `calculateProductTaxes` (A.3).
 *
 * Cubre F-002/F-011/F-012/F-016: una fila por tasa con su flag, verdad por
 * asignación (`asignación ?? tasa`), despeje sobre el precio FINAL y tasa
 * ausente ⇒ 0 sin lanzar. Cifras a mano, no derivadas del SUT.
 *
 * El servicio se ejercita con `options.client` en memoria: sin DB, sin mocks
 * de Prisma más allá del `findMany` que el propio contrato declara.
 */
describe('TaxesService.calculateProductTaxes — contrato por-tasa (A.3)', () => {
  const buildService = () => new TaxesService({} as any, {} as any);

  const assignmentRow = (overrides: {
    assignmentInclusive?: boolean | null;
    taxType?: string | null;
    rates: { id: number; name: string; rate: number; inclusive?: boolean | null }[];
  }) => ({
    is_inclusive: overrides.assignmentInclusive ?? null,
    tax_categories: {
      tax_type: overrides.taxType ?? 'iva',
      tax_rates: overrides.rates.map((r) => ({
        id: r.id,
        name: r.name,
        rate: r.rate,
        is_inclusive: r.inclusive ?? null,
      })),
    },
  });

  const clientWith = (rows: unknown[]) => ({
    product_tax_assignments: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('emite UNA fila por tasa con flag, base y cuota propios (F-002)', async () => {
    // Mixto: INC 8% dentro + IVA 19% fuera sobre precio final 100000.
    // B = trunc(100000/1.08) = 92592.59; INC = 7407.40; IVA = 17592.59.
    const service = buildService();
    const out = await service.calculateProductTaxes(7, 100000, {
      client: clientWith([
        assignmentRow({
          assignmentInclusive: true,
          taxType: 'inc',
          rates: [{ id: 1, name: 'INC', rate: 0.08, inclusive: false }],
        }),
        assignmentRow({
          assignmentInclusive: false,
          taxType: 'iva',
          rates: [{ id: 2, name: 'IVA', rate: 0.19, inclusive: false }],
        }),
      ]) as any,
    });

    expect(out.taxes).toHaveLength(2);
    // A.2/ADR-01 («caso del bug»): la base absorbe +1¢ (92592.60); cuotas y
    // total idénticos (7407.40/17592.59/117592.59).
    expect(out.taxes[0]).toMatchObject({
      tax_rate_id: 1,
      name: 'INC',
      rate: 0.08,
      tax_type: 'inc',
      is_inclusive: true,
      base: 92592.6,
      amount: 7407.4,
    });
    expect(out.taxes[1]).toMatchObject({
      tax_rate_id: 2,
      name: 'IVA',
      rate: 0.19,
      tax_type: 'iva',
      is_inclusive: false,
      base: 92592.6,
      amount: 17592.59,
    });
    expect(out.base).toBe(92592.6);
    // El total solo crece con lo agregado (F-001).
    expect(out.total).toBe(117592.59);
  });

  it('precedencia: asignación ?? tasa ?? false (F-012)', async () => {
    const service = buildService();
    const out = await service.calculateProductTaxes(7, 119000, {
      client: clientWith([
        // La asignación gana aunque la tasa diga lo contrario.
        assignmentRow({
          assignmentInclusive: true,
          rates: [{ id: 1, name: 'A', rate: 0.19, inclusive: false }],
        }),
        // Sin asignación manda la tasa.
        assignmentRow({
          assignmentInclusive: null,
          rates: [{ id: 2, name: 'B', rate: 0.08, inclusive: true }],
        }),
        // Sin verdad en ningún nivel ⇒ agregado (default histórico).
        assignmentRow({
          assignmentInclusive: null,
          rates: [{ id: 3, name: 'C', rate: 0.05, inclusive: null }],
        }),
      ]) as any,
    });

    expect(out.taxes.map((t) => t.is_inclusive)).toEqual([true, true, false]);
  });

  it('tax_type ausente ⇒ iva (default del dominio)', async () => {
    const service = buildService();
    const out = await service.calculateProductTaxes(7, 100000, {
      client: clientWith([
        assignmentRow({
          taxType: null,
          rates: [{ id: 1, name: 'X', rate: 0.19 }],
        }),
      ]) as any,
    });
    expect(out.taxes[0].tax_type).toBe('iva');
  });

  it('tasa ausente/0/negativa ⇒ rate 0 y cuota 0, sin lanzar (ERR-03)', async () => {
    const service = buildService();
    const out = await service.calculateProductTaxes(7, 50000, {
      client: clientWith([
        assignmentRow({
          rates: [
            { id: 1, name: 'Cero', rate: 0 },
            { id: 2, name: 'Neg', rate: -0.19 },
          ],
        }),
      ]) as any,
    });
    expect(out.taxes.map((t) => t.rate)).toEqual([0, 0]);
    expect(out.taxes.map((t) => t.amount)).toEqual([0, 0]);
    expect(out.total).toBe(50000);
  });

  it('despeja sobre el precio FINAL resuelto, nunca sobre base cruda (F-011)', async () => {
    // Precio de oferta 95000 con IVA dentro: B0 = trunc(95000/1.19)
    // = trunc(79831.9327…) = 79831.93; f(B0) = 94999.99 < bruto ⇒ +1¢
    // (A.2/ADR-01, «caso del bug»): base final 79831.94.
    // Cuota = trunc(79831.94 × 0.19) = trunc(15168.0686) = 15168.06
    // (idéntica); total 95000 (idéntico).
    const service = buildService();
    const out = await service.calculateProductTaxes(7, 95000, {
      client: clientWith([
        assignmentRow({
          assignmentInclusive: true,
          rates: [{ id: 1, name: 'IVA', rate: 0.19 }],
        }),
      ]) as any,
    });
    expect(out.base).toBe(79831.94);
    expect(out.taxes[0].amount).toBe(15168.06);
    expect(out.total).toBe(95000);
  });

  it('resolveLineTotals es el dueño único: delega en la función pura (F-003)', () => {
    const service = buildService();
    const rates = [
      { rate: 0.08, is_inclusive: true },
      { rate: 0.19, is_inclusive: false },
    ];
    expect(service.resolveLineTotals(100000, rates)).toEqual(
      resolveLineTotalsPure(100000, rates),
    );
  });

  it('con store_id repone el filtro de tenant sobre el tx (contrato de pool)', async () => {
    const service = buildService();
    const findMany = jest.fn().mockResolvedValue([]);
    await service.calculateProductTaxes(7, 1000, {
      client: { product_tax_assignments: { findMany } } as any,
      store_id: 42,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          product_id: 7,
          products: { store_id: 42 },
        }),
      }),
    );
  });
});
