import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { ProfilesService } from './profiles.service';

describe('ProfilesService.remove · quotation version anchor', () => {
  const profile = {
    id: 7,
    organization_id: 6,
    store_id: 10,
    name: 'AIU construction',
    operation_type: '09',
    state: 'active',
    is_default: false,
    current_version: 4,
  };

  function makeHarness(options?: {
    invoiceCounts?: number[];
    quotationCount?: number;
    transactionError?: unknown;
  }) {
    const transactionError =
      options?.transactionError ?? { code: 'P2003', meta: { field_name: 'fk' } };
    const tx = {
      invoice_profiles: {
        findFirst: jest.fn().mockResolvedValue(profile),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn().mockResolvedValue(profile),
      },
      invoice_profile_versions: {
        deleteMany: jest.fn().mockRejectedValue(transactionError),
      },
    };
    const invoiceCount = jest
      .fn()
      .mockResolvedValueOnce(options?.invoiceCounts?.[0] ?? 0)
      .mockResolvedValueOnce(options?.invoiceCounts?.[1] ?? 0);
    const quotationCount = jest
      .fn()
      .mockResolvedValue(options?.quotationCount ?? 0);
    const prisma = {
      invoice_profiles: {
        findFirst: jest.fn().mockResolvedValue(profile),
      },
      invoice_profile_versions: {},
      invoices: { count: invoiceCount },
      quotations: { count: quotationCount },
      withoutScope: jest.fn(() => ({
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      })),
    };
    const service = new ProfilesService(
      prisma as any,
      { invalidate: jest.fn().mockResolvedValue(undefined) } as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { assertAccountsUsable: jest.fn().mockResolvedValue(undefined) } as any,
    );
    return { service, prisma, tx, invoiceCount, quotationCount, transactionError };
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, organization_id: 6, user_id: 3 } as any);
  });

  it('translates a raced version FK into the same profile error with quotation_count', async () => {
    const { service, prisma, tx, quotationCount } = makeHarness({
      invoiceCounts: [0, 0],
      quotationCount: 2,
    });

    const error = await service.remove(7).catch((value) => value);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.errorCode).toBe('INVOICING_PROFILE_003');
    expect(error.getResponse().message).toContain('2 cotizaciones de contrato');
    expect(error.getResponse().details).toEqual({
      profile_id: 7,
      quotation_count: 2,
    });
    expect(error.getResponse().details).not.toHaveProperty('invoice_count');
    expect(prisma.quotations.count).toHaveBeenCalledWith({
      where: { invoice_profile_id: 7 },
    });
    expect(quotationCount).toHaveBeenCalledTimes(1);
    expect(tx.invoice_profile_versions.deleteMany).toHaveBeenCalledWith({
      where: { profile_id: 7 },
    });
  });

  it('preserves invoice-based refusal when invoice evidence wins the FK race', async () => {
    const { service, prisma } = makeHarness({ invoiceCounts: [0, 3], quotationCount: 5 });

    const error = await service.remove(7).catch((value) => value);

    expect(error.errorCode).toBe('INVOICING_PROFILE_003');
    expect(error.getResponse().details).toEqual({ profile_id: 7, invoice_count: 3 });
    expect(prisma.quotations.count).not.toHaveBeenCalled();
  });

  it('preserves the original FK error if there are no invoices or anchored quotations', async () => {
    const { service, prisma, transactionError } = makeHarness({
      invoiceCounts: [0, 0],
      quotationCount: 0,
    });

    await expect(service.remove(7)).rejects.toBe(transactionError);
    expect(prisma.quotations.count).toHaveBeenCalledWith({
      where: { invoice_profile_id: 7 },
    });
  });
});
