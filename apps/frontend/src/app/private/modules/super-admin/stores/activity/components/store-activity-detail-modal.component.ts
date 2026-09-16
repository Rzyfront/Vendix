import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  EmptyStateComponent,
  InputComponent,
  ModalComponent,
  PaginationComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

import { StoreActivityService } from '../services/store-activity.service';
import {
  STORE_ACTIVITY_CHANNELS,
  STORE_ACTIVITY_ORDER_STATES,
  StoreActivityDetail,
  StoreActivityEventType,
  StoreActivityRow,
} from '../contracts/store-activity.contract';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultTo(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const KIND_LABELS: Record<StoreActivityEventType, string> = {
  order: 'Pedido',
  audit: 'Auditoría',
  login: 'Acceso',
};

/**
 * Detalle de actividad de una tienda sobre el ranking (no navega).
 *
 * Resumen + timeline con filtros avanzados propios (rango, tipo de evento,
 * canal, estado de orden) y paginación propia del timeline. Los selects usan
 * los vocabularios cerrados del backend (`STORE_ACTIVITY_EVENT_TYPES`,
 * `order_channel_enum`, `order_state_enum`): el backend valida con
 * `IsIn`/`IsEnum` y responde 400 ante cualquier otro valor.
 *
 * Todo el estado vive aquí dentro: cerrar el modal no toca los filtros ni
 * la página del ranking que queda detrás.
 */
@Component({
  selector: 'app-store-activity-detail-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    InputComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (opened)="onOpened()"
      (cancel)="onCancel()"
      size="xl"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
    >
      @if (store(); as current) {
        <!-- Resumen -->
        <div class="grid grid-cols-2 gap-2 md:grid-cols-3 md:gap-3">
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Score</p>
            <p class="text-lg font-bold text-text-primary">{{ formatScore(current.score) }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Pedidos</p>
            <p class="text-lg font-bold text-text-primary">{{ current.orders_count }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Ingresos operativos</p>
            <p class="text-lg font-bold text-text-primary">{{ formatMoney(current.revenue_operating) }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Eventos auditados</p>
            <p class="text-lg font-bold text-text-primary">{{ current.audit_events }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Usuarios activos</p>
            <p class="text-lg font-bold text-text-primary">{{ current.active_users }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Última actividad</p>
            <p class="text-lg font-bold text-text-primary">{{ formatActivityDate(current.last_activity_at) }}</p>
          </div>
          <div class="rounded-lg bg-muted/40 px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary">Accesos exitosos</p>
            <p class="text-lg font-bold text-text-primary">{{ successfulLogins() }}</p>
          </div>
        </div>

        <!-- Filtros avanzados propios -->
        <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <app-input
            type="date"
            label="Desde"
            [ngModel]="from()"
            (ngModelChange)="onFromChange($event)"
          />
          <app-input
            type="date"
            label="Hasta"
            [ngModel]="to()"
            (ngModelChange)="onToChange($event)"
          />
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-text-primary">Tipo de evento</span>
            <select
              class="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary"
              [ngModel]="eventType()"
              (ngModelChange)="onEventTypeChange($event)"
            >
              <option value="">Todos</option>
              <option value="order">Pedido</option>
              <option value="audit">Auditoría</option>
              <option value="login">Acceso</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-text-primary">Canal (solo pedidos)</span>
            <select
              class="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary"
              [ngModel]="channel()"
              (ngModelChange)="onChannelChange($event)"
            >
              <option value="">Todos</option>
              @for (option of channelOptions(); track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-text-primary">Estado de orden (solo pedidos)</span>
            <select
              class="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary"
              [ngModel]="orderState()"
              (ngModelChange)="onOrderStateChange($event)"
            >
              <option value="">Todos</option>
              @for (option of orderStateOptions(); track option) {
                <option [value]="option">{{ option }}</option>
              }
            </select>
          </label>
        </div>

        <!-- Timeline -->
        <h4 class="mt-4 text-sm font-semibold text-text-primary">
          Eventos ({{ totalItems() }})
        </h4>
        @if (isLoading() && timeline().length === 0) {
          <div class="py-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-sm text-text-secondary">Cargando detalle...</p>
          </div>
        } @else if (timeline().length === 0) {
          <app-empty-state
            icon="activity"
            title="Sin eventos"
            description="Ningún evento coincide con los filtros avanzados."
            [showActionButton]="false"
            [showRefreshButton]="true"
            [showClearFilters]="true"
            (refreshClick)="loadDetail()"
            (clearFiltersClick)="clearAdvancedFilters()"
          />
        } @else {
          <ul class="mt-2 space-y-2">
            @for (event of timeline(); track event.id) {
              <li class="rounded-lg border border-border px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                  <span
                    class="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                  >
                    {{ kindLabel(event.kind) }}
                  </span>
                  <span class="text-xs text-text-secondary">
                    {{ formatTimestamp(event.occurred_at) }}
                  </span>
                </div>
                <p class="mt-1 text-sm font-medium text-text-primary">{{ event.title }}</p>
                @if (event.detail) {
                  <p class="mt-0.5 text-sm text-text-secondary">{{ event.detail }}</p>
                }
                <p class="mt-1 text-xs text-text-secondary">
                  @if (event.channel) {
                    <span>Canal: {{ event.channel }}</span>
                  }
                  @if (event.channel && event.state) {
                    <span> · </span>
                  }
                  @if (event.state) {
                    <span>Estado: {{ event.state }}</span>
                  }
                  @if ((event.channel || event.state) && event.actor) {
                    <span> · </span>
                  }
                  @if (event.actor) {
                    <span>{{ event.actor }}</span>
                  }
                </p>
              </li>
            }
          </ul>
          <div class="mt-3 flex justify-center">
            <app-pagination
              [currentPage]="detailFilters().page"
              [totalPages]="totalPages()"
              [total]="totalItems()"
              [limit]="detailFilters().limit"
              (pageChange)="onPageChange($event)"
            />
          </div>
        }
      }
    </app-modal>
  `,
})
export class StoreActivityDetailModalComponent {
  private readonly detailService = inject(StoreActivityService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly store = input<StoreActivityRow | null>(null);

  readonly detail = signal<StoreActivityDetail | null>(null);
  readonly isLoading = signal(false);

  readonly detailFilters = signal({ page: 1, limit: 10 });
  readonly from = signal(defaultFrom());
  readonly to = signal(defaultTo());
  readonly eventType = signal('');
  readonly channel = signal('');
  readonly orderState = signal('');

  readonly channelOptions = signal<readonly string[]>(STORE_ACTIVITY_CHANNELS);
  readonly orderStateOptions = signal<readonly string[]>(STORE_ACTIVITY_ORDER_STATES);

  readonly totalItems = signal(0);
  readonly totalPages = computed(
    () => Math.max(1, Math.ceil(this.totalItems() / this.detailFilters().limit)),
  );

  readonly timeline = computed(() => this.detail()?.timeline ?? []);
  readonly successfulLogins = computed(
    () => this.detail()?.summary?.successful_logins ?? 0,
  );

  readonly modalTitle = computed(() => {
    const current = this.store();
    return current ? `Actividad · ${current.name}` : 'Actividad de tienda';
  });

  readonly modalSubtitle = computed(() => {
    const current = this.store();
    if (!current) return '';
    const org = current.organization_name ?? 'Sin organización';
    return `${current.slug} · ${org}`;
  });

  onOpened(): void {
    this.detailFilters.set({ page: 1, limit: 10 });
    this.loadDetail();
  }

  onCancel(): void {
    this.isOpen.set(false);
  }

  loadDetail(): void {
    const current = this.store();
    if (!current) return;
    this.isLoading.set(true);
    const filters = this.detailFilters();
    this.detailService
      .getDetail(current.store_id, {
        page: filters.page,
        limit: filters.limit,
        from: this.from() || undefined,
        to: this.to() || undefined,
        event_type: this.eventType().trim() || undefined,
        channel: this.channel().trim() || undefined,
        order_state: this.orderState().trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.detail.set(response.data);
          this.totalItems.set(response.meta?.total ?? 0);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.isLoading.set(false);
          this.toastService.error(
            parseApiError(error).userMessage || 'Error al cargar el detalle de actividad',
          );
        },
      });
  }

  onFromChange(value: string): void {
    this.from.set(value ?? '');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  onToChange(value: string): void {
    this.to.set(value ?? '');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  onEventTypeChange(value: string): void {
    this.eventType.set(value ?? '');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  onChannelChange(value: string): void {
    this.channel.set(value ?? '');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  onOrderStateChange(value: string): void {
    this.orderState.set(value ?? '');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  onPageChange(page: number): void {
    this.detailFilters.update((f) => ({ ...f, page }));
    this.loadDetail();
  }

  clearAdvancedFilters(): void {
    this.from.set(defaultFrom());
    this.to.set(defaultTo());
    this.eventType.set('');
    this.channel.set('');
    this.orderState.set('');
    this.detailFilters.update((f) => ({ ...f, page: 1 }));
    this.loadDetail();
  }

  kindLabel(kind: StoreActivityEventType): string {
    return KIND_LABELS[kind] ?? kind;
  }

  formatScore(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  formatMoney(value: number | string | null | undefined): string {
    return this.currency.format(value ?? 0);
  }

  formatActivityDate(value: string | null | undefined): string {
    if (!value) return 'Sin actividad';
    return formatDateOnlyUTC(value);
  }

  formatTimestamp(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${formatDateOnlyUTC(value)} ${d.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }
}
