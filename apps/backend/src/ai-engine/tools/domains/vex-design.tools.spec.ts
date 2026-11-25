import { AIToolRegistry } from '../ai-tool-registry';
import {
  TURN_BOUND_CONVERSATION_TOOLS,
  isForeignSurfaceTool,
} from '../surface-tools';
import {
  createVexDesignTools,
  VEX_DESIGN_TOOL_NAMES,
} from './vex-design.tools';
import { VexDesignService } from '../../../domains/store/apps/vex-design/vex-design.service';
import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageDocument,
} from '../../../domains/store/apps/shared/app-page.contract';

function initialDraft(): AppPageDocument {
  return {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    hero: {
      title: 'Café de origen',
      variant: 'centered',
    },
    blocks: [
      {
        id: 'benefits',
        type: 'benefits',
        enabled: true,
        props: { title: 'Por qué elegirlo' },
      },
      {
        id: 'gallery',
        type: 'gallery',
        enabled: true,
        props: { title: 'Galería' },
      },
    ],
  };
}

describe('vex-design tools contract (F4)', () => {
  const storeId = 15;
  const otherStoreId = 99;
  const userId = 7;
  const conversationId = 321;

  let mediaRows: Array<{
    id: number;
    store_id: number;
    public_token: string;
    kind: 'image' | 'document';
    alt: string | null;
    app_kind: string | null;
    deleted_at: Date | null;
  }>;
  let service: VexDesignService;
  let registry: AIToolRegistry;

  beforeEach(async () => {
    mediaRows = [
      {
        id: 101,
        store_id: storeId,
        public_token: '11111111-1111-4111-8111-111111111111',
        kind: 'image',
        alt: 'Taza de espresso',
        app_kind: 'product_page',
        deleted_at: null,
      },
      {
        id: 202,
        store_id: otherStoreId,
        public_token: '22222222-2222-4222-8222-222222222222',
        kind: 'image',
        alt: 'Foto de otra tienda',
        app_kind: 'product_page',
        deleted_at: null,
      },
    ];

    const prisma = {
      store_apps: { findFirst: jest.fn().mockResolvedValue(null) },
      store_app_media: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          return (
            mediaRows.find(
              (r) =>
                r.id === where.id &&
                r.store_id === where.store_id &&
                r.kind === where.kind &&
                r.deleted_at === null,
            ) ?? null
          );
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return mediaRows.filter(
            (r) =>
              r.store_id === where.store_id &&
              r.kind === where.kind &&
              r.deleted_at === null,
          );
        }),
      },
    };

    service = new VexDesignService(prisma as any);
    await service.initOrSyncSession({
      storeId,
      userId,
      conversationId,
      appKind: 'product_page',
      draft: initialDraft(),
      mediaBaseUrl: 'https://api.vendix.online/api',
    });

    registry = new AIToolRegistry({} as any);
    registry.registerMany(createVexDesignTools({ design: service }));
  });

  const ctx = {
    store_id: storeId,
    user_id: userId,
    conversation_id: conversationId,
    roles: ['owner'],
  };

  it('declara permiso store:apps:manage y aislamiento de superficie Vex', () => {
    for (const name of VEX_DESIGN_TOOL_NAMES) {
      const tool = registry.get(name);
      expect(tool).toBeDefined();
      expect(tool?.requiredPermissions).toEqual(['store:apps:manage']);
      expect(isForeignSurfaceTool(name, 'vexi')).toBe(true);
      expect(isForeignSurfaceTool(name, 'vex')).toBe(false);
      expect(TURN_BOUND_CONVERSATION_TOOLS.has(name)).toBe(true);
    }
    expect(registry.get('vex_design_read')?.readOnly).toBe(true);
    expect(registry.get('vex_design_patch')?.readOnly).not.toBe(true);
  });

  it('vex_design_read devuelve borrador resumido e imágenes de esta tienda únicamente', async () => {
    const tool = registry.get('vex_design_read')!;
    const raw = await tool.handler!({}, ctx);
    const parsed = JSON.parse(raw);

    expect(parsed.data.app_kind).toBe('product_page');
    expect(parsed.data.hero.title).toBe('Café de origen');
    expect(parsed.data.blocks).toHaveLength(2);
    expect(parsed.data.gallery_images).toEqual([
      { id: 101, alt: 'Taza de espresso', app_kind: 'product_page' },
    ]);
  });

  it('rechaza props inexistentes en bloques, portada y tema, dejando el borrador intacto', async () => {
    const patch = registry.get('vex_design_patch')!;

    const badBlockProp = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_prop',
          block_id: 'benefits',
          prop: 'custom_css_html',
          value: '<style>body{color:red}</style>',
        },
        ctx,
      ),
    );
    expect(badBlockProp.error).toMatch(/no existe en el catálogo/i);

    const badHeroProp = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_prop',
          block_id: 'hero',
          prop: 'raw_html',
          value: '<div>x</div>',
        },
        ctx,
      ),
    );
    expect(badHeroProp.error).toMatch(/no existe en el catálogo/i);

    const badThemeToken = JSON.parse(
      await patch.handler!(
        {
          op: 'set_theme',
          tokens: { custom_gradient: 'linear-gradient(red,blue)' },
        },
        ctx,
      ),
    );
    expect(badThemeToken.error).toMatch(/no existe en el catálogo/i);

    const state = await service.readDraft(storeId, conversationId);
    expect(state?.history_depth).toBe(0);
    expect(state?.theme).toEqual({});
  });

  it('rechaza URLs externas e ids de galería de otra tienda en set_block_media', async () => {
    const patch = registry.get('vex_design_patch')!;

    // 1. Intento de URL externa explícita
    const externalUrlAttempt = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_media',
          block_id: 'hero',
          media_id: 101,
          url: 'https://evil.example.com/photo.jpg',
        },
        ctx,
      ),
    );
    expect(externalUrlAttempt.error).toMatch(/URLs externas/i);

    // 2. Intento de pasar URL en set_block_prop
    const directPropUrl = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_prop',
          block_id: 'hero',
          prop: 'image_url',
          value: 'https://evil.example.com/photo.jpg',
        },
        ctx,
      ),
    );
    expect(directPropUrl.error).toMatch(/set_block_media/i);

    // 3. ID perteneciente a OTRA tienda
    const foreignMedia = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_media',
          block_id: 'hero',
          media_id: 202,
        },
        ctx,
      ),
    );
    expect(foreignMedia.error).toMatch(/No encontré la imagen #202/i);

    // Borrador sigue intacto
    const state = await service.readDraft(storeId, conversationId);
    expect(state?.hero?.image_url).toBeUndefined();
    expect(state?.history_depth).toBe(0);
  });

  it('aplica set_block_media válido de la galería de la tienda, reordena, agrega, quita y descarta', async () => {
    const patch = registry.get('vex_design_patch')!;
    const discard = registry.get('vex_design_discard')!;

    const mediaRes = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_media',
          block_id: 'hero',
          prop: 'background_image_url',
          media_id: 101,
        },
        ctx,
      ),
    );
    expect(mediaRes.error).toBeUndefined();
    expect(mediaRes.data.touched_block_id).toBe('hero');
    expect(mediaRes.data.document.hero.background_image_url).toBe(
      'https://api.vendix.online/api/public/apps/media/11111111-1111-4111-8111-111111111111',
    );
    expect(mediaRes.data.summary).toContain('Taza de espresso');

    // Reordenar bloques
    const reorderRes = JSON.parse(
      await patch.handler!(
        { op: 'reorder_blocks', block_ids: ['gallery', 'benefits'] },
        ctx,
      ),
    );
    expect(reorderRes.error).toBeUndefined();
    expect(reorderRes.data.document.blocks.map((b: any) => b.id)).toEqual([
      'gallery',
      'benefits',
    ]);

    // Agregar bloque de catálogo permitido
    const addRes = JSON.parse(
      await patch.handler!(
        {
          op: 'add_block',
          block_type: 'faq',
          props: { title: 'Dudas' },
        },
        ctx,
      ),
    );
    expect(addRes.error).toBeUndefined();
    const addedId = addRes.data.touched_block_id;
    expect(addRes.data.document.blocks.some((b: any) => b.id === addedId)).toBe(
      true,
    );

    // Rechazar tipo de bloque de otra app (ej. `stay_detail` es de booking, no product_page)
    const foreignBlockType = JSON.parse(
      await patch.handler!(
        { op: 'add_block', block_type: 'stay_detail' },
        ctx,
      ),
    );
    expect(foreignBlockType.error).toMatch(/no está disponible/i);

    // Eliminar el bloque agregado
    const removeRes = JSON.parse(
      await patch.handler!({ op: 'remove_block', block_id: addedId }, ctx),
    );
    expect(removeRes.error).toBeUndefined();
    expect(removeRes.data.document.blocks.some((b: any) => b.id === addedId)).toBe(
      false,
    );

    // Descartar vuelve a tener el bloque agregado
    const undoRes = JSON.parse(await discard.handler!({}, ctx));
    expect(undoRes.error).toBeUndefined();
    expect(undoRes.data.document.blocks.some((b: any) => b.id === addedId)).toBe(
      true,
    );
  });

  it('rechaza app_kind store_home directamente en las herramientas', async () => {
    const read = registry.get('vex_design_read')!;
    const res = JSON.parse(
      await read.handler!({ app_kind: 'store_home' }, ctx),
    );
    expect(res.error).toMatch(/no admite el chat de diseño/i);
  });

  it('exige context.conversation_id y jamás acepta fallback desde args.conversation_id', async () => {
    const read = registry.get('vex_design_read')!;
    const patch = registry.get('vex_design_patch')!;
    const discard = registry.get('vex_design_discard')!;

    const ctxWithoutConversation = {
      store_id: storeId,
      user_id: userId,
      roles: ['owner'],
    };

    const readRes = JSON.parse(
      await read.handler!({ conversation_id: conversationId }, ctxWithoutConversation),
    );
    expect(readRes.error).toMatch(/conversación activa/i);

    const patchRes = JSON.parse(
      await patch.handler!(
        {
          conversation_id: conversationId,
          op: 'set_theme',
          tokens: { surface_color: '#0F172A' },
        },
        ctxWithoutConversation,
      ),
    );
    expect(patchRes.error).toMatch(/conversación activa/i);

    const discardRes = JSON.parse(
      await discard.handler!(
        { conversation_id: conversationId },
        ctxWithoutConversation,
      ),
    );
    expect(discardRes.error).toMatch(/conversación activa/i);
  });

  it('rechaza URLs externas en subcampos de listas al usar add_block', async () => {
    const patch = registry.get('vex_design_patch')!;
    const res = JSON.parse(
      await patch.handler!(
        {
          op: 'add_block',
          block_type: 'highlights',
          props: {
            title: 'Destacados',
            items: [
              {
                title: 'Calidad',
                text: 'Premium',
                image_url: 'https://evil.example.com/pic.png',
              },
            ],
          },
        },
        ctx,
      ),
    );
    expect(res.error).toMatch(/set_block_media/i);
  });

  it('rechaza item_index negativo o fuera de rango en gallery.image_urls', async () => {
    const patch = registry.get('vex_design_patch')!;
    const resNeg = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_media',
          block_id: 'gallery',
          prop: 'image_urls',
          media_id: 101,
          item_index: -1,
        },
        ctx,
      ),
    );
    expect(resNeg.error).toMatch(/no existe/i);

    const resOob = JSON.parse(
      await patch.handler!(
        {
          op: 'set_block_media',
          block_id: 'gallery',
          prop: 'image_urls',
          media_id: 101,
          item_index: 3,
        },
        ctx,
      ),
    );
    expect(resOob.error).toMatch(/no existe/i);
  });
});
