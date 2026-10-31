import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * Store isolation of the CRM inbox (PLAN-CRM §6). The inbox service relies
 * on the scope extension to add the store of the request to every query, so
 * this checks the filter that actually reaches the query, per operation the
 * inbox uses.
 */
describe('StorePrismaService · aislamiento de la bandeja CRM', () => {
  let service: StorePrismaService;
  const storeA = { organization_id: 1, store_id: 10 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StorePrismaService],
    }).compile();
    service = module.get<StorePrismaService>(StorePrismaService);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(storeA as any);
  });

  afterEach(() => jest.restoreAllMocks());

  async function argsReaching(model: string, operation: string, args: any) {
    const query = jest.fn().mockResolvedValue(null);
    await (service as any).applyStoreScoping(model, operation, args, query);
    return query.mock.calls[0][0];
  }

  it.each([
    ['crm_conversations', 'findFirst'],
    ['crm_conversations', 'findMany'],
    ['crm_conversations', 'count'],
    ['crm_conversations', 'updateMany'],
    ['crm_messages', 'findFirst'],
    ['crm_messages', 'findMany'],
    ['crm_messages', 'updateMany'],
  ])('%s.%s lleva el store_id de la petición', async (model, operation) => {
    const args = await argsReaching(model, operation, { where: { id: 5 } });
    expect(args.where).toEqual({ id: 5, store_id: 10 });
  });

  it('un store_id de otra tienda en el where se cruza con el del contexto (no devuelve nada)', async () => {
    const args = await argsReaching('crm_conversations', 'findFirst', {
      where: { id: 5, store_id: 20 },
    });
    expect(args.where).toEqual({
      id: 5,
      store_id: 20,
      AND: [{ store_id: 10 }],
    });
  });

  it('crear un mensaje lo ata a la tienda de la petición', async () => {
    const args = await argsReaching('crm_messages', 'create', {
      data: { conversation_id: 5, store_id: 20 },
    });
    expect(args.data.store_id).toBe(10);
  });

  it('sin tienda en contexto no se consulta la bandeja', async () => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ organization_id: 1 } as any);
    await expect(
      (service as any).applyStoreScoping(
        'crm_conversations',
        'findMany',
        { where: {} },
        jest.fn(),
      ),
    ).rejects.toThrow();
  });
});
