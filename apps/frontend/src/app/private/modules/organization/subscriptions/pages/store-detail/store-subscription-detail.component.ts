import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  IconComponent,
  ButtonComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { OrgSubscriptionsService } from '../../services/org-subscriptions.service';
import { StoreSubscription } from '../../interfaces/org-subscription.interface';

@Component({
  selector: 'app-store-subscription-detail',
  standalone: true,
  imports: [IconComponent, CardComponent, DatePipe, ButtonComponent],
  template: `
    <div class="w-full space-y-6">
      <div class="flex items-center gap-3">
        <button (click)="goBack()" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <div class="flex-1">
          <h1 class="text-xl font-bold text-text-primary">{{ subscription()?.store_name || 'Tienda' }}</h1>
          <p class="text-sm text-text-secondary">Detalle de suscripción</p>
        </div>
        <div class="flex gap-2">
          <app-button variant="ghost" size="sm" (clicked)="viewInvoices()">
            <app-icon name="file-text" [size]="16" slot="icon"></app-icon>
            Facturas
          </app-button>
          <app-button variant="ghost" size="sm" (clicked)="viewPaymentMethods()">
            <app-icon name="credit-card" [size]="16" slot="icon"></app-icon>
            Métodos
          </app-button>
          <app-button variant="primary" size="sm" (clicked)="openChangePlan()">
            <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
            Cambiar Plan
          </app-button>
        </div>
      </div>

      @if (loading()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && subscription()) {
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <app-card>
            <div class="p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Plan Actual</h3>
              <div class="flex items-center gap-3">
                <div class="p-3 bg-primary/10 rounded-xl">
                  <app-icon name="credit-card" [size]="24" class="text-primary"></app-icon>
                </div>
                <div>
                  <p class="text-lg font-bold text-text-primary">{{ subscription()?.plan_name }}</p>
                  <p class="text-2xl font-extrabold text-primary">{{ formatCurrency(subscription()?.effective_price || 0) }}<span class="text-sm font-normal text-text-secondary">/mes</span></p>
                </div>
              </div>
            </div>
          </app-card>

          <app-card>
            <div class="p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Estado</h3>
              <div class="flex items-center gap-3">
                <div class="p-3 {{ getStateColor() }} rounded-xl">
                  <app-icon name="{{ getStateIcon() }}" [size]="24"></app-icon>
                </div>
                <div>
                  <span class="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold {{ getStateBadgeClass() }}">
                    {{ getStateLabel() }}
                  </span>
                  @if (subscription()?.next_billing_at) {
                    <p class="text-xs text-text-secondary mt-1">Próximo cobro: {{ subscription()?.next_billing_at | date:'mediumDate' }}</p>
                  }
                </div>
              </div>
            </div>
          </app-card>

          <app-card>
            <div class="p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Período Actual</h3>
              <div class="space-y-2">
                <div class="flex justify-between">
                  <span class="text-sm text-text-secondary">Inicio</span>
                  <span class="text-sm font-medium">{{ subscription()?.current_period_start | date:'mediumDate' }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-sm text-text-secondary">Fin</span>
                  <span class="text-sm font-medium">{{ subscription()?.current_period_end | date:'mediumDate' }}</span>
                </div>
              </div>
            </div>
          </app-card>

          @if (subscription()?.trial_ends_at) {
            <app-card>
              <div class="p-4 space-y-3">
                <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Período de Prueba</h3>
                <div class="flex items-center gap-3">
                  <div class="p-3 bg-amber-100 rounded-xl">
                    <app-icon name="clock" [size]="24" class="text-amber-600"></app-icon>
                  </div>
                  <div>
                    <p class="text-sm font-medium">Termina el {{ subscription()?.trial_ends_at | date:'mediumDate' }}</p>
                    <p class="text-xs text-text-secondary">{{ getDaysRemaining() }} días restantes</p>
                  </div>
                </div>
              </div>
            </app-card>
          }

          @if (subscription()?.split_breakdown) {
            <app-card class="md:col-span-2">
              <div class="p-4 space-y-3">
                <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Rev-Share Partner</h3>
                <div class="grid grid-cols-3 gap-4">
                  <div class="p-3 bg-green-50 rounded-lg">
                    <p class="text-xs text-green-600 uppercase font-medium">Vendix</p>
                    <p class="text-lg font-bold text-green-700">{{ formatCurrency(getSplitBreakdown().vendix_share) }}</p>
                    <p class="text-xs text-green-600">Base price</p>
                  </div>
                  <div class="p-3 bg-amber-50 rounded-lg">
                    <p class="text-xs text-amber-600 uppercase font-medium">Partner</p>
                    <p class="text-lg font-bold text-amber-700">{{ formatCurrency(getSplitBreakdown().partner_share) }}</p>
                    <p class="text-xs text-amber-600">{{ getSplitBreakdown().margin_pct }}% margen</p>
                  </div>
                  <div class="p-3 bg-primary/5 rounded-lg">
                    <p class="text-xs text-primary uppercase font-medium">Total</p>
                    <p class="text-lg font-bold text-primary">{{ formatCurrency(subscription()?.effective_price || 0) }}</p>
                    <p class="text-xs text-primary">Precio efectivo</p>
                  </div>
                </div>
              </div>
            </app-card>
          }
        </div>
      }

      @if (!loading() && !subscription()) {
        <div class="p-8 text-center">
          <app-icon name="alert-circle" [size]="48" class="text-text-secondary"></app-icon>
          <p class="mt-2 text-text-secondary">No se encontró la suscripción</p>
        </div>
      }
    </div>
  `,
})
export class StoreSubscriptionDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private orgSubsService = inject(OrgSubscriptionsService);

  readonly subscription = signal<StoreSubscription | null>(null);
  readonly loading = signal(false);

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    const storeId = this.route.snapshot.paramMap.get('storeId');
    if (!storeId) return;

    this.loading.set(true);
    this.orgSubsService.getStoreSubscription(Number(storeId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.subscription.set(res.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  goBack(): void {
    this.router.navigate(['/admin/subscriptions']);
  }

  viewInvoices(): void {
    this.router.navigate(['/admin/subscriptions/invoices']);
  }

  viewPaymentMethods(): void {
    this.router.navigate(['/admin/subscriptions/payment-methods']);
  }

  openChangePlan(): void {
    this.router.navigate(['/admin/subscriptions'], { queryParams: { changePlan: true } });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  getSplitBreakdown(): { vendix_share: number; partner_share: number; margin_pct: string } {
    const sub = this.subscription();
    if (!sub?.split_breakdown) {
      return { vendix_share: 0, partner_share: 0, margin_pct: '0' };
    }
    return sub.split_breakdown as { vendix_share: number; partner_share: number; margin_pct: string };
  }

  getDaysRemaining(): number {
    const trialEnd = this.subscription()?.trial_ends_at;
    if (!trialEnd) return 0;
    const diff = new Date(trialEnd).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  getStateLabel(): string {
    const labels: Record<string, string> = {
      active: 'Activa',
      trialing: 'En Prueba',
      past_due: 'Vencida',
      cancelled: 'Cancelada',
      expired: 'Expirada',
      blocked: 'Bloqueada',
      grace_soft: 'En Gracia',
      grace_hard: 'Gracia Final',
      none: 'Sin Suscripción',
    };
    return labels[this.subscription()?.state || 'none'] || this.subscription()?.state || '-';
  }

  getStateBadgeClass(): string {
    const classes: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      trialing: 'bg-blue-100 text-blue-700',
      past_due: 'bg-red-100 text-red-700',
      cancelled: 'bg-gray-100 text-gray-700',
      expired: 'bg-gray-100 text-gray-700',
      blocked: 'bg-red-100 text-red-700',
      grace_soft: 'bg-yellow-100 text-yellow-700',
      grace_hard: 'bg-orange-100 text-orange-700',
      none: 'bg-gray-100 text-gray-700',
    };
    return classes[this.subscription()?.state || 'none'] || 'bg-gray-100 text-gray-700';
  }

  getStateColor(): string {
    const colors: Record<string, string> = {
      active: 'bg-green-100',
      trialing: 'bg-blue-100',
      past_due: 'bg-red-100',
      blocked: 'bg-red-100',
    };
    return colors[this.subscription()?.state || 'none'] || 'bg-gray-100';
  }

  getStateIcon(): string {
    const icons: Record<string, string> = {
      active: 'check-circle',
      trialing: 'clock',
      past_due: 'alert-triangle',
      blocked: 'shield-off',
      none: 'circle-off',
    };
    return icons[this.subscription()?.state || 'none'] || 'help-circle';
  }
}
