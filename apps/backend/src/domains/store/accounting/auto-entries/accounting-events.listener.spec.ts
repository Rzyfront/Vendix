import { AccountingEventsListener } from './accounting-events.listener';

describe('AccountingEventsListener invoice.accepted routing', () => {
  const baseEvent = {
    invoice_id: 55,
    invoice_number: 'FE100',
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    subtotal_amount: 1000,
    tax_amount: 190,
    tax_breakdown: [{ tax_type: 'iva' as const, tax_amount: 190 }],
    withholding_breakdown: [],
    total_amount: 1190,
    user_id: 9,
  };

  const createListener = (overrides: any = {}) => {
    const auto_entry_service = {
      onInvoiceValidated: jest.fn().mockResolvedValue({ id: 1 }),
      onCreditNoteAccepted: jest.fn().mockResolvedValue({ id: 2 }),
      // resolveOrgId reaches into auto_entry_service['prisma'].
      prisma: {
        stores: {
          findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
        },
      },
      ...overrides.auto_entry_service,
    };
    const account_mapping_service = {
      getMapping: jest.fn(),
      ...overrides.account_mapping_service,
    };
    const fiscal_gate = {
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscal_gate,
    };
    const platform_org_service = {
      getPlatformContext: jest
        .fn()
        .mockResolvedValue({ organization_id: 999, accounting_entity_id: 1 }),
      ...overrides.platform_org_service,
    };
    const entry_failure_service = {
      recordSkip: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      ...overrides.entry_failure_service,
    };

    return {
      listener: new AccountingEventsListener(
        auto_entry_service as any,
        account_mapping_service as any,
        fiscal_gate as any,
        platform_org_service as any,
        entry_failure_service as any,
      ),
      auto_entry_service,
      fiscal_gate,
      entry_failure_service,
    };
  };

  it('routes credit_note to onCreditNoteAccepted (reversal), never the sale entry', async () => {
    const { listener, auto_entry_service } = createListener();

    await listener.handleInvoiceAccepted({
      ...baseEvent,
      invoice_type: 'credit_note',
    });

    expect(auto_entry_service.onCreditNoteAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_id: 55,
        organization_id: 1,
        store_id: 2,
        accounting_entity_id: 77,
        subtotal: 1000,
        tax_amount: 190,
        tax_breakdown: baseEvent.tax_breakdown,
        total: 1190,
        user_id: 9,
      }),
    );
    expect(auto_entry_service.onInvoiceValidated).not.toHaveBeenCalled();
  });

  it('routes debit_note to onInvoiceValidated (a debit note increases the receivable)', async () => {
    const { listener, auto_entry_service } = createListener();

    await listener.handleInvoiceAccepted({
      ...baseEvent,
      invoice_type: 'debit_note',
    });

    expect(auto_entry_service.onInvoiceValidated).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_id: 55, subtotal: 1000, total: 1190 }),
    );
    expect(auto_entry_service.onCreditNoteAccepted).not.toHaveBeenCalled();
  });

  it('routes regular sales invoices to onInvoiceValidated (current behavior)', async () => {
    const { listener, auto_entry_service } = createListener();

    await listener.handleInvoiceAccepted({
      ...baseEvent,
      invoice_type: 'sales_invoice',
    });

    expect(auto_entry_service.onInvoiceValidated).toHaveBeenCalledTimes(1);
    expect(auto_entry_service.onCreditNoteAccepted).not.toHaveBeenCalled();
  });

  it('applies the invoicing flow gate to credit notes too', async () => {
    const { listener, auto_entry_service } = createListener({
      fiscal_gate: { isSubflowEnabled: jest.fn().mockResolvedValue(false) },
    });

    await listener.handleInvoiceAccepted({
      ...baseEvent,
      invoice_type: 'credit_note',
    });

    expect(auto_entry_service.onCreditNoteAccepted).not.toHaveBeenCalled();
    expect(auto_entry_service.onInvoiceValidated).not.toHaveBeenCalled();
  });
});

/**
 * CP-PURCHASE-TRANSPARENCY C.9 — los cuatro caminos de asiento omitido.
 *
 * Lo que estos casos fijan no es «se creó el asiento», es lo contrario: cuando
 * NO se crea, tiene que quedar fila con la causa. Medido contra la base de
 * desarrollo antes del arreglo: 21 de 79 recepciones sin asiento y CERO filas
 * en `accounting_entry_failures`, mientras el log decía «Auto-entry created».
 */
describe('AccountingEventsListener — omisión de asiento instrumentada (C.9)', () => {
  const receptionEvent = {
    purchase_order_id: 500,
    reception_id: 900,
    organization_id: 6,
    store_id: 10,
    accounting_entity_id: 25,
    total_amount: 1000,
    user_id: 9,
  };

  const build = (overrides: any = {}) => {
    const auto_entry_service = {
      onPurchaseOrderReceived: jest.fn().mockResolvedValue({ id: 1 }),
      prisma: {
        stores: {
          findUnique: jest.fn().mockResolvedValue({ organization_id: 6 }),
        },
      },
      ...overrides.auto_entry_service,
    };
    const fiscal_gate = {
      isSubflowEnabled: jest.fn().mockResolvedValue(true),
      ...overrides.fiscal_gate,
    };
    const entry_failure_service = {
      recordSkip: jest.fn().mockResolvedValue(undefined),
      ...overrides.entry_failure_service,
    };
    const listener = new AccountingEventsListener(
      auto_entry_service as any,
      { getMapping: jest.fn() } as any,
      fiscal_gate as any,
      { getPlatformContext: jest.fn() } as any,
      entry_failure_service as any,
    );
    return { listener, auto_entry_service, fiscal_gate, entry_failure_service };
  };

  it('deja fila SKIPPED_FLOW_DISABLED cuando el subflujo de compras está apagado', async () => {
    const { listener, auto_entry_service, entry_failure_service } = build({
      fiscal_gate: { isSubflowEnabled: jest.fn().mockResolvedValue(false) },
    });

    await listener.handlePurchaseOrderReceived(receptionEvent);

    expect(auto_entry_service.onPurchaseOrderReceived).not.toHaveBeenCalled();
    expect(entry_failure_service.recordSkip).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'SKIPPED_FLOW_DISABLED',
        organization_id: 6,
        store_id: 10,
        source_type: 'purchase_order.received',
        source_id: 900,
      }),
    );
  });

  it('pasa la organización del evento al gate: la bodega de organización (store_id ausente) ya no resuelve org_id=0', async () => {
    const { listener, fiscal_gate, auto_entry_service } = build();

    await listener.handlePurchaseOrderReceived({
      ...receptionEvent,
      store_id: undefined,
    });

    // Antes: sin el tercer argumento, `org_id` caía a 0, el gate devolvía
    // false y el manejador salía con un `return` desnudo. Dos de las 21
    // recepciones medidas sin asiento eran exactamente este caso.
    expect(fiscal_gate.isSubflowEnabled).toHaveBeenCalledWith(
      6,
      null,
      'purchases',
    );
    expect(auto_entry_service.onPurchaseOrderReceived).toHaveBeenCalledTimes(1);
  });

  it('no afirma «Auto-entry created» cuando postAutoEntry devolvió null', async () => {
    const { listener, auto_entry_service } = build({
      auto_entry_service: {
        onPurchaseOrderReceived: jest.fn().mockResolvedValue(null),
      },
    });
    const log = jest
      .spyOn((listener as any).logger, 'log')
      .mockImplementation(() => undefined);

    await listener.handlePurchaseOrderReceived(receptionEvent);

    expect(auto_entry_service.onPurchaseOrderReceived).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('sí afirma «Auto-entry created» cuando hubo asiento', async () => {
    const { listener } = build();
    const log = jest
      .spyOn((listener as any).logger, 'log')
      .mockImplementation(() => undefined);

    await listener.handlePurchaseOrderReceived(receptionEvent);

    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('propaga el flete asumido al servicio de asientos (C.6)', async () => {
    const { listener, auto_entry_service } = build();

    await listener.handlePurchaseOrderReceived({
      ...receptionEvent,
      shipping_expense_amount: 50000,
    });

    expect(auto_entry_service.onPurchaseOrderReceived).toHaveBeenCalledWith(
      expect.objectContaining({ shipping_expense_amount: 50000 }),
    );
  });
});
