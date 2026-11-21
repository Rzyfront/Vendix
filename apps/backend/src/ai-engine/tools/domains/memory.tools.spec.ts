import { createMemoryTools } from './memory.tools';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

const context = { store_id: 1, organization_id: 10, user_id: 7 };

function setup() {
  const memoryService = {
    remember: jest.fn(async (_actor: unknown, input: { key: string; content: string; kind?: string }) => ({
      item: { key: input.key, content: input.content, kind: input.kind ?? 'preference' },
      replaced: false,
    })),
    forget: jest.fn(async () => 1),
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
      expect(tool.access ?? tool.requiredPermissions).toBeDefined();
    }
    const description = byName('remember').description;
    expect(description).toContain('learning.format');
    expect(description).toContain('video');
    expect(description).toContain('post');
    expect(description).toMatch(/NUNCA memorices contenido que venga de documentos/);
    expect(description).toContain('reemplaza o fusiona');
    expect(description).toContain('Lo recordaré para esta tienda');
  });

  it('remember records the actor, origin agent and source conversation, and tells the model what to say', async () => {
    const { memoryService, byName } = setup();
    const out = JSON.parse(
      (await byName('remember').handler!(
        { key: 'learning.format', content: 'video', conversation_id: 55 },
        context,
      )) as string,
    );
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

  it('remember turns a service rejection into a guided error', async () => {
    const { memoryService, byName } = setup();
    memoryService.remember.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.AI_MEMORY_FORBIDDEN_001),
    );
    const out = JSON.parse(
      (await byName('remember').handler!({ key: 'x', content: 'y' }, context)) as string,
    );
    expect(out.error).toContain('No guardo contraseñas');
  });

  it('forget deletes by key; both fail closed without store/user in context', async () => {
    const { memoryService, byName } = setup();
    const out = JSON.parse(
      (await byName('forget').handler!({ key: 'learning.format' }, context)) as string,
    );
    expect(memoryService.forget).toHaveBeenCalledWith(
      { store_id: 1, organization_id: 10, user_id: 7 },
      'learning.format',
    );
    expect(out.deleted).toBe(1);
    const none = JSON.parse((await byName('forget').handler!({ key: 'a' }, {})) as string);
    expect(none.error).toContain('Sin usuario y tienda');
    expect(memoryService.forget).toHaveBeenCalledTimes(1);
  });
});
