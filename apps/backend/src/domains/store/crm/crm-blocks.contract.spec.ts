import { APP_PAGE_FONTS } from '../apps/shared/app-page.contract';
import {
  CRM_LANDING_FONTS,
  MAX_SEO_DESCRIPTION,
  MAX_SEO_TITLE,
  validateCrmLandingDocument,
} from './crm-blocks.contract';

/**
 * F6-A: the landing editor saves optional hidden sections, typography, logo
 * and SEO inside the same v1 document. A document without them keeps
 * validating exactly as before (live stores are untouched).
 */
describe('validateCrmLandingDocument · F6-A optional fields', () => {
  const block = { id: 'hero_1', type: 'hero', props: { title: 'Hola' } };
  const doc = (extra: Record<string, unknown> = {}) => ({
    schema_version: 1,
    blocks: [block],
    ...extra,
  });

  it('keeps accepting a pre-F6 document with none of the new fields', () => {
    expect(validateCrmLandingDocument(doc({ theme: { primary_color: '#112233' } }))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('accepts hidden sections, fonts, logo and SEO within their limits', () => {
    const result = validateCrmLandingDocument(
      doc({
        blocks: [{ ...block, hidden: true }],
        theme: { font_heading: 'playfair', font_body: 'inter', logo_url: 'https://cdn.x.co/logo.png' },
        seo: { title: 'a'.repeat(MAX_SEO_TITLE), description: 'b'.repeat(MAX_SEO_DESCRIPTION), image_url: '' },
      }),
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('rejects a non-boolean hidden flag', () => {
    const result = validateCrmLandingDocument(doc({ blocks: [{ ...block, hidden: 'yes' }] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['blocks[0].hidden debe ser verdadero o falso.']);
  });

  it('rejects a font outside the closed catalog and a non-https logo', () => {
    const result = validateCrmLandingDocument(
      doc({ theme: { font_heading: 'comic-sans', logo_url: 'http://x.co/l.png' } }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      `theme.font_heading inválida. Permitidas: ${CRM_LANDING_FONTS.join(', ')}.`,
      'theme.logo_url debe ser una URL https.',
    ]);
  });

  it('rejects SEO texts over their limits and a non-https image', () => {
    const result = validateCrmLandingDocument(
      doc({
        seo: {
          title: 'a'.repeat(MAX_SEO_TITLE + 1),
          description: 'b'.repeat(MAX_SEO_DESCRIPTION + 1),
          image_url: 'javascript:alert(1)',
        },
      }),
    );
    expect(result.errors).toEqual([
      `seo.title admite máximo ${MAX_SEO_TITLE} caracteres.`,
      `seo.description admite máximo ${MAX_SEO_DESCRIPTION} caracteres.`,
      'seo.image_url debe ser una URL https.',
    ]);
  });

  it('rejects an SEO that is not an object', () => {
    expect(validateCrmLandingDocument(doc({ seo: 'x' })).errors).toEqual(['seo debe ser un objeto.']);
  });

  it('uses the same font catalog as the app pages', () => {
    expect([...CRM_LANDING_FONTS]).toEqual([...APP_PAGE_FONTS]);
  });
});
