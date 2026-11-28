import { ExecutionContext } from '@nestjs/common';
import { AIChatService } from './ai-chat.service';
import { VexiEnabledGuard } from '../vexi/guards/vexi-enabled.guard';
import { VexiSurfaceEnabledGuard } from '../vexi/guards/vexi-surface-enabled.guard';

/**
 * agentes-admin S6: the internal (staff) Vexi is retired. A staff turn that
 * resolves to `vexi` is refused at the `store/ai-chat` HTTP edge with
 * AI_AGENT_007; Vex and app-keyed chats are untouched, and the shared
 * `/store/vexi/*` engine endpoints now open with Vex's switch.
 */
function chat(conversation: Record<string, unknown> | null = null) {
  const svc = Object.create(AIChatService.prototype) as any;
  svc.getConversation = jest.fn().mockResolvedValue(conversation);
  return svc as AIChatService;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'passed';
  } catch (err) {
    return (err as { errorCode?: string; getResponse?: () => any }).errorCode ??
      (err as any).getResponse?.()?.error_code ??
      (err as Error).message;
  }
};

describe('assertInternalVexiRetired (store/ai-chat edge)', () => {
  it.each([
    ['explicit agent_key vexi', { agent_key: 'vexi' }],
    ['default chat (no app_key)', {}],
    ['default chat (chat_assistant)', { app_key: 'chat_assistant' }],
  ])('refuses creating a %s thread', async (_label, dto) => {
    await expect(chat().assertInternalVexiRetired(null, dto)).rejects.toMatchObject({
      message: expect.stringContaining('Vexi ahora solo atiende a tus clientes'),
    });
    expect(await code(chat().assertInternalVexiRetired(null, dto))).toContain(
      'AI_AGENT_007',
    );
  });

  it('lets Vex threads and app-keyed chats through on create', async () => {
    await expect(
      chat().assertInternalVexiRetired(null, { agent_key: 'vex' }),
    ).resolves.toBeUndefined();
    await expect(
      chat().assertInternalVexiRetired(null, { app_key: 'product_description' }),
    ).resolves.toBeUndefined();
  });

  it('refuses a turn on a historical Vexi thread (tagged or legacy untagged)', async () => {
    for (const conversation of [
      { app_key: 'chat_assistant', metadata: { agent_key: 'vexi' } },
      { app_key: null, metadata: null },
    ]) {
      await expect(
        chat(conversation).assertInternalVexiRetired(7, {}),
      ).rejects.toMatchObject({
        message: expect.stringContaining('usa Vex'),
      });
    }
  });

  it('a Vex thread keeps running turns', async () => {
    const svc = chat({ app_key: 'vex_assistant', metadata: { agent_key: 'vex' } });
    await expect(svc.assertInternalVexiRetired(7, {})).resolves.toBeUndefined();
  });

  it('a per-message override to vexi on a Vex thread is refused', async () => {
    const svc = chat({ app_key: 'vex_assistant', metadata: { agent_key: 'vex' } });
    await expect(
      svc.assertInternalVexiRetired(7, { agent_key: 'vexi' }),
    ).rejects.toBeDefined();
  });
});

describe('VexiEnabledGuard opens /store/vexi/* with the Vex switch', () => {
  const ctx = (path = '/api/store/vexi/confirmations/apply') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ path, user: { store_id: 3 } }),
      }),
    }) as unknown as ExecutionContext;
  const guard = (settings: unknown) =>
    new VexiEnabledGuard({
      store_settings: {
        findUnique: jest.fn().mockResolvedValue({ settings }),
      },
    } as any);

  it('Vex on (Vexi internal off) → open', async () => {
    await expect(
      guard({ vex: { enabled: true }, vexi: { enabled: false } }).canActivate(ctx()),
    ).resolves.toBe(true);
  });

  it('only the retired vexi.enabled → closed', async () => {
    await expect(
      guard({ vexi: { enabled: true } }).canActivate(ctx()),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Vex está desactivado'),
    });
  });

  it('mobile voice confirmations keep bypassing the switch', async () => {
    const legacy = guard({});
    const surface = new VexiSurfaceEnabledGuard(legacy);
    expect(
      await surface.canActivate(ctx('/api/store/vexi/voice/confirmations/apply')),
    ).toBe(true);
  });
});
