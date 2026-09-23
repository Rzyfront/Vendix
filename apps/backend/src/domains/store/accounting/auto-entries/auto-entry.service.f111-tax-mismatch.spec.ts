import { AutoEntryService } from './auto-entry.service';

/**
 * F-111 (CP-pos-exclusive-tax-double-charge) — segunda red de detección en
 * `AutoEntryService.resolveTaxLines`, independiente del cálculo que ya hizo
 * el POS/facturación al escribir `order_item_taxes`/`invoice_taxes`. Estos
 * tests fallarían contra el código anterior a F-111 (que ni comparaba
 * `tax_rate × taxable_amount` contra `tax_amount`, ni conocía la causa
 * `DETECTED_TAX_MISMATCH`).
 *
 * Se ejercita vía `onInvoiceValidated` (mismo patrón que
 * `auto-entry.service.spec.ts`): `createAutoEntry` se mockea por completo
 * (evita tocar `chart_of_accounts`/período fiscal/`$transaction`), así que
 * lo único bajo prueba es el efecto de `resolveTaxLines` ANTES de esa
 * llamada — el `lines` array construido y la llamada a
 * `entry_failure_service.recordSkip`.
 */
describe('AutoEntryService · resolveTaxLines compuerta F-111', () => {
  const createService = (overrides: any = {}) => {
    const prisma = {
      chart_of_accounts: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
      // `resolveInvoiceRevenueLines` (llamado por `onInvoiceValidated` ANTES
      // de `resolveTaxLines`) lee `invoice_items` sin scope para el reparto
      // por cuenta PUC. `[]` ⇒ camino legado de una sola línea — no hace
      // falta ejercitar el reparto multi-cuenta para probar la compuerta
      // F-111, que vive en `resolveTaxLines`.
      withoutScope: jest.fn().mockReturnValue({
        invoice_items: { findMany: jest.fn().mockResolvedValue([]) },
        // `findPriorSaleRecognition`: factura sin orden ⇒ no hay venta previa
        // que cubrir y el asiento de la factura se arma como siempre.
        invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
      ...overrides.prisma,
    };
    // Cualquier mapping_key resuelve a una cuenta ficticia: no es el objeto
    // bajo prueba (eso ya lo cubre account-mapping.service.spec.ts) y así
    // ninguna línea del asiento se cae por mapping ausente.
    const accountMapping = {
      getMapping: jest
        .fn()
        .mockResolvedValue({ account_code: 'X-TEST', source: 'default' }),
      ...overrides.accountMapping,
    };
    const fiscalScope = {
      resolveAccountingEntityForFiscal: jest.fn(),
      ...overrides.fiscalScope,
    };
    const fiscalGate = {
      isAreaEnabled: jest.fn().mockResolvedValue(true),
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscalGate,
    };
    const entryFailure = {
      recordFailure: jest.fn(),
      recordSkip: jest.fn().mockResolvedValue(undefined),
      ...overrides.entryFailure,
    };

    const service = new AutoEntryService(
      prisma as any,
      accountMapping as any,
      fiscalScope as any,
      fiscalGate as any,
      entryFailure as any,
    );
    const createAutoEntry = jest
      .spyOn(service, 'createAutoEntry')
      .mockResolvedValue({ id: 999 } as any);

    return { service, createAutoEntry, entryFailure, accountMapping };
  };

  it('reproduce la forma real del defecto (base ~31.000, IVA declarado +303,34) ⇒ registra el fallo Y emite la línea igual', async () => {
    const { service, createAutoEntry, entryFailure } = createService();

    // Espejo de los asientos 3122/3229/3247 en producción: base gravable
    // ~31.000, tarifa 19 %, IVA ESPERADO = 31000 × 0.19 = 5.890,00, pero el
    // IVA DECLARADO trae la desviación real observada (~+303,34) porque el
    // POS aplicó el impuesto exclusivo dos veces sobre parte de la línea.
    const taxable_amount = 31000;
    const tax_rate = 0.19;
    const expected_tax = taxable_amount * tax_rate; // 5890.00
    const declared_tax = expected_tax + 303.34; // 6193.34 — el defecto real

    await service.onInvoiceValidated({
      invoice_id: 3122,
      organization_id: 1,
      store_id: 2,
      subtotal: taxable_amount,
      tax_amount: declared_tax,
      tax_breakdown: [
        {
          tax_type: 'iva',
          tax_amount: declared_tax,
          tax_rate,
          taxable_amount,
        },
      ],
      total: taxable_amount + declared_tax,
      user_id: 9,
    });

    // 1. El fallo queda registrado, con causa y contexto suficientes para
    //    diagnosticar sin volver a calcular nada a mano.
    expect(entryFailure.recordSkip).toHaveBeenCalledTimes(1);
    const skip_call = entryFailure.recordSkip.mock.calls[0][0];
    expect(skip_call).toEqual(
      expect.objectContaining({
        organization_id: 1,
        store_id: 2,
        // `source_type` PROPIO, no el del evento: `recordSkip` deduplica por
        // esa clave y pisa el mensaje al chocar. Con `'invoice.validated'` a
        // secas, un `SKIPPED_MISSING_MAPPING` del mismo evento borraría esta
        // detección.
        source_type: 'invoice.validated.tax_mismatch.iva',
        source_id: 3122,
        cause: 'DETECTED_TAX_MISMATCH',
      }),
    );
    // El evento de origen no se pierde: se mudó de la clave al texto.
    expect(skip_call.detail).toEqual(
      expect.stringContaining('evento=invoice.validated'),
    );
    expect(skip_call.detail).toEqual(expect.stringContaining('iva'));
    expect(skip_call.detail).toEqual(expect.stringContaining('30334'));
    expect(skip_call.source_type.length).toBeLessThanOrEqual(50);

    // 2. LA VENTA NO SE ROMPE: la línea de IVA se emite con el monto
    //    DECLARADO (inflado), no con el esperado/corregido. Registrar no es
    //    bloquear.
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const lines = createAutoEntry.mock.calls[0][0].lines.filter(Boolean);
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: 'X-TEST',
        debit_amount: 0,
        credit_amount: declared_tax,
      }),
    );
  });

  it('espejo: impuesto declarado == esperado (dentro de tolerancia) ⇒ NO registra nada', async () => {
    const { service, createAutoEntry, entryFailure } = createService();

    const taxable_amount = 31000;
    const tax_rate = 0.19;
    const correct_tax = taxable_amount * tax_rate; // 5890.00, exacto

    await service.onInvoiceValidated({
      invoice_id: 4001,
      organization_id: 1,
      store_id: 2,
      subtotal: taxable_amount,
      tax_amount: correct_tax,
      tax_breakdown: [
        { tax_type: 'iva', tax_amount: correct_tax, tax_rate, taxable_amount },
      ],
      total: taxable_amount + correct_tax,
      user_id: 9,
    });

    expect(entryFailure.recordSkip).not.toHaveBeenCalled();
    expect(createAutoEntry).toHaveBeenCalledTimes(1);
    const lines = createAutoEntry.mock.calls[0][0].lines.filter(Boolean);
    expect(lines).toContainEqual(
      expect.objectContaining({
        account_code: 'X-TEST',
        debit_amount: 0,
        credit_amount: correct_tax,
      }),
    );
  });

  it('sin tax_rate/taxable_amount (llamador histórico) ⇒ la compuerta no se arma, cero ruido', async () => {
    const { service, entryFailure } = createService();

    await service.onInvoiceValidated({
      invoice_id: 4002,
      organization_id: 1,
      store_id: 2,
      subtotal: 1000,
      tax_amount: 190,
      // Breakdown SIN tax_rate/taxable_amount — comportamiento pre-F-111.
      tax_breakdown: [{ tax_type: 'iva', tax_amount: 190 }],
      total: 1190,
      user_id: 9,
    });

    expect(entryFailure.recordSkip).not.toHaveBeenCalled();
  });

  it('F-222 — la comparación es en CENTAVOS ENTEROS, no en floats: 13603.13 vs 13603.12', () => {
    // Reproduce exactamente la fórmula de `resolveTaxLines`. El par
    // 13603.13/13603.12 es el ejemplo canónico de F-222: en aritmética de
    // punto flotante, `Math.abs(13603.13 - 13603.12)` da
    // 0.00999999999839... — MENOR que el umbral ingenuo `>= 0.01`, así que
    // una comparación en float NUNCA vería esta desviación de 1 centavo.
    const declared = 13603.13;
    const expected = 13603.12;

    const naive_float_diff = Math.abs(declared - expected);
    expect(naive_float_diff).toBeLessThan(0.01); // el bug: "parece" no haber diferencia
    expect(naive_float_diff).not.toBe(0.01); // la representación binaria NO es limpia

    // La técnica usada por `resolveTaxLines`: redondear a centavos ANTES de
    // restar colapsa el binario y revela el centavo real de diferencia.
    const declared_cents = Math.round(declared * 100);
    const expected_cents = Math.round(expected * 100);
    const delta_cents = Math.abs(declared_cents - expected_cents);
    expect(delta_cents).toBe(1);
  });
});
