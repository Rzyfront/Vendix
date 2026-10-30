import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import {
  StoreSeoService,
  catalogCanonicalPath,
  plainDescription,
  productPageSeo,
  StoreProductSeoInput,
} from './store-seo';

const ORIGIN = 'https://vendix-pit-and-grill-shop.vendix.online';

const product = (overrides: Partial<StoreProductSeoInput> = {}): StoreProductSeoInput => ({
  name: 'Cerveza Club Colombia',
  slug: 'cerveza-club-colombia',
  description: '<p>Cerveza dorada&nbsp;330 ml.</p>',
  final_price: 5000,
  is_available: true,
  image_url: 'https://cdn.example/club.png',
  images: [{ image_url: 'https://cdn.example/club.png' }, { image_url: 'https://cdn.example/club-2.png' }],
  sku: 'CLUB-330',
  brand: { name: 'Club Colombia' },
  ...overrides,
});

describe('Store SEO (tienda en línea)', () => {
  describe('productPageSeo', () => {
    it('usa canonical único en el host de la tienda y JSON-LD Product con su oferta', () => {
      const page = productPageSeo(product(), 'Pit and Grill', ORIGIN, 'COP');
      expect(page.title).toBe('Cerveza Club Colombia | Pit and Grill');
      expect(page.canonicalPath).toBe('/products/cerveza-club-colombia');
      expect(page.robots).toBe('index, follow');
      expect(page.description).toBe('Cerveza dorada 330 ml.');
      expect(page.image).toBe('https://cdn.example/club.png');
      const ld = page.jsonLd as any;
      expect(ld['@type']).toBe('Product');
      expect(ld.url).toBe(ORIGIN + '/products/cerveza-club-colombia');
      expect(ld.image).toEqual(['https://cdn.example/club.png', 'https://cdn.example/club-2.png']);
      expect(ld.sku).toBe('CLUB-330');
      expect(ld.brand).toEqual({ '@type': 'Brand', name: 'Club Colombia' });
      expect(ld.offers).toEqual(jasmine.objectContaining({
        '@type': 'Offer', price: '5000', priceCurrency: 'COP',
        availability: 'https://schema.org/InStock',
      }));
    });

    it('marca agotado cuando el producto no está disponible', () => {
      const ld = productPageSeo(product({ is_available: false }), 'Pit', ORIGIN, 'COP').jsonLd as any;
      expect(ld.offers.availability).toBe('https://schema.org/OutOfStock');
    });

    it('no publica oferta sin moneda ni con precio cero', () => {
      expect((productPageSeo(product(), 'Pit', ORIGIN, '').jsonLd as any).offers).toBeUndefined();
      expect((productPageSeo(product({ final_price: 0 }), 'Pit', ORIGIN, 'COP').jsonLd as any).offers).toBeUndefined();
    });

    it('usa una descripción de respaldo y omite campos vacíos', () => {
      const page = productPageSeo(product({ description: null, sku: null, brand: null, image_url: null, images: [] }), 'Pit', ORIGIN, 'COP');
      expect(page.description).toBe('Cerveza Club Colombia en Pit.');
      const ld = page.jsonLd as any;
      expect(ld.sku).toBeUndefined();
      expect(ld.brand).toBeUndefined();
      expect(ld.image).toBeUndefined();
      expect(page.image).toBeNull();
    });

    it('codifica el slug en la URL canónica', () => {
      expect(productPageSeo(product({ slug: 'café 500 g' }), 'Pit', ORIGIN, 'COP').canonicalPath)
        .toBe('/products/caf%C3%A9%20500%20g');
    });
  });

  it('plainDescription quita HTML y recorta a 160 caracteres sin cortar palabras', () => {
    const long = 'palabra '.repeat(40);
    const out = plainDescription(long, 'x');
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBeTrue();
    expect(out).not.toContain('  ');
    expect(plainDescription('  ', 'respaldo')).toBe('respaldo');
  });

  it('catalogCanonicalPath unifica los alias de los listados', () => {
    expect(catalogCanonicalPath(undefined)).toBe('/catalog');
    expect(catalogCanonicalPath('Novedades')).toBe('/novedades');
    expect(catalogCanonicalPath('Ofertas')).toBe('/ofertas');
  });

  describe('StoreSeoService', () => {
    let doc: Document;
    let service: StoreSeoService;

    beforeEach(() => {
      doc = document.implementation.createHTMLDocument('Vendix — Plataforma');
      Object.defineProperty(doc, 'URL', { value: ORIGIN + '/products/cerveza-club-colombia?utm_source=x' });
      const meta = new Meta(doc);
      // Lo que trae el index.html compartido de Vendix.
      meta.updateTag({ name: 'description', content: 'Crea tu tienda online…' });
      meta.updateTag({ name: 'robots', content: 'index, follow' });
      meta.updateTag({ property: 'og:title', content: 'Vendix — Tu negocio, simplificado' });
      meta.updateTag({ property: 'og:url', content: 'https://vendix.online/' });
      const link = doc.createElement('link');
      link.rel = 'canonical';
      link.href = 'https://vendix.online/';
      doc.head.appendChild(link);
      TestBed.configureTestingModule({
        providers: [
          { provide: DOCUMENT, useValue: doc },
          { provide: Title, useValue: new Title(doc) },
          { provide: Meta, useValue: meta },
        ],
      });
      service = TestBed.inject(StoreSeoService);
    });

    const canonical = () => doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
    const metaContent = (sel: string) => doc.head.querySelector(`meta[${sel}]`)?.getAttribute('content') ?? null;

    it('al registrar la tienda quita el canonical, la descripción y el og de Vendix', () => {
      service.setStore('Pit and Grill', null);
      expect(doc.title).toBe('Pit and Grill');
      expect(canonical()).toBeNull();
      expect(metaContent('name="description"')).toBe('Compra en línea en Pit and Grill.');
      expect(metaContent('property="og:title"')).toBe('Pit and Grill');
      expect(metaContent('property="og:url"')).toBeNull();
    });

    it('una página de la tienda sin dueño (carrito, cuenta, pedido por token) queda noindex', () => {
      service.setStore('Pit and Grill', null);
      expect(metaContent('name="robots"')).toBe('noindex, follow');
    });

    it('portada, catálogo y producto se declaran indexables y al salir vuelve el noindex', () => {
      service.setStore('Pit and Grill');
      const owner = {};
      service.apply(owner, service.listingPage('/', null)!);
      expect(metaContent('name="robots"')).toBe('index, follow');
      service.release(owner);
      expect(metaContent('name="robots"')).toBe('noindex, follow');
    });

    it('usa la descripción SEO de la tienda si existe', () => {
      service.setStore('Pit and Grill', 'Parrilla y licores a domicilio en Cali.');
      expect(metaContent('name="description"')).toBe('Parrilla y licores a domicilio en Cali.');
    });

    it('aplica el producto con canonical del host de la tienda y su JSON-LD', () => {
      service.setStore('Pit and Grill');
      const owner = {};
      service.apply(owner, productPageSeo(product(), 'Pit and Grill', service.origin, 'COP'));
      expect(canonical()).toBe(ORIGIN + '/products/cerveza-club-colombia');
      expect(metaContent('property="og:type"')).toBe('product');
      const script = doc.getElementById('store-seo-jsonld');
      expect(JSON.parse(script!.textContent!).name).toBe('Cerveza Club Colombia');
    });

    it('si la tienda se registra después que la página, no pisa los metadatos de la página', () => {
      const owner = {};
      service.apply(owner, productPageSeo(product(), 'Pit and Grill', service.origin, 'COP'));
      service.setStore('Pit and Grill');
      expect(doc.title).toBe('Cerveza Club Colombia | Pit and Grill');
      expect(canonical()).toBe(ORIGIN + '/products/cerveza-club-colombia');
    });

    it('al liberar vuelve a los datos de la tienda, nunca a los de Vendix', () => {
      service.setStore('Pit and Grill');
      const owner = {};
      service.apply(owner, productPageSeo(product(), 'Pit and Grill', service.origin, 'COP'));
      service.release(owner);
      expect(doc.title).toBe('Pit and Grill');
      expect(canonical()).toBeNull();
      expect(doc.getElementById('store-seo-jsonld')).toBeNull();
      expect(metaContent('name="description"')).not.toContain('Crea tu tienda online');
    });

    it('una página que ya no es dueña no puede liberar los metadatos de otra', () => {
      service.setStore('Pit and Grill');
      const product1 = {};
      const catalog = {};
      service.apply(product1, productPageSeo(product(), 'Pit and Grill', service.origin, 'COP'));
      service.apply(catalog, service.listingPage('/catalog', 'Catálogo')!);
      service.release(product1);
      expect(doc.title).toBe('Catálogo | Pit and Grill');
      expect(canonical()).toBe(ORIGIN + '/catalog');
    });

    it('listingPage espera al nombre de la tienda y arma título y canonical', () => {
      expect(service.listingPage('/ofertas', 'Ofertas')).toBeNull();
      service.setStore('Pit and Grill');
      expect(service.listingPage('/ofertas', 'Ofertas')).toEqual(jasmine.objectContaining({
        title: 'Ofertas | Pit and Grill', canonicalPath: '/ofertas', robots: 'index, follow',
      }));
      expect(service.listingPage('/', null)!.title).toBe('Pit and Grill');
    });
  });
});
