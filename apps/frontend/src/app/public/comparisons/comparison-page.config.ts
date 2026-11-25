import { environment } from '../../../environments/environment';

/**
 * SEO-OPS-30: interruptor de la ruta /comparativas/software-pos-colombia.
 * Apagado en producción. Antes de encenderlo:
 * 1. Revisión legal (Ley 256 de 1996, art. 13; Ley 1480 de 2011, arts. 29-30) y firma de Adel.
 * 2. Revalidar los precios en las webs oficiales (≤ 7 días) y actualizar COMPARISON_PRICES_CHECKED_AT.
 * 3. Pasar COMPARISON_PAGE_INDEXABLE a true y agregar la ruta a MARKETING_PAGES de
 *    infra/cloudfront/spa-rewrite.js, al sitemap del backend y al smoke SEO.
 */
export const COMPARISON_PAGE_ENABLED = environment.comparisonPageEnabled;

/** Mientras no haya firma, la vista previa es noindex y muestra el rótulo de borrador. */
export const COMPARISON_PAGE_INDEXABLE = false;

export const COMPARISON_PAGE_PATH = 'comparativas/software-pos-colombia';

/** Fecha de la última revalidación en las webs oficiales (evidencias/OPS-30-revalidacion-precios-2026-11-19.md). */
export const COMPARISON_PRICES_CHECKED_AT = '2026-11-19';
