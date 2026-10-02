import { AccountingEventsListener } from './accounting-events.listener';

describe('AccountingEventsListener purchase VAT contribution routing', () => {
  const baseEvent = {
    invoice_id: 88,
    purchase_order_id: 41,
    reception_id: 501,
    organization_id: 7,
    store_id: 3,
    accounting_entity_id: 19,
    contribution_id: 901,
    iva_amount: 190,
    user_id: 12,
    supplier: { id: 55, tax_id: '900111222' },
  };

  const build = (options: {
    enabled?: boolean;
    contributionResult?: unknown;
    contributionError?: Error;
  } = {}) => {
    const auto_entry_service = {
      onPurchaseVatRecognized: jest.fn().mockResolvedValue({ id: 1 }),
      onPurchaseVatContributionRecognized: options.contributionError
        ? jest.fn().mockRejectedValue(options.contributionError)
        : jest.fn().mockResolvedValue(options.contributionResult ?? { id: 2 }),
      prisma: {
        stores: { findUnique: jest.fn().mockResolvedValue({ organization_id: 7 }) },
      },
    };
    const fiscal_gate = {
      isSubflowEnabled: jest.fn().mockResolvedValue(options.enabled ?? true),
    };
    const entry_failure_service = {
      recordSkip: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
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

  it('posts only through the contribution handler for a valid contribution event', async () => {
    const { listener, auto_entry_service, entry_failure_service } = build();

    await listener.handlePurchaseVatRecognized(baseEvent);

    expect(auto_entry_service.onPurchaseVatContributionRecognized).toHaveBeenCalledWith({
      contribution_id: 901,
      organization_id: 7,
      accounting_entity_id: 19,
      store_id: 3,
      user_id: 12,
    });
    expect(auto_entry_service.onPurchaseVatRecognized).not.toHaveBeenCalled();
    expect(entry_failure_service.recordSkip).not.toHaveBeenCalled();
  });

  it('preserves the legacy invoice-keyed route when contribution_id is absent', async () => {
    const { listener, auto_entry_service } = build();
    const { contribution_id: _omitted, ...legacyEvent } = baseEvent;
    void _omitted;

    await listener.handlePurchaseVatRecognized(legacyEvent);

    expect(auto_entry_service.onPurchaseVatRecognized).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_id: 88,
        purchase_order_id: 41,
        reception_id: 501,
        organization_id: 7,
        store_id: 3,
        accounting_entity_id: 19,
        iva_amount: 190,
        user_id: 12,
      }),
    );
    expect(auto_entry_service.onPurchaseVatContributionRecognized).not.toHaveBeenCalled();
  });

  it('records disabled purchases flow against the contribution key and posts neither handler', async () => {
    const { listener, auto_entry_service, entry_failure_service } = build({ enabled: false });

    await listener.handlePurchaseVatRecognized(baseEvent);

    expect(entry_failure_service.recordSkip).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: 7,
      store_id: 3,
      source_type: 'purchase_vat_contribution',
      source_id: 901,
      cause: 'SKIPPED_FLOW_DISABLED',
    }));
    expect(auto_entry_service.onPurchaseVatContributionRecognized).not.toHaveBeenCalled();
    expect(auto_entry_service.onPurchaseVatRecognized).not.toHaveBeenCalled();
  });

  it.each([
    ['non-positive ID', { contribution_id: 0 }],
    ['non-integer ID', { contribution_id: '901' }],
    ['undefined ID property', { contribution_id: undefined }],
    ['missing organization', { organization_id: undefined }],
    ['missing entity', { accounting_entity_id: undefined }],
    ['missing store', { store_id: undefined }],
  ])('fails closed for a %s without falling back to invoice-keyed posting', async (_case, override) => {
    const { listener, auto_entry_service, fiscal_gate } = build();

    await listener.handlePurchaseVatRecognized({ ...baseEvent, ...override } as any);

    expect(auto_entry_service.onPurchaseVatContributionRecognized).not.toHaveBeenCalled();
    expect(auto_entry_service.onPurchaseVatRecognized).not.toHaveBeenCalled();
    expect(fiscal_gate.isSubflowEnabled).not.toHaveBeenCalled();
  });

  it('does not invoke the legacy handler when contribution posting fails', async () => {
    const { listener, auto_entry_service } = build({
      contributionError: new Error('contribution posting failed'),
    });

    await listener.handlePurchaseVatRecognized(baseEvent);

    expect(auto_entry_service.onPurchaseVatContributionRecognized).toHaveBeenCalledTimes(1);
    expect(auto_entry_service.onPurchaseVatRecognized).not.toHaveBeenCalled();
  });
});
