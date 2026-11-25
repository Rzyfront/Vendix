jest.mock('../../ai-chat/ai-chat.service', () => ({
  AIChatService: class {},
}));

import { BadRequestException } from '@nestjs/common';
import { firstValueFrom, toArray } from 'rxjs';
import { RequestContextService } from '@common/context/request-context.service';
import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageDocument,
} from '../shared/app-page.contract';
import { VexDesignController } from './vex-design.controller';
import { VexDesignService } from './vex-design.service';

function sampleDraft(): AppPageDocument {
  return {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    hero: { title: 'Producto estrella' },
    blocks: [],
  };
}

describe('VexDesignController (F4 endpoint y SSE)', () => {
  const ctx = {
    store_id: 22,
    organization_id: 5,
    user_id: 88,
    roles: ['owner'],
    permissions: ['store:apps:manage'],
  } as any;

  let service: VexDesignService;
  let chatService: {
    createConversation: jest.Mock;
    getConversation: jest.Mock;
    createDesignStreamIntent: jest.Mock;
    sendMessageStream: jest.Mock;
  };
  let responseService: { success: jest.Mock };
  let controller: VexDesignController;

  beforeEach(() => {
    const prisma = {
      store_apps: { findFirst: jest.fn().mockResolvedValue(null) },
      store_app_media: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new VexDesignService(prisma as any);
    chatService = {
      createConversation: jest.fn().mockResolvedValue({ id: 901 }),
      getConversation: jest.fn().mockResolvedValue({
        id: 901,
        metadata: { agent_key: 'vex', surface: 'apps_design' },
      }),
      createDesignStreamIntent: jest.fn().mockResolvedValue('stream-xyz'),
      sendMessageStream: jest.fn(),
    };
    responseService = {
      success: jest.fn((data, message) => ({ success: true, data, message })),
    };
    controller = new VexDesignController(
      service,
      chatService as any,
      responseService as any,
    );
  });

  it('rechaza store_home en createStreamIntent, streamDesignChat, discardLast y resetConversation', async () => {
    await RequestContextService.run(ctx, async () => {
      await expect(
        controller.createStreamIntent('store_home', {
          content: 'Cambia el fondo',
          draft: sampleDraft() as any,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(() =>
        controller.streamDesignChat('store_home', '901', 'stream-xyz'),
      ).toThrow(BadRequestException);

      await expect(
        controller.discardLast('store_home', 901),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.resetConversation('store_home', 901),
      ).rejects.toThrow(BadRequestException);
    });
  });

  it('crea conversación Vex marcada como superficie de diseño, sincroniza el borrador y acota las herramientas', async () => {
    await RequestContextService.run(ctx, async () => {
      const res = await controller.createStreamIntent('product_page', {
        content: 'Pon el fondo oscuro',
        draft: sampleDraft() as any,
      });

      expect(chatService.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ agent_key: 'vex' }),
        expect.objectContaining({
          surface: 'apps_design',
          app_kind: 'product_page',
        }),
      );
      expect(chatService.createDesignStreamIntent).toHaveBeenCalledWith(
        901,
        'Pon el fondo oscuro',
        expect.objectContaining({
          app_kind: 'product_page',
          allowed_tools: [
            'vex_design_read',
            'vex_design_patch',
            'vex_design_discard',
            'finish_turn',
          ],
        }),
      );
      expect(res.data.conversation_id).toBe(901);
      expect(res.data.stream_id).toBe('stream-xyz');
    });
  });

  it('rechaza reutilizar un conversation_id que pertenece a otro agente (ej. vexi)', async () => {
    chatService.getConversation.mockResolvedValueOnce({
      id: 777,
      metadata: { agent_key: 'vexi' },
    });

    await RequestContextService.run(ctx, async () => {
      await expect(
        controller.createStreamIntent('product_page', {
          conversation_id: 777,
          content: 'Cambia el color',
          draft: sampleDraft() as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    expect(chatService.createDesignStreamIntent).not.toHaveBeenCalled();
  });

  it('emite el frame design_draft tras un tool_result exitoso de vex_design_patch y exige expectedDesignAppKind', async () => {
    await service.initOrSyncSession({
      storeId: ctx.store_id,
      userId: ctx.user_id,
      conversationId: 901,
      appKind: 'product_page',
      draft: sampleDraft(),
    });
    await service.patchDraft(ctx.store_id, 901, {
      op: 'set_theme',
      tokens: { surface_color: '#0F172A' },
    });

    chatService.sendMessageStream.mockImplementation(async function* () {
      yield {
        type: 'tool_result',
        tool: {
          id: 'tc-1',
          name: 'vex_design_patch',
          summary: 'ok',
          failed: false,
        },
      };
      yield { type: 'text', content: 'Listo.' };
      yield { type: 'done' };
    });

    const events = await RequestContextService.run(ctx, () =>
      firstValueFrom(
        controller
          .streamDesignChat('product_page', '901', 'stream-xyz')
          .pipe(toArray()),
      ),
    );

    expect(chatService.sendMessageStream).toHaveBeenCalledWith(
      901,
      'stream-xyz',
      expect.any(AbortSignal),
      {},
      { expectedDesignAppKind: 'product_page' },
    );

    const payloads = events
      .filter((e) => e.type === 'ai-chunk')
      .map((e) => JSON.parse(String(e.data)));

    const designFrame = payloads.find((p) => p.type === 'design_draft');
    expect(designFrame).toBeDefined();
    expect(designFrame.app_kind).toBe('product_page');
    expect(designFrame.document.theme.surface_color).toBe('#0F172A');
    expect(designFrame.history_depth).toBe(1);
    expect(designFrame.can_discard).toBe(true);
  });

  it('no emite design_draft cuando el tool_result viene con failed: true', async () => {
    await service.initOrSyncSession({
      storeId: ctx.store_id,
      userId: ctx.user_id,
      conversationId: 901,
      appKind: 'product_page',
      draft: sampleDraft(),
    });

    chatService.sendMessageStream.mockImplementation(async function* () {
      yield {
        type: 'tool_result',
        tool: {
          id: 'tc-err',
          name: 'vex_design_patch',
          summary: 'Propiedad no permitida',
          failed: true,
        },
      };
      yield { type: 'done' };
    });

    const events = await RequestContextService.run(ctx, () =>
      firstValueFrom(
        controller
          .streamDesignChat('product_page', '901', 'stream-xyz')
          .pipe(toArray()),
      ),
    );

    const payloads = events
      .filter((e) => e.type === 'ai-chunk')
      .map((e) => JSON.parse(String(e.data)));
    expect(payloads.some((p) => p.type === 'design_draft')).toBe(false);
  });

  it('tras vex_design_discard propaga el touched_block_id de la entrada descartada y no del tope restante', async () => {
    await service.initOrSyncSession({
      storeId: ctx.store_id,
      userId: ctx.user_id,
      conversationId: 901,
      appKind: 'product_page',
      draft: {
        schema_version: APP_PAGE_SCHEMA_VERSION,
        hero: { title: 'Producto estrella' },
        blocks: [
          {
            id: 'benefits',
            type: 'benefits',
            enabled: true,
            props: { title: 'Beneficios' },
          },
        ],
      },
    });
    // Cambio 1 toca `benefits` (quedará como tope restante).
    await service.patchDraft(ctx.store_id, 901, {
      op: 'set_block_prop',
      block_id: 'benefits',
      prop: 'title',
      value: 'Beneficios editados',
    });
    // Cambio 2 toca `hero` (será la entrada descartada).
    await service.patchDraft(ctx.store_id, 901, {
      op: 'set_block_prop',
      block_id: 'hero',
      prop: 'title',
      value: 'Portada editada',
    });
    // El tool descartó el cambio 2 antes de emitir su `tool_result`.
    await service.discardLast(ctx.store_id, 901, 'product_page');

    chatService.sendMessageStream.mockImplementation(async function* () {
      yield {
        type: 'tool_result',
        tool: {
          id: 'tc-undo',
          name: 'vex_design_discard',
          summary: 'descartado',
          failed: false,
        },
      };
      yield { type: 'done' };
    });

    const events = await RequestContextService.run(ctx, () =>
      firstValueFrom(
        controller
          .streamDesignChat('product_page', '901', 'stream-xyz')
          .pipe(toArray()),
      ),
    );

    const payloads = events
      .filter((e) => e.type === 'ai-chunk')
      .map((e) => JSON.parse(String(e.data)));
    const discardFrame = payloads.find((p) => p.type === 'design_draft');
    expect(discardFrame).toBeDefined();
    expect(discardFrame.op).toBe('discard');
    expect(discardFrame.touched_block_id).toBe('hero');
    expect(discardFrame.history_depth).toBe(1);
    expect(discardFrame.document.hero.title).toBe('Producto estrella');
  });

  it('corta con error y no emite design_draft en cruce de app (cross-app)', async () => {
    // Sesión creada para `product_page`, pero el stream se abre por `:kind = booking`.
    await service.initOrSyncSession({
      storeId: ctx.store_id,
      userId: ctx.user_id,
      conversationId: 901,
      appKind: 'product_page',
      draft: sampleDraft(),
    });

    chatService.sendMessageStream.mockImplementation(async function* (
      _convId: number,
      _streamId: string,
      _signal: AbortSignal,
      _replay: unknown,
      opts: { expectedDesignAppKind?: string },
    ) {
      if (opts?.expectedDesignAppKind !== 'product_page') {
        yield {
          type: 'error',
          error:
            'El stream no corresponde a una sesión de diseño válida para esta app.',
        };
        return;
      }
      yield { type: 'done' };
    });

    const events = await RequestContextService.run(ctx, () =>
      firstValueFrom(
        controller
          .streamDesignChat('booking', '901', 'stream-xyz')
          .pipe(toArray()),
      ),
    );

    const payloads = events
      .filter((e) => e.type === 'ai-chunk')
      .map((e) => JSON.parse(String(e.data)));
    expect(payloads).toEqual([
      {
        type: 'error',
        error:
          'El stream no corresponde a una sesión de diseño válida para esta app.',
      },
    ]);
  });
});
