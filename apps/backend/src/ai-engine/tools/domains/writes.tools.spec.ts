import {
  createCustomerWriteTools,
  createInventoryWriteTools,
} from './writes.tools';

/**
 * Spec de contrato (alcance: upsert_customer, fix F1 del review PR #874).
 *
 * `writes.tools.ts` es legacy sin spec completa (gap pre-existente, no de este
 * PR): este archivo pinnea únicamente la rama JURIDICA del alta —razón social
 * en vez de nombres, según JuridicaNameRule— y la regresión NATURAL. La
 * cobertura total de writes queda como follow-up.
 */
describe('writes.tools · upsert_customer JURIDICA (F1)', () => {
  const customersService = {
    findOrganizationIdByStoreForAgent: jest.fn(async () => 6),
    findUserByEmailInOrganizationForAgent: jest.fn(async () => null),
    findByDocumentInOrganization: jest.fn(async () => null),
    findOne: jest.fn(async () => null),
  } as any;

  const [tool] = createCustomerWriteTools({ customersService });
  const ctx = { store_id: 10, organization_id: 6 } as any;

  beforeEach(() => jest.clearAllMocks());

  it('crea empresa con solo legal_name (preview propone, target = razón social)', async () => {
    const preview = await tool.preview!(
      { person_type: 'JURIDICA', legal_name: 'Acerías S.A.S.' },
      ctx,
    );
    // warning (no ok) porque va sin documento: por diseño, igual que NATURAL.
    expect(preview.status).toBe('warning');
    expect(preview.target).toBe('Acerías S.A.S.');
    expect(preview.changes.map((c) => c.field)).toContain('legal_name');
    expect(preview.changes.map((c) => c.label)).toContain('Razón social');
  });

  it('JURIDICA sin legal_name falla con guía accionable (sin dead-end)', async () => {
    const preview = await tool.preview!({ person_type: 'JURIDICA' }, ctx);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('razón social');
    expect(preview.message).toContain('legal_name');
  });

  it('JURIDICA con first_name falla: uno u otro, nunca ambos', async () => {
    const preview = await tool.preview!(
      {
        person_type: 'JURIDICA',
        legal_name: 'Acerías S.A.S.',
        first_name: 'Juan',
      },
      ctx,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('solo con razón social');
  });

  it('NATURAL con nombres sigue creando (regresión)', async () => {
    const preview = await tool.preview!(
      { first_name: 'Juan', last_name: 'Pérez' },
      ctx,
    );
    expect(preview.status).toBe('warning');
    expect(preview.target).toBe('Juan Pérez');
  });

  it('NATURAL sin nombres sigue fallando con guía (regresión)', async () => {
    const preview = await tool.preview!({ first_name: 'Juan' }, ctx);
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('nombres y los apellidos');
  });
});

describe('writes.tools · adjust_stock pre-verificación guiada del conteo', () => {
  const PRODUCT = {
    id: 9,
    name: 'Café molido',
    sku: 'CAF-1',
    state: 'active',
    track_inventory: true,
    product_variants: [],
  };
  const LEVEL = {
    location_id: 4,
    quantity_on_hand: 20,
    quantity_reserved: 0,
    inventory_locations: { name: 'Bodega central' },
  };

  function build() {
    const adjustmentsService = {
      findProductForStockAdjustmentForAgent: jest.fn(async () => PRODUCT),
      findStockLevelsForAdjustmentForAgent: jest.fn(async () => [LEVEL]),
      createAdjustment: jest.fn(async (dto: any) => ({
        id: 77,
        product_id: dto.product_id,
        product_variant_id: null,
        location_id: dto.location_id,
        adjustment_type: dto.type,
        quantity_before: 20,
        quantity_after: dto.quantity_after,
        quantity_change: dto.quantity_after - 20,
      })),
    } as any;
    const [tool] = createInventoryWriteTools({ adjustmentsService });
    return { tool, adjustmentsService };
  }

  const ctx = { store_id: 10, organization_id: 6, user_id: 3 } as any;

  it('conteo con diferencia: preview en error con la señal y handler no ajusta', async () => {
    const { tool, adjustmentsService } = build();
    const args = {
      product_id: 9,
      quantity_after: 17,
      adjustment_type: 'count_variance',
    };
    const preview = await tool.preview!(args, ctx);
    expect(preview.status).toBe('error');
    expect(preview.discrepancy).toEqual(
      expect.objectContaining({
        process: 'inventory_count',
        unit: 'unidades',
        expected: 20,
        actual: 17,
        difference: -3,
        direction: 'shortage',
        tolerance: 0,
      }),
    );
    expect(preview.discrepancy!.reads_to_run).toEqual([
      'get_stock_movements',
      'get_stock_levels',
      'list_purchase_orders',
      'list_orders',
    ]);
    const out = JSON.parse(await tool.handler!(args, ctx));
    expect(out.discrepancy.direction).toBe('shortage');
    expect(adjustmentsService.createAdjustment).not.toHaveBeenCalled();
  });

  it('sin tipo (corrección manual por defecto) también se guía; sobrante = surplus', async () => {
    const { tool } = build();
    const preview = await tool.preview!(
      { product_id: 9, quantity_after: 25 },
      ctx,
    );
    expect(preview.status).toBe('error');
    expect(preview.discrepancy!.direction).toBe('surplus');
  });

  it('avería no dispara la compuerta: la persona ya dio el motivo', async () => {
    const { tool, adjustmentsService } = build();
    const args = { product_id: 9, quantity_after: 17, adjustment_type: 'damage' };
    const preview = await tool.preview!(args, ctx);
    expect(preview.status).toBe('warning');
    expect(preview.discrepancy).toBeUndefined();
    await tool.handler!(args, ctx);
    expect(adjustmentsService.createAdjustment).toHaveBeenCalled();
  });

  it('revisada sin motivo: pide el motivo', async () => {
    const { tool } = build();
    const preview = await tool.preview!(
      {
        product_id: 9,
        quantity_after: 17,
        adjustment_type: 'count_variance',
        discrepancy_reviewed: true,
      },
      ctx,
    );
    expect(preview.status).toBe('error');
    expect(preview.message).toContain('discrepancy_reason');
  });

  it('revisada con motivo: propone y deja el motivo en la traza del ajuste', async () => {
    const { tool, adjustmentsService } = build();
    const args = {
      product_id: 9,
      quantity_after: 17,
      adjustment_type: 'count_variance',
      reason: 'Conteo del lunes',
      discrepancy_reviewed: true,
      discrepancy_reason: 'Tres bolsas se vendieron sin registrar',
    };
    const preview = await tool.preview!(args, ctx);
    expect(preview.status).toBe('warning');
    expect(preview.changes).toContainEqual({
      field: 'discrepancy_reason',
      label: 'Motivo de la diferencia',
      from: null,
      to: 'Tres bolsas se vendieron sin registrar',
    });
    const out = JSON.parse(await tool.handler!(args, ctx));
    expect(out.error).toBeUndefined();
    expect(adjustmentsService.createAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'count_variance',
        quantity_after: 17,
        description:
          'Conteo del lunes — Motivo de la diferencia: Tres bolsas se vendieron sin registrar',
      }),
    );
  });

  it('expone los parámetros de reconocimiento sin volverlos obligatorios', () => {
    const { tool } = build();
    expect(tool.parameters.properties.discrepancy_reviewed.type).toBe(
      'boolean',
    );
    expect(tool.parameters.properties.discrepancy_reason.type).toBe('string');
    expect(tool.parameters.required).toEqual(['product_id', 'quantity_after']);
  });
});
