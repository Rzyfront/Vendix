import { Injectable, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';

/**
 * SEO de la tienda en línea (STORE_ECOMMERCE).
 *
 * Todas las apps comparten el mismo `index.html`, que trae la descripción, los
 * `og:*` y el canonical de la web comercial de Vendix. Verificado en producción el
 * 2026-10-23: cada página de producto de cada tienda declaraba
 * `canonical https://vendix.online/`, la descripción de Vendix y como título el
 * slug de la tienda. Para Google, el producto era un duplicado de la portada de
 * Vendix.
 *
 * Contrato:
 *  - El layout registra los datos de la tienda (`setStore`). Mientras ninguna
 *    página tenga metadatos propios, se aplican los de la tienda (sin canonical).
 *  - Cada página indexable reclama los metadatos con `apply(owner, page)` y los
 *    libera con `release(owner)`. Al liberar se vuelve a los de la tienda, nunca a
 *    los de Vendix. Una página no puede pisar a otra: solo libera quien es dueño.
 */
export interface StorePageSeo {
  title: string;
  description: string;
  /** Ruta canónica en el host de la tienda (sin query). `null` quita el canonical. */
  canonicalPath: string | null;
  robots: 'index, follow' | 'noindex, follow';
  image?: string | null;
  /** Datos estructurados (por ejemplo `Product`). `null` quita el bloque. */
  jsonLd?: Record<string, unknown> | null;
}

export interface StoreProductSeoInput {
  name: string;
  slug: string;
  description: string | null;
  final_price: number;
  is_available: boolean;
  image_url: string | null;
  images?: { image_url: string }[];
  sku: string | null;
  brand: { name: string } | null;
}

const JSON_LD_ID = 'store-seo-jsonld';
const DESCRIPTION_MAX = 160;

/** Texto plano de una descripción que puede venir con HTML, recortado para el snippet. */
export function plainDescription(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const value = text || fallback;
  if (value.length <= DESCRIPTION_MAX) return value;
  const cut = value.slice(0, DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** Página de producto: título, descripción, canonical único y JSON-LD `Product` con su oferta real. */
export function productPageSeo(
  product: StoreProductSeoInput,
  storeName: string,
  origin: string,
  currencyCode: string,
): StorePageSeo {
  const canonicalPath = `/products/${encodeURIComponent(product.slug)}`;
  const description = plainDescription(product.description, `${product.name} en ${storeName}.`);
  const images = [product.image_url, ...(product.images ?? []).map((i) => i.image_url)]
    .filter((u): u is string => !!u)
    .filter((u, i, all) => all.indexOf(u) === i);
  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    url: origin + canonicalPath,
    ...(images.length ? { image: images } : {}),
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.brand?.name ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),
  };
  // Sin moneda conocida no se publica oferta: un precio sin moneda es un dato falso.
  if (currencyCode && Number.isFinite(product.final_price) && product.final_price > 0) {
    jsonLd['offers'] = {
      '@type': 'Offer',
      url: origin + canonicalPath,
      price: String(product.final_price),
      priceCurrency: currencyCode,
      availability: product.is_available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: storeName },
    };
  }
  return {
    title: `${product.name} | ${storeName}`,
    description,
    canonicalPath,
    robots: 'index, follow',
    image: images[0] ?? null,
    jsonLd,
  };
}

/** Canonical de los listados: los alias /products, /productos, /new y /sale apuntan a una sola URL. */
export function catalogCanonicalPath(routeTitle: string | undefined): string {
  if (routeTitle === 'Novedades') return '/novedades';
  if (routeTitle === 'Ofertas') return '/ofertas';
  return '/catalog';
}

@Injectable({ providedIn: 'root' })
export class StoreSeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  private readonly storeNameSignal = signal('');
  /** Nombre visible de la tienda; vacío hasta que el layout lo registra. */
  readonly storeName = this.storeNameSignal.asReadonly();
  private storeDescription = '';
  private owner: object | null = null;

  /** Origen del host de la tienda (subdominio o dominio propio). */
  get origin(): string {
    return new URL(this.document.URL).origin;
  }

  /** Registra los datos de la tienda; si ninguna página es dueña, aplica sus metadatos. */
  setStore(name: string, description?: string | null): void {
    this.storeNameSignal.set(name);
    this.storeDescription = (description ?? '').trim();
    if (!this.owner) this.applyStoreDefaults();
  }

  /**
   * Metadatos de una página de listado de la tienda (portada, catálogo, novedades,
   * ofertas, cartas). `null` mientras no se conozca el nombre de la tienda.
   */
  listingPage(canonicalPath: string, label: string | null): StorePageSeo | null {
    const name = this.storeNameSignal();
    if (!name) return null;
    return {
      title: label ? `${label} | ${name}` : name,
      description: label
        ? `${label} de ${name}. Compra en línea.`
        : plainDescription(this.storeDescription, `Compra en línea en ${name}.`),
      canonicalPath,
      robots: 'index, follow',
      image: null,
      jsonLd: null,
    };
  }

  apply(owner: object, page: StorePageSeo): void {
    this.owner = owner;
    this.write(page);
  }

  release(owner: object): void {
    if (this.owner !== owner) return;
    this.owner = null;
    this.applyStoreDefaults();
  }

  private applyStoreDefaults(): void {
    const name = this.storeNameSignal();
    if (!name) return;
    this.write({
      title: name,
      description: plainDescription(this.storeDescription, `Compra en línea en ${name}.`),
      canonicalPath: null,
      robots: 'index, follow',
      image: null,
      jsonLd: null,
    });
  }

  private write(page: StorePageSeo): void {
    const href = page.canonicalPath === null ? null : this.origin + page.canonicalPath;
    this.title.setTitle(page.title);
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.updateTag({ name: 'robots', content: page.robots });
    this.setProperty('og:title', page.title);
    this.setProperty('og:description', page.description);
    this.setProperty('og:url', href);
    this.setProperty('og:image', page.image ?? null);
    this.setProperty('og:type', page.jsonLd?.['@type'] === 'Product' ? 'product' : 'website');

    const canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (href === null) canonical?.remove();
    else if (canonical) canonical.setAttribute('href', href);
    else {
      const link = this.document.createElement('link');
      link.rel = 'canonical';
      link.href = href;
      this.document.head.appendChild(link);
    }

    this.document.getElementById(JSON_LD_ID)?.remove();
    if (page.jsonLd) {
      const script = this.document.createElement('script');
      script.type = 'application/ld+json';
      script.id = JSON_LD_ID;
      script.textContent = JSON.stringify(page.jsonLd);
      this.document.head.appendChild(script);
    }
  }

  private setProperty(property: string, content: string | null): void {
    if (content === null) this.meta.removeTag(`property="${property}"`);
    else this.meta.updateTag({ property, content });
  }
}
