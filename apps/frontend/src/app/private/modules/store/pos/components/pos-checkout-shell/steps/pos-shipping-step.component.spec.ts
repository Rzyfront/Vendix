import { NO_ERRORS_SCHEMA, Pipe, PipeTransform, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { PosShippingStepComponent } from './pos-shipping-step.component';
import { PosShippingService } from '../../../services/pos-shipping.service';
import { PosPaymentService } from '../../../services/pos-payment.service';
import { CustomersService } from '../../../../customers/services/customers.service';
import { CartState } from '../../../models/cart.model';
import {
  PosShippingMethod,
  PosShippingOption,
  posShippingRateIdForPayload,
} from '../../../models/shipping.model';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { CountryService } from '../../../../../../../core/services/country.service';
import { AddressFormFieldsComponent } from '../../../../../../../shared/components/address-form-fields/address-form-fields.component';
import { DianMunicipalityLookupService } from '../../../../../../../shared/services/dian-municipality-lookup.service';
import { GeocodingService } from '../../../../../ecommerce/services/geocoding.service';

@Pipe({ name: 'currency', standalone: true })
class CurrencyStubPipe implements PipeTransform {
  transform(value: unknown): string { return String(value ?? ''); }
}

/** Real shipping component + real address form lifecycle. Only presentational
 * children/map are isolated; no fake shipping-state mapper replaces the subject. */
describe('PosShippingStepComponent — preserve order shipping and explicit edits', () => {
  let fixture: ComponentFixture<PosShippingStepComponent>;
  let component: PosShippingStepComponent;
  let methods: Subject<PosShippingMethod[]>;
  let quotes: Subject<PosShippingOption[]>[];
  let calculate: jasmine.Spy;
  let customers: jasmine.SpyObj<CustomersService>;
  const originalMethod: PosShippingMethod = { id: 7, name: 'Transportadora', type: 'carrier', is_active: true };
  const firstMethod: PosShippingMethod = { id: 1, name: 'Mensajero', type: 'own_fleet', is_active: true };
  const originalAddress = {
    address_line1: 'Calle bodega 42', address_line2: 'Piso 2', city: 'Cali',
    state_province: 'Valle', country_code: 'CO', postal_code: '760001',
    phone_number: '3001234567', latitude: 3.45, longitude: -76.5, municipality_code: '76001',
  };
  const cart = (): CartState => ({
    items: [{ product: { id: '7' }, itemType: 'product', quantity: 1, totalPrice: 1000 }],
    customer: { id: 99, first_name: 'Cliente', phone: '3001234567', addresses: [
      { id: 1, address_line1: 'Casa principal 1', city: 'Bogotá', state_province: 'Bogotá', country_code: 'CO', is_primary: true },
      { ...originalAddress, id: 33, is_primary: false },
    ] },
    summary: { total: 1000 }, linkedOrderId: 700,
    shippingContext: { orderId: 700, customerId: 99, deliveryType: 'direct_delivery',
      shippingAddressId: 33, billingAddressId: 44, shippingMethodId: 7,
      shippingRateId: 88, shippingCost: 12500.5,
      shippingAddress: originalAddress, shippingMethod: originalMethod },
  } as unknown as CartState);
  const quote = (methodId: number, cost: number, id = 90): PosShippingOption => ({
    id, method_id: methodId, method_name: 'Método', method_type: 'carrier', cost, currency: 'COP',
  });
  const latestQuote = () => quotes[quotes.length - 1];
  const mount = (state = cart()) => {
    fixture.componentRef.setInput('cartState', state);
    fixture.detectChanges();
    methods.next([firstMethod, originalMethod]);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    methods = new Subject();
    quotes = [];
    calculate = jasmine.createSpy('calculateShipping').and.callFake(() => {
      const response = new Subject<PosShippingOption[]>();
      quotes.push(response);
      return response.asObservable();
    });
    customers = jasmine.createSpyObj<CustomersService>('CustomersService', ['createCustomerAddress', 'updateCustomerAddress']);
    TestBed.configureTestingModule({
      imports: [PosShippingStepComponent],
      providers: [
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: PosPaymentService, useValue: {} },
        { provide: PosShippingService, useValue: { getShippingMethods: () => methods, calculateShipping: calculate } },
        { provide: CustomersService, useValue: customers },
        { provide: ToastService, useValue: { show: () => {} } },
        { provide: CurrencyFormatService, useValue: { currencySymbol: signal('$'), loadCurrency: () => {} } },
        { provide: CountryService, useValue: { getCountries: () => of([{ code: 'CO', name: 'Colombia' }]), getDefaultCountry: () => ({ code: 'CO' }) } },
        { provide: DianMunicipalityLookupService, useValue: { resolveByName: () => of(null), setBaseUrl: () => {} } },
        { provide: GeocodingService, useValue: { forward: () => of(null), reverse: () => of(null) } },
      ],
    });
    TestBed.overrideComponent(PosShippingStepComponent, { set: {
      imports: [FormsModule, ReactiveFormsModule, AddressFormFieldsComponent, CurrencyStubPipe],
      schemas: [NO_ERRORS_SCHEMA],
    } });
    // Keep the real form's effects/outputs/validators, not its map/lookup controls.
    TestBed.overrideComponent(AddressFormFieldsComponent, { set: { template: '', imports: [] } });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(PosShippingStepComponent);
    component = fixture.componentInstance;
  });

  it('hydrates non-first method, non-primary address, original rate/cost without quotation', () => {
    mount();
    expect(component.selectedShippingMethod()?.id).toBe(7);
    expect(component.addressId()).toBe(33);
    expect(component.initialAddress()).toEqual(originalAddress);
    expect(component.shippingRateId()).toBe(88);
    expect(component.shippingCost()).toBe(12500.5);
    expect(component.totalWithShipping()).toBe(13500.5);
    expect(component.hasShippingChanges()).toBeFalse();
    expect(calculate).not.toHaveBeenCalled();
    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
    expect(customers.updateCustomerAddress).not.toHaveBeenCalled();
  });

  it('navigation and the real form initial country/municipality callbacks are not edits', () => {
    mount();
    component.goToShipSubStep(1);
    component.addressEditing.set(true);
    fixture.detectChanges();
    const form = fixture.debugElement.query(By.directive(AddressFormFieldsComponent)).componentInstance as AddressFormFieldsComponent;
    expect(form.form.pristine).toBeTrue();
    expect(form.form.get('address_line1')?.value).toBe(originalAddress.address_line1);
    form.form.get('country_code')!.setValue('CO');
    form.form.get('municipality_code')!.setValue('76001');
    fixture.detectChanges();
    component.goToShipSubStep(2);
    component.attemptPrevSubStep();
    expect(component.hasShippingChanges()).toBeFalse();
    expect(component.address()).toEqual(originalAddress);
    expect(component.editorValidationError()).toBeNull();
    expect(calculate).not.toHaveBeenCalled();
  });

  it('real dirty address edits cannot pretend the original ID stores the changed text', () => {
    mount();
    component.goToShipSubStep(1);
    component.addressEditing.set(true);
    fixture.detectChanges();
    const form = fixture.debugElement.query(By.directive(AddressFormFieldsComponent)).componentInstance as AddressFormFieldsComponent;
    form.form.markAsDirty();
    form.form.get('address_line1')!.setValue('Otra dirección 123');
    fixture.detectChanges();
    latestQuote().next([quote(7, 14000)]);
    fixture.detectChanges();
    expect(component.hasShippingChanges()).toBeTrue();
    expect(component.editorValidationError()).toContain('Guarda la dirección');
    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
    expect(customers.updateCustomerAddress).not.toHaveBeenCalled();
  });

  it('selecting another saved address and matching quote produces a valid changed context', () => {
    mount();
    component.selectSavedAddress(1);
    expect(component.editorValidationError()).toContain('Espera');
    fixture.detectChanges();
    latestQuote().next([quote(7, 9000, 93)]);
    fixture.detectChanges();
    expect(component.hasShippingChanges()).toBeTrue();
    expect(component.editorValidationError()).toBeNull();
    expect(component.buildShippingContext()).toEqual(jasmine.objectContaining({
      deliveryType: 'direct_delivery', shippingAddressId: 1,
      shippingMethodId: 7, shippingRateId: 93, shippingCost: 9000,
    }));
  });

  it('selecting the existing method/address again does not requote or dirty', () => {
    mount();
    component.selectShippingMethod(originalMethod);
    component.selectSavedAddress(33);
    fixture.detectChanges();
    expect(calculate).not.toHaveBeenCalled();
    expect(component.hasShippingChanges()).toBeFalse();
  });

  it('ignores stale quotes after a second method selection, including before effects run', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    const stale = latestQuote();
    component.selectShippingMethod(originalMethod);
    stale.next([quote(1, 111)]);
    expect(component.shippingCost()).toBe(12500.5);
    fixture.detectChanges();
    // Reverting to the untouched method does not need another quote.
    expect(component.hasShippingChanges()).toBeFalse();
    expect(component.buildShippingContext()?.shippingMethodId).toBe(7);
  });

  it('does not apply another method rate when the selected method has no matching quote', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    latestQuote().next([quote(7, 200)]);
    fixture.detectChanges();
    expect(component.shippingCost()).toBe(12500.5);
    expect(component.quoteError()).toContain('No hay tarifa');
    expect(component.editorValidationError()).toContain('No hay tarifa');
    expect(component.canConfirm()).toBeFalse();
  });

  it('keeps missing/inactive original method and address without default fallback, with warning', () => {
    const state = cart();
    state.shippingContext!.shippingAddress = null;
    state.shippingContext!.shippingMethod = { ...originalMethod, is_active: false };
    fixture.componentRef.setInput('cartState', state);
    fixture.detectChanges();
    methods.next([firstMethod]);
    fixture.detectChanges();
    expect(component.selectedShippingMethod()?.id).toBe(7);
    expect(component.address()).toBeNull();
    expect(component.addressId()).toBe(33);
    expect(component.preservationWarning()).toBeTruthy();
    expect(component.editorValidationError()).toBeNull();
    expect(component.attemptNextSubStep()).toBeTrue();
    expect(calculate).not.toHaveBeenCalled();
  });

  it('customer change clears the former destination and requires an explicit saved address', () => {
    const state = cart();
    mount(state);
    fixture.componentRef.setInput('cartState', { ...state, customer: {
      ...state.customer!, id: 100, addresses: [{ ...state.customer!.addresses![0], id: 1001 }],
    } });
    // The owner check is synchronous: do not trust the previous address before
    // the customer-change hydration effect has had a render turn.
    expect(component.editorValidationError()).toContain('Cambiaste el cliente');
    fixture.detectChanges();
    expect(component.address()).toBeNull();
    expect(component.addressId()).toBeNull();
    expect(component.editorValidationError()).toContain('Cambiaste el cliente');
    component.selectSavedAddress(33); // Former customer ID is not selectable.
    expect(component.addressId()).toBeNull();
    component.selectSavedAddress(1001);
    fixture.detectChanges();
    latestQuote().next([quote(7, 9000)]);
    fixture.detectChanges();
    expect(component.editorValidationError()).toBeNull();
    expect(component.buildShippingContext()?.shippingAddressId).toBe(1001);
  });

  it('changing order drops dirty edits and rejects the previous order quote', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    const stale = latestQuote();
    const other = cart();
    other.linkedOrderId = 701;
    other.shippingContext = { ...other.shippingContext!, orderId: 701, shippingCost: 22000 };
    fixture.componentRef.setInput('cartState', other);
    fixture.detectChanges();
    stale.next([quote(1, 1)]);
    expect(component.shippingCost()).toBe(22000);
    expect(component.selectedShippingMethod()?.id).toBe(7);
    expect(component.hasShippingChanges()).toBeFalse();
  });

  it('fresh cart still selects the first active method and primary customer address', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    expect(component.selectedShippingMethod()?.id).toBe(1);
    expect(component.addressId()).toBe(1);
    expect(calculate).toHaveBeenCalled();
    latestQuote().next([quote(1, 7000)]);
    fixture.detectChanges();
    expect(component.shippingCost()).toBe(7000);
  });

  it('rate-sourced cost: the context carries the rate and the payload keeps shipping_rate_id', () => {
    mount();
    component.selectSavedAddress(1);
    fixture.detectChanges();
    latestQuote().next([quote(7, 9000, 93)]);
    fixture.detectChanges();
    const context = component.buildShippingContext()!;
    expect(context.manualCostOverride).toBeFalse();
    expect(posShippingRateIdForPayload(context)).toBe(93);
  });

  it('manual cost override: the payload drops shipping_rate_id (no tax snapshot)', () => {
    mount();
    component.selectSavedAddress(1);
    fixture.detectChanges();
    latestQuote().next([quote(7, 9000, 93)]);
    fixture.detectChanges();
    component.shippingCost.set(5000);
    component.onShippingCostChange();
    const context = component.buildShippingContext()!;
    expect(context.manualCostOverride).toBeTrue();
    // El editor sigue leyendo la tarifa cruda; la venta/borrador no la manda.
    expect(context.shippingRateId).toBe(93);
    expect(posShippingRateIdForPayload(context)).toBeUndefined();
  });
});

describe('posShippingRateIdForPayload', () => {
  it('sends the rate only when there is one and the cost is not manual', () => {
    expect(posShippingRateIdForPayload({ shippingRateId: 5, manualCostOverride: false })).toBe(5);
    expect(posShippingRateIdForPayload({ shippingRateId: 5 })).toBe(5);
    expect(posShippingRateIdForPayload({ shippingRateId: 5, manualCostOverride: true })).toBeUndefined();
    expect(posShippingRateIdForPayload({ shippingRateId: null })).toBeUndefined();
    expect(posShippingRateIdForPayload(null)).toBeUndefined();
  });
});
