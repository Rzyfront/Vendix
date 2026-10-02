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
  PosManualShippingQuote,
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
  let manualQuote: jasmine.Spy;
  let customers: jasmine.SpyObj<CustomersService>;
  const originalMethod: PosShippingMethod = { id: 7, name: 'Transportadora', type: 'carrier', is_active: true };
  const firstMethod: PosShippingMethod = { id: 1, name: 'Mensajero', type: 'own_fleet', is_active: true };
  const originalAddress = {
    address_line1: 'Calle bodega 42', address_line2: 'Piso 2', city: 'Cali',
    state_province: 'Valle del Cauca', country_code: 'CO', postal_code: '760001',
    phone_number: '3001234567', latitude: 3.45, longitude: -76.5, municipality_code: '76001',
  };
  const dianDepartments = [
    { code: '11', name: 'Bogotá' },
    { code: '44', name: 'La Guajira' },
    { code: '76', name: 'Valle del Cauca' },
  ];
  const dianMunicipalities = [
    {
      code: '11001', name: 'Bogotá, D.c.', department_code: '11',
      department_name: 'Bogotá', postal_code: '110111',
    },
    {
      code: '44001', name: 'Riohacha', department_code: '44',
      department_name: 'La Guajira', postal_code: '440001',
    },
    {
      code: '76001', name: 'Cali', department_code: '76',
      department_name: 'Valle del Cauca', postal_code: '760001',
    },
  ];
  const municipalityLookup = {
    listDepartments: () => of(dianDepartments),
    listByDepartment: (code: string) =>
      of(dianMunicipalities.filter((municipality) => municipality.department_code === code)),
    resolveByCode: (code: string | null | undefined) =>
      of(dianMunicipalities.find((municipality) => municipality.code === code) ?? null),
    resolveByName: (city: string | null | undefined, department: string | null | undefined) => {
      const normalize = (value: string) => value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      const departmentText = normalize(department ?? '');
      const cityText = normalize(city ?? '');
      if (!departmentText || !cityText) return of(null);
      return of(dianMunicipalities.find((municipality) =>
        (normalize(municipality.department_name) === departmentText ||
          (municipality.department_code === '11' && departmentText === 'bogota d c')) &&
        (normalize(municipality.name) === cityText || normalize(municipality.name).startsWith(cityText)),
      ) ?? null);
    },
    setBaseUrl: () => {},
  };
  const cart = (): CartState => ({
    items: [{ product: { id: '7' }, itemType: 'product', quantity: 1, totalPrice: 1000 }],
    customer: { id: 99, first_name: 'Cliente', phone: '3001234567', addresses: [
      // Requirement 3 (coordinator, 2026-09) — a delivery method never quotes
      // without a resolved point: this saved address needs real coordinates
      // so the pre-existing method/rate/manual-cost tests below (which are
      // NOT about location-gating) keep exercising `/shipping/calculate`.
      // The location-gating itself gets its own dedicated tests further down.
      { id: 1, address_line1: 'Casa principal 1', city: 'Bogotá', state_province: 'Bogotá', country_code: 'CO', is_primary: true, latitude: 4.65, longitude: -74.05 },
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
  const selectMunicipality = (
    form: AddressFormFieldsComponent,
    departmentCode: string,
    municipalityCode: string,
  ) => {
    form.onDepartmentChange(departmentCode);
    form.onCityChange(municipalityCode);
  };

  beforeEach(async () => {
    methods = new Subject();
    quotes = [];
    calculate = jasmine.createSpy('calculateShipping').and.callFake(() => {
      const response = new Subject<PosShippingOption[]>();
      quotes.push(response);
      return response.asObservable();
    });
    manualQuote = jasmine.createSpy('quoteManualShipping').and.callFake(
      (_methodId: number, rateId: number, price: number) => of({
        shipping_rate_id: rateId,
        manual_shipping_price: price,
        shipping_cost: price,
        base: price,
        shipping_tax_amount: 0,
        tax_is_inclusive: null,
      }),
    );
    customers = jasmine.createSpyObj<CustomersService>('CustomersService', ['createCustomerAddress', 'updateCustomerAddress']);
    TestBed.configureTestingModule({
      imports: [PosShippingStepComponent],
      providers: [
        { provide: Router, useValue: { navigate: () => {} } },
        { provide: PosPaymentService, useValue: {} },
        { provide: PosShippingService, useValue: { getShippingMethods: () => methods, calculateShipping: calculate, quoteManualShipping: manualQuote } },
        { provide: CustomersService, useValue: customers },
        { provide: ToastService, useValue: { show: () => {} } },
        { provide: CurrencyFormatService, useValue: { currencySymbol: signal('$'), loadCurrency: () => {}, format: (v: number) => `$${v}` } },
        { provide: CountryService, useValue: { getCountries: () => of([{ code: 'CO', name: 'Colombia' }]), getDefaultCountry: () => ({ code: 'CO' }) } },
        { provide: DianMunicipalityLookupService, useValue: municipalityLookup },
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
    expect(component.validateDetailsForCliente()).toBeTrue();
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
    expect(component.validateDetailsForCliente()).toBeFalse();
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
    expect(component.address()?.phone_number).toBe('3001234567');
    expect(calculate).toHaveBeenCalled();
    component.goToShipSubStep(1);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Casa principal 1');
    latestQuote().next([quote(1, 7000)]);
    fixture.detectChanges();
    expect(component.shippingCost()).toBe(7000);
  });

  it('precarga teléfono al crear dirección y permite un teléfono de destinatario distinto', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [] };
    mount(state);
    expect(component.initialAddress()?.phone_number).toBe('3001234567');
    expect(component.addressValid()).toBeFalse();
    component.address.set({ ...originalAddress, phone_number: '3117654321' });
    component.addressValid.set(true);
    expect(component.buildShippingContext()?.shippingAddress.recipient_phone).toBe('3117654321');
  });

  it('usar otra dirección crea un destino nuevo sin reutilizar el id guardado', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    expect(component.addressId()).toBe(1);
    component.beginNewAddress();
    expect(component.addressId()).toBeNull();
    expect(component.initialAddress()?.phone_number).toBe('3001234567');
    expect(component.addressValid()).toBeFalse();
    component.onAddressChange({ ...originalAddress, address_line1: 'Calle nueva 10' }, true);
    component.onAddressValidChange(true);
    expect(component.buildShippingContext()?.shippingAddressId).toBeUndefined();
  });

  it('H6 — dirección guardada sin state_province muestra el formulario y al elegir ubicación DANE queda válida', () => {
    // `state_province` es nullable en Prisma; `phone_number` se rellena aparte
    // desde `customer.phone` en `toAddressPayload`. Se omite también el código
    // DANE para probar que el cajero puede completar la ubicación desde el form.
    const incompleteSaved = {
      ...originalAddress,
      id: 55,
      type: 'shipping',
      is_primary: true,
      state_province: null as any,
      municipality_code: null,
    };
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [incompleteSaved] };
    fixture.componentRef.setInput('detailsInCliente', true);
    mount(state);

    expect(component.addressId()).toBe(55);
    expect(component.addressValid()).toBeFalse();
    // Antes de este fix, la plantilla `#clientDeliveryDetails` solo mostraba
    // resumen + "Usar otra dirección" (formulario vacío) para este caso; el
    // fix reabre el mismo formulario precargado con la dirección guardada.
    expect(component.addressEditing()).toBeTrue();
    expect(component.initialAddress()).toEqual(jasmine.objectContaining({
      address_line1: originalAddress.address_line1, city: originalAddress.city,
      state_province: null,
    }));
    expect(component.missingAddressFieldsLabel()).toBe('el departamento');

    // El cajero completa el departamento y municipio como una ubicación DANE coherente.
    const form = fixture.debugElement.query(By.directive(AddressFormFieldsComponent))
      .componentInstance as AddressFormFieldsComponent;
    selectMunicipality(form, '76', '76001');
    fixture.detectChanges();

    expect(component.addressValid()).toBeTrue();
    expect(component.addressId()).toBe(55); // sigue siendo UPDATE sobre el mismo id, no uno nuevo
  });

  it('en Cliente muestra solo costo en Envío y exige método y dirección antes de avanzar', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('detailsInCliente', true);
    mount(state);
    expect(component.clientDeliveryDetails()).toBeTruthy();
    expect(fixture.debugElement.query(By.css('app-address-form-fields'))).toBeFalsy();
    expect(component.isCostSubStep()).toBeTrue();
    component.selectedShippingMethod.set(null);
    expect(component.validateDetailsForCliente()).toBeFalse();
    component.selectedShippingMethod.set(firstMethod);
    component.address.set(null);
    component.addressValid.set(false);
    expect(component.validateDetailsForCliente()).toBeFalse();
    expect(component.showAddressErrors()).toBeTrue();
  });

  it('QUI-844 — solo los métodos activos se muestran al elegir envío a domicilio', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('cartState', state);
    fixture.detectChanges();
    methods.next([
      firstMethod,
      { ...originalMethod, id: 9, name: 'Apagado', is_active: false },
    ]);
    fixture.detectChanges();
    expect(component.activeShippingMethods().map((m) => m.id)).toEqual([1]);
    const cards = fixture.debugElement.queryAll(By.css('.method-card'));
    expect(cards.length).toBe(1);
    expect(cards[0].nativeElement.textContent).toContain('Mensajero');
  });

  it('keeps a declared delivery address visibly invalid without a shipping method and does not charge', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    component.shippingMethods.set([]);
    component.selectedShippingMethod.set(null);
    fixture.detectChanges();

    expect(component.missingShippingMethodReason()).toContain('antes de guardar o cobrar');
    expect(fixture.nativeElement.textContent).toContain('Selecciona un método de envío antes de guardar o cobrar');
    expect(component.canConfirm()).toBeFalse();
    expect(component.buildShippingContext()).toBeNull();
    component.execute({ mode: 'contado' } as any);
    expect(component.isProcessing()).toBeFalse();
  });

  it('does not require a delivery address for an explicitly selected pickup method', () => {
    mount();
    const pickup: PosShippingMethod = { id: 9, name: 'Recoger', type: 'pickup', is_active: true };
    component.shippingMethods.set([...component.shippingMethods(), pickup]);
    component.selectShippingMethod(pickup);
    component.address.set(null);
    component.addressValid.set(false);
    fixture.detectChanges();

    expect(component.missingShippingMethodReason()).toBeNull();
    expect(component.canConfirm()).toBeTrue();
    expect(component.buildShippingContext()?.deliveryType).toBe('pickup');
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

  it('manual cost override keeps its rate and typed price for server tax calculation', () => {
    mount();
    component.selectSavedAddress(1);
    fixture.detectChanges();
    latestQuote().next([quote(7, 9000, 93)]);
    fixture.detectChanges();
    component.shippingCost.set(5000);
    component.onShippingCostChange();
    const context = component.buildShippingContext()!;
    expect(context.manualCostOverride).toBeTrue();
    expect(context.shippingRateId).toBe(93);
    expect(context.manualShippingPrice).toBe(5000);
    expect(posShippingRateIdForPayload(context)).toBe(93);
    expect(manualQuote).toHaveBeenCalledWith(7, 93, 5000);
  });

  it('keeps a pending manual tax quote when a late address update invalidates the automatic quote', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = null;
    mount(state);
    component.selectedShippingMethod.set(firstMethod);
    component.shippingRateId.set(93);
    component.manualCostOverride.set(true);
    const pendingQuote = new Subject<PosManualShippingQuote>();
    manualQuote.and.returnValue(pendingQuote.asObservable());

    component.onShippingCostChange(18000);
    component.onAddressChange({
      ...originalAddress,
      city: 'Riohacha',
      state_province: 'La Guajira',
      municipality_code: '44001',
      postal_code: '440001',
    }, true);
    pendingQuote.next({
      shipping_rate_id: 93,
      manual_shipping_price: 18000,
      shipping_cost: 18000,
      base: 15126.05,
      shipping_tax_amount: 2873.95,
      tax_is_inclusive: true,
    });
    fixture.detectChanges();

    expect(manualQuote).toHaveBeenCalledWith(1, 93, 18000);
    expect(component.shippingCost()).toBe(18000);
    expect(component.manualQuotedShippingTax()).toEqual({
      base: 15126.05,
      tax: 2873.95,
      taxIsInclusive: true,
    });
  });

  it('quotes alias delivery with the same full destination fields used by a customer address', () => {
    const state = cart();
    state.customer = null;
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.onAddressChange(originalAddress, true);
    fixture.detectChanges();

    expect(calculate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      country_code: 'CO', city: 'Cali', state_province: 'Valle del Cauca',
      postal_code: '760001', latitude: 3.45, longitude: -76.5,
    }));
  });

  it('keeps saved customer coordinates for distance-based quotation', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [
      { ...originalAddress, id: 33, type: 'shipping', is_primary: true },
    ] };
    mount(state);
    expect(component.address()).toEqual(jasmine.objectContaining({
      latitude: 3.45, longitude: -76.5,
    }));
    expect(calculate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      postal_code: '760001', latitude: 3.45, longitude: -76.5,
    }));
  });

  it('passes the reopened order id to the shipping charge', () => {
    const payment = TestBed.inject(PosPaymentService) as any;
    payment.processShippingSale = jasmine.createSpy('processShippingSale').and.returnValue(
      of({ success: true, order: { id: 700 } }),
    );
    fixture.componentRef.setInput('editingOrderId', 700);
    mount();

    (component as any).processOrder(
      component.buildShippingContext()!.shippingAddress,
      'home_delivery', null, 33,
    );

    expect(payment.processShippingSale.calls.mostRecent().args[5]).toBe(700);
  });

  it('propaga la propina calculada y su mesero al cobro de domicilio', () => {
    const payment = TestBed.inject(PosPaymentService) as any;
    payment.processShippingSale = jasmine.createSpy('processShippingSale').and.returnValue(
      of({ success: true, order: { id: 700 } }),
    );
    mount();
    component.execute({
      mode: 'contado', method: { id: '1', type: 'cash' },
      tip: 1500, tipType: 'percentage', tipValue: 1500, tipWaiterId: 7,
    } as any);
    const request = payment.processShippingSale.calls.mostRecent().args[2];
    expect(request).toEqual(jasmine.objectContaining({
      tip_amount: 1500, tip_type: 'percentage', tip_value: 1500, tip_waiter_id: 7,
    }));
  });

  it('does not save a primary address without a valid customer id', () => {
    const state = cart();
    state.customer = { ...state.customer!, id: null as any, addresses: [] };
    mount(state);
    const process = spyOn<any>(component, 'processOrder');

    (component as any).persistAddressThenProcess(originalAddress, originalAddress, 'direct_delivery', null);

    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
    expect(process).toHaveBeenCalled();
  });

  it('sends alias delivery snapshot without creating an address or sending an id', () => {
    const state = cart();
    state.customer = null;
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.address.set(originalAddress);
    component.addressValid.set(true);
    component.manualCostOverride.set(true);
    component.shippingCost.set(5000);
    const payment = TestBed.inject(PosPaymentService) as any;
    payment.processShippingSale = jasmine.createSpy('processShippingSale').and.returnValue(
      of({ success: true, order: { id: 700 } }),
    );

    expect(component.canConfirm()).toBeTrue();
    component.execute({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);

    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
    expect(payment.processShippingSale.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      customerAlias: 'Portería torre B', shippingAddressId: null,
      shippingAddress: jasmine.objectContaining({
        address_line1: originalAddress.address_line1, recipient_name: 'Portería torre B',
        latitude: 3.45, longitude: -76.5, municipality_code: '76001',
      }),
    }));
  });

  it('builds alias draft context with snapshot but no address id or POST', () => {
    const state = cart();
    state.customer = null;
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.address.set(originalAddress);
    component.addressValid.set(true);
    const context = component.buildShippingContext()!;
    expect(context.customerAlias).toBe('Portería torre B');
    expect(context.shippingAddress).toEqual(jasmine.objectContaining({
      recipient_name: 'Portería torre B', latitude: 3.45, longitude: -76.5,
      municipality_code: '76001',
    }));
    expect(context.shippingAddressId).toBeUndefined();
    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
  });

  it('retains zero map coordinates and omits absent municipality code in alias snapshot', () => {
    const state = cart();
    state.customer = null;
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.address.set({ ...originalAddress, latitude: 0, longitude: 0, municipality_code: null });
    const snapshot = component.buildShippingContext()!.shippingAddress;

    expect(snapshot.latitude).toBe(0);
    expect(snapshot.longitude).toBe(0);
    expect(snapshot.municipality_code).toBeUndefined();
  });

  it('omits a registered customer address FK when switching an adopted draft to alias', () => {
    const state = cart();
    state.customer = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.address.set(originalAddress);
    component.addressValid.set(true);
    component.addressId.set(33);
    expect(component.addressId()).toBe(33);
    expect(component.buildShippingContext()?.shippingAddressId).toBeUndefined();
    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
  });

  it('charges alias delivery without calling the address API', () => {
    const state = cart();
    state.customer = null;
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    fixture.componentRef.setInput('customerAlias', 'Portería torre B');
    mount(state);
    component.address.set(originalAddress);
    component.addressValid.set(true);
    component.manualCostOverride.set(true);
    const payment = TestBed.inject(PosPaymentService) as any;
    payment.processShippingSale = jasmine.createSpy('processShippingSale').and.returnValue(
      of({ success: true, order: { id: 700 } }),
    );

    component.execute({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);

    expect(customers.createCustomerAddress).not.toHaveBeenCalled();
    expect(payment.processShippingSale).toHaveBeenCalledTimes(1);
    expect(component.isProcessing()).toBeFalse();
  });

  it('keeps registered-customer address creation and primary flag', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [] };
    mount(state);
    component.address.set(originalAddress);
    component.addressValid.set(true);
    component.manualCostOverride.set(true);
    customers.createCustomerAddress.and.returnValue(of({ id: 321 }));
    const payment = TestBed.inject(PosPaymentService) as any;
    payment.processShippingSale = jasmine.createSpy('processShippingSale').and.returnValue(
      of({ success: true, order: { id: 700 } }),
    );

    component.execute({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);

    expect(customers.createCustomerAddress.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({ customer_id: 99, is_primary: true }),
    );
    expect(payment.processShippingSale.calls.mostRecent().args[1].shippingAddressId).toBe(321);
  });

  it('paso 15b — muestra base + impuesto en modo incluido', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    latestQuote().next([{ ...quote(1, 15000), base: 13888.89, shipping_tax_amount: 1111.11, tax_is_inclusive: true }]);
    fixture.detectChanges();
    component.goToShipSubStep(2);
    fixture.detectChanges();
    expect(component.shippingTaxBreakdown()).toEqual({ base: 13888.89, tax: 1111.11, taxIsInclusive: true });
    expect(component.shippingTaxModeLabel()).toBe('Incluido');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Base envío');
    expect(text).toContain('13888.89');
    expect(text).toContain('Impuesto (Incluido)');
    expect(text).toContain('1111.11');
  });

  it('modo agregado: costo manual usa base digitada, cobra bruto y conserva desglose', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    const taxed = { ...quote(1, 11900), base: 10000, shipping_tax_amount: 1900, tax_is_inclusive: false };
    latestQuote().next([taxed]);
    fixture.detectChanges();
    component.goToShipSubStep(2);
    fixture.detectChanges();
    expect(component.shippingTaxBreakdown()).toEqual({ base: 10000, tax: 1900, taxIsInclusive: false });
    expect(component.shippingTaxModeLabel()).toBe('Agregado');
    expect(fixture.nativeElement.textContent).toContain('Impuesto (Agregado)');
    manualQuote.and.callFake((_methodId: number, rateId: number, price: number) => of({
      shipping_rate_id: rateId, manual_shipping_price: price,
      shipping_cost: price * 1.19, base: price,
      shipping_tax_amount: price * 0.19, tax_is_inclusive: false,
    }));
    component.toggleManualCost();
    component.onShippingCostChange(5000);
    fixture.detectChanges();
    expect(component.shippingCost()).toBe(5950);
    expect(component.shippingTaxBreakdown()).toEqual({ base: 5000, tax: 950, taxIsInclusive: false });
    expect(component.manualTaxUnavailable()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('es la base; se añade el impuesto');
    // Volver a automático restaura el desglose sin esperar la recotización.
    component.toggleManualCost();
    expect(component.shippingTaxBreakdown()).toEqual({ base: 10000, tax: 1900, taxIsInclusive: false });
    fixture.detectChanges();
    latestQuote().next([taxed]);
    fixture.detectChanges();
    expect(component.shippingTaxBreakdown()).toEqual({ base: 10000, tax: 1900, taxIsInclusive: false });
  });

  it('paso 15b — sin bloque fiscal en la cotización no hay desglose ni aviso', () => {
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    mount(state);
    latestQuote().next([quote(1, 7000)]);
    fixture.detectChanges();
    component.goToShipSubStep(2);
    fixture.detectChanges();
    expect(component.shippingTaxBreakdown()).toBeNull();
    expect(component.manualTaxUnavailable()).toBeFalse();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('Base envío');
    expect(text).not.toContain('Impuesto (');
  });

  it('paso 15b — el snapshot histórico sin cotizar no inventa desglose', () => {
    mount();
    component.goToShipSubStep(2);
    fixture.detectChanges();
    expect(calculate).not.toHaveBeenCalled();
    expect(component.shippingTaxBreakdown()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Base envío');
  });

  // B6 — backend puede devolver varias tarifas aplicables por método; antes
  // el `.find()` se quedaba con la primera y descartaba el resto. Con 2+
  // tarifas para el método activo debe aparecer el selector y cambiar de
  // tarifa debe actualizar el costo.
  it('B6 — una sola tarifa no muestra selector', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    latestQuote().next([quote(1, 7000, 201)]);
    fixture.detectChanges();
    expect(component.rateOptions().length).toBe(1);
    expect(fixture.debugElement.query(By.css('app-selector'))).toBeFalsy();
  });

  it('B6 — dos tarifas para el método activo muestran el selector y preseleccionan la primera', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    latestQuote().next([quote(1, 7000, 201), quote(1, 9500, 202)]);
    // El selector vive en el sub-paso terminal «Costo».
    component.goToShipSubStep(component.shipSubSteps().length - 1);
    fixture.detectChanges();
    expect(component.rateOptions().length).toBe(2);
    expect(fixture.debugElement.query(By.css('app-selector'))).toBeTruthy();
    expect(component.shippingRateId()).toBe(201);
    expect(component.shippingCost()).toBe(7000);
  });

  // Zoneless: sin zone.js/testing, `fakeAsync` no existe en este arnés (ver
  // pos-order-confirmation.component.spec.ts). Se usa `jasmine.clock()` para
  // controlar el debounce de 500ms del forward-geocode del formulario real.
  it('after selecting Riohacha and geocoding, /shipping/calculate receives coordinates and DANE code', async () => {
    const geocoding = TestBed.inject(GeocodingService) as unknown as { forward: jasmine.Spy };
    geocoding.forward = jasmine.createSpy('forward').and.returnValue(
      of({ lat: 11.5444, lng: -72.907, precision: 'exact' }),
    );
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [] };
    // `debounceTime`'s internal "did we really wait long enough" check reads
    // `Date.now()` (via RxJS's `asyncScheduler`/`dateTimestampProvider`), which
    // `jasmine.clock().install()` alone does NOT mock — only the timer
    // functions (setTimeout/setInterval). Without `mockDate()`, `tick()` fires
    // the fake interval, but the operator sees real wall-clock time barely
    // advanced, decides it hasn't actually waited 500ms, and reschedules
    // instead of emitting — the callback never runs and the spy is never
    // called. `mockDate()` freezes/advances `Date` in lockstep with `tick()`
    // so the operator's own time check agrees with the fake clock.
    //
    // Installed before rendering so the form's catalog-backed geographic
    // selection and address edit share the same fake scheduler. Tick once after
    // mount to flush any harmless initialization emission before editing.
    jasmine.clock().install();
    jasmine.clock().mockDate();
    try {
      mount(state);
      component.goToShipSubStep(1);
      fixture.detectChanges();
      jasmine.clock().tick(600);

      const form = fixture.debugElement.query(By.directive(AddressFormFieldsComponent))
        .componentInstance as AddressFormFieldsComponent;
      form.form.markAsDirty();
      form.form.get('address_line1')!.setValue('Carrera 7 # 32-16');
      selectMunicipality(form, '44', '44001');
      jasmine.clock().tick(600); // flush the shared component's 500ms forward-geocode debounce
      await fixture.whenStable();
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(geocoding.forward).toHaveBeenCalled();
    expect(component.address()).toEqual(jasmine.objectContaining({
      city: 'Riohacha', state_province: 'La Guajira', municipality_code: '44001',
      latitude: 11.5444, longitude: -72.907,
    }));
    expect(component.addressGeocodePrecision()).toBe('exact');
    expect(calculate.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      city: 'Riohacha', state_province: 'La Guajira', municipality_code: '44001',
      latitude: 11.5444, longitude: -72.907,
    }));
  });

  // BUG 2 (E2E roku-shop.vendix.com/checkout, 2026-09-27): 'area' precision is
  // a city/vereda centroid, NOT a resolved point. Before this fix, any
  // non-null forward-geocode result (including 'area') was applied to
  // latitude/longitude and unblocked the quote — a nonsense rural address
  // resolved to the city centroid and could get quoted/charged silently.
  // Mirrors the 'exact' test above but asserts the location gate STAYS shut.
  it("BUG 2 — 'area' precision does not resolve a location or unblock the quote", async () => {
    const geocoding = TestBed.inject(GeocodingService) as unknown as { forward: jasmine.Spy };
    geocoding.forward = jasmine.createSpy('forward').and.returnValue(
      of({ lat: 11.5444, lng: -72.907, precision: 'area', label: 'Riohacha, La Guajira' }),
    );
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = { ...state.customer!, addresses: [] };
    jasmine.clock().install();
    jasmine.clock().mockDate();
    try {
      mount(state);
      component.goToShipSubStep(1);
      fixture.detectChanges();
      jasmine.clock().tick(600);

      const form = fixture.debugElement.query(By.directive(AddressFormFieldsComponent))
        .componentInstance as AddressFormFieldsComponent;
      form.form.markAsDirty();
      form.form.get('address_line1')!.setValue('Vereda Xyzqwerty Km 99 Via Inexistente');
      selectMunicipality(form, '44', '44001');
      jasmine.clock().tick(600);
      await fixture.whenStable();
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(geocoding.forward).toHaveBeenCalled();
    expect(component.address()?.latitude).toBeNull();
    expect(component.address()?.longitude).toBeNull();
    expect(component.addressGeocodePrecision()).toBeNull();
    expect(component.hasResolvedLocation()).toBeFalse();
    expect(component.canConfirm()).toBeFalse();
    expect(calculate).not.toHaveBeenCalled();
  });

  // GAP 1 (2026-09-27, `vendix-address-geocoding` / `vendix-shipping-distance-pricing`
  // parity fix) — the SAVED-address coords backfill (`ensureSavedAddressCoords`,
  // triggered by `loadDefaultAddress` for a fresh sale with no `shippingContext`)
  // must reject an 'area' (city/vereda centroid) geocode exactly like the
  // new-address form's own forward-geocode does (see "BUG 2" above): never
  // write it to latitude/longitude, never PATCH `updateCustomerAddress` (that
  // would poison the customer's saved address with a centroid forever), and
  // leave `hasResolvedLocation()` false so the cashier still has to mark the map.
  it("saved-address backfill — 'area' precision is not persisted and the location gate stays shut", () => {
    const geocoding = TestBed.inject(GeocodingService) as unknown as { forward: jasmine.Spy };
    geocoding.forward = jasmine.createSpy('forward').and.returnValue(
      of({ lat: 11.5444, lng: -72.907, precision: 'area', label: 'Riohacha, La Guajira' }),
    );
    const state = cart();
    state.shippingContext = undefined;
    state.linkedOrderId = null;
    state.customer = {
      ...state.customer!,
      addresses: [
        {
          id: 501,
          address_line1: 'Vereda Xyzqwerty Km 99 Via Inexistente',
          city: 'Riohacha',
          state_province: 'La Guajira',
          country_code: 'CO',
          type: 'shipping',
          is_primary: true,
          latitude: null,
          longitude: null,
        },
      ],
    };
    mount(state);

    expect(geocoding.forward).toHaveBeenCalled();
    expect(component.addressId()).toBe(501);
    expect(component.address()?.latitude).toBeNull();
    expect(component.address()?.longitude).toBeNull();
    expect(component.hasResolvedLocation()).toBeFalse();
    expect(customers.updateCustomerAddress).not.toHaveBeenCalled();
  });

  it('B6 — cambiar de tarifa en el selector actualiza el costo de envío', () => {
    mount();
    component.selectShippingMethod(firstMethod);
    fixture.detectChanges();
    latestQuote().next([quote(1, 7000, 201), quote(1, 9500, 202)]);
    fixture.detectChanges();

    component.onRateSelected(202);
    fixture.detectChanges();

    expect(component.shippingRateId()).toBe(202);
    expect(component.shippingCost()).toBe(9500);
    expect(component.totalWithShipping()).toBe(10500);
  });

  // ── Requirement 3 (coordinator, 2026-09): a delivery method must never
  // quote/charge a default rate for an address with no resolved point. ──────
  describe('location-required shipping gate', () => {
    it('never calls /shipping/calculate for a delivery address with no coordinates', () => {
      const state = cart();
      state.shippingContext = undefined;
      state.linkedOrderId = null;
      state.customer = { ...state.customer!, addresses: [
        { id: 5, address_line1: 'Calle sin geocodificar 1', city: 'Neiva', country_code: 'CO', is_primary: true, type: 'shipping' },
      ] };
      mount(state);

      expect(calculate).not.toHaveBeenCalled();
      expect(component.hasResolvedLocation()).toBeFalse();
      expect(component.canConfirm()).toBeFalse();
      component.flashValidation();
      expect(component.flashMessage()).toBe('Marca la ubicación en el mapa para calcular el envío');
    });

    it('a manually typed cost cannot bypass the no-coordinates block', () => {
      const state = cart();
      state.shippingContext = undefined;
      state.linkedOrderId = null;
      state.customer = { ...state.customer!, addresses: [
        { id: 5, address_line1: 'Calle sin geocodificar 1', city: 'Neiva', country_code: 'CO', is_primary: true, type: 'shipping' },
      ] };
      mount(state);
      component.manualCostOverride.set(true);
      component.shippingCost.set(15000);
      fixture.detectChanges();

      expect(component.canConfirm()).toBeFalse();
    });

    it('resolving coordinates (e.g. a confirmed map pin) unblocks the automatic quote', () => {
      const state = cart();
      state.shippingContext = undefined;
      state.linkedOrderId = null;
      state.customer = { ...state.customer!, addresses: [] };
      mount(state);
      component.onAddressChange({ ...originalAddress, pin_confirmed: true }, true);
      component.addressValid.set(true);
      fixture.detectChanges();

      expect(calculate).toHaveBeenCalled();
      // Fresh cart auto-selects the first active method (id 1), not `originalMethod` (id 7).
      latestQuote().next([quote(1, 9000, 93)]);
      fixture.detectChanges();

      expect(component.hasResolvedLocation()).toBeTrue();
      expect(component.shippingRateId()).toBe(93);
      expect(component.canConfirm()).toBeTrue();
    });

    it('a resolved location with zero matching rates blocks with the no-rate message, not the no-location one', () => {
      mount();
      component.selectShippingMethod(firstMethod);
      fixture.detectChanges();
      latestQuote().next([]); // /shipping/calculate resolved but found no rate for this method/zone.
      fixture.detectChanges();

      expect(component.hasResolvedLocation()).toBeTrue();
      expect(component.quoteError()).toBe('No hay tarifa de envío para esta ubicación');
      expect(component.canConfirm()).toBeFalse();
    });
  });
});

describe('posShippingRateIdForPayload', () => {
  it('sends the rate only when there is one and the cost is not manual', () => {
    expect(posShippingRateIdForPayload({ shippingRateId: 5, manualCostOverride: false })).toBe(5);
    expect(posShippingRateIdForPayload({ shippingRateId: 5 })).toBe(5);
    expect(posShippingRateIdForPayload({ shippingRateId: 5, manualCostOverride: true })).toBe(5);
    expect(posShippingRateIdForPayload({ shippingRateId: null })).toBeUndefined();
    expect(posShippingRateIdForPayload(null)).toBeUndefined();
  });
});
