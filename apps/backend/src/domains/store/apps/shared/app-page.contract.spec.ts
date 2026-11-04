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
      theme: {},
      mode: 'rent',
      booking: { require_account: true, source: 'calendar' },
      brand: { primary_color: 'red', logo_url: 'http://x.co/logo.png' },
      blocks: [
        { id: 'x', type: 'testimonials', props: { items: [{ rating: 6 }] } },
        { id: 'x', type: 'testimonials', props: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.errors).toEqual([
      'theme no es un campo permitido.',
      'schema_version debe ser 1.',
      'mode debe ser uno de: booking, sales, both, info.',
      'booking.source debe ser uno de: agenda, rooms.',
      'booking.require_account: la reserva no exige cuenta.',
      'brand.logo_url debe ser una URL https.',
      'brand.primary_color debe ser un color #RRGGBB.',
      'blocks[0].props.items[0].rating debe ser un entero entre 1 y 5.',
      'blocks[1].id está repetido.',
      'blocks[1].type "testimonials" está repetido.',
    ]);
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
});
