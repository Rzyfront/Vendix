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
import { EMPTY, forkJoin, fromEvent, interval } from 'rxjs';
import { catchError, filter, switchMap } from 'rxjs/operators';
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
  CashSessionCloseReport,
  CashSessionPendingOrder,
  CashSessionPendingOrders,
  CashSessionCloseDecision,
} from '../services/pos-cash-register.service';
import {
  CashSessionReportComponent,
  CASH_METHOD_LABELS,
} from './cash-session-report.component';
import { CashSessionReportPrintService } from '../services/cash-session-report-print.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { extractApiError } from '../../../../../shared/utils/http-error.util';
import { RouterLink } from '@angular/router';
import { PaymentMethodsService } from '../../settings/payments/services/payment-methods.service';
import { StorePaymentMethod, PaymentMethodState } from '../../settings/payments/interfaces/payment-methods.interface';
import { OrderCompleteModalComponent, OrderCompletionSubmission } from '../../orders/components/order-complete-modal.component';
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
const STALE_ORDER_CODE = 'ORD_CASH_SESSION_ORDER_STALE_001';

const CASH_CLOSE_ERROR_MESSAGES: Record<string, string> = {
  CASH_SESSION_EXPECTED_STALE_001: 'El efectivo esperado cambió. Revisa el resumen actualizado y vuelve a contar.',
  CASH_SESSION_PENDING_001: 'Revisa las órdenes pendientes antes de cerrar la caja.',
  CASH_SESSION_PENDING_002: 'Las órdenes pendientes cambiaron. Actualiza la lista y revísala de nuevo.',
  CASH_SESSION_PENDING_003: 'Escribe el motivo para cerrar con órdenes pendientes.',
  CASH_SESSION_PENDING_004: 'No pudimos validar las órdenes de esta sesión. Actualiza la lista e intenta de nuevo.',
  CASH_SESSION_PENDING_005: 'Hay movimientos de venta o reembolso pendientes de registrar. Espera un momento y vuelve a intentar.',
  CASH_SESSION_PENDING_006: 'La caja ya está cerrada. Actualiza la sesión.',
};

function cashCloseErrorMessage(err: unknown, fallback: string): string {
  const { code, status } = extractApiError(err);
  if (code && CASH_CLOSE_ERROR_MESSAGES[code]) return CASH_CLOSE_ERROR_MESSAGES[code];
  if (status === 0) return 'No hay conexión con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  if (status === 401) return 'Tu sesión venció. Inicia sesión de nuevo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción.';
  return fallback;
}

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
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
    CurrencyPipe,
    CashSessionReportComponent,
    RouterLink,
    OrderCompleteModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalOpenChange($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="true"
      [dialog]="true"
      [title]="closedSession() ? 'Caja cerrada' : 'Cerrar caja'"
      [subtitle]="closedSession() ? 'Sesión #' + closedSession()!.id : (session()?.register?.name || 'Caja')"
    >
      <!-- Header -->
      <div slot="header" class="sc-header">
        <div class="sc-header-icon">
          <app-icon name="lock" [size]="20"></app-icon>
        </div>
      </div>

      <!-- Body -->
      <div class="sc-body">
        @if (closedSession()) {
          <!-- Difference indicator -->
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

          @if (reportLoading()) {
            <div class="sc-report-state">
              <app-icon name="loader" [size]="18"></app-icon>
              Cargando resumen del cierre...
            </div>
          } @else if (report(); as rep) {
            <app-cash-session-report [report]="rep"></app-cash-session-report>
          } @else {
            <div class="sc-report-state" role="alert">
              <p>No pudimos cargar el resumen del cierre. La caja ya quedó cerrada.</p>
              <app-button variant="outline" size="sm" (clicked)="loadReport()">
                <app-icon name="refresh-cw" [size]="14" slot="icon"></app-icon>
                Reintentar
              </app-button>
            </div>
          }
        } @else {
        @if (pendingOrders(); as pending) {
          @if (pending.count > 0 || pendingChanged() || pendingError()) {
          <section class="sc-pending" aria-labelledby="sc-pending-title">
            <div class="sc-pending-heading">
              <app-icon name="alert-triangle" [size]="18"></app-icon>
              <div>
                <h3 id="sc-pending-title">Órdenes pendientes de esta sesión</h3>
                <p aria-live="polite" aria-atomic="true">
                  {{ pending.count }} {{ pending.count === 1 ? 'orden' : 'órdenes' }} pendientes
                  @if (pending.balance_count > 0) {
                    · falta cobrar {{ pending.balance_total | currency: 0 }}
                  }
                </p>
              </div>
            </div>
            <p class="sc-pending-note">El dinero que falta por cobrar no se cuenta en el efectivo de la caja.</p>
            @if (pendingError()) {
              <p class="sc-pending-error" role="alert">No pudimos cargar las órdenes pendientes.</p>
              <app-button variant="outline" size="sm" (clicked)="refreshCloseState()">
                Reintentar
              </app-button>
            }
            @if (pendingChanged()) {
              <div class="sc-pending-changed" role="alert" aria-live="assertive">
                Las órdenes pendientes cambiaron. Revisa la lista actual antes de cerrar.
                <app-button variant="outline-warning" size="sm" (clicked)="acknowledgePendingChanges()">
                  Revisé las órdenes actuales
                </app-button>
              </div>
            }
            @if (pending.count > 0) {
              <button
                type="button"
                class="sc-pending-toggle"
                [attr.aria-expanded]="pendingExpanded()"
                (click)="togglePendingExpanded()"
              >
                {{ pendingExpanded() ? 'Ocultar órdenes' : 'Ver órdenes pendientes' }}
              </button>
              @if (pendingExpanded()) {
                @if (pendingLoading()) {
                  <p class="sc-pending-loading" role="status">Actualizando órdenes…</p>
                }
                <div class="sc-pending-list" aria-label="Lista de órdenes pendientes">
                  <label class="sc-pending-select-all">
                    <input
                      type="checkbox"
                      [checked]="areAllPendingOrdersSelected()"
                      [disabled]="pendingActionBusy()"
                      (change)="onSelectAllPendingChange($event)"
                    />
                    <span>Seleccionar órdenes para finalizar (hasta 100 por vez)</span>
                  </label>
                  @for (order of pending.data; track order.id) {
                    <article class="sc-pending-row">
                      <label class="sc-pending-select">
                        <input
                          type="checkbox"
                          [checked]="isPendingOrderSelected(order.id)"
                          [disabled]="order.version === null || pendingActionBusy()"
                          [attr.aria-label]="'Seleccionar orden ' + order.order_number"
                          (change)="onPendingSelectionChange($event, order)"
                        />
                        <span>Seleccionar</span>
                      </label>
                      <div class="sc-pending-order">
                        <strong>{{ order.order_number }}</strong>
                        <span class="sc-order-state">{{ orderStateLabel(order.state) }}</span>
                        @if (order.reasons.includes('operational')) {
                          <span class="sc-reason">Por finalizar</span>
                        }
                        @if (order.reasons.includes('balance')) {
                          <span class="sc-reason">Falta cobrar {{ (order.payment_amount_due ?? order.remaining_balance) | currency: 0 }}</span>
                        }
                        <a
                          [routerLink]="['/admin/orders', order.id]"
                          [attr.aria-label]="'Ver detalle de orden ' + order.order_number"
                        >Abrir</a>
                      </div>
                    </article>
                  }
                </div>
                @if (pending.count > pending.limit) {
                  <div class="sc-pending-pagination" aria-label="Paginación de órdenes pendientes">
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="pending.page <= 1 || pendingLoading()"
                      (clicked)="loadPendingPage(pending.page - 1)"
                    >Anterior</app-button>
                    <span>Página {{ pending.page }} de {{ pendingPageCount() }}</span>
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="pending.page >= pendingPageCount() || pendingLoading()"
                      (clicked)="loadPendingPage(pending.page + 1)"
                    >Siguiente</app-button>
                  </div>
                }
                @if (selectedPendingOrders().length > 0) {
                  <p class="sc-pending-selected" aria-live="polite">
                    {{ selectedPendingOrders().length }} órdenes seleccionadas
                  </p>
                  <app-button
                    variant="secondary"
                    size="sm"
                    [disabled]="pendingActionBusy()"
                    (clicked)="finalizeSelectedOrders()"
                  >
                    Completar {{ selectedPendingOrders().length }} órdenes
                  </app-button>
                }
              }
            }
          </section>
          }
        }
        <app-order-complete-modal
          [isOpen]="finishWorkflowOpen()"
          (isOpenChange)="onFinishModalOpenChange($event)"
          [order]="finishWorkflowCurrent()"
          [paymentMethods]="finishPaymentMethods()"
          [sequence]="finishWorkflowIndex() + 1"
          [completed]="finishWorkflowCompleted()"
          [total]="finishWorkflowOrders().length"
          [busy]="finishWorkflowBusy()"
          [error]="finishWorkflowError()"
          [failures]="finishWorkflowFailures()"
          (submitted)="processCurrentFinishOrder($event)"
          (skip)="skipFailedFinishOrder()"
        />

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
            helperText="Escribe el efectivo que contaste. Si contaste cero, escribe 0."
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

        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="sc-footer">
        @if (closedSession()) {
          <app-button
            variant="outline"
            size="md"
            (clicked)="printReport()"
            [disabled]="!report() || printing()"
          >
            <app-icon name="printer" [size]="16" slot="icon"></app-icon>
            Imprimir
          </app-button>
          <app-button variant="primary" size="md" (clicked)="finish()">
            Finalizar
          </app-button>
        } @else {
          <app-button variant="secondary" size="md" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            [variant]="expectedChanged() ? 'outline-warning' : 'primary'"
            size="md"
            (clicked)="onClose()"
            [disabled]="!canClose()"
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
        }
      </div>
    </app-modal>
    <app-modal
      [isOpen]="pendingCloseWarning() !== null"
      (isOpenChange)="onPendingWarningOpenChange($event)"
      [size]="'sm'"
      [centered]="true"
      [dialog]="true"
      [showCloseButton]="false"
      [closeOnBackdrop]="false"
      [closeOnEscape]="false"
      title="Órdenes pendientes"
    >
      <div class="sc-pending-confirm">
        <app-icon name="warning" [size]="56" class="sc-pending-confirm-icon"></app-icon>
        <p>
          Hay {{ pendingCloseWarning()?.count }}
          {{ pendingCloseWarning()?.count === 1 ? 'orden pendiente' : 'órdenes pendientes' }}
          de esta sesión. Si cierras la caja, seguirán pendientes y no se sumarán al efectivo esperado.
        </p>
        <p>¿Deseas cerrar la caja de todas formas?</p>
      </div>
      <div slot="footer" class="sc-footer">
        <app-button variant="outline" size="md" (clicked)="cancelPendingClose()">Volver</app-button>
        <app-button variant="outline-warning" size="md" (clicked)="confirmPendingClose()">Cerrar caja</app-button>
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

    .sc-pending-confirm {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 8px 4px;
      text-align: center;
      color: var(--color-text-primary);
    }

    .sc-pending-confirm p { margin: 0; }
    .sc-pending-confirm-icon { color: var(--color-warning-600); }

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

    .sc-pending {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--color-error-200);
      border-radius: 14px;
      background: var(--color-error-50);
      color: var(--color-text-primary);
    }

    .sc-pending-heading {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      color: var(--color-error-700);
    }

    .sc-pending-heading h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }

    .sc-pending-heading p {
      margin: 2px 0 0;
      font-size: 13px;
    }

    .sc-pending-note {
      margin: 0;
      color: var(--color-neutral-700);
      font-size: 12px;
    }

    .sc-pending-error,
    .sc-pending-changed {
      margin: 0;
      padding: 10px;
      border: 1px solid var(--color-warning-300);
      border-radius: 10px;
      background: var(--color-warning-50);
      color: var(--color-warning-800);
      font-size: 13px;
    }

    .sc-pending-changed {
      display: flex;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 8px;
    }

    .sc-pending-toggle {
      min-height: 44px;
      align-self: flex-start;
      padding: 8px 12px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-surface);
      color: var(--color-text-primary);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .sc-pending-toggle:focus-visible,
    .sc-pending-select-all input:focus-visible,
    .sc-pending-select input:focus-visible,
    .sc-pending-order a:focus-visible {
      outline: 3px solid var(--color-primary);
      outline-offset: 2px;
    }

    .sc-pending-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .sc-pending-select-all {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .sc-pending-select-all input {
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
      accent-color: var(--color-primary);
    }

    .sc-pending-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 4px 8px;
      border: 1px solid var(--color-border);
      border-radius: 10px;
      background: var(--color-surface);
    }

    .sc-pending-select {
      display: flex;
      align-items: center;
      gap: 5px;
      min-height: 44px;
      font-size: 12px;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .sc-pending-select input {
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
      accent-color: var(--color-primary);
    }

    .sc-pending-order {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      overflow-x: auto;
      white-space: nowrap;
      font-size: 12px;
      scrollbar-width: thin;
    }

    .sc-order-state { color: var(--color-text-secondary); }

    .sc-pending-order a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      color: var(--color-primary);
      font-weight: 600;
      text-decoration: underline;
    }

    .sc-reason { color: var(--color-warning-800); }

    .sc-pending-pagination {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
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

    .sc-report-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px;
      font-size: 13px;
      color: var(--color-neutral-600);
      text-align: center;
    }

    .sc-footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }

    @media (max-width: 420px) {
      .sc-footer app-button {
        flex: 1 1 100%;
      }
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
  readonly pendingOrders = signal<CashSessionPendingOrders | null>(null);
  readonly pendingLoading = signal(false);
  readonly pendingError = signal(false);
  readonly pendingExpanded = signal(false);
  readonly pendingPage = signal(1);
  readonly pendingFingerprint = signal<string | null>(null);
  readonly pendingSeenFingerprint = signal<string | null>(null);
  readonly pendingChanged = signal(false);
  readonly pendingCloseWarning = signal<{ count: number; expectedSeen: number; fingerprint: string } | null>(null);
  readonly selectedPending = signal<Record<number, CashSessionPendingOrder>>({});
  readonly pendingActionBusy = computed(
    () => this.pendingLoading() || this.finishWorkflowBusy(),
  );
  readonly finishWorkflowOpen = signal(false);
  readonly finishWorkflowBusy = signal(false);
  readonly finishWorkflowOrders = signal<CashSessionPendingOrder[]>([]);
  readonly finishWorkflowIndex = signal(0);
  readonly finishWorkflowCompleted = signal(0);
  readonly finishWorkflowError = signal('');
  readonly finishWorkflowFailures = signal<string[]>([]);
  readonly finishPaymentMethods = signal<StorePaymentMethod[]>([]);
  readonly finishWorkflowCurrent = computed(() => this.finishWorkflowOrders()[this.finishWorkflowIndex()] ?? null);
  readonly selectedPendingOrders = computed(() =>
    Object.values(this.selectedPending()),
  );
  readonly pendingPageCount = computed(() => {
    const pending = this.pendingOrders();
    return pending ? Math.max(1, Math.ceil(pending.count / pending.limit)) : 1;
  });

  /** Resumen autoritativo del backend. Nunca se recalcula acá. */
  readonly summary = signal<CashSessionSummary | null>(null);
  /** Esperado contra el que el operario está contando (lo que vio en pantalla). */
  readonly countedAgainst = signal<number | null>(null);
  /** Esperado viejo, seteado cuando detectamos que la cifra cambió. */
  readonly staleFrom = signal<number | null>(null);
  /** Hay una revalidación en vuelo. */
  readonly refreshing = signal(false);
  readonly expectedChanged = computed(() => this.staleFrom() !== null);

  /** Etiquetas de método de pago: compartidas con el reporte y el ticket. */
  readonly methodLabels = CASH_METHOD_LABELS;

  /** Sesión ya cerrada: activa el estado Resultado (el `session` input puede volverse null). */
  readonly closedSession = signal<CashRegisterSession | null>(null);
  readonly report = signal<CashSessionCloseReport | null>(null);
  readonly reportLoading = signal(false);
  readonly printing = signal(false);
  /** `sessionClosed` se emite una sola vez, al salir del estado Resultado. */
  private finished = false;

  form: FormGroup;

  private fb = inject(FormBuilder);
  private cashRegisterService = inject(PosCashRegisterService);
  private toastService = inject(ToastService);
  private reportPrint = inject(CashSessionReportPrintService);
  private paymentMethodsService = inject(PaymentMethodsService);

  constructor() {
    this.form = this.fb.group({
      actual_closing_amount: [null, [Validators.required, Validators.min(0)]],
      closing_notes: [''],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.finished = false;
          this.closedSession.set(null);
          this.report.set(null);
          this.reportLoading.set(false);
          this.printing.set(false);
          this.difference.set(null);
          this.summary.set(null);
          this.countedAgainst.set(null);
          this.staleFrom.set(null);
          this.refreshing.set(false);
          this.submitting.set(false);
          this.pendingOrders.set(null);
          this.pendingLoading.set(false);
          this.pendingError.set(false);
          this.pendingExpanded.set(false);
          this.pendingPage.set(1);
          this.pendingFingerprint.set(null);
          this.pendingSeenFingerprint.set(null);
          this.pendingChanged.set(false);
          this.pendingCloseWarning.set(null);
          this.selectedPending.set({});
          this.form.reset({ actual_closing_amount: null, closing_notes: '' });
          this.refreshCloseState();
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
          return session && !this.closedSession()
            ? forkJoin({
                summary: this.cashRegisterService.getCashSummary(session.id),
                pending: this.cashRegisterService.getPendingOrders(
                  session.id,
                  this.pendingPage(),
                ),
              }).pipe(catchError(() => EMPTY))
            : EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((next) => {
        this.pendingLoading.set(false);
        this.pendingError.set(false);
        this.applySummary(next.summary);
        this.applyPendingOrders(next.pending);
      });

    if (typeof window !== 'undefined') {
      fromEvent(window, 'focus')
        .pipe(
          filter(() => this.isOpen() && !this.closedSession()),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe(() => this.refreshCloseState());
    }
  }

  refreshCloseState(options: { afterPendingOrderProcessing?: boolean } = {}): void {
    const session = this.session();
    if (!session) return;
    this.pendingLoading.set(true);
    this.pendingError.set(false);
    forkJoin({
      summary: this.cashRegisterService.getCashSummary(session.id),
      pending: this.cashRegisterService.getPendingOrders(
        session.id,
        this.pendingPage(),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, pending }) => {
          this.pendingLoading.set(false);
          this.applySummary(summary);
          this.applyPendingOrders(pending);
          if (options.afterPendingOrderProcessing) {
            // Completar órdenes puede registrar pagos en efectivo y cambiar el
            // esperado. Es un cambio provocado desde este mismo modal: adopta
            // el resumen fresco, actualiza la lista y exige un nuevo conteo
            // físico antes de permitir cerrar.
            this.countedAgainst.set(summary.expected_cash_total);
            this.staleFrom.set(null);
            this.pendingSeenFingerprint.set(pending.fingerprint);
            this.pendingChanged.set(false);
            this.selectedPending.set({});
            this.form.get('actual_closing_amount')?.reset(null);
            this.toastService.info(
              'Resumen actualizado. Vuelve a contar el efectivo antes de cerrar.',
            );
          }
        },
        error: (err) => {
          this.pendingLoading.set(false);
          this.pendingError.set(true);
          this.toastService.error(cashCloseErrorMessage(err, 'No pudimos cargar las órdenes pendientes.'));
        },
      });
  }

  private applyPendingOrders(next: CashSessionPendingOrders): void {
    const previous = this.pendingFingerprint();
    this.pendingOrders.set(next);
    this.pendingFingerprint.set(next.fingerprint);
    if (this.pendingSeenFingerprint() === null) {
      this.pendingSeenFingerprint.set(next.fingerprint);
    } else if (previous !== next.fingerprint) {
      this.pendingChanged.set(true);
      this.selectedPending.set({});
    }
    if (next.count === 0 && next.tracking_enabled) {
      this.pendingCloseWarning.set(null);
    }
  }

  acknowledgePendingChanges(): void {
    const fingerprint = this.pendingFingerprint();
    if (fingerprint === null) return;
    this.pendingSeenFingerprint.set(fingerprint);
    this.pendingChanged.set(false);
  }

  canClose(): boolean {
    const pending = this.pendingOrders();
    const hasSummary = this.summary() !== null;
    if (
      !this.form.valid ||
      !hasSummary ||
      !pending ||
      this.submitting() ||
      this.refreshing() ||
      this.pendingLoading() ||
      this.pendingChanged()
    ) {
      return false;
    }
    return true;
  }

  togglePendingExpanded(): void {
    this.pendingExpanded.update((expanded) => !expanded);
    if (this.pendingExpanded()) this.loadPendingPage(this.pendingPage());
  }

  loadPendingPage(page: number): void {
    const session = this.session();
    if (!session || page < 1 || page > this.pendingPageCount()) return;
    this.pendingPage.set(page);
    this.pendingLoading.set(true);
    this.pendingError.set(false);
    this.cashRegisterService
      .getPendingOrders(session.id, page)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (pending) => {
          this.pendingLoading.set(false);
          this.applyPendingOrders(pending);
        },
        error: (err) => {
          this.pendingLoading.set(false);
          this.pendingError.set(true);
          this.toastService.error(cashCloseErrorMessage(err, 'No pudimos cargar las órdenes pendientes.'));
        },
      });
  }

  isPendingOrderSelected(order_id: number): boolean {
    return Object.hasOwn(this.selectedPending(), order_id);
  }

  areAllPendingOrdersSelected(): boolean {
    const count = this.pendingOrders()?.count ?? 0;
    return count > 0 && this.selectedPendingOrders().length >= Math.min(count, 100);
  }

  orderStateLabel(state: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      pending: 'Pendiente',
      pending_payment: 'Pago pendiente',
      processing: 'En proceso',
      shipped: 'Enviada',
      delivered: 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };
    return labels[state.toLowerCase()] ?? state;
  }

  onSelectAllPendingChange(event: Event): void {
    const checkbox = event.currentTarget as HTMLInputElement;
    const checked = checkbox.checked;
    if (!checked) {
      this.selectedPending.set({});
      return;
    }

    const session = this.session();
    const pending = this.pendingOrders();
    if (!session || !pending || pending.count === 0 || this.pendingActionBusy()) return;

    this.pendingLoading.set(true);
    this.cashRegisterService.getPendingOrders(session.id, 1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.pendingLoading.set(false);
          if (result.fingerprint !== pending.fingerprint) {
            this.toastService.warning('Las órdenes cambiaron. Actualiza la lista e inténtalo de nuevo.');
            this.refreshCloseState();
            return;
          }
          this.selectedPending.set(
            Object.fromEntries(result.data.filter((order) => order.version !== null).map((order) => [order.id, order])),
          );
          if (pending.count > result.data.length) {
            this.toastService.warning(
              `Puedes finalizar hasta ${result.data.length} órdenes por vez. Después podrás seleccionar las demás.`,
            );
          }
        },
        error: (err) => {
          this.pendingLoading.set(false);
          checkbox.checked = false;
          this.toastService.error(cashCloseErrorMessage(err, 'No pudimos seleccionar las órdenes. Inténtalo de nuevo.'));
        },
      });
  }

  onPendingSelectionChange(event: Event, order: CashSessionPendingOrder): void {
    const checked = (event.currentTarget as HTMLInputElement).checked;
    if (checked && !this.isPendingOrderSelected(order.id) && this.selectedPendingOrders().length >= 100) {
      (event.currentTarget as HTMLInputElement).checked = false;
      this.toastService.warning('Puedes finalizar hasta 100 órdenes por vez.');
      return;
    }
    this.selectedPending.update((selected) => {
      const next = { ...selected };
      if (checked) next[order.id] = order;
      else delete next[order.id];
      return next;
    });
  }

  finalizeSelectedOrders(): void {
    const orders = this.selectedPendingOrders();
    if (!this.pendingOrders() || !this.session() || orders.length === 0 || this.pendingActionBusy()) return;
    if (orders.some((order) => order.version === null)) {
      this.toastService.warning('No pudimos verificar una orden. Actualiza la lista e inténtalo de nuevo.');
      this.refreshCloseState();
      return;
    }
    this.finishWorkflowOrders.set(orders);
    this.finishWorkflowIndex.set(0);
    this.finishWorkflowCompleted.set(0);
    this.finishWorkflowError.set('');
    this.finishWorkflowFailures.set([]);
    this.finishWorkflowOpen.set(true);
    this.paymentMethodsService.getStorePaymentMethods({ state: PaymentMethodState.ENABLED, page: 1, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const methods = Array.isArray(result)
            ? result
            : Array.isArray(result?.data)
              ? result.data
              : Array.isArray((result as any)?.data?.data)
                ? (result as any).data.data
                : [];
          this.finishPaymentMethods.set(
            methods.filter((method: StorePaymentMethod) => method.state === PaymentMethodState.ENABLED),
          );
        },
        error: () => this.finishPaymentMethods.set([]),
      });
  }

  processCurrentFinishOrder(submission: OrderCompletionSubmission): void {
    const order = this.finishWorkflowCurrent();
    if (!order || this.finishWorkflowBusy()) return;
    const session = this.session();
    if (!session) return;
    if (order.version === null) {
      this.finishWorkflowError.set(
        `${order.order_number} no tiene una versión actual. Actualiza las órdenes antes de continuar.`,
      );
      this.refreshCloseState();
      return;
    }
    this.finishWorkflowBusy.set(true);
    this.finishWorkflowError.set('');
    this.cashRegisterService.processCashSessionOrder(session.id, order.id, order.version, submission.flow, submission.shipping)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: unknown) => {
          const finalState = (result as { state?: string } | null)?.state;
          if (finalState !== 'finished') {
            this.finishWorkflowBusy.set(false);
            this.finishWorkflowError.set(
              `${order.order_number} quedó despachada y sigue pendiente de entrega. Confirma la entrega cuando el cliente reciba el pedido.`,
            );
            return;
          }
          this.advanceFinishWorkflow();
        },
        error: (err) => {
          this.finishWorkflowBusy.set(false);
          const { code } = extractApiError(err);
          if (code === STALE_ORDER_CODE || code === EXPECTED_STALE_CODE) {
            this.reloadCurrentFinishOrder(session.id, order);
            return;
          }
          this.finishWorkflowError.set(
            code === 'ORD_FAST_TRACK_PAYMENT_REQUIRED_001'
              ? 'Selecciona un método de pago y registra el saldo pendiente para continuar.'
              : extractApiError(err).message || `No se pudo completar ${order.order_number}.`,
          );
        },
      });
  }

  private reloadCurrentFinishOrder(
    sessionId: number,
    order: CashSessionPendingOrder,
  ): void {
    this.cashRegisterService
      .getPendingOrders(sessionId, 1, 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (latest) => {
          const refreshedOrder = latest.data.find((candidate) => candidate.id === order.id);
          if (!refreshedOrder) {
            this.finishWorkflowError.set(
              `${order.order_number} ya no aparece entre las órdenes pendientes. Actualiza la lista antes de continuar.`,
            );
            this.refreshCloseState();
            return;
          }
          this.finishWorkflowOrders.update((orders) =>
            orders.map((candidate) =>
              candidate.id === refreshedOrder.id ? refreshedOrder : candidate,
            ),
          );
          this.finishWorkflowError.set('');
          this.toastService.info(
            `${order.order_number} cambió. Revisa el resumen actualizado y vuelve a procesarla.`,
          );
          this.refreshCloseState();
        },
        error: () => {
          this.finishWorkflowError.set(
            `No pudimos actualizar ${order.order_number}. Actualiza las órdenes e inténtalo de nuevo.`,
          );
        },
      });
  }

  skipFailedFinishOrder(): void {
    const order = this.finishWorkflowCurrent();
    if (!order || this.finishWorkflowBusy() || !this.finishWorkflowError()) return;
    this.finishWorkflowFailures.update((items) => [...items, `${order.order_number}: ${this.finishWorkflowError()}`]);
    this.advanceFinishWorkflow(false);
  }

  private advanceFinishWorkflow(success = true): void {
    this.finishWorkflowBusy.set(false);
    if (success) this.finishWorkflowCompleted.update((count) => count + 1);
    this.finishWorkflowIndex.update((index) => index + 1);
    this.finishWorkflowError.set('');
    const next = this.finishWorkflowCurrent();
    if (!next) {
      this.selectedPending.set({});
      this.refreshCloseState({ afterPendingOrderProcessing: true });
      const failed = this.finishWorkflowFailures();
      if (failed.length) this.toastService.warning(`${this.finishWorkflowCompleted()} órdenes procesadas; ${failed.length} quedaron pendientes.`);
    }
  }

  onFinishModalOpenChange(open: boolean): void {
    if (!open) this.closeFinishWorkflow();
    else this.finishWorkflowOpen.set(true);
  }

  closeFinishWorkflow(): void {
    if (this.finishWorkflowBusy()) return;
    this.finishWorkflowOpen.set(false);
    if (this.finishWorkflowCompleted() > 0 || this.finishWorkflowFailures().length > 0) this.refreshCloseState();
  }

  private httpStatus(err: unknown): number | null {
    const value = (err as { status?: unknown } | null)?.status;
    return typeof value === 'number' ? value : null;
  }

  /**
   * Adopta un resumen del backend y decide si el esperado quedó rancio.
   *
   * El primer resumen de cada apertura fija la línea base: es la cifra contra la
   * que el operario empieza a contar.
   */
  private applySummary(next: CashSessionSummary): void {
    if (this.closedSession()) return;
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
    if (!this.canClose() || !this.session()) return;
    if (this.submitting() || this.refreshing()) return;
    if (this.pendingChanged()) {
      this.toastService.warning('Revisa y confirma las órdenes pendientes actuales antes de cerrar.');
      return;
    }

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

    // Revalidar efectivo y la huella de toda la lista ANTES de enviar. El
    // polling puede llegar hasta 10s tarde; esto cierra la ventana entre el
    // último refresco y el click.
    const seenFingerprint = this.pendingSeenFingerprint();
    forkJoin({
      summary: this.cashRegisterService.getCashSummary(this.session()!.id),
      pending: this.cashRegisterService.getPendingOrders(
        this.session()!.id,
        this.pendingPage(),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary: fresh, pending }) => {
          const counted = this.countedAgainst();
          this.applySummary(fresh);
          this.applyPendingOrders(pending);

          if (
            seenFingerprint === null ||
            pending.fingerprint !== seenFingerprint ||
            this.pendingChanged()
          ) {
            this.refreshing.set(false);
            this.toastService.warning(
              'Las órdenes pendientes cambiaron. Revisa la lista actual y vuelve a cerrar.',
            );
            return;
          }

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

          if (pending.count > 0) {
            this.refreshing.set(false);
            this.pendingCloseWarning.set({
              count: pending.count,
              expectedSeen: counted,
              fingerprint: pending.fingerprint,
            });
            return;
          }

          const pendingDecision: CashSessionCloseDecision = {
            pending_decision: 'resolved',
            pending_fingerprint: pending.fingerprint,
          };
          this.submitClose(counted, pendingDecision);
        },
        // Nunca enviamos a ciegas: si no podemos confirmar el esperado, no hay
        // cierre.
        error: (err) => {
          this.refreshing.set(false);
          this.toastService.error(cashCloseErrorMessage(err, 'No pudimos actualizar el efectivo y las órdenes pendientes.'));
        },
      });
  }

  onPendingWarningOpenChange(open: boolean): void {
    if (!open) this.pendingCloseWarning.set(null);
  }

  cancelPendingClose(): void {
    this.pendingCloseWarning.set(null);
  }

  confirmPendingClose(): void {
    const warning = this.pendingCloseWarning();
    if (!warning || this.submitting()) return;
    this.pendingCloseWarning.set(null);
    this.submitClose(warning.expectedSeen, {
      pending_decision: 'override',
      pending_fingerprint: warning.fingerprint,
      override_reason: 'Cierre confirmado por el usuario desde el aviso de órdenes pendientes.',
    });
  }

  private submitClose(
    expectedSeen: number,
    pendingDecision: CashSessionCloseDecision,
  ): void {
    this.submitting.set(true);

    const { actual_closing_amount, closing_notes } = this.form.value;

    this.cashRegisterService
      .closeSession(
        this.session()!.id,
        Number(actual_closing_amount),
        closing_notes,
        expectedSeen,
        pendingDecision,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (closedSession) => {
          this.submitting.set(false);
          this.refreshing.set(false);
          this.difference.set(Number(closedSession.difference || 0));
          this.toastService.success('Caja cerrada correctamente');
          // El modal NO se cierra: pasa al estado Resultado. `sessionClosed`
          // se emite al salir (finish) para que el POS siga mostrando la
          // diferencia y abriendo el Resumen IA después.
          this.closedSession.set(closedSession);
          this.loadReport();
        },
        error: (err) => this.onCloseError(err),
      });
  }

  private onCloseError(err: unknown): void {
    this.submitting.set(false);
    this.refreshing.set(false);

    const { code } = extractApiError(err);

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
      this.refreshCloseState();

      this.toastService.warning(cashCloseErrorMessage(
        err,
        'El efectivo esperado cambió mientras contabas. Revisa el resumen actualizado antes de cerrar.',
      ));
      return;
    }

    if (
      code?.includes('PENDING') ||
      this.httpStatus(err) === 409
    ) {
      this.refreshCloseState();
      this.toastService.warning(cashCloseErrorMessage(
        err,
        'Las órdenes o el efectivo cambiaron. Revisa la información actualizada antes de cerrar.',
      ));
      return;
    }

    this.toastService.error(cashCloseErrorMessage(err, 'No se pudo cerrar la caja. Inténtalo de nuevo.'));
  }

  /** Carga (o reintenta) el reporte consolidado de la sesión recién cerrada. */
  loadReport(): void {
    const closed = this.closedSession();
    if (!closed) return;
    this.reportLoading.set(true);
    this.cashRegisterService
      .getCloseReport(closed.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          if (this.closedSession()?.id !== report.session.id) return;
          this.report.set(report);
          this.reportLoading.set(false);
        },
        error: () => {
          this.report.set(null);
          this.reportLoading.set(false);
        },
      });
  }

  async printReport(): Promise<void> {
    const report = this.report();
    if (!report || this.printing()) return;
    this.printing.set(true);
    try {
      await this.reportPrint.print(report);
    } catch {
      this.toastService.error('No se pudo imprimir el resumen del cierre');
    } finally {
      this.printing.set(false);
    }
  }

  /** Sale del estado Resultado: emite `sessionClosed` una sola vez y cierra. */
  finish(): void {
    const closed = this.closedSession();
    if (!closed || this.finished) return;
    this.finished = true;
    this.sessionClosed.emit(closed);
    this.isOpenChange.emit(false);
  }

  onModalOpenChange(open: boolean): void {
    if (!open && this.closedSession()) {
      this.finish();
      return;
    }
    this.isOpenChange.emit(open);
  }

  onCancel() {
    if (this.closedSession()) {
      this.finish();
      return;
    }
    this.isOpenChange.emit(false);
  }
}
