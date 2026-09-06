import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { ContractsService, ContractApiError } from '../../services/contracts.service';
import {
  Contract,
  ContractStatus,
  CONTRACT_STATUS_LABELS,
  CONTRACT_TRANSITIONS,
  CONTRACT_STATUS_ERROR_CODE,
} from '../../interfaces/contract.interface';
import {
  StickyHeaderComponent,
  IconComponent,
  SpinnerComponent,
  TimelineComponent,
  ToastService,
  CardComponent,
  ButtonComponent,
  AlertBannerComponent,
} from '../../../../../../shared/components';
import type {
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  TimelineStep,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes';

const STATUS_BADGE_COLORS: Record<ContractStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  active: 'green',
  invoiced: 'blue',
  cancelled: 'gray',
};

/** Accionabilidad por transicion: que hace cada boton antes de pulsarlo. */
const TRANSITION_META: Record<ContractStatus, { label: string; icon: string; hint: string }> = {
  draft: { label: 'Volver a borrador', icon: 'rotate-ccw', hint: '' },
  active: { label: 'Activar contrato', icon: 'check-circle', hint: 'El contrato entra en vigencia y queda listo para facturar AIU.' },
  invoiced: { label: 'Marcar facturado', icon: 'file-text', hint: 'Cierra el contrato como facturado.' },
  cancelled: { label: 'Cancelar contrato', icon: 'x-circle', hint: 'La cotización origen conserva su trazabilidad.' },
};

@Component({
  selector: 'app-contract-detail',
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
    AlertBannerComponent,
    CurrencyPipe,
  ],
  template: `
    @if (loading()) {
      <div class="flex items-center justify-center py-20">
        <app-spinner size="lg"></app-spinner>
      </div>
    } @else if (loadError()) {
      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4">
        <app-alert-banner variant="danger" heading="No se pudo cargar el contrato">
          {{ loadError() }}
          <div bannerActions class="mt-2 flex gap-2">
            <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
            <app-button variant="ghost" size="sm" (clicked)="goToList()">Volver al listado</app-button>
          </div>
        </app-alert-banner>
      </div>
    } @else if (contract()) {
      <app-sticky-header
        [title]="contract()!.contract_number"
        subtitle="Ficha de contrato de obra"
        icon="file-text"
        [showBackButton]="true"
        backRoute="/admin/orders/contracts"
        [badgeText]="statusLabel()"
        [badgeColor]="statusBadgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onTransition($event)">
      </app-sticky-header>

      <div class="max-w-[1600px] mx-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        @if (transitionError()) {
          <app-alert-banner variant="danger" heading="No se pudo cambiar el estado">
            {{ transitionError() }}
            <div bannerActions class="mt-2">
              <app-button variant="outline" size="sm" (clicked)="clearTransitionError()">Entendido</app-button>
            </div>
          </app-alert-banner>
        }

        <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-5">
          <div class="flex flex-col gap-3">
            <app-card title="Objeto del contrato" shadow="sm" [responsivePadding]="true">
              @if (contract()!.contract_object) {
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ contract()!.contract_object }}</p>
              } @else {
                <p class="text-sm text-text-secondary">Sin objeto registrado.</p>
              }
            </app-card>

            <app-card title="Administración, Imprevistos y Utilidad (AIU)" shadow="sm" [responsivePadding]="true">
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Administración (A)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.administration_percentage) }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Imprevistos (I)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.contingency_percentage) }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Utilidad (U)</dt>
                  <dd class="font-semibold text-gray-900">{{ formatPct(contract()!.profit_percentage) }}</dd>
                </div>
              </dl>
              <p class="mt-3 text-xs text-text-secondary">
                Snapshot congelado al crear el contrato: la factura AIU precargada (D.1) reproduce estos valores.
              </p>
            </app-card>

            <app-card title="Documentos" shadow="sm" [responsivePadding]="true">
              <dl class="space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Cotización origen</dt>
                  <dd>
                    @if (contract()!.quotation) {
                      <a
                        [routerLink]="['/admin/orders/quotations', contract()!.quotation!.id]"
                        class="hover:underline font-medium"
                        style="color: var(--color-primary);"
                        [attr.aria-label]="'Ver cotización ' + contract()!.quotation!.quotation_number"
                      >
                        {{ contract()!.quotation!.quotation_number }}
                        <app-icon name="arrow-right" [size]="14" class="inline-block ml-1"></app-icon>
                      </a>
                    } @else {
                      <span class="font-medium">Cotización #{{ contract()!.quotation_id }}</span>
                    }
                  </dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Factura AIU</dt>
                  <dd>
                    @if (contract()!.invoice) {
                      <span class="font-medium">{{ contract()!.invoice!.invoice_number || ('Factura #' + contract()!.invoice!.id) }}</span>
                    } @else if (contract()!.status === 'active') {
                      <span class="text-text-secondary">Pendiente: se genera desde el contrato vigente.</span>
                    } @else {
                      <span class="text-text-secondary">Sin factura.</span>
                    }
                  </dd>
                </div>
              </dl>
            </app-card>

            @if (contract()!.notes) {
              <app-card title="Notas" shadow="sm" [responsivePadding]="true">
                <p class="text-sm whitespace-pre-wrap text-gray-700">{{ contract()!.notes }}</p>
              </app-card>
            }

            <app-card title="Línea de Tiempo" shadow="sm" [responsivePadding]="true">
              <app-timeline class="block pt-1" [steps]="timelineSteps()" [collapsible]="true"></app-timeline>
            </app-card>
          </div>

          <div class="flex flex-col gap-3 lg:pt-0 pt-1">
            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Estado y transiciones</h2>
              @if (validTransitions().length > 0) {
                <div class="space-y-2">
                  @for (target of validTransitions(); track target) {
                    <app-button
                      [variant]="target === 'cancelled' ? 'outline-danger' : 'primary'"
                      [fullWidth]="true"
                      [disabled]="transitionLoading() !== null"
                      [loading]="transitionLoading() === target"
                      (clicked)="onTransition(target)"
                    >
                      <app-icon slot="icon" [name]="transitionMeta(target).icon" size="16"></app-icon>
                      {{ transitionMeta(target).label }}
                    </app-button>
                  }
                </div>
                @if (transitionHint()) {
                  <p class="mt-3 text-xs text-text-secondary">{{ transitionHint() }}</p>
                }
              } @else {
                <div class="text-[10px] text-center text-text-secondary font-bold uppercase tracking-widest bg-[var(--color-surface)] py-3 rounded-xl border border-dashed border-border">
                  Estado terminal: sin transiciones disponibles
                </div>
              }
            </app-card>

            <app-card shadow="sm" [responsivePadding]="true">
              <h2 class="text-xs sm:text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 sm:mb-4">Resumen</h2>
              <div class="space-y-2.5">
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Subtotal</span>
                  <span class="font-semibold text-gray-900">{{ contract()!.subtotal_amount || 0 | currency }}</span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-text-secondary">Impuestos</span>
                  <span class="font-semibold text-gray-900">{{ contract()!.tax_amount || 0 | currency }}</span>
                </div>
                <div class="pt-3 mt-1 border-t border-border flex justify-between items-center">
                  <span class="text-base font-bold text-gray-900">Total</span>
                  <span class="text-xl sm:text-2xl font-black text-primary-600 font-mono tracking-tighter">
                    {{ contract()!.grand_total || 0 | currency }}
                  </span>
                </div>
              </div>
              <dl class="mt-4 pt-4 border-t border-border space-y-2.5 text-sm">
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Creado</dt>
                  <dd class="font-semibold text-gray-900">{{ contract()!.created_at | date:'dd/MM/yyyy HH:mm' }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-text-secondary">Actualizado</dt>
                  <dd class="font-semibold text-gray-900">{{ contract()!.updated_at | date:'dd/MM/yyyy HH:mm' }}</dd>
                </div>
              </dl>
            </app-card>
          </div>
        </div>
      </div>
    }
  `,
  styles: [],
})
export class ContractDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly contractsService = inject(ContractsService);
  private readonly toastService = inject(ToastService);

  readonly contract = signal<Contract | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly transitionLoading = signal<ContractStatus | null>(null);
  readonly transitionError = signal<string | null>(null);

  readonly statusLabel = computed(() => {
    const c = this.contract();
    return c ? CONTRACT_STATUS_LABELS[c.status] || c.status : '';
  });

  readonly statusBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    const c = this.contract();
    return c ? STATUS_BADGE_COLORS[c.status] || 'gray' : 'gray';
  });

  /** C.2: solo las transiciones validas para el estado actual se habilitan. */
  readonly validTransitions = computed<ContractStatus[]>(() => {
    const c = this.contract();
    return c ? [...(CONTRACT_TRANSITIONS[c.status] ?? [])] : [];
  });

  readonly transitionHint = computed(() => {
    const c = this.contract();
    if (!c || this.validTransitions().length === 0) return '';
    if (c.status === 'draft') return 'Al activar, el contrato entra en vigencia y queda listo para facturar AIU.';
    if (c.status === 'active') return 'Facturar cierra el contrato; cancelar lo anula conservando la trazabilidad.';
    return '';
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const current = this.transitionLoading();
    return this.validTransitions().map((target) => ({
      id: target,
      label: TRANSITION_META[target].label,
      variant: (target === 'cancelled' ? 'outline-danger' : 'primary') as StickyHeaderActionButton['variant'],
      icon: TRANSITION_META[target].icon,
      visible: true,
      loading: current === target,
      disabled: current !== null,
    }));
  });

  readonly timelineSteps = computed<TimelineStep[]>(() => {
    const c = this.contract();
    if (!c) return [];
    const steps: TimelineStep[] = [
      {
        key: 'created',
        label: 'Creado',
        status: 'completed',
        variant: 'default',
        date: c.created_at,
        description: `Desde cotización #${c.quotation_id}`,
      },
    ];
    const order: ContractStatus[] = ['draft', 'active', 'invoiced'];
    const labels: Record<string, string> = {
      draft: 'Borrador',
      active: 'Vigente',
      invoiced: 'Facturado',
    };
    for (const s of order) {
      if (s === 'draft') continue;
      const reached = order.indexOf(c.status) >= order.indexOf(s);
      if (c.status === 'cancelled') continue;
      steps.push({
        key: s,
        label: reached ? labels[s] : `${labels[s]} pendiente`,
        status: reached ? 'completed' : 'upcoming',
        variant: 'default',
        date: reached && s === c.status ? c.updated_at : undefined,
      });
    }
    if (c.status === 'cancelled') {
      steps.push({
        key: 'cancelled',
        label: 'Cancelado',
        status: 'completed',
        variant: 'default',
        date: c.updated_at,
      });
    }
    return steps;
  });

  constructor() {
    this.reload();
  }

  transitionMeta(target: ContractStatus): { label: string; icon: string } {
    return TRANSITION_META[target];
  }

  formatPct(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value}%`;
  }

  clearTransitionError(): void {
    this.transitionError.set(null);
  }

  goToList(): void {
    void this.router.navigate(['/admin/orders/contracts']);
  }

  reload(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.loading.set(false);
      this.loadError.set('Contrato no válido (sin identificador).');
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.contractsService
      .getContractById(id)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (c) => this.contract.set(c),
        error: (err: ContractApiError | Error) => this.loadError.set(err?.message ?? 'Error al cargar el contrato'),
      });
  }

  /**
   * ERR-06: la transicion invalida (422 CONTRACT_STATUS_001) se muestra como
   * mensaje accionable con su codigo — jamas pantalla en blanco — y la ficha
   * conserva el ultimo estado consistente.
   */
  onTransition(targetId: string): void {
    const target = targetId as ContractStatus;
    const current = this.contract();
    if (!current || this.transitionLoading() !== null) return;
    if (!this.validTransitions().includes(target)) {
      const message = `Transición no permitida de ${CONTRACT_STATUS_LABELS[current.status]} a ${CONTRACT_STATUS_LABELS[target] ?? target} (${CONTRACT_STATUS_ERROR_CODE})`;
      this.transitionError.set(message);
      this.toastService.error(message);
      return;
    }
    this.transitionLoading.set(target);
    this.transitionError.set(null);
    this.contractsService
      .transitionContractStatus(current.id, target)
      .pipe(
        finalize(() => this.transitionLoading.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (updated) => {
          this.contract.set(updated);
          this.toastService.success(`Contrato ${CONTRACT_STATUS_LABELS[updated.status].toLowerCase()} correctamente`);
        },
        error: (err: ContractApiError | Error) => {
          // ContractApiError ya trae el codigo entre parentesis; el fallback lo
          // anade para que el operador siempre vea el codigo accionable.
          const raw = err?.message ?? 'No se pudo cambiar el estado';
          const message =
            err instanceof ContractApiError && err.code
              ? raw
              : `${raw} (${CONTRACT_STATUS_ERROR_CODE})`;
          this.transitionError.set(message);
          this.toastService.error(message);
        },
      });
  }
}
