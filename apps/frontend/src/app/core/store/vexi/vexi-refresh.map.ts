import { ActionCreator } from '@ngrx/store';

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
 * see, and `ui_refresh` answers `no_refresh_available` so Vexi tells the user
 * to refresh instead of claiming the screen is up to date.
 *
 * ── Estado actual ────────────────────────────────────────────────────────
 * The table is empty, and that is a finding rather than an omission: none of
 * the five domains Vexi can write to (`products`, `inventory`, `customers`,
 * `orders`, `dispatch`) has module-level NgRx state today. Those screens load
 * through their services directly, so there is no action to dispatch and no
 * effect to own the reload. NgRx in `store/` covers analytics, invoicing,
 * reports, accounting, expenses, layaway, payroll and settings/users — none of
 * which Vexi mutates.
 *
 * Until a domain gets one, `ui_refresh` degrades exactly as designed: Vexi
 * says "actualiza la vista para verlo". Adding an entry here is all it takes
 * once, say, the products list moves to NgRx — the dispatcher needs no change.
 */
export const VEXI_REFRESH_ACTIONS: Record<
  string,
  ActionCreator<string, () => { type: string }>
> = {};
