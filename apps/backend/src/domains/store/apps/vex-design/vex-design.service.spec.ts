import { VexDesignService } from './vex-design.service';
import { VEX_DESIGN_PRESETS } from './vex-design.presets';
import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageDocument,
  validateAppPage,
} from '../shared/app-page.contract';
import { VEX_DESIGN_MAX_HISTORY } from './vex-design.types';

function makeDraft(overrides: Partial<AppPageDocument> = {}): AppPageDocument {
  return {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    hero: {
      title: 'Título original',
      subtitle: 'Subtítulo original',
      variant: 'centered',
    },
    blocks: [
      {
        id: 'benefits',
        type: 'benefits',
        enabled: true,
        props: { title: 'Beneficios' },
      },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: { title: 'Preguntas frecuentes' },
      },
    ],
    ...overrides,
  };
}

describe('VexDesignService (F4 historial y contrato)', () => {
  const storeId = 10;
  const userId = 42;
  const conversationId = 500;

  let prisma: {
    store_apps: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
    store_app_media: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let service: VexDesignService;

  beforeEach(() => {
    prisma = {
      store_apps: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn(),
      },
      store_app_media: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new VexDesignService(prisma as any);
  });

  it('rechaza store_home al inicializar la sesión', async () => {
    await expect(
      service.initOrSyncSession({
        storeId,
        userId,
        conversationId,
        appKind: 'store_home',
        draft: makeDraft(),
      }),
    ).rejects.toThrow(/no admite el chat de diseño/i);
  });

  it('mantiene aislamiento por tienda y por app', async () => {
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: makeDraft(),
    });

    // Otra tienda no puede leer ni parchear la conversación.
    expect(await service.readDraft(999, conversationId)).toBeNull();
    const crossStorePatch = await service.patchDraft(999, conversationId, {
      op: 'set_theme',
      tokens: { surface_color: '#0F172A' },
    });
    expect(crossStorePatch.ok).toBe(false);

    // Misma tienda pero app distinta rechaza.
    const crossAppPatch = await service.patchDraft(
      storeId,
      conversationId,
      { op: 'set_theme', tokens: { surface_color: '#0F172A' } },
      'booking',
    );
    expect(crossAppPatch.ok).toBe(false);
  });

  it('aplica parches, permite descartar paso a paso y nunca persiste en store_apps', async () => {
    const initial = makeDraft();
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: initial,
    });

    const p1 = await service.patchDraft(storeId, conversationId, {
      op: 'set_theme',
      tokens: { surface_color: '#0F172A', text_color: '#F1F5F9' },
    });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.history_depth).toBe(1);
    expect(p1.document.theme?.surface_color).toBe('#0F172A');

    const p2 = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_prop',
      block_id: 'hero',
      prop: 'title',
      value: 'Nuevo título oscuro',
    });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.history_depth).toBe(2);
    expect(p2.touched_block_id).toBe('hero');
    expect(p2.document.hero?.title).toBe('Nuevo título oscuro');

    // Descarta p2 -> vuelve a p1
    const d1 = await service.discardLast(storeId, conversationId);
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    expect(d1.history_depth).toBe(1);
    expect(d1.document.hero?.title).toBe('Título original');
    expect(d1.document.theme?.surface_color).toBe('#0F172A');

    // Descarta p1 -> vuelve al borrador inicial
    const d2 = await service.discardLast(storeId, conversationId);
    expect(d2.ok).toBe(true);
    if (!d2.ok) return;
    expect(d2.history_depth).toBe(0);
    expect(d2.can_discard).toBe(false);
    expect(d2.document.theme).toBeUndefined();

    // Pila vacía -> error legible
    const d3 = await service.discardLast(storeId, conversationId);
    expect(d3.ok).toBe(false);

    // Jamás guardó ni creó filas en store_apps
    expect(prisma.store_apps.update).not.toHaveBeenCalled();
    expect(prisma.store_apps.create).not.toHaveBeenCalled();
  });

  it('respeta el tope de 20 cambios en la pila de historial', async () => {
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: makeDraft(),
    });

    for (let i = 1; i <= 25; i++) {
      const res = await service.patchDraft(storeId, conversationId, {
        op: 'set_block_prop',
        block_id: 'hero',
        prop: 'title',
        value: `Título versión ${i}`,
      });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.history_depth).toBe(Math.min(i, VEX_DESIGN_MAX_HISTORY));
      }
    }

    // Podemos descartar exactamente 20 veces.
    let discards = 0;
    while (true) {
      const res = await service.discardLast(storeId, conversationId);
      if (!res.ok) break;
      discards++;
    }
    expect(discards).toBe(VEX_DESIGN_MAX_HISTORY);
  });

  it('resetToInitial revierte al documento previo a toda la conversación', async () => {
    const initial = makeDraft();
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: initial,
    });

    await service.patchDraft(storeId, conversationId, {
      op: 'apply_preset',
      preset_id: 'dark_editorial',
    });
    await service.patchDraft(storeId, conversationId, {
      op: 'add_block',
      block_type: 'cta',
      props: { title: 'Compra ya' },
    });

    const reset = await service.resetToInitial(storeId, conversationId);
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(reset.history_depth).toBe(0);
    expect(reset.can_discard).toBe(false);
    expect(reset.document.theme).toBeUndefined();
    expect(reset.document.blocks).toHaveLength(2);
  });

  it('todos los presets por industria validan limpio contra validateAppPage', () => {
    for (const preset of VEX_DESIGN_PRESETS) {
      for (const kind of preset.applies_to) {
        const doc: AppPageDocument = {
          schema_version: APP_PAGE_SCHEMA_VERSION,
          theme: preset.theme,
          ...(preset.hero_defaults ? { hero: preset.hero_defaults } : {}),
          blocks: [],
        };
        const result = validateAppPage(kind, doc);
        expect({ preset: preset.id, kind, errors: result.errors }).toEqual({
          preset: preset.id,
          kind,
          errors: [],
        });
      }
    }
  });

  it('bloquea URLs externas dentro de subcampos de listas al usar add_block y set_block_prop', async () => {
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'service_page',
      draft: makeDraft({ blocks: [] }),
    });

    const addHighlightsWithUrl = await service.patchDraft(
      storeId,
      conversationId,
      {
        op: 'add_block',
        block_type: 'highlights',
        props: {
          title: 'Destacados',
          items: [
            {
              title: 'Rápido',
              text: 'Entrega inmediata',
              image_url: 'https://evil.example.com/img.jpg',
            },
          ],
        },
      },
    );
    expect(addHighlightsWithUrl.ok).toBe(false);
    if (!addHighlightsWithUrl.ok) {
      expect(addHighlightsWithUrl.error).toMatch(/set_block_media/i);
    }

    const addTeamWithPhotoUrl = await service.patchDraft(
      storeId,
      conversationId,
      {
        op: 'add_block',
        block_type: 'team',
        props: {
          title: 'Equipo',
          items: [
            {
              name: 'Ana',
              role: 'Estilista',
              photo_url: 'https://evil.example.com/ana.jpg',
            },
          ],
        },
      },
    );
    expect(addTeamWithPhotoUrl.ok).toBe(false);
    if (!addTeamWithPhotoUrl.ok) {
      expect(addTeamWithPhotoUrl.error).toMatch(/set_block_media/i);
    }

    // Sin URL en subcampos sí permite crear el bloque normalmente.
    const validTeam = await service.patchDraft(storeId, conversationId, {
      op: 'add_block',
      block_type: 'team',
      props: {
        title: 'Equipo',
        items: [{ name: 'Ana', role: 'Estilista' }],
      },
    });
    expect(validTeam.ok).toBe(true);
    if (!validTeam.ok) return;

    // También bloquea URL externa en `set_block_prop` sobre `team.items[].photo_url`.
    const setTeamPhotoUrl = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_prop',
      block_id: validTeam.touched_block_id!,
      prop: 'items',
      value: [
        {
          name: 'Ana',
          role: 'Estilista',
          photo_url: 'https://evil.example.com/ana2.jpg',
        },
      ],
    });
    expect(setTeamPhotoUrl.ok).toBe(false);
    if (!setTeamPhotoUrl.ok) {
      expect(setTeamPhotoUrl.error).toMatch(/set_block_media/i);
    }
  });

  it('valida límites de item_index en gallery.image_urls sin hacer push silencioso', async () => {
    prisma.store_app_media.findFirst.mockResolvedValue({
      id: 55,
      public_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      alt: 'Foto válida',
    });

    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: makeDraft({
        blocks: [
          {
            id: 'gallery',
            type: 'gallery',
            enabled: true,
            props: {
              title: 'Galería',
              image_urls: ['https://api.vendix.online/api/public/apps/media/existing-1'],
            },
          },
        ],
      }),
      mediaBaseUrl: 'https://api.vendix.online/api',
    });

    const negativeIdx = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_media',
      block_id: 'gallery',
      prop: 'image_urls',
      media_id: 55,
      item_index: -1,
    });
    expect(negativeIdx.ok).toBe(false);

    const outOfRangeIdx = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_media',
      block_id: 'gallery',
      prop: 'image_urls',
      media_id: 55,
      item_index: 5,
    });
    expect(outOfRangeIdx.ok).toBe(false);

    // Índice válido reemplaza en sitio (mantiene largo 1).
    const replaceRes = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_media',
      block_id: 'gallery',
      prop: 'image_urls',
      media_id: 55,
      item_index: 0,
    });
    expect(replaceRes.ok).toBe(true);
    if (replaceRes.ok) {
      const urls = replaceRes.document.blocks[0].props['image_urls'] as string[];
      expect(urls).toEqual([
        'https://api.vendix.online/api/public/apps/media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ]);
    }

    // Sin item_index agrega al final (largo 2).
    const appendRes = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_media',
      block_id: 'gallery',
      prop: 'image_urls',
      media_id: 55,
    });
    expect(appendRes.ok).toBe(true);
    if (appendRes.ok) {
      const urls = appendRes.document.blocks[0].props['image_urls'] as string[];
      expect(urls).toHaveLength(2);
    }
  });

  it('agrupa múltiples parches de un mismo turno en una sola entrada y los revierte juntos al descartar', async () => {
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: makeDraft(),
      turnId: 'turn-1',
    });

    const p1 = await service.patchDraft(storeId, conversationId, {
      op: 'set_theme',
      tokens: { surface_color: '#0F172A' },
    });
    const p2 = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_prop',
      block_id: 'hero',
      prop: 'title',
      value: 'Título del turno 1',
    });

    expect(p1.ok && p2.ok).toBe(true);
    if (!p2.ok) return;
    // Dos parches en el mismo turno ocupan una única entrada en la pila.
    expect(p2.history_depth).toBe(1);

    // Un solo discardLast revierte ambos parches y registra el bloque tocado descartado.
    const d1 = await service.discardLast(storeId, conversationId);
    expect(d1.ok).toBe(true);
    if (!d1.ok) return;
    expect(d1.history_depth).toBe(0);
    expect(d1.touched_block_id).toBe('hero');
    expect(d1.document.theme).toBeUndefined();
    expect(d1.document.hero?.title).toBe('Título original');

    const latest = await service.getLatestState(storeId, conversationId, 'product_page');
    expect(latest?.last_discarded?.touched_block_id).toBe('hero');
  });

  it('reconcilia history en initOrSyncSession cuando el borrador sincronizado difiere del tope', async () => {
    const d0 = makeDraft();
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: d0,
      turnId: 'turn-1',
    });
    const p1 = await service.patchDraft(storeId, conversationId, {
      op: 'set_block_prop',
      block_id: 'hero',
      prop: 'title',
      value: 'Cambio turno 1',
    });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const d1 = p1.document;

    // Turno 2 produce d2 en Redis, pero el usuario nunca lo aplica en el editor.
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: d1,
      turnId: 'turn-2',
    });
    await service.patchDraft(storeId, conversationId, {
      op: 'set_block_prop',
      block_id: 'hero',
      prop: 'subtitle',
      value: 'Subtítulo no aplicado',
    });

    // Turno 3 sincroniza d1 (el borrador real del editor): trunca turno 2 y conserva turno 1.
    const syncedPrefix = await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: d1,
      turnId: 'turn-3',
    });
    expect(syncedPrefix.history).toHaveLength(1);
    expect(syncedPrefix.current_document.hero?.title).toBe('Cambio turno 1');
    expect(syncedPrefix.current_document.hero?.subtitle).toBe('Subtítulo original');

    // Si el dueño edita a mano algo distinto a cualquier snapshot, history se trunca a []
    // para que descartar jamás restaure un borrador obsoleto.
    const manualDraft = makeDraft({
      hero: { title: 'Editado a mano por el dueño', variant: 'centered' },
    });
    const syncedManual = await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: manualDraft,
      turnId: 'turn-4',
    });
    expect(syncedManual.history).toHaveLength(0);
    const discardRes = await service.discardLast(storeId, conversationId);
    expect(discardRes.ok).toBe(false);
  });

  it('persiste y recupera sesiones por la ruta real de Redis (TTL, lectura entre instancias y fallback)', async () => {
    const store = new Map<string, string>();
    const redisMock = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
    };

    const writerService = new VexDesignService(prisma as any, redisMock as any);
    await writerService.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: makeDraft(),
      turnId: 'redis-turn-1',
    });
    await writerService.patchDraft(storeId, conversationId, {
      op: 'set_theme',
      tokens: { surface_color: '#111827' },
    });

    const expectedKey = `vex:design-session:${storeId}:${conversationId}`;
    expect(redisMock.set).toHaveBeenCalledWith(
      expectedKey,
      expect.any(String),
      'EX',
      7200,
    );
    expect(store.has(expectedKey)).toBe(true);

    // Una segunda instancia sin caché en memoria lee el estado completo desde Redis.
    const readerService = new VexDesignService(prisma as any, redisMock as any);
    const state = await readerService.getLatestState(
      storeId,
      conversationId,
      'product_page',
    );
    expect(state?.document.theme?.surface_color).toBe('#111827');
    expect(state?.history_depth).toBe(1);

    // Descartar desde la segunda instancia actualiza Redis y mantiene consistencia.
    const undone = await readerService.discardLast(storeId, conversationId);
    expect(undone.ok).toBe(true);
    const afterUndo = await writerService.getLatestState(
      storeId,
      conversationId,
      'product_page',
    );
    expect(afterUndo?.history_depth).toBe(0);
    expect(afterUndo?.document.theme).toBeUndefined();

    // Si Redis falla al leer, degrada al respaldo en memoria sin romper la sesión.
    redisMock.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const fallbackState = await readerService.getLatestState(
      storeId,
      conversationId,
      'product_page',
    );
    expect(fallbackState?.app_kind).toBe('product_page');
  });
});
