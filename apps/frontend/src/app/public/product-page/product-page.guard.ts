import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import {
  effectiveMode,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { ProductPageService } from './product-page.service';

/**
 * Root of a STORE_PRODUCT_PAGE domain: sends the visitor to the featured
 * product. The target is `/products/:slug` because that is the canonical path
 * the ecommerce product detail publishes, so the canonical, the sitemap and
 * the address bar all agree. Without a published page the root renders the
 * "not available" view instead.
 */
export const productPageRootGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ProductPageService)
    .load()
    .pipe(
      map((config) =>
        config ? router.createUrlTree(['/products', config.product.slug]) : true,
      ),
    );
};

/**
 * `/cart` and `/checkout` exist only when the page sells (apps-f2 S4). A page
 * the owner set to a non-selling mode sends the visitor back to the featured
 * product. With no saved page nothing changes.
 */
export const productPageSalesGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ProductPageService)
    .load()
    .pipe(
      map((config) => {
        if (!config?.page || modeSells(effectiveMode('product_page', config.page))) return true;
        return router.createUrlTree(['/products', config.product.slug]);
      }),
    );
};
