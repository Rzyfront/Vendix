import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { EMPTY, interval } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  IconComponent,
} from '../../../../../shared/components';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import {
  PosCashRegisterService,
  CashRegisterSession,
  CashSessionSummary,
} from '../services/pos-cash-register.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { extractApiError } from '../../../../../shared/utils/http-error.util';
// F-225 (ADR-16): mismo kernel de dinero que `pos-cart.service.ts` — ver
// `apps/frontend/tsconfig.app.json` (`paths`). `Math.abs(a - b) > 0.01`
// tolera EXACTAMENTE 1 centavo; la traducción fiel es
// `differsByAtLeastCents(a, b, 2)`, no el umbral por defecto (1).
import { differsByAtLeastCents } from '@money-kernel/money-compare';

/** Intervalo de refresco del resumen mientras el modal está abierto (QUI-572). */
const SUMMARY_POLL_MS = 10_000;

/** Tolerancia de comparación de montos: hasta 1 centavo de diferencia no cuenta como cambio. */
const AMOUNT_TOLERANCE_CENTS = 2;

const EXPECTED_STALE_CODE = 'CASH_SESSION_EXPECTED_STALE_001';

/**
 * `details.expected_now` del envelope 409 del backend, si vino utilizable.
 * Permite pintar el banner con la cifra fresca sin esperar otra petición.
 */
function staleExpectedNow(err: unknown): number | null {
  const body = (
    err as { error?: { details?: { expected_now?: unknown } } } | null | undefined
  )?.error;
  const value = body?.details?.expected_now;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

@Component({
  selector: 'app-pos-session-close-modal',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="true"
      [dialog]="true"
    >
      <!-- Header -->
      <div slot="header" class="sc-header">
        <div class="sc-header-icon">
          <app-icon name="lock" [size]="20"></app-icon>
        </div>
        <div>
          <h2 class="sc-title">Cerrar Caja</h2>
          <p class="sc-subtitle">
            {{ session()?.register?.name || 'Caja' }} — Abierta
            {{ session()?.opened_at | date: 'shortTime' }}
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="sc-body">
        <!-- Session summary cards -->
        @if (session()) {
          <div class="sc-cards">
            <div class="sc-card">
              <p class="sc-card-label">Monto Apertura</p>
              <p class="sc-card-amount">
                {{ session()!.opening_amount | currency: 0 }}
              </p>
            </div>
            <div class="sc-card">
              <p class="sc-card-label">Cajero</p>
              <p class="sc-card-amount">
                {{ session()!.opened_by_user?.first_name }}
                {{ session()!.opened_by_user?.last_name }}
              </p>
            </div>
          </div>
        }

        <!-- Movements Summary -->
        @if (summary()) {
          <div class="sc-box">
            <p class="sc-box-title">Resumen de Movimientos</p>
            <div class="sc-rows">
              <div class="sc-row">
                <span class="sc-row-label">Apertura</span>
                <span class="sc-row-value">{{
                  summary()?.opening | currency: 0
                }}</span>
              </div>

              @if ((summary()?.sales_by_method?.length ?? 0) > 0) {
                <p class="sc-box-subtitle">Ventas por metodo</p>
                @for (
                  entry of summary()?.sales_by_method ?? [];
                  track entry.method
                ) {
                  <div class="sc-row">
                    <span
                      [class]="
                        entry.method === 'cash' ? 'sc-cash' : 'sc-other'
                      "
                    >
                      + {{ methodLabels[entry.method] ?? entry.method }} ({{
                        entry.count
                      }})
                    </span>
                    <span
                      class="sc-row-value"
                      [class.sc-cash]="entry.method === 'cash'"
                      [class.sc-other]="entry.method !== 'cash'"
                    >
                      {{ entry.total | currency: 0 }}
                    </span>
                  </div>
                }
              }

              @if ((summary()?.cash_in ?? 0) > 0) {
                <div class="sc-row">
                  <span class="sc-in">+ Entradas de efectivo</span>
                  <span class="sc-row-value sc-in">{{
                    summary()?.cash_in | currency: 0
                  }}</span>
                </div>
              }
              @if ((summary()?.cash_refunds ?? 0) > 0) {
                <div class="sc-row">
                  <span class="sc-out">- Reembolsos (efectivo)</span>
                  <span class="sc-row-value sc-out">{{
                    summary()?.cash_refunds | currency: 0
                  }}</span>
                </div>
              }
              @if ((summary()?.cash_out ?? 0) > 0) {
                <div class="sc-row">
                  <span class="sc-warn">- Salidas de efectivo</span>
                  <span class="sc-row-value sc-warn">{{
                    summary()?.cash_out | currency: 0
                  }}</span>
                </div>
              }
              <div class="sc-row sc-expected">
                <span class="sc-expected-label">Efectivo Esperado en Caja</span>
                <span class="sc-expected-value">{{
                  summary()?.expected_cash_total | currency: 0
                }}</span>
              </div>
              @if ((summary()?.non_cash_total ?? 0) > 0) {
                <div class="sc-row sc-noncash">
                  <span>Ventas por otros medios</span>
                  <span>{{
                    summary()?.non_cash_total | currency: 0
                  }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Expected cash changed while counting (QUI-572) -->
        @if (expectedChanged()) {
          <div class="sc-stale" role="alert">
            <div class="sc-stale-body">
              <div class="sc-stale-icon">
                <app-icon name="alert-triangle" [size]="18"></app-icon>
              </div>
              <div class="sc-stale-text">
                <p class="sc-stale-title">
                  El efectivo esperado cambió mientras contabas
                </p>
                <p class="sc-stale-sub">
                  Entró un movimiento en esta caja.
                </p>
                <p class="sc-stale-amounts">
                  {{ staleFrom() | currency: 0 }} →
                  {{ summary()?.expected_cash_total | currency: 0 }}
                </p>
              </div>
            </div>
            <app-button
              variant="outline-warning"
              size="md"
              (clicked)="acceptNewExpected()"
            >
              <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              Volver a contar con el monto nuevo
            </app-button>
          </div>
        }

        <!-- Form -->
        <form [formGroup]="form" class="sc-form">
          <app-input
            formControlName="actual_closing_amount"
            label="Conteo Real de Efectivo"
            placeholder="0.00"
            [currency]="true"
            [size]="'md'"
            [required]="true"
            [prefixIcon]="true"
            [error]="getFieldError('actual_closing_amount')"
            (inputBlur)="onFieldBlur('actual_closing_amount')"
          ></app-input>

          <app-input
            formControlName="closing_notes"
            label="Notas de Cierre"
            placeholder="Observaciones del cierre..."
            type="text"
            [size]="'md'"
            helperText="Opcional — novedades del turno, faltantes, etc."
          ></app-input>
        </form>

        <!-- Difference indicator (shown after closing) -->
        @if (difference() !== null) {
          <div
            class="sc-diff"
            [class.sc-diff-plus]="(difference() ?? 0) >= 0"
            [class.sc-diff-minus]="(difference() ?? 0) < 0"
          >
            <div class="sc-diff-icon">
              <app-icon
                [name]="(difference() ?? 0) >= 0 ? 'trending-up' : 'trending-down'"
                [size]="18"
              ></app-icon>
            </div>
            <div>
              <p class="sc-diff-label">
                {{ (difference() ?? 0) >= 0 ? 'Sobrante' : 'Faltante' }}
              </p>
              <p class="sc-diff-amount">
                {{
                  ((difference() ?? 0) >= 0 ? (difference() ?? 0) : -(difference() ?? 0))
                    | currency: 0
                }}
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="sc-footer">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          [variant]="expectedChanged() ? 'outline-warning' : 'primary'"
          size="md"
          (clicked)="onClose()"
          [disabled]="!form.valid || submitting() || refreshing()"
        >
          <app-icon name="lock" [size]="16" slot="icon" ></app-icon>
          @if (submitting()) {
            Cerrando...
          } @else if (refreshing()) {
            Verificando...
          } @else if (expectedChanged()) {
            Confirmar cierre ({{ summary()?.expected_cash_total | currency: 0 }})
          } @else {
            Cerrar Caja
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    /* Stitch paso 7 — cierre con arqueo: tarjetas de resumen, desglose de
       movimientos con colores de signo en tonos 700/800 (AA sobre tint 50),
       banner QUI-572 en warning sólido y foco 3px primary. Textos
       informativos en neutral-600 (text-secondary falla AA). */
    .sc-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sc-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      background: var(--color-error-50);
      color: var(--color-error-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sc-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0;
    }

    .sc-subtitle {
      font-size: 14px;
      color: var(--color-neutral-600);
      margin: 0;
    }

    .sc-body {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .sc-cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .sc-card {
      background: var(--color-surface-secondary);
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 12px;
      text-align: center;
    }

    .sc-card-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-neutral-600);
      margin: 0 0 4px;
    }

    .sc-card-amount {
      font-size: 20px;
      font-weight: 700;
      color: var(--color-text-primary);
      margin: 0;
    }

    .sc-box {
      border: 1px solid var(--color-border);
      border-radius: 16px;
      padding: 16px;
    }

    .sc-box-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-neutral-600);
      margin: 0 0 8px;
    }

    .sc-box-subtitle {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-neutral-600);
      margin: 0;
      padding-top: 4px;
    }

    .sc-rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 14px;
    }

    .sc-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }

    .sc-row-label {
      color: var(--color-neutral-600);
    }

    .sc-row-value {
      font-weight: 500;
      color: var(--color-text-primary);
      text-align: right;
    }

    .sc-cash { color: var(--color-success-700); }
    .sc-other { color: var(--color-neutral-600); }
    .sc-in { color: var(--color-info-700); }
    .sc-out { color: var(--color-error-700); }
    .sc-warn { color: var(--color-warning-800); }

    .sc-expected {
      border-top: 1px solid var(--color-border);
      padding-top: 8px;
    }

    .sc-expected-label {
      font-weight: 600;
      color: var(--color-text-primary);
    }

    .sc-expected-value {
      font-weight: 700;
      color: var(--color-text-primary);
    }

    .sc-noncash {
      font-size: 12px;
      color: var(--color-neutral-600);
      padding-top: 4px;
    }

    .sc-stale {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid var(--color-warning-200);
      background: var(--color-warning-50);
      color: var(--color-warning-800);
    }

    .sc-stale-body {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .sc-stale-icon {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: var(--color-warning-100);
      color: var(--color-warning-700);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sc-stale-text { min-width: 0; }

    .sc-stale-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }

    .sc-stale-sub {
      font-size: 12px;
      margin: 0;
      color: var(--color-warning-800);
    }

    .sc-stale-amounts {
      font-size: 16px;
      font-weight: 700;
      margin: 4px 0 0;
    }

    .sc-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .sc-diff {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid;
    }

    .sc-diff-plus {
      background: var(--color-success-50);
      border-color: var(--color-success-200);
      color: var(--color-success-800);
    }

    .sc-diff-minus {
      background: var(--color-error-50);
      border-color: var(--color-error-200);
      color: var(--color-error-800);
    }

    .sc-diff-icon {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sc-diff-plus .sc-diff-icon { background: var(--color-success-100); }
    .sc-diff-minus .sc-diff-icon { background: var(--color-error-100); }

    .sc-diff-label {
      font-size: 12px;
      font-weight: 500;
      margin: 0;
    }

    .sc-diff-amount {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
    }

    .sc-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `],
})
export class PosSessionCloseModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly session = input<CashRegisterSession | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly sessionClosed = output<any>();

  readonly submitting = signal(false);
  readonly difference = signal<number | null>(null);

  /** Resumen autoritativo del backend. Nunca se recalcula acá. */
  readonly summary = signal<CashSessionSummary | null>(null);
  /** Esperado contra el que el operario está contando (lo que vio en pantalla). */
  readonly countedAgainst = signal<number | null>(null);
  /** Esperado viejo, seteado cuando detectamos que la cifra cambió. */
  readonly staleFrom = signal<number | null>(null);
  /** Hay una revalidación en vuelo. */
  readonly refreshing = signal(false);
  readonly expectedChanged = computed(() => this.staleFrom() !== null);

  /** Etiquetas de método de pago: el backend manda `method` crudo, sin label. */
  readonly methodLabels: Record<string, string | undefined> = {
    cash: 'Efectivo',
    card: 'Tarjeta',
    bank_transfer: 'Transferencia',
    voucher: 'Voucher',
    wompi: 'Wompi',
    wallet: 'Wallet',
    paypal: 'PayPal',
  };

  form: FormGroup;

  private fb = inject(FormBuilder);
  private cashRegisterService = inject(PosCashRegisterService);
  private toastService = inject(ToastService);

  constructor() {
    this.form = this.fb.group({
      actual_closing_amount: [0, [Validators.required, Validators.min(0)]],
      closing_notes: [''],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.difference.set(null);
          this.summary.set(null);
          this.countedAgainst.set(null);
          this.staleFrom.set(null);
          this.refreshing.set(false);
          this.submitting.set(false);
          this.form.reset({ actual_closing_amount: 0, closing_notes: '' });
          this.loadSummary();
        });
      }
    });

    // Resumen vivo: mientras el modal esté abierto, el esperado se refresca
    // solo. Sin esto el arqueo se cuadra contra una foto tomada al abrir y una
    // venta concurrente produce un faltante inexistente (QUI-572).
    //
    // El `catchError` va en el observable INTERNO: un fallo de red debe
    // descartar ese ciclo, no matar el polling.
    toObservable(this.isOpen)
      .pipe(
        switchMap((open) => (open ? interval(SUMMARY_POLL_MS) : EMPTY)),
        switchMap(() => {
          const session = this.session();
          return session
            ? this.cashRegisterService
                .getCashSummary(session.id)
                .pipe(catchError(() => EMPTY))
            : EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((next) => this.applySummary(next));
  }

  private loadSummary(): void {
    const session = this.session();
    if (!session) return;

    // Un fallo acá NO limpia el resumen ya pintado: se usa también para
    // recargar el desglose después de un 409, y borrarlo se llevaría el banner
    // que le está avisando al operario.
    this.cashRegisterService
      .getCashSummary(session.id)
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((next) => this.applySummary(next));
  }

  /**
   * Adopta un resumen del backend y decide si el esperado quedó rancio.
   *
   * El primer resumen de cada apertura fija la línea base: es la cifra contra la
   * que el operario empieza a contar.
   */
  private applySummary(next: CashSessionSummary): void {
    this.summary.set(next);

    const counted = this.countedAgainst();
    if (counted == null) {
      this.countedAgainst.set(next.expected_cash_total);
      return;
    }

    // Si el esperado volvió a coincidir (p.ej. venta y luego reembolso), ya no
    // hay nada rancio que confirmar: el banner se retira solo.
    this.staleFrom.set(
      differsByAtLeastCents(
        next.expected_cash_total,
        counted,
        AMOUNT_TOLERANCE_CENTS,
      )
        ? counted
        : null,
    );
  }

  /**
   * El operario acepta el monto nuevo y va a recontar.
   *
   * NO autocompletamos `actual_closing_amount`: es un arqueo FÍSICO, el billete
   * lo cuenta la persona. Rellenarlo con el esperado convertiría el control en
   * un sello automático y volvería a esconder el descuadre.
   */
  acceptNewExpected(): void {
    const fresh = this.summary();
    if (!fresh) return;
    this.countedAgainst.set(fresh.expected_cash_total);
    this.staleFrom.set(null);
  }

  getFieldError(fieldName: string): string | undefined {
    const field = this.form.get(fieldName);
    if (field && field.errors && field.touched) {
      if (field.errors['required']) return 'Este campo es requerido';
      if (field.errors['min']) return 'El monto no puede ser negativo';
    }
    return undefined;
  }

  onFieldBlur(fieldName: string): void {
    this.form.get(fieldName)?.markAsTouched();
  }

  onClose() {
    if (!this.form.valid || !this.session()) return;
    if (this.submitting() || this.refreshing()) return;

    // Estado de confirmación explícita: el operario ya vio el banner con la
    // cifra nueva y decidió cerrar igual, así que ADOPTA ese monto como el que
    // contó. Sin esto el cierre queda en un callejón sin salida — la
    // revalidación de abajo compara contra `countedAgainst()` y bloquearía para
    // siempre. La garantía que importa se mantiene intacta: solo se puede
    // enviar el esperado que estuvo EN PANTALLA.
    if (this.expectedChanged()) {
      this.acceptNewExpected();
    }

    this.refreshing.set(true);

    // Revalidar contra el backend ANTES de enviar. El polling puede llegar
    // hasta 10s tarde; esto cierra la ventana entre el último refresco y el
    // click.
    this.cashRegisterService
      .getCashSummary(this.session()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fresh) => {
          const counted = this.countedAgainst();
          this.applySummary(fresh);

          // `counted == null` significa que el resumen nunca cargó, así que el
          // operario jamás vio un esperado: no hay nada "rancio", pero tampoco
          // hay contra qué cuadrar. `applySummary` acaba de fijar la línea base;
          // se le muestra y se le pide revisar antes de reintentar.
          if (counted == null) {
            this.refreshing.set(false);
            this.toastService.warning(
              'No pudimos mostrarte el efectivo esperado antes de contar. Revisa el resumen que acabamos de cargar y cierra de nuevo.',
            );
            return;
          }

          if (
            differsByAtLeastCents(
              fresh.expected_cash_total,
              counted,
              AMOUNT_TOLERANCE_CENTS,
            )
          ) {
            this.refreshing.set(false);
            this.toastService.warning(
              'El efectivo esperado cambió mientras contabas. Revisa el resumen actualizado antes de cerrar.',
            );
            return;
          }

          this.submitClose(counted);
        },
        // Nunca enviamos a ciegas: si no podemos confirmar el esperado, no hay
        // cierre.
        error: (err) => {
          this.refreshing.set(false);
          this.toastService.error(extractApiErrorMessage(err));
        },
      });
  }

  private submitClose(expectedSeen: number): void {
    this.submitting.set(true);

    const { actual_closing_amount, closing_notes } = this.form.value;

    this.cashRegisterService
      .closeSession(
        this.session()!.id,
        actual_closing_amount,
        closing_notes,
        expectedSeen,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (closedSession) => {
          this.submitting.set(false);
          this.refreshing.set(false);
          this.difference.set(Number(closedSession.difference || 0));
          this.toastService.success('Caja cerrada correctamente');
          this.sessionClosed.emit(closedSession);
          this.isOpenChange.emit(false);
        },
        error: (err) => this.onCloseError(err),
      });
  }

  private onCloseError(err: unknown): void {
    this.submitting.set(false);
    this.refreshing.set(false);

    const { code, message } = extractApiError(err);

    // El backend rechazó el cierre porque su cálculo fresco ya no coincide con
    // el esperado que declaramos. El modal NO se cierra: se muestra el banner
    // con la cifra nueva para que el operario recuente.
    if (code === EXPECTED_STALE_CODE) {
      const expectedNow = staleExpectedNow(err);
      const counted = this.countedAgainst();

      if (expectedNow != null) {
        this.summary.update((current) =>
          current ? { ...current, expected_cash_total: expectedNow } : current,
        );
        if (
          counted != null &&
          differsByAtLeastCents(expectedNow, counted, AMOUNT_TOLERANCE_CENTS)
        ) {
          this.staleFrom.set(counted);
        }
      }

      // Traer el desglose completo (ventas por método, entradas, salidas) que
      // el envelope del 409 no incluye.
      this.loadSummary();

      this.toastService.warning(
        message ??
          'El efectivo esperado cambió mientras contabas. Revisa el resumen actualizado antes de cerrar.',
      );
      return;
    }

    this.toastService.error(extractApiErrorMessage(err));
  }

  onCancel() {
    this.isOpenChange.emit(false);
  }
}
