import { VendixHttpException } from 'src/common/errors';
import { RelationalActionMode } from './dto/bulk-edit-products.dto';
import { ProductsBulkEditService } from './products-bulk-edit.service';

/**
 * Regresión A.6 — impuestos del lote por modo (A.2).
 *
 * Cubre F-009/F-017/F-029: ADD conserva flags existentes, REPLACE usa el
 * mapa (parcial ⇒ 400), REMOVE prohíbe el mapa. Se ejercitan los resolvedores
 * REALES compartidos por preview/apply (`resolveBulkTaxTarget` puro y las
 * guardas por modo de `resolveBulkTaxContext`), sin DB.
 */
describe('bulk tax_category_action — semántica por modo (F-017/F-029)', () => {
  const targetOf = (
    mode: RelationalActionMode,
    ids: number[],
    normalizedMap: Map<number, boolean> | undefined,
    current: [number, boolean][],
    catalogDefault: (cid: number) => boolean = () => false,
  ) =>
    (
      ProductsBulkEditService.prototype as any
    ).resolveBulkTaxTarget.call(
      {},
      { mode, ids },
      normalizedMap,
      new Map(current),
      catalogDefault,
    );

  describe('ADD — las ya asignadas CONSERVAN su flag (F-009)', () => {
    it('existente true + mapa false ⇒ conserva true; nueva resuelve mapa ?? catálogo', () => {
      const out = targetOf(
        RelationalActionMode.ADD,
        [19, 8],
        new Map([[19, false]]),
        [[19, true]],
        () => false,
      );
      expect(out.targetIds).toEqual(expect.arrayContaining([19, 8]));
      expect(out.nextFlags.get(19)).toBe(true); // conserva, sin reversión
      expect(out.nextFlags.get(8)).toBe(false); // nueva: mapa ausente ⇒ catálogo
    });

    it('nueva con entrada en el mapa toma el mapa', () => {
      const out = targetOf(
        RelationalActionMode.ADD,
        [8],
        new Map([[8, true]]),
        [],
        () => false,
      );
      expect(out.nextFlags.get(8)).toBe(true);
    });
  });

  describe('REPLACE — el conjunto es ids y cada flag es mapa ?? catálogo', () => {
    it('reemplaza conjunto y flags desde el mapa completo', () => {
      const out = targetOf(
        RelationalActionMode.REPLACE,
        [19, 8],
        new Map([
          [19, true],
          [8, false],
        ]),
        [[19, false]],
        () => false,
      );
      expect(out.targetIds).toEqual([19, 8]);
      expect(out.nextFlags.get(19)).toBe(true);
      expect(out.nextFlags.get(8)).toBe(false);
    });

    it('sin mapa todo hereda el catálogo', () => {
      const out = targetOf(RelationalActionMode.REPLACE, [8], undefined, [], () => true);
      expect(out.nextFlags.get(8)).toBe(true);
    });
  });

  describe('REMOVE — el conjunto excluye ids; el resto conserva su flag', () => {
    it('quita las pedidas y preserva las demás', () => {
      const out = targetOf(
        RelationalActionMode.REMOVE,
        [19],
        undefined,
        [
          [19, true],
          [8, false],
        ],
        () => false,
      );
      expect(out.targetIds).toEqual([8]);
      expect(out.nextFlags.get(8)).toBe(false);
    });
  });

  describe('guardas por modo (400 PROD_TAXMAP_001, nunca 500)', () => {
    const contextOf = (action: unknown, prisma?: unknown) =>
      (ProductsBulkEditService.prototype as any).resolveBulkTaxContext.call({
        prisma: prisma ?? {
          tax_categories: { findMany: jest.fn().mockResolvedValue([]) },
        },
      }, action);

    it('REMOVE con mapa (incluso {}) ⇒ 400', async () => {
      await expect(
        contextOf({ mode: RelationalActionMode.REMOVE, ids: [19], tax_inclusive_map: {} }),
      ).rejects.toMatchObject({ errorCode: 'PROD_TAXMAP_001' });
      await expect(
        contextOf({
          mode: RelationalActionMode.REMOVE,
          ids: [19],
          tax_inclusive_map: { '19': true },
        }),
      ).rejects.toBeInstanceOf(VendixHttpException);
    });

    it('REPLACE con mapa parcial ⇒ 400 con missing_ids', async () => {
      const err = await contextOf({
        mode: RelationalActionMode.REPLACE,
        ids: [19, 8],
        tax_inclusive_map: { '19': true },
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(VendixHttpException);
      expect((err as VendixHttpException).errorCode).toBe('PROD_TAXMAP_001');
    });

    it('REPLACE con mapa completo y catálogo con scope pasa el contexto', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: 19, name: 'IVA', is_inclusive: false, tax_rates: [] },
        { id: 8, name: 'INC', is_inclusive: true, tax_rates: [] },
      ]);
      const out = await contextOf(
        {
          mode: RelationalActionMode.REPLACE,
          ids: [19, 8],
          tax_inclusive_map: { '19': false, '8': true },
        },
        { tax_categories: { findMany } },
      );
      expect(out.normalizedMap.get(19)).toBe(false);
      expect(out.normalizedMap.get(8)).toBe(true);
      expect(out.catalogById.get(8)).toMatchObject({ catalogDefault: true });
      // Scope tienda como el create unitario: globales o de la tienda.
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [19, 8] } }),
        }),
      );
    });
  });
});
