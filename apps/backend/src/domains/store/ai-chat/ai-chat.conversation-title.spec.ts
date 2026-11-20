import { AIChatService } from './ai-chat.service';
import {
  ConversationTitleService,
  fallbackTitle,
  sanitizeGeneratedTitle,
} from './conversation-title.service';

type Row = { id: number; metadata: Record<string, unknown> | null };

function buildTitles(opts: { run: jest.Mock; row?: Row | null }) {
  const row: Row | null =
    opts.row === undefined
      ? { id: 5, metadata: { agent_key: 'vex' } }
      : opts.row;
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    ai_conversations: {
      findFirst: jest.fn().mockResolvedValue(row),
      update,
    },
  };
  const service = new ConversationTitleService(
    { run: opts.run } as never,
    prisma as never,
  );
  return { service, update };
}

describe('T2 generated conversation title', () => {
  it('uses the generated title, cleaned, and marks title_source=auto', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({
        success: true,
        content: '"Ventas por canal de octubre."\n',
      });
    const { service, update } = buildTitles({ run });
    const title = await service.start(
      5,
      'dame las ventas por canal de octubre',
    );
    expect(title).toBe('Ventas por canal de octubre');
    expect(run).toHaveBeenCalledWith('vex_title_generator', {
      first_message: 'dame las ventas por canal de octubre',
    });
    expect(update.mock.calls[0][0]).toEqual({
      where: { id: 5 },
      data: {
        title: 'Ventas por canal de octubre',
        metadata: { agent_key: 'vex', title_source: 'auto' },
      },
    });
  });

  it('never overwrites a user title', async () => {
    const run = jest.fn().mockResolvedValue({ success: true, content: 'Otro' });
    const { service, update } = buildTitles({
      run,
      row: { id: 5, metadata: { agent_key: 'vex', title_source: 'user' } },
    });
    expect(await service.start(5, 'hola')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it('falls back (title_source=fallback) when the app call throws', async () => {
    const run = jest.fn().mockRejectedValue(new Error('AI_APP_001'));
    const { service, update } = buildTitles({ run });
    const title = await service.start(5, 'Quiero revisar el inventario bajo');
    expect(title).toBe('Quiero revisar el inventario bajo');
    expect(update.mock.calls[0][0].data.metadata).toEqual({
      agent_key: 'vex',
      title_source: 'fallback',
    });
  });

  it('falls back when the response is unsuccessful or empty', async () => {
    const run = jest.fn().mockResolvedValue({ success: false, error: 'x' });
    const { service, update } = buildTitles({ run });
    await service.start(5, 'Hola Vex');
    expect(update.mock.calls[0][0].data.title).toBe('Hola Vex');
    expect(update.mock.calls[0][0].data.metadata.title_source).toBe('fallback');
  });

  it('falls back on timeout without throwing', async () => {
    const run = jest.fn().mockReturnValue(new Promise(() => undefined));
    const { service, update } = buildTitles({ run });
    const title = await service.start(5, 'Resumen de caja de hoy', 20);
    expect(title).toBe('Resumen de caja de hoy');
    expect(update.mock.calls[0][0].data.metadata.title_source).toBe('fallback');
  });

  it('never rejects even if persisting fails', async () => {
    const run = jest
      .fn()
      .mockResolvedValue({ success: true, content: 'Titulo' });
    const { service, update } = buildTitles({ run });
    update.mockRejectedValue(new Error('db down'));
    await expect(service.start(5, 'hola')).resolves.toBeNull();
  });

  it('waitFor returns null if the title is not ready by the deadline', async () => {
    const { service } = buildTitles({ run: jest.fn() });
    const slow = new Promise<string | null>((r) =>
      setTimeout(() => r('x'), 200),
    );
    expect(await service.waitFor(slow, Date.now() + 10)).toBeNull();
    expect(await service.waitFor(Promise.resolve('ya'), Date.now() + 50)).toBe(
      'ya',
    );
  });

  it('sanitize/fallback respect 60 chars at a word boundary, no trailing period', () => {
    const long = 'palabra '.repeat(20);
    expect(fallbackTitle(long).length).toBeLessThanOrEqual(60);
    expect(fallbackTitle(long).endsWith(' ')).toBe(false);
    expect(sanitizeGeneratedTitle('Título: «Cierre de caja».')).toBe(
      'Cierre de caja',
    );
    expect(sanitizeGeneratedTitle('   ')).toBeNull();
    expect(sanitizeGeneratedTitle(undefined)).toBeNull();
  });
});

describe('Vexi/legacy title path stays byte-identical', () => {
  function legacy(conversation: unknown, content: string) {
    const update = jest.fn().mockResolvedValue({});
    const service = Object.assign(
      Object.create(AIChatService.prototype) as AIChatService,
      { prisma: { ai_conversations: { update } } },
    );
    const call = (
      service as unknown as {
        applyLegacyTitle: (c: unknown, t: string) => Promise<void>;
      }
    ).applyLegacyTitle(conversation, content);
    return { call, update };
  }

  it('writes the first message truncated to 80 chars as title, no metadata', async () => {
    const content = 'x'.repeat(100);
    const { call, update } = legacy(
      { id: 8, title: null, messages: [], metadata: null },
      content,
    );
    await call;
    expect(update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { title: 'x'.repeat(80) },
    });
  });

  it('does nothing when the conversation already has a title or messages', async () => {
    const a = legacy(
      { id: 8, title: 'ya', messages: [], metadata: null },
      'hola',
    );
    await a.call;
    const b = legacy(
      { id: 8, title: null, messages: [{ id: 1 }], metadata: null },
      'hola',
    );
    await b.call;
    expect(a.update).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });
});
