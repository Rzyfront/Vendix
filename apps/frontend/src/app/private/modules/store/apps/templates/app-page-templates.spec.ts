// The backend contract is pure TypeScript with no imports: checking the
// templates against it here means a template can never ship a page the save
// endpoint (`PATCH /store/apps/<app>/page`) would reject.
import {
  APP_PAGE_BLOCKS,
  validateAppPage,
} from '../../../../../../../../backend/src/domains/store/apps/shared/app-page.contract';
import { APP_PAGE_TEMPLATES, PAGE_APP_KINDS } from './index';

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
});
