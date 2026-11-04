import type { StorePageSeo } from '../../private/modules/ecommerce/services/store-seo';
import type { AppPageDocument } from '../../private/modules/store/apps/templates/app-page.types';

/**
 * Applies the owner's SEO (`page.seo`) over a page's default metadata. Fields
 * the owner left empty keep the default; with no page the default is returned
 * untouched (apps-f2 S5).
 */
export function withPageSeo(base: StorePageSeo, page: AppPageDocument | null | undefined): StorePageSeo {
  const seo = page?.seo;
  if (!seo) return base;
  return {
    ...base,
    title: seo.title?.trim() || base.title,
    description: seo.description?.trim() || base.description,
    image: seo.image_url?.trim() || base.image,
  };
}
