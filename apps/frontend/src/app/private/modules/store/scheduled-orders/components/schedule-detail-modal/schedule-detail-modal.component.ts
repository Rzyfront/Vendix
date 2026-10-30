import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import {
  ButtonComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ScheduledOrdersApiService } from '../../services/scheduled-orders-api.service';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  STATUS_TRANSITIONS,
  ScheduledOrderChange,
  ScheduledOrderDetail,
  ScheduledOrderStatus,
  customerName,
  describeVariant,
} from '../../interfaces/scheduled-order.interface';

const ACTION_LABELS: Record<Exclude<ScheduledOrderStatus, 'scheduled'>, string> = {
  in_production: 'Iniciar producción',
  ready: 'Marcar lista',
  delivered: 'Entregada',
  no_show: 'No recogida',
  cancelled: 'Cancelar',
};

@Component({
  selector: 'app-schedule-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, SpinnerComponent, CurrencyPipe],
  styles: [
    `
      .st-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: var(--fs-xs, 0.75rem);
        font-weight: 600;
        color: var(--st);
        background: color-mix(in srgb, var(--st) 15%, transparent);
      }
      .section-title {
        font-size: var(--fs-sm, 0.875rem);
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }
      .muted {
        color: var(--color-text-muted);
      }
      .box {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 10px);
        padding: 0.75rem;
        background: var(--color-surface);
      }
    `,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="detail() ? 'Pedido ' + detail()!.order.order_number : 'Pedido programado'"
      size="lg"
      (cancel)="confirmingCancel.set(false)"
    >
      @if (loading()) {
        <div class="flex justify-center py-10"><app-spinner /></div>
      } @else if (detail(); as d) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="st-badge" [style.--st]="color(d.status)">{{ label(d.status) }}</span>
            <span class="muted text-sm">
              {{ fulfillmentLabel(d) }} · {{ formatDateTime(d.scheduled_start) }}
            </span>
          </div>

          <div class="box text-sm">
            <div class="font-semibold">{{ customer(d) }}</div>
            @if (d.order.users?.phone) {
              <div class="muted">{{ d.order.users?.phone }}</div>
            }
            <div class="muted">Total: {{ toNumber(d.order.grand_total) | currency }}</div>
          </div>

          <div>
            <div class="section-title">Productos</div>
            <div class="flex flex-col gap-2">
              @for (item of d.order.order_items; track item.id) {
                <div class="box text-sm">
                  <div class="font-semibold">
                    {{ item.quantity }} × {{ item.product_name }}
                    @if (variant(item.variant_attributes)) {
                      <span class="muted font-normal">({{ variant(item.variant_attributes) }})</span>
                    }
                  </div>
                  @for (opt of item.order_item_options ?? []; track $index) {
                    <div class="muted">
                      + {{ opt.option_name }}
                      @if (+opt.quantity !== 1) { × {{ opt.quantity }} }
                      <span class="text-xs">({{ opt.group_name }})</span>
                    </div>
                  }
                  @if (item.notes) {
                    <div class="muted italic">Nota: {{ item.notes }}</div>
                  }
                </div>
              }
            </div>
          </div>

          <div>
            <div class="section-title">Historial</div>
            <ul class="flex flex-col gap-1 text-sm">
              @for (c of d.changes ?? []; track $index) {
                <li>
                  {{ describeChange(c) }}
                  <span class="muted text-xs">· {{ formatDateTime(c.created_at) }}</span>
                </li>
              } @empty {
                <li class="muted">Sin movimientos.</li>
              }
            </ul>
          </div>
        </div>
      } @else {
        <p class="muted text-sm py-6 text-center">No se pudo cargar el pedido.</p>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2 w-full">
        @for (action of actions(); track action) {
          @if (action === 'cancelled') {
            @if (confirmingCancel()) {
              <app-button variant="danger" [loading]="acting()" (clicked)="run('cancelled')">
                Confirmar cancelación
              </app-button>
              <app-button variant="ghost" (clicked)="confirmingCancel.set(false)">Volver</app-button>
            } @else {
              <app-button variant="outline-danger" [disabled]="acting()" (clicked)="confirmingCancel.set(true)">
                {{ actionLabel(action) }}
              </app-button>
            }
          } @else if (!confirmingCancel()) {
            <app-button
              [variant]="action === 'no_show' ? 'outline-warning' : 'primary'"
              [disabled]="acting()"
              (clicked)="run(action)"
            >
              {{ actionLabel(action) }}
            </app-button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class ScheduleDetailModalComponent {
  private readonly api = inject(ScheduledOrdersApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly scheduleId = input<number | null>(null);
  readonly isOpen = model<boolean>(false);
  /** Se emite tras cambiar el estado, para que la agenda recargue. */
  readonly changed = output<void>();

  readonly detail = signal<ScheduledOrderDetail | null>(null);
  readonly loading = signal(false);
  readonly acting = signal(false);
  readonly confirmingCancel = signal(false);

  readonly actions = computed<Exclude<ScheduledOrderStatus, 'scheduled'>[]>(() => {
    const d = this.detail();
    if (!d || !this.auth.hasPermission('store:scheduled_orders:update')) return [];
    const now = Date.now();
    return STATUS_TRANSITIONS[d.status].filter(
      (s): s is Exclude<ScheduledOrderStatus, 'scheduled'> =>
        s !== 'scheduled' && !(s === 'no_show' && now < new Date(d.scheduled_end).getTime()),
    );
  });

  constructor() {
    effect(() => {
      const id = this.scheduleId();
      if (this.isOpen() && id !== null) {
        this.confirmingCancel.set(false);
        this.detail.set(null);
        this.load(id);
      }
    });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.api
      .getDetail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.detail.set(d);
          this.loading.set(false);
        },
        error: (err) => {
          this.detail.set(null);
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  run(status: ScheduledOrderStatus): void {
    const d = this.detail();
    if (!d || this.acting()) return;
    this.acting.set(true);
    this.api
      .updateStatus(d.id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.confirmingCancel.set(false);
          this.toast.success(`Pedido: ${STATUS_LABELS[status].toLowerCase()}`);
          this.changed.emit();
          this.load(d.id);
        },
        error: (err) => {
          this.acting.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  label(s: ScheduledOrderStatus): string {
    return STATUS_LABELS[s];
  }
  color(s: ScheduledOrderStatus): string {
    return STATUS_COLORS[s];
  }
  actionLabel(s: Exclude<ScheduledOrderStatus, 'scheduled'>): string {
    return ACTION_LABELS[s];
  }
  customer(d: ScheduledOrderDetail): string {
    return customerName(d.order.users);
  }
  variant = describeVariant;
  toNumber(v: number | string): number {
    return Number(v);
  }
  fulfillmentLabel(d: ScheduledOrderDetail): string {
    return d.fulfillment_type === 'delivery' ? 'Domicilio' : 'Recogida';
  }

  formatDateTime(iso: string | null): string {
    return iso ? formatStoreDateTime(iso, this.settings.timezone()) : '';
  }

  describeChange(c: ScheduledOrderChange): string {
    const who = c.changed_by
      ? [c.changed_by.first_name, c.changed_by.last_name].filter(Boolean).join(' ')
      : '';
    const by = who ? ` por ${who}` : '';
    if (c.change_type === 'reschedule') {
      return `Reprogramado de ${this.formatDateTime(c.from_start)} a ${this.formatDateTime(c.to_start)}${by}`;
    }
    if (c.change_type === 'status' && c.to_status) {
      const from = c.from_status ? `${STATUS_LABELS[c.from_status]} → ` : '';
      return `Estado: ${from}${STATUS_LABELS[c.to_status]}${by}`;
    }
    return `Pedido programado${by}`;
  }
}
