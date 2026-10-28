import { getVariantStockRequirements } from './variant-stock-requirements.util';

/**
 * Las variantes son opciones vendibles, no unidades de inventario
 * (skill vendix-product-variants). Reporte del dueño: "fui a crear variantes
 * de un producto sin stock y me obligaba a setear un stock".
 * Spec: odd/tasks/price-tier-adjustments-customers.md S11.
 */
describe('getVariantStockRequirements', () => {
  const base = {
    isEditMode: false,
    originalHadVariants: false,
    baselineStock: 0,
    trackInventory: true,
    stockTransferMode: null,
    totalVariantStock: 0,
  } as const;

  const ids = (args: Parameters<typeof getVariantStockRequirements>[0]) =>
    getVariantStockRequirements(args).map((r) => r.id);

  it('crear variantes sin stock en un producto que maneja inventario no exige stock', () => {
    expect(ids({ ...base })).toEqual([]);
  });

  it('crear variantes sin stock en un producto sin inventario no exige stock', () => {
    expect(ids({ ...base, trackInventory: false })).toEqual([]);
  });

  describe('pasar de producto simple a variantes con stock base', () => {
    const transition = {
      ...base,
      isEditMode: true,
      originalHadVariants: false,
      baselineStock: 10,
    };

    it('con inventario exige redistribuir el stock base', () => {
      expect(ids({ ...transition })).toEqual(['stock-redistribute']);
      expect(ids({ ...transition, stockTransferMode: 'reset' })).toEqual([
        'stock-redistribute',
      ]);
    });

    it('con inventario exige que la suma de variantes iguale el stock base', () => {
      expect(
        ids({ ...transition, stockTransferMode: 'distribute', totalVariantStock: 7 }),
      ).toEqual(['stock-misaligned']);
      expect(
        ids({ ...transition, stockTransferMode: 'distribute', totalVariantStock: 10 }),
      ).toEqual([]);
    });

    it('sin inventario no hay stock que redistribuir', () => {
      expect(ids({ ...transition, trackInventory: false })).toEqual([]);
    });
  });

  it('un producto que ya tenía variantes no pide redistribución', () => {
    expect(
      ids({ ...base, isEditMode: true, originalHadVariants: true, baselineStock: 10 }),
    ).toEqual([]);
  });
});
