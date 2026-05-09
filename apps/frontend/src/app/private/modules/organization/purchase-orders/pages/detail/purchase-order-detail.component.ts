import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  BadgeComponent,
  ButtonComponent,
  ToastService,
  DialogService,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgPurchaseOrdersService,
  OrgPurchaseOrderRow,
} from '../../services/org-purchase-orders.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Detalle de OC con acciones approve/cancel.
 *
 * NOTE: Backend org-purchase-orders.controller does NOT expose a PUT/edit
 * endpoint — only approve / cancel / receive. Edition is intentionally not
 * supported in this view.
 */
@Component({
  selector: 'vendix-org-purchase-order-detail',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    BadgeComponent,
    ButtonComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2 flex items-center gap-2">
        <a routerLink="/admin/purchase-orders" class="text-sm text-text-secondary hover:underline">
          ← Volver
        </a>
        <h1 class="text-lg md:text-2xl font-semibold text-text-primary ml-2">
          @if (po(); as p) {
            OC {{ p.po_number || ('#' + p.id) }}
          } @else {
            Detalle
          }
        </h1>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="Error">
          {{ msg }}
        </app-alert-banner>
      }

      @if (loading()) {
        <div class="p-8"><app-spinner [center]="true" text="Cargando..." /></div>
      } @else if (po(); as p) {
        <app-card>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <p class="text-text-secondary">Estado</p>
              <app-badge [variant]="statusVariant(p.status)" size="md">{{ p.status || '—' }}</app-badge>
            </div>
            <div>
              <p class="text-text-secondary">Fecha</p>
              <p>{{ p.created_at | date: 'medium' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Proveedor</p>
              <p>{{ p.supplier_name || '—' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Tienda</p>
              <p>{{ p.store_name || '—' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Ubicación</p>
              <p>{{ p.location_name || '—' }}</p>
            </div>
            <div>
              <p class="text-text-secondary">Total</p>
              <p class="font-semibold">{{ asNumber(p.total) | currency }}</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
            @if (canApprove()) {
              <app-button
                variant="primary"
                size="sm"
                [loading]="actionLoading()"
                (click)="approve()"
              >Aprobar</app-button>
            }
            @if (canCancel()) {
              <app-button
                variant="danger"
                size="sm"
                [loading]="actionLoading()"
                (click)="cancel()"
              >Cancelar</app-button>
            }
            @if (canReceive()) {
              <app-button
                variant="primary"
                size="sm"
                [loading]="actionLoading()"
                (click)="receive()"
              >Recibir todo</app-button>
            }
          </div>
        </app-card>

        @if (asAny(p).lines && asAny(p).lines.length > 0) {
          <app-card [padding]="false" customClasses="mt-3">
            <div class="px-3 py-2 border-b border-border bg-background-soft">
              <h2 class="text-sm md:text-base font-semibold">Líneas</h2>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs md:text-sm">
                <thead class="bg-background-soft border-b border-border">
                  <tr class="text-left text-text-secondary">
                    <th class="px-3 py-2 font-medium">Producto</th>
                    <th class="px-3 py-2 font-medium text-right">Cantidad</th>
                    <th class="px-3 py-2 font-medium text-right">Costo unit.</th>
                    <th class="px-3 py-2 font-medium text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of asAny(p).lines; track $index) {
                    <tr class="border-b border-border/40">
                      <td class="px-3 py-2">{{ line.product_name || ('#' + line.product_id) }}</td>
                      <td class="px-3 py-2 text-right">{{ line.quantity }}</td>
                      <td class="px-3 py-2 text-right">{{ asNumber(line.unit_cost) | currency }}</td>
                      <td class="px-3 py-2 text-right">
                        {{ (asNumber(line.quantity) * asNumber(line.unit_cost)) | currency }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        }
      }
    </div>
  `,
})
export class OrgPurchaseOrderDetailComponent {
  private readonly service = inject(OrgPurchaseOrdersService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly loading = signal(true);
  readonly actionLoading = signal(false);
  readonly po = signal<(OrgPurchaseOrderRow & { lines?: any[] }) | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly canApprove = computed(() => {
    const s = (this.po()?.status || '').toLowerCase();
    return s === 'draft' || s === 'pending';
  });
  readonly canCancel = computed(() => {
    const s = (this.po()?.status || '').toLowerCase();
    return ['draft', 'pending', 'approved'].includes(s);
  });
  readonly canReceive = computed(() => {
    const s = (this.po()?.status || '').toLowerCase();
    return s === 'approved' || s === 'sent' || s === 'in_transit';
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.errorMessage.set('Identificador inválido.');
      this.loading.set(false);
      return;
    }
    this.fetch(id);
  }

  fetch(id: number): void {
    this.loading.set(true);
    this.service
      .findOne(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.po.set(res?.data ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgPurchaseOrderDetail] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la orden.'),
          );
          this.loading.set(false);
        },
      });
  }

  async approve(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Aprobar orden',
      message: '¿Confirmas que quieres aprobar esta orden de compra?',
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service.approve(p.id).subscribe({
      next: () => {
        this.toast.success('Orden aprobada');
        this.actionLoading.set(false);
        this.fetch(p.id);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(this.errors.humanize(err, 'No se pudo aprobar la orden.'));
      },
    });
  }

  async cancel(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Cancelar orden',
      message: '¿Confirmas la cancelación? Esta acción no se puede deshacer.',
      confirmText: 'Cancelar OC',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service.cancel(p.id).subscribe({
      next: () => {
        this.toast.success('Orden cancelada');
        this.actionLoading.set(false);
        this.fetch(p.id);
      },
      error: (err) => {
        this.actionLoading.set(false);
        this.toast.error(this.errors.humanize(err, 'No se pudo cancelar la orden.'));
      },
    });
  }

  async receive(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const lines = (p as any).lines as Array<{ id: number; quantity: number }> | undefined;
    if (!lines || lines.length === 0) {
      this.toast.error('La orden no tiene líneas para recibir.');
      return;
    }
    const ok = await this.dialog.confirm({
      title: 'Recibir orden completa',
      message: '¿Confirmas la recepción de todas las líneas con su cantidad pedida?',
      confirmText: 'Recibir',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service
      .receive(p.id, {
        items: lines.map((l) => ({ line_id: l.id, received_quantity: Number(l.quantity) || 0 })),
      })
      .subscribe({
        next: () => {
          this.toast.success('Orden recibida');
          this.actionLoading.set(false);
          this.fetch(p.id);
        },
        error: (err) => {
          this.actionLoading.set(false);
          this.toast.error(this.errors.humanize(err, 'No se pudo recibir la orden.'));
        },
      });
  }

  asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  asAny(v: any): any {
    return v;
  }

  statusVariant(s?: string): 'success' | 'error' | 'info' | 'warning' | 'neutral' {
    switch ((s || '').toLowerCase()) {
      case 'received':
      case 'completed':
      case 'approved':
        return 'success';
      case 'pending':
      case 'draft':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'in_transit':
      case 'sent':
        return 'info';
      default:
        return 'neutral';
    }
  }
}
