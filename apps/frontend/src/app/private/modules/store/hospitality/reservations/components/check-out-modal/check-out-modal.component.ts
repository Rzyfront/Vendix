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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  ToastService,
  ToggleComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import { PosCustomer } from '../../../../pos/models/customer.model';
import { CheckOutResult, FolioDetail, SplitAccountInvoice, SplitResult } from '../../interfaces/folio.interface';
import { LodgingReservation } from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';
import { invoiceStateLabel } from '../../../shared/hospitality-labels';
import { HospitalityLoadErrorComponent } from '../../../shared/load-error.component';

/** Methods the desk registers by hand; gateways settle themselves. */
const MANUAL_METHODS = ['cash', 'card', 'bank_transfer'];

type BillTo = 'guest' | 'company';

/** U4 (R-FB-02) — where the payment methods stand; a failure is never an empty list. */
type MethodsState = 'loading' | 'ready' | 'error';

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hospitality Suite (H3.7) — check-out: review the guest account, pay the
 * balance (or charge it to the company's credit), pick who is invoiced and
 * confirm. The result shows the electronic invoice ("Factura FE-xxxx aceptada
 * por la DIAN") with its PDF. Confirming again with the same attempt never
 * emits a second invoice: it only retries the same one.
 *
 * U4 — a failed load of the account or of the payment methods shows its error
 * with "Reintentar" and keeps the confirm button disabled (R-MOD-05, R-FB-02).
 */
@Component({
  selector: 'app-check-out-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
    PosCustomerSelectorComponent,
    SpinnerComponent,
    RouterLink,
    HospitalityLoadErrorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="reservation() !== null"
      (isOpenChange)="!$event && close()"
      title="Check-out"
      [subtitle]="subtitle()"
      size="md"
      [fullScreenOnMobile]="true"
    >
      @if (loading()) {
        <app-spinner [center]="true" text="Cargando la cuenta…" />
      } @else if (loadError() !== null) {
        <div data-testid="check-out-load-error">
          <app-hospitality-load-error what="la cuenta" [message]="loadError()" (retry)="retryLoad()" />
        </div>
      } @else if (result(); as r) {
        <div class="space-y-3 text-sm" data-testid="check-out-result">
          <p class="flex items-center gap-2 font-medium text-success">
            <app-icon name="log-out" [size]="16" />
            Salida registrada · cuenta cerrada · habitación sucia
          </p>
          @if (r.invoices; as list) {
            @for (row of list; track row.account_id) {
              <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2" data-testid="check-out-split-invoice">
                <div>
                  <p class="font-medium text-text-primary">{{ row.label }} · {{ money(Number(row.grand_total)) }}</p>
                  <p class="text-xs text-text-secondary">
                    {{ row.invoice_number ? 'Factura ' + row.invoice_number : 'Factura electrónica' }}{{ row.status ? ' · ' + invoiceStateLabel(row.status) : '' }}
                  </p>
                </div>
                @if (row.invoice_id) {
                  <app-button variant="outline" size="sm" [loading]="busy()" (clicked)="downloadPdf(row)">
                    <app-icon slot="icon" name="download" [size]="14" />
                    Descargar PDF
                  </app-button>
                }
              </div>
            }
          } @else if (r.invoice; as inv) {
            <div class="rounded-lg border border-border px-3 py-2" data-testid="check-out-invoice">
              @if (inv.state === 'issued') {
                <p class="font-medium text-text-primary">Factura {{ inv.invoice_number }} {{ invoiceStateLabel('issued') }}</p>
              } @else {
                <p class="font-medium text-text-primary">
                  {{ inv.invoice_number ? 'Factura ' + inv.invoice_number : 'Factura electrónica' }}
                </p>
                <p class="text-xs text-text-secondary">{{ inv.message }}</p>
              }
            </div>
          } @else {
            <p class="text-xs text-text-secondary">No se pudo consultar la factura: vuelve a intentarlo.</p>
          }
        </div>
      } @else if (folio(); as f) {
        <div class="space-y-4 text-sm">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2">
            <dt class="text-text-secondary">Total de la cuenta</dt>
            <dd class="text-right">{{ money(f.total) }}</dd>
            <dt class="text-text-secondary">Pagado</dt>
            <dd class="text-right">{{ money(f.paid) }}</dd>
            @if ((f.online_payment_available ?? 0) > 0) {
              <dt class="text-text-secondary">Pago en línea por aplicar</dt>
              <dd class="text-right" data-testid="check-out-online-available">− {{ money(f.online_payment_available ?? 0) }}</dd>
            }
            @if ((f.deposit_available ?? 0) > 0) {
              <dt class="text-text-secondary">Anticipo por aplicar</dt>
              <dd class="text-right">− {{ money(f.deposit_available ?? 0) }}</dd>
            }
            <dt class="font-semibold text-text-primary">Saldo a cobrar</dt>
            <dd class="text-right font-semibold" data-testid="check-out-balance">{{ money(due()) }}</dd>
          </dl>
          @if (f.pending_nights > 0) {
            <p class="text-xs text-text-secondary">Las noches ya dormidas que falten se cargan al confirmar.</p>
          }

          @if (split(); as sp) {
            <div class="space-y-2" data-testid="check-out-split">
              <p class="font-medium text-text-primary">Cuenta dividida</p>
              @for (a of sp.accounts; track a.id) {
                <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span>{{ a.label }} · {{ money(Number(a.grand_total)) }}</span>
                  <span class="text-xs" [class.text-success]="a.payment_state === 'paid'" [class.text-error]="a.payment_state !== 'paid'">
                    {{ a.payment_state === 'paid' ? 'Pagada' : 'Saldo ' + money(Number(a.remaining_balance)) }}
                  </span>
                </div>
              }
              @if (!allPaid()) {
                <p class="text-xs text-error" data-testid="check-out-split-unpaid">Cobra cada cuenta antes del check-out</p>
              }
            </div>
          }

          <div class="space-y-1">
            @if (f.verified_current) {
              <p class="flex items-center gap-1 font-medium text-success" data-testid="check-out-verified">
                <app-icon name="check-circle" [size]="14" />
                Cuenta verificada
              </p>
            } @else {
              <app-toggle
                [checked]="verifyNow()"
                label="Verifico la cuenta ahora"
                (changed)="verifyNow.set($event)"
              />
              <p class="text-xs text-text-secondary">
                {{ f.verified_at ? 'La cuenta cambió después de verificarla.' : 'Aún no está verificada.' }}
                La verifica un usuario con permiso para verificar la cuenta (folio) antes de facturar.
              </p>
            }
          </div>

          @if (!split()) {
          <div class="space-y-2">
            <p class="font-medium text-text-primary">Facturar a</p>
            <div class="flex flex-wrap gap-2">
              <app-button
                [variant]="billTo() === 'guest' ? 'primary' : 'outline'"
                size="sm"
                (clicked)="setBillTo('guest')"
                data-testid="check-out-bill-guest"
              >
                <app-icon slot="icon" name="user" [size]="14" />
                {{ holderName() }}
              </app-button>
              <app-button
                [variant]="billTo() === 'company' ? 'primary' : 'outline'"
                size="sm"
                (clicked)="setBillTo('company')"
                data-testid="check-out-bill-company"
              >
                <app-icon slot="icon" name="building-2" [size]="14" />
                Empresa (NIT)
              </app-button>
            </div>
            @if (billTo() === 'company') {
              @if (company(); as c) {
                <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span>{{ companyLabel(c) }}</span>
                  <app-button variant="ghost" size="sm" (clicked)="company.set(null)">Cambiar</app-button>
                </div>
              } @else {
                <app-pos-customer-selector (customerSelected)="company.set($event)" />
              }
            }
          </div>

          }

          @if (!split() && due() > 0) {
            <div class="space-y-2">
              @if (billTo() === 'company') {
                <app-toggle
                  [checked]="chargeToCredit()"
                  label="Cargar a crédito de la empresa"
                  (changed)="chargeToCredit.set($event)"
                />
              }
              @if (!chargeToCredit() || billTo() !== 'company') {
                @if (methodsState() === 'loading') {
                  <p class="text-xs text-text-secondary" role="status">Cargando medios de pago…</p>
                } @else if (methodsState() === 'error') {
                  <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/40 px-3 py-2" role="alert" data-testid="check-out-methods-error">
                    <span class="text-xs text-error">No pudimos cargar los medios de pago.</span>
                    <app-button variant="outline" size="sm" (clicked)="loadMethods()">
                      <app-icon slot="icon" name="refresh-cw" [size]="14" />
                      Reintentar
                    </app-button>
                  </div>
                } @else if (methodOptions().length === 0) {
                  <div class="rounded-lg border border-border px-3 py-2" data-testid="check-out-no-methods">
                    <p class="text-xs text-text-secondary">No hay medios de pago para cobrar el saldo en recepción.</p>
                    <a class="text-sm font-medium text-primary underline" routerLink="/admin/settings/payments">Configura un medio de pago</a>
                  </div>
                } @else {
                <app-selector
                  label="Cobrar el saldo con"
                  placeholder="Elige el medio"
                  [options]="methodOptions()"
                  [value]="methodId()"
                  (valueChange)="methodId.set($event === null ? null : Number($event))"
                />
                }
              } @else {
                <p class="text-xs text-text-secondary">El saldo pasa a cuentas por cobrar de la empresa.</p>
              }
            </div>
          }
        </div>
      }

      <div
        slot="footer"
        class="flex flex-col-reverse gap-2 pb-[env(safe-area-inset-bottom)] sm:flex-row sm:flex-wrap sm:justify-end"
      >
        @if (result(); as r) {
          @if (!r.invoices && (r.invoice?.state === 'failed' || r.invoice === null)) {
            <app-button variant="outline" customClasses="w-full min-h-11 sm:w-auto sm:min-h-0" [loading]="busy()" (clicked)="confirm()">Reintentar factura</app-button>
          }
          @if (!r.invoices && r.invoice?.invoice_id) {
            <app-button variant="outline" customClasses="w-full min-h-11 sm:w-auto sm:min-h-0" [loading]="busy()" (clicked)="downloadPdf()" data-testid="check-out-pdf">
              <app-icon slot="icon" name="download" [size]="14" />
              Descargar PDF
            </app-button>
          }
          <app-button variant="primary" class="w-full sm:w-auto" customClasses="w-full min-h-12 sm:min-h-0" (clicked)="close()">Listo</app-button>
        } @else {
          <app-button variant="ghost" customClasses="w-full min-h-11 sm:w-auto sm:min-h-0" (clicked)="close()">Volver</app-button>
          <app-button
            variant="primary"
            class="w-full sm:w-auto"
            customClasses="w-full min-h-12 sm:min-h-0"
            [loading]="busy()"
            [disabled]="!canConfirm()"
            (clicked)="confirm()"
            data-testid="check-out-confirm"
          >
            <app-icon slot="icon" name="log-out" [size]="16" />
            {{ confirmLabel() }}
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class CheckOutModalComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly paymentMethods = inject(PaymentMethodsCatalogService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Reservation in house to check out; `null` keeps the modal closed. */
  readonly reservation = input<LodgingReservation | null>(null);
  readonly closed = output<void>();
  /** Emitted once the reservation left, so the detail and lists refresh. */
  readonly checkedOut = output<void>();

  readonly folio = signal<FolioDetail | null>(null);
  /** H3.8 — accounts of a split folio; null while it is a single account. */
  readonly split = signal<SplitResult | null>(null);
  readonly result = signal<CheckOutResult | null>(null);
  readonly loading = signal(false);
  /** U4 — reason the account could not be loaded; null when it loaded. */
  readonly loadError = signal<string | null>(null);
  readonly methodsState = signal<MethodsState>('loading');
  readonly busy = signal(false);
  readonly verifyNow = signal(false);
  readonly billTo = signal<BillTo>('guest');
  readonly company = signal<PosCustomer | null>(null);
  readonly chargeToCredit = signal(false);
  readonly methodId = signal<number | null>(null);
  readonly methodOptions = signal<SelectorOption[]>([]);
  private requestId = newRequestId();
  readonly allPaid = computed(() => this.split()?.accounts.every((a) => a.payment_state === 'paid') ?? true);
  protected readonly Number = Number;
  protected readonly invoiceStateLabel = invoiceStateLabel;

  readonly subtitle = computed(() => {
    const r = this.reservation();
    return r ? `${r.reservation_number} · ${this.holderName()}` : '';
  });
  readonly holderName = computed(() => {
    const c = this.reservation()?.customer;
    return c ? `${c.first_name} ${c.last_name ?? ''}`.trim() : 'Huésped';
  });
  /**
   * Balance after the online reservation payment (H6.6) and the held
   * deposit, which the check-out applies first, in that order.
   */
  readonly due = computed(() => {
    const f = this.folio();
    return f
      ? Math.max(0, f.balance - (f.online_payment_available ?? 0) - (f.deposit_available ?? 0))
      : 0;
  });
  readonly credit = computed(() => this.billTo() === 'company' && this.chargeToCredit());
  readonly canConfirm = computed(() => {
    const f = this.folio();
    if (!f || this.busy()) return false;
    if (!f.verified_current && !this.verifyNow()) return false;
    if (this.split()) return this.allPaid();
    if (this.billTo() === 'company' && !this.company()) return false;
    return this.due() === 0 || this.credit() || this.methodId() !== null;
  });

  /** U4 (R-FORM-10) — verb + object, with the amount the desk collects. */
  readonly confirmLabel = computed(() => {
    const due = this.due();
    if (this.split() || due === 0) return 'Confirmar check-out';
    return this.credit()
      ? `Confirmar check-out · a crédito ${this.money(due)}`
      : `Confirmar check-out · cobrar ${this.money(due)}`;
  });

  /** Only a different reservation reopens it (a reload after the check-out does not). */
  private readonly reservationId = computed(() => this.reservation()?.id ?? null);

  constructor() {
    effect(() => {
      const id = this.reservationId();
      untracked(() => (id !== null ? this.open(id) : this.reset()));
    });
  }

  money(amount: number): string {
    return this.currency.format(Number(amount), 0);
  }

  companyLabel(c: PosCustomer): string {
    const name = c.legal_name || `${c.first_name} ${c.last_name ?? ''}`.trim();
    return c.document_number ? `${name} · ${c.document_type ?? ''} ${c.document_number}`.trim() : name;
  }

  setBillTo(value: BillTo): void {
    this.billTo.set(value);
    if (value === 'guest') {
      this.company.set(null);
      this.chargeToCredit.set(false);
    }
  }

  confirm(): void {
    const reservation = this.reservation();
    if (!reservation || this.busy()) return;
    const isSplit = this.split() !== null;
    const company = !isSplit && this.billTo() === 'company' ? this.company() : null;
    this.busy.set(true);
    this.reservationsService
      .checkOut(reservation.id, {
        request_id: this.requestId,
        ...(this.verifyNow() ? { verify: true } : {}),
        ...(company ? { bill_to_customer_id: Number(company.id) } : {}),
        // A split folio is collected per account: no payer, credit or method here.
        ...(isSplit
          ? {}
          : this.credit()
            ? { charge_to_credit: true }
            : this.methodId() !== null
              ? { store_payment_method_id: this.methodId()! }
              : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.busy.set(false);
          this.result.set(result);
          this.folio.set(result.folio);
          this.checkedOut.emit();
        },
        error: (message: string) => {
          this.busy.set(false);
          this.toastService.error(message);
        },
      });
  }

  downloadPdf(row?: SplitAccountInvoice): void {
    const reservation = this.reservation();
    if (!reservation) return;
    this.busy.set(true);
    this.reservationsService
      .getFolioInvoicePdf(reservation.id, row?.account_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (url) => {
          this.busy.set(false);
          globalThis.open?.(url, '_blank', 'noopener');
        },
        error: (message: string) => {
          this.busy.set(false);
          this.toastService.error(message);
        },
      });
  }

  close(): void {
    this.closed.emit();
  }

  retryLoad(): void {
    const id = this.reservationId();
    if (id !== null) this.open(id);
  }

  /**
   * The shared catalog answers a failed request with its offline fallback
   * (cash/card/transfer with text ids), which the desk cannot charge. That
   * list is reported as a load error, not as "no methods" (R-FB-02).
   */
  loadMethods(): void {
    this.methodsState.set('loading');
    this.paymentMethods
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => {
          const fromStore = methods.filter((m) => Number.isInteger(Number(m.id)));
          if (methods.length > 0 && fromStore.length === 0) {
            this.methodsState.set('error');
            return;
          }
          this.methodOptions.set(
            fromStore
              .filter((m) => m.enabled && MANUAL_METHODS.includes(m.type))
              .map((m) => ({ value: Number(m.id), label: m.displayName || m.name })),
          );
          this.methodsState.set('ready');
        },
        error: () => this.methodsState.set('error'),
      });
  }

  private open(id: number): void {
    this.reset();
    this.loading.set(true);
    forkJoin({ folio: this.reservationsService.getFolio(id), split: this.reservationsService.getFolioSplit(id) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ folio, split }) => {
          this.folio.set(folio);
          this.split.set(split);
          this.loading.set(false);
        },
        error: (message: string) => {
          this.loading.set(false);
          this.loadError.set(message);
        },
      });
    if (this.methodsState() === 'ready' && this.methodOptions().length > 0) return;
    this.loadMethods();
  }

  private reset(): void {
    this.folio.set(null);
    this.split.set(null);
    this.result.set(null);
    this.loadError.set(null);
    this.verifyNow.set(false);
    this.billTo.set('guest');
    this.company.set(null);
    this.chargeToCredit.set(false);
    this.methodId.set(null);
    this.requestId = newRequestId();
  }
}
