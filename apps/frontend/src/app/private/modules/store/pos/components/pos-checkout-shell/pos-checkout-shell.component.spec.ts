import { Component, Directive, Pipe, PipeTransform, WritableSignal, input, model, output, runInInjectionContext, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';

import { PosCheckoutShellComponent } from './pos-checkout-shell.component';
import { PosCartService } from '../../services/pos-cart.service';
import { PosPaymentService } from '../../services/pos-payment.service';
import { PosRestaurantIntegrationService } from '../../services/pos-restaurant-integration.service';
import { StoreOrdersService } from '../../../orders/services/store-orders.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { PaymentCollectorComponent } from '../../../../../../shared/components/payment-collector/payment-collector.component';
import { PaymentMethodsCatalogService } from '../../../../../../shared/services/payment-methods-catalog.service';
import type { PaymentMethod } from '../../../../../../shared/models/payment-method.model';
import { deliveryTypeToEntregaChoice } from '../../models/cart.model';
import { shouldAutoPrintDispatchTicket } from '../../../../../../shared/services/print/dispatch-ticket-autoprint';
import { ERROR_MESSAGES } from '../../../../../../core/utils/error-messages';

/**
 * CP-POS-CHECKOUT-KEYBOARD — matriz teclado × paso del modal de pago.
 *
 * Los hijos se sustituyen por stubs con el mismo selector y la mínima API que
 * el shell lee (signals/métodos). Así se prueba el enrutado de teclas y la
 * invariante "las flechas nunca hacen submit" sin montar el checkout real.
 */

@Pipe({ name: 'currency', standalone: true })
class CurrencyStubPipe implements PipeTransform {
  transform(value: unknown): string {
    return String(value ?? '');
  }
}

@Component({ selector: 'app-modal', standalone: true, template: `<ng-content></ng-content>` })
class ModalStub {
  readonly isOpen = input(false);
  readonly size = input('xl');
  readonly title = input('');
  readonly subtitle = input('');
  readonly dialog = input(false);
  readonly fullScreenOnMobile = input(false);
  readonly closed = output<void>();
}

@Component({ selector: 'app-steps-line', standalone: true, template: `` })
class StepsLineStub {
  readonly steps = input<unknown[]>([]);
  readonly currentStep = input(0);
  readonly clickable = input(false);
  readonly orientation = input('horizontal');
  readonly size = input('md');
  readonly fillHeight = input(false);
  readonly minHeightPx = input(0);
  readonly stepClicked = output<number>();
}

@Component({ selector: 'app-icon', standalone: true, template: `` })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
  readonly color = input<string | null>(null);
}

@Component({ selector: 'app-pos-entrega-step', standalone: true, template: `` })
class EntregaStub {
  readonly cartState = input<unknown>(null);
  readonly tableId = input<number | null>(null);
  readonly initialChoice = input<string>('llevar');
  // La plantilla del shell enlaza `[(choice)]="entregaChoice"` (`:71`) y el doble
  // debe exponerlo como model() para aceptar two-way binding y evitar NG0303.
  readonly choice = model<'mesa' | 'llevar' | 'enviar'>('llevar');
  readonly advanceRequested = output<void>();
  needsTableFlag = false;
  readonly openTablePicker = signal(false);
  readonly checkoutTableId = signal<number | null>(null);
  readonly effectiveTableId = signal<number | null>(null);
  needsTable(): boolean {
    return this.needsTableFlag;
  }
}

@Component({ selector: 'app-pos-payment-step', standalone: true, template: `` })
class PaymentStub {
  readonly cartState = input<unknown>(null);
  readonly checkoutIntent = input('pickup');
  readonly isRestaurantWithPrepared = input(false);
  readonly tableId = input<number | null>(null);
  readonly fulfillment = input('entrega');
  readonly sessionId = input<number | null>(null);
  readonly isAnonymous = input(false);
  readonly isAlias = input(false);
  readonly customerAlias = input('');
  readonly paymentMethods = input<unknown[] | null>(null);
  readonly isProcessing = input(false);
  readonly editingOrderId = input<number | null>(null);
  readonly autoExecute = input(true);
  readonly amountOverride = input<number | null>(null);
  readonly paymentResetKey = input(0);
  // La plantilla del shell enlaza `[takeawayOrder]` (`:79`) y el doble no lo
  // declaraba: NG0303 al primer `detectChanges()`, que tumbaba las 20 pruebas.
  readonly takeawayOrder = input(false);
  readonly paymentCompleted = output<unknown>();
  readonly paymentReady = output<unknown>();
  readonly amountConfirmed = output<void>();
  readonly requestCustomer = output<void>();
  readonly mode = signal('contado');
  readonly subStep = signal(0);
  readonly modoOffset = signal(0);
  readonly selectedMethodName = signal<string | null>(null);
  readonly hasPendingSubSteps = signal(false);
  readonly canAdvanceSubStep = signal(true);
  readonly canSubmit = signal(true);
  readonly selectedMethodType = signal<string | null>(null);
  readonly isWompiSelected = signal(false);
  readonly collectedIsProcessing = signal(false);
  advanceRet = false;
  advanceSubStepOrConfirm(): boolean {
    return this.advanceRet;
  }
  flashValidation(): void {}
  triggerSubmit(): void {}
}

@Component({ selector: 'app-pos-shipping-step', standalone: true, template: `` })
class ShippingStub {
  readonly cartState = input<unknown>(null);
  readonly editingOrderId = input<number | null>(null);
  readonly shippingCompleted = output<unknown>();
  readonly shippingCost = signal(0);
  readonly shipSubStep = signal(0);
  readonly shipSubSteps = signal<any[]>([]);
  readonly canConfirm = signal(true);
  readonly shipIsProcessing = signal(false);
  readonly isProcessing = this.shipIsProcessing;
  readonly hasShippingChanges = signal(false);
  readonly editorValidationError = signal<string | null>(null);
  readonly preservationWarning = signal<string | null>(null);
  readonly shippingContext = signal<any>(null);
  buildShippingContext(): any { return this.shippingContext(); }
  attemptNextSubStep(): boolean {
    return true;
  }
  attemptPrevSubStep(): boolean {
    return false;
  }
  flashValidation(): void {}
  execute(_submit: unknown): void {}
}

@Component({ selector: 'app-pos-customer-selector', standalone: true, template: `` })
class CustomerSelectorStub {
  readonly selectedCustomer = input<unknown>(null);
  readonly allowAnonymous = input(true);
  readonly minimalInvoiceMode = input(false);
  readonly showTopSuggestions = input(false);
  readonly searchLimit = input(3);
  readonly customerSelected = output<unknown>();
  readonly customerCleared = output<void>();
  resolveIfNeeded() {
    return of(false);
  }
  /** CP-pos-customer-stale (F-003) — el shell lo lee en attemptNextStep; false = flujo legacy. */
  hasFormIdentifiers(): boolean {
    return false;
  }
}

@Component({ selector: 'app-address-form-fields', standalone: true, template: `` })
class AddressStub {
  readonly initialAddress = input<unknown>(null);
  readonly requirePhone = input(false);
  readonly showErrors = input(false);
  readonly addressChange = output<unknown>();
  readonly validChange = output<boolean>();
}

/** CP-pos-checkout-enter-focus — stubs para montar el collector real aislado. */
@Directive({ selector: '[appCurrencyInput]', standalone: true })
class CurrencyInputStub {
  readonly currencyDecimals = input<number | undefined>(undefined);
}

@Component({ selector: 'app-payment-wompi-fields', standalone: true, template: `` })
class WompiFieldsStub {
  readonly slice = input<unknown>(null);
  readonly sliceChange = output<unknown>();
}

@Component({ selector: 'app-payment-credit-fields', standalone: true, template: `` })
class CreditFieldsStub {
  readonly terms = input<unknown>(null);
  readonly termsChange = output<unknown>();
  readonly financeBase = input(0);
  readonly paymentMethods = input<unknown[]>([]);
  readonly currencyDecimals = input<number | undefined>(undefined);
}

describe('PosCheckoutShellComponent — matriz de teclado (CP-POS-CHECKOUT-KEYBOARD)', () => {
  let fixture: ComponentFixture<PosCheckoutShellComponent>;
  let component: PosCheckoutShellComponent;
  let integrationMock: { isRestaurantMode: () => boolean; currentTableSession: () => null };
  let settingsMock: { pos: () => null; checkout: () => null };
  let restaurantMode: WritableSignal<boolean>;

  const payStub = (): PaymentStub =>
    fixture.debugElement.query(By.directive(PaymentStub)).componentInstance as PaymentStub;

  /**
   * `viewChild(ClaseReal)` no casa con un stub (no es instanceof), así que el
   * shell vería todos los childs como undefined. Se inyectan los stubs
   * montados en los slots viewChild: el shell solo lee su API pública.
   */
  /**
   * El slot debe ser UNA señal estable por componente, no un closure nuevo en
   * cada `wireStubs()`. Un viewChild real es una señal: los `computed()` del
   * shell (p. ej. `shippingCost`) la rastrean y se recalculan cuando cambia la
   * instancia. Con un closure plano, un computed que ya corrió queda atado a
   * las señales del stub ANTERIOR y nunca ve el nuevo — el test mediría un
   * memo rancio, no el componente.
   */
  const bindSlot = (name: string, instance: unknown): void => {
    const current = (component as any)[name];
    if (current?.__stubSlot) {
      current.set(instance);
      return;
    }
    const slot = signal(instance);
    Object.defineProperty(slot, '__stubSlot', { value: true });
    Object.defineProperty(component, name, { value: slot, configurable: true });
  };

  const wireStubs = (): void => {
    bindSlot('paymentStep', payStub());
    const entregaEl = fixture.debugElement.query(By.directive(EntregaStub));
    bindSlot(
      'entregaStep',
      entregaEl
        ? entregaEl.componentInstance
        : TestBed.runInInjectionContext(() => new EntregaStub()),
    );
    // Envío solo se monta en delivery: si no está, stub suelto para el slot.
    const shipEl = fixture.debugElement.query(By.directive(ShippingStub));
    bindSlot(
      'shippingStep',
      shipEl
        ? shipEl.componentInstance
        : TestBed.runInInjectionContext(() => new ShippingStub()),
    );
  };

  /** Evento de teclado mínimo; target falsificado para las ramas de Enter. */
  const keyEvent = (key: string, target?: unknown) =>
    ({
      key,
      target: target ?? { tagName: 'DIV', closest: () => null, isContentEditable: false },
      preventDefault: () => {},
      defaultPrevented: false,
    }) as unknown as KeyboardEvent;

  const searchTarget = {
    tagName: 'INPUT',
    isContentEditable: false,
    closest: (sel: string) => (sel.includes('app-inputsearch') ? {} : null),
  };
  const buttonTarget = {
    tagName: 'BUTTON',
    isContentEditable: false,
    closest: () => ({}),
  };
  // CP-pos-checkout-enter-focus — SELECT nativo (ej. cuenta bancaria).
  const selectTarget = {
    tagName: 'SELECT',
    isContentEditable: false,
    closest: () => null,
  };

  beforeEach(async () => {
    // El mock lee una señal: los computed del shell que hacen short-circuit
    // antes de leer señales solo se invalidan por deps reactivas.
    restaurantMode = signal(false);
    integrationMock = { isRestaurantMode: () => restaurantMode(), currentTableSession: () => null };
    settingsMock = { pos: () => null, checkout: () => null };

    TestBed.configureTestingModule({
      imports: [PosCheckoutShellComponent],
      providers: [
        { provide: StoreSettingsFacade, useValue: settingsMock },
        { provide: PosCartService, useValue: {} },
        { provide: PosPaymentService, useValue: {} },
        { provide: PosRestaurantIntegrationService, useValue: integrationMock },
        { provide: StoreOrdersService, useValue: { getOrderById: (id: string) => of({ id: Number(id) }) } },
        { provide: ToastService, useValue: {} },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => {} } },
      ],
    });

    TestBed.overrideComponent(PosCheckoutShellComponent, {
      set: {
        imports: [
          ModalStub,
          StepsLineStub,
          IconStub,
          EntregaStub,
          PaymentStub,
          ShippingStub,
          CustomerSelectorStub,
          AddressStub,
          CurrencyStubPipe,
        ],
      },
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PosCheckoutShellComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('mode', 'create-payment');
    fixture.detectChanges();
    wireStubs();
    fixture.detectChanges();
  });

  it('→ en paso intermedio llama a Siguiente con source arrows y no cobra', () => {
    // mode create-payment + default llevar → [Entrega, Cliente, Cobro], paso 0.
    expect(component.currentStepKey()).toBe('entrega');
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowRight'));
    expect(next).toHaveBeenCalledOnceWith({ source: 'arrows' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('→ en CTA terminal es no-op: ni avanza ni cobra', () => {
    component.currentStep.set(2); // Cobro, último
    fixture.detectChanges();
    expect(component.isLastStep()).toBeTrue();
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowRight'));
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('← siempre retrocede sin cobrar', () => {
    component.currentStep.set(2);
    fixture.detectChanges();
    const prev = spyOn(component, 'prevStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowLeft'));
    expect(prev).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter intermedio avanza con source enter', () => {
    const next = spyOn(component, 'attemptNextStep');
    component.onShellKeydown(keyEvent('Enter'));
    expect(next).toHaveBeenCalledOnceWith({ source: 'enter' });
  });

  it('Enter en terminal con gate abierto cobra', () => {
    component.currentStep.set(2); // Cobro, último: canSubmit stub = true
    fixture.detectChanges();
    expect(component.confirmDisabled()).toBeFalse();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('Enter en terminal con gate cerrado destella y no cobra', () => {
    component.currentStep.set(2); // Cobro, último
    payStub().canSubmit.set(false);
    fixture.detectChanges();
    expect(component.confirmDisabled()).toBeTrue();
    const flash = spyOn(payStub(), 'flashValidation');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter'));
    expect(flash).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter en el buscador de Cliente no avanza (solo busca)', () => {
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter', searchTarget));
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter sobre un botón deja el click nativo (no duplica)', () => {
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter', buttonTarget));
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter sobre SELECT nativo no avanza ni cobra y no previene el default', () => {
    // Paso intermedio (Cliente): sin el guard, este Enter avanzaría.
    expect(component.isLastStep()).toBeFalse();
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    const evt = keyEvent('Enter', selectTarget);
    let prevented = false;
    evt.preventDefault = () => {
      prevented = true;
    };
    component.onShellKeydown(evt);
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(prevented).toBeFalse();
  });

  // La app es ZONELESS: `zone.js/testing` no se carga, asi que `fakeAsync()`
  // lanza «zone-testing.js is needed for the fakeAsync() test helper» — y como
  // `fakeAsync(...)` se evalua al CARGAR el archivo (es el argumento de `it`),
  // ese throw tumbaba las diez pruebas del archivo, no solo esta. El
  // equivalente zoneless de `tick()` es `await fixture.whenStable()`.
  it('apertura (false→true) enfoca el panel del paso activo', async () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    await fixture.whenStable();
    const focus = spyOn(component as unknown as { focusActiveStepSoon: () => void }, 'focusActiveStepSoon');
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('evento ya consumido (radiogroup Tipo) no navega doble', () => {
    const next = spyOn(component, 'attemptNextStep');
    const evt = keyEvent('ArrowRight');
    Object.defineProperty(evt, 'defaultPrevented', { value: true });
    component.onShellKeydown(evt);
    expect(next).not.toHaveBeenCalled();
  });

  it('con modal cerrado el teclado no hace nada', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    const next = spyOn(component, 'attemptNextStep');
    const prev = spyOn(component, 'prevStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowRight'));
    component.onShellKeydown(keyEvent('ArrowLeft'));
    component.onShellKeydown(keyEvent('Enter'));
    expect(next).not.toHaveBeenCalled();
    expect(prev).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('flechas jamás disparan submit en modo crédito (intermedio o terminal)', () => {
    payStub().mode.set('credito');
    fixture.detectChanges();
    // Terminal.
    component.currentStep.set(2);
    fixture.detectChanges();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    const next = spyOn(component, 'attemptNextStep');
    component.onShellKeydown(keyEvent('ArrowRight'));
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    // Vía attemptNextStep real con source arrows en Cobro.
    next.and.callThrough();
    component.attemptNextStep({ source: 'arrows' });
    expect(confirm).not.toHaveBeenCalled();
    // Y con Enter sí llega al CTA (misma rama, otra fuente).
    component.attemptNextStep({ source: 'enter' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('flechas consumen el avance del sub-wizard sin llegar al submit (crédito)', () => {
    payStub().mode.set('credito');
    payStub().advanceRet = true; // hay sub-paso por avanzar (Forma→Plan)
    component.currentStep.set(2);
    fixture.detectChanges();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.attemptNextStep({ source: 'arrows' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter sí cobra en modo crédito con gate válido', () => {
    payStub().mode.set('credito');
    component.currentStep.set(2);
    fixture.detectChanges();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('matriz Entrega: llevar o mesa ordena [Entrega, Cliente, Cobro], enviar ordena [Entrega, Cliente, Envío, Cobro]', () => {
    component.entregaChoice.set('llevar');
    fixture.detectChanges();
    expect(component.stepKeys()).toEqual(['entrega', 'cliente', 'cobro']);
    expect(component.currentStepKey()).toBe('entrega');

    component.entregaChoice.set('mesa');
    fixture.detectChanges();
    expect(component.stepKeys()).toEqual(['entrega', 'cliente', 'cobro']);

    component.entregaChoice.set('enviar');
    fixture.detectChanges();
    expect(component.stepKeys()).toEqual(['entrega', 'cliente', 'envio', 'cobro']);
  });

  it('Entrega-llevar avanza; mesa sin mesa abre el picker sin avanzar', () => {
    const stub = TestBed.runInInjectionContext(() => new EntregaStub());
    Object.defineProperty(component, 'entregaStep', {
      value: () => stub,
      configurable: true,
    });
    const advance = component as unknown as { advanceEntrega: () => void };
    // Llevar (default) → avanza.
    component.entregaChoice.set('llevar');
    advance.advanceEntrega();
    expect(component.currentStep()).toBe(1);

    // Mesa sin mesa → abre picker, no avanza.
    component.currentStep.set(0);
    component.entregaChoice.set('mesa');
    stub.needsTableFlag = true;
    advance.advanceEntrega();
    expect(stub.openTablePicker()).toBeTrue();
    expect(component.currentStep()).toBe(0);

    // Con mesa → avanza.
    stub.needsTableFlag = false;
    advance.advanceEntrega();
    expect(component.currentStep()).toBe(1);
  });

  it('flip enviar agrega paso envio y volver a llevar lo remueve', () => {
    component.entregaChoice.set('llevar');
    fixture.detectChanges();
    expect(component.stepKeys()).not.toContain('envio');

    component.onEntregaChoiceChange('enviar');
    fixture.detectChanges();
    expect(component.stepKeys()).toContain('envio');

    component.onEntregaChoiceChange('llevar');
    fixture.detectChanges();
    expect(component.stepKeys()).not.toContain('envio');
  });

  it(`Para llevar estampa is_takeaway al anexar a mesa`, () => {
    restaurantMode.set(true);
    component.entregaChoice.set('llevar');
    const stub = TestBed.runInInjectionContext(() => new EntregaStub());
    (stub as any).effectiveTableId = () => null;
    Object.defineProperty(component, 'entregaStep', {
      value: () => stub,
      configurable: true,
    });
    fixture.detectChanges();
    expect(component.isTakeawayOrder()).toBeTrue();

    fixture.componentRef.setInput('cartState', {
      items: [
        {
          itemType: 'product',
          product: { id: 7, name: 'Pollo' },
          quantity: 1,
          unitPrice: 10000,
          finalPrice: 10000,
          totalPrice: 10000,
          taxAmount: 0,
        },
      ],
    } as any);
    fixture.detectChanges();

    const sent: unknown[] = [];
    (integrationMock as any).addItemsToTableSession = (
      _sessionId: number,
      items: unknown[],
    ) => {
      sent.push(items);
      return of({ order: { id: 11, order_items: [] } });
    };
    (integrationMock as any).maybeFireKitchen = () => of(null);
    (component as any).toastService = {
      success: () => {},
      warning: () => {},
      error: () => {},
    };
    (component as any).cartService = { clearCart: () => of({}) };

    (
      component as unknown as {
        appendToTableAndFire: (state: any, session: any) => void;
      }
    ).appendToTableAndFire(component.cartState() as any, {
      id: 3,
      order_id: 11,
    });

    expect(sent.length).toBe(1);
    expect((sent[0] as any[])[0]).toEqual(
      jasmine.objectContaining({ product_id: 7, is_takeaway: true }),
    );
  });

  it(`Consumo en mesa no marca takeaway salvo línea explícita`, () => {
    restaurantMode.set(true);
    component.entregaChoice.set('mesa');
    const stub = TestBed.runInInjectionContext(() => new EntregaStub());
    (stub as any).effectiveTableId = () => 5;
    Object.defineProperty(component, 'entregaStep', {
      value: () => stub,
      configurable: true,
    });
    fixture.detectChanges();
    expect(component.isTakeawayOrder()).toBeFalse();

    fixture.componentRef.setInput('cartState', {
      items: [
        {
          itemType: 'product',
          product: { id: 9, name: 'Bandeja' },
          quantity: 2,
          unitPrice: 15000,
          finalPrice: 15000,
          totalPrice: 30000,
          taxAmount: 0,
        },
        {
          itemType: 'product',
          product: { id: 10, name: 'Jugo' },
          quantity: 1,
          unitPrice: 5000,
          finalPrice: 5000,
          totalPrice: 5000,
          taxAmount: 0,
          isTakeaway: true,
        },
      ],
    } as any);
    fixture.detectChanges();

    const sent: unknown[] = [];
    (integrationMock as any).addItemsToTableSession = (
      _sessionId: number,
      items: unknown[],
    ) => {
      sent.push(items);
      return of({ order: { id: 12, order_items: [] } });
    };
    (integrationMock as any).maybeFireKitchen = () => of(null);
    (component as any).toastService = {
      success: () => {},
      warning: () => {},
      error: () => {},
    };
    (component as any).cartService = { clearCart: () => of({}) };

    (
      component as unknown as {
        appendToTableAndFire: (state: any, session: any) => void;
      }
    ).appendToTableAndFire(component.cartState() as any, {
      id: 4,
      order_id: 12,
    });

    expect(sent.length).toBe(1);
    const lines = sent[0] as any[];
    expect(lines[0]).toEqual({
      product_id: 9,
      quantity: 2,
      product_variant_id: undefined,
    });
    expect(lines[1]).toEqual(
      jasmine.objectContaining({ product_id: 10, is_takeaway: true }),
    );
  });

  const prepareShippingEdit = () => {
    const state = {
      items: [{ product: { id: '7', name: 'Producto' }, quantity: 1,
        unitPrice: 1000, finalPrice: 1000, totalPrice: 1000, taxAmount: 0 }],
      customer: { id: 99, first_name: 'Cliente' }, summary: { total: 1000 },
      appliedDiscounts: [], linkedOrderId: 700,
      shippingContext: { orderId: 700, customerId: 99, deliveryType: 'direct_delivery',
        shippingAddressId: 33, shippingMethodId: 7, shippingRateId: 88, shippingCost: 12500.5 },
    };
    const update = jasmine.createSpy('updateOrderFromEditor').and.returnValue(of({ id: 700 }));
    (TestBed.inject(StoreOrdersService) as any).updateOrderFromEditor = update;
    const error = jasmine.createSpy('error');
    Object.assign(TestBed.inject(ToastService), { error, success: () => {}, warning: () => {} });
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('mode', 'edit');
    fixture.componentRef.setInput('editingOrderId', 700);
    fixture.componentRef.setInput('initialEntrega', 'enviar');
    fixture.componentRef.setInput('cartState', state);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    wireStubs();
    fixture.detectChanges();
    const ship = (component as any).shippingStep() as ShippingStub;
    // Deliberately wrong automatic defaults recreate the previously destructive child.
    ship.shippingCost.set(100);
    ship.shippingContext.set({ deliveryType: 'home_delivery', shippingMethodId: 1,
      shippingAddressId: 1, shippingCost: 100, shippingRateId: 2 });
    return { state, update, error, ship };
  };

  it('no guarda un borrador de envío como venta de mostrador cuando falta el método', () => {
    const saveDraft = jasmine.createSpy('saveDraft');
    const warning = jasmine.createSpy('warning');
    Object.assign(TestBed.inject(PosPaymentService), { saveDraft });
    Object.assign(TestBed.inject(ToastService), { warning });
    fixture.componentRef.setInput('cartState', {
      items: [{ product: { id: '7', name: 'Producto' }, quantity: 1,
        unitPrice: 1000, finalPrice: 1000, totalPrice: 1000, taxAmount: 0 }],
      customer: { id: 99, first_name: 'Cliente' }, summary: { total: 1000 },
      appliedDiscounts: [],
    });
    component.entregaChoice.set('enviar');
    fixture.detectChanges();
    wireStubs();
    const ship = (component as any).shippingStep() as ShippingStub;
    ship.shippingContext.set(null);
    component.currentStep.set(component.stepKeys().indexOf('envio'));
    fixture.detectChanges();

    expect(component.draftDeliveryBlocked()).toBeTrue();
    component.onSaveDraft();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(jasmine.stringMatching(/método de envío/));
    expect(component.currentStepKey()).toBe('envio');
    expect(component.submittingDraft()).toBeFalse();
  });

  for (const previousStatus of ['cleaning', 'available'] as const) {
    it(`al guardar borrador sobre mesa ${previousStatus} avisa solo si venía de limpieza`, () => {
      const warning = jasmine.createSpy('warning');
      const opened = {
        previous_table_status: previousStatus,
        session: { id: 108, order_id: 1125, table_id: 15 },
        order: { id: 1125, state: 'draft', grand_total: 0 },
      };
      const openTableSession = jasmine.createSpy('openTableSession').and.returnValue(of(opened));
      Object.assign(TestBed.inject(PosRestaurantIntegrationService), { openTableSession });
      Object.assign(TestBed.inject(ToastService), { warning });
      const append = spyOn<any>(component, 'appendToTableAndFire').and.stub();
      const state = { items: [{ product: { id: '302' }, quantity: 1 }] } as any;

      (component as any).openPickedTableThenAppend(15, state);

      expect(openTableSession).toHaveBeenCalledTimes(1);
      expect(append).toHaveBeenCalledOnceWith(state, opened.session);
      if (previousStatus === 'cleaning') {
        expect(warning).toHaveBeenCalledOnceWith(
          ERROR_MESSAGES['TABLE_REOPENED_FROM_CLEANING_001'],
          undefined,
          5000,
        );
      } else {
        expect(warning).not.toHaveBeenCalled();
      }
    });
  }

  it('la confirmación del borrador usa el snapshot completo releído, no solo el id', () => {
    const persisted = {
      id: 1132,
      order_number: 'T-1132',
      customer_alias: 'Mesa de Ana',
      subtotal_amount: '38000',
      tax_amount: '0',
      grand_total: '38000',
      order_items: [{ id: 1, product_name: 'Coca-Cola 400ml', quantity: 1 }],
    };
    const getOrderById = jasmine.createSpy('getOrderById').and.returnValue(of(persisted));
    Object.assign(TestBed.inject(StoreOrdersService), { getOrderById });
    const finish = spyOn<any>(component, 'finishDraft').and.stub();

    (component as any).finishPersistedDraft(1132, [1], false, { id: 1132 });

    expect(getOrderById).toHaveBeenCalledOnceWith('1132');
    expect(finish).toHaveBeenCalledOnceWith(persisted, [1], false);
  });

  it('visitar Envío y Actualizar omite todas las claves y conserva el total original', () => {
    const { update } = prepareShippingEdit();
    expect(component.totalToPay()).toBe(13500.5);
    component.currentStep.set(component.stepKeys().indexOf('envio'));
    fixture.detectChanges();
    component.attemptNextStep();
    expect(component.currentStepKey()).toBe('cobro');
    component.onPrimaryConfirm();
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.calls.mostRecent().args[1];
    for (const key of ['delivery_type', 'shipping_address_id', 'shipping_method_id', 'shipping_rate_id', 'shipping_cost']) {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).withContext(key).toBeFalse();
    }
  });

  it('solo una edición explícita envía método, dirección, tarifa y costo', () => {
    const { update, ship } = prepareShippingEdit();
    ship.hasShippingChanges.set(true);
    component.onPrimaryConfirm();
    expect(update.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      delivery_type: 'home_delivery', shipping_method_id: 1,
      shipping_address_id: 1, shipping_rate_id: 2, shipping_cost: 100,
    }));
    expect(component.totalToPay()).toBe(1100);
  });

  for (const [choice, deliveryType] of [
    ['llevar', 'direct_delivery'],
    ['mesa', 'dine_in'],
  ] as const) {
    it(`edición explícita de ${choice} estampa ${deliveryType} sin flete`, () => {
      const { update } = prepareShippingEdit();
      component.entregaChoice.set(choice);
      fixture.detectChanges();
      component.onPrimaryConfirm();
      expect(update.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
        delivery_type: deliveryType, shipping_cost: 0,
      }));
    });
  }

  it('reabre direct_delivery sin flete como Para llevar y pickup real como Enviar', () => {
    const context = {
      deliveryType: 'direct_delivery', shippingMethodId: null, shippingCost: 0,
    };
    expect(deliveryTypeToEntregaChoice(context as any)).toBe('llevar');
    expect(deliveryTypeToEntregaChoice({ ...context, deliveryType: 'pickup', shippingMethodId: 7 } as any)).toBe('enviar');
  });

  it('preserva pickup histórico sin método al editar sin tocar Envío', () => {
    const { state, ship } = prepareShippingEdit();
    component.entregaChoice.set('enviar');
    ship.shippingContext.set(null);
    ship.editorValidationError.set('Selecciona un método de envío');
    const result = (component as any).buildEditorShippingPayload({
      ...state,
      shippingContext: {
        ...state.shippingContext, deliveryType: 'pickup',
        shippingAddressId: null, shippingMethodId: null, shippingRateId: null, shippingCost: null,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.payload).toEqual({});
  });

  it('autoimprime Para llevar con opt-in de mostrador sin cambiar pickup real', () => {
    const context = { printDispatchTicketEnabled: true, printDispatchTicketAuto: true, counterEnabled: true };
    expect(shouldAutoPrintDispatchTicket('automatic', { ...context, deliveryType: 'direct_delivery' })).toBeTrue();
    expect(shouldAutoPrintDispatchTicket('automatic', { ...context, deliveryType: 'pickup' })).toBeTrue();
    expect(shouldAutoPrintDispatchTicket('automatic', { ...context, deliveryType: 'dine_in' })).toBeFalse();
  });

  for (const message of ['Espera a que termine el cálculo del envío', 'Selecciona una dirección del nuevo cliente', 'Guarda la dirección en la ficha del cliente']) {
    it(`bloquea el PUT sin fallback cuando: ${message}`, () => {
      const { update, error, ship } = prepareShippingEdit();
      ship.hasShippingChanges.set(true);
      ship.editorValidationError.set(message);
      component.onPrimaryConfirm();
      expect(update).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(message);
      expect(component.currentStepKey()).toBe('envio');
    });
  }

  it('no permite heredar la dirección del antiguo cliente cambiando a pickup', () => {
    const { update, error, state } = prepareShippingEdit();
    fixture.componentRef.setInput('cartState', { ...state, customer: { id: 100, first_name: 'Otro' } });
    component.entregaChoice.set('llevar');
    fixture.detectChanges();
    component.onPrimaryConfirm();
    expect(update).not.toHaveBeenCalled();
    expect(error.calls.mostRecent().args[0]).toContain('Cambiaste el cliente');
  });

  it('deja avanzar y preservar envío no reconstruible aunque canConfirm sea false', () => {
    const { update, ship } = prepareShippingEdit();
    ship.canConfirm.set(false);
    ship.preservationWarning.set('Método original inactivo; envío conservado');
    component.currentStep.set(component.stepKeys().indexOf('envio'));
    component.attemptNextStep();
    expect(component.currentStepKey()).toBe('cobro');
    component.onPrimaryConfirm();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.calls.mostRecent().args[1].shipping_method_id).toBeUndefined();
  });

});

describe('PaymentCollectorComponent.handleEnter — CP-pos-checkout-enter-focus', () => {
  let fixture: ComponentFixture<PaymentCollectorComponent>;
  let component: PaymentCollectorComponent;

  const cashMethod = (overrides: Partial<PaymentMethod> = {}): PaymentMethod => ({
    id: '1',
    type: 'cash',
    name: 'Efectivo',
    icon: 'banknote',
    enabled: true,
    ...overrides,
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [PaymentCollectorComponent],
      providers: [
        { provide: PaymentMethodsCatalogService, useValue: { getEnabledMethods: () => of([]) } },
        {
          provide: CurrencyFormatService,
          useValue: { currencySymbol: signal('$'), loadCurrency: () => {} },
        },
      ],
    });

    TestBed.overrideComponent(PaymentCollectorComponent, {
      set: {
        imports: [
          ReactiveFormsModule,
          IconStub,
          CurrencyStubPipe,
          CurrencyInputStub,
          WompiFieldsStub,
          CreditFieldsStub,
          StepsLineStub,
        ],
      },
    });

    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PaymentCollectorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('amount', 50000);
    fixture.componentRef.setInput('layout', 'stepped');
    fixture.componentRef.setInput('autoLoad', false);
    fixture.detectChanges();
  });

  it('confirma el monto con defaults (efectivo) sin duplicar submit', () => {
    component.selectMethod(cashMethod());
    fixture.detectChanges();
    // Método elegido → el collector ya está en el sub-paso Monto.
    expect(component.subStep()).toBe(component.montoIndex());
    // Defaults: el efectivo se siembra con el total sin tipear nada.
    expect(component.canConfirmAmount()).toBeTrue();

    const submit = spyOn(component.submit, 'emit');
    const confirmed = spyOn(component.amountConfirmed, 'emit');
    component.handleEnter();

    expect(component.amountCollapsed()).toBeTrue();
    expect(confirmed).toHaveBeenCalledTimes(1);
    // La confirmación de monto NO es un submit: el shell cobra tras el colapso.
    expect(submit).not.toHaveBeenCalled();
  });
});
