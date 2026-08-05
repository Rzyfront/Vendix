import { VendixHttpException } from 'src/common/errors';
import {
  FiscalInvoiceThresholdService,
  POS_EQUIVALENT_DOCUMENT_UVT_LIMIT,
} from './fiscal-invoice-threshold.service';

/**
 * The 5 UVT frontier is the only thing standing between "POS ticket is legal" and
 * "this sale needed an electronic invoice". Its three fail-open branches are the
 * risky part — each one silently disables the gate, so each gets its own test.
 */
describe('FiscalInvoiceThresholdService', () => {
  const UVT_2026 = 49_799; // representative COP value
  const LIMIT = UVT_2026 * POS_EQUIVALENT_DOCUMENT_UVT_LIMIT;

  function build(options?: {
    invoicing_enabled?: boolean;
    uvt_rows?: Array<{ value_cop: number } | null>;
  }) {
    const rows = options?.uvt_rows ?? [{ value_cop: UVT_2026 }];
    let call = 0;
    const findFirst = jest.fn().mockImplementation(() => {
      const row = rows[call] ?? null;
      call += 1;
      return Promise.resolve(row);
    });

    const globalPrisma = { uvt_values: { findFirst } } as any;
    const fiscalGate = {
      isAreaEnabled: jest
        .fn()
        .mockResolvedValue(options?.invoicing_enabled ?? true),
    } as any;

    return {
      service: new FiscalInvoiceThresholdService(globalPrisma, fiscalGate),
      findFirst,
      fiscalGate,
    };
  }

  const base = {
    organization_id: 7,
    store_id: 3,
    year: 2026,
  };

  it('throws when an anonymous sale exceeds 5 UVT', async () => {
    const { service } = build();

    await expect(
      service.assertInvoiceNotRequired({
        ...base,
        total_amount: LIMIT + 1,
        has_customer: false,
      }),
    ).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('allows an anonymous sale exactly at the limit', async () => {
    const { service } = build();

    const evaluation = await service.assertInvoiceNotRequired({
      ...base,
      total_amount: LIMIT,
      has_customer: false,
    });

    expect(evaluation.enforced).toBe(true);
    expect(evaluation.exceeds).toBe(false);
    expect(evaluation.limit_cop).toBe(LIMIT);
  });

  it('fail-open 1: an identified buyer is never blocked, at any amount', async () => {
    const { service, fiscalGate } = build();

    const evaluation = await service.assertInvoiceNotRequired({
      ...base,
      total_amount: LIMIT * 100,
      has_customer: true,
    });

    expect(evaluation.enforced).toBe(false);
    // Short-circuits before touching the fiscal gate: an identified sale can be
    // invoiced regardless of the tenant's fiscal state.
    expect(fiscalGate.isAreaEnabled).not.toHaveBeenCalled();
  });

  it('fail-open 2: invoicing area inactive disables the limit', async () => {
    const { service, findFirst } = build({ invoicing_enabled: false });

    const evaluation = await service.assertInvoiceNotRequired({
      ...base,
      total_amount: LIMIT * 10,
      has_customer: false,
    });

    expect(evaluation.enforced).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fail-open 3: a missing uvt_values row disables the limit instead of blocking every sale', async () => {
    const { service } = build({ uvt_rows: [null, null] });

    const evaluation = await service.assertInvoiceNotRequired({
      ...base,
      total_amount: LIMIT * 10,
      has_customer: false,
    });

    expect(evaluation.enforced).toBe(false);
    expect(evaluation.uvt_value).toBeNull();
  });

  it('prefers the org-level UVT row and only falls back to an entity row', async () => {
    // First query (accounting_entity_id: null) misses, second one hits.
    const { service, findFirst } = build({
      uvt_rows: [null, { value_cop: 40_000 }],
    });

    const evaluation = await service.evaluate({
      ...base,
      total_amount: 0,
      has_customer: false,
    });

    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst.mock.calls[0][0].where.accounting_entity_id).toBeNull();
    expect(evaluation.uvt_value).toBe(40_000);
    expect(evaluation.limit_cop).toBe(200_000);
  });

  it('carries the numbers the cashier needs in the error details', async () => {
    const { service } = build();

    try {
      await service.assertInvoiceNotRequired({
        ...base,
        total_amount: LIMIT + 5000,
        has_customer: false,
        channel: 'pos',
      });
      fail('expected the threshold to throw');
    } catch (error) {
      const details = (error as VendixHttpException).getResponse() as any;
      const payload = details?.details ?? details;
      expect(payload.uvt_value).toBe(UVT_2026);
      expect(payload.limit_cop).toBe(LIMIT);
      expect(payload.total_amount).toBe(LIMIT + 5000);
      expect(payload.channel).toBe('pos');
    }
  });

  it('treats a zero or non-positive UVT as unconfigured', async () => {
    const { service } = build({ uvt_rows: [{ value_cop: 0 }] });

    const evaluation = await service.evaluate({
      ...base,
      total_amount: LIMIT * 10,
      has_customer: false,
    });

    expect(evaluation.enforced).toBe(false);
  });
});
