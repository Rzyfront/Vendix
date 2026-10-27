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
import { FolioDetail, FolioLine } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

type Action = 'charge' | 'payment' | 'void' | null;

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
          </div>
        }
      </div>

      @if (loading()) {
        <p class="px-3 py-2 text-xs text-text-secondary">Cargando folio…</p>
      } @else if (folio(); as f) {
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
                @if (editable() && !line.cancelled_at && !action()) {
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
            <li class="flex items-center justify-between gap-2 px-3 py-2" data-testid="folio-payment">
              <p class="font-medium">Pago · {{ payment.method }}</p>
              <span class="whitespace-nowrap font-medium text-success">− {{ money(payment.amount) }}</span>
            </li>
          }
        </ul>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border px-3 py-2">
          <dt class="text-text-secondary">Total</dt>
          <dd class="text-right">{{ money(f.total) }}</dd>
          <dt class="text-text-secondary">Pagado</dt>
          <dd class="text-right">{{ money(f.paid) }}</dd>
          <dt class="font-semibold text-text-primary">Saldo</dt>
          <dd class="text-right font-semibold" data-testid="folio-balance">{{ money(f.balance) }}</dd>
        </dl>
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
  /** Emitted after every change so the detail refreshes its summary. */
  readonly changed = output<void>();

  readonly folio = signal<FolioDetail | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly action = signal<Action>(null);
  readonly voidTarget = signal<FolioLine | null>(null);
  private readonly products = signal<Product[]>([]);
  readonly methodOptions = signal<SelectorOption[]>([]);
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
