import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AIChatService } from './ai-chat.service';
import { UpdateConversationTitleDto } from './dto/update-conversation-title.dto';
import { RequestContextService } from '../../../common/context/request-context.service';

const context = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  is_super_admin: false,
  is_owner: false,
};

async function errorsFor(title: unknown) {
  const dto = plainToInstance(UpdateConversationTitleDto, { title });
  return validate(dto);
}

function buildService(found: Record<string, unknown> | null) {
  const findFirst = jest.fn().mockResolvedValue(found);
  const update = jest.fn().mockImplementation(async ({ data }) => ({
    ...(found ?? {}),
    ...data,
  }));
  const service = Object.assign(
    Object.create(AIChatService.prototype) as AIChatService,
    { prisma: { ai_conversations: { findFirst, update } } },
  ) as AIChatService;
  return { service, findFirst, update };
}

describe('T3 rename conversation', () => {
  it('DTO accepts a valid trimmed title', async () => {
    expect(await errorsFor('  Ventas de octubre  ')).toHaveLength(0);
    const dto = plainToInstance(UpdateConversationTitleDto, {
      title: '  Ventas de octubre  ',
    });
    expect(dto.title).toBe('Ventas de octubre');
  });

  it('DTO rejects empty, whitespace-only and 81 chars; accepts 80', async () => {
    expect((await errorsFor('')).length).toBeGreaterThan(0);
    expect((await errorsFor('    ')).length).toBeGreaterThan(0);
    expect((await errorsFor('a'.repeat(81))).length).toBeGreaterThan(0);
    expect(await errorsFor('a'.repeat(80))).toHaveLength(0);
  });

  it('sets title and title_source=user, preserving agent_key', async () => {
    const { service, update } = buildService({
      id: 9,
      user_id: 3,
      title: 'viejo',
      metadata: { agent_key: 'vex', title_source: 'auto' },
    });
    await RequestContextService.run(context, async () => {
      await service.updateTitle(9, 'Nuevo nombre');
    });
    const data = update.mock.calls[0][0].data;
    expect(data.title).toBe('Nuevo nombre');
    expect(data.metadata).toEqual({ agent_key: 'vex', title_source: 'user' });
  });

  it('handles null metadata', async () => {
    const { service, update } = buildService({
      id: 9,
      user_id: 3,
      title: null,
      metadata: null,
    });
    await RequestContextService.run(context, async () => {
      await service.updateTitle(9, 'X');
    });
    expect(update.mock.calls[0][0].data.metadata).toEqual({
      title_source: 'user',
    });
  });

  it("another user's conversation yields AI_CHAT_001 and no update", async () => {
    const { service, findFirst, update } = buildService(null);
    await RequestContextService.run(context, async () => {
      await expect(service.updateTitle(9, 'X')).rejects.toMatchObject({
        errorCode: 'AI_CHAT_001',
      });
    });
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 9, user_id: 3 });
    expect(update).not.toHaveBeenCalled();
  });
});
