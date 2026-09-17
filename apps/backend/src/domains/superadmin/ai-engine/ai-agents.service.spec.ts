import { ConflictException, NotFoundException } from '@nestjs/common';
import { AIAgentsService } from './ai-agents.service';
import { ErrorCodes } from '../../../common/errors';

describe('AIAgentsService (F4)', () => {
  let service: AIAgentsService;
  let prisma: {
    ai_agents: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    ai_engine_applications: {
      findUnique: jest.Mock;
    };
  };
  let toolRegistry: {
    get: jest.Mock;
    canonicalName: jest.Mock;
  };

  const vexiRow = {
    id: 1,
    key: 'vexi',
    name: 'Vexi',
    description: null,
    app_key: 'chat_assistant',
    system_prompt: null,
    allowed_tools: [],
    max_iterations: null,
    requires_confirmation_default: false,
    is_active: true,
  };

  beforeEach(() => {
    prisma = {
      ai_agents: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      ai_engine_applications: {
        findUnique: jest.fn(),
      },
    };
    toolRegistry = {
      get: jest.fn(),
      canonicalName: jest.fn((name: string) => name),
    };

    service = new AIAgentsService(prisma as any, toolRegistry as any);
  });

  it('creates the vexi-equivalent row with defaults', async () => {
    prisma.ai_agents.findUnique.mockResolvedValueOnce(null);
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce({ id: 7 });
    prisma.ai_agents.create.mockImplementationOnce(async ({ data }: any) => ({
      id: 1,
      ...data,
    }));

    const result = await service.create({
      key: 'vexi',
      name: 'Vexi',
      app_key: 'chat_assistant',
    } as any);

    expect(prisma.ai_agents.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'vexi',
        app_key: 'chat_assistant',
        system_prompt: null,
        allowed_tools: [],
        max_iterations: null,
        requires_confirmation_default: false,
        is_active: true,
      }),
    });
    expect(result).toMatchObject({ key: 'vexi' });
  });

  it('rejects a duplicate key without touching the database write path', async () => {
    prisma.ai_agents.findUnique.mockResolvedValueOnce(vexiRow);

    await expect(
      service.create({ key: 'vexi', name: 'Otro' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.ai_agents.create).not.toHaveBeenCalled();
  });

  it('rejects an app_key that does not exist in ai_engine_applications', async () => {
    prisma.ai_agents.findUnique.mockResolvedValueOnce(null);
    prisma.ai_engine_applications.findUnique.mockResolvedValueOnce(null);

    const err = await service
      .create({ key: 'x', name: 'X', app_key: 'no-existe' } as any)
      .catch((e) => e);

    expect(err?.errorCode).toBe(ErrorCodes.AI_APP_001.code);
    expect(prisma.ai_agents.create).not.toHaveBeenCalled();
  });

  it('accepts unknown allowed_tools (soft validation) instead of rejecting', async () => {
    prisma.ai_agents.findUnique.mockResolvedValueOnce(null);
    toolRegistry.get.mockReturnValue(undefined);
    prisma.ai_agents.create.mockImplementationOnce(async ({ data }: any) => ({
      id: 2,
      ...data,
    }));

    const result = await service.create({
      key: 'soporte-menu',
      name: 'Soporte',
      allowed_tools: ['tool_que_aun_no_existe'],
    } as any);

    expect(result).toMatchObject({
      allowed_tools: ['tool_que_aun_no_existe'],
    });
  });

  it('lists with the same paginated shape as the apps CRUD', async () => {
    prisma.ai_agents.findMany.mockResolvedValueOnce([vexiRow]);
    prisma.ai_agents.count.mockResolvedValueOnce(1);

    const result = await service.findAll({ page: 1, limit: 10 } as any);

    expect(result).toEqual({
      data: [vexiRow],
      meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    });
  });

  it('findByKey returns null for unknown keys (chat falls back)', async () => {
    prisma.ai_agents.findUnique.mockResolvedValueOnce(null);

    await expect(service.findByKey('fantasma')).resolves.toBeNull();
  });

  it('throws NotFoundException on update/remove of a missing agent', async () => {
    prisma.ai_agents.findUnique.mockResolvedValue(null);

    await expect(service.update(999, { name: 'X' } as any)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(999)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.ai_agents.update).not.toHaveBeenCalled();
    expect(prisma.ai_agents.delete).not.toHaveBeenCalled();
  });

  it('rejects renaming onto an existing key', async () => {
    prisma.ai_agents.findUnique
      .mockResolvedValueOnce({ ...vexiRow, id: 2, key: 'soporte-menu' })
      .mockResolvedValueOnce(vexiRow);

    await expect(service.update(2, { key: 'vexi' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.ai_agents.update).not.toHaveBeenCalled();
  });
});
