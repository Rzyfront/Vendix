import {
  ChangeDetectionStrategy,
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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { startWith } from 'rxjs/operators';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import { LodgingDepositSummary } from '../../interfaces/reservation.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

/** Methods the desk registers by hand; the Wompi link settles itself. */
const MANUAL_METHODS = ['cash', 'card', 'bank_transfer', 'voucher'];
/** Selector value of the Wompi link option (store payment method ids are numbers). */
const LINK_METHOD = 'wompi_link';

/** Random key of one deposit attempt (a double click registers it once). */
function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Hospitality Suite (H3.5) — the reservation deposit ("Depósito"): required,
 * received, applied and retained amounts, its movements and, once the
 * reservation is cancelled / no-show, the settlement. The deposit is a wallet
 * advance, never a folio payment (owner rule D3): the folio only shows the
 * applied part as "Anticipo aplicado".
 */
@Component({
  selector: 'app-deposit-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent],
  template: `
    <div class="rounded-lg border border-border" data-testid="deposit-panel">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p class="flex items-center gap-2 font-medium text-text-primary">
          <app-icon name="piggy-bank" [size]="16" />
          Depósito
        </p>
        @if (summary()?.can_collect && !collecting()) {
          <app-button variant="outline" size="sm" (clicked)="startCollect()" data-testid="deposit-collect">
            <app-icon slot="icon" name="banknote" [size]="14" />
            Cobrar depósito
          </app-button>
        }
      </div>

      @if (loading()) {
        <p class="px-3 py-2 text-xs text-text-secondary">Cargando depósito…</p>
      } @else if (summary(); as s) {
        <div class="space-y-1 px-3 py-2">
          @if (requiredAmount() > 0) {
            <p class="text-text-secondary" data-testid="deposit-required">
              {{ requiredLabel() }}
            </p>
          }
          <p class="font-medium text-text-primary" data-testid="deposit-received">
            Depósito recibido {{ money(s.received) }}
          </p>
          @if (s.applied > 0) {
            <p class="text-text-secondary" data-testid="deposit-applied">Aplicado a la cuenta {{ money(s.applied) }}</p>
          }
          @if (s.retained > 0) {
            <p class="text-text-secondary" data-testid="deposit-retained">
              Retenido por penalidad {{ money(s.retained) }}
            </p>
          }
          @if (settlementLabel(); as settlement) {
            <p class="rounded-lg bg-error/10 px-3 py-2 font-medium text-text-primary" data-testid="deposit-settlement">
              {{ settlement }}
            </p>
          }
        </div>

        @if (s.movements.length > 0) {
          <ul class="divide-y divide-border border-t border-border">
            @for (m of s.movements; track m.id) {
              <li class="flex items-center justify-between gap-2 px-3 py-2" data-testid="deposit-movement">
                <div>
                  <p class="font-medium" [class.line-through]="m.status === 'cancelled'">{{ m.method_label }}</p>
                  @if (m.status === 'pending') {
                    <p class="text-xs text-warning" data-testid="deposit-pending">Pendiente de pago</p>
                  } @else if (m.status === 'cancelled') {
                    <p class="text-xs text-text-secondary">Cancelado</p>
                  }
                </div>
                <div class="flex items-center gap-1">
                  <span class="whitespace-nowrap font-medium" [class.line-through]="m.status === 'cancelled'">
                    {{ money(m.amount) }}
                  </span>
                  @if (m.status === 'pending' && m.checkout_url) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      ariaLabel="Copiar link de pago"
                      (clicked)="copyLink(m.checkout_url)"
                      data-testid="deposit-copy-link"
                    >
                      <app-icon slot="icon" name="copy" [size]="14" />
                    </app-button>
                    <a
                      [href]="m.checkout_url"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex p-1 text-text-secondary hover:text-text-primary"
                      aria-label="Abrir link de pago"
                      data-testid="deposit-open-link"
                    >
                      <app-icon name="external-link" [size]="14" />
                    </a>
                  }
                </div>
              </li>
            }
          </ul>
        }
      }

      @if (createdLink(); as link) {
        <div class="space-y-1 border-t border-border px-3 py-2" data-testid="deposit-link-created">
          <p class="text-xs text-text-secondary">Link de pago creado</p>
          <p class="break-all text-xs">{{ link }}</p>
          <app-button variant="outline" size="sm" (clicked)="copyLink(link)">
            <app-icon slot="icon" name="copy" [size]="14" />
            Copiar link
          </app-button>
        </div>
      }

      @if (collecting()) {
        <form [formGroup]="form" class="space-y-2 border-t border-border px-3 py-3" data-testid="deposit-form">
          <div class="grid grid-cols-2 gap-2">
            <app-input
              [formControl]="form.controls.amount"
              [currency]="true"
              label="Monto"
              size="sm"
              [helperText]="'Pendiente ' + money(summary()?.pending ?? 0)"
            />
            <app-selector
              [formControl]="form.controls.method"
              label="Medio de pago"
              placeholder="Elige el medio"
              [options]="methodOptions()"
            />
          </div>
          <div class="flex justify-end gap-2">
            <app-button variant="ghost" size="sm" (clicked)="cancelCollect()">Volver</app-button>
            <app-button
              variant="primary"
              size="sm"
              [loading]="busy()"
              [disabled]="formStatus() !== 'VALID'"
              (clicked)="save()"
              data-testid="deposit-save"
            >
              {{ isLink() ? 'Crear link' : 'Cobrar depósito' }}
            </app-button>
          </div>
        </form>
      }
    </div>
  `,
})
export class DepositPanelComponent {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly paymentMethods = inject(PaymentMethodsCatalogService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly reservationId = input.required<number>();
  /** Bump to re-fetch (e.g. after the folio applied the deposit). */
  readonly refreshKey = input<number>(0);
  /** Emitted after a deposit action so the detail refreshes dependants. */
  readonly changed = output<void>();

  readonly summary = signal<LodgingDepositSummary | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly collecting = signal(false);
  readonly createdLink = signal<string | null>(null);
  private readonly manualOptions = signal<SelectorOption[]>([]);
  private requestId = newRequestId();

  readonly form = new FormGroup({
    amount: new FormControl<number | null>(null, [Validators.required, Validators.min(1)]),
    method: new FormControl<string | number | null>(null, Validators.required),
  });
  readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), {
    initialValue: this.form.status,
  });
  private readonly methodValue = toSignal(
    this.form.controls.method.valueChanges.pipe(startWith(this.form.controls.method.value)),
    { initialValue: null as string | number | null },
  );

  readonly isLink = computed(() => this.methodValue() === LINK_METHOD);
  readonly methodOptions = computed<SelectorOption[]>(() => [
    ...this.manualOptions(),
    { value: LINK_METHOD, label: 'Link Wompi' },
  ]);
  readonly requiredAmount = computed(() => Number(this.summary()?.required.amount ?? 0));
  readonly requiredLabel = computed(() => {
    const required = this.summary()?.required;
    if (!required) return '';
    const amount = this.money(required.amount);
    return required.percent
      ? `Depósito requerido ${Number(required.percent)} % · ${amount}`
      : `Depósito requerido ${amount}`;
  });
  /** "Penalidad $250.000 · retenido $225.000 · por cobrar $25.000" / "por devolver". */
  readonly settlementLabel = computed(() => {
    const settlement = this.summary()?.settlement;
    if (!settlement || settlement.penalty <= 0) return '';
    const parts = [`Penalidad ${this.money(settlement.penalty)}`, `retenido ${this.money(settlement.retained)}`];
    if (settlement.to_collect > 0) parts.push(`por cobrar ${this.money(settlement.to_collect)}`);
    if (settlement.to_refund > 0) parts.push(`por devolver ${this.money(settlement.to_refund)}`);
    return parts.join(' · ');
  });

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
    this.loading.set(this.summary() === null);
    this.reservationsService
      .getDeposits(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary);
          this.loading.set(false);
        },
        error: (message: string) => {
          this.loading.set(false);
          this.toastService.error(message);
        },
      });
  }

  startCollect(): void {
    this.requestId = newRequestId();
    this.createdLink.set(null);
    this.form.reset({ amount: this.summary()?.pending || null, method: null });
    this.collecting.set(true);
    if (this.manualOptions().length > 0) return;
    this.paymentMethods
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) =>
        this.manualOptions.set(
          methods
            .filter((m) => m.enabled && MANUAL_METHODS.includes(m.type) && Number.isInteger(Number(m.id)))
            .map((m) => ({ value: Number(m.id), label: m.displayName || m.name })),
        ),
      );
  }

  cancelCollect(): void {
    this.collecting.set(false);
  }

  save(): void {
    const value = this.form.getRawValue();
    const amount = Number(value.amount);
    this.busy.set(true);
    const request$ = this.isLink()
      ? this.reservationsService.createDepositLink(this.reservationId(), amount, this.requestId)
      : this.reservationsService.registerDeposit(this.reservationId(), {
          amount,
          store_payment_method_id: Number(value.method),
          request_id: this.requestId,
        });
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ summary, message }) => {
        const wasLink = this.isLink();
        this.summary.set(summary);
        this.busy.set(false);
        this.collecting.set(false);
        if (wasLink) {
          // Movements come oldest first: the link just created is the last pending one.
          const pendingLink = summary.movements
            .filter((m) => m.status === 'pending' && m.checkout_url)
            .at(-1);
          this.createdLink.set(pendingLink?.checkout_url ?? null);
        }
        this.toastService.success(message);
        this.changed.emit();
      },
      error: (message: string) => {
        this.busy.set(false);
        this.toastService.error(message);
      },
    });
  }

  copyLink(url: string): void {
    if (!globalThis.navigator?.clipboard) return;
    globalThis.navigator.clipboard.writeText(url).then(
      () => this.toastService.success('Link copiado'),
      () => this.toastService.error('No se pudo copiar el link'),
    );
  }
}
