import { RequestContextService } from '../../../../common/context/request-context.service';
import { AgentHistoryService } from './agent-history.service';

const STORE_ID = 7;

function setup(opts: {
  audits?: any[];
  purges?: any[];
  actions?: any[];
  conversations?: any[];
  total?: number;
  users?: any[];
}) {
  const prisma = {
    audit_logs: { findMany: jest.fn(async () => opts.audits ?? []) },
    ai_conversation_purges: { findMany: jest.fn(async () => opts.purges ?? []) },
    ai_conversations: {
      findMany: jest.fn(async () => opts.conversations ?? []),
      count: jest.fn(async () => opts.total ?? (opts.conversations ?? []).length),
    },
    users: { findMany: jest.fn(async () => opts.users ?? []) },
  };
  const feed = { recentAgentActions: jest.fn(async () => opts.actions ?? []) };
  const service = new AgentHistoryService(prisma as any, feed as any);
  return { service, prisma, feed };
}

const d = (iso: string) => new Date(iso);

describe('AgentHistoryService', () => {
  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(STORE_ID);
    jest.spyOn(RequestContextService, 'getUserId').mockReturnValue(1);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('listChanges', () => {
    it('mezcla las tres fuentes por fecha descendente', async () => {
      const { service } = setup({
        audits: [
          {
            id: 1,
            user_id: 1,
            created_at: d('2026-11-01T10:00:00Z'),
            new_values: { vexi: { old: { enabled: false }, new: { enabled: true } } },
          },
        ],
        actions: [
          {
            id: 'agent-5-0',
            title: 'Vex creó producto',
            description: 'POST /store/products',
            created_at: d('2026-11-02T10:00:00Z'),
            ref: { agent: 'vex' },
          },
        ],
        purges: [
          {
            id: 3,
            user_id: 2,
            agent_key: 'vex',
            counts: { messages: 12 },
            created_at: d('2026-11-03T10:00:00Z'),
          },
        ],
        users: [
          { id: 1, first_name: 'Ana', last_name: 'Ruiz' },
          { id: 2, first_name: 'Luis', last_name: null },
        ],
      });

      const page = await service.listChanges({});

      expect(page.items.map((e) => e.kind)).toEqual([
        'conversation_purged',
        'agent_action',
        'switch',
      ]);
      expect(page.total).toBe(3);
      expect(page.items[0].actor).toEqual({ user_id: 2, name: 'Luis' });
      expect(page.items[0].summary).toContain('12 mensajes');
      expect(page.items[1].actor).toBeNull();
      expect(page.items[2]).toMatchObject({
        agent_key: 'vexi',
        summary: 'Encendió Vexi',
        actor: { user_id: 1, name: 'Ana Ruiz' },
      });
    });

    it('solo cuenta cambios reales del interruptor', async () => {
      const { service } = setup({
        audits: [
          {
            id: 1,
            user_id: 1,
            created_at: d('2026-11-01T10:00:00Z'),
            new_values: { vex: { old: { enabled: true }, new: { enabled: true } } },
          },
          {
            id: 2,
            user_id: 1,
            created_at: d('2026-11-01T11:00:00Z'),
            new_values: { inventory: { old: {}, new: {} } },
          },
          {
            id: 3,
            user_id: 1,
            created_at: d('2026-11-01T12:00:00Z'),
            new_values: { vex: { old: { enabled: true }, new: { enabled: false } } },
          },
        ],
      });
      const page = await service.listChanges({});
      expect(page.items.map((e) => e.summary)).toEqual(['Apagó Vex']);
    });

    it('aísla por tienda: todas las consultas fijan el store_id del contexto', async () => {
      const { service, prisma } = setup({});
      await service.listChanges({});

      expect(prisma.audit_logs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resource: 'settings',
            resource_id: STORE_ID,
          }),
        }),
      );
      expect(prisma.ai_conversation_purges.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: STORE_ID } }),
      );
    });

    it('sin tienda en el contexto no consulta nada', async () => {
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);
      const { service, prisma } = setup({});
      const page = await service.listChanges({});
      expect(page.items).toEqual([]);
      expect(prisma.audit_logs.findMany).not.toHaveBeenCalled();
    });

    it('las constancias de borrado no seleccionan ni exponen contenido', async () => {
      const { service, prisma } = setup({
        purges: [
          {
            id: 3,
            user_id: 2,
            agent_key: 'vexi',
            counts: { messages: 2 },
            created_at: d('2026-11-03T10:00:00Z'),
          },
        ],
      });
      const page = await service.listChanges({});
      const select = (prisma.ai_conversation_purges.findMany.mock.calls[0] as any)[0].select;
      expect(Object.keys(select).sort()).toEqual(
        ['agent_key', 'counts', 'created_at', 'id', 'user_id'].sort(),
      );
      expect(Object.keys(page.items[0]).sort()).toEqual(
        ['actor', 'agent_key', 'created_at', 'id', 'kind', 'summary'].sort(),
      );
    });

    it('filtra por agente y pagina con tope de 50', async () => {
      const actions = Array.from({ length: 60 }, (_, i) => ({
        id: `agent-${i}-0`,
        title: 't',
        description: '',
        created_at: new Date(2026, 10, 1, 0, 0, 60 - i),
        ref: { agent: i % 2 ? 'vex' : 'vexi' },
      }));
      const { service, feed } = setup({ actions });

      const all = await service.listChanges({ limit: 500 });
      expect(all.limit).toBe(50);
      expect(all.items).toHaveLength(50);

      const vex = await service.listChanges({ agent: 'vex', limit: 10, page: 2 });
      expect(vex.total).toBe(30);
      expect(vex.items).toHaveLength(10);
      expect(vex.items.every((e) => e.agent_key === 'vex')).toBe(true);
      expect(feed.recentAgentActions).toHaveBeenLastCalledWith(20);
    });
  });

  describe('listConversations', () => {
    it('acota a la tienda, no trae contenido y marca las propias', async () => {
      const { service, prisma } = setup({
        conversations: [
          {
            id: 9,
            user_id: 1,
            title: 'Mía',
            metadata: { agent_key: 'vex' },
            created_at: d('2026-11-01T10:00:00Z'),
            updated_at: d('2026-11-02T10:00:00Z'),
            _count: { messages: 4 },
          },
          {
            id: 8,
            user_id: 2,
            title: null,
            metadata: null,
            created_at: d('2026-11-01T09:00:00Z'),
            updated_at: d('2026-11-01T09:30:00Z'),
            _count: { messages: 1 },
          },
        ],
        users: [
          { id: 1, first_name: 'Ana', last_name: 'Ruiz' },
          { id: 2, first_name: 'Luis', last_name: 'Paz' },
        ],
      });

      const page = await service.listConversations({});

      const args = (prisma.ai_conversations.findMany.mock.calls[0] as any)[0];
      expect(args.where).toMatchObject({
        store_id: STORE_ID,
        status: { not: 'deleted' },
      });
      expect(args.select.messages).toBeUndefined();
      expect(args.select.summary).toBeUndefined();
      expect(page.items).toEqual([
        expect.objectContaining({
          id: 9,
          agent_key: 'vex',
          user: { id: 1, name: 'Ana Ruiz' },
          message_count: 4,
          is_own: true,
        }),
        expect.objectContaining({
          id: 8,
          agent_key: 'vexi',
          user: { id: 2, name: 'Luis Paz' },
          message_count: 1,
          is_own: false,
        }),
      ]);
      for (const item of page.items) {
        expect(item).not.toHaveProperty('messages');
        expect(item).not.toHaveProperty('metadata');
      }
    });

    it('pagina con skip/take y tope de 50, y filtra por agente', async () => {
      const { service, prisma } = setup({});
      await service.listConversations({ page: 3, limit: 999, agent: 'vex' });
      const args = (prisma.ai_conversations.findMany.mock.calls[0] as any)[0];
      expect(args.take).toBe(50);
      expect(args.skip).toBe(100);
      expect(args.where.metadata).toEqual({ path: ['agent_key'], equals: 'vex' });
    });

    it('sin tienda en el contexto no consulta', async () => {
      jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined);
      const { service, prisma } = setup({});
      expect((await service.listConversations({})).items).toEqual([]);
      expect(prisma.ai_conversations.findMany).not.toHaveBeenCalled();
    });
  });
});
