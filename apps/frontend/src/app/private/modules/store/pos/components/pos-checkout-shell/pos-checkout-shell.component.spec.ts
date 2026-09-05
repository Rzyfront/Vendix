import { Component, Pipe, PipeTransform, WritableSignal, input, output, runInInjectionContext, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { PosCheckoutShellComponent } from './pos-checkout-shell.component';
import { PosCartService } from '../../services/pos-cart.service';
import { PosPaymentService } from '../../services/pos-payment.service';
import { PosRestaurantIntegrationService } from '../../services/pos-restaurant-integration.service';
import { StoreOrdersService } from '../../../orders/services/store-orders.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';

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

@Component({ selector: 'app-pos-consumo-step', standalone: true, template: `` })
class ConsumoStub {
  readonly cartState = input<unknown>(null);
  readonly tableId = input<number | null>(null);
  readonly advanceRequested = output<void>();
  fulfillmentMode = 'entrega';
  needsTableFlag = false;
  readonly openTablePicker = signal(false);
  readonly checkoutTableId = signal<number | null>(null);
  fulfillment(): string {
    return this.fulfillmentMode;
  }
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
  readonly address = input<unknown>(null);
  readonly addressId = input<number | null>(null);
  readonly shippingCompleted = output<unknown>();
  readonly shippingCost = signal(0);
  readonly shipSubStep = signal(0);
  readonly canConfirm = signal(true);
  readonly shipIsProcessing = signal(false);
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
}

@Component({ selector: 'app-address-form-fields', standalone: true, template: `` })
class AddressStub {
  readonly initialAddress = input<unknown>(null);
  readonly requirePhone = input(false);
  readonly showErrors = input(false);
  readonly addressChange = output<unknown>();
  readonly validChange = output<boolean>();
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
  const wireStubs = (): void => {
    const pay = payStub();
    Object.defineProperty(component, 'paymentStep', {
      value: () => pay,
      configurable: true,
    });
    // Envío solo se monta en delivery: si no está, stub suelto para el slot.
    const shipEl = fixture.debugElement.query(By.directive(ShippingStub));
    const ship = shipEl
      ? shipEl.componentInstance
      : TestBed.runInInjectionContext(() => new ShippingStub());
    Object.defineProperty(component, 'shippingStep', {
      value: () => ship,
      configurable: true,
    });
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
        { provide: StoreOrdersService, useValue: {} },
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
          ConsumoStub,
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
    // mode create-payment + pickup sin restaurante → [Cliente, Cobro], paso 0.
    expect(component.currentStepKey()).toBe('cliente');
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowRight'));
    expect(next).toHaveBeenCalledOnceWith({ source: 'arrows' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('→ en CTA terminal es no-op: ni avanza ni cobra', () => {
    component.currentStep.set(1); // Cobro, último
    fixture.detectChanges();
    expect(component.isLastStep()).toBeTrue();
    const next = spyOn(component, 'attemptNextStep');
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('ArrowRight'));
    expect(next).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('← siempre retrocede sin cobrar', () => {
    component.currentStep.set(1);
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
    component.currentStep.set(1); // Cobro: canSubmit stub = true
    fixture.detectChanges();
    expect(component.confirmDisabled()).toBeFalse();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('Enter en terminal con gate cerrado destella y no cobra', () => {
    component.currentStep.set(1);
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
    component.currentStep.set(1);
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
    component.currentStep.set(1);
    fixture.detectChanges();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.attemptNextStep({ source: 'arrows' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Enter sí cobra en modo crédito con gate válido', () => {
    payStub().mode.set('credito');
    component.currentStep.set(1);
    fixture.detectChanges();
    const confirm = spyOn(component, 'onPrimaryConfirm');
    component.onShellKeydown(keyEvent('Enter'));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('restaurante ordena [Consumo, Cliente, Cobro]', () => {
    restaurantMode.set(true);
    fixture.detectChanges();
    expect(component.stepKeys()).toEqual(['consumo', 'cliente', 'cobro']);
    expect(component.currentStepKey()).toBe('consumo');
  });

  it('Consumo-entrega avanza; consumo sin mesa abre el picker sin avanzar', () => {
    const stub = TestBed.runInInjectionContext(() => new ConsumoStub());
    Object.defineProperty(component, 'consumoStep', {
      value: () => stub,
      configurable: true,
    });
    const advance = component as unknown as { advanceConsumo: () => void };
    // Entrega (default) → avanza.
    advance.advanceConsumo();
    expect(component.currentStep()).toBe(1);
    // Consumo sin mesa → abre picker, no avanza.
    component.currentStep.set(0);
    stub.fulfillmentMode = 'consumo';
    stub.needsTableFlag = true;
    advance.advanceConsumo();
    expect(stub.openTablePicker()).toBeTrue();
    expect(component.currentStep()).toBe(0);
    // Con mesa → avanza.
    stub.needsTableFlag = false;
    advance.advanceConsumo();
    expect(component.currentStep()).toBe(1);
  });
});
