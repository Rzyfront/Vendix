import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
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
