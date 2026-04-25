import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CardComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { CheckoutPreview } from '../../interfaces/store-subscription.interface';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CardComponent, ButtonComponent, IconComponent, DatePipe, CurrencyPipe],
  template: `
    <div class="w-full max-w-2xl mx-auto space-y-6">
      <div class="flex items-center gap-3">
        <button (click)="goBack()" class="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <app-icon name="arrow-left" [size]="20"></app-icon>
        </button>
        <div>
          <h1 class="text-xl font-bold text-text-primary">Confirmar Cambio de Plan</h1>
          <p class="text-sm text-text-secondary">Revisa los detalles antes de confirmar</p>
        </div>
      </div>

      @if (loadingPreview()) {
        <div class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Calculando prorrateo...</p>
        </div>
      }

      @if (!loadingPreview() && preview()) {
        <div class="space-y-4">
          <app-card>
            <div class="p-4 space-y-4">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Comparación</h3>
              <div class="grid grid-cols-2 gap-4">
                <div class="p-3 bg-gray-50 rounded-xl text-center">
                  <p class="text-xs text-text-secondary mb-1">Plan Actual</p>
                  <p class="text-lg font-bold text-text-primary">{{ preview()?.old_plan?.name || '-' }}</p>
                  <p class="text-sm text-text-secondary">{{ (preview()?.old_plan?.base_price || 0) | currency }}/mes</p>
                </div>
                <div class="p-3 bg-primary/10 rounded-xl text-center">
                  <p class="text-xs text-text-secondary mb-1">Nuevo Plan</p>
                  <p class="text-lg font-bold text-primary">{{ preview()?.new_plan?.name || '-' }}</p>
                  <p class="text-sm text-primary">{{ (preview()?.new_plan?.base_price || 0) | currency }}/mes</p>
                </div>
              </div>
            </div>
          </app-card>

          <app-card>
            <div class="p-4 space-y-3">
              <h3 class="text-sm font-semibold text-text-secondary uppercase tracking-wide">Prorrateo</h3>
              <div class="space-y-2">
                @if (preview()!.credit_amount > 0) {
                  <div class="flex justify-between">
                    <span class="text-sm text-text-secondary">Crédito por tiempo restante</span>
                    <span class="text-sm font-medium text-green-600">-{{ preview()!.credit_amount | currency }}</span>
                  </div>
                }
                @if (preview()!.charge_amount > 0) {
                  <div class="flex justify-between">
                    <span class="text-sm text-text-secondary">Cargo por nuevo plan</span>
                    <span class="text-sm font-medium">{{ preview()!.charge_amount | currency }}</span>
                  </div>
                }
                <div class="border-t border-border pt-2 flex justify-between">
                  <span class="text-sm font-semibold text-text-primary">Total a cobrar</span>
                  <span class="text-lg font-extrabold {{ (preview()!.charge_amount || 0) > 0 ? 'text-primary' : 'text-green-600' }}">
                    {{ (preview()!.charge_amount || 0) > 0 ? (preview()!.charge_amount | currency) : 'Sin cargo' }}
                  </span>
                </div>
              </div>
              <p class="text-xs text-text-secondary">
                Próxima facturación: {{ preview()?.next_billing_date | date:'mediumDate' }} — {{ (preview()?.next_billing_amount || 0) | currency }}
              </p>
            </div>
          </app-card>

          <div class="flex gap-3 justify-end">
            <app-button variant="ghost" (clicked)="goBack()">Cancelar</app-button>
            <app-button variant="primary" [loading]="committing()" (clicked)="confirmCheckout()">
              <app-icon name="check" [size]="16" slot="icon"></app-icon>
              Confirmar Cambio
            </app-button>
          </div>
        </div>
      }

      @if (!loadingPreview() && !preview()) {
        <div class="p-8 text-center space-y-4">
          <app-icon name="alert-circle" [size]="48" class="text-text-secondary"></app-icon>
          <p class="text-text-secondary">No se pudo obtener la vista previa del cambio</p>
          <app-button variant="outline" (clicked)="goBack()">Volver</app-button>
        </div>
      }
    </div>
  `,
})
export class CheckoutComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private facade = inject(SubscriptionFacade);
  private subscriptionService = inject(StoreSubscriptionService);
  private toastService = inject(ToastService);

  readonly preview = signal<CheckoutPreview | null>(null);
  readonly loadingPreview = signal(false);
  readonly committing = signal(false);

  ngOnInit(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) {
      this.router.navigate(['/admin/subscription/plans']);
      return;
    }
    this.loadPreview(planId);
  }

  private loadPreview(planId: string): void {
    this.loadingPreview.set(true);
    this.subscriptionService.checkoutPreview(planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success && res.data) this.preview.set(res.data);
          this.loadingPreview.set(false);
        },
        error: () => {
          this.loadingPreview.set(false);
          this.toastService.error('Error al obtener vista previa');
        },
      });
  }

  confirmCheckout(): void {
    const planId = this.route.snapshot.paramMap.get('planId');
    if (!planId) return;

    this.committing.set(true);
    this.subscriptionService.checkoutCommit(planId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.facade.loadCurrent();
          this.toastService.success('Plan cambiado exitosamente');
          this.committing.set(false);
          this.router.navigate(['/admin/subscription']);
        },
        error: () => {
          this.committing.set(false);
          this.toastService.error('Error al confirmar el cambio');
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/admin/subscription/plans']);
  }
}
