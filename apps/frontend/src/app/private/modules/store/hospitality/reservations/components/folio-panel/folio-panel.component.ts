import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { startWith } from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { ProductsService } from '../../../../products/services/products.service';
import { Product } from '../../../../products/interfaces/product.interface';
import { FOLIO_STATUS_LABELS } from '../../interfaces/reservation.interface';
import { FolioDetail, FolioLine, SplitAccount, SplitResult } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { FolioSplitModalComponent } from '../folio-split-modal/folio-split-modal.component';

type Action = 'charge' | 'payment' | 'void' | 'splitPay' | null;

const PAYMENT_STATE_LABELS: Record<string, string> = {
  unpaid: 'Sin pagar',
  pending: 'Pendiente',
  partial: 'Pago parcial',
  paid: 'Pagada',
};

/** Methods the desk registers by hand; gateways settle themselves. */
const MANUAL_METHODS = ['cash', 'card', 'bank_transfer'];

/** Random key of one payment attempt (a double click registers it once). */
function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hospitality Suite (H3.4) — the guest folio in the reservation detail: each
 * night ("Noche 10-nov · Doble · $250.000 + IVA"), manual charges, voided
 * lines struck through with their reason, payments and the balance. Actions:
 * "Cargar noche", "Agregar cargo", "Registrar pago" and "Anular" per line.
 * H3.7: "Verificar folio" (D11) and, once closed, "Descargar factura".
 */
@Component({
  selector: 'app-folio-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    FolioSplitModalComponent,
  ],
  template: `
    <div class="rounded-lg border border-border" data-testid="folio-panel">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p class="flex items-center gap-2 font-medium text-text-primary" data-testid="reservation-folio">
          <app-icon name="receipt" [size]="16" />
          Folio · {{ statusLabel() }} · {{ money(folio()?.total ?? 0) }}
        </p>
        @if (editable() && !action()) {
          <div class="flex flex-wrap gap-1">
            @if (canSplit()) {
              <app-button variant="outline" size="sm" (clicked)="splitOpen.set(true)" data-testid="folio-split">
                <app-icon slot="icon" name="split" [size]="14" />
                Dividir
              </app-button>
            }
            @if (!split()) {
            <app-button
              variant="outline"
              size="sm"
              [loading]="busy()"
              [disabled]="!folio()?.pending_nights"
              (clicked)="postNights()"
              data-testid="folio-post-nights"
            >
              <app-icon slot="icon" name="moon" [size]="14" />
              Cargar noche
            </app-button>
            <app-button variant="outline" size="sm" (clicked)="startCharge()" data-testid="folio-add-charge">
              <app-icon slot="icon" name="plus" [size]="14" />
              Agregar cargo
            </app-button>
            @if ((folio()?.deposit_available ?? 0) > 0) {
              <app-button
                variant="outline"
                size="sm"
                [loading]="busy()"
                (clicked)="applyDeposit()"
                data-testid="folio-apply-deposit"
              >
                <app-icon slot="icon" name="piggy-bank" [size]="14" />
                Aplicar anticipo
              </app-button>
            }
            <app-button
              variant="outline"
              size="sm"
              [disabled]="!folio()?.balance"
              (clicked)="startPayment()"
              data-testid="folio-add-payment"
            >
              <app-icon slot="icon" name="banknote" [size]="14" />
              Registrar pago
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              [loading]="busy()"
              (clicked)="toggleChargesBlocked()"
              data-testid="folio-charges-blocked"
            >
              <app-icon slot="icon" [name]="folio()?.charges_blocked ? 'unlock' : 'lock'" [size]="14" />
              {{ folio()?.charges_blocked ? 'Permitir cargos' : 'Bloquear cargos' }}
            </app-button>
            }
            @if (!folio()?.verified_current) {
              <app-button
                variant="ghost"
                size="sm"
                [loading]="busy()"
                (clicked)="verify()"
                data-testid="folio-verify"
              >
                <app-icon slot="icon" name="shield-check" [size]="14" />
                Verificar folio
              </app-button>
            }
          </div>
        }
        @if (folio()?.status === 'closed') {
          <app-button
            variant="outline"
            size="sm"
            [loading]="busy()"
            (clicked)="downloadInvoice()"
            data-testid="folio-invoice-pdf"
          >
            <app-icon slot="icon" name="download" [size]="14" />
            Descargar factura
          </app-button>
        }
      </div>

      @if (loading()) {
        <p class="px-3 py-2 text-xs text-text-secondary">Cargando folio…</p>
      } @else if (folio(); as f) {
        @if (f.verified_current) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-success" data-testid="folio-verified">
            Folio verificado para facturar
          </p>
        }
        @if (split(); as sp) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-primary" data-testid="folio-split-banner">
            Folio dividido: cobra y factura cada cuenta
          </p>
        }
        @if (f.charges_blocked) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-error" data-testid="folio-charges-blocked-note">
            Cargos bloqueados: el POS y las mesas no pueden cargar a esta habitación.
          </p>
        }
        <ul class="divide-y divide-border">
          @for (line of f.lines; track line.id) {
            <li class="flex items-start justify-between gap-2 px-3 py-2" data-testid="folio-line">
              <div>
                <div [class.line-through]="line.cancelled_at" [class.opacity-60]="line.cancelled_at">
                  <p class="font-medium">
                    {{ line.description }}
                    @if (line.quantity > 1) {
                      × {{ line.quantity }}
                    }
                  </p>
                  <p class="text-xs text-text-secondary">
                    {{ money(line.subtotal) }}{{ line.tax_amount > 0 ? ' + IVA ' + money(line.tax_amount) : '' }}
                  </p>
                  @if (line.origin) {
                    <p class="text-xs text-text-secondary" data-testid="folio-line-origin">Origen: {{ line.origin }}</p>
                  }
                </div>
                @if (line.cancelled_at) {
                  <p class="text-xs text-error" data-testid="folio-line-void-reason">
                    Anulado: {{ line.cancellation_reason }}
                  </p>
                }
              </div>
              <div class="flex items-center gap-1">
                <span class="whitespace-nowrap font-medium" [class.line-through]="line.cancelled_at">
                  {{ money(line.total) }}
                </span>
                @if (editable() && !split() && !line.cancelled_at && !line.origin && !action()) {
                  <app-button
                    variant="ghost"
                    size="sm"
                    ariaLabel="Anular cargo"
                    (clicked)="startVoid(line)"
                    data-testid="folio-line-void"
                  >
                    <app-icon slot="icon" name="x-circle" [size]="14" />
                  </app-button>
                }
              </div>
            </li>
          } @empty {
            <li class="px-3 py-2 text-xs text-text-secondary">Sin cargos todavía</li>
          }
          @for (payment of f.payments; track payment.id) {
            @if (payment.kind === 'deposit') {
              <li
                class="flex items-center justify-between gap-2 bg-primary/5 px-3 py-2"
                data-testid="folio-deposit-applied"
              >
                <p class="flex items-center gap-1 font-medium text-primary">
                  <app-icon name="piggy-bank" [size]="14" />
                  Anticipo aplicado
                </p>
                <span class="whitespace-nowrap font-medium text-primary">− {{ money(payment.amount) }}</span>
              </li>
            } @else {
              <li class="flex items-center justify-between gap-2 px-3 py-2" data-testid="folio-payment">
                <p class="font-medium">Pago · {{ payment.method }}</p>
                <span class="whitespace-nowrap font-medium text-success">− {{ money(payment.amount) }}</span>
              </li>
            }
          }
        </ul>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          <dt class="text-text-secondary">Total</dt>
          <dd class="text-right">{{ money(f.total) }}</dd>
          <dt class="text-text-secondary">Pagado</dt>
          <dd class="text-right">{{ money(f.paid) }}</dd>
          @if (editable() && (f.deposit_available ?? 0) > 0) {
            <dt class="text-text-secondary">Anticipo disponible</dt>
            <dd class="text-right" data-testid="folio-deposit-available">{{ money(f.deposit_available ?? 0) }}</dd>
          }
          <dt class="font-semibold text-text-primary">Saldo</dt>
          <dd class="text-right font-semibold" data-testid="folio-balance">{{ money(f.balance) }}</dd>
        </dl>
      }

      @if (split(); as sp) {
        <div class="space-y-2 border-t border-border px-3 py-3" data-testid="folio-split-view">
          @for (account of sp.accounts; track account.id) {
            <div class="space-y-2 rounded-lg border border-border px-3 py-2" data-testid="folio-split-account">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-medium text-text-primary">{{ account.label }}</p>
                  @if (account.customer_name) {
                    <p class="text-xs text-text-secondary">{{ account.customer_name }}</p>
                  }
                </div>
                <span
                  class="rounded-full border border-border px-2 py-0.5 text-xs"
                  [class.text-success]="account.payment_state === 'paid'"
                  data-testid="folio-split-state"
                >
                  {{ paymentStateLabel(account.payment_state) }}
                </span>
              </div>
              <ul class="text-xs text-text-secondary">
                @for (line of account.lines; track line.order_item_id) {
                  <li class="flex justify-between gap-2">
                    <span>{{ line.product_name }}</span>
                    <span>{{ money(line.total) }}</span>
                  </li>
                }
              </ul>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt class="text-text-secondary">Total</dt>
                <dd class="text-right font-medium">{{ money(account.grand_total) }}</dd>
                <dt class="text-text-secondary">Pagado</dt>
                <dd class="text-right">{{ money(account.total_paid) }}</dd>
                <dt class="text-text-secondary">Saldo</dt>
                <dd class="text-right font-medium">{{ money(account.remaining_balance) }}</dd>
              </dl>
              <div class="flex flex-wrap items-center justify-end gap-2">
                @if (account.invoice; as inv) {
                  <span class="text-xs text-text-secondary" data-testid="folio-split-invoice">
                    Factura {{ inv.invoice_number ?? '' }} · {{ inv.status }}
                  </span>
                  <app-button
                    variant="outline"
                    size="sm"
                    [loading]="busy()"
                    (clicked)="downloadAccountInvoice(account)"
                  >
                    <app-icon slot="icon" name="download" [size]="14" />
                    Descargar factura
                  </app-button>
                } @else if (editable() && Number(account.remaining_balance) > 0 && action() === null) {
                  <app-button variant="primary" size="sm" (clicked)="startSplitPay(account)" data-testid="folio-split-pay">
                    Cobrar
                  </app-button>
                }
              </div>
            </div>
          }
          @if (editable() && !action()) {
            <div class="flex flex-wrap items-center justify-between gap-2">
              @if (!sp.undo.allowed) {
                <p class="text-xs text-text-secondary" data-testid="folio-split-blockers">
                  @if (sp.undo.blockers[0]; as b) {
                    {{ b.account_label }} ya tiene
                    {{ b.reason === 'invoice_transmitted' ? 'factura enviada a la DIAN' : 'pagos registrados' }}: no se puede quitar la división
                  }
                </p>
              }
              @if (confirmingUndo()) {
                <div class="ml-auto flex items-center gap-2">
                  <span class="text-xs">¿Volver al folio único?</span>
                  <app-button variant="ghost" size="sm" (clicked)="confirmingUndo.set(false)">No</app-button>
                  <app-button variant="danger" size="sm" [loading]="busy()" (clicked)="undoSplit()">Sí, quitar</app-button>
                </div>
              } @else {
                <app-button
                  class="ml-auto"
                  variant="outline"
                  size="sm"
                  [disabled]="!sp.undo.allowed"
                  (clicked)="confirmingUndo.set(true)"
                  data-testid="folio-split-undo"
                >
                  Quitar división
                </app-button>
              }
            </div>
          }
        </div>
      }

      @if (action() === 'splitPay') {
        <form [formGroup]="paymentForm" class="space-y-2 border-t border-border px-3 py-3" data-testid="folio-split-pay-form">
          <p class="font-medium">Cobrar «{{ payTarget()?.label }}»</p>
          <div class="grid grid-cols-2 gap-2">
            <app-input
              [formControl]="paymentForm.controls.amount"
              type="number"
              [min]="1"
              label="Monto"
              size="sm"
              [helperText]="'Saldo ' + money(payTarget()?.remaining_balance ?? 0)"
            />
            <app-selector
              [formControl]="paymentForm.controls.method_id"
              label="Medio de pago"
              placeholder="Elige el medio"
              [options]="methodOptions()"
            />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              variant="primary"
              size="sm"
              [loading]="busy()"
              [disabled]="paymentStatus() !== 'VALID'"
              (clicked)="saveSplitPayment()"
              data-testid="folio-split-pay-save"
            >
              Cobrar
            </app-button>
          </div>
        </form>
      }

      @if (action() === 'charge') {
        <form [formGroup]="chargeForm" class="space-y-2 border-t border-border px-3 py-3" data-testid="folio-charge-form">
          <app-selector
            [formControl]="chargeForm.controls.product_id"
            label="Producto o servicio"
            placeholder="Busca lavandería, minibar…"
            [searchable]="true"
            [options]="productOptions()"
            (valueChange)="onProductPicked()"
          />
          <div class="grid grid-cols-2 gap-2">
            <app-input
              [formControl]="chargeForm.controls.quantity"
              type="number"
              [min]="1"
              label="Cantidad"
              size="sm"
            />
            <app-input
              [formControl]="chargeForm.controls.unit_price"
              type="number"
              [min]="0"
              label="Precio unitario"
              size="sm"
            />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              variant="primary"
              size="sm"
              [loading]="busy()"
              [disabled]="chargeStatus() !== 'VALID'"
              (clicked)="saveCharge()"
              data-testid="folio-charge-save"
            >
              Agregar al folio
            </app-button>
          </div>
        </form>
      }

      @if (action() === 'payment') {
        <form [formGroup]="paymentForm" class="space-y-2 border-t border-border px-3 py-3" data-testid="folio-payment-form">
          <div class="grid grid-cols-2 gap-2">
            <app-input
              [formControl]="paymentForm.controls.amount"
              type="number"
              [min]="1"
              label="Monto"
              size="sm"
              [helperText]="'Saldo ' + money(folio()?.balance ?? 0)"
            />
            <app-selector
              [formControl]="paymentForm.controls.method_id"
              label="Medio de pago"
              placeholder="Elige el medio"
              [options]="methodOptions()"
            />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              variant="primary"
              size="sm"
              [loading]="busy()"
              [disabled]="paymentStatus() !== 'VALID'"
              (clicked)="savePayment()"
              data-testid="folio-payment-save"
            >
              Registrar pago
            </app-button>
          </div>
        </form>
      }

      @if (action() === 'void') {
        <div class="space-y-2 border-t border-border px-3 py-3" data-testid="folio-void-form">
          <p class="font-medium">Anular «{{ voidTarget()?.description }}»</p>
          <app-textarea
            [formControl]="voidReason"
            label="Motivo de la anulación"
            [required]="true"
            [rows]="2"
            placeholder="Ej.: cargo digitado dos veces"
          />
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              variant="danger"
              size="sm"
              [loading]="busy()"
              [disabled]="voidStatus() !== 'VALID'"
              (clicked)="saveVoid()"
              data-testid="folio-void-save"
            >
              Anular cargo
            </app-button>
          </div>
        </div>
      }
    </div>

    <app-folio-split-modal
      [open]="splitOpen()"
      [reservationId]="reservationId()"
      [lines]="folio()?.lines ?? []"
      [holder]="holder()"
      (closed)="splitOpen.set(false)"
      (split)="onSplitCreated()"
    />
  `,
})
export class FolioPanelComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly productsService = inject(ProductsService);
  private readonly paymentMethods = inject(PaymentMethodsCatalogService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservationId = input.required<number>();
  /** The reservation is in house: the folio takes charges and payments. */
  readonly inHouse = input<boolean>(false);
  /** Reservation holder: default customer of the second split account. */
  readonly holder = input<{ id: number; name: string } | null>(null);
  /** Bump to re-fetch (e.g. after a deposit was collected). */
  readonly refreshKey = input<number>(0);
  /** Emitted after every change so the detail refreshes its summary. */
  readonly changed = output<void>();

  readonly folio = signal<FolioDetail | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly action = signal<Action>(null);
  readonly voidTarget = signal<FolioLine | null>(null);
  private readonly products = signal<Product[]>([]);
  readonly methodOptions = signal<SelectorOption[]>([]);
  /** H3.8 — split of the folio, or null while it is a single account. */
  readonly split = signal<SplitResult | null>(null);
  readonly splitOpen = signal(false);
  readonly confirmingUndo = signal(false);
  readonly payTarget = signal<SplitAccount | null>(null);
  protected readonly Number = Number;
  private paymentRequestId = newRequestId();

  readonly chargeForm = new FormGroup({
    product_id: new FormControl<number | null>(null, Validators.required),
    quantity: new FormControl<number>(1, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    unit_price: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
  });
  readonly paymentForm = new FormGroup({
    amount: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    method_id: new FormControl<number | null>(null, Validators.required),
  });
  readonly voidReason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(3)],
  });

  readonly chargeStatus = toSignal(this.chargeForm.statusChanges.pipe(startWith(this.chargeForm.status)), {
    initialValue: this.chargeForm.status,
  });
  readonly paymentStatus = toSignal(this.paymentForm.statusChanges.pipe(startWith(this.paymentForm.status)), {
    initialValue: this.paymentForm.status,
  });
  readonly voidStatus = toSignal(this.voidReason.statusChanges.pipe(startWith(this.voidReason.status)), {
    initialValue: this.voidReason.status,
  });

  readonly editable = computed(() => this.inHouse() && this.folio()?.status === 'open');
  /** "Dividir": open folio, single account, nothing paid, at least two active lines. */
  readonly canSplit = computed(() => {
    const f = this.folio();
    return (
      f !== null &&
      f.status === 'open' &&
      this.split() === null &&
      Number(f.paid) === 0 &&
      f.lines.filter((l) => !l.cancelled_at).length >= 2
    );
  });
  readonly statusLabel = computed(() => {
    const status = this.folio()?.status;
    return status ? FOLIO_STATUS_LABELS[status] : '';
  });
  /** Only products the folio can take: services or items without inventory. */
  readonly productOptions = computed<SelectorOption[]>(() =>
    this.products()
      .filter((p) => p.product_type === 'service' || !p.track_inventory)
      .map((p) => ({ value: p.id, label: p.name, description: this.money(this.catalogPrice(p)) })),
  );

  constructor() {
    effect(() => {
      const id = this.reservationId();
      this.refreshKey();
      untracked(() => this.load(id));
    });
  }

  money(amount: number | string): string {
    return this.currency.format(Number(amount), 0);
  }

  load(id: number = this.reservationId()): void {
    this.loading.set(this.folio() === null);
    this.reservationsService
      .getFolio(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.folio.set(folio);
          this.loading.set(false);
        },
        error: (message: string) => {
          this.loading.set(false);
          this.toastService.error(message);
        },
      });
    this.loadSplit(id);
  }

  private loadSplit(id: number): void {
    this.reservationsService
      .getFolioSplit(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (split) => this.split.set(split),
        error: (message: string) => this.toastService.error(message),
      });
  }

  paymentStateLabel(state: string): string {
    return PAYMENT_STATE_LABELS[state] ?? state;
  }

  /** The split exists: close the modal and reload folio and accounts. */
  onSplitCreated(): void {
    this.splitOpen.set(false);
    this.load();
    this.changed.emit();
  }

  undoSplit(): void {
    const split = this.split();
    if (!split) return;
    this.busy.set(true);
    this.reservationsService
      .cancelFolioSplit(this.reservationId(), split.source_version)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.split.set(null);
          this.confirmingUndo.set(false);
          this.applied(folio);
          this.toastService.success('División quitada');
        },
        error: (message: string) => this.failed(message),
      });
  }

  startSplitPay(account: SplitAccount): void {
    this.paymentRequestId = newRequestId();
    this.payTarget.set(account);
    this.paymentForm.reset({ amount: Number(account.remaining_balance), method_id: null });
    this.action.set('splitPay');
    this.loadMethods();
  }

  saveSplitPayment(): void {
    const account = this.payTarget();
    if (!account) return;
    const value = this.paymentForm.getRawValue();
    this.busy.set(true);
    this.reservationsService
      .payFolioSplitAccount(this.reservationId(), account.id, {
        amount: Number(value.amount),
        store_payment_method_id: Number(value.method_id),
        request_id: this.paymentRequestId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (split) => {
          this.split.set(split);
          this.busy.set(false);
          this.cancelAction();
          this.load();
          this.changed.emit();
          this.toastService.success('Pago registrado');
        },
        error: (message: string) => this.failed(message),
      });
  }

  downloadAccountInvoice(account: SplitAccount): void {
    this.busy.set(true);
    this.reservationsService
      .getFolioInvoicePdf(this.reservationId(), account.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.busy.set(false);
          globalThis.open?.(url, '_blank', 'noopener');
        },
        error: (message: string) => this.failed(message),
      });
  }

  postNights(): void {
    this.busy.set(true);
    this.reservationsService
      .postFolioNights(this.reservationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ folio, message }) => {
          this.applied(folio);
          this.toastService.success(message);
        },
        error: (message: string) => this.failed(message),
      });
  }

  /** H3.7 / D11 — review before the invoice (needs "Verificar el folio"). */
  verify(): void {
    this.busy.set(true);
    this.reservationsService
      .verifyFolio(this.reservationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.applied(folio);
          this.toastService.success('Folio verificado');
        },
        error: (message: string) => this.failed(message),
      });
  }

  /** H3.7 — PDF of the folio invoice once checked out. */
  downloadInvoice(): void {
    this.busy.set(true);
    this.reservationsService
      .getFolioInvoicePdf(this.reservationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.busy.set(false);
          globalThis.open?.(url, '_blank', 'noopener');
        },
        error: (message: string) => this.failed(message),
      });
  }

  /** H3.6 — "Cargos bloqueados" on or off for the POS and the tables. */
  toggleChargesBlocked(): void {
    const blocked = !this.folio()?.charges_blocked;
    this.busy.set(true);
    this.reservationsService
      .setFolioChargesBlocked(this.reservationId(), blocked)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.applied(folio);
          this.toastService.success(blocked ? 'Cargos bloqueados' : 'Cargos permitidos');
        },
        error: (message: string) => this.failed(message),
      });
  }

  /** H3.5 — moves the held deposit onto the folio ("Anticipo aplicado"). */
  applyDeposit(): void {
    this.busy.set(true);
    this.reservationsService
      .applyFolioDeposit(this.reservationId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ folio, message }) => {
          this.applied(folio);
          this.toastService.success(message);
        },
        error: (message: string) => this.failed(message),
      });
  }

  startCharge(): void {
    this.chargeForm.reset({ product_id: null, quantity: 1, unit_price: null });
    this.action.set('charge');
    if (this.products().length > 0) return;
    this.productsService
      .getProducts({ limit: 100, state: 'active' as Product['state'], is_sellable: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => this.products.set(page.data ?? []),
        error: () => this.toastService.error('No se pudieron cargar los productos'),
      });
  }

  onProductPicked(): void {
    const product = this.products().find((p) => p.id === Number(this.chargeForm.controls.product_id.value));
    if (product) this.chargeForm.controls.unit_price.setValue(this.catalogPrice(product));
  }

  saveCharge(): void {
    const value = this.chargeForm.getRawValue();
    const product = this.products().find((p) => p.id === Number(value.product_id));
    if (!product) return;
    const unitPrice = Number(value.unit_price);
    this.busy.set(true);
    this.reservationsService
      .addFolioCharge(this.reservationId(), {
        product_id: product.id,
        quantity: Math.trunc(Number(value.quantity)),
        ...(unitPrice !== this.catalogPrice(product) ? { unit_price: unitPrice } : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.applied(folio);
          this.toastService.success('Cargo agregado');
        },
        error: (message: string) => this.failed(message),
      });
  }

  startPayment(): void {
    this.paymentRequestId = newRequestId();
    this.paymentForm.reset({ amount: null, method_id: null });
    this.action.set('payment');
    this.loadMethods();
  }

  private loadMethods(): void {
    if (this.methodOptions().length > 0) return;
    this.paymentMethods
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) =>
        this.methodOptions.set(
          methods
            .filter((m) => m.enabled && MANUAL_METHODS.includes(m.type) && Number.isInteger(Number(m.id)))
            .map((m) => ({ value: Number(m.id), label: m.displayName || m.name })),
        ),
      );
  }

  savePayment(): void {
    const value = this.paymentForm.getRawValue();
    this.busy.set(true);
    this.reservationsService
      .registerFolioPayment(this.reservationId(), {
        amount: Number(value.amount),
        store_payment_method_id: Number(value.method_id),
        request_id: this.paymentRequestId,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.applied(folio);
          this.toastService.success('Pago registrado');
        },
        error: (message: string) => this.failed(message),
      });
  }

  startVoid(line: FolioLine): void {
    this.voidReason.reset('');
    this.voidTarget.set(line);
    this.action.set('void');
  }

  saveVoid(): void {
    const line = this.voidTarget();
    if (!line) return;
    this.busy.set(true);
    this.reservationsService
      .voidFolioCharge(this.reservationId(), line.id, this.voidReason.value.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.applied(folio);
          this.toastService.success('Cargo anulado');
        },
        error: (message: string) => this.failed(message),
      });
  }

  cancelAction(): void {
    this.action.set(null);
    this.voidTarget.set(null);
    this.payTarget.set(null);
  }

  private applied(folio: FolioDetail): void {
    this.folio.set(folio);
    this.busy.set(false);
    this.cancelAction();
    this.changed.emit();
  }

  private failed(message: string): void {
    this.busy.set(false);
    this.toastService.error(message);
  }

  /** Catalog unit price, the same ladder the POS uses (sale price first). */
  private catalogPrice(product: Product): number {
    const sale = product.is_on_sale ? Number(product.sale_price ?? 0) : 0;
    return sale > 0 ? sale : Number(product.base_price ?? 0);
  }
}
