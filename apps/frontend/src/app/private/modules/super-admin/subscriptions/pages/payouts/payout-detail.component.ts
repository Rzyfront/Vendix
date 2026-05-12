import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../environments/environment';
import {
  CardComponent,
  IconComponent,
  ButtonComponent,
  BadgeComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

interface PayoutCommission {
  id: string | number;
  amount: number;
  state: string;
  invoice?: {
    invoice_number?: string;
    due_at?: string;
  } | null;
}

interface PayoutBatchDetail {
  id: string | number;
  state: string;
  total_amount: number;
  currency?: string;
  period_start: string;
  period_end: string;
  payout_method?: string | null;
  reference?: string | null;
  organization?: { name?: string } | null;
  partner_organization?: { name?: string } | null;
  commissions?: PayoutCommission[];
}

@Component({
  selector: 'app-payout-detail',
  standalone: true,
  imports: [
    RouterModule,
    DatePipe,
    CardComponent,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    CurrencyPipe,
  ],
  template: `
    <div class="w-full max-w-5xl mx-auto p-2 md:p-4 space-y-4">
      <button
        type="button"
        class="flex items-center gap-2 text-text-secondary hover:text-text-primary text-sm"
        (click)="router.navigate(['/super-admin/subscriptions/payouts'])"
      >
        <app-icon name="arrow-left" [size]="18"></app-icon>
        <span>Volver</span>
      </button>

      @if (loading()) {
        <div class="text-center py-12 text-text-secondary">Cargando...</div>
      } @else if (batch(); as b) {
        <app-card>
          <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
            <h1 class="text-lg md:text-xl font-semibold text-text-primary">
              Pago a partner #{{ b.id }}
            </h1>
            <div class="flex flex-wrap gap-2">
              @if (b.state === 'pending' || b.state === 'draft') {
                <app-button variant="success" size="sm" (clicked)="approve(b.id)">
                  <app-icon name="check" [size]="16" slot="icon"></app-icon>
                  Aprobar
                </app-button>
                <app-button variant="danger" size="sm" (clicked)="reject(b.id)">
                  <app-icon name="x" [size]="16" slot="icon"></app-icon>
                  Rechazar
                </app-button>
              }
              @if (b.state === 'approved' || b.state === 'sent') {
                <app-button variant="primary" size="sm" (clicked)="markAsPaid(b.id)">
                  <app-icon name="banknote" [size]="16" slot="icon"></app-icon>
                  Marcar pagado
                </app-button>
              }
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-text-secondary text-xs mb-1">Partner</div>
              <div class="font-medium text-text-primary">
                {{ b.organization?.name ?? b.partner_organization?.name ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Estado</div>
              <app-badge>{{ b.state }}</app-badge>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Periodo</div>
              <div class="font-medium text-text-primary">
                {{ b.period_start | date }} → {{ b.period_end | date }}
              </div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Monto total</div>
              <div class="font-medium text-text-primary">{{ b.total_amount | currency }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Método</div>
              <div class="font-medium text-text-primary">{{ b.payout_method ?? '—' }}</div>
            </div>
            <div>
              <div class="text-text-secondary text-xs mb-1">Referencia</div>
              <div class="font-medium text-text-primary">{{ b.reference ?? '—' }}</div>
            </div>
          </div>
        </app-card>

        @if ((b.commissions?.length ?? 0) > 0) {
          <app-card>
            <h2 class="text-base font-semibold text-text-primary mb-3">
              Comisiones ({{ b.commissions!.length }})
            </h2>
            <div class="space-y-2">
              @for (c of b.commissions; track c.id) {
                <div
                  class="flex items-center justify-between p-3 bg-background rounded-lg border border-border text-sm"
                >
                  <div>
                    <div class="font-medium text-text-primary">
                      Factura {{ c.invoice?.invoice_number ?? '—' }}
                    </div>
                    <div class="text-text-secondary text-xs">
                      {{ c.invoice?.due_at | date }}
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <app-badge>{{ c.state }}</app-badge>
                    <div class="font-medium text-text-primary">{{ c.amount | currency }}</div>
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
export class PayoutDetailComponent {
  readonly router = inject(Router);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  readonly batch = signal<PayoutBatchDetail | null>(null);
  readonly loading = signal(true);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
    else this.loading.set(false);
  }

  load(id: string): void {
    this.loading.set(true);
    this.http
      .get<{ success: boolean; data: PayoutBatchDetail } | PayoutBatchDetail>(
        `${environment.apiUrl}/superadmin/subscriptions/payouts/${id}`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.batch.set((res?.data ?? res) as PayoutBatchDetail);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  approve(id: string | number): void {
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/approve`, {
        status: 'approved',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.show({ variant: 'success', description: 'Pago aprobado' });
          this.load(String(id));
        },
        error: () => this.toast.show({ variant: 'error', description: 'Error al aprobar el pago' }),
      });
  }

  reject(id: string | number): void {
    const reason = window.prompt('Motivo del rechazo (mínimo 3 caracteres):');
    if (!reason || reason.trim().length < 3) {
      this.toast.show({ variant: 'error', description: 'Motivo requerido (mínimo 3 caracteres)' });
      return;
    }
    this.http
      .post(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/reject`, {
        reason: reason.trim(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.show({ variant: 'success', description: 'Pago rechazado' });
          this.load(String(id));
        },
        error: () => this.toast.show({ variant: 'error', description: 'Error al rechazar el pago' }),
      });
  }

  markAsPaid(id: string | number): void {
    this.http
      .patch(`${environment.apiUrl}/superadmin/subscriptions/payouts/${id}/pay`, {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.show({ variant: 'success', description: 'Pago marcado como pagado' });
          this.load(String(id));
        },
        error: () =>
          this.toast.show({ variant: 'error', description: 'Error al marcar como pagado' }),
      });
  }
}
