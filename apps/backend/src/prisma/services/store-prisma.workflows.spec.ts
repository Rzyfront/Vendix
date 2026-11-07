import { Test, TestingModule } from '@nestjs/testing';

import { RequestContextService } from '@common/context/request-context.service';

import { StorePrismaService } from './store-prisma.service';

/**
 * Flujos (S3): cada tabla nueva lleva `store_id` propio y debe quedar
 * registrada en el scoping por tienda. Se comprueba el filtro que de verdad
 * llega a la consulta y que cada modelo tiene su getter en el cliente scopeado.
 */
const WORKFLOW_MODELS = [
  'workflow_definitions',
  'workflow_versions',
  'work_groups',
  'work_group_members',
  'workflow_instances',
  'workflow_tasks',
  'workflow_task_votes',
  'workflow_instance_events',
  'workflow_outbox',
  // Documental D1 (S5)
  'stored_files',
  'dossiers',
  'dossier_items',
  // Operación de Flujos (bloque 8)
  'workflow_instance_comments',
  'workflow_public_links',
  // API keys por tienda (bloque 13)
  'store_api_keys',
  // Webhooks salientes de Flujos (bloque 13)
  'workflow_webhook_endpoints',
  'workflow_webhook_deliveries',
  // Externos e inéditos (flujos-adm P3)
  'workflow_inbound_hooks',
  'workflow_inbound_requests',
  'workflow_secrets',
  'workflow_mailboxes',
  'workflow_mailbox_messages',
  'workflow_upload_sessions',
  'workflow_tracking_links',
  'workflow_collections',
  'workflow_records',
] as const;

describe('StorePrismaService · aislamiento de Flujos', () => {
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

  it.each(WORKFLOW_MODELS)('%s está registrado como modelo scopeado', (model) => {
    expect((service as any).store_scoped_models).toContain(model);
    // El getter existe en la clase (el cliente scopeado se crea al conectar).
    const getter = Object.getOwnPropertyDescriptor(
      StorePrismaService.prototype,
      model,
    );
    expect(getter?.get).toBeInstanceOf(Function);
  });

  const reads = ['findFirst', 'findMany', 'count', 'updateMany'];
  const cases = WORKFLOW_MODELS.flatMap((m) => reads.map((o) => [m, o]));
  it.each(cases)('%s.%s lleva el store_id de la petición', async (model, op) => {
    const args = await argsReaching(model, op, { where: { id: 5 } });
    expect(args.where).toEqual({ id: 5, store_id: 10 });
  });

  it.each(WORKFLOW_MODELS)(
    '%s: un store_id ajeno en el where se cruza con el de la petición',
    async (model) => {
      const args = await argsReaching(model, 'findFirst', {
        where: { id: 5, store_id: 20 },
      });
      expect(args.where).toEqual({
        id: 5,
        store_id: 20,
        AND: [{ store_id: 10 }],
      });
    },
  );

  it.each(WORKFLOW_MODELS)('%s: crear lo ata a la tienda de la petición', async (model) => {
    const args = await argsReaching(model, 'create', {
      data: { store_id: 20 },
    });
    expect(args.data.store_id).toBe(10);
  });
});
