import { AppPageTemplate, PageAppKind } from './app-page.types';
import { BOOKING_TEMPLATE } from './booking.template';
import { PRODUCT_PAGE_TEMPLATE } from './product-page.template';
import { SERVICE_PAGE_TEMPLATE } from './service-page.template';
import { STORE_HOME_TEMPLATE } from './store-home.template';

export * from './app-page.types';

/** One template per app; each lives in its own file and can be replaced alone. */
export const APP_PAGE_TEMPLATES: Record<PageAppKind, AppPageTemplate> = {
  product_page: PRODUCT_PAGE_TEMPLATE,
  service_page: SERVICE_PAGE_TEMPLATE,
  booking: BOOKING_TEMPLATE,
  store_home: STORE_HOME_TEMPLATE,
};
