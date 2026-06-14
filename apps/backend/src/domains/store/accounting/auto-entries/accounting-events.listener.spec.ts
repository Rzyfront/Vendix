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

    return {
      listener: new AccountingEventsListener(
        auto_entry_service as any,
        account_mapping_service as any,
        fiscal_gate as any,
        platform_org_service as any,
      ),
      auto_entry_service,
      fiscal_gate,
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
