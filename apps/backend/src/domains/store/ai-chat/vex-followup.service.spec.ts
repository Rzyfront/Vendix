import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors';
import { Followup } from '../../../ai-engine/tools/domains/followup.tools';
import { VexFollowupService } from './vex-followup.service';

const FOLLOWUP: Followup = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'reminder',
  title: 'Llamar a la distribuidora',
  note: null,
  remind_at: '2026-11-27T14:00:00.000Z',
  link_type: null,
  link_id: null,
  link_label: null,
  source_phrase: 'el viernes llamo al proveedor',
  status: 'suggested',
  reminder_id: null,
};

type Row = Record<string, any>;

function build(seed?: { conversations?: Row[]; messages?: Row[] }) {
  const conversations: Row[] = seed?.conversations ?? [
    { id: 5, store_id: 1, user_id: 7, metadata: { agent_key: 'vex' } },
    { id: 6, store_id: 1, user_id: 8, metadata: { agent_key: 'vex' } },
    { id: 7, store_id: 2, user_id: 7, metadata: { agent_key: 'vex' } },
    { id: 8, store_id: 1, user_id: 7, metadata: { agent_key: 'vexi' } },
    { id: 9, store_id: 1, user_id: 7, metadata: null },
  ];
  const messages: Row[] = seed?.messages ?? [
    {
      id: 50,
      conversation_id: 5,
      role: 'assistant',
      metadata: { blocks: [{ block_id: 'b1' }], followups: [FOLLOWUP] },
    },
    { id: 51, conversation_id: 5, role: 'assistant', metadata: null },
    { id: 60, conversation_id: 6, role: 'assistant', metadata: { followups: [FOLLOWUP] } },
  ];
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma = {
    ai_conversations: {
      findFirst: jest.fn(async ({ where }: any) =>
        conversations.find((row) => matches(row, where)) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = conversations.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    ai_messages: {
      findMany: jest.fn(async ({ where }: any) =>
        messages.filter((row) => matches(row, where)),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = messages.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  };
  const reminders = {
    actorFromRequest: jest.fn(() => {
      const context = RequestContextService.getContext()!;
      return { store_id: context.store_id!, user_id: context.user_id! };
    }),
    create: jest.fn(async (_actor: any, dto: any) => ({
      id: 900,
      title: dto.title,
      note: dto.note ?? null,
      remind_at: dto.remind_at ? new Date(dto.remind_at) : null,
    })),
  };
  const service = new VexFollowupService(prisma as never, reminders as never);
  const as = <T>(user_id: number, store_id: number, fn: () => Promise<T>) =>
    RequestContextService.run({ user_id, store_id } as never, fn);
  return { service, prisma, reminders, conversations, messages, as };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(VendixHttpException);
    return (error as any).errorCode ?? (error as any).getResponse?.()?.error_code;
  }
  throw new Error('expected a rejection');
};

describe('VexFollowupService', () => {
  it('reads the guard state: muted flag and every known followup', async () => {
    const { service, conversations, as } = build();
    expect(await as(7, 1, () => service.getState(5, 7))).toEqual({
      muted: false,
      known: [FOLLOWUP],
    });
    conversations[0].metadata.followups_muted = true;
    expect((await as(7, 1, () => service.getState(5, 7)))!.muted).toBe(true);
  });

  it('has no state for another user, another store, Vexi or legacy threads', async () => {
    const { service, as } = build();
    expect(await as(7, 1, () => service.getState(6, 7))).toBeNull();
    expect(await as(7, 1, () => service.getState(7, 7))).toBeNull();
    expect(await as(7, 1, () => service.getState(8, 7))).toBeNull();
    expect(await as(7, 1, () => service.getState(9, 7))).toBeNull();
  });

  it('save creates the reminder as source vex and marks the card saved', async () => {
    const { service, reminders, messages, as } = build();
    const result = await as(7, 1, () => service.save(5, FOLLOWUP.id, {}));
    expect(reminders.create).toHaveBeenCalledTimes(1);
    expect(reminders.create).toHaveBeenCalledWith(
      { store_id: 1, user_id: 7 },
      expect.objectContaining({
        title: 'Llamar a la distribuidora',
        remind_at: '2026-11-27T14:00:00.000Z',
      }),
      'vex',
    );
    expect(result.followup).toMatchObject({ status: 'saved', reminder_id: 900 });
    // The rest of the message metadata survives the write.
    expect(messages[0].metadata.blocks).toEqual([{ block_id: 'b1' }]);
    expect(messages[0].metadata.followups[0]).toMatchObject({
      id: FOLLOWUP.id,
      status: 'saved',
      reminder_id: 900,
    });
  });

  it('save applies the edits of the card; a null date makes it a log entry', async () => {
    const { service, reminders, as } = build();
    const result = await as(7, 1, () =>
      service.save(5, FOLLOWUP.id, { title: 'Llamar el lunes', remind_at: null }),
    );
    expect(reminders.create.mock.calls[0][1]).toMatchObject({
      title: 'Llamar el lunes',
      remind_at: null,
    });
    expect(result.followup).toMatchObject({
      kind: 'log_entry',
      title: 'Llamar el lunes',
      remind_at: null,
    });
  });

  it('saving twice does not create a second reminder', async () => {
    const { service, reminders, as } = build();
    await as(7, 1, () => service.save(5, FOLLOWUP.id, {}));
    const again = await as(7, 1, () => service.save(5, FOLLOWUP.id, {}));
    expect(reminders.create).toHaveBeenCalledTimes(1);
    expect(again.followup.status).toBe('saved');
  });

  it('dismiss marks the card and a dismissed card cannot be saved', async () => {
    const { service, reminders, messages, as } = build();
    const result = await as(7, 1, () => service.dismiss(5, FOLLOWUP.id));
    expect(result.followup.status).toBe('dismissed');
    expect(messages[0].metadata.followups[0].status).toBe('dismissed');
    expect(
      await code(as(7, 1, () => service.save(5, FOLLOWUP.id, {}))),
    ).toBe('AI_CHAT_007');
    expect(reminders.create).not.toHaveBeenCalled();
  });

  it('answers 404 and writes nothing for a foreign conversation or unknown card', async () => {
    const { service, reminders, prisma, as } = build();
    // Conversation 6 belongs to user 8; conversation 7 to store 2.
    expect(await code(as(7, 1, () => service.save(6, FOLLOWUP.id, {})))).toBe(
      'AI_CHAT_001',
    );
    expect(await code(as(7, 1, () => service.dismiss(7, FOLLOWUP.id)))).toBe(
      'AI_CHAT_001',
    );
    expect(await code(as(7, 1, () => service.setMuted(8, true)))).toBe(
      'AI_CHAT_001',
    );
    expect(
      await code(
        as(7, 1, () =>
          service.save(5, '22222222-2222-4222-8222-222222222222', {}),
        ),
      ),
    ).toBe('AI_CHAT_006');
    expect(reminders.create).not.toHaveBeenCalled();
    expect(prisma.ai_messages.update).not.toHaveBeenCalled();
    expect(prisma.ai_conversations.update).not.toHaveBeenCalled();
  });

  it('mute keeps the rest of the conversation metadata', async () => {
    const { service, conversations, as } = build();
    await as(7, 1, () => service.setMuted(5, true));
    expect(conversations[0].metadata).toEqual({
      agent_key: 'vex',
      followups_muted: true,
    });
  });
});
