import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
  BadgeComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-active-subscription-detail',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full max-w-5xl mx-auto p-2 md:p-4 space-y-4">
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm"
          (click)="router.navigate(['/super-admin/subscriptions/active'])"
        >
          <app-icon name="arrow-left" [size]="18"></app-icon>
          <span>Volver</span>
        </button>
        @if (subscription()?.id) {
          <app-button
            variant="primary"
            size="sm"
            (clicked)="goToEvents()"
          >
            <app-icon slot="icon" name="activity" [size]="16"></app-icon>
            Ver eventos
          </app-button>
        }
      </div>

      @if (loading()) {
        <div class="text-center py-12 text-text-secondary">Cargando...</div>
      } @else if (subscription(); as sub) {
        <app-card>
          <h1 class="text-lg md:text-xl font-semibold text-text-primary mb-4">
            Suscripción #{{ sub.id }}
          </h1>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-text-secondary text-xs mb-1">Tienda</div>
              <div class="font-medium">{{ sub.store?.name ?? '—' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Organización</div>
              <div class="font-medium">{{ sub.store?.organizations?.name ?? '—' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Plan</div>
              <div class="font-medium">{{ sub.plan?.name ?? '—' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Estado</div>
              <app-badge variant="primary" size="sm">{{ sub.state }}</app-badge>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Precio efectivo</div>
              <div class="font-medium">{{ sub.effective_price | currency }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Ciclo</div>
              <div class="font-medium">{{ sub.plan?.billing_cycle ?? 'monthly' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Inicio del periodo</div>
              <div class="font-medium">{{ sub.current_period_start | date }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Fin del periodo</div>
              <div class="font-medium">{{ sub.current_period_end | date }}</div>
            </div>
            @if (sub.partner_override) {
              <div class="md:col-span-2 p-3 bg-blue-50 rounded-lg">
                <div class="text-text-secondary text-xs mb-1">Partner</div>
                <div class="font-medium">
                  {{ sub.partner_override.custom_name ?? 'Override aplicado' }}
                  · {{ sub.partner_override.margin_pct }}% margen
                </div>
              </div>
            }
          </div>
        </app-card>

        @if (sub.invoices && sub.invoices.length > 0) {
          <app-card>
            <h2 class="text-base font-semibold text-text-primary mb-3">Últimas 5 facturas</h2>
            <div class="space-y-2">
              @for (inv of sub.invoices; track inv.id) {
                <div
                  class="flex items-center justify-between p-3 bg-background rounded-lg border border-border text-sm"
                >
                  <div>
                    <div class="font-medium">{{ inv.invoice_number }}</div>
                    <div class="text-text-secondary text-xs">
                      Vence {{ inv.due_at | date }}
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <app-badge variant="neutral" size="sm">{{ inv.state }}</app-badge>
                    <div class="font-medium">{{ inv.total | currency }}</div>
                  </div>
                </div>
              }
            </div>
          </app-card>
        }
      }
    </div>
  `,
})
export class ActiveSubscriptionDetailComponent {
  readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);

  readonly subscription = signal<any>(null);
  readonly loading = signal(true);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.load(id);
    } else {
      this.loading.set(false);
    }
  }

  load(id: string): void {
    this.loading.set(true);
    this.http
      .get<any>(`${environment.apiUrl}/superadmin/subscriptions/active/${id}`)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.subscription.set(res?.data ?? res);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  goToEvents(): void {
    const sub = this.subscription();
    if (!sub?.id) return;
    this.router.navigate(['/super-admin/subscriptions/events'], {
      queryParams: { subscriptionId: sub.id },
    });
  }
}
