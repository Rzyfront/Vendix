import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * QUI-1043 — store isolation of CRM stage templates. A template is store
 * configuration: reading, editing or deleting another store's template must be
 * impossible. The check is on the filter that reaches the query.
 */
describe('StorePrismaService · isolation of crm_stage_templates', () => {
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
    await (service as any).applyStoreScoping('crm_stage_templates', operation, args, query);
    return query.mock.calls[0][0];
  }

  it('a `where: { id }` read gets the store filter', async () => {
    const args = await scopedArgs('findFirst', { where: { id: 5 } });
    expect(args.where).toEqual({ id: 5, store_id: 3 });
  });

  it('an edit or delete only reaches the current store', async () => {
    const update = await scopedArgs('updateMany', { where: { id: 5 }, data: { name: 'X' } });
    expect(update.where).toEqual({ id: 5, store_id: 3 });
    jest.restoreAllMocks();
    const remove = await scopedArgs('deleteMany', { where: { id: 5 } });
    expect(remove.where).toEqual({ id: 5, store_id: 3 });
  });

  it('without a store in context the templates are not queried', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 2 } as any);
    await expect(
      (service as any).applyStoreScoping(
        'crm_stage_templates',
        'findMany',
        { where: {} },
        jest.fn(),
      ),
    ).rejects.toThrow(/store context required/);
  });
});
