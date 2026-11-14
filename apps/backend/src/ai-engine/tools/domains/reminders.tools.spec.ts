import { AIToolRegistry } from '../ai-tool-registry';
import { buildToolDocument } from '../tool-catalog';
import { TOOL_DISCOVERY_QUERIES_ES } from '../tool-discovery-queries.es';
import { RegisteredTool, ToolExecutionContext } from '../interfaces/tool.interface';
import { createReminderTools } from './reminders.tools';
import { RemindersService } from '../../../domains/store/reminders/reminders.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { createFakeRemindersPrisma } from '../../../domains/store/reminders/testing/fake-reminders-prisma';

const ANA_S1: ToolExecutionContext = { store_id: 1, organization_id: 1, user_id: 10 };
const BETO_S1: ToolExecutionContext = { store_id: 1, organization_id: 1, user_id: 11 };
const CARLA_S2: ToolExecutionContext = { store_id: 2, organization_id: 2, user_id: 20 };

function build() {
  const prisma = createFakeRemindersPrisma([
    { id: 1, store_id: 1, user_id: 10, title: 'Llamar al proveedor de lácteos' },
    { id: 2, store_id: 1, user_id: 11, title: 'Pendiente de Beto' },
    { id: 3, store_id: 2, user_id: 20, title: 'Pendiente de Carla' },
  ]);
  const remindersService = new RemindersService(prisma as unknown as StorePrismaService);
  const tools = createReminderTools({ remindersService });
  const tool = (name: string) => tools.find((t) => t.name === name) as RegisteredTool;
  const call = async (name: string, args: Record<string, unknown>, ctx: ToolExecutionContext) =>
    JSON.parse(await tool(name).handler!(args, ctx));
  return { prisma, tools, tool, call };
}

describe('reminders tools — Vex only sees the current user reminders (QUI-580)', () => {
  it('list_reminders returns only the caller reminders in the caller store', async () => {
    const { call } = build();
    const titles = async (ctx: ToolExecutionContext) =>
      (await call('list_reminders', { filter: 'all' }, ctx)).reminders.map((r: any) => r.title);
    expect(await titles(ANA_S1)).toEqual(['Llamar al proveedor de lácteos']);
    expect(await titles(BETO_S1)).toEqual(['Pendiente de Beto']);
    expect(await titles(CARLA_S2)).toEqual(['Pendiente de Carla']);
  });

  it('cannot complete, edit nor delete a reminder of another user or store', async () => {
    const { call, prisma, tool } = build();
    for (const ctx of [BETO_S1, CARLA_S2]) {
      expect((await call('complete_reminder', { reminder_id: 1 }, ctx)).error).toBeDefined();
      expect(
        (await call('update_reminder', { reminder_id: 1, title: 'x' }, ctx)).error,
      ).toBeDefined();
      expect((await call('delete_reminder', { reminder_id: 1 }, ctx)).error).toBeDefined();
      const preview = await tool('delete_reminder').preview!({ reminder_id: 1 }, ctx);
      expect(preview.status).toBe('error');
    }
    expect(prisma.rows.find((r) => r.id === 1)).toMatchObject({
      title: 'Llamar al proveedor de lácteos',
      status: 'pending',
    });
  });

  it('refuses to act without a user and store in context', async () => {
    const { call } = build();
    const out = await call('list_reminders', {}, { organization_id: 1 });
    expect(out.error).toMatch(/Sin usuario y tienda/);
  });

  it('create_reminder stores it for the caller with source vex and a product link', async () => {
    const { call, prisma } = build();
    const out = await call(
      'create_reminder',
      {
        title: 'Revisar el stock',
        remind_at: '2026-11-14T17:00',
        link_type: 'product',
        link_id: 501,
      },
      BETO_S1,
    );
    expect(out.created).toMatchObject({
      title: 'Revisar el stock',
      source: 'vex',
      link: { type: 'product', id: 501, label: 'Coca-Cola 1.5L', url: '/admin/products/501' },
    });
    expect(out.display).toContain('Coca-Cola 1.5L');
    expect(prisma.rows.find((r) => r.id === out.created.reminder_id)).toMatchObject({
      store_id: 1,
      user_id: 11,
      source: 'vex',
    });
  });

  it('ignores store or user ids smuggled in the arguments', async () => {
    const { call, prisma } = build();
    const out = await call('create_reminder', { title: 'y', store_id: 2, user_id: 20 }, BETO_S1);
    expect(prisma.rows.find((r) => r.id === out.created.reminder_id)).toMatchObject({
      store_id: 1,
      user_id: 11,
    });
  });

  it('completes and reopens the caller reminder', async () => {
    const { call } = build();
    expect((await call('complete_reminder', { reminder_id: 1 }, ANA_S1)).updated.status).toBe('done');
    expect(
      (await call('complete_reminder', { reminder_id: 1, done: false }, ANA_S1)).updated.status,
    ).toBe('pending');
  });

  it('delete_reminder asks for confirmation with a preview naming the reminder', async () => {
    const { tool, call, prisma } = build();
    const del = tool('delete_reminder');
    expect(del.requiresConfirmation).toBe(true);
    expect(del.irreversible).toBe(true);
    const preview = await del.preview!({ reminder_id: 1 }, ANA_S1);
    expect(preview).toMatchObject({ status: 'warning', domain: 'reminders' });
    expect(preview.target).toContain('Llamar al proveedor de lácteos');
    await call('delete_reminder', { reminder_id: 1 }, ANA_S1);
    expect(prisma.rows.find((r) => r.id === 1)).toBeUndefined();
  });

  it('registers in the real registry with discovery queries; only delete needs confirmation', () => {
    const { tools } = build();
    const registry = new AIToolRegistry({} as any);
    registry.registerMany(tools);
    const names = registry.getAvailableDefinitions([]).map((d) => d.function.name).sort();
    expect(names).toEqual([
      'complete_reminder',
      'create_reminder',
      'delete_reminder',
      'list_reminders',
      'update_reminder',
    ]);
    for (const t of tools) {
      expect(TOOL_DISCOVERY_QUERIES_ES[t.name]?.length).toBeGreaterThan(0);
      expect(() => buildToolDocument(t)).not.toThrow();
      expect(!!t.requiresConfirmation).toBe(t.name === 'delete_reminder');
    }
    expect(registry.get('list_reminders')!.readOnly).toBe(true);
  });
});
