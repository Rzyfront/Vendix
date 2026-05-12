import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';

import {
  AlertBannerComponent,
  CardComponent,
  IconComponent,
  SpinnerComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  StickyHeaderComponent,
  ToastService,
  DialogService,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgPurchaseOrderRow,
  OrgPurchaseOrdersService,
} from '../../services/org-purchase-orders.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  approved: 'Aprobada',
  in_transit: 'En tránsito',
  sent: 'Enviada',
  received: 'Recibida',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_COLORS: Record<string, StickyHeaderBadgeColor> = {
  draft: 'gray',
  pending: 'yellow',
  approved: 'blue',
  in_transit: 'blue',
  sent: 'blue',
  received: 'green',
  completed: 'green',
  cancelled: 'red',
};

/**
 * ORG_ADMIN — Detalle de OC con acciones approve / cancel / receive.
 *
 * Backend org-purchase-orders.controller no expone PUT/edit; la edición no
 * está soportada intencionalmente. Las acciones disponibles dependen del
 * estado actual de la orden.
 */
@Component({
  selector: 'vendix-org-purchase-order-detail',
  standalone: true,
  imports: [
    RouterModule,
    DatePipe,
    AlertBannerComponent,
    CardComponent,
    IconComponent,
    SpinnerComponent,
    StickyHeaderComponent,
  ],
  providers: [CurrencyPipe],
  template: `
    <div class="w-full">
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="shopping-bag"
        [showBackButton]="true"
        [backRoute]="'/admin/purchase-orders'"
        [badgeText]="statusLabel()"
        [badgeColor]="badgeColor()"
        [badgePulse]="badgePulse()"
        [actions]="headerActions()"
        (actionClicked)="onAction($event)"
      />

      <div class="px-2 md:px-4 pb-4">
        @if (errorMessage(); as msg) {
          <app-alert-banner variant="danger" title="Error" customClasses="mb-3">
            {{ msg }}
          </app-alert-banner>
        }

        @if (loading()) {
          <div class="p-8">
            <app-spinner [center]="true" text="Cargando..." />
          </div>
        } @else if (po(); as p) {
          <!-- Resumen header -->
          <app-card customClasses="mb-3">
            <div
              class="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 text-sm"
            >
              <div>
                <p class="text-xs text-text-secondary">Fecha</p>
                <p class="font-medium text-text-primary">
                  {{ p.created_at ? (p.created_at | date: 'medium') : '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Fecha esperada</p>
                <p class="font-medium text-text-primary">
                  {{ p.expected_date ? (p.expected_date | date: 'shortDate') : '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Moneda</p>
                <p class="font-medium text-text-primary">
                  {{ p.currency_code || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-text-secondary">Total</p>
                <p class="text-lg font-bold text-primary">
                  {{ formatMoney(p.total) }}
                </p>
              </div>
            </div>
          </app-card>

          <!-- Proveedor + ubicación -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <app-card>
              <div class="flex items-start gap-3">
                <div
                  class="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                >
                  <app-icon name="truck" [size]="20" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-xs text-text-secondary">Proveedor</p>
                  <p
                    class="text-base font-semibold text-text-primary truncate"
                  >
                    {{ p.supplier_name || '—' }}
                  </p>
                </div>
              </div>
            </app-card>

            <app-card>
              <div class="flex items-start gap-3">
                <div
                  class="shrink-0 w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center"
                >
                  <app-icon name="map-pin" [size]="20" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-xs text-text-secondary">Recibir en</p>
                  <p
                    class="text-base font-semibold text-text-primary truncate"
                  >
                    {{ p.location_name || '—' }}
                  </p>
                  @if (p.store_name) {
                    <p class="text-xs text-text-tertiary truncate">
                      Tienda: {{ p.store_name }}
                    </p>
                  }
                </div>
              </div>
            </app-card>
          </div>

          <!-- Líneas -->
          @if (poLines().length > 0) {
            <app-card [padding]="false">
              <div
                class="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between"
              >
                <h2 class="text-sm md:text-base font-semibold text-text-primary">
                  Líneas ({{ poLines().length }})
                </h2>
                <span
                  class="text-sm font-bold text-primary"
                >
                  {{ formatMoney(p.total) }}
                </span>
              </div>

              <!-- Desktop -->
              <div class="hidden md:block overflow-x-auto">
                <table class="w-full text-sm">
                  <thead
                    class="bg-surface-secondary border-b border-border"
                  >
                    <tr class="text-left text-text-secondary">
                      <th class="px-4 py-2 font-medium">Producto</th>
                      <th class="px-4 py-2 font-medium text-right">Cantidad</th>
                      <th class="px-4 py-2 font-medium text-right">
                        Costo unit.
                      </th>
                      <th class="px-4 py-2 font-medium text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of poLines(); track $index) {
                      <tr
                        class="border-b border-border/40 hover:bg-surface-secondary/40"
                      >
                        <td class="px-4 py-3">
                          <p class="font-medium text-text-primary">
                            {{ line.product_name || '#' + line.product_id }}
                          </p>
                          @if (line.variant_name) {
                            <p class="text-xs text-text-secondary">
                              {{ line.variant_name }}
                            </p>
                          }
                          @if (line.sku) {
                            <p class="text-xs text-text-tertiary">
                              SKU: {{ line.sku }}
                            </p>
                          }
                        </td>
                        <td class="px-4 py-3 text-right text-text-primary">
                          {{ line.quantity }}
                        </td>
                        <td class="px-4 py-3 text-right text-text-secondary">
                          {{ formatMoney(line.unit_cost) }}
                        </td>
                        <td
                          class="px-4 py-3 text-right font-semibold text-text-primary"
                        >
                          {{ formatMoney(asNumber(line.quantity) * asNumber(line.unit_cost)) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <!-- Mobile -->
              <div class="md:hidden divide-y divide-border">
                @for (line of poLines(); track $index) {
                  <div class="p-3">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <p
                          class="text-sm font-medium text-text-primary truncate"
                        >
                          {{ line.product_name || '#' + line.product_id }}
                        </p>
                        @if (line.variant_name) {
                          <p class="text-xs text-text-secondary truncate">
                            {{ line.variant_name }}
                          </p>
                        }
                        @if (line.sku) {
                          <p class="text-xs text-text-tertiary truncate">
                            SKU: {{ line.sku }}
                          </p>
                        }
                      </div>
                      <div class="text-right shrink-0">
                        <p
                          class="text-sm font-semibold text-text-primary"
                        >
                          {{ formatMoney(asNumber(line.quantity) * asNumber(line.unit_cost)) }}
                        </p>
                        <p class="text-xs text-text-secondary">
                          {{ line.quantity }} × {{ formatMoney(line.unit_cost) }}
                        </p>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </app-card>
          } @else {
            <app-card>
              <p class="text-sm text-text-secondary text-center py-4">
                Esta orden no tiene líneas registradas.
              </p>
            </app-card>
          }
        }
      </div>
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
  private readonly currencyPipe = inject(CurrencyPipe);

  readonly loading = signal(true);
  readonly actionLoading = signal(false);
  readonly po = signal<(OrgPurchaseOrderRow & { lines?: any[] }) | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly statusLabel = computed(() => {
    const key = (this.po()?.status || '').toLowerCase();
    return STATUS_LABELS[key] ?? this.po()?.status ?? '—';
  });

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() => {
    const key = (this.po()?.status || '').toLowerCase();
    return STATUS_BADGE_COLORS[key] ?? 'gray';
  });

  readonly badgePulse = computed(() => {
    const key = (this.po()?.status || '').toLowerCase();
    return key === 'pending' || key === 'in_transit' || key === 'sent';
  });

  readonly headerTitle = computed(() => {
    const p = this.po();
    if (!p) return 'Detalle';
    return `OC ${p.po_number || '#' + p.id}`;
  });

  readonly headerSubtitle = computed(() => {
    const p = this.po();
    if (!p) return '';
    const parts = [
      p.supplier_name ? `Proveedor: ${p.supplier_name}` : null,
      p.store_name ? `Tienda: ${p.store_name}` : null,
    ].filter(Boolean);
    return parts.join(' · ');
  });

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

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const acts: StickyHeaderActionButton[] = [];
    const loading = this.actionLoading();
    if (this.canApprove()) {
      acts.push({
        id: 'approve',
        label: 'Aprobar',
        variant: 'primary',
        icon: 'check-circle',
        loading,
        disabled: loading,
        visible: true,
      });
    }
    if (this.canReceive()) {
      acts.push({
        id: 'receive',
        label: 'Recibir todo',
        variant: 'primary',
        icon: 'package-check',
        loading,
        disabled: loading,
        visible: true,
      });
    }
    if (this.canCancel()) {
      acts.push({
        id: 'cancel',
        label: 'Cancelar OC',
        variant: 'outline-danger',
        icon: 'x-circle',
        loading,
        disabled: loading,
        visible: true,
      });
    }
    return acts;
  });

  readonly poLines = computed<any[]>(() => {
    const p = this.po() as any;
    return Array.isArray(p?.lines) ? p.lines : [];
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

  onAction(id: string): void {
    if (id === 'approve') void this.approve();
    else if (id === 'cancel') void this.cancel();
    else if (id === 'receive') void this.receive();
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
    this.service
      .approve(p.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Orden aprobada');
          this.actionLoading.set(false);
          this.fetch(p.id);
        },
        error: (err) => {
          this.actionLoading.set(false);
          this.toast.error(
            this.errors.humanize(err, 'No se pudo aprobar la orden.'),
          );
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
    this.service
      .cancel(p.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Orden cancelada');
          this.actionLoading.set(false);
          this.fetch(p.id);
        },
        error: (err) => {
          this.actionLoading.set(false);
          this.toast.error(
            this.errors.humanize(err, 'No se pudo cancelar la orden.'),
          );
        },
      });
  }

  async receive(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const lines = this.poLines() as Array<{ id: number; quantity: number }>;
    if (lines.length === 0) {
      this.toast.error('La orden no tiene líneas para recibir.');
      return;
    }
    const ok = await this.dialog.confirm({
      title: 'Recibir orden completa',
      message:
        '¿Confirmas la recepción de todas las líneas con su cantidad pedida?',
      confirmText: 'Recibir',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service
      .receive(p.id, {
        items: lines.map((l) => ({
          id: l.id,
          quantity_received: this.asNumber(l.quantity),
        })),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Orden recibida');
          this.actionLoading.set(false);
          this.fetch(p.id);
        },
        error: (err) => {
          this.actionLoading.set(false);
          this.toast.error(
            this.errors.humanize(err, 'No se pudo recibir la orden.'),
          );
        },
      });
  }

  asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  formatMoney(value: number | string | undefined | null): string {
    const num = this.asNumber(value);
    if (!Number.isFinite(num)) return '—';
    return this.currencyPipe.transform(num) ?? `${num}`;
  }
}
