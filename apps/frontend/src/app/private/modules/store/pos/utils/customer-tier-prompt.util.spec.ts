import { CartItem } from '../models/cart.model';
import { customerTierPrompt, followUpRestorePrompt } from './customer-tier-prompt.util';

/**
 * Aviso de la tarifa preferencial al elegir o quitar cliente en el POS.
 * Spec: odd/tasks/price-tier-adjustments-customers.md S6, S8.
 */
describe('customerTierPrompt', () => {
  const line = (id: string, over: Partial<CartItem> = {}, enabled = [7]): CartItem =>
    ({
      id,
      quantity: 1,
      itemType: 'product',
      applied_price_tier_id: null,
      product: {
        id: Number(id.replace(/\D/g, '')) || 1,
        name: `Producto ${id}`,
        enabled_price_tier_ids: enabled,
        has_multiple_price_tiers: true,
      },
      ...over,
    }) as unknown as CartItem;

  const mayorista = { id: 7, name: 'Mayorista' };
  const distribuidor = { id: 8, name: 'Distribuidor' };

  it('cliente nuevo con tarifa: ofrece solo las líneas cuyo producto la habilita', () => {
    const prompt = customerTierPrompt({
      items: [line('a1'), line('b2', {}, [9]), line('c3', { itemType: 'custom' })],
      previousTier: null,
      nextTier: mayorista,
      canApplyTier: true,
    });
    expect(prompt).toEqual({
      mode: 'apply',
      tier: mayorista,
      lines: [{ itemId: 'a1', label: 'Producto a1' }],
    });
  });

  it('un producto sin multi-tarifa activa no se ofrece aunque tenga la tarifa habilitada', () => {
    const sinMultiTarifa = line('a1');
    sinMultiTarifa.product = { ...sinMultiTarifa.product, has_multiple_price_tiers: false };
    expect(
      customerTierPrompt({
        items: [sinMultiTarifa],
        previousTier: null,
        nextTier: mayorista,
        canApplyTier: true,
      }),
    ).toBeNull();
  });

  it('las líneas pesadas o que ya tienen la tarifa no se ofrecen; sin líneas no hay aviso', () => {
    expect(
      customerTierPrompt({
        items: [
          line('a1', { is_weight_product: true }),
          line('b2', { captured_by_scale: true }),
          line('c3', { applied_price_tier_id: 7 }),
        ],
        previousTier: null,
        nextTier: mayorista,
        canApplyTier: true,
      }),
    ).toBeNull();
  });

  it('sin permiso para aplicar tarifas no hay aviso', () => {
    expect(
      customerTierPrompt({
        items: [line('a1')],
        previousTier: null,
        nextTier: mayorista,
        canApplyTier: false,
      }),
    ).toBeNull();
  });

  it('quitar un cliente que tenía tarifa pregunta si restaurar las líneas con esa tarifa', () => {
    expect(
      customerTierPrompt({
        items: [line('a1', { applied_price_tier_id: 7 }), line('b2')],
        previousTier: mayorista,
        nextTier: null,
        canApplyTier: true,
      }),
    ).toEqual({
      mode: 'restore',
      tier: mayorista,
      lines: [{ itemId: 'a1', label: 'Producto a1' }],
    });
  });

  it('clientes sin tarifa a ambos lados: sin aviso', () => {
    expect(
      customerTierPrompt({
        items: [line('a1')],
        previousTier: null,
        nextTier: null,
        canApplyTier: true,
      }),
    ).toBeNull();
  });

  it('cambiar a un cliente con otra tarifa ofrece la nueva; si no aplica a ninguna línea, restaura la anterior', () => {
    expect(
      customerTierPrompt({
        items: [line('a1', { applied_price_tier_id: 7 }, [7, 8])],
        previousTier: mayorista,
        nextTier: distribuidor,
        canApplyTier: true,
      })?.mode,
    ).toBe('apply');
    expect(
      customerTierPrompt({
        items: [line('a1', { applied_price_tier_id: 7 }, [7])],
        previousTier: mayorista,
        nextTier: distribuidor,
        canApplyTier: true,
      }),
    ).toEqual({
      mode: 'restore',
      tier: mayorista,
      lines: [{ itemId: 'a1', label: 'Producto a1' }],
    });
  });

  it('cambiar a un cliente con otra tarifa guarda las líneas de la anterior para preguntar después', () => {
    const prompt = customerTierPrompt({
      items: [
        line('a1', { applied_price_tier_id: 7 }, [7, 8]),
        line('b2', { applied_price_tier_id: 7 }, [7]),
        line('c3', {}, [7, 8]),
      ],
      previousTier: mayorista,
      nextTier: distribuidor,
      canApplyTier: true,
    });
    expect(prompt).toEqual({
      mode: 'apply',
      tier: distribuidor,
      lines: [
        { itemId: 'a1', label: 'Producto a1' },
        { itemId: 'c3', label: 'Producto c3' },
      ],
      restoreAfter: {
        tier: mayorista,
        lines: [
          { itemId: 'a1', label: 'Producto a1' },
          { itemId: 'b2', label: 'Producto b2' },
        ],
      },
    });
  });

  it('tras aplicar la nueva tarifa pregunta restaurar las líneas que siguen con la anterior', () => {
    const prompt = customerTierPrompt({
      items: [
        line('a1', { applied_price_tier_id: 7 }, [7, 8]),
        line('b2', { applied_price_tier_id: 7 }, [7]),
      ],
      previousTier: mayorista,
      nextTier: distribuidor,
      canApplyTier: true,
    });
    expect(followUpRestorePrompt(prompt, ['a1'])).toEqual({
      mode: 'restore',
      tier: mayorista,
      lines: [{ itemId: 'b2', label: 'Producto b2' }],
    });
    // "No aplicar": todas las líneas de la tarifa anterior.
    expect(followUpRestorePrompt(prompt, [])?.lines.map((l) => l.itemId)).toEqual([
      'a1',
      'b2',
    ]);
    expect(followUpRestorePrompt(prompt, ['a1', 'b2'])).toBeNull();
  });

  it('sin tarifa anterior pendiente no hay segundo aviso', () => {
    const prompt = customerTierPrompt({
      items: [line('a1')],
      previousTier: null,
      nextTier: mayorista,
      canApplyTier: true,
    });
    expect(followUpRestorePrompt(prompt, [])).toBeNull();
    expect(followUpRestorePrompt(null, [])).toBeNull();
  });

  it('la etiqueta de la línea lleva la variante cuando existe', () => {
    expect(
      customerTierPrompt({
        items: [line('a1', { variant_display_name: 'Rojo / M' })],
        previousTier: null,
        nextTier: mayorista,
        canApplyTier: true,
      })?.lines[0].label,
    ).toBe('Producto a1 · Rojo / M');
  });
});
