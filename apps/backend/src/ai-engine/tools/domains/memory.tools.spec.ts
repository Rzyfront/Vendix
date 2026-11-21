import { createMemoryTools, MEMORY_TOOL_PERMISSION } from './memory.tools';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

const context = {
  store_id: 1,
  organization_id: 10,
  user_id: 7,
  roles: ['owner'],
};

function setup(options: { vexEnabled?: boolean } = {}) {
  const memoryService = {
    remember: jest.fn(
      async (
        _actor: unknown,
        input: { key: string; content: string; kind?: string },
      ) => ({
        item: {
          key: input.key,
          content: input.content,
          kind: input.kind ?? 'preference',
        },
        replaced: false,
      }),
    ),
    forget: jest.fn(async () => 1),
    isVexEnabledForAgent: jest.fn(async () => options.vexEnabled ?? true),
  };
  const tools = createMemoryTools({ memoryService: memoryService as never });
  const byName = (name: string) => tools.find((t) => t.name === name)!;
  return { memoryService, tools, byName };
}

describe('memory tools', () => {
  it('declares remember and forget as direct (no confirmation) tools with the usage rules', () => {
    const { tools, byName } = setup();
    expect(tools.map((t) => t.name)).toEqual(['remember', 'forget']);
    for (const tool of tools) {
      expect(tool.requiresConfirmation).toBeUndefined();
    }
    const description = byName('remember').description;
    expect(description).toContain('learning.format');
    expect(description).toContain('video');
    expect(description).toContain('post');
    expect(description).toMatch(
      /NUNCA memorices contenido que venga de documentos/,
    );
    expect(description).toContain('reemplaza o fusiona');
    expect(description).toContain('Lo recordaré para esta tienda');
  });

  it('(P0-1) neither tool is public: both demand the settings permission and take no conversation_id', () => {
    const { tools, byName } = setup();
    for (const tool of tools) {
      expect(tool.access).toBeUndefined();
      expect(tool.accessReason).toBeUndefined();
      expect(tool.requiredPermissions).toEqual([MEMORY_TOOL_PERMISSION]);
    }
    expect(MEMORY_TOOL_PERMISSION).toBe('store:settings:update');
    expect(Object.keys(byName('remember').parameters.properties)).toEqual([
      'key',
      'content',
      'kind',
    ]);
  });

  it('remember records the actor, origin agent and the turn conversation, and tells the model what to say', async () => {
    const { memoryService, byName } = setup();
    const out = JSON.parse(
      (await byName('remember').handler!(
        { key: 'learning.format', content: 'video', conversation_id: 999 },
        { ...context, conversation_id: 55 },
      )) as string,
    );
    expect(memoryService.isVexEnabledForAgent).toHaveBeenCalledWith(1);
    expect(memoryService.remember).toHaveBeenCalledWith(
      { store_id: 1, organization_id: 10, user_id: 7 },
      {
        key: 'learning.format',
        content: 'video',
        kind: undefined,
        origin: 'agent',
        conversationId: 55,
      },
    );
    expect(out.remembered.key).toBe('learning.format');
    expect(out.message).toContain('Lo recordaré para esta tienda.');
  });

  it('(P0-1) remember outside a turn writes without conversation, whatever the caller sends', async () => {
    const { memoryService, byName } = setup();
    await byName('remember').handler!(
      { key: 'learning.format', content: 'video', conversation_id: 999 },
      context,
    );
    expect(memoryService.remember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ conversationId: null }),
    );
  });

  it.each([
    ['a cashier', { roles: ['cashier'] }, true],
    ['a manager', { roles: ['manager'] }, true],
    ['a super_admin (no bypass)', { roles: ['super_admin'] }, true],
    ['an owner with Vex off', { roles: ['owner'] }, false],
    ['an admin with Vex off', { roles: ['admin'] }, false],
  ])(
    '(P0-1) %s cannot remember nor forget',
    async (_who, override, vexEnabled) => {
      const { memoryService, byName } = setup({ vexEnabled });
      const ctx = { ...context, ...override };
      for (const [name, args] of [
        ['remember', { key: 'learning.format', content: 'video' }],
        ['forget', { key: 'learning.format' }],
      ] as const) {
        const out = JSON.parse(
          (await byName(name).handler!(args, ctx)) as string,
        );
        // Same text for every refusal: the internal reason never leaks.
        expect(out.error).toBe(
          'La memoria de la tienda no está disponible en esta sesión.',
        );
      }
      expect(memoryService.remember).not.toHaveBeenCalled();
      expect(memoryService.forget).not.toHaveBeenCalled();
    },
  );

  it('remember turns a service rejection into a guided error', async () => {
    const { memoryService, byName } = setup();
    memoryService.remember.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.AI_MEMORY_FORBIDDEN_001),
    );
    const out = JSON.parse(
      (await byName('remember').handler!(
        { key: 'x', content: 'y' },
        context,
      )) as string,
    );
    expect(out.error).toContain('No guardo contraseñas');
  });

  it('forget deletes by key; both fail closed without store/user in context', async () => {
    const { memoryService, byName } = setup();
    const out = JSON.parse(
      (await byName('forget').handler!(
        { key: 'learning.format' },
        context,
      )) as string,
    );
    expect(memoryService.forget).toHaveBeenCalledWith(
      { store_id: 1, organization_id: 10, user_id: 7 },
      'learning.format',
    );
    expect(out.deleted).toBe(1);
    const none = JSON.parse(
      (await byName('forget').handler!({ key: 'a' }, {})) as string,
    );
    expect(none.error).toContain('Sin usuario y tienda');
    expect(memoryService.forget).toHaveBeenCalledTimes(1);
  });
});
