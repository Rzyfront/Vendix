import { Injectable, signal } from '@angular/core';

/**
 * QUI-967 — extra entry rule of the store "Panel Principal" (`/admin/dashboard`).
 *
 * Besides the dashboard roles/permissions (`canUserAccessDashboard`), a user
 * may enter when the store's Panel Principal has a panel visible to them. That
 * rule lives in the store dashboard feature (`HomePanelService`), which
 * registers it here when it is created, so `core` (sidebar, guard) can consult
 * it without importing the feature. Unregistered → `false` (previous rule).
 */
@Injectable({ providedIn: 'root' })
export class DashboardAccessExtension {
  private readonly check = signal<(() => boolean) | null>(null);

  register(check: () => boolean): void {
    this.check.set(check);
  }

  /** True when the registered rule lets the user enter the Panel Principal. */
  canEnter(): boolean {
    const check = this.check();
    return check ? check() : false;
  }
}
