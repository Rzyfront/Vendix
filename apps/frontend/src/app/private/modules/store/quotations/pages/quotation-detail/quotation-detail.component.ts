import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationPrintService } from '../../services/quotation-print.service';
import { Quotation, QuotationStatus } from '../../interfaces/quotation.interface';
import {
  StickyHeaderComponent,
  IconComponent,
  SpinnerComponent,
  TimelineComponent,
  DialogService,
  ToastService,
  CardComponent,
  ButtonComponent,
} from '../../../../../../shared/components';
import type {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  TimelineStep,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes';

const STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Expirada',
  converted: 'Convertida',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_COLORS: Record<QuotationStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  sent: 'blue',
  accepted: 'green',
  rejected: 'red',
  expired: 'yellow',
  converted: 'green',
  cancelled: 'gray',
};

@Component({
  selector: 'app-quotation-detail',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    StickyHeaderComponent,
    IconComponent,
    SpinnerComponent,
    TimelineComponent,
    CardComponent,
    ButtonComponent,
    CurrencyPipe,
  ],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-20">
        <app-spinner size="lg"></app-spinner>
      </div>
    } @else if (quotation()) {
      <app-sticky-header
        [title]="quotation()!.quotation_number"
        subtitle="Detalle de cotización"
        icon="file-text"
        [showBackButton]="true"
        backRoute="/admin/orders/quotations"
        [badgeText]="statusLabel()"
        [badgeColor]="statusBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)">
      </app-sticky-header>

      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-5">

          <!-- LEFT COLUMN -->
          <div class="flex flex-col gap-3">

            <!-- Customer Info -->
            <app-card title="Cliente" shadow="sm" [responsivePadding]="true">
              @if (quotation()!.customer) {
                <div class="flex items-start gap-3 sm:gap-4">
                  <div class="w-10 h-10 sm:w-14 sm:h-14 bg-primary/10 text-primary rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-xl font-bold border border-primary/5 flex-shrink-0">
                    {{ quotation()!.customer!.first_name.charAt(0) || 'C' }}
                  </div>
                  <div class="space-y-0.5 sm:space-y-1 min-w-0">
                    <p class="text-base sm:text-lg font-bold text-gray-900 truncate">
                      {{ quotation()!.customer!.first_name }} {{ quotation()!.customer!.last_name }}
                    </p>
                    <div class="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600">
                      <app-icon name="mail" size="14" class="text-gray-400 flex-shrink-0 sm:[--icon-size:16px]"></app-icon>
                      <span class="truncate">{{ quotation()!.customer!.email || 'Sin correo registrado' }}</span>
                    </div>
                    <div class="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-600">
                      <app-icon name="phone" size="14" class="text-gray-400 flex-shrink-0 sm:[--icon-size:16px]"></app-icon>
                      <span class="truncate">{{ quotation()!.customer!.phone || 'Sin teléfono registrado' }}</span>
                    </div>
                  </div>
                </div>
              } @else {
                <div class="flex items-center gap-3 text-gray-400">
                  <div class="w-10 h-10 sm:w-14 sm:h-14 bg-gray-100 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0">
                    <app-icon name="user" size="20" class="text-gray-300"></app-icon>
                  </div>
                  <p class="text-sm text-text-secondary">Sin cliente asignado</p>
                </div>
              }
            </app-card>

            <!-- Items -->
            <app-card shadow="sm" [responsivePadding]="true">
              <div slot="header" class="flex items-center justify-between w-full">
                <h3 class="text-base sm:text-lg font-semibold text-[var(--color-text-primary)]">Items</h3>
                <span class="text-[11px] sm:text-xs font-medium text-gray-500 bg-[var(--color-background)] px-2.5 py-1 rounded-lg">
                  {{ quotation()!.quotation_items.length }} productos
                </span>
              </div>

              <div class="space-y-2">
                @for (item of quotation()!.quotation_items; track item.id) {
                  <div class="p-3 sm:p-4 bg-[var(--color-surface)] rounded-xl border border-border hover:border-gray-300 transition-colors">
                    <div class="flex items-center gap-3 sm:gap-4">
                      <!-- Product Image -->
                      <div class="w-11 h-11 sm:w-14 sm:h-14 bg-white rounded-lg flex-shrink-0 flex items-center justify-center border border-border overflow-hidden">
                        @if (item.product?.image_url) {
                          <img [src]="item.product.image_url" class="w-full h-full object-cover" />
                        } @else {
                          <app-icon name="image" size="20" class="text-gray-300 sm:[--icon-size:24px]"></app-icon>
                        }
                      </div>
                      <!-- Product Info -->
                      <div class="flex-1 min-w-0">
                        <h3 class="text-sm sm:text-base font-semibold text-gray-900 truncate">{{ item.product_name }}</h3>
                        <p class="text-[11px] font-mono text-gray-400 mt-0.5">SKU: {{ item.variant_sku || 'N/A' }}</p>
                      </div>
                      <!-- Price -->
                      <div class="text-right flex-shrink-0">
                        <p class="font-bold text-gray-900 text-sm sm:text-lg">{{ item.total_price || 0 | currency }}</p>
                        <p class="text-xs text-gray-500">{{ item.quantity }} x {{ item.unit_price || 0 | currency }}</p>
                      </div>
                    </div>
                  </div>
                }
              </div>
            </app-card>

            <!-- Converted Order -->
            @if (quotation()!.converted_order) {
              <app-card shadow="sm" [responsivePadding]="true">
                <div class="rounded-xl p-3 sm:p-4" style="background: var(--color-accent-light); border: 1px solid rgba(var(--color-primary-rgb), 0.2);">
                  <h3 class="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style="color: var(--color-secondary);">
                    <app-icon name="check-circle" size="14" style="color: var(--color-primary);"></app-icon>
                    Orden Generada
                  </h3>
                  <dl class="space-y-2 text-sm">
                    <div class="flex justify-between items-center">
                      <dt class="text-[var(--color-text-secondary)]">Número</dt>
                      <dd>
                        <a
                          [routerLink]="['/admin/orders', quotation()!.converted_order!.id]"
                          class="hover:underline font-medium"
                          style="color: var(--color-primary);"
                          aria-label="Ver orden {{ quotation()!.converted_order!.order_number }}">
                          {{ quotation()!.converted_order!.order_number }}
                          <app-icon name="arrow-right" [size]="14" class="inline-block ml-1"></app-icon>
                        </a>
                      </dd>
                    </div>
                    <div class="flex justify-between">
                      <dt class="text-[var(--color-text-secondary)]">Estado</dt>
                      <dd class="font-medium">{{ quotation()!.converted_order!.state }}</dd>
                    </div>
                    <div class="flex justify-between">
                      <dt class="text-[var(--color-text-secondary)]">Total</dt>
                      <dd class="font-bold font-mono">{{ quotation()!.converted_order!.grand_total || 0 | currency }}</dd>
                    </div>
                  </dl>
                </div>
              </app-card>
            }

            <!-- Notes -->
            @if (quotation()!.notes) {
              <app-card title="Notas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.notes }}</p>
              </app-card>
            }

            @if (quotation()!.internal_notes) {
              <app-card title="Notas Internas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.internal_notes }}</p>
              </app-card>
            }

            @if (quotation()!.terms_and_conditions) {
              <app-card title="Términos y Condiciones" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ quotation()!.terms_and_conditions }}</p>
              </app-card>
            }

            <!-- Timeline / History -->
            <app-card title="Línea de Tiempo" shadow="sm" [responsivePadding]="true">
              <app-timeline class="block pt-1" [steps]="timelineSteps()" [collapsible]="true"></app-timeline>
            </app-card>

          </div>

          <!-- RIGHT COLUMN (SIDEBAR) -->
          <div class="flex flex-col gap-3 lg:pt-0 pt-1">

            <!-- Quotation Progress -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">
                Progreso de Cotización
              </h2>
              <app-timeline [steps]="timelineSteps()" [collapsible]="true"
                expand_label="Ver progreso completo" collapse_label="Ocultar progreso" />
            </app-card>

            <!-- General Info -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Información General</h2>
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Canal</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.channel }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Válida hasta</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.valid_until ? (quotation()!.valid_until | date:'dd/MM/yyyy') : 'Sin fecha' }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Creada</dt>
                  <dd class="font-semibold text-gray-900">{{ quotation()!.created_at | date:'dd/MM/yyyy HH:mm' }}</dd>
                </div>
                @if (quotation()!.created_by_user) {
                  <div class="flex justify-between items-center">
                    <dt class="text-text-secondary">Creada por</dt>
                    <dd class="font-semibold text-gray-900">{{ quotation()!.created_by_user!.first_name }} {{ quotation()!.created_by_user!.last_name }}</dd>
                  </div>
                }
              </dl>
            </app-card>

            <!-- Actions -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Acciones</h2>
              @if (visibleActions().length > 0) {
                <div class="space-y-2">
                  @for (action of visibleActions(); track action.id) {
                    <app-button
                      [variant]="action.variant"
                      [fullWidth]="true"
                      [disabled]="actionLoading() !== null"
                      [loading]="actionLoading() === action.id"
                      (clicked)="onHeaderAction(action.id)"
                    >
                      @if (action.icon) {
                        <app-icon slot="icon" [name]="action.icon" size="16"></app-icon>
                      }
                      {{ action.label }}
                    </app-button>
                  }
                </div>
              } @else {
                <div class="text-[10px] text-center text-text-secondary font-bold uppercase tracking-widest bg-[var(--color-surface)] py-3 rounded-xl border border-dashed border-border">
                  No hay acciones disponibles
                </div>
              }
            </app-card>

            <!-- Payment Summary -->
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Resumen</h2>
              <div class="space-y-2.5">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Subtotal</span>
                  <span class="font-semibold text-gray-900">{{ quotation()!.subtotal_amount || 0 | currency }}</span>
                </div>
                @if (quotation()!.discount_amount > 0) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Descuento</span>
                    <span class="font-semibold text-green-600">-{{ quotation()!.discount_amount || 0 | currency }}</span>
                  </div>
                }
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Impuestos</span>
                  <span class="font-semibold text-gray-900">{{ quotation()!.tax_amount || 0 | currency }}</span>
                </div>
                @if (quotation()!.shipping_cost > 0) {
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-text-secondary">Envío</span>
                    <span class="font-semibold text-gray-900">{{ quotation()!.shipping_cost || 0 | currency }}</span>
                  </div>
                }
                <div class="pt-3 mt-1 border-t border-border flex justify-between items-center">
                  <span class="text-base font-bold text-gray-900">Total</span>
                  <span class="text-xl sm:text-2xl font-black text-primary-600 font-mono tracking-tighter">
                    {{ quotation()!.grand_total || 0 | currency }}
                  </span>
                </div>
              </div>
              <!-- Print button -->
              <div class="pt-4 space-y-2">
                <app-button variant="secondary" [fullWidth]="true" (clicked)="printQuotation()" customClasses="!bg-gray-900 hover:!bg-black !shadow-md">
                  <app-icon slot="icon" name="printer" size="16"></app-icon>
                  Imprimir Cotización
                </app-button>
              </div>
            </app-card>

          </div>
        </div>
      </div>
    }
  `,
  styles: [],
})
export class QuotationDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly quotationsService = inject(QuotationsService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly printService = inject(QuotationPrintService);

  readonly quotation = signal<Quotation | null>(null);
  readonly loading = signal(true);
  readonly actionLoading = signal<string | null>(null);

  readonly statusLabel = computed(() => {
    const q = this.quotation();
    return q ? STATUS_LABELS[q.status] || q.status : '';
  });

  readonly statusBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const q = this.quotation();
    return q ? STATUS_BADGE_COLORS[q.status] || 'gray' : 'gray';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const q = this.quotation();
    if (!q) return [];
    const currentAction = this.actionLoading();
    return [
      {
        id: 'send',
        label: 'Enviar',
        variant: 'primary' as const,
        icon: 'send',
        visible: q.status === 'draft',
        loading: currentAction === 'send',
        disabled: currentAction !== null,
      },
      {
        id: 'accept',
        label: 'Aceptar',
        variant: 'primary' as const,
        icon: 'check-circle',
        visible: q.status === 'sent',
        loading: currentAction === 'accept',
        disabled: currentAction !== null,
      },
      {
        id: 'reject',
        label: 'Rechazar',
        variant: 'danger' as const,
        icon: 'x-circle',
        visible: q.status === 'sent',
        loading: currentAction === 'reject',
        disabled: currentAction !== null,
      },
      {
        id: 'convert',
        label: 'Convertir a Orden',
        variant: 'primary' as const,
        icon: 'shopping-cart',
        visible: ['draft', 'sent', 'accepted'].includes(q.status),
        loading: currentAction === 'convert',
        disabled: currentAction !== null,
      },
      {
        id: 'duplicate',
        label: 'Duplicar',
        variant: 'outline' as const,
        icon: 'copy',
        visible: true,
        loading: currentAction === 'duplicate',
        disabled: currentAction !== null,
      },
      {
        id: 'cancel',
        label: 'Cancelar',
        variant: 'outline-danger' as const,
        icon: 'x-circle',
        visible: ['draft', 'sent', 'accepted'].includes(q.status),
        loading: currentAction === 'cancel',
        disabled: currentAction !== null,
      },
    ];
  });

  readonly visibleActions = computed(() => {
    return this.headerActions().filter(a => a.visible);
  });

  readonly timelineSteps = computed<TimelineStep[]>(() => {
    const q = this.quotation();
    if (!q) return [];

    const steps: TimelineStep[] = [
      {
        key: 'created',
        label: 'Creada',
        status: 'completed',
        variant: 'default',
        date: q.created_at,
        description: q.created_by_user
          ? `Por ${q.created_by_user.first_name} ${q.created_by_user.last_name}`
          : undefined,
      },
    ];

    if (q.sent_at) {
      steps.push({
        key: 'sent',
        label: 'Enviada',
        status: 'completed',
        variant: 'default',
        date: q.sent_at,
      });
    } else if (q.status === 'draft') {
      steps.push({
        key: 'sent',
        label: 'Envío pendiente',
        status: 'upcoming',
        variant: 'default',
      });
    }

    if (q.accepted_at) {
      steps.push({
        key: 'accepted',
        label: 'Aceptada',
        status: 'completed',
        variant: 'success',
        date: q.accepted_at,
      });
    } else if (q.rejected_at) {
      steps.push({
        key: 'rejected',
        label: 'Rechazada',
        status: 'terminal',
        variant: 'danger',
        date: q.rejected_at,
      });
    } else if (q.status === 'sent') {
      steps.push({
        key: 'response',
        label: 'Esperando respuesta',
        status: 'current',
        variant: 'default',
      });
    }

    if (q.converted_at) {
      steps.push({
        key: 'converted',
        label: 'Convertida a orden',
        status: 'completed',
        variant: 'success',
        date: q.converted_at,
        description: q.converted_order ? `Orden ${q.converted_order.order_number}` : undefined,
      });
    } else if (q.status === 'accepted') {
      steps.push({
        key: 'convert',
        label: 'Pendiente de conversión',
        status: 'upcoming',
        variant: 'default',
      });
    }

    if (q.status === 'cancelled') {
      steps.push({
        key: 'cancelled',
        label: 'Cancelada',
        status: 'terminal',
        variant: 'danger',
      });
    }

    if (q.status === 'expired') {
      steps.push({
        key: 'expired',
        label: 'Expirada',
        status: 'terminal',
        variant: 'warning',
      });
    }

    return steps;
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadQuotation(id);
    }
  }

  printQuotation(): void {
    const q = this.quotation();
    if (q) {
      this.printService.printQuotation(q);
    }
  }

  onHeaderAction(actionId: string): void {
    switch (actionId) {
      case 'send':
        this.onSend();
        break;
      case 'accept':
        this.onAccept();
        break;
      case 'reject':
        this.onReject();
        break;
      case 'convert':
        this.onConvert();
        break;
      case 'cancel':
        this.onCancel();
        break;
      case 'duplicate':
        this.onDuplicate();
        break;
    }
  }

  private loadQuotation(id: number): void {
    this.loading.set(true);
    this.quotationsService
      .getQuotationById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (q) => {
          this.quotation.set(q);
          this.loading.set(false);
        },
        error: (err) => {
          this.toastService.error(err.message || 'Error al cargar la cotización');
          this.loading.set(false);
        },
      });
  }

  private onSend(): void {
    this.performAction('send', () =>
      this.quotationsService.sendQuotation(this.quotation()!.id),
    );
  }

  private onAccept(): void {
    this.performAction('accept', () =>
      this.quotationsService.acceptQuotation(this.quotation()!.id),
    );
  }

  private async onReject(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Rechazar cotización',
      message: '¿Estás seguro de que deseas rechazar esta cotización? Esta acción no se puede deshacer.',
      confirmText: 'Rechazar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.performAction('reject', () =>
      this.quotationsService.rejectQuotation(this.quotation()!.id),
    );
  }

  private async onCancel(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar cotización',
      message: '¿Estás seguro de que deseas cancelar esta cotización? Esta acción no se puede deshacer.',
      confirmText: 'Cancelar cotización',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    this.performAction('cancel', () =>
      this.quotationsService.cancelQuotation(this.quotation()!.id),
    );
  }

  private async onConvert(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Convertir a orden',
      message: '¿Deseas convertir esta cotización directamente en una orden de venta? La cotización quedará marcada como convertida.',
      confirmText: 'Convertir',
      cancelText: 'Cancelar',
      confirmVariant: 'primary',
    });
    if (!confirmed) return;
    this.performAction('convert', () =>
      this.quotationsService.convertToOrder(this.quotation()!.id),
    );
  }

  private onDuplicate(): void {
    this.actionLoading.set('duplicate');
    this.quotationsService
      .duplicateQuotation(this.quotation()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (dup) => {
          this.actionLoading.set(null);
          this.toastService.success('Cotización duplicada exitosamente');
          this.router.navigate(['/admin/orders/quotations', dup.id]);
        },
        error: (err) => {
          this.actionLoading.set(null);
          this.toastService.error(err.message || 'Error al duplicar la cotización');
        },
      });
  }

  private performAction(actionId: string, action: () => Observable<Quotation>): void {
    this.actionLoading.set(actionId);
    action()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: Quotation) => {
          if (result && (result as any).success === false) {
            this.actionLoading.set(null);
            this.toastService.error((result as any).message || 'Error al realizar la acción');
            return;
          }
          this.quotation.set(result);
          this.actionLoading.set(null);
          this.quotationsService.invalidateCache();
          this.toastService.success(`Cotización ${STATUS_LABELS[result.status as QuotationStatus]?.toLowerCase() || 'actualizada'} exitosamente`);
        },
        error: (err: any) => {
          this.actionLoading.set(null);
          this.toastService.error(err.message || 'Error al realizar la acción');
        },
      });
  }
}
