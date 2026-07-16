import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TableContextService } from '../../private/modules/ecommerce/services/table-context.service';

/**
 * MesaCartGuard — second line of defense for the `/cart` and `/checkout`
 * routes inside the public `store-ecommerce` app.
 *
 * When a comensal is in mesa mode (i.e. they scanned a physical QR and
 * `TableContextService.tableToken()` is set), the standard ecommerce
 * shopping cart and checkout flow must NOT be reachable. Dine-in orders
 * accumulate into the shared table bill via
 * `POST /ecommerce/tables/{token}/order`, not the standalone cart.
 *
 * If the user lands on `/cart` or `/checkout` while a mesa is active, we
 * redirect them to the carta (`/cartas`) where the comensal flow lives.
 *
 * NOTE: this guard is intentionally silent — no toast — because the
 * legitimate path inside a mesa is the carta itself, not an error state.
 * The "Salir de la mesa" affordance is provided separately by the mesa
 * banner (D6) in the storefront layout.
 */
export const mesaCartGuard: CanActivateFn = () => {
  const tableContext = inject(TableContextService);
  const router = inject(Router);

  // Anti-race: on a cold deep-link to `/cart` or `/checkout` (e.g. `?mesa=`
  // active) this guard runs BEFORE the storefront layout's `ngOnInit`, which
  // is where `hydrate()` normally reads the persisted mesa token from
  // localStorage. Without hydrating here, `isActive()` would still be false
  // and the standard cart/checkout would leak through. `hydrate()` is
  // SSR-safe (it self-guards with `isPlatformBrowser` internally) and
  // idempotent, so calling it here is a no-op when already hydrated.
  tableContext.hydrate();

  if (tableContext.isActive()) {
    return router.createUrlTree(['/cartas']);
  }

  return true;
};