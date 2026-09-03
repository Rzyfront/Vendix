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

/** Intervalo de refresco del resumen mientras el modal está abierto (QUI-572). */
const SUMMARY_POLL_MS = 10_000;

/** Tolerancia de comparación de montos: por debajo de un centavo no hay cambio. */
const AMOUNT_EPSILON = 0.01;

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
    >
      <!-- Header -->
      <div slot="header" class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center"
        >
          <app-icon name="lock" [size]="20" class="text-destructive"></app-icon>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-text-primary">Cerrar Caja</h2>
          <p class="text-sm text-text-secondary">
            {{ session()?.register?.name || 'Caja' }} — Abierta
            {{ session()?.opened_at | date: 'shortTime' }}
          </p>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-5">
        <!-- Session summary cards -->
        @if (session()) {
          <div class="grid grid-cols-2 gap-3">
            <div
              class="bg-primary/5 border border-primary/20 p-3 rounded-xl text-center"
            >
              <p
                class="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-1"
              >
                Monto Apertura
              </p>
              <p class="text-xl font-bold text-text-primary">
                {{ session()!.opening_amount | currency: 0 }}
              </p>
            </div>
            <div
              class="bg-primary/5 border border-primary/20 p-3 rounded-xl text-center"
            >
              <p
                class="text-[10px] font-medium text-text-secondary uppercase tracking-wider mb-1"
              >
                Cajero
              </p>
              <p class="text-xl font-bold text-text-primary">
                {{ session()!.opened_by_user?.first_name }}
                {{ session()!.opened_by_user?.last_name }}
              </p>
            </div>
          </div>
        }

        <!-- Movements Summary -->
        @if (summary()) {
          <div class="border border-border rounded-xl p-4 space-y-2">
            <p
              class="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2"
            >
              Resumen de Movimientos
            </p>
            <div class="space-y-1.5 text-sm">
              <div class="flex justify-between">
                <span class="text-text-secondary">Apertura</span>
                <span class="font-medium text-text-primary">{{
                  summary()?.opening | currency: 0
                }}</span>
              </div>

              @if ((summary()?.sales_by_method?.length ?? 0) > 0) {
                <p
                  class="text-[10px] font-semibold text-text-secondary uppercase tracking-wider pt-1"
                >
                  Ventas por metodo
                </p>
                @for (
                  entry of summary()?.sales_by_method ?? [];
                  track entry.method
                ) {
                  <div class="flex justify-between">
                    <span
                      [class]="
                        entry.method === 'cash'
                          ? 'text-green-600'
                          : 'text-slate-500'
                      "
                    >
                      + {{ methodLabels[entry.method] ?? entry.method }} ({{
                        entry.count
                      }})
                    </span>
                    <span
                      class="font-medium"
                      [class]="
                        entry.method === 'cash'
                          ? 'text-green-600'
                          : 'text-slate-500'
                      "
                    >
                      {{ entry.total | currency: 0 }}
                    </span>
                  </div>
                }
              }

              @if ((summary()?.cash_in ?? 0) > 0) {
                <div class="flex justify-between">
                  <span class="text-blue-600">+ Entradas de efectivo</span>
                  <span class="font-medium text-blue-600">{{
                    summary()?.cash_in | currency: 0
                  }}</span>
                </div>
              }
              @if ((summary()?.cash_refunds ?? 0) > 0) {
                <div class="flex justify-between">
                  <span class="text-red-600">- Reembolsos (efectivo)</span>
                  <span class="font-medium text-red-600">{{
                    summary()?.cash_refunds | currency: 0
                  }}</span>
                </div>
              }
              @if ((summary()?.cash_out ?? 0) > 0) {
                <div class="flex justify-between">
                  <span class="text-amber-600">- Salidas de efectivo</span>
                  <span class="font-medium text-amber-600">{{
                    summary()?.cash_out | currency: 0
                  }}</span>
                </div>
              }
              <div class="border-t border-border pt-2 flex justify-between">
                <span class="font-semibold text-text-primary"
                  >Efectivo Esperado en Caja</span
                >
                <span class="font-bold text-text-primary">{{
                  summary()?.expected_cash_total | currency: 0
                }}</span>
              </div>
              @if ((summary()?.non_cash_total ?? 0) > 0) {
                <div class="flex justify-between text-xs pt-1">
                  <span class="text-text-secondary"
                    >Ventas por otros medios</span
                  >
                  <span class="text-text-secondary">{{
                    summary()?.non_cash_total | currency: 0
                  }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Expected cash changed while counting (QUI-572) -->
        @if (expectedChanged()) {
          <div
            class="p-4 rounded-xl border bg-amber-50 text-amber-700 border-amber-200 space-y-3"
          >
            <div class="flex items-start gap-3">
              <div
                class="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0"
              >
                <app-icon name="alert-triangle" [size]="18"></app-icon>
              </div>
              <div class="min-w-0">
                <p class="text-sm font-semibold">
                  El efectivo esperado cambió mientras contabas
                </p>
                <p class="text-xs opacity-80">
                  Entró un movimiento en esta caja.
                </p>
                <p class="text-base font-bold mt-1">
                  {{ staleFrom() | currency: 0 }} →
                  {{ summary()?.expected_cash_total | currency: 0 }}
                </p>
              </div>
            </div>
            <app-button
              variant="outline-warning"
              size="sm"
              (clicked)="acceptNewExpected()"
            >
              <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
              Volver a contar con el monto nuevo
            </app-button>
          </div>
        }

        <!-- Form -->
        <form [formGroup]="form" class="space-y-4">
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
            class="p-4 rounded-xl flex items-center gap-3 border"
            [class]="
              (difference() ?? 0) >= 0
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            "
          >
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center"
              [class]="(difference() ?? 0) >= 0 ? 'bg-green-100' : 'bg-red-100'"
            >
              <app-icon
                [name]="(difference() ?? 0) >= 0 ? 'trending-up' : 'trending-down'"
                [size]="18"
              ></app-icon>
            </div>
            <div>
              <p class="text-xs font-medium opacity-70">
                {{ (difference() ?? 0) >= 0 ? 'Sobrante' : 'Faltante' }}
              </p>
              <p class="text-lg font-bold">
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
      <div slot="footer" class="flex justify-end gap-2">
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
      Math.abs(next.expected_cash_total - counted) > AMOUNT_EPSILON
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

          if (Math.abs(fresh.expected_cash_total - counted) > AMOUNT_EPSILON) {
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
          Math.abs(expectedNow - counted) > AMOUNT_EPSILON
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
