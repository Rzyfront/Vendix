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
import { forkJoin } from 'rxjs';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
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

/** Methods the desk registers by hand; gateways settle themselves. */
const MANUAL_METHODS = ['cash', 'card', 'bank_transfer'];

type BillTo = 'guest' | 'company';

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hospitality Suite (H3.7) — check-out: review the folio, pay the balance
 * (or charge it to the company's credit), pick who is invoiced and confirm.
 * The result shows the electronic invoice ("Factura FE-xxxx aceptada por
 * DIAN") with its PDF. Confirming again with the same attempt never emits a
 * second invoice: it only retries the same one.
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
  ],
  template: `
    <app-modal
      [isOpen]="reservation() !== null"
      (isOpenChange)="!$event && close()"
      title="Check-out"
      [subtitle]="subtitle()"
      size="md"
    >
      @if (loading()) {
        <p class="text-sm text-text-secondary">Cargando folio…</p>
      } @else if (result(); as r) {
        <div class="space-y-3 text-sm" data-testid="check-out-result">
          <p class="flex items-center gap-2 font-medium text-success">
            <app-icon name="log-out" [size]="16" />
            Salida registrada · folio cerrado · habitación sucia
          </p>
          @if (r.invoices; as list) {
            @for (row of list; track row.account_id) {
              <div class="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2" data-testid="check-out-split-invoice">
                <div>
                  <p class="font-medium text-text-primary">{{ row.label }} · {{ money(Number(row.grand_total)) }}</p>
                  <p class="text-xs text-text-secondary">
                    {{ row.invoice_number ? 'Factura ' + row.invoice_number : 'Factura electrónica' }}{{ row.status ? ' · ' + (row.status === 'issued' ? 'aceptada por DIAN' : row.status) : '' }}
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
                <p class="font-medium text-text-primary">Factura {{ inv.invoice_number }} aceptada por DIAN</p>
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
            <dt class="text-text-secondary">Total del folio</dt>
            <dd class="text-right">{{ money(f.total) }}</dd>
            <dt class="text-text-secondary">Pagado</dt>
            <dd class="text-right">{{ money(f.paid) }}</dd>
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
              <p class="font-medium text-text-primary">Cuentas del folio dividido</p>
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
                Folio verificado
              </p>
            } @else {
              <app-toggle
                [checked]="verifyNow()"
                label="Verifico el folio ahora"
                (changed)="verifyNow.set($event)"
              />
              <p class="text-xs text-text-secondary">
                {{ f.verified_at ? 'El folio cambió después de verificarlo.' : 'Aún no está verificado.' }}
                Lo verifica un usuario con el permiso «Verificar el folio».
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
                <app-selector
                  label="Cobrar el saldo con"
                  placeholder="Elige el medio"
                  [options]="methodOptions()"
                  [value]="methodId()"
                  (valueChange)="methodId.set($event === null ? null : Number($event))"
                />
              } @else {
                <p class="text-xs text-text-secondary">El saldo pasa a cuentas por cobrar de la empresa.</p>
              }
            </div>
          }
        </div>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2">
        @if (result(); as r) {
          @if (!r.invoices && (r.invoice?.state === 'failed' || r.invoice === null)) {
            <app-button variant="outline" [loading]="busy()" (clicked)="confirm()">Reintentar factura</app-button>
          }
          @if (!r.invoices && r.invoice?.invoice_id) {
            <app-button variant="outline" [loading]="busy()" (clicked)="downloadPdf()" data-testid="check-out-pdf">
              <app-icon slot="icon" name="download" [size]="14" />
              Descargar PDF
            </app-button>
          }
          <app-button variant="primary" (clicked)="close()">Listo</app-button>
        } @else {
          <app-button variant="ghost" (clicked)="close()">Volver</app-button>
          <app-button
            variant="primary"
            [loading]="busy()"
            [disabled]="!canConfirm()"
            (clicked)="confirm()"
            data-testid="check-out-confirm"
          >
            <app-icon slot="icon" name="log-out" [size]="16" />
            Confirmar check-out
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

  readonly subtitle = computed(() => {
    const r = this.reservation();
    return r ? `${r.reservation_number} · ${this.holderName()}` : '';
  });
  readonly holderName = computed(() => {
    const c = this.reservation()?.customer;
    return c ? `${c.first_name} ${c.last_name ?? ''}`.trim() : 'Huésped';
  });
  /** Balance after the held deposit, which the check-out applies first. */
  readonly due = computed(() => {
    const f = this.folio();
    return f ? Math.max(0, f.balance - (f.deposit_available ?? 0)) : 0;
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
          this.toastService.error(message);
        },
      });
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

  private reset(): void {
    this.folio.set(null);
    this.split.set(null);
    this.result.set(null);
    this.verifyNow.set(false);
    this.billTo.set('guest');
    this.company.set(null);
    this.chargeToCredit.set(false);
    this.methodId.set(null);
    this.requestId = newRequestId();
  }
}
