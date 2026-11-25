import {
  APP_PAGE_BLOCKS,
  carryPage,
  effectiveMode,
  readAppPage,
  validateAppPage,
} from './app-page.contract';
import { parseProductPageConfig } from '../product-page/product-page.reader';
import { parseServicePageConfig } from '../service-page/service-page.reader';
import { parseBookingPageConfig } from '../booking/booking-page.reader';
import { parseStoreHomeConfig } from '../store-home/store-home.reader';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductPagePageDto } from '../product-page/product-page.dto';

/**
 * Apps F2 — the per-app page contract (`store_apps.config.page`). Every case
 * goes through the public functions the DTO and the public readers use.
 */
describe('app page contract', () => {
  const productPage = {
    schema_version: 1,
    mode: 'info',
    sales: { product_mode: 'single', show_cart: false, checkout: 'store' },
    brand: { primary_color: '#112233', font_family: 'poppins', logo_url: '' },
    seo: { title: '  Crema hidratante  ', description: 'La mejor crema' },
    hero: { title: 'Piel nueva en 7 días', image_url: 'https://cdn.x.co/a.png' },
    blocks: [
      {
        id: 'b1',
        type: 'benefits',
        props: { title: 'Por qué elegirla', items: [{ title: 'Natural', text: '' }, {}] },
      },
      {
        id: 'b2',
        type: 'testimonials',
        enabled: false,
        props: {
          rating_summary: '4.9/5',
          items: [{ name: 'Ana', city: 'Cali', quote: 'Me encantó', rating: 5 }],
        },
      },
    ],
  };

  describe('without a saved page (stores live before F2)', () => {
    it('reads no page, so the public page renders as before', () => {
      expect(readAppPage('product_page', null)).toBeNull();
      expect(readAppPage('product_page', { product_id: 4 })).toBeNull();
    });

    it('keeps the mode each app has today', () => {
      expect(effectiveMode('product_page', null)).toBe('sales');
      expect(effectiveMode('service_page', null)).toBe('both');
      expect(effectiveMode('booking', null)).toBe('both');
      expect(effectiveMode('store_home', null)).toBe('info');
    });
  });

  it('cleans a valid page: trims, drops empty values and derives the flags from the mode', () => {
    const result = validateAppPage('product_page', productPage);

    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.value).toEqual({
      schema_version: 1,
      mode: 'info',
      sales: {
        enabled: false,
        product_mode: 'single',
        show_cart: false,
        checkout: 'store',
      },
      booking: { enabled: false },
      brand: { primary_color: '#112233', font_family: 'poppins' },
      seo: { title: 'Crema hidratante', description: 'La mejor crema' },
      hero: { title: 'Piel nueva en 7 días', image_url: 'https://cdn.x.co/a.png' },
      blocks: [
        {
          id: 'b1',
          type: 'benefits',
          enabled: true,
          props: { title: 'Por qué elegirla', items: [{ title: 'Natural' }] },
        },
        {
          id: 'b2',
          type: 'testimonials',
          enabled: false,
          props: {
            rating_summary: '4.9/5',
            items: [{ name: 'Ana', city: 'Cali', quote: 'Me encantó', rating: 5 }],
          },
        },
      ],
    });
  });

  it('turns sales and booking on together in mode both', () => {
    const result = validateAppPage('service_page', {
      schema_version: 1,
      mode: 'both',
      booking: { source: 'agenda' },
      blocks: [],
    });
    expect(result.value?.sales).toEqual({ enabled: true });
    expect(result.value?.booking).toEqual({ enabled: true, source: 'agenda' });
  });

  it('rejects a landing block (or another app block) in an app page', () => {
    const result = validateAppPage('product_page', {
      schema_version: 1,
      blocks: [
        { id: 'a', type: 'products_grid', props: {} },
        { id: 'b', type: 'amenities', props: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'blocks[0].type "products_grid" no es una sección de esta app.',
      'blocks[1].type "amenities" no es una sección de esta app.',
    ]);
  });

  it('gives every app its own block catalog', () => {
    expect(Object.keys(APP_PAGE_BLOCKS.product_page)).toContain('specifications');
    expect(Object.keys(APP_PAGE_BLOCKS.service_page)).toContain('team');
    expect(Object.keys(APP_PAGE_BLOCKS.booking)).toContain('amenities');
    expect(Object.keys(APP_PAGE_BLOCKS.store_home)).toContain('apps');
    expect(Object.keys(APP_PAGE_BLOCKS.booking)).not.toContain('specifications');
  });

  it('reports every wrong field', () => {
    const result = validateAppPage('booking', {
      schema_version: 2,
      layout: {},
      mode: 'rent',
      booking: { require_account: true, source: 'calendar' },
      brand: { primary_color: 'red', logo_url: 'http://x.co/logo.png' },
      blocks: [
        { id: 'x', type: 'testimonials', props: { items: [{ rating: 6 }] } },
        { id: 'x', type: 'search', props: {} },
        { id: 'y', type: 'search', props: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.errors).toEqual([
      'layout no es un campo permitido.',
      'schema_version debe ser 1.',
      'mode debe ser uno de: booking, sales, both, info.',
      'booking.source debe ser uno de: agenda, rooms.',
      'booking.require_account: la reserva no exige cuenta.',
      'brand.logo_url debe ser una URL https.',
      'brand.primary_color debe ser un color #RRGGBB.',
      'blocks[0].props.items[0].rating debe ser un entero entre 1 y 5.',
      'blocks[1].id está repetido.',
      'blocks[2].type "search" está repetido.',
    ]);
  });

  describe('F6-B: page builder', () => {
    it('lets a content section repeat (duplicate) with its own id', () => {
      const result = validateAppPage('service_page', {
        schema_version: 1,
        blocks: [
          { id: 'faq', type: 'faq', props: { title: 'Preguntas' } },
          { id: 'faq_2', type: 'faq', props: { title: 'Más preguntas' } },
        ],
      });
      expect(result.valid).toBe(true);
      expect(result.value?.blocks.map((b) => b.id)).toEqual(['faq', 'faq_2']);
    });

    it('keeps the sections the layout draws itself (existing) single', () => {
      const result = validateAppPage('store_home', {
        schema_version: 1,
        blocks: [
          { id: 'apps', type: 'apps', props: {} },
          { id: 'apps_2', type: 'apps', props: {} },
        ],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['blocks[1].type "apps" está repetido.']);
    });

    it('accepts the WhatsApp contact in brand and rejects a number that is not one', () => {
      const ok = validateAppPage('product_page', {
        schema_version: 1,
        brand: { whatsapp_number: '+57 300 123 4567', whatsapp_message: 'Hola', whatsapp_floating: true },
        blocks: [],
      });
      expect(ok.valid).toBe(true);
      expect(ok.value?.brand).toEqual({
        whatsapp_number: '+57 300 123 4567',
        whatsapp_message: 'Hola',
        whatsapp_floating: true,
      });
      const bad = validateAppPage('product_page', {
        schema_version: 1,
        brand: { whatsapp_number: 'llámame', whatsapp_floating: 'sí' },
        blocks: [],
      });
      expect(bad.valid).toBe(false);
      expect(bad.errors).toEqual([
        'brand.whatsapp_floating debe ser verdadero o falso.',
        'brand.whatsapp_number debe ser un número con indicativo, solo dígitos.',
      ]);
    });

    it('store home: the apps block keeps the chosen apps and their order', () => {
      const result = validateAppPage('store_home', {
        schema_version: 1,
        blocks: [{ id: 'apps', type: 'apps', props: { kinds: ['booking', ' landing ', ''] } }],
      });
      expect(result.valid).toBe(true);
      expect(result.value?.blocks[0].props).toEqual({ kinds: ['booking', 'landing'] });
    });
  });

  it('reads a stored page that no longer validates as no page (pre-F2 render)', () => {
    expect(
      readAppPage('booking', { page: { schema_version: 1, blocks: [{ id: 'a', type: 'nope' }] } }),
    ).toBeNull();
    expect(readAppPage('booking', { page: { schema_version: 1, blocks: [] } })).toEqual({
      schema_version: 1,
      blocks: [],
    });
  });

  it('keeps the page when each app saves its own settings', () => {
    const page = { schema_version: 1, blocks: [] };
    expect(carryPage({ page, x: 1 })).toEqual({ page });
    expect(carryPage({ page: 'bad' })).toEqual({});
    expect(parseProductPageConfig({ product_id: 3, page }).page).toEqual(page);
    expect(parseServicePageConfig({ page }).page).toEqual(page);
    expect(parseBookingPageConfig({ page }).page).toEqual(page);
    expect(parseStoreHomeConfig({ page }).page).toEqual(page);
  });
  describe('theme (Apps F3)', () => {
    const fullTheme = {
      primary_color: '#7A3E2E',
      secondary_color: '#C8A27A',
      surface_color: '#FBF7F2',
      text_color: '#2B211C',
      accent_color: '#8C5A2B',
      heading_font: 'playfair',
      body_font: 'lora',
      radius: 'large',
      density: 'spacious',
      button_style: 'outline',
      image_style: 'rounded',
      content_width: 'narrow',
    };

    it('accepts every style token and keeps it as sent', () => {
      const result = validateAppPage('service_page', {
        schema_version: 1,
        theme: fullTheme,
        blocks: [],
      });
      expect(result.errors).toEqual([]);
      expect(result.value?.theme).toEqual(fullTheme);
    });

    it('rejects values outside the closed catalogs and malformed colors', () => {
      const result = validateAppPage('booking', {
        schema_version: 1,
        theme: {
          primary_color: 'red',
          heading_font: 'comic-sans',
          radius: 'huge',
          density: 'tight',
          button_style: 'ghost',
          image_style: 'circle',
          content_width: 'full',
          sparkle: 'lg',
        },
        blocks: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'theme.primary_color debe ser un color #RRGGBB.',
          'theme.heading_font debe ser uno de: system, inter, poppins, playfair, montserrat, lora.',
          'theme.radius debe ser uno de: none, small, medium, large.',
          'theme.density debe ser uno de: compact, comfortable, spacious.',
          'theme.button_style debe ser uno de: solid, outline.',
          'theme.image_style debe ser uno de: square, rounded.',
          'theme.content_width debe ser uno de: narrow, normal, wide.',
          'theme.sparkle no es un campo permitido.',
        ]),
      );
    });

    describe('extended tokens (Apps F7)', () => {
      const extended = {
        border_color: '#E5DED5',
        base_font_size: 'lg',
        heading_scale: 'display',
        section_gap: 'airy',
        card_style: 'soft',
        shadow: 'strong',
        image_ratio: '16:9',
        image_overlay: 40,
        hero_height: 'full',
      };

      it('accepts every extended token next to the F3 ones and keeps it as sent', () => {
        const result = validateAppPage('product_page', {
          schema_version: 1,
          theme: { ...fullTheme, ...extended },
          blocks: [],
        });
        expect(result.errors).toEqual([]);
        expect(result.value?.theme).toEqual({ ...fullTheme, ...extended });
      });

      it('accepts the bounds of the image veil and every image ratio', () => {
        for (const image_overlay of [0, 80]) {
          expect(
            validateAppPage('booking', { schema_version: 1, theme: { image_overlay }, blocks: [] }).value?.theme,
          ).toEqual({ image_overlay });
        }
        for (const image_ratio of ['square', '4:3', '16:9', 'auto']) {
          expect(
            validateAppPage('service_page', { schema_version: 1, theme: { image_ratio }, blocks: [] }).valid,
          ).toBe(true);
        }
      });

      it('rejects values outside the closed catalogs, a malformed border and an out-of-range veil', () => {
        const result = validateAppPage('service_page', {
          schema_version: 1,
          theme: {
            border_color: 'gray',
            base_font_size: 'xl',
            heading_scale: 'huge',
            section_gap: 'wide',
            card_style: 'glass',
            shadow: 'lg',
            image_ratio: '3:2',
            image_overlay: 81,
            hero_height: 'half',
          },
          blocks: [],
        });
        expect(result.valid).toBe(false);
        expect(result.value).toBeNull();
        expect(result.errors).toEqual(
          expect.arrayContaining([
            'theme.border_color debe ser un color #RRGGBB.',
            'theme.base_font_size debe ser uno de: sm, md, lg.',
            'theme.heading_scale debe ser uno de: compact, normal, display.',
            'theme.section_gap debe ser uno de: tight, normal, airy.',
            'theme.card_style debe ser uno de: flat, outline, soft.',
            'theme.shadow debe ser uno de: none, soft, strong.',
            'theme.image_ratio debe ser uno de: square, 4:3, 16:9, auto.',
            'theme.image_overlay debe ser un entero entre 0 y 80.',
            'theme.hero_height debe ser uno de: auto, compact, full.',
          ]),
        );
      });

      it('rejects a veil that is negative, fractional or text', () => {
        for (const image_overlay of [-1, 12.5, '40']) {
          const result = validateAppPage('booking', {
            schema_version: 1,
            theme: { image_overlay },
            blocks: [],
          });
          expect(result.errors).toEqual(['theme.image_overlay debe ser un entero entre 0 y 80.']);
        }
      });

      it('an old page without extended tokens is returned exactly as before', () => {
        const result = validateAppPage('product_page', {
          schema_version: 1,
          theme: fullTheme,
          blocks: [],
        });
        expect(result.value?.theme).toEqual(fullTheme);
        for (const key of Object.keys(extended)) {
          expect(result.value?.theme).not.toHaveProperty(key);
        }
      });
    });

    it('drops an empty theme, so the page keeps its pre-F3 look', () => {
      const result = validateAppPage('store_home', {
        schema_version: 1,
        theme: { radius: '', primary_color: '' },
        blocks: [],
      });
      expect(result.valid).toBe(true);
      expect(result.value).not.toHaveProperty('theme');
    });

    it('the save DTO accepts a theme and answers a wrong one field by field', async () => {
      const ok = plainToInstance(UpdateProductPagePageDto, {
        page: { schema_version: 1, theme: { density: 'compact' }, blocks: [] },
      });
      expect(await validate(ok)).toEqual([]);

      const bad = plainToInstance(UpdateProductPagePageDto, {
        page: { schema_version: 1, theme: { button_style: 'ghost' }, blocks: [] },
      });
      const errors = await validate(bad);
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})).toEqual([
        'theme.button_style debe ser uno de: solid, outline.',
      ]);
    });

    it('a stored page with a broken theme reads as no page (pre-F2 render)', () => {
      expect(
        readAppPage('product_page', {
          page: { schema_version: 1, theme: { radius: 'huge' }, blocks: [] },
        }),
      ).toBeNull();
    });
  });

  describe('section variants and appearance (apps-sections)', () => {
    it('accepts hero variants, gallery layouts, highlights with media/icon/accent, cta image and block appearance', () => {
      const result = validateAppPage('product_page', {
        schema_version: 1,
        hero: {
          title: 'Producto estrella',
          variant: 'background',
          background_image_url: 'https://api.vendix.online/api/public/apps/media/10',
          overlay_opacity: 45,
          height: 'full',
          align: 'center',
        },
        blocks: [
          {
            id: 'gal',
            type: 'gallery',
            props: {
              title: 'Fotos',
              variant: 'carousel',
              columns: 4,
              aspect_ratio: '16:9',
              image_urls: [
                'https://api.vendix.online/api/public/apps/media/1',
                'https://api.vendix.online/api/public/apps/media/2',
              ],
              background_color: '#F8FAFC',
              spacing: 'spacious',
              align: 'center',
            },
          },
          {
            id: 'hl',
            type: 'highlights',
            props: {
              title: 'Destacados',
              variant: 'band',
              accent_color: '#0EA5E9',
              background_image_url: 'https://api.vendix.online/api/public/apps/media/3',
              overlay_opacity: 0,
              spacing: 'compact',
              align: 'left',
              items: [
                {
                  title: 'Envío rápido',
                  text: 'En 24 horas',
                  image_url: 'https://api.vendix.online/api/public/apps/media/4',
                  icon: 'truck',
                },
              ],
            },
          },
          {
            id: 'cta',
            type: 'cta',
            props: {
              title: 'Compra hoy',
              button_label: 'Comprar',
              image_url: 'https://api.vendix.online/api/public/apps/media/5',
            },
          },
        ],
      });

      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.value?.hero).toEqual({
        title: 'Producto estrella',
        variant: 'background',
        background_image_url: 'https://api.vendix.online/api/public/apps/media/10',
        overlay_opacity: 45,
        height: 'full',
        align: 'center',
      });
      expect(result.value?.blocks[1].props['overlay_opacity']).toBe(0);
      expect(result.value?.blocks[1].props['accent_color']).toBe('#0EA5E9');
    });

    it('rejects invalid enums, out-of-range sliders, bad colors and non-https media URLs', () => {
      const result = validateAppPage('service_page', {
        schema_version: 1,
        hero: {
          title: 'Servicios',
          variant: 'split',
          background_image_url: 'http://inseguro.co/bg.jpg',
          overlay_opacity: 95,
          height: 'giant',
          align: 'justify',
        },
        blocks: [
          {
            id: 'gal',
            type: 'gallery',
            props: {
              variant: 'masonry',
              columns: 5,
              aspect_ratio: '21:9',
              image_urls: ['http://inseguro.co/a.jpg'],
              background_color: 'azul',
              spacing: 'huge',
              align: 'middle',
            },
          },
          {
            id: 'hl',
            type: 'highlights',
            props: {
              variant: 'pills',
              accent_color: '#123',
              overlay_opacity: -5,
              items: [{ title: 'Uno', image_url: 'ftp://x.co/1.png', icon: 'invalid-icon' }],
            },
          },
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'hero.variant debe ser uno de: centered, image_right, background.',
          'hero.background_image_url debe ser una URL https.',
          'hero.overlay_opacity debe ser un entero entre 0 y 80.',
          'hero.height debe ser uno de: auto, compact, full.',
          'hero.align debe ser uno de: left, center, right.',
          'blocks[0].props.variant debe ser uno de: grid, carousel, mosaic.',
          'blocks[0].props.columns debe ser un entero entre 2 y 4.',
          'blocks[0].props.aspect_ratio debe ser uno de: 1:1, 4:3, 16:9.',
          'blocks[0].props.image_urls[0] debe ser una URL https.',
          'blocks[0].props.background_color debe ser un color #RRGGBB.',
          'blocks[0].props.spacing debe ser uno de: compact, normal, spacious.',
          'blocks[0].props.align debe ser uno de: left, center, right.',
          'blocks[1].props.variant debe ser uno de: cards, list, band.',
          'blocks[1].props.accent_color debe ser un color #RRGGBB.',
          'blocks[1].props.overlay_opacity debe ser un entero entre 0 y 80.',
          'blocks[1].props.items[0].image_url debe ser una URL https.',
          'blocks[1].props.items[0].icon debe ser uno de: sparkles, star, check, shield-check, truck, clock, heart, award, zap, flame, gift, map-pin, crown, thumbs-up.',
        ]),
      );
    });

    it('keeps store_home blocks and hero isolated from the new section customization props', () => {
      const okHero = validateAppPage('store_home', {
        schema_version: 1,
        hero: {
          eyebrow: 'Bienvenidos',
          title: 'Mi tienda',
          subtitle: 'Todo en un lugar',
          image_url: 'https://cdn.x.co/home.jpg',
          button_label: 'Explorar',
        },
        blocks: [],
      });
      expect(okHero.valid).toBe(true);

      const result = validateAppPage('store_home', {
        schema_version: 1,
        hero: {
          title: 'Mi tienda',
          variant: 'background',
          background_image_url: 'https://cdn.x.co/bg.jpg',
          overlay_opacity: 40,
          height: 'full',
          align: 'center',
        },
        blocks: [{ id: 'hl', type: 'highlights', props: { variant: 'band', spacing: 'compact' } }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'hero.variant no es un campo permitido.',
          'hero.background_image_url no es un campo permitido.',
          'hero.overlay_opacity no es un campo permitido.',
          'hero.height no es un campo permitido.',
          'hero.align no es un campo permitido.',
          'blocks[0].props.variant no es un campo permitido.',
          'blocks[0].props.spacing no es un campo permitido.',
        ]),
      );
    });

    it('rejects javascript: and data: URLs in background_image_url (hero and block)', () => {
      for (const badUrl of ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>']) {
        const result = validateAppPage('product_page', {
          schema_version: 1,
          hero: { title: 'Producto', background_image_url: badUrl },
          blocks: [
            {
              id: 'faq1',
              type: 'faq',
              props: { title: 'FAQ', background_image_url: badUrl },
            },
          ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual([
          'hero.background_image_url debe ser una URL https.',
          'blocks[0].props.background_image_url debe ser una URL https.',
        ]);
      }
    });
  });
});
