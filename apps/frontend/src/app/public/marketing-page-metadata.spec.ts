import { Meta, Title } from '@angular/platform-browser';
import { applyMarketingPageMetadata, MARKETING_PAGES } from './marketing-page-metadata';

describe('Marketing page metadata (SEO-TECH-04)', () => {
  function setup(url: string) {
    const doc = document.implementation.createHTMLDocument('Vendix — Plataforma');
    Object.defineProperty(doc, 'URL', { value: url });
    const title = new Title(doc);
    const meta = new Meta(doc);
    meta.updateTag({ name: 'description', content: 'Descripción portada' });
    meta.updateTag({ name: 'robots', content: 'index, follow' });
    const link = doc.createElement('link');
    link.rel = 'canonical';
    link.href = 'https://vendix.online/';
    doc.head.appendChild(link);
    meta.updateTag({ property: 'og:title', content: 'Vendix — Tu negocio, simplificado' });
    meta.updateTag({ property: 'og:description', content: 'OG portada' });
    meta.updateTag({ property: 'og:url', content: 'https://vendix.online/' });
    meta.updateTag({ name: 'twitter:title', content: 'Vendix — Tu negocio, simplificado' });
    meta.updateTag({ name: 'twitter:description', content: 'Twitter portada' });
    return { doc, title, meta, link };
  }

  it('gives /pricing its own title, description and clean self canonical', () => {
    const { doc, title, meta, link } = setup('https://www.vendix.online/pricing?utm_source=x#planes');
    applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.pricing);
    expect(title.getTitle()).toBe(MARKETING_PAGES.pricing.title);
    expect(meta.getTag('name="description"')?.content).toBe(MARKETING_PAGES.pricing.description);
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
    expect(link.getAttribute('href')).toBe('https://vendix.online/pricing');
  });

  it('marks auth pages noindex and drops the homepage canonical', () => {
    const { doc, title, meta, link } = setup('https://vendix.online/auth/register');
    applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.register);
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
    expect(link.hasAttribute('href')).toBeFalse();
    expect(title.getTitle()).toBe('Crea tu cuenta | Vendix');
  });

  it('uses the .com origin on the .com marketing host', () => {
    const { doc, title, meta, link } = setup('https://vendix.com/pricing');
    applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.pricing);
    expect(link.getAttribute('href')).toBe('https://vendix.com/pricing');
  });

  it('does nothing on store hosts that share the auth components', () => {
    const { doc, title, meta, link } = setup('https://mi-tienda.vendix.online/auth/login');
    const restore = applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.login);
    expect(title.getTitle()).toBe('Vendix — Plataforma');
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
    expect(link.getAttribute('href')).toBe('https://vendix.online/');
    expect(() => restore()).not.toThrow();
  });

  it('restores the previous values when leaving the page', () => {
    const { doc, title, meta, link } = setup('https://vendix.online/auth/login');
    const restore = applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.login);
    restore();
    expect(title.getTitle()).toBe('Vendix — Plataforma');
    expect(meta.getTag('name="description"')?.content).toBe('Descripción portada');
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
    expect(link.getAttribute('href')).toBe('https://vendix.online/');
  });

  it('does not overwrite metadata already written by the next page', () => {
    const { doc, title, meta, link } = setup('https://vendix.online/pricing');
    const restore = applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.pricing);
    title.setTitle('Términos | Vendix');
    meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    link.setAttribute('href', 'https://vendix.online/legal/terminos');
    restore();
    expect(title.getTitle()).toBe('Términos | Vendix');
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
    expect(link.getAttribute('href')).toBe('https://vendix.online/legal/terminos');
    expect(meta.getTag('name="description"')?.content).toBe('Descripción portada');
  });

  it('gives /pricing its own og and twitter card and restores the homepage card on leave', () => {
    const { doc, title, meta } = setup('https://vendix.online/pricing');
    const restore = applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.pricing);
    expect(meta.getTag('property="og:title"')?.content).toBe(MARKETING_PAGES.pricing.title);
    expect(meta.getTag('property="og:description"')?.content).toBe(MARKETING_PAGES.pricing.description);
    expect(meta.getTag('property="og:url"')?.content).toBe('https://vendix.online/pricing');
    expect(meta.getTag('name="twitter:title"')?.content).toBe(MARKETING_PAGES.pricing.title);
    expect(meta.getTag('name="twitter:description"')?.content).toBe(MARKETING_PAGES.pricing.description);
    restore();
    expect(meta.getTag('property="og:title"')?.content).toBe('Vendix — Tu negocio, simplificado');
    expect(meta.getTag('property="og:url"')?.content).toBe('https://vendix.online/');
    expect(meta.getTag('name="twitter:description"')?.content).toBe('Twitter portada');
  });

  it('leaves the og and twitter card untouched on noindex pages without canonical', () => {
    const { doc, title, meta } = setup('https://vendix.online/auth/login');
    applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.login);
    expect(meta.getTag('property="og:title"')?.content).toBe('Vendix — Tu negocio, simplificado');
    expect(meta.getTag('property="og:url"')?.content).toBe('https://vendix.online/');
  });

  for (const key of ['forgotPassword', 'resetPassword', 'verifyEmail', 'pqr', 'pqrTrack'] as const) {
    it(`marks ${key} noindex, follow without canonical and restores robots on leave`, () => {
      const { doc, title, meta, link } = setup('https://vendix.online/pqr');
      const restore = applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES[key]);
      expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
      expect(link.hasAttribute('href')).toBeFalse();
      restore();
      expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
      expect(link.getAttribute('href')).toBe('https://vendix.online/');
    });
  }

  it('keeps PQR robots untouched on store hosts that reuse the PQR pages', () => {
    const { doc, title, meta } = setup('https://mi-tienda.vendix.online/pqr');
    applyMarketingPageMetadata(doc, title, meta, MARKETING_PAGES.pqr);
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
  });

  it('keeps titles within 70 and descriptions within 200 characters', () => {
    for (const page of Object.values(MARKETING_PAGES)) {
      expect(page.description.length).toBeLessThanOrEqual(200);
      expect(page.title.length).toBeLessThanOrEqual(70);
    }
  });
});
