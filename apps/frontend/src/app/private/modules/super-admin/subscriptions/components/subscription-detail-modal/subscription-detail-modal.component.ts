import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe, JsonPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ModalComponent,
  IconComponent,
  ButtonComponent,
  TimelineComponent,
  TimelineStep,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import {
  StoreSubscription,
  SubscriptionEvent,
} from '../../interfaces/subscription-admin.interface';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';

@Component({
  selector: 'app-subscription-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    IconComponent,
    ButtonComponent,
    TimelineComponent,
    EmptyStateComponent,
    DatePipe,
    CurrencyPipe,
    JsonPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle()"
      size="xl"
      (isOpenChange)="onIsOpenChange($event)"
    >
      @if (sub(); as s) {
        <div class="p-4 md:p-6 space-y-6">
          <!-- Summary Header Card -->
          <div class="bg-surface-secondary/40 border border-border rounded-xl p-4 md:p-5">
            <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-bold text-text-primary">{{ s.store_name }}</h3>
                  <span class="text-xs px-2 py-0.5 rounded-full font-medium" [ngClass]="stateBadgeClass(s.state || s.status)">
                    {{ stateLabel(s.state || s.status) }}
                  </span>
                </div>
                <p class="text-sm text-text-secondary mt-0.5">
                  Organización: <span class="font-medium text-text-primary">{{ s.organization_name }}</span>
                  <span class="text-text-secondary/60 ml-2">ID Suscripción: #{{ s.id }}</span>
                </p>
              </div>

              <div class="flex items-baseline gap-2 md:text-right">
                <span class="text-2xl font-bold text-text-primary">
                  {{ s.price | currency: (s.currency_code || 'COP') : 'symbol-narrow' : '1.0-0' }}
                </span>
                <span class="text-xs text-text-secondary uppercase font-semibold">
                  / {{ cycleLabel(s.billing_cycle) }}
                </span>
              </div>
            </div>

            <!-- Tab Navigation inside Modal -->
            <div class="flex border-b border-border mt-5 -mb-1 gap-2">
              <button
                type="button"
                class="pb-2.5 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2"
                [class.border-primary]="activeTab() === 'general'"
                [class.text-primary]="activeTab() === 'general'"
                [class.border-transparent]="activeTab() !== 'general'"
                [class.text-text-secondary]="activeTab() !== 'general'"
                (click)="activeTab.set('general')"
              >
                <app-icon name="file-text" [size]="16"></app-icon>
                Información general
              </button>
              <button
                type="button"
                class="pb-2.5 px-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2"
                [class.border-primary]="activeTab() === 'events'"
                [class.text-primary]="activeTab() === 'events'"
                [class.border-transparent]="activeTab() !== 'events'"
                [class.text-text-secondary]="activeTab() !== 'events'"
                (click)="onEventsTabClicked()"
              >
                <app-icon name="activity" [size]="16"></app-icon>
                Historial de eventos
                @if (events().length > 0) {
                  <span class="text-xs px-1.5 py-0.2 bg-primary/10 text-primary font-bold rounded-full">
                    {{ events().length }}
                  </span>
                }
              </button>
            </div>
          </div>

          <!-- TAB 1: Información General -->
          @if (activeTab() === 'general') {
            <div class="space-y-6">
              <!-- Grid Details -->
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Plan contratado</span>
                  <p class="text-sm font-semibold text-text-primary mt-1 flex items-center gap-1.5">
                    <app-icon name="layers" [size]="15" class="text-primary"></app-icon>
                    {{ s.plan_name }}
                  </p>
                </div>

                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Ciclo de facturación</span>
                  <p class="text-sm font-semibold text-text-primary mt-1 flex items-center gap-1.5">
                    <app-icon name="calendar" [size]="15" class="text-primary"></app-icon>
                    {{ cycleLabel(s.billing_cycle) }}
                  </p>
                </div>

                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Renovación automática</span>
                  <p class="text-sm font-semibold text-text-primary mt-1 flex items-center gap-1.5">
                    <app-icon [name]="s.auto_renew ? 'check-circle' : 'x-circle'" [size]="15" [class.text-green-600]="s.auto_renew" [class.text-red-500]="!s.auto_renew"></app-icon>
                    {{ s.auto_renew ? 'Habilitada' : 'Deshabilitada' }}
                  </p>
                </div>

                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Inicio del período</span>
                  <p class="text-sm font-semibold text-text-primary mt-1">
                    {{ s.current_period_start | date: 'mediumDate' }}
                  </p>
                </div>

                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Fin del período</span>
                  <p class="text-sm font-semibold text-text-primary mt-1">
                    {{ s.current_period_end | date: 'mediumDate' }}
                  </p>
                </div>

                <div class="bg-surface border border-border rounded-lg p-3.5">
                  <span class="text-xs font-medium text-text-secondary">Límite de gracia</span>
                  <p class="text-sm font-semibold text-text-primary mt-1">
                    {{ s.grace_period_end ? (s.grace_period_end | date: 'mediumDate') : 'Sin gracia activa' }}
                  </p>
                </div>
              </div>

              <!-- Invoices Section (if available from backend) -->
              @if (invoices().length > 0) {
                <div class="bg-surface border border-border rounded-xl p-4 md:p-5">
                  <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
                    <app-icon name="receipt" [size]="16" class="text-primary"></app-icon>
                    Facturas recientes
                  </h4>
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                      <thead>
                        <tr class="border-b border-border text-text-secondary uppercase">
                          <th class="py-2 px-3">Número</th>
                          <th class="py-2 px-3">Estado</th>
                          <th class="py-2 px-3">Total</th>
                          <th class="py-2 px-3">Vence</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border">
                        @for (inv of invoices(); track inv.id) {
                          <tr>
                            <td class="py-2.5 px-3 font-semibold text-text-primary">{{ inv.invoice_number }}</td>
                            <td class="py-2.5 px-3">
                              <span class="px-2 py-0.5 rounded text-[11px] font-medium" [ngClass]="invoiceBadgeClass(inv.state)">
                                {{ inv.state }}
                              </span>
                            </td>
                            <td class="py-2.5 px-3 font-medium text-text-primary">
                              {{ inv.total | currency: (s.currency_code || 'COP') : 'symbol-narrow' : '1.0-0' }}
                            </td>
                            <td class="py-2.5 px-3 text-text-secondary">
                              {{ inv.due_at | date: 'shortDate' }}
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              }
            </div>
          }

          <!-- TAB 2: Historial de Eventos -->
          @if (activeTab() === 'events') {
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <span class="text-xs text-text-secondary">Línea de tiempo de auditoría y transiciones de estado</span>
                <app-button variant="outline" size="sm" (clicked)="loadEvents()">
                  <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
                  Actualizar
                </app-button>
              </div>

              @if (loadingEvents()) {
                <div class="p-8 text-center">
                  <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  <p class="mt-2 text-text-secondary text-xs">Cargando eventos...</p>
                </div>
              } @else if (events().length === 0) {
                <app-empty-state
                  icon="activity"
                  title="Sin eventos registrados"
                  description="Esta suscripción aún no tiene transiciones ni eventos registrados."
                ></app-empty-state>
              } @else {
                <div class="bg-surface border border-border rounded-xl p-4 md:p-6">
                  <app-timeline [steps]="timelineSteps()" [collapsible]="false" size="md">
                    <ng-template #stepTemplate let-step let-i="index">
                      <div class="flex items-start justify-between w-full gap-3">
                        <div class="flex-1 min-w-0">
                          <span class="text-sm font-semibold text-text-primary">{{ step.label }}</span>
                          @if (step.description) {
                            <p class="text-xs text-text-secondary mt-1">{{ step.description }}</p>
                          }
                          @if (step.date) {
                            <span class="text-[10px] font-bold text-text-secondary/70 uppercase tracking-tighter block mt-1">
                              {{ step.date | date: 'medium' }}
                            </span>
                          }
                          <!-- Expandable payload preview if available -->
                          @if (expandedEventIndex() === i && events()[i]?.metadata) {
                            <pre class="text-[11px] bg-background border border-border rounded p-2.5 mt-2 overflow-auto max-h-48">{{ events()[i].metadata | json }}</pre>
                          }
                        </div>
                        @if (hasPayload(events()[i])) {
                          <button
                            type="button"
                            class="shrink-0 inline-flex items-center gap-1 text-xs text-primary font-medium px-2 py-1 rounded hover:bg-primary/10 transition-colors"
                            (click)="togglePayload(i)"
                          >
                            <app-icon [name]="expandedEventIndex() === i ? 'chevron-up' : 'code'" [size]="13"></app-icon>
                            <span>{{ expandedEventIndex() === i ? 'Ocultar' : 'Payload' }}</span>
                          </button>
                        }
                      </div>
                    </ng-template>
                  </app-timeline>
                </div>
              }
            </div>
          }
        </div>
      }
    </app-modal>
  `,
})
export class SubscriptionDetailModalComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = input<boolean>(false);
  readonly subscription = input<StoreSubscription | null>(null);
  readonly initialTab = input<'general' | 'events'>('general');
  readonly closed = output<void>();

  readonly activeTab = signal<'general' | 'events'>('general');
  readonly detailedData = signal<any | null>(null);
  readonly events = signal<SubscriptionEvent[]>([]);
  readonly loadingEvents = signal(false);
  readonly expandedEventIndex = signal<number | null>(null);

  readonly sub = computed<StoreSubscription | null>(() => {
    return this.subscription();
  });

  readonly modalTitle = computed(() => {
    const s = this.sub();
    return s ? `Suscripción: ${s.store_name}` : 'Detalle de suscripción';
  });

  readonly invoices = computed(() => {
    const detailed = this.detailedData();
    if (detailed?.invoices?.length) return detailed.invoices;
    const raw = this.sub()?.raw;
    if (raw?.invoices?.length) return raw.invoices;
    return [];
  });

  constructor() {
    effect(
      () => {
        if (this.isOpen()) {
          this.activeTab.set(this.initialTab());
          this.expandedEventIndex.set(null);
          const s = this.subscription();
          if (s?.id) {
            this.loadDetailedInfo(s.id);
            if (this.initialTab() === 'events') {
              this.loadEvents();
            }
          }
        }
      },
      { allowSignalWrites: true },
    );
  }

  loadDetailedInfo(id: string): void {
    this.service
      .getSubscriptionById(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.success && res.data) {
            this.detailedData.set(res.data);
          }
        },
        error: () => {},
      });
  }

  loadEvents(): void {
    const s = this.sub();
    if (!s?.id) return;

    this.loadingEvents.set(true);
    this.service
      .getSubscriptionEvents(s.id, { page: 1, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.success) {
            this.events.set(res.data);
          }
          this.loadingEvents.set(false);
        },
        error: () => this.loadingEvents.set(false),
      });
  }

  onEventsTabClicked(): void {
    this.activeTab.set('events');
    if (this.events().length === 0) {
      this.loadEvents();
    }
  }

  timelineSteps(): TimelineStep[] {
    return this.events().map((e, index) => ({
      key: `evt-${index}`,
      label: e.event_type,
      description: e.description,
      date: e.created_at,
      status: 'completed' as const,
      variant: 'default' as const,
    }));
  }

  hasPayload(event?: SubscriptionEvent): boolean {
    if (!event?.metadata) return false;
    return Object.keys(event.metadata).length > 0;
  }

  togglePayload(index: number): void {
    this.expandedEventIndex.update((curr) => (curr === index ? null : index));
  }

  onIsOpenChange(open: boolean): void {
    if (!open) {
      this.closed.emit();
    }
  }

  stateBadgeClass(state?: string): string {
    switch (state) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'grace':
      case 'grace_soft':
      case 'grace_hard':
        return 'bg-amber-100 text-amber-800';
      case 'suspended':
      case 'blocked':
        return 'bg-red-100 text-red-800';
      case 'pending_payment':
        return 'bg-purple-100 text-purple-800';
      case 'cancelled':
      case 'expired':
        return 'bg-gray-100 text-gray-700';
      case 'trial':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  stateLabel(state?: string): string {
    switch (state) {
      case 'active':
        return 'Activa';
      case 'grace':
      case 'grace_soft':
        return 'Gracia (Soft)';
      case 'grace_hard':
        return 'Gracia (Hard)';
      case 'suspended':
        return 'Suspendida';
      case 'blocked':
        return 'Bloqueada';
      case 'pending_payment':
        return 'Pendiente de pago';
      case 'cancelled':
        return 'Cancelada';
      case 'expired':
        return 'Expirada';
      case 'trial':
        return 'Prueba';
      default:
        return state || 'Desconocido';
    }
  }

  cycleLabel(cycle?: string): string {
    switch (cycle) {
      case 'monthly':
        return 'Mensual';
      case 'quarterly':
        return 'Trimestral';
      case 'semiannual':
      case 'biannual':
        return 'Semestral';
      case 'annual':
        return 'Anual';
      case 'lifetime':
        return 'De por vida';
      default:
        return cycle || 'Mensual';
    }
  }

  invoiceBadgeClass(state: string): string {
    switch (state) {
      case 'paid':
        return 'bg-green-100 text-green-800';
      case 'overdue':
        return 'bg-red-100 text-red-800';
      case 'issued':
      case 'sent':
        return 'bg-blue-100 text-blue-800';
      case 'draft':
        return 'bg-gray-100 text-gray-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }
}
