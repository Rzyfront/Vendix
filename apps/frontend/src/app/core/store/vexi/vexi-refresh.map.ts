import { ActionCreator } from '@ngrx/store';
import { loadExpenses } from '../../../private/modules/store/expenses/state/actions/expenses.actions';
import { loadCoupons } from '../../../private/modules/store/marketing/coupons/state/actions/coupon.actions';
import { loadUsers } from '../../../private/modules/store/settings/users/state/actions/store-users.actions';
import { loadInvoices } from '../../../private/modules/store/invoicing/state/actions/invoicing.actions';
import { loadEntries } from '../../../private/modules/store/accounting/state/actions/accounting.actions';
import { loadEmployees } from '../../../private/modules/store/payroll/state/actions/payroll.actions';
import { loadLayaways } from '../../../private/modules/store/layaway/state/actions/layaway.actions';

/**
 * One reload path: which action to dispatch, and where it only makes sense.
 */
export interface VexiRefreshTarget {
  action: ActionCreator<string, () => { type: string }>;
  /**
   * Route fragment the module lives under.
   *
   * Checked before dispatching, and that check is the whole reason this is an object
   * instead of a bare action. These are lazily-loaded feature stores: dispatching
   * `loadExpenses` while the person is standing in the POS is a silent no-op — the
   * effect that would answer it was never registered — and reporting "la pantalla ya
   * muestra el cambio" over a no-op is exactly the class of false claim about the
   * business that the whole write protocol exists to prevent.
   */
  routeFragment: string;
}

/**
 * Data domain → the NgRx action that reloads it on screen.
 *
 * A write the user cannot see did not happen, as far as they are concerned, so
 * every confirmed write asks the browser to refresh the module it touched.
 * The refresh goes through the domain's **own action**, never a direct service
 * call and never a route reload: the effect is the single owner of refresh
 * (`vendix-frontend-state`, enforced by `scripts/state-refresh-audit.sh`), and
 * reloading the route would throw away filters, pagination and half-filled
 * forms.
 *
 * The table is explicit and static on purpose. Dispatching by name at runtime
 * would turn a missing domain into a silent no-op; here a gap is a gap you can
 * see, and `ui_refresh` falls through to the host's own `refresh()` and then to an
 * honest "actualiza la vista" instead of claiming the screen is up to date.
 *
 * ── Qué cubre y qué no ───────────────────────────────────────────────────
 * Only modules that actually own NgRx state are listed. Products, inventory,
 * customers, orders and dispatch load through their services directly, so there is
 * no action to dispatch for them — those refresh through the second rung of the
 * cascade, `VexiUiHost.refresh()`, which the component implements itself. Adding an
 * entry here is all it takes once one of them moves to NgRx; the dispatcher needs no
 * change.
 *
 * The keys are the domain names the agent is told to pass in `ui_refresh`, so a new
 * entry has to use a name the model would plausibly produce — the tool description in
 * `ui.tools.ts` lists them.
 */
export const VEXI_REFRESH_ACTIONS: Record<string, VexiRefreshTarget> = {
  expenses: { action: loadExpenses, routeFragment: '/admin/expenses' },
  coupons: { action: loadCoupons, routeFragment: '/admin/marketing/coupons' },
  users: { action: loadUsers, routeFragment: '/admin/settings/users' },
  invoicing: { action: loadInvoices, routeFragment: '/admin/invoicing' },
  accounting: { action: loadEntries, routeFragment: '/admin/accounting' },
  payroll: { action: loadEmployees, routeFragment: '/admin/payroll' },
  layaway: { action: loadLayaways, routeFragment: '/admin/orders/layaway' },
};
