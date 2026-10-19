import { Meta, Title } from '@angular/platform-browser';
import { createLegalDocumentMetadata } from './legal-document-metadata';
import type { LegalDocument } from '../services/public-legal.service';

describe('Legal document marketing metadata', () => {
  const legal: LegalDocument = { id: 1, document_type: 'TERMS_OF_SERVICE', title: 'Términos',
    version: '1', content: 'Contenido aprobado', description: 'Condiciones vigentes', effective_date: '2026-01-01' };
  function setup(url = 'https://vendix.online/legal/terminos?ref=test#pagos') {
    const doc = document.implementation.createHTMLDocument('Portada');
    Object.defineProperty(doc, 'URL', { value: url });
    const title = new Title(doc);
    const meta = new Meta(doc);
    meta.updateTag({ name: 'description', content: 'Descripción portada' });
    meta.updateTag({ name: 'robots', content: 'index, follow' });
    const link = doc.createElement('link');
    link.rel = 'canonical'; link.href = 'https://vendix.online/'; doc.head.appendChild(link);
    return { doc, title, meta, link, lifecycle: createLegalDocumentMetadata(doc, title, meta) };
  }

  it('does not canonicalize loading and unavailable documents to the homepage', () => {
    const { lifecycle, link, title, meta } = setup();
    lifecycle.update(null, false);
    expect(link.hasAttribute('href')).toBeFalse();
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
    lifecycle.update(null, true);
    expect(title.getTitle()).toBe('Documento no disponible | Vendix');
    expect(link.hasAttribute('href')).toBeFalse();
  });
  it('sets legal metadata with a clean self canonical, retaining noindex until hosting is corrected', () => {
    const { lifecycle, link, title, meta } = setup('https://www.vendix.online/legal/terminos?a=1#pagos');
    lifecycle.update(legal, true);
    expect(title.getTitle()).toBe('Términos | Vendix');
    expect(meta.getTag('name="description"')?.content).toBe('Condiciones vigentes');
    expect(link.href).toBe('https://vendix.online/legal/terminos');
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, follow');
  });
  it('treats blank content as unavailable', () => {
    const { lifecycle, link, title } = setup();
    lifecycle.update({ ...legal, content: '  ' }, true);
    expect(title.getTitle()).toBe('Documento no disponible | Vendix');
    expect(link.hasAttribute('href')).toBeFalse();
  });
  it('restores metadata on exit without creating duplicate canonical links', () => {
    const { lifecycle, doc, link, title, meta } = setup();
    lifecycle.update(legal, true); lifecycle.restore();
    expect(title.getTitle()).toBe('Portada');
    expect(link.href).toBe('https://vendix.online/');
    expect(meta.getTag('name="description"')?.content).toBe('Descripción portada');
    expect(meta.getTag('name="robots"')?.content).toBe('index, follow');
    expect(doc.querySelectorAll('link[rel="canonical"]').length).toBe(1);
  });
  it('does not overwrite metadata subsequently set by another route', () => {
    const { lifecycle, link, title, meta } = setup();
    lifecycle.update(legal, true);
    title.setTitle('Nueva ruta'); link.href = 'https://vendix.online/nueva';
    meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    lifecycle.restore();
    expect(title.getTitle()).toBe('Nueva ruta');
    expect(link.href).toBe('https://vendix.online/nueva');
    expect(meta.getTag('name="robots"')?.content).toBe('noindex, nofollow');
  });
  it('preserves tenant, custom and spoofed host metadata', () => {
    for (const host of ['shop.vendix.online', 'example.com', 'vendix.online.example.com']) {
      const { lifecycle, title, link } = setup(`https://${host}/legal/terminos`);
      lifecycle.update(legal, true); lifecycle.restore();
      expect(title.getTitle()).toBe('Portada'); expect(link.href).toBe('https://vendix.online/');
    }
  });
  it('does not change unrelated paths', () => {
    const { lifecycle, title } = setup('https://vendix.online/admin');
    lifecycle.update(legal, true); expect(title.getTitle()).toBe('Portada');
  });
  it('restores initially absent tags and an href-less canonical', () => {
    const { doc, meta, title, link } = setup();
    meta.removeTag('name="description"'); meta.removeTag('name="robots"'); link.removeAttribute('href');
    const lifecycle = createLegalDocumentMetadata(doc, title, meta);
    lifecycle.update(legal, true); lifecycle.restore();
    expect(meta.getTag('name="description"')).toBeNull();
    expect(meta.getTag('name="robots"')).toBeNull();
    expect(link.hasAttribute('href')).toBeFalse();
  });
  it('removes a canonical created by the viewer on exit', () => {
    const { doc, title, meta, link } = setup(); link.remove();
    const lifecycle = createLegalDocumentMetadata(doc, title, meta);
    lifecycle.update(legal, true); lifecycle.restore();
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  });
});
