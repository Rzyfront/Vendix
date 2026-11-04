import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CurrentPlan, PlanOffer } from './access-gate.service';
import { PLAN_CATALOG_ROUTE, PlanLock } from './menu-filter.service';
import { planModuleFamily } from '../../shared/constants/plan-modules';

/** `details` of the backend `403 PLAN_MODULE_NOT_INCLUDED`. */
export interface PlanModuleDenialDetails {
  module?: string;
  current_plan?: CurrentPlan | null;
  required_plans?: PlanOffer[];
  upgrade_url?: string;
}

/**
 * Module paywall (odd/tasks/planes-matriz-accesos.md §3).
 *
 * One paywall per module family and session: the first refusal opens it, the
 * next ones only get a short notice (`show` returns `false`). Opened by the
 * route guard (`panelUiGuard`) and by the HTTP interceptor on
 * `PLAN_MODULE_NOT_INCLUDED`; both feed the same `PlanLock` shape, built from
 * the backend state, so the copy never comes from a local list.
 */
@Injectable({ providedIn: 'root' })
export class PlanPaywallService {
  private readonly router = inject(Router);
  private readonly shown = new Set<string>();

  readonly lock = signal<PlanLock | null>(null);
  readonly isOpen = computed(() => this.lock() !== null);

  /** Opens the paywall unless this module family already had it this session. */
  show(lock: PlanLock): boolean {
    const id = lock.family?.id ?? lock.key;
    if (this.shown.has(id)) return false;
    this.shown.add(id);
    this.lock.set(lock);
    return true;
  }

  /** Same as `show`, from the 403 payload of the API. */
  showFromApi(details: PlanModuleDenialDetails | null | undefined): boolean {
    const key = details?.module;
    if (!key) return false;
    const offers = Array.isArray(details?.required_plans)
      ? details.required_plans
      : [];
    const currentPlan = details?.current_plan ?? null;
    const recommended =
      offers.find((offer) => offer.cycle === currentPlan?.cycle) ??
      offers[0] ??
      null;
    return this.show({
      key,
      family: planModuleFamily(key),
      currentPlan,
      offers,
      recommended,
      upgradeUrl:
        details?.upgrade_url && details.upgrade_url.startsWith(PLAN_CATALOG_ROUTE)
          ? details.upgrade_url
          : `${PLAN_CATALOG_ROUTE}?from=${encodeURIComponent(key)}`,
    });
  }

  /** Short copy for a repeated refusal: "X no está incluido … Disponible en …". */
  notice(lock: PlanLock): string {
    const name = lock.family?.name ?? 'Este módulo';
    const plans = [...new Set(lock.offers.map((offer) => offer.name))];
    return plans.length
      ? `${name} no está incluido en tu plan. Disponible en ${plans.join(' · ')}.`
      : `${name} no está incluido en tu plan.`;
  }

  close(): void {
    this.lock.set(null);
  }

  goToPlans(): void {
    const target = this.lock()?.upgradeUrl ?? PLAN_CATALOG_ROUTE;
    this.close();
    this.router.navigateByUrl(target);
  }
}
