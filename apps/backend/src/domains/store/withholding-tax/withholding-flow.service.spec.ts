import {
  WithholdingFlowService,
  SufferedOperationItem,
} from './withholding-flow.service';

/**
 * Unit tests for `resolveSufferedByOperation` — Step 1 del plan
 * `docs/plans/PLAN-pago-multimetodo-pendientes.md`.
 *
 * Sólo se ejercita la lógica de AGRUPACIÓN (bien vs servicio, filtrado de
 * bases ≤ 0, fusión del resultado). La resolución legal en sí (gates, UVT,
 * tie-break) ya está cubierta por `withholding-resolver.service.spec.ts`; acá
 * `resolveSuffered` se mockea con `jest.spyOn` sobre la instancia real, así
 * que ningún caso toca Prisma/DB.
 */
describe('WithholdingFlowService.resolveSufferedByOperation', () => {
  // Los cuatro colaboradores no se usan en estos tests: `resolveSuffered` se
  // interceptа directo con `jest.spyOn`, así que nunca llega a leer
  // `this.prisma`/`this.resolver`/etc.
  const service = new WithholdingFlowService(
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
  );

  const emptyResolution = {
    lines: [],
    uvt_value_used: 0,
    counterparty_type: null,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('venta mixta (bien + servicio) ⇒ dos llamadas a resolveSuffered, una por grupo', async () => {
    const resolveSuffered = jest
      .spyOn(service, 'resolveSuffered')
      .mockImplementation(async (params) => {
        if (params.appliesTo === 'purchase') {
          return {
            lines: [
              {
                withholding_type: 'retefuente',
                concept_code: 'RTE_COMPRAS',
                rate: 0.025,
                base: params.base,
                amount: 37_500,
                role: 'suffered',
                account_role: 'withholding.suffered.retefuente_receivable',
              } as any,
            ],
            uvt_value_used: 49_799,
            counterparty_type: 'any',
          };
        }
        return {
          lines: [
            {
              withholding_type: 'retefuente',
              concept_code: 'RTE_SERV_GEN',
              rate: 0.04,
              base: params.base,
              amount: 12_000,
              role: 'suffered',
              account_role: 'withholding.suffered.retefuente_receivable',
            } as any,
          ],
          uvt_value_used: 49_799,
          counterparty_type: 'any',
        };
      });

    const items: SufferedOperationItem[] = [
      { product_type: 'physical', base: 1_500_000, ivaAmount: 285_000 },
      { product_type: 'service', base: 300_000, ivaAmount: 57_000 },
    ];

    const result = await service.resolveSufferedByOperation({
      organization_id: 1,
      store_id: 2,
      customer_id: 50,
      items,
    });

    expect(resolveSuffered).toHaveBeenCalledTimes(2);
    expect(resolveSuffered).toHaveBeenCalledWith(
      expect.objectContaining({
        appliesTo: 'purchase',
        base: 1_500_000,
        ivaAmount: 285_000,
        organization_id: 1,
        store_id: 2,
        customer_id: 50,
      }),
    );
    expect(resolveSuffered).toHaveBeenCalledWith(
      expect.objectContaining({
        appliesTo: 'service',
        base: 300_000,
        ivaAmount: 57_000,
      }),
    );

    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((l) => l.concept_code).sort()).toEqual([
      'RTE_COMPRAS',
      'RTE_SERV_GEN',
    ]);
    expect(result.uvt_value_used).toBe(49_799);
    expect(result.counterparty_type).toBe('any');
  });

  it('`prepared` y líneas sin tipo determinable caen todas en el bucket `purchase`', async () => {
    const resolveSuffered = jest
      .spyOn(service, 'resolveSuffered')
      .mockResolvedValue(emptyResolution);

    const items: SufferedOperationItem[] = [
      { product_type: 'prepared', base: 100_000 },
      { product_type: null, base: 50_000 }, // sin producto (línea manual)
      { product_type: 'custom', base: 25_000 }, // tipo no reconocido
    ];

    await service.resolveSufferedByOperation({
      organization_id: 1,
      customer_id: 50,
      items,
    });

    expect(resolveSuffered).toHaveBeenCalledTimes(1);
    expect(resolveSuffered).toHaveBeenCalledWith(
      expect.objectContaining({
        appliesTo: 'purchase',
        base: 175_000, // 100_000 + 50_000 + 25_000
        ivaAmount: 0,
      }),
    );
  });

  it('grupo vacío o con base ≤ 0 nunca llama a resolveSuffered', async () => {
    const resolveSuffered = jest
      .spyOn(service, 'resolveSuffered')
      .mockResolvedValue(emptyResolution);

    const result = await service.resolveSufferedByOperation({
      organization_id: 1,
      customer_id: 50,
      items: [
        { product_type: 'physical', base: 0 },
        { product_type: 'service', base: -100 },
      ],
    });

    expect(resolveSuffered).not.toHaveBeenCalled();
    expect(result).toEqual(emptyResolution);
  });

  it('items: [] ⇒ lines: [] sin llamar a resolveSuffered', async () => {
    const resolveSuffered = jest
      .spyOn(service, 'resolveSuffered')
      .mockResolvedValue(emptyResolution);

    const result = await service.resolveSufferedByOperation({
      organization_id: 1,
      customer_id: 50,
      items: [],
    });

    expect(resolveSuffered).not.toHaveBeenCalled();
    expect(result).toEqual(emptyResolution);
  });

  it('un solo grupo con líneas vacías conserva uvt_value_used/counterparty_type de esa resolución', async () => {
    jest.spyOn(service, 'resolveSuffered').mockResolvedValue({
      lines: [],
      uvt_value_used: 49_799,
      counterparty_type: 'gran_contribuyente',
    });

    const result = await service.resolveSufferedByOperation({
      organization_id: 1,
      customer_id: 50,
      items: [{ product_type: 'physical', base: 1_000_000 }],
    });

    expect(result.lines).toEqual([]);
    expect(result.uvt_value_used).toBe(49_799);
    expect(result.counterparty_type).toBe('gran_contribuyente');
  });
});
