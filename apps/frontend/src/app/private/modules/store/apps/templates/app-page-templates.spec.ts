// The backend contract is pure TypeScript with no imports: checking the
// templates against it here means a template can never ship a page the save
// endpoint (`PATCH /store/apps/<app>/page`) would reject.
import {
  APP_PAGE_BLOCKS,
  validateAppPage,
} from '../../../../../../../../backend/src/domains/store/apps/shared/app-page.contract';
import {
  MIN_TEXT_CONTRAST,
  contrastChecks,
  contrastRatio,
  mixColors,
} from '../../../../../public/app-page/app-page-theme';
import { APP_PAGE_TEMPLATES, APP_PAGE_VARIANTS, PAGE_APP_KINDS, applyVariant } from './index';

describe('Apps F2 · app page templates', () => {
  for (const kind of PAGE_APP_KINDS) {
    it(`the ${kind} base page saves as it is`, () => {
      const result = validateAppPage(kind, APP_PAGE_TEMPLATES[kind].page);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBeTrue();
    });

    it(`the ${kind} editor offers exactly its own blocks`, () => {
      const editorTypes = APP_PAGE_TEMPLATES[kind].blocks.map((block) => block.type).sort();
      expect(editorTypes).toEqual(Object.keys(APP_PAGE_BLOCKS[kind]).sort());
    });
  }

  it('no app starts as a copy of another one', () => {
    const signatures = PAGE_APP_KINDS.map((kind) =>
      APP_PAGE_TEMPLATES[kind].page.blocks.map((block) => block.type).join(','),
    );
    expect(new Set(signatures).size).toBe(PAGE_APP_KINDS.length);
  });

  it('no app page offers a landing block', () => {
    const landingBlocks = ['hero', 'features', 'products_grid', 'store_gallery', 'promo_banner', 'about', 'contact_form', 'footer_cta'];
    for (const kind of PAGE_APP_KINDS) {
      const types = APP_PAGE_TEMPLATES[kind].blocks.map((block) => block.type);
      expect(types.filter((type) => landingBlocks.includes(type))).toEqual([]);
    }
  });

  describe('Apps F3 · template variants', () => {
    const expectedNames: Record<string, string[]> = {
      product_page: ['Base', 'Boutique', 'Clínico/limpio'],
      service_page: ['Base', 'Belleza cálida', 'Profesional sobrio'],
      booking: ['Base', 'Minimalista', 'Cálido/acogedor'],
      store_home: ['Base', 'Editorial', 'Compacta'],
    };

    for (const kind of PAGE_APP_KINDS) {
      const variants = APP_PAGE_VARIANTS[kind];

      it(`${kind} offers the base and its two variants`, () => {
        expect(variants.map((v) => v.name)).toEqual(expectedNames[kind]);
        expect(variants[0].page).toBe(APP_PAGE_TEMPLATES[kind].page);
        expect(variants[0].page.theme).toBeUndefined();
      });

      for (const variant of variants.slice(1)) {
        it(`${kind} · ${variant.name} saves as it is and only uses its app's blocks`, () => {
          const result = validateAppPage(kind, variant.page);
          expect(result.errors).toEqual([]);
          const catalog = Object.keys(APP_PAGE_BLOCKS[kind]);
          expect(variant.page.blocks.every((b) => catalog.includes(b.type))).toBeTrue();
        });

        it(`${kind} · ${variant.name} changes the order of the base and brings its own style`, () => {
          // Only the app's own blocks follow `blocks[]` on the public page;
          // the existing sections (product, services, rooms, apps) keep their place.
          const existing = new Set(APP_PAGE_TEMPLATES[kind].blocks.filter((b) => b.existing).map((b) => b.type));
          const order = (blocks: { type: string; enabled: boolean }[]) =>
            blocks.filter((b) => b.enabled && !existing.has(b.type)).map((b) => b.type).join(',');
          expect(order(variant.page.blocks)).not.toBe(order(APP_PAGE_TEMPLATES[kind].page.blocks));
          expect(Object.keys(variant.page.theme ?? {}).length).toBe(12);
        });

        it(`${kind} · ${variant.name} keeps every text readable (WCAG AA 4.5:1)`, () => {
          const checks = contrastChecks(variant.page.theme);
          expect(checks.length).toBeGreaterThanOrEqual(4);
          for (const check of checks) {
            expect(check.ratio).withContext(check.label).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
          }
          // The rating badge paints the accent on a 10 % tint of itself.
          const theme = variant.page.theme!;
          const badge = mixColors(theme.accent_color!, theme.surface_color!, 0.1);
          expect(contrastRatio(theme.accent_color!, badge)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
        });
      }
    }

    it('using a template replaces hero, sections and style but keeps mode, sales, brand and SEO', () => {
      const current = {
        schema_version: 1 as const,
        mode: 'info' as const,
        sales: { product_mode: 'catalog' as const, show_cart: false },
        brand: { logo_url: 'https://cdn.x.co/logo.png' },
        seo: { title: 'Mi tienda' },
        hero: { title: 'Lo mío' },
        theme: { density: 'compact' as const },
        blocks: [{ id: 'faq', type: 'faq', enabled: true, props: {} }],
      };
      const boutique = APP_PAGE_VARIANTS.product_page[1];
      const next = applyVariant(current, boutique);
      expect(next.mode).toBe('info');
      expect(next.sales).toEqual(current.sales);
      expect(next.brand).toEqual(current.brand);
      expect(next.seo).toEqual(current.seo);
      expect(next.hero).toEqual(boutique.page.hero);
      expect(next.theme).toEqual(boutique.page.theme);
      expect(next.blocks).toEqual(boutique.page.blocks);
      expect(next.blocks).not.toBe(boutique.page.blocks);

      const base = applyVariant(next, APP_PAGE_VARIANTS.product_page[0]);
      expect(base.theme).toBeUndefined();
      expect(base.mode).toBe('info');
    });
  });
});
