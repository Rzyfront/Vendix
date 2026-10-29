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
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  ToastService,
  ToggleComponent,
  DialogService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { ProductsService } from '../../../../products/services/products.service';
import { Product } from '../../../../products/interfaces/product.interface';
import { FOLIO_STATUS_LABELS } from '../../interfaces/reservation.interface';
import { FolioDetail, FolioLine, SplitAccount, SplitResult } from '../../interfaces/folio.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { vatExemptionReasonLabel } from '../../../shared/hospitality-labels';
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
    NgTemplateOutlet,
    RouterLink,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    ToggleComponent,
    FolioSplitModalComponent,
  ],
  template: `
    <!-- R-FB-02 / R-EMPTY: the payment method picker never stays silently empty. -->
    <ng-template #methodPicker>
      @if (methodsState() === 'loading') {
        <p class="text-xs text-text-secondary sm:self-end" role="status">Cargando medios de pago…</p>
      } @else if (methodsState() === 'error') {
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/40 px-3 py-2" role="alert" data-testid="folio-methods-error">
          <span class="text-xs text-error">No pudimos cargar los medios de pago.</span>
          <app-button variant="outline" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="loadMethods(true)">
            <app-icon slot="icon" name="refresh-cw" [size]="14" />
            Reintentar
          </app-button>
        </div>
      } @else if (methodOptions().length === 0) {
        <div class="rounded-lg border border-border px-3 py-2" data-testid="folio-no-methods">
          <p class="text-xs text-text-secondary">No hay medios de pago para cobrar en recepción.</p>
          <a class="text-sm font-medium text-primary underline" routerLink="/admin/settings/payments">Configura un medio de pago</a>
        </div>
      } @else {
        <app-selector
          [formControl]="paymentForm.controls.method_id"
          label="Medio de pago"
          placeholder="Elige el medio"
          [options]="methodOptions()"
        />
      }
    </ng-template>
    <div class="rounded-lg border border-border" data-testid="folio-panel">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p class="flex items-center gap-2 font-medium text-text-primary" data-testid="reservation-folio">
          <app-icon name="receipt" [size]="16" />
          Cuenta · {{ statusLabel() }} · {{ money(folio()?.total ?? 0) }}
        </p>
        @if (editable() && !action()) {
          <div class="flex flex-wrap gap-1">
            @if (canSplit()) {
              <app-button variant="outline" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="splitOpen.set(true)" data-testid="folio-split">
                <app-icon slot="icon" name="split" [size]="14" />
                Dividir cuenta
              </app-button>
            }
            @if (!split()) {
            <span [attr.title]="postNightsHint() || null">
              <app-button
                variant="outline"
                size="sm"
                customClasses="min-h-11 sm:min-h-0"
                [loading]="busy()"
                [disabled]="!folio()?.pending_nights"
                (clicked)="postNights()"
                data-testid="folio-post-nights"
              >
                <app-icon slot="icon" name="moon" [size]="14" />
                Cargar noche
              </app-button>
            </span>
            <app-button variant="outline" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="startCharge()" data-testid="folio-add-charge">
              <app-icon slot="icon" name="plus" [size]="14" />
              Agregar cargo
            </app-button>
            @if ((folio()?.deposit_available ?? 0) > 0) {
              <app-button
                variant="outline"
                size="sm"
                customClasses="min-h-11 sm:min-h-0"
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
              customClasses="min-h-11 sm:min-h-0"
              [disabled]="!due()"
              (clicked)="startPayment()"
              data-testid="folio-add-payment"
            >
              <app-icon slot="icon" name="banknote" [size]="14" />
              Registrar pago
            </app-button>
            <app-button
              variant="ghost"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
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
                customClasses="min-h-11 sm:min-h-0"
                [loading]="busy()"
                (clicked)="verify()"
                data-testid="folio-verify"
              >
                <app-icon slot="icon" name="shield-check" [size]="14" />
                Verificar cuenta
              </app-button>
            }
          </div>
        }
        @if (folio()?.status === 'closed') {
          <app-button
            variant="outline"
            size="sm"
            customClasses="min-h-11 sm:min-h-0"
            [loading]="busy()"
            (clicked)="downloadInvoice()"
            data-testid="folio-invoice-pdf"
          >
            <app-icon slot="icon" name="download" [size]="14" />
            Descargar factura
          </app-button>
        }
      </div>
      @if (editable() && !action() && !split() && postNightsHint()) {
        <p class="border-b border-border px-3 py-1.5 text-xs text-text-secondary" data-testid="folio-post-nights-hint">
          {{ postNightsHint() }}
        </p>
      }

      @if (loading()) {
        <p class="px-3 py-2 text-xs text-text-secondary">Cargando cuenta…</p>
      } @else if (folio(); as f) {
        @if (f.verified_current) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-success" data-testid="folio-verified">
            Cuenta verificada para facturar
          </p>
        }
        @if (split(); as sp) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-primary" data-testid="folio-split-banner">
            Cuenta dividida: cobra y factura cada parte por separado
          </p>
        }
        @if (f.charges_blocked) {
          <p class="border-b border-border px-3 py-2 text-xs font-medium text-error" data-testid="folio-charges-blocked-note">
            Cargos bloqueados: el POS y las mesas no pueden cargar a esta habitación.
          </p>
        }
        @if (f.vat_exemption; as vx) {
          <div class="space-y-1 border-b border-border px-3 py-2" data-testid="folio-vat-exemption">
            <app-toggle
              label="No residente: exento de IVA"
              styleVariant="classic"
              [checked]="vatPending() ?? vx.applied"
              [disabled]="!editable() || !!split() || busy() || (!vx.applied && !vx.available)"
              (changed)="setVatExemption($event)"
              data-testid="folio-vat-exempt-box"
            />
            @if (vx.applied) {
              <p class="text-xs text-text-secondary">
                Las noches salen con IVA 0 % «Exento – art. 481 lit. d ET». Los consumos conservan su impuesto.
              </p>
            } @else if (!vx.available) {
              <ul class="list-disc pl-5 text-xs text-text-secondary" data-testid="folio-vat-exempt-reasons">
                @for (reason of vx.reasons; track reason) {
                  <li>{{ reasonLabel(reason) }}</li>
                }
              </ul>
            }
          </div>
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
                  @if (line.vat_exempt) {
                    <p class="text-xs font-medium text-primary" data-testid="folio-line-vat-exempt">
                      IVA 0 % · Exento – art. 481 lit. d ET
                    </p>
                  }
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
                    customClasses="min-h-11 sm:min-h-0"
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
          @if ((f.online_payment_available ?? 0) > 0) {
            <dt class="text-text-secondary">Pago en línea por aplicar</dt>
            <dd class="text-right" data-testid="folio-online-available">− {{ money(f.online_payment_available ?? 0) }}</dd>
          }
          <dt class="font-semibold text-text-primary">Saldo</dt>
          <dd class="text-right font-semibold" data-testid="folio-balance">{{ money(due()) }}</dd>
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
                <app-badge
                  size="sm"
                  [variant]="account.payment_state === 'paid' ? 'success' : account.payment_state === 'partial' ? 'warning' : 'neutral'"
                  data-testid="folio-split-state"
                >
                  {{ paymentStateLabel(account.payment_state) }}
                </app-badge>
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
                    customClasses="min-h-11 sm:min-h-0"
                    [loading]="busy()"
                    (clicked)="downloadAccountInvoice(account)"
                  >
                    <app-icon slot="icon" name="download" [size]="14" />
                    Descargar factura
                  </app-button>
                } @else if (editable() && Number(account.remaining_balance) > 0 && action() === null) {
                  <app-button variant="primary" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="startSplitPay(account)" data-testid="folio-split-pay">
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
                  <span class="text-xs">¿Volver a una sola cuenta?</span>
                  <app-button variant="ghost" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="confirmingUndo.set(false)">No</app-button>
                  <app-button variant="danger" size="sm" customClasses="min-h-11 sm:min-h-0" [loading]="busy()" (clicked)="undoSplit()">Sí, quitar</app-button>
                </div>
              } @else {
                <app-button
                  class="ml-auto"
                  variant="outline"
                  size="sm"
                  customClasses="min-h-11 sm:min-h-0"
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
        <form
          [formGroup]="paymentForm"
          class="space-y-2 border-t border-border px-3 py-3"
          data-testid="folio-split-pay-form"
          (ngSubmit)="saveSplitPayment()"
        >
          <p class="font-medium">Cobrar «{{ payTarget()?.label }}»</p>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <app-input
              [formControl]="paymentForm.controls.amount"
              [currency]="true"
              label="Monto"
              size="sm"
              [helperText]="'Saldo ' + money(payTarget()?.remaining_balance ?? 0)"
            />
            <ng-container [ngTemplateOutlet]="methodPicker" />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              type="submit"
              variant="primary"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
              [loading]="busy()"
              [disabled]="paymentStatus() !== 'VALID'"
              data-testid="folio-split-pay-save"
            >
              Cobrar {{ money(paymentAmount() ?? 0) }}{{ methodSuffix() }}
            </app-button>
          </div>
        </form>
      }

      @if (action() === 'charge') {
        <form
          [formGroup]="chargeForm"
          class="space-y-2 border-t border-border px-3 py-3"
          data-testid="folio-charge-form"
          (ngSubmit)="saveCharge()"
        >
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
              [currency]="true"
              label="Precio unitario"
              size="sm"
            />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              type="submit"
              variant="primary"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
              [loading]="busy()"
              [disabled]="chargeStatus() !== 'VALID'"
              data-testid="folio-charge-save"
            >
              Agregar cargo {{ money(chargeTotal()) }}
            </app-button>
          </div>
        </form>
      }

      @if (action() === 'payment') {
        <form
          [formGroup]="paymentForm"
          class="space-y-2 border-t border-border px-3 py-3"
          data-testid="folio-payment-form"
          (ngSubmit)="savePayment()"
        >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <app-input
              [formControl]="paymentForm.controls.amount"
              [currency]="true"
              label="Monto"
              size="sm"
              [helperText]="'Saldo ' + money(due())"
            />
            <ng-container [ngTemplateOutlet]="methodPicker" />
          </div>
          <div class="flex flex-wrap gap-2" data-testid="folio-payment-quick">
            @for (q of quickAmounts(); track q.label) {
              <app-button
                variant="outline"
                size="sm"
                customClasses="min-h-11 sm:min-h-0"
                (clicked)="paymentForm.controls.amount.setValue(q.amount)"
              >
                {{ q.label }} · {{ money(q.amount) }}
              </app-button>
            }
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              type="submit"
              variant="primary"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
              [loading]="busy()"
              [disabled]="paymentStatus() !== 'VALID'"
              data-testid="folio-payment-save"
            >
              Registrar pago {{ money(paymentAmount() ?? 0) }}{{ methodSuffix() }}
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
            <app-button variant="ghost" size="sm" customClasses="min-h-11 sm:min-h-0" (clicked)="cancelAction()">Volver</app-button>
            <app-button
              variant="danger"
              size="sm"
              customClasses="min-h-11 sm:min-h-0"
              [loading]="busy()"
              [disabled]="voidStatus() !== 'VALID'"
              (clicked)="saveVoid()"
              data-testid="folio-void-save"
            >
              Anular cargo {{ money(voidTarget()?.total ?? 0) }}
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
  private readonly dialogService = inject(DialogService);
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
  /** U2 — balance still to collect, each time the folio loads (detail summary). */
  readonly dueChange = output<number>();

  readonly folio = signal<FolioDetail | null>(null);
  /** VAT-exemption value the desk just toggled, until the server answers. */
  readonly vatPending = signal<boolean | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly action = signal<Action>(null);
  readonly voidTarget = signal<FolioLine | null>(null);
  private readonly products = signal<Product[]>([]);
  readonly methodOptions = signal<SelectorOption[]>([]);
  readonly methodsState = signal<'loading' | 'ready' | 'error'>('loading');
  /** Id of the store's cash method, the default of R-FORM-07. */
  private cashMethodId: number | null = null;
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
  /** U3 (R-FORM-10) — amount the pay button carries ("Registrar pago $280.000"). */
  readonly paymentAmount = toSignal(this.paymentForm.controls.amount.valueChanges, {
    initialValue: this.paymentForm.controls.amount.value,
  });
  private readonly paymentMethodId = toSignal(this.paymentForm.controls.method_id.valueChanges, {
    initialValue: this.paymentForm.controls.method_id.value,
  });
  /** " · Efectivo" on the pay button once a method is picked. */
  readonly methodSuffix = computed(() => {
    const id = this.paymentMethodId();
    const option = this.methodOptions().find((o) => Number(o.value) === id);
    return option ? ` · ${option.label}` : '';
  });
  private readonly chargeValue = toSignal(this.chargeForm.valueChanges, {
    initialValue: this.chargeForm.getRawValue(),
  });
  /** Quantity × unit price of the charge being added. */
  readonly chargeTotal = computed(() => {
    const value = this.chargeValue();
    return Math.max(0, Math.trunc(Number(value.quantity ?? 0))) * Number(value.unit_price ?? 0);
  });
  readonly voidStatus = toSignal(this.voidReason.statusChanges.pipe(startWith(this.voidReason.status)), {
    initialValue: this.voidReason.status,
  });

  readonly editable = computed(() => this.inHouse() && this.folio()?.status === 'open');
  /** H6.6 — balance left after the online payment, which any desk payment applies first. */
  readonly due = computed(() => {
    const f = this.folio();
    return f ? Math.max(0, f.balance - (f.online_payment_available ?? 0)) : 0;
  });
  /** U2 (R-CTA-06) — why "Cargar noche" is disabled. */
  readonly postNightsHint = computed(() =>
    this.folio() && !this.folio()!.pending_nights
      ? 'Las noches hasta hoy ya están cargadas; la siguiente se carga mañana.'
      : '',
  );
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
  /** U3 (R-FORM-08) — quick amounts of the payment: the whole balance and half of it. */
  readonly quickAmounts = computed(() => {
    const due = this.due();
    if (due <= 0) return [];
    const half = Math.round(due / 2);
    return [
      { label: 'Saldo total', amount: due },
      ...(half > 0 && half < due ? [{ label: '50 %', amount: half }] : []),
    ];
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
    effect(() => {
      if (this.folio()) this.dueChange.emit(this.due());
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

  reasonLabel(reason: string): string {
    return vatExemptionReasonLabel(reason);
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
    if (!account || this.busy() || this.paymentForm.invalid) return;
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
          this.toastService.success('Cuenta verificada');
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
  async toggleChargesBlocked(): Promise<void> {
    const blocked = !this.folio()?.charges_blocked;
    if (
      blocked &&
      !(await this.dialogService.confirm({
        title: 'Bloquear cargos',
        message:
          `El POS y las mesas no podrán cargar consumos a esta habitación. ` +
          `La cuenta queda en ${this.money(this.folio()?.total ?? 0)} con saldo de ${this.money(this.due())}.`,
        confirmText: 'Bloquear cargos',
      }))
    ) {
      return;
    }
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

  /**
   * H3.9 — "No residente – exento de IVA": the nights are re-priced at VAT 0 %
   * (or back to their IVA). The total changes, so the D11 review asks again.
   */
  async setVatExemption(enabled: boolean): Promise<void> {
    this.vatPending.set(enabled);
    if (!(await this.dialogService.confirm(this.vatExemptionConfirm(enabled)))) {
      // Dropping the pending value moves the toggle back to the saved state.
      this.vatPending.set(null);
      return;
    }
    this.busy.set(true);
    this.reservationsService
      .setFolioVatExemption(this.reservationId(), enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (folio) => {
          this.vatPending.set(null);
          this.applied(folio);
          this.toastService.success(enabled ? 'Exención de IVA aplicada a las noches' : 'Exención de IVA quitada');
        },
        error: (message: string) => {
          // Dropping the pending value moves the toggle back to the saved state.
          this.vatPending.set(null);
          this.failed(message);
        },
      });
  }

  /** U3 (R-CONF-01) — what the exemption does to the nights, in figures. */
  private vatExemptionConfirm(enabled: boolean): { title: string; message: string; confirmText: string } {
    const nights = (this.folio()?.lines ?? []).filter((l) => l.kind === 'night' && !l.cancelled_at);
    const reverify = this.folio()?.verified_current ? ' Habrá que verificar la cuenta otra vez.' : '';
    if (enabled) {
      const taxed = nights.filter((l) => !l.vat_exempt);
      const vat = taxed.reduce((sum, l) => sum + Number(l.tax_amount), 0);
      return {
        title: 'Aplicar exención de IVA',
        message:
          `Las noches salen con IVA 0 % (art. 481 lit. d ET). ` +
          (vat > 0
            ? `El total baja ${this.money(vat)}, el IVA de ${this.nightsLabel(taxed.length)}; `
            : 'Las noches ya cargadas no llevan IVA, así que el total no cambia ahora; ') +
          `las próximas noches también salen sin IVA. Los consumos conservan su impuesto.${reverify}`,
        confirmText: 'Aplicar exención',
      };
    }
    const exempt = nights.filter((l) => l.vat_exempt);
    const base = exempt.reduce((sum, l) => sum + Number(l.subtotal), 0);
    const subject = exempt.length === 1 ? 'La noche exenta vuelve' : `Las ${exempt.length} noches exentas vuelven`;
    return {
      title: 'Quitar exención de IVA',
      message: `${subject} a cobrar su IVA sobre ${this.money(base)} y el total sube.${reverify}`,
      confirmText: 'Quitar exención',
    };
  }

  private nightsLabel(count: number): string {
    return count === 1 ? '1 noche ya cargada' : `${count} noches ya cargadas`;
  }

  /** H3.5 — moves the held deposit onto the folio ("Anticipo aplicado"). */
  async applyDeposit(): Promise<void> {
    const folio = this.folio();
    if (!folio || this.busy()) return;
    // The held deposit up to the open balance; the backend may apply less when
    // the holder's wallet has less available, hence "hasta".
    const balance = Math.max(0, Number(folio.balance));
    const amount = Math.min(Number(folio.deposit_available ?? 0), balance);
    const online = Number(folio.online_payment_available ?? 0);
    const after = balance - amount;
    const excess = Math.max(0, online - after);
    const confirmed = await this.dialogService.confirm({
      title: 'Aplicar anticipo',
      message:
        `Se aplicarán hasta ${this.money(amount)} del anticipo; la cuenta queda con ${this.money(after)} por cubrir.` +
        (excess > 0 ? ` El pago en línea por aplicar deja ${this.money(excess)} de excedente por devolver.` : ''),
      confirmText: `Aplicar ${this.money(amount)}`,
    });
    if (!confirmed) return;
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
    if (this.busy() || this.chargeForm.invalid) return;
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
    this.paymentForm.reset({ amount: this.due() > 0 ? this.due() : null, method_id: null });
    this.action.set('payment');
    this.loadMethods();
  }

  loadMethods(force = false): void {
    if (!force && this.methodsState() === 'ready') {
      this.preselectMethod();
      return;
    }
    this.methodsState.set('loading');
    this.paymentMethods
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => {
          const fromStore = methods.filter((m) => Number.isInteger(Number(m.id)));
          // The catalog's offline fallback carries text ids: not a real empty list.
          if (methods.length > 0 && fromStore.length === 0) {
            this.methodsState.set('error');
            return;
          }
          const manual = fromStore.filter((m) => m.enabled && MANUAL_METHODS.includes(m.type));
          const cash = manual.find((m) => m.type === 'cash');
          this.cashMethodId = cash ? Number(cash.id) : null;
          this.methodOptions.set(manual.map((m) => ({ value: Number(m.id), label: m.displayName || m.name })));
          this.methodsState.set('ready');
          this.preselectMethod();
        },
        error: () => this.methodsState.set('error'),
      });
  }

  /**
   * R-FORM-07 — cash comes picked (or the only method), never an arbitrary
   * first one; the button names the method so Enter can't charge the wrong one.
   */
  private preselectMethod(): void {
    const control = this.paymentForm.controls.method_id;
    if (control.value !== null) return;
    const options = this.methodOptions();
    const id = this.cashMethodId ?? (options.length === 1 ? Number(options[0].value) : null);
    if (id !== null) control.setValue(id);
  }

  savePayment(): void {
    if (this.busy() || this.paymentForm.invalid) return;
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
