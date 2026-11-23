import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * QUI-1013 — store isolation of production plants. A plant points at two
 * inventory locations: reading or editing another store's plant would move
 * that store's stock. The check is on the filter that reaches the query.
 */
describe('StorePrismaService · isolation of manufacturing_plants', () => {
  let service: StorePrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePrismaService],
    }).compile();
    service = module.get<StorePrismaService>(StorePrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  async function scopedArgs(operation: string, args: any) {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 2, store_id: 3 } as any);
    const query = jest.fn().mockResolvedValue(null);
    await (service as any).applyStoreScoping('manufacturing_plants', operation, args, query);
    return query.mock.calls[0][0];
  }

  it('a `where: { id }` read gets the store filter', async () => {
    const args = await scopedArgs('findFirst', { where: { id: 5 } });
    expect(args.where).toEqual({ id: 5, store_id: 3 });
  });

  it('an `updateMany` (deactivate/edit) only reaches the current store', async () => {
    const args = await scopedArgs('updateMany', {
      where: { id: 5 },
      data: { is_active: false },
    });
    expect(args.where).toEqual({ id: 5, store_id: 3 });
  });

  it('without a store in context the plants are not queried', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 2 } as any);
    await expect(
      (service as any).applyStoreScoping(
        'manufacturing_plants',
        'findMany',
        { where: {} },
        jest.fn(),
      ),
    ).rejects.toThrow(/store context required/);
  });
});
