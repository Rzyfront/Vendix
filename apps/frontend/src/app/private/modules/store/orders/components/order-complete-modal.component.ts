import {
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../shared/components';
import { StorePaymentMethod } from '../../settings/payments/interfaces/payment-methods.interface';
import {
  FastTrackOrderDto,
  AssignShippingMethodDto,
} from '../interfaces/order.interface';
import { ShippingMethodsService } from '../../settings/shipping/services/shipping-methods.service';
import { StoreShippingMethod } from '../../settings/shipping/interfaces/shipping-methods.interface';
import { PaymentMethodsService } from '../../settings/payments/services/payment-methods.service';
import { PaymentMethodState } from '../../settings/payments/interfaces/payment-methods.interface';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';
import { SETTLED_PAYMENT_STATES_FE } from '../utils/order-settlement.util';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import type { IconName } from '../../../../../shared/components/icon/icons.registry';

export interface OrderCompletionSubmission {
  flow: FastTrackOrderDto;
  shipping?: AssignShippingMethodDto;
}

export interface OrderCompletionSummary {
  id: number;
  order_number: string;
  state: string;
  grand_total?: number | string;
  payment_form?: string | null;
  remaining_balance?: number | string;
  payment_required?: boolean;
  payment_amount_due?: number | string;
  delivery_type?: string | null;
  all_items_delivered?: boolean;
  order_items?: Array<{
    delivered_at?: string | null;
    cancelled_at?: string | null;
  }>;
  shipping_method_id?: number | null;
  shipping_cost?: number | string | null;
  payments?: Array<{
    state?: string;
    amount?: number | string;
    store_payment_method?: {
      display_name?: string | null;
      system_payment_method?: { display_name?: string };
    };
  }>;
}

interface OrderWorkflowStep {
  key: string;
  label: string;
  shortLabel: string;
  detail: string;
  icon: IconName;
  status: 'done' | 'active' | 'waiting';
  statusLabel: string;
}

/** Modal compartido para completar una orden y para procesar órdenes del cierre de caja. */
@Component({
  selector: 'app-order-complete-modal',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ModalComponent, CurrencyPipe],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      (closed)="isOpen.set(false)"
      (cancel)="isOpen.set(false)"
      [title]="modalTitle()"
      [subtitle]="order()?.order_number || ''"
      size="md"
      [customClasses]="'max-w-[460px]'"
      [dialog]="true"
    >
      <div class="space-y-4 p-4">
        @if (order() && total() > 1) {
          <section class="rounded-xl border border-border bg-surface p-3 space-y-2">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="font-semibold">Avance del cierre</span>
              <span class="text-text-secondary">{{ completed() }} de {{ total() }} órdenes listas</span>
            </div>
            <div
              class="h-2 overflow-hidden rounded-full bg-gray-200"
              role="progressbar"
              [attr.aria-valuenow]="completed()"
              [attr.aria-valuemax]="total()"
              [attr.aria-label]="'Órdenes completadas: ' + completed() + ' de ' + total()"
            >
              <div
                class="h-full rounded-full bg-primary-600 transition-all"
                [style.width.%]="progress()"
              ></div>
            </div>
            <p class="text-xs text-text-secondary">
              Procesando orden {{ currentSequence() }} de {{ total() }}
            </p>
          </section>
        }

        @if (order()) {
          <section class="rounded-2xl border border-border bg-[var(--color-surface)] px-2 py-3">
            <div class="relative flex items-start justify-between gap-1">
              <div class="absolute left-[12%] right-[12%] top-3.5 h-0.5 bg-[var(--color-border)]"></div>
              <div class="absolute left-[12%] top-3.5 h-0.5 bg-emerald-500 transition-all" [style.width.%]="stepperProgress()"></div>
              @for (step of workflowSteps(); track step.key; let index = $index) {
                <div class="relative z-10 flex min-w-0 flex-1 flex-col items-center text-center">
                  <span
                    class="flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-[var(--color-surface)]"
                    [class.bg-emerald-100]="step.status === 'done'"
                    [class.text-emerald-700]="step.status === 'done'"
                    [style.background-color]="step.status === 'active' ? 'var(--color-primary)' : null"
                    [class.text-white]="step.status === 'active'"
                    [class.bg-gray-100]="step.status === 'waiting'"
                    [class.text-gray-500]="step.status === 'waiting'"
                  >
                    @if (step.status === 'done') {
                      <app-icon name="check" [size]="14" />
                    } @else {
                      <app-icon [name]="step.icon" [size]="14" />
                    }
                  </span>
                  <span class="mt-1.5 text-[11px] font-semibold leading-tight"
                    [class.text-emerald-700]="step.status === 'done'"
                    [style.color]="step.status === 'active' ? 'var(--color-primary)' : null"
                    [class.text-text-secondary]="step.status === 'waiting'"
                  >{{ index + 1 }}. {{ step.shortLabel }}</span>
                  <span class="mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                    [class.bg-emerald-50]="step.status === 'done'"
                    [class.text-emerald-700]="step.status === 'done'"
                    [style.background-color]="step.status === 'active' ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : null"
                    [style.color]="step.status === 'active' ? 'var(--color-primary)' : null"
                    [class.bg-gray-100]="step.status === 'waiting'"
                    [class.text-gray-500]="step.status === 'waiting'"
                  >{{ step.statusLabel }}</span>
                </div>
              }
            </div>
          </section>

          <section class="rounded-xl border border-border bg-gray-50 p-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold uppercase tracking-wide text-text-secondary">Resumen de la orden</p>
                <p class="mt-1 font-bold text-text-primary">{{ order()?.order_number }}</p>
                <p class="text-sm text-text-secondary">{{ orderTypeLabel() }} · {{ stateLabel() }}</p>
              </div>
              <div class="shrink-0 text-right">
                @if (grandTotal() > 0) {
                  <p class="text-xs text-text-secondary">Total</p>
                  <p class="font-semibold">{{ grandTotal() | currency }}</p>
                }
                @if (needsPayment()) {
                  <p class="mt-1 text-xs font-semibold text-amber-700">
                    Falta cobrar {{ amountDue() | currency }}
                  </p>
                }
              </div>
            </div>
          </section>

          <section class="space-y-2">
            <h4 class="px-1 text-xs font-bold uppercase tracking-wide text-text-secondary">Resumen de pasos</h4>
            @for (step of workflowSteps(); track step.key) {
              <article class="flex items-start gap-3 rounded-2xl border bg-white p-3"
                [class.border-emerald-200]="step.status === 'done'"
                [style.border-color]="step.status === 'active' ? 'var(--color-primary)' : null"
                [class.border-border]="step.status === 'waiting'"
              >
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  [class.bg-emerald-100]="step.status === 'done'"
                  [class.text-emerald-700]="step.status === 'done'"
                  [style.background-color]="step.status === 'active' ? 'var(--color-primary)' : null"
                  [class.text-white]="step.status === 'active'"
                  [class.bg-gray-100]="step.status === 'waiting'"
                  [class.text-gray-500]="step.status === 'waiting'"
                >
                  @if (step.status === 'done') {
                    <app-icon name="check" [size]="16" />
                  } @else {
                    <app-icon [name]="step.icon" [size]="16" />
                  }
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h4 class="text-xs font-bold text-text-primary">{{ step.label }}</h4>
                    <span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                      [class.bg-emerald-100]="step.status === 'done'"
                      [class.text-emerald-800]="step.status === 'done'"
                      [style.background-color]="step.status === 'active' ? 'var(--color-primary)' : null"
                      [class.text-white]="step.status === 'active'"
                      [class.bg-gray-100]="step.status === 'waiting'"
                      [class.text-gray-600]="step.status === 'waiting'"
                    >{{ step.statusLabel }}</span>
                  </div>
                  <p class="mt-0.5 text-[11px] leading-snug text-text-secondary">{{ step.detail }}</p>
                </div>
              </article>
            }
          </section>

          <div
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-3"
          >
            <app-icon
              name="alert-triangle"
              size="18"
              class="text-amber-600 mt-0.5"
            ></app-icon>
            <div>
              <p class="text-sm font-bold text-amber-800">
                Acción automática
              </p>
              <p class="text-xs text-amber-700 mt-0.5">
                Al continuar se ejecutarán los pasos pendientes en orden.
                Confirma la entrega solo si el cliente ya recibió el pedido.
              </p>
            </div>
          </div>

          @if (error()) {
            <p
              class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              role="alert"
            >
              {{ error() }}
            </p>
          }
          @if (needsPayment()) {
            <section class="rounded-2xl border border-primary-200 bg-white p-3.5 space-y-3">
              <div class="flex items-center gap-2.5 border-b border-border pb-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                  <app-icon name="credit-card" [size]="16" />
                </span>
                <div class="min-w-0 flex-1">
                  <h4 class="text-xs font-bold text-text-primary">Pago pendiente</h4>
                  <p class="text-[11px] text-text-secondary">Registra el saldo para completar la orden</p>
                </div>
                <span class="text-xs font-bold text-text-primary">{{ amountDue() | currency }}</span>
              </div>
              <label class="block text-sm font-medium"
                >Método de pago
                <select
                  class="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2"
                  required
                  [value]="paymentMethodId()"
                  (change)="paymentMethodId.set($any($event.target).value)"
                >
                  <option value="">Selecciona un método</option>
                  @for (method of availablePaymentMethods(); track method.id) {
                    <option [value]="method.id">
                      {{ method.display_name }}
                    </option>
                  }
                </select>
                @if (paymentMethodsLoading()) {
                  <p class="mt-1 text-xs text-text-secondary">Cargando métodos de pago…</p>
                } @else if (availablePaymentMethods().length === 0) {
                  <p class="mt-1 text-xs text-amber-700">No hay métodos de pago activos en la tienda.</p>
                }
              </label>
              <label class="block text-sm font-medium"
                >Monto por cobrar
                <input
                  class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                  type="number"
                  min="0.01"
                  [max]="amountDue()"
                  step="0.01"
                  [value]="amount()"
                  (input)="amount.set(+$any($event.target).value)"
                />
              </label>
              <p class="text-xs text-text-secondary">Debe registrarse el saldo completo.</p>
              @if (!hasSelectedPaymentMethod()) {
                <p class="text-xs text-amber-700">Selecciona un método de pago activo para continuar.</p>
              } @else if (!hasFullPaymentAmount()) {
                <p class="text-xs text-amber-700">El monto debe coincidir con el saldo pendiente.</p>
              }
              <label class="block text-sm font-medium"
                >Referencia (opcional)
                <input
                  class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                  [value]="reference()"
                  (input)="reference.set($any($event.target).value)"
                />
              </label>
            </section>
          } @else {
            <p
              class="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-white p-3.5 text-xs text-emerald-800"
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
                <app-icon name="check" [size]="16" />
              </span>
              <span>
              @if (order()?.payment_form === '2') {
                La orden está a crédito; no requiere cobro ahora.
              } @else if (settledPaymentTotal() > 0) {
                {{ paymentMethodLabel() }} · {{ settledPaymentTotal() | currency }}
              } @else {
                El pago ya está registrado.
              }
              </span>
            </p>
          }

          @if (
            requiresShipping() &&
            (needsShippingConfiguration() || needsDispatch() || needsDelivery())
          ) {
            <section class="rounded-2xl border border-border bg-white p-3.5 space-y-3">
              <div class="flex items-center gap-2.5 border-b border-border pb-2.5">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-text-secondary">
                  <app-icon name="truck" [size]="16" />
                </span>
                <div>
                  <h4 class="text-xs font-bold text-text-primary">Despacho y envío</h4>
                  <p class="text-[11px] text-text-secondary">Completa los datos que falten</p>
                </div>
              </div>
              @if (needsShippingConfiguration()) {
                <label class="block text-sm font-medium"
                  >Método de envío
                  <select
                    class="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2"
                    [value]="shippingMethodId()"
                    [disabled]="shippingMethodsLoading() || shippingMethods().length === 0"
                    (change)="shippingMethodId.set(+$any($event.target).value)"
                  >
                    <option [value]="0">Selecciona un método</option>
                    @for (method of shippingMethods(); track method.id) {
                      <option [value]="method.id">{{ method.name }}</option>
                    }
                  </select>
                @if (shippingMethodsLoading()) {
                  <p class="mt-1 text-xs text-text-secondary">Cargando métodos de envío…</p>
                } @else if (shippingMethods().length === 0) {
                  <p class="mt-1 text-xs text-amber-700">No hay métodos de envío activos en la tienda.</p>
                }
                </label>
                <label class="block text-sm font-medium"
                  >Valor del envío
                  <input
                    class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    type="number"
                    min="0"
                    step="0.01"
                    [value]="shippingCost()"
                    (input)="onShippingCostChange(+$any($event.target).value)"
                  />
                </label>
              }
              @if (needsDispatch()) {
                <label class="block text-sm font-medium"
                  >Transportista (opcional)
                  <input
                    class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    [value]="carrier()"
                    (input)="carrier.set($any($event.target).value)"
                  />
                </label>
                <label class="block text-sm font-medium"
                  >Número de rastreo (opcional)
                  <input
                    class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    [value]="trackingNumber()"
                    (input)="trackingNumber.set($any($event.target).value)"
                  />
                </label>
                <label class="block text-sm font-medium"
                  >Notas del envío (opcional)
                  <textarea
                    class="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    rows="2"
                    [value]="shippingNotes()"
                    (input)="shippingNotes.set($any($event.target).value)"
                  ></textarea>
                </label>
              }
            </section>
          }

          @if (needsDelivery()) {
            <section class="rounded-2xl border border-border bg-white p-3 space-y-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex min-w-0 items-start gap-2.5">
                      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-text-secondary">
                        <app-icon name="package-check" [size]="16" />
                      </span>
                      <div>
                        <h4 class="text-xs font-bold text-text-primary">Confirmar entrega</h4>
                        <p class="mt-0.5 text-[11px] text-text-secondary">¿El cliente ya recibió el pedido?</p>
                      </div>
                    </div>
                    <label class="relative inline-flex shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        class="peer sr-only"
                        [checked]="confirmDelivery()"
                        (change)="confirmDelivery.set($any($event.target).checked)"
                        aria-label="Confirmar que el cliente recibió el pedido"
                      />
                      <span class="relative h-5 w-9 rounded-full bg-gray-300 transition peer-checked:bg-[var(--color-primary)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-primary)] peer-focus-visible:ring-offset-2 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"></span>
                    </label>
                  </div>
                  @if (confirmDelivery()) {
                    <div class="border-t border-border pt-3 space-y-2.5">
                      <label class="block text-xs font-semibold text-text-primary">Recibido por (opcional)
                        <div class="relative mt-1">
                          <input
                            class="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/10"
                            [value]="deliveredTo()"
                            (input)="deliveredTo.set($any($event.target).value)"
                            placeholder="Nombre de quien recibió"
                          />
                        </div>
                      </label>
                      <label class="block text-xs font-semibold text-text-primary">Nota de entrega (opcional)
                        <textarea
                          class="mt-1 w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm focus:border-primary-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-500/10"
                          rows="2"
                          [value]="deliveryNotes()"
                          (input)="deliveryNotes.set($any($event.target).value)"
                          placeholder="Agrega un comentario si hace falta"
                        ></textarea>
                      </label>
                    </div>
                  } @else {
                    <p class="rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      La orden se despachará y quedará pendiente de entrega. No se marcará como finalizada.
                    </p>
                  }
            </section>
          } @else {
            <div class="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
              <app-icon name="check-circle" [size]="16" class="mr-2 shrink-0" />
              <span>La entrega ya está confirmada.</span>
            </div>
          }
        } @else {
          <p class="text-sm font-semibold text-emerald-700">
            Proceso terminado: {{ completed() }} órdenes finalizadas.
          </p>
          @if (failures().length > 0) {
            <div
              class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p class="font-semibold">
                {{ failures().length }} órdenes quedaron pendientes:
              </p>
              <ul class="mt-1 list-disc pl-5">
                @for (failure of failures(); track $index) {
                  <li>{{ failure }}</li>
                }
              </ul>
            </div>
          }
        }
      </div>
      <div
        slot="footer"
        class="flex flex-nowrap items-center justify-end gap-1.5 border-t border-border p-2 md:gap-2 md:p-4"
      >
        <app-button
          size="xsm"
          class="shrink-0 whitespace-nowrap"
          variant="outline"
          [disabled]="busy()"
          (clicked)="isOpen.set(false)"
          >{{ order() ? 'Cancelar' : 'Cerrar' }}</app-button
        >
        @if (order()) {
          @if (error()) {
            <app-button
              size="xsm"
              class="shrink-0 whitespace-nowrap"
              variant="outline"
              [disabled]="busy()"
              (clicked)="skip.emit()"
              >Dejar pendiente</app-button
            >
          }
          <app-button
            size="xsm"
            class="shrink-0 whitespace-nowrap"
            variant="primary"
            [disabled]="busy() || !canSubmit()"
            (clicked)="submit()"
          >
            {{
              submitLabel()
            }}
            <app-icon name="arrow-right" [size]="16" slot="icon" />
          </app-button>
        }
      </div>
    </app-modal>
  `,
})
export class OrderCompleteModalComponent {
  readonly isOpen = model(false);
  readonly order = input<OrderCompletionSummary | null>(null);
  readonly paymentMethods = input<StorePaymentMethod[]>([]);
  private readonly paymentMethodsFallback = signal<StorePaymentMethod[]>([]);
  readonly availablePaymentMethods = computed(() =>
    (this.paymentMethods().length > 0 ? this.paymentMethods() : this.paymentMethodsFallback())
      .filter((method: StorePaymentMethod) => method.state === PaymentMethodState.ENABLED),
  );
  readonly paymentMethodsLoading = signal(false);
  readonly sequence = input(1);
  readonly completed = input(0);
  readonly total = input(1);
  readonly busy = input(false);
  readonly error = input('');
  readonly failures = input<string[]>([]);
  readonly submitted = output<OrderCompletionSubmission>();
  readonly skip = output<void>();

  readonly paymentMethodId = signal('');
  readonly amount = signal(0);
  readonly reference = signal('');
  readonly carrier = signal('');
  readonly trackingNumber = signal('');
  readonly shippingNotes = signal('');
  readonly deliveredTo = signal('');
  readonly deliveryNotes = signal('');
  readonly confirmDelivery = signal(false);
  readonly shippingMethodId = signal(0);
  readonly shippingCost = signal(0);
  readonly shippingMethods = signal<StoreShippingMethod[]>([]);
  readonly shippingMethodsLoading = signal(false);
  private readonly shippingMethodsService = inject(ShippingMethodsService);
  private readonly paymentMethodsService = inject(PaymentMethodsService);
  private readonly destroyRef = inject(DestroyRef);
  readonly balance = computed(() => {
    const order = this.order();
    if (!order) return 0;
    if (order.payment_amount_due != null) {
      return Math.max(0, Number(order.payment_amount_due));
    }
    const remaining = Math.max(0, Number(order.remaining_balance ?? 0));
    if (order.payment_form === '2') return 0;
    const grandTotal = Number(order.grand_total ?? 0);
    if (!(grandTotal > 0)) return remaining;
    const settledPayments = (order.payments ?? []).filter((payment) =>
      SETTLED_PAYMENT_STATES_FE.has(payment.state ?? ''),
    );
    if (settledPayments.length === 0) return Math.max(remaining, grandTotal);
    const settledAmount = settledPayments.reduce(
      (sum, payment) => sum + Number(payment.amount ?? 0),
      0,
    );
    if (settledAmount >= grandTotal - 0.01) return 0;
    return remaining;
  });
  readonly grandTotal = computed(() => Number(this.order()?.grand_total ?? 0));
  readonly settledPaymentTotal = computed(() =>
    (this.order()?.payments ?? [])
      .filter((payment) => SETTLED_PAYMENT_STATES_FE.has(payment.state ?? ''))
      .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
  );
  readonly paymentMethodLabel = computed(() => {
    const payment = (this.order()?.payments ?? []).find((row) =>
      SETTLED_PAYMENT_STATES_FE.has(row.state ?? ''),
    );
    return (
      payment?.store_payment_method?.display_name ||
      payment?.store_payment_method?.system_payment_method?.display_name ||
      'Pago confirmado'
    );
  });
  readonly additionalShippingCost = computed(() =>
    this.needsShippingConfiguration()
      ? Math.max(
          0,
          this.shippingCost() - Number(this.order()?.shipping_cost ?? 0),
        )
      : 0,
  );
  readonly amountDue = computed(
    () => this.balance() + this.additionalShippingCost(),
  );
  readonly needsPayment = computed(() =>
    this.order()?.payment_required ?? this.amountDue() > 0.01,
  );
  readonly requiresShipping = computed(
    () =>
      !['pickup', 'direct_delivery', 'dine_in'].includes(
        this.order()?.delivery_type ?? 'home_delivery',
      ),
  );
  readonly needsShippingMethod = computed(
    () => this.requiresShipping() && !this.order()?.shipping_method_id,
  );
  readonly needsDispatch = computed(
    () =>
      this.requiresShipping() &&
      !['shipped', 'delivered', 'finished'].includes(this.order()?.state ?? ''),
  );
  readonly needsDelivery = computed(
    () =>
      !['delivered', 'finished'].includes(this.order()?.state ?? '') &&
      !this.allItemsDelivered(),
  );
  readonly allItemsDelivered = computed(() => {
    const order = this.order();
    if (!order) return false;
    if (order.all_items_delivered === true) return true;
    const items = order.order_items;
    if (!Array.isArray(items) || items.length === 0) return false;
    const deliverableItems = items.filter((item) => !item.cancelled_at);
    return deliverableItems.length > 0 && deliverableItems.every((item) => !!item.delivered_at);
  });
  readonly needsShippingConfiguration = computed(
    () =>
      this.requiresShipping() &&
      (this.needsShippingMethod() ||
        this.order()?.shipping_cost === null ||
        this.order()?.shipping_cost === undefined),
  );
  readonly progress = computed(() =>
    this.total() > 0
      ? Math.round((Math.min(this.completed(), this.total()) / this.total()) * 100)
      : 0,
  );
  readonly currentSequence = computed(() =>
    Math.min(Math.max(1, this.sequence()), Math.max(1, this.total())),
  );
  readonly stateLabel = computed(() => {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      processing: 'En preparación',
      ready: 'Lista',
      shipped: 'Despachada',
      delivered: 'Entregada',
      finished: 'Finalizada',
    };
    const state = this.order()?.state ?? '';
    return labels[state] ?? (state.replaceAll('_', ' ') || 'Sin estado');
  });
  readonly orderTypeLabel = computed(() => {
    const labels: Record<string, string> = {
      dine_in: 'Consumo en mesa',
      direct_delivery: 'Para llevar',
      pickup: 'Recoger en tienda',
      home_delivery: 'Domicilio',
      other: 'Envío',
    };
    return labels[this.order()?.delivery_type ?? 'home_delivery'] ?? 'Pedido';
  });
  readonly deliveryStepLabel = computed(() =>
    this.order()?.delivery_type === 'dine_in' ? 'Entrega en mesa' : 'Entrega al cliente',
  );
  readonly activeStepKey = computed(() => {
    if (!this.order()) return null;
    if (this.needsPayment()) return 'payment';
    if (this.needsShippingConfiguration()) return 'shipping';
    if (this.needsDispatch()) return 'dispatch';
    if (this.needsDelivery()) return this.confirmDelivery() ? 'delivery' : null;
    return this.order()?.state === 'finished' ? null : 'finish';
  });
  readonly workflowSteps = computed<OrderWorkflowStep[]>(() => {
    const steps: OrderWorkflowStep[] = [];
    const activeKey = this.activeStepKey();
    const status = (key: string, done: boolean): OrderWorkflowStep['status'] =>
      done ? 'done' : activeKey === key ? 'active' : 'waiting';
    const statusLabel = (value: OrderWorkflowStep['status']) =>
      value === 'done' ? 'Listo' : value === 'active' ? 'En proceso' : 'Pendiente';
    const paymentStatus = status('payment', !this.needsPayment());
    steps.push({
      key: 'payment',
      label: this.needsPayment() ? 'Pago pendiente' : 'Pago registrado',
      shortLabel: 'Pago',
      detail: this.needsPayment()
        ? 'Registra el saldo pendiente para continuar'
        : this.order()?.payment_form === '2'
          ? 'Venta a crédito'
          : 'El pago ya está registrado',
      icon: 'credit-card',
      status: paymentStatus,
      statusLabel: statusLabel(paymentStatus),
    });
    if (this.requiresShipping()) {
      const shippingStatus = status('shipping', !this.needsShippingConfiguration());
      steps.push({
        key: 'shipping',
        label: this.needsShippingConfiguration()
          ? 'Datos de envío pendientes'
          : 'Datos de envío listos',
        shortLabel: 'Envío',
        detail: this.needsShippingConfiguration()
          ? 'Selecciona el método y registra el valor del envío'
          : 'Método y valor del envío registrados',
        icon: 'tag',
        status: shippingStatus,
        statusLabel: statusLabel(shippingStatus),
      });
    }
    if (this.requiresShipping()) {
      const dispatchStatus = status('dispatch', !this.needsDispatch());
      steps.push({
        key: 'dispatch',
        label: this.needsDispatch() ? 'Despacho de la orden' : 'Orden despachada',
        shortLabel: 'Despacho',
        detail: this.needsDispatch()
          ? 'Se registrará al procesar la orden'
          : 'El despacho ya está registrado',
        icon: 'truck',
        status: dispatchStatus,
        statusLabel: statusLabel(dispatchStatus),
      });
    }
    const deliveryStatus = status('delivery', !this.needsDelivery());
    steps.push({
      key: 'delivery',
      label: this.needsDelivery()
        ? this.confirmDelivery()
          ? this.deliveryStepLabel()
          : `${this.deliveryStepLabel()} pendiente`
        : 'Entrega confirmada',
      shortLabel: 'Entrega',
      detail: this.allItemsDelivered()
        ? 'Todos los platos ya se marcaron como entregados'
        : this.needsDelivery()
        ? this.confirmDelivery()
          ? this.order()?.delivery_type === 'dine_in'
            ? 'Se confirmará cuando el pedido llegue a la mesa'
            : 'Se confirmará cuando el cliente reciba el pedido'
          : 'Activa la confirmación solo si el cliente ya recibió el pedido'
        : 'La entrega ya fue confirmada',
      icon: 'package-check',
      status: deliveryStatus,
      statusLabel: statusLabel(deliveryStatus),
    });
    const finishStatus = status('finish', this.order()?.state === 'finished');
    steps.push({
      key: 'finish',
      label: this.order()?.state === 'finished' ? 'Orden finalizada' : 'Finalización',
      shortLabel: 'Finalizar',
      detail:
        this.order()?.state === 'finished'
          ? 'La orden ya está finalizada'
          : this.needsDelivery() && !this.confirmDelivery()
            ? 'Se completará cuando se confirme la entrega'
            : 'La orden se finalizará después de confirmar la entrega',
      icon: 'check-circle',
      status: finishStatus,
      statusLabel: statusLabel(finishStatus),
    });
    return steps;
  });
  readonly stepperProgress = computed(() => {
    const steps = this.workflowSteps();
    if (steps.length < 2) return 0;
    const completed = steps.filter((step) => step.status === 'done').length;
    return Math.min(100, (completed / (steps.length - 1)) * 76);
  });
  readonly modalTitle = computed(() => {
    if (!this.order()) return 'Resultado del proceso';
    return this.needsDelivery() && !this.confirmDelivery()
      ? 'Procesar orden'
      : 'Procesar orden completa';
  });
  readonly submitLabel = computed(() => {
    if (this.busy()) return 'Procesando…';
    if (this.error()) return 'Reintentar';
    if (this.total() > 1) {
      return this.needsDelivery() && !this.confirmDelivery()
        ? 'Seguir pendiente'
        : 'Completar y seguir';
    }
    if (this.needsDelivery() && !this.confirmDelivery()) {
      if (this.needsPayment()) {
        return this.requiresShipping() ? 'Cobrar y despachar' : 'Cobrar y continuar';
      }
      return this.requiresShipping() ? 'Despachar pedido' : 'Continuar pedido';
    }
    if (this.needsPayment() && this.needsDelivery()) return 'Cobrar y entregar';
    if (this.needsDelivery()) return 'Completar orden';
    if (this.needsPayment() && this.needsDispatch()) return 'Cobrar y despachar';
    if (this.needsPayment()) return 'Cobrar y finalizar';
    if (this.needsDispatch()) return 'Despachar pedido';
    return 'Finalizar orden';
  });
  readonly canSubmit = computed(
    () =>
      (!this.needsPayment() ||
        (this.hasSelectedPaymentMethod() && this.hasFullPaymentAmount())) &&
      (!this.needsShippingConfiguration() ||
        (this.shippingMethodId() > 0 && this.shippingCost() >= 0)),
  );
  readonly hasSelectedPaymentMethod = computed(() =>
    this.availablePaymentMethods().some(
      (method) => String(method.id) === this.paymentMethodId(),
    ),
  );
  readonly hasFullPaymentAmount = computed(
    () =>
      this.amount() > 0 &&
      Math.round((this.amount() + Number.EPSILON) * 100) ===
        Math.round((this.amountDue() + Number.EPSILON) * 100),
  );
  constructor() {
    effect(() => {
      const order = this.order();
      const open = this.isOpen();
      if (!open || !order) return;
      untracked(() => {
        const methods = this.availablePaymentMethods();
        if (methods.length === 0 && !this.paymentMethodsLoading()) this.loadPaymentMethods();
        // El cajero debe elegir explícitamente cómo recibió el pago.
        this.paymentMethodId.set('');
        this.amount.set(this.amountDue());
        this.reference.set('');
        this.carrier.set('');
        this.trackingNumber.set('');
        this.shippingNotes.set('');
        this.deliveredTo.set('');
        this.deliveryNotes.set('');
        this.confirmDelivery.set(!this.needsDelivery());
        this.shippingMethodId.set(Number(order.shipping_method_id ?? 0));
        this.shippingCost.set(Number(order.shipping_cost ?? 0));
        if (
          this.needsShippingConfiguration() &&
          this.shippingMethods().length === 0 &&
          !this.shippingMethodsLoading()
        ) {
          this.shippingMethodsLoading.set(true);
          this.shippingMethodsService
            .getStoreShippingMethods()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (methods) => {
                const candidates = Array.isArray(methods)
                  ? methods
                  : Array.isArray((methods as any)?.data)
                    ? (methods as any).data
                    : [];
                this.shippingMethods.set(
                  candidates.filter((method: StoreShippingMethod) => method.is_active),
                );
                this.shippingMethodsLoading.set(false);
              },
              error: () => {
                this.shippingMethods.set([]);
                this.shippingMethodsLoading.set(false);
              },
            });
        }
      });
    });
  }

  private loadPaymentMethods(): void {
    this.paymentMethodsLoading.set(true);
    this.paymentMethodsService
      .getStorePaymentMethods({ state: PaymentMethodState.ENABLED, page: 1, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const candidates: StorePaymentMethod[] = Array.isArray(result)
            ? result
            : Array.isArray(result?.data)
              ? result.data
            : Array.isArray((result as any)?.data?.data)
              ? ((result as any).data.data as StorePaymentMethod[])
              : [];
          const enabled = candidates.filter(
            (method: StorePaymentMethod) => method.state === PaymentMethodState.ENABLED,
          );
          this.paymentMethodsFallback.set(enabled);
          this.paymentMethodsLoading.set(false);
        },
        error: () => {
          this.paymentMethodsFallback.set([]);
          this.paymentMethodsLoading.set(false);
        },
      });
  }

  onShippingCostChange(value: number): void {
    this.shippingCost.set(Number.isFinite(value) ? Math.max(0, value) : 0);
    this.amount.set(
      this.balance() +
        Math.max(
          0,
          (Number.isFinite(value) ? value : 0) -
            Number(this.order()?.shipping_cost ?? 0),
        ),
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const dto: FastTrackOrderDto = {
      confirm_delivery: !this.needsDelivery() || this.confirmDelivery(),
    };
    if (this.needsPayment()) {
      dto.payment = {
        store_payment_method_id: Number(this.paymentMethodId()),
        payment_type: 'direct',
        amount_received: this.amount(),
        payment_reference: this.reference().trim() || undefined,
      };
    }
    if (this.needsDispatch()) {
      const ship = {
        ...(this.carrier().trim() ? { carrier: this.carrier().trim() } : {}),
        ...(this.trackingNumber().trim()
          ? { tracking_number: this.trackingNumber().trim() }
          : {}),
        ...(this.shippingNotes().trim()
          ? { notes: this.shippingNotes().trim() }
          : {}),
      };
      if (Object.keys(ship).length) dto.ship = ship;
    }
    if (this.needsDelivery() && this.confirmDelivery()) {
      const deliver = {
        ...(this.deliveredTo().trim()
          ? { delivered_to: this.deliveredTo().trim() }
          : {}),
        ...(this.deliveryNotes().trim()
          ? { delivery_notes: this.deliveryNotes().trim() }
          : {}),
      };
      if (Object.keys(deliver).length) dto.deliver = deliver;
    }
    const shipping =
      this.needsShippingConfiguration() && this.shippingMethodId() > 0
        ? {
            shipping_method_id: this.shippingMethodId(),
            shipping_cost: this.shippingCost(),
          }
        : undefined;
    this.submitted.emit({ flow: dto, shipping });
  }
}
