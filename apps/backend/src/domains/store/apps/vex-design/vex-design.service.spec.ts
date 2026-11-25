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
});
