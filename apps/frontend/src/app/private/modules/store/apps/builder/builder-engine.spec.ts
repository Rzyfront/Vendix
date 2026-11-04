import { LANDING_BUILDER_CATALOG } from '../landing-builder/landing-builder.catalog';
import {
  addBlockBlocker,
  catalogForMode,
  cleanBlockLists,
  duplicateBlock,
  insertBlock,
  moveBlock,
  readListItems,
  removeBlock,
  setBlockProp,
  toggleBlockHidden,
} from './builder-blocks';
import { BUILDER_PREVIEW_CHANNEL, previewScale, readFrameMessage, readHostMessage } from './builder-preview';
import type { BuilderBlock, BuilderCatalog, BuilderListFieldDef } from './builder.types';

/** F6-A — page builder engine: catalog rules, block operations, list editing, preview messages. */
describe('Motor de bloques (F6-A)', () => {
  const catalog: BuilderCatalog = LANDING_BUILDER_CATALOG;
  const page: BuilderBlock[] = [
    { id: 'hero_1', type: 'hero', props: { title: 'Hola' } },
    { id: 'faq_1', type: 'faq', props: { items: [{ question: 'Q', answer: 'A', extra: 'x' }] } },
    { id: 'contact_1', type: 'contact', props: {} },
  ];
  const faqItems = catalog.blocks.find((b) => b.type === 'faq')!.fields.find((f) => f.kind === 'list') as BuilderListFieldDef;

  describe('catálogo por modo de operación', () => {
    it('una página informativa no ofrece productos destacados; una de venta o ambas sí', () => {
      const types = (mode: 'info' | 'sales' | 'both' | 'booking') => catalogForMode(catalog, mode).map((d) => d.type);
      expect(types('info')).not.toContain('products_grid');
      expect(types('booking')).not.toContain('products_grid');
      expect(types('sales')).toContain('products_grid');
      expect(types('both').length).toBe(catalog.blocks.length);
    });

    it('explica por qué no se puede agregar: única, tope o tipo inexistente', () => {
      expect(addBlockBlocker(catalog, page, 'hero')).toBe('Ya está en la página: solo puede haber una.');
      expect(addBlockBlocker(catalog, page, 'faq')).toBeNull();
      expect(addBlockBlocker(catalog, page, 'nope')).toBe('Esta sección no existe en el catálogo de la app.');
      const full = Array.from({ length: catalog.maxBlocks }, (_, i) => ({ id: `f${i}`, type: 'faq', props: {} }));
      expect(addBlockBlocker(catalog, full, 'about')).toBe(`Máximo ${catalog.maxBlocks} secciones por página.`);
    });
  });

  describe('operaciones sobre la página (no mutan la entrada)', () => {
    it('agrega en la posición pedida con un id nuevo', () => {
      const { blocks, block } = insertBlock(page, 'about', 1);
      expect(blocks.map((b) => b.id)).toEqual(['hero_1', 'about_1', 'faq_1', 'contact_1']);
      expect(block.props).toEqual({});
      expect(page.length).toBe(3);
    });

    it('duplica debajo con id propio y props independientes', () => {
      const result = duplicateBlock(page, 'faq_1')!;
      expect(result.blocks.map((b) => b.id)).toEqual(['hero_1', 'faq_1', 'faq_2', 'contact_1']);
      (result.block.props['items'] as { question: string }[])[0].question = 'cambiada';
      expect((page[1].props['items'] as { question: string }[])[0].question).toBe('Q');
    });

    it('sube, baja y acota los extremos', () => {
      expect(moveBlock(page, 2, 0).map((b) => b.id)).toEqual(['contact_1', 'hero_1', 'faq_1']);
      expect(moveBlock(page, 0, -1).map((b) => b.id)).toEqual(['hero_1', 'faq_1', 'contact_1']);
      expect(moveBlock(page, 1, 99).map((b) => b.id)).toEqual(['hero_1', 'contact_1', 'faq_1']);
    });

    it('oculta con la marca y al mostrar la quita', () => {
      const hidden = toggleBlockHidden(page, 'faq_1');
      expect(hidden[1].hidden).toBeTrue();
      expect('hidden' in toggleBlockHidden(hidden, 'faq_1')[1]).toBeFalse();
    });

    it('elimina y edita una prop', () => {
      expect(removeBlock(page, 'hero_1').map((b) => b.id)).toEqual(['faq_1', 'contact_1']);
      expect(setBlockProp(page, 'hero_1', 'title', 'Nuevo')[0].props['title']).toBe('Nuevo');
      expect(page[0].props['title']).toBe('Hola');
    });
  });

  describe('listas', () => {
    it('lee alias del generador y conserva claves que el editor no muestra', () => {
      expect(readListItems(faqItems, [{ title: 'P', description: 'R', icon: 'star' }])).toEqual([
        { icon: 'star', question: 'P', answer: 'R' },
      ]);
    });

    it('lee el formato heredado «a | b» por líneas', () => {
      expect(readListItems(faqItems, '¿Envían? | Sí\n\n¿Garantía? | 1 año')).toEqual([
        { question: '¿Envían?', answer: 'Sí' },
        { question: '¿Garantía?', answer: '1 año' },
      ]);
    });

    it('al guardar descarta los ítems vacíos y deja intacto el texto heredado', () => {
      const blocks: BuilderBlock[] = [
        { id: 'faq_1', type: 'faq', props: { items: [{ question: ' Q ', answer: '' }, { question: '', answer: ' ' }] } },
        { id: 'faq_2', type: 'faq', props: { items: 'a | b' } },
      ];
      const clean = cleanBlockLists(catalog, blocks);
      expect(clean[0].props['items']).toEqual([{ question: 'Q', answer: '' }]);
      expect(clean[1]).toBe(blocks[1]);
    });
  });

  describe('mensajes de la vista previa', () => {
    const origin = 'https://tienda.vendix.com';
    const msg = (data: unknown, from = origin, source: unknown = null) =>
      ({ data, origin: from, source }) as unknown as MessageEvent;

    it('el editor solo acepta ready/select de su origen y canal', () => {
      expect(readHostMessage(msg({ channel: BUILDER_PREVIEW_CHANNEL, type: 'ready' }), origin)?.type).toBe('ready');
      expect(readHostMessage(msg({ channel: BUILDER_PREVIEW_CHANNEL, type: 'select', blockId: 'faq_1' }), origin)).toEqual({
        channel: BUILDER_PREVIEW_CHANNEL,
        type: 'select',
        blockId: 'faq_1',
      });
      expect(readHostMessage(msg({ channel: BUILDER_PREVIEW_CHANNEL, type: 'ready' }, 'https://evil.com'), origin)).toBeNull();
      expect(readHostMessage(msg({ channel: 'otro', type: 'ready' }), origin)).toBeNull();
    });

    it('el marco solo acepta render de su ventana padre', () => {
      const parent = {} as Window;
      const render = { channel: BUILDER_PREVIEW_CHANNEL, type: 'render', payload: { a: 1 }, selectedBlockId: null };
      expect(readFrameMessage(msg(render, origin, parent), origin, parent)?.payload).toEqual({ a: 1 });
      expect(readFrameMessage(msg(render, origin, {}), origin, parent)).toBeNull();
      expect(readFrameMessage(msg(render, 'https://evil.com', parent), origin, parent)).toBeNull();
    });

    it('escala el ancho real del dispositivo sin agrandarlo', () => {
      expect(previewScale(640, 1280)).toBe(0.5);
      expect(previewScale(800, 390)).toBe(1);
      expect(previewScale(0, 390)).toBe(1);
    });
  });
});
