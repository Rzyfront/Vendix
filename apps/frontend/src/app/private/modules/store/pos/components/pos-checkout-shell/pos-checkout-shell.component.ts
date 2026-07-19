import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  ModalComponent,
  IconComponent,
  StepsLineComponent,
} from '../../../../../../shared/components';
import type { StepsLineItem } from '../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PosCustomerSelectorComponent } from '../pos-customer-selector/pos-customer-selector.component';
import { PosPaymentStepComponent } from './steps/pos-payment-step.component';
import { OpenTableSessionResult } from '../../services/pos-restaurant-integration.service';
import { PaymentMethod } from '../../services/pos-payment.service';
import { CartState } from '../../models/cart.model';
import { PosCustomer } from '../../models/customer.model';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';

export type CheckoutIntent = 'pickup' | 'delivery';

/**
 * Fase 5·B1 — `app-pos-checkout-shell`.
 *
 * SHELL con stepper que unifica el checkout POS. En B1 cubre el flujo
 * NO-delivery (pago sin envío) con dos pasos: **Cobro** (hospeda el
 * `app-pos-payment-step`) y **Cliente** (toggle anónimo/cliente + selector).
 * El Resumen es un rail fijo. El shell es dueño del flag `isAnonymousSale` y lo
 * comparte con el paso Cobro; la verdad del cliente/carrito la posee el padre
 * (POS) vía `customerSelected` → `onPaymentCustomerSelected`.
 *
 * Los 3 modales viejos siguen vivos; este shell no borra nada.
 */
@Component({
  selector: 'app-pos-checkout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    IconComponent,
    StepsLineComponent,
    CurrencyPipe,
    PosCustomerSelectorComponent,
    PosPaymentStepComponent,
  ],
  templateUrl: './pos-checkout-shell.component.html',
  styleUrl: './pos-checkout-shell.component.scss',
})
export class PosCheckoutShellComponent {
  // ── Inputs ────────────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly cartState = input<CartState | null>(null);
  readonly checkoutIntent = input<CheckoutIntent>('pickup');
  readonly isRestaurantWithPrepared = input<boolean>(false);
  readonly tableId = input<number | null>(null);
  readonly paymentMethods = input<PaymentMethod[] | null>(null);
  readonly isProcessing = input<boolean>(false);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** Re-emits the paymentData produced by the Cobro step (step.paymentCompleted). */
  readonly checkoutCompleted = output<any>();
  readonly requestCustomer = output<void>();
  readonly customerSelected = output<PosCustomer>();
  readonly tableSessionOpened = output<OpenTableSessionResult>();

  private readonly currencyService = inject(CurrencyFormatService);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  // ── Child references ────────────────────────────────────────────────────
  protected readonly paymentStep = viewChild(PosPaymentStepComponent);
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  // ── Stepper state ──────────────────────────────────────────────────────
  readonly currentStep = signal(0);
  readonly steps = computed<StepsLineItem[]>(() => {
    // B1: solo flujo sin envío. El paso "Envío" se añade en B2.
    return [{ label: 'Cobro' }, { label: 'Cliente' }];
  });

  // ── Anonymous-sale ownership (moved from the legacy interface) ───────────
  readonly isAnonymousSale = signal<boolean>(false);
  readonly userOverrideAnonymous = signal<boolean | null>(null);

  readonly allowAnonymousSales = computed(
    () => this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
  );
  readonly anonymousSalesAsDefault = computed(
    () => this.settingsFacade.pos()?.anonymous_sales_as_default ?? false,
  );

  /** Anonymous option is hidden when the collector is in credit mode. */
  readonly canBeAnonymous = computed<boolean>(
    () => this.allowAnonymousSales() && this.paymentStep()?.mode() !== 'credito',
  );

  get customerDisplayName(): string {
    const customer = this.cartState()?.customer;
    if (!customer) return 'Seleccionar cliente';
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  // ── Footer projections (read from the Cobro step) ────────────────────────
  readonly footerProcessing = computed<boolean>(
    () => this.paymentStep()?.isProcessing() ?? false,
  );
  readonly confirmDisabled = computed<boolean>(() => {
    const step = this.paymentStep();
    if (!step) return true;
    return (
      !step.canSubmit() ||
      step.isProcessing() ||
      step.restaurantConsumoNeedsTable()
    );
  });
  /** Replica la lógica del label de pos-payment-interface.html (L294). */
  readonly confirmLabel = computed<string>(() => {
    const step = this.paymentStep();
    if (!step) return 'Confirmar Pago';
    if (step.mode() === 'credito') return 'Crear Venta a Crédito';
    if (step.isWompiSelected()) return 'Pagar con Wompi';
    const type = step.selectedMethodType();
    if (type === 'cash') return 'Cobrar';
    if (type === 'wallet') return 'Pagar con Wallet';
    return 'Confirmar Pago';
  });

  constructor() {
    // Ensure currency is loaded for the Resumen rail (| currency pipe).
    this.currencyService.loadCurrency();

    // Reactive sync: derive the anonymous flag from settings unless the user
    // explicitly overrode it. Writes wrapped in untracked() (zoneless-safe).
    effect(() => {
      const allow = this.allowAnonymousSales();
      const asDefault = this.anonymousSalesAsDefault();
      const override = this.userOverrideAnonymous();
      const effective = !allow ? false : (override ?? asDefault);
      untracked(() => {
        if (this.isAnonymousSale() !== effective) {
          this.isAnonymousSale.set(effective);
        }
      });
    });

    // Reset-on-open (Fase 1 pattern): reset the stepper cursor and the
    // anonymous state whenever the shell opens.
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.currentStep.set(0);
          this.userOverrideAnonymous.set(null);
          this.syncAnonymousSaleState();
        });
      }
    });

    // Credit sales cannot be anonymous: when the collector enters credito mode,
    // clear the anonymous flag so the customer selector is shown.
    effect(() => {
      if (this.paymentStep()?.mode() === 'credito' && this.isAnonymousSale()) {
        untracked(() => this.isAnonymousSale.set(false));
      }
    });
  }

  private syncAnonymousSaleState(): void {
    if (!this.allowAnonymousSales()) {
      this.isAnonymousSale.set(false);
      return;
    }
    const override = this.userOverrideAnonymous();
    this.isAnonymousSale.set(override ?? this.anonymousSalesAsDefault());
  }

  // ── Stepper navigation (non-blocking) ────────────────────────────────────
  goToStep(index: number): void {
    if (index < 0 || index >= this.steps().length) return;
    this.currentStep.set(index);
  }

  // ── Footer actions ───────────────────────────────────────────────────────
  onConfirm(): void {
    this.paymentStep()?.triggerSubmit();
  }

  // ── Cliente step handlers ───────────────────────────────────────────────
  toggleAnonymousSale(enabled: boolean): void {
    this.userOverrideAnonymous.set(enabled);
    this.isAnonymousSale.set(enabled);
  }

  /** Cliente elegido/creado en el selector inline. */
  selectCustomer(customer: PosCustomer): void {
    this.userOverrideAnonymous.set(false);
    this.isAnonymousSale.set(false);
    // El padre (POS) es dueño del carrito; solo re-emitimos.
    this.customerSelected.emit(customer);
  }

  /** "Quitar cliente / venta anónima" desde el selector inline. */
  onCustomerCleared(): void {
    this.toggleAnonymousSale(true);
  }

  // ── Step passthrough outputs ─────────────────────────────────────────────
  onCheckoutCompleted(paymentData: any): void {
    this.checkoutCompleted.emit(paymentData);
  }

  onRequestCustomer(): void {
    this.requestCustomer.emit();
  }

  onTableSessionOpened(result: OpenTableSessionResult): void {
    this.tableSessionOpened.emit(result);
  }

  // ── Close ────────────────────────────────────────────────────────────────
  onModalClosed(): void {
    this.customerSelector()?.reset();
    this.isOpenChange.emit(false);
    this.closed.emit();
  }
}
