import { AppPageDocument, AppPageTemplate, AppPageVariant, PageAppKind, clonePage } from './app-page.types';
import { BOOKING_COZY } from './booking-cozy.template';
import { BOOKING_MINIMAL } from './booking-minimal.template';
import { BOOKING_TEMPLATE } from './booking.template';
import { PRODUCT_PAGE_BOUTIQUE } from './product-page-boutique.template';
import { PRODUCT_PAGE_CLINICAL } from './product-page-clinical.template';
import { PRODUCT_PAGE_TEMPLATE } from './product-page.template';
import { SERVICE_PAGE_BEAUTY } from './service-page-beauty.template';
import { SERVICE_PAGE_PROFESSIONAL } from './service-page-professional.template';
import { SERVICE_PAGE_TEMPLATE } from './service-page.template';
import { STORE_HOME_COMPACT } from './store-home-compact.template';
import { STORE_HOME_EDITORIAL } from './store-home-editorial.template';
import { STORE_HOME_TEMPLATE } from './store-home.template';

export * from './app-page.types';

/** One template per app; each lives in its own file and can be replaced alone. */
export const APP_PAGE_TEMPLATES: Record<PageAppKind, AppPageTemplate> = {
  product_page: PRODUCT_PAGE_TEMPLATE,
  service_page: SERVICE_PAGE_TEMPLATE,
  booking: BOOKING_TEMPLATE,
  store_home: STORE_HOME_TEMPLATE,
};

function baseVariant(template: AppPageTemplate): AppPageVariant {
  return {
    id: 'base',
    name: 'Base',
    description: 'La base sugerida para esta app, con el aspecto de siempre.',
    page: template.page,
  };
}

/**
 * Apps F3 — the ready-made pages of each app: the base first, then its two
 * variants (each in its own `*.template.ts` file). Same block catalog and
 * contract for all of them; only order, emphasis and `theme` change.
 */
export const APP_PAGE_VARIANTS: Record<PageAppKind, readonly AppPageVariant[]> = {
  product_page: [baseVariant(PRODUCT_PAGE_TEMPLATE), PRODUCT_PAGE_BOUTIQUE, PRODUCT_PAGE_CLINICAL],
  service_page: [baseVariant(SERVICE_PAGE_TEMPLATE), SERVICE_PAGE_BEAUTY, SERVICE_PAGE_PROFESSIONAL],
  booking: [baseVariant(BOOKING_TEMPLATE), BOOKING_MINIMAL, BOOKING_COZY],
  store_home: [baseVariant(STORE_HOME_TEMPLATE), STORE_HOME_EDITORIAL, STORE_HOME_COMPACT],
};

/**
 * The page after choosing `variant`: its hero, sections and style replace
 * the current ones; the mode of operation, sales, booking, brand and SEO of
 * `current` are kept (a template never changes what the page does).
 */
export function applyVariant(current: AppPageDocument, variant: AppPageVariant): AppPageDocument {
  const chosen = clonePage(variant.page);
  const next: AppPageDocument = { ...clonePage(current), blocks: chosen.blocks };
  delete next.hero;
  delete next.theme;
  if (chosen.hero) next.hero = chosen.hero;
  if (chosen.theme) next.theme = chosen.theme;
  return next;
}
