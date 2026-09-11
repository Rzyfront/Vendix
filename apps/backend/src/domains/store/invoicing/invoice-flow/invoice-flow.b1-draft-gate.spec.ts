import { Prisma } from '@prisma/client';
import {
  isOrphanedDraftTaxes,
  judgeDraftLineSnapshot,
} from './invoice-flow.service';

/**
 * B.1 (F-023/F-027) — puerta aritmética pre-numeración del borrador:
 * huérfano sin filas de impuesto y pre-fix con residuo se detectan en
 * lectura, antes de tomar consecutivo.
 *
 * Archivo NUEVO: prueba los helpers puros exportados, sin levantar Nest.
 */
describe('invoice-flow · puerta aritmética del borrador (B.1)', () => {
  const dec = (value: number | string): Prisma.Decimal =>
    new Prisma.Decimal(value);

  const taxRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    invoice_item_id: null,
    tax_rate_id: 7,
    tax_name: 'INC 8%',
    tax_rate: 8,
    tax_type: 'inc',
    is_inclusive: true,
    ...overrides,
  });

  const line = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: 1,
    quantity: 1,
    unit_price: 3000,
    discount_amount: 0,
    tax_amount: 222.22,
    total_amount: 3000,
    is_inclusive: true,
    price_unit_quantity: null,
    aiu_component: null,
    description: 'Plato',
    ...overrides,
  });

  describe('isOrphanedDraftTaxes (F-023)', () => {
    it('líneas + impuesto en cabecera + cero filas ⇒ huérfano', () => {
      expect(isOrphanedDraftTaxes([{}], [], dec(222.22))).toBe(true);
    });

    it('cabecera en cero ⇒ no huérfano (exenta)', () => {
      expect(isOrphanedDraftTaxes([{}], [], dec(0))).toBe(false);
    });

    it('con filas ⇒ no huérfano', () => {
      expect(isOrphanedDraftTaxes([{}], [{}], dec(222.22))).toBe(false);
    });

    it('sin líneas ⇒ no huérfano', () => {
      expect(isOrphanedDraftTaxes([], [], dec(222.22))).toBe(false);
    });
  });

  describe('judgeDraftLineSnapshot (F-027)', () => {
    it('post-fix $3.000/INC 8% (2777.78 + 222.22) ⇒ ok', () => {
      expect(judgeDraftLineSnapshot(line(), [taxRow()])).toEqual({
        kind: 'ok',
      });
    });

    it('pre-fix $3.000/INC 8% (2777.77 + 222.22 = 2999.99) ⇒ pre_fix_residual', () => {
      const judgment = judgeDraftLineSnapshot(
        line({ tax_amount: 222.22, total_amount: 2999.99 }),
        [taxRow()],
      );
      expect(judgment.kind).toBe('pre_fix_residual');
      if (judgment.kind === 'pre_fix_residual') {
        expect(judgment.kernel_base.toString()).toBe('2777.78');
        expect(judgment.snapshot_base.toString()).toBe('2777.77');
      }
    });

    it('bruto inalcanzable ($17/INC 8%) ⇒ unclosed_residual', () => {
      const judgment = judgeDraftLineSnapshot(
        line({
          unit_price: 17,
          tax_amount: 1.25,
          total_amount: 16.99,
          description: 'Inalcanzable',
        }),
        [taxRow()],
      );
      expect(judgment.kind).toBe('unclosed_residual');
    });

    it('línea exclusiva ⇒ skip (byte-idéntica antes/después del fix)', () => {
      expect(
        judgeDraftLineSnapshot(
          line({ is_inclusive: false, tax_amount: 570, total_amount: 3570 }),
          [taxRow({ tax_type: 'iva', tax_rate: 19, is_inclusive: false })],
        ).kind,
      ).toBe('skip');
    });

    it('línea AIU ⇒ skip (su base la fija el régimen)', () => {
      expect(
        judgeDraftLineSnapshot(line({ aiu_component: 'administracion' }), [
          taxRow(),
        ]).kind,
      ).toBe('skip');
    });

    it('desglose por línea usa sólo sus filas (invoice_item_id)', () => {
      const judgment = judgeDraftLineSnapshot(line({ id: 9 }), [
        taxRow({ invoice_item_id: 4 }),
        taxRow({ invoice_item_id: 9 }),
      ]);
      expect(judgment.kind).toBe('ok');
    });

    it('línea sin filas propias ni de cabecera ⇒ skip', () => {
      expect(
        judgeDraftLineSnapshot(line(), [
          taxRow({ invoice_item_id: 4 }),
        ]).kind,
      ).toBe('skip');
    });
  });
});
