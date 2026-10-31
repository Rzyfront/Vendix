import { QuotationsService } from './quotations.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * CRM (PLAN-CRM §2.5): accepting a quotation emits `quotation.accepted` with
 * its store, so the opportunities that link it are won.
 */
describe('QuotationsService CRM events', () => {
  const quotation = {
    id: 7,
    store_id: 12,
    status: 'sent',
    destination: 'sale',
    quotation_number: 'COT-7',
    quotation_items: [],
  };
  const prisma = {
    quotations: {
      findFirst: jest.fn(async () => quotation),
      update: jest.fn(async ({ data }: any) => ({ ...quotation, ...data })),
    },
    contracts: { findMany: jest.fn(async () => []) },
  };
  const eventEmitter = { emit: jest.fn() };
  const service = new QuotationsService(
    prisma as any,
    {} as any,
    eventEmitter as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: 12,
      organization_id: 34,
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('accept emits quotation.accepted with store and quotation', async () => {
    const accepted = await service.accept(7);
    expect(accepted.status).toBe('accepted');
    expect(eventEmitter.emit).toHaveBeenCalledWith('quotation.accepted', {
      store_id: 12,
      quotation_id: 7,
      quotation_number: 'COT-7',
    });
  });

  it('reject emits nothing for the CRM', async () => {
    await service.reject(7);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
