import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  CustomerSelectComponent,
  type CustomerSelectOption,
  IconComponent,
  ModalComponent,
  SelectorComponent,
} from '../../../../../shared/components';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  ChargeCartToSessionResult,
  PosRentalPlan,
  PosServiceSession,
  PosServiceStationIntegrationService,
  formatRentalDuration,
} from '../services/pos-service-station-integration.service';
import type { ServiceStation } from '../../reservations/components/service-stations/service-stations.service';
import {
  OpenSessionDepositComponent,
  OpenSessionDepositValue,
  openCustomerError,
  openDepositError,
} from '../../reservations/components/service-stations/open-session-deposit/open-session-deposit.component';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import type { CartItem } from '../models/cart.model';
import { PosServiceSessionPickerComponent } from './pos-service-session-picker.component';

export interface StationChargedEvent {
  session: PosServiceSession;
  result: ChargeCartToSessionResult;
}

/**
 * "Cargar a estación" — gemelo del modal de mesas (`pos-open-table-modal`).
 * Lista las atenciones activas de las estaciones de servicio y carga el
 * carrito del POS a la cuenta (orden borrador SVC-{id}) de la elegida, en
 * lugar de cobrarlo ahora. El padre limpia el carrito al recibir `charged`.
 */
@Component({
  selector: 'app-pos-charge-station-modal',
  standalone: true,
  imports: [
    ButtonComponent,
    ModalComponent,
    IconComponent,
    CurrencyPipe,
    FormsModule,
    SelectorComponent,
    CustomerSelectComponent,
    OpenSessionDepositComponent,
    PosServiceSessionPickerComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [showCloseButton]="true"
      title="Estaciones"
      [subtitle]="mode() === 'charge' ? 'Agrega el carrito a la cuenta abierta de una estación ocupada' : 'Abre una estación libre con cliente, plan y, si aplica, anticipo'"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon name="warehouse" [size]="20" class="text-primary"></app-icon>
      </div>

      <div class="space-y-4">
        <div class="flex gap-2" role="tablist" aria-label="Acción en estaciones">
          <app-button
            [variant]="mode() === 'charge' ? 'primary' : 'secondary'"
            size="sm"
            (clicked)="setMode('charge')"
          >Cargar a una atención</app-button>
          <app-button
            [variant]="mode() === 'open' ? 'primary' : 'secondary'"
            size="sm"
            (clicked)="setMode('open')"
          >Abrir estación libre</app-button>
        </div>
      </div>

      @if (mode() === 'open') {
        <div class="space-y-4 mt-4">
          <app-selector
            label="Estación libre"
            placeholder="Selecciona la estación"
            [options]="stationOptions()"
            [ngModel]="stationId()"
            (ngModelChange)="onStation($event)"
            [helpText]="loadingOpen() ? 'Cargando estaciones…' : (stations().length === 0 ? 'No hay estaciones libres.' : '')"
          />
          @if (planOptions().length > 0) {
            <app-selector
              label="Servicio"
              placeholder="Selecciona el servicio"
              [options]="planOptions()"
              [ngModel]="planId()"
              (ngModelChange)="onPlan($event)"
            />
          }
          @if (variantOptions().length > 0) {
            <app-selector
              label="Duración"
              placeholder="Selecciona la duración"
              [options]="variantOptions()"
              [ngModel]="variantId()"
              (ngModelChange)="onVariant($event)"
            />
          }
          <app-customer-select
            label="Cliente"
            [helpText]="customerHelp()"
            [selected]="customer()"
            (selectedChange)="customer.set($event)"
          />
          <app-open-session-deposit
            [station]="selectedStation()"
            [customerIdentified]="!!customer()?.id"
            [(value)]="deposit"
          />
          @if (openBlockReason(); as reason) {
            <p class="text-xs text-[var(--color-error)]">{{ reason }}</p>
          }
        </div>
      } @else {
      <div class="space-y-4">
          <app-pos-service-session-picker
            [sessions]="sessions()"
            [loading]="loading()"
            [(selectedId)]="selectedId"
          ></app-pos-service-session-picker>

          @if (mapping().blocked.length > 0) {
            <div class="blocked-box">
              <div class="flex items-center gap-1.5 font-semibold">
                <app-icon name="circle-alert" [size]="14"></app-icon>
                Estas líneas no se pueden cargar a una estación:
              </div>
              <ul class="mt-1 list-disc pl-5">
                @for (b of mapping().blocked; track $index) {
                  <li>{{ b.name }}: {{ b.reason }}</li>
                }
              </ul>
              <div class="mt-1">Quítalas del carrito o cóbralas por separado.</div>
            </div>
          }

          @if (selectedSession(); as sel) {
            <div class="summary-box">
              <div class="summary-row">
                <span>Total actual · {{ sel.station_name }}</span>
                <span>{{ currentTotal() | currency }}</span>
              </div>
              <div class="summary-row">
                <span>+ Este carrito (con impuestos)</span>
                <span>{{ mapping().amount | currency }}</span>
              </div>
              <div class="summary-row total">
                <span>= Nuevo total</span>
                <span>{{ newTotal() | currency }}</span>
              </div>
            </div>
          }
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        @if (mode() === 'open') {
          <app-button
            variant="primary"
            size="md"
            (clicked)="onOpen()"
            [disabled]="!canOpen() || submitting()"
          >
            <app-icon name="play" [size]="16" slot="icon"></app-icon>
            @if (submitting()) {
              Abriendo...
            } @else {
              Abrir estación
            }
          </app-button>
        } @else {
          <app-button
            variant="primary"
            size="md"
            (clicked)="onConfirm()"
            [disabled]="!canConfirm() || submitting()"
          >
            <app-icon name="warehouse" [size]="16" slot="icon"></app-icon>
            @if (submitting()) {
              Cargando...
            } @else {
              Cargar a la cuenta
            }
          </app-button>
        }
      </div>
    </app-modal>
  `,
  styles: [
    `
      .summary-box {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        background: var(--color-muted);
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: var(--color-text-secondary);
      }
      .summary-row.total {
        color: var(--color-text-primary);
        font-weight: 700;
        font-size: 15px;
        border-top: 1px solid var(--color-border);
        padding-top: 6px;
      }
      .blocked-box {
        font-size: 12px;
        color: var(--color-error);
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.06);
        border-radius: 10px;
        padding: 10px 12px;
      }
    `,
  ],
})
export class PosChargeStationModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly integration = inject(PosServiceStationIntegrationService);
  private readonly toastService = inject(ToastService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly cartItems = input<CartItem[]>([]);
  /** Mode shown when the modal opens: 'open' when the cart is empty (nothing to charge). */
  readonly startMode = input<'charge' | 'open'>('charge');
  readonly isOpenChange = output<boolean>();
  readonly charged = output<StationChargedEvent>();
  /** Emitted with the new session id after a station is opened from the POS. */
  readonly opened = output<number>();

  readonly mode = signal<'charge' | 'open'>('charge');

  // --- Open a free station (S4) ---
  readonly stations = signal<ServiceStation[]>([]);
  readonly plans = signal<PosRentalPlan[]>([]);
  readonly loadingOpen = signal(false);
  readonly stationId = signal<number | null>(null);
  readonly planId = signal<number | null>(null);
  readonly variantId = signal<number | null>(null);
  readonly customer = signal<CustomerSelectOption | null>(null);
  readonly deposit = signal<OpenSessionDepositValue | null>(null);

  readonly selectedStation = computed<ServiceStation | null>(
    () => this.stations().find((s) => s.id === this.stationId()) ?? null,
  );
  readonly stationOptions = computed(() =>
    this.stations().map((s) => ({ value: s.id, label: s.name })),
  );
  /** Plans the chosen station sells (its linked service products). */
  readonly stationPlans = computed<PosRentalPlan[]>(() => {
    const linked = new Set(
      (this.selectedStation()?.services ?? []).map((l) => Number(l.product_id)),
    );
    return this.plans().filter((p) => linked.has(p.id));
  });
  readonly planOptions = computed(() =>
    this.stationPlans().map((p) => ({ value: p.id, label: p.name })),
  );
  readonly selectedPlan = computed<PosRentalPlan | null>(
    () => this.stationPlans().find((p) => p.id === this.planId()) ?? null,
  );
  /** Only variants that carry a duration are offered as rental durations. */
  readonly variantOptions = computed(() =>
    (this.selectedPlan()?.variants ?? [])
      .filter((v) => (v.service_duration_minutes ?? 0) > 0)
      .map((v) => {
        const duration = formatRentalDuration(
          v.service_duration_minutes,
          v.service_duration_unit,
        );
        const price = v.price != null ? ` · ${this.currencyService.format(v.price)}` : '';
        return { value: v.id, label: `${v.name || duration}${v.name ? ` (${duration})` : ''}${price}` };
      }),
  );
  readonly customerHelp = computed(() =>
    (this.selectedStation()?.deposit_policy ?? 'none') !== 'none'
      ? 'Obligatorio para recibir un anticipo.'
      : 'Opcional.',
  );
  readonly openBlockReason = computed<string | null>(() => {
    const station = this.selectedStation();
    if (!station) return null;
    const customerError = openCustomerError(
      this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
      this.customer()?.id,
    );
    if (customerError) return customerError;
    if (
      station.deposit_policy &&
      station.deposit_policy !== 'none' &&
      this.deposit() &&
      !this.customer()?.id
    ) {
      return 'Identifica al cliente para recibir el anticipo.';
    }
    return openDepositError(station, this.customer()?.id, this.deposit());
  });
  readonly canOpen = computed(
    () =>
      this.selectedStation() != null &&
      this.openBlockReason() == null &&
      (this.variantOptions().length === 0 || this.variantId() != null),
  );

  readonly sessions = signal<PosServiceSession[]>([]);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly selectedId = signal<number | null>(null);

  readonly mapping = computed(() =>
    this.integration.mapCartToLines(this.cartItems()),
  );

  readonly selectedSession = computed<PosServiceSession | null>(() => {
    const id = this.selectedId();
    if (id == null) return null;
    return this.sessions().find((s) => s.id === id) ?? null;
  });

  readonly currentTotal = computed(
    () => Number(this.selectedSession()?.order?.grand_total ?? 0) || 0,
  );
  readonly newTotal = computed(
    () => Math.round((this.currentTotal() + this.mapping().amount) * 100) / 100,
  );

  readonly canConfirm = computed(
    () =>
      this.selectedSession() != null &&
      this.mapping().lines.length > 0 &&
      this.mapping().blocked.length === 0,
  );

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.sessions.set([]);
          this.selectedId.set(null);
          this.mode.set('charge');
          this.resetOpen();
          this.loadSessions();
          if (this.startMode() === 'open') this.setMode('open');
        });
      }
    });
  }

  setMode(mode: 'charge' | 'open'): void {
    this.mode.set(mode);
    if (mode === 'open' && this.stations().length === 0) this.loadOpenData();
  }

  private resetOpen(): void {
    this.stations.set([]);
    this.stationId.set(null);
    this.planId.set(null);
    this.variantId.set(null);
    this.customer.set(null);
    this.deposit.set(null);
  }

  private loadOpenData(): void {
    this.loadingOpen.set(true);
    forkJoin({
      stations: this.integration.listFreeStations(),
      plans: this.integration.listRentalPlans(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ stations, plans }) => {
          this.stations.set(stations);
          this.plans.set(plans);
          this.loadingOpen.set(false);
        },
        error: (err) => {
          this.loadingOpen.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  onStation(raw: unknown): void {
    const id = Number(raw);
    this.stationId.set(Number.isInteger(id) && id > 0 ? id : null);
    this.planId.set(null);
    this.variantId.set(null);
    const plans = this.stationPlans();
    if (plans.length === 1) this.onPlan(plans[0].id);
  }

  onPlan(raw: unknown): void {
    const id = Number(raw);
    this.planId.set(Number.isInteger(id) && id > 0 ? id : null);
    this.variantId.set(null);
    const options = this.variantOptions();
    if (options.length === 1) this.variantId.set(options[0].value as number);
  }

  onVariant(raw: unknown): void {
    const id = Number(raw);
    this.variantId.set(Number.isInteger(id) && id > 0 ? id : null);
  }

  onOpen(): void {
    const station = this.selectedStation();
    if (!station || !this.canOpen()) return;
    const customer = this.customer();
    const deposit = station.deposit_policy !== 'none' ? this.deposit() : null;
    this.submitting.set(true);
    this.integration
      .openSession({
        station_id: station.id,
        ...(this.planId() ? { product_id: this.planId()! } : {}),
        // Walk-in only: a variant never travels with a booking id.
        ...(this.variantId() ? { product_variant_id: this.variantId()! } : {}),
        ...(customer?.id ? { customer_id: customer.id } : {}),
        ...(deposit ? { deposit } : {}),
        subject: { subject_type: 'person', label: customer?.name || station.name },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          this.submitting.set(false);
          this.toastService.success(`${station.name} abierta.`);
          this.opened.emit(session.id);
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  private loadSessions(): void {
    this.loading.set(true);
    this.integration
      .listActiveSessions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.sessions.set(rows ?? []);
          if ((rows ?? []).length === 1) this.selectedId.set(rows[0].id);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onConfirm(): void {
    const session = this.selectedSession();
    const { lines, blocked } = this.mapping();
    if (!session || lines.length === 0) return;
    if (blocked.length > 0) {
      this.toastService.warning(
        `No se puede cargar: ${blocked.map((b) => b.name).join(', ')}`,
      );
      return;
    }

    this.submitting.set(true);
    this.integration
      .chargeCartToSession(session.id, lines)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.charged.emit({ session, result });
          this.isOpenChange.emit(false);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(
            err instanceof Error ? err.message : extractApiErrorMessage(err),
          );
          this.loadSessions();
        },
      });
  }
}
