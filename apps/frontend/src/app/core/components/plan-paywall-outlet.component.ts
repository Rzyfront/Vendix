import { Component, computed, inject } from '@angular/core';
import { ModalComponent } from '../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../shared/components/button/button.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PlanPaywallService } from '../services/plan-paywall.service';
import { PlanOffer } from '../services/access-gate.service';

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'mes',
  quarterly: 'trimestre',
  semiannual: 'semestre',
  annual: 'año',
  yearly: 'año',
};

/**
 * Module paywall host (odd/tasks/planes-matriz-accesos.md §3): module name, one
 * value line, current plan, the plans that include it with their price and a
 * single primary action «Ver planes y mejorar». Mounted once per private layout,
 * next to `<app-fiscal-gate-outlet />`.
 */
@Component({
  selector: 'app-plan-paywall-outlet',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onIsOpenChange($event)"
      [title]="title()"
      size="sm"
    >
      @if (lock(); as current) {
        <div class="flex flex-col gap-4" data-testid="plan-paywall">
          <div class="flex items-start gap-3">
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <app-icon name="lock" [size]="18" />
            </span>
            <p class="text-sm text-text-secondary">
              {{ current.family?.value ?? 'Este módulo no está incluido en tu plan actual.' }}
            </p>
          </div>

          <div class="rounded-lg border border-border px-3 py-2 text-sm">
            <span class="text-text-secondary">Tu plan actual:</span>
            <span class="font-medium text-text-primary">
              {{ current.currentPlan?.name ?? 'Sin plan activo' }}
            </span>
          </div>

          @if (offers().length) {
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Disponible en
              </span>
              <ul class="flex flex-col gap-2">
                @for (offer of offers(); track offer.code) {
                  <li
                    class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    [class.border-primary]="offer.code === current.recommended?.code"
                    [class.border-border]="offer.code !== current.recommended?.code"
                  >
                    <span class="font-medium text-text-primary">{{ offer.name }}</span>
                    <span class="text-text-secondary">{{ priceLabel(offer) }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        </div>
      }

      <div slot="footer" class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" (clicked)="close()">Seguir con mi plan</app-button>
        <app-button variant="primary" (clicked)="goToPlans()">Ver planes y mejorar</app-button>
      </div>
    </app-modal>
  `,
})
export class PlanPaywallOutletComponent {
  private readonly paywall = inject(PlanPaywallService);

  readonly lock = this.paywall.lock;
  readonly isOpen = this.paywall.isOpen;
  readonly title = computed(() => {
    const name = this.lock()?.family?.name;
    return name ? `${name} no está en tu plan` : 'Módulo no incluido en tu plan';
  });
  /** One row per plan name: monthly/annual variants of a line collapse to the recommended or cheapest. */
  readonly offers = computed<PlanOffer[]>(() => {
    const current = this.lock();
    if (!current) return [];
    const byName = new Map<string, PlanOffer>();
    for (const offer of current.offers) {
      const kept = byName.get(offer.name);
      const preferRecommended = offer.code === current.recommended?.code;
      if (!kept || preferRecommended) byName.set(offer.name, offer);
    }
    return [...byName.values()];
  });

  priceLabel(offer: PlanOffer): string {
    const amount = Number(offer.price);
    if (!Number.isFinite(amount)) return '';
    let formatted: string;
    try {
      formatted = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: offer.currency || 'COP',
        maximumFractionDigits: 0,
      }).format(amount);
    } catch {
      formatted = `$${Math.round(amount).toLocaleString('es-CO')}`;
    }
    const cycle = CYCLE_LABEL[offer.cycle] ?? offer.cycle;
    return cycle ? `${formatted} / ${cycle}` : formatted;
  }

  close(): void {
    this.paywall.close();
  }

  goToPlans(): void {
    this.paywall.goToPlans();
  }

  onIsOpenChange(open: boolean): void {
    if (!open) this.paywall.close();
  }
}
