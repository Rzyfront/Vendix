import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';

import { AddressFormFieldsComponent } from './address-form-fields.component';
import { DianMunicipalityLookupService } from '../../services/dian-municipality-lookup.service';
import { GeocodingService } from '../../../private/modules/ecommerce/services/geocoding.service';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';

const ADDRESS_TEST_DEPARTMENTS = [{ code: '44', name: 'La Guajira' }];
const ADDRESS_TEST_RIOHACHA = {
  code: '44001', name: 'Riohacha', department_code: '44',
  department_name: 'La Guajira', postal_code: '440001',
};

/** Regression coverage for the DANE department → municipality form flow. */
describe('AddressFormFieldsComponent — selectores DANE', () => {
  let fixture: ComponentFixture<AddressFormFieldsComponent>;
  let component: AddressFormFieldsComponent;
  let resolveByName: jasmine.Spy;
  let resolveByCode: jasmine.Spy;
  let listByDepartment: jasmine.Spy;
  let forward: jasmine.Spy;
  let municipalityCenter: jasmine.Spy;

  const riohacha = {
    code: '44001', name: 'Riohacha', department_code: '44',
    department_name: 'La Guajira', postal_code: '440001',
  };
  const departments = [{ code: '44', name: 'La Guajira' }, { code: '05', name: 'Antioquia' }];

  beforeEach(() => {
    resolveByName = jasmine.createSpy('resolveByName').and.returnValue(of(null));
    resolveByCode = jasmine.createSpy('resolveByCode').and.returnValue(of(null));
    listByDepartment = jasmine.createSpy('listByDepartment').and.callFake((code: string) =>
      of(code === '44' ? [riohacha] : [{
        code: '05001', name: 'Medellín', department_code: '05',
        department_name: 'Antioquia', postal_code: '050001',
      }]),
    );
    forward = jasmine.createSpy('forward').and.returnValue(of(null));
    municipalityCenter = jasmine
      .createSpy('municipalityCenter')
      .and.returnValue(of({ lat: 11.54, lng: -72.91 }));
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        {
          provide: DianMunicipalityLookupService,
          useValue: {
            listDepartments: () => of(departments), listByDepartment,
            resolveByName, resolveByCode, setBaseUrl: () => {},
          },
        },
        { provide: GeocodingService, useValue: { forward, municipalityCenter, reverse: () => of(null) } },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'), currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0, loadCurrency: () => {}, format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AddressFormFieldsComponent);
    component = fixture.componentInstance;
  });

  it('elige departamento y ciudad del catálogo y emite los nombres/código oficiales', async () => {
    let emitted: unknown;
    component.addressChange.subscribe((value) => emitted = value);
    fixture.detectChanges();
    await fixture.whenStable();
    component.form.get('address_line1')!.setValue('Calle 1 # 2-3');
    component.onDepartmentChange('44');
    component.onCityChange('44001');

    expect(listByDepartment).toHaveBeenCalledWith('44');
    expect(component.form.value).toEqual(jasmine.objectContaining({
      city: 'Riohacha', state_province: 'La Guajira', municipality_code: '44001',
    }));
    expect(emitted).toEqual(jasmine.objectContaining({
      city: 'Riohacha', state_province: 'La Guajira', municipality_code: '44001',
    }));
  });

  it('cambiar departamento limpia ciudad/código y coordenadas anteriores', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    component.onDepartmentChange('44');
    component.onCityChange('44001');
    component.onLocated({ lat: 11.54, lng: -72.91 });
    component.onDepartmentChange('05');

    expect(component.form.get('city')!.value).toBeNull();
    expect(component.form.get('state_province')!.value).toBe('Antioquia');
    expect(component.form.get('municipality_code')!.value).toBeNull();
    expect(component.coordsSignal()).toBeNull();
    expect(component.form.get('latitude')!.value).toBeNull();
  });

  it('al limpiar ciudad elimina código/coords y una re-selección idéntica conserva el pin', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    component.onDepartmentChange('44');
    component.onCityChange('44001');
    component.onLocated({ lat: 11.54, lng: -72.91 });
    component.onCityChange('44001');
    expect(component.coordsSignal()).toEqual({ lat: 11.54, lng: -72.91 });

    component.onCityChange(null);
    expect(component.form.get('city')!.value).toBeNull();
    expect(component.form.get('municipality_code')!.value).toBeNull();
    expect(component.form.invalid).toBeTrue();
    expect(component.coordsSignal()).toBeNull();
  });

  it('quita el selector redundante y mantiene inválida una dirección sin ciudad DANE', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-dian-municipality-select'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('app-selector')).length).toBe(3);
    expect(component.form.invalid).toBeTrue();
    expect(component.municipalitySelectorDisabled()).toBeTrue();
  });

  it('rehidrata por código, normaliza nombres y conserva coordenadas válidas sin dirty', async () => {
    resolveByCode.and.returnValue(of(riohacha));
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'Vieja', state_province: 'Viejo',
      country_code: 'CO', latitude: 11.54, longitude: -72.91, municipality_code: '44001',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(resolveByCode).toHaveBeenCalledWith('44001');
    expect(component.selectedDepartmentCode()).toBe('44');
    expect(component.selectedMunicipalityCode()).toBe('44001');
    expect(component.form.get('city')!.value).toBe('Riohacha');
    expect(component.form.get('state_province')!.value).toBe('La Guajira');
    expect(component.coordsSignal()).toEqual({ lat: 11.54, lng: -72.91 });
    expect(component.form.pristine).toBeTrue();
  });

  it('rehidrata texto DANE sin código y deja el form válido/pristine sin geocodificar', async () => {
    resolveByName.and.returnValue(of(riohacha));
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'Riohacha', state_province: 'La Guajira', country_code: 'CO',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(resolveByName).toHaveBeenCalledOnceWith('Riohacha', 'La Guajira');
    expect(component.selectedDepartmentCode()).toBe('44');
    expect(component.selectedMunicipalityCode()).toBe('44001');
    expect(component.form.get('city')!.value).toBe('Riohacha');
    expect(component.form.get('municipality_code')!.value).toBe('44001');
    expect(component.form.valid).toBeTrue();
    expect(component.form.pristine).toBeTrue();
    expect(forward).not.toHaveBeenCalled();
  });

  it('resuelve una sola vez por nombre; campos invertidos quedan vacíos, inválidos y con pista', async () => {
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'La guajira', state_province: 'Riohacha', country_code: 'CO',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(resolveByName).toHaveBeenCalledOnceWith('La guajira', 'Riohacha');
    expect(component.selectedDepartmentCode()).toBeNull();
    expect(component.selectedMunicipalityCode()).toBeNull();
    expect(component.form.get('city')!.value).toBeNull();
    expect(component.form.get('state_province')!.value).toBeNull();
    expect(component.form.invalid).toBeTrue();
    expect(component.legacyAddressHint()).toBe('Antes: La guajira, Riohacha');
  });

  it('descarta la resolución tardía si el usuario elige otra ciudad', async () => {
    const pending = new Subject<typeof riohacha | null>();
    resolveByName.and.returnValue(pending);
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'Ciudad vieja', state_province: 'Depto viejo', country_code: 'CO',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    component.onDepartmentChange('44');
    component.onCityChange('44001');
    pending.next({ ...riohacha, code: '44002', name: 'Uribia' });

    expect(component.form.get('city')!.value).toBe('Riohacha');
    expect(component.form.get('municipality_code')!.value).toBe('44001');
  });

  it('ubicación fija resuelta: oculta selectores, muestra chip y el form es válido con dirección y teléfono', async () => {
    resolveByName.and.returnValue(of(riohacha));
    fixture.componentRef.setInput('lockedLocation', {
      country_code: 'CO', state_province: 'La Guajira', city: 'Riohacha',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    component.form.get('address_line1')!.setValue('Calle 1 # 2-3');
    component.form.get('phone_number')!.setValue('3001234567');
    fixture.detectChanges();

    expect(resolveByName).toHaveBeenCalledWith('Riohacha', 'La Guajira');
    expect(component.isLocked()).toBeTrue();
    expect(component.form.get('municipality_code')!.value).toBe('44001');
    expect(component.form.get('city')!.value).toBe('Riohacha');
    expect(component.form.valid).toBeTrue();
    expect(fixture.debugElement.query(By.css('.locked-location-chip'))).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Riohacha, La Guajira · Colombia');
    // País, departamento y ciudad ocultos.
    expect(fixture.debugElement.queryAll(By.css('app-selector')).length).toBe(0);
    // El centroide es solo visual: nunca llega a coordenadas ni a has_location.
    expect(component.municipalityFocus()).toEqual({ lat: 11.54, lng: -72.91 });
    expect(municipalityCenter).toHaveBeenCalledWith('Riohacha', 'La Guajira');
    expect(component.coordsSignal()).toBeNull();
    expect(component.form.get('latitude')!.value).toBeNull();
    expect(component.mapCenterHint()).toBeNull();
  });

  it('ubicación fija que no resuelve: los selectores siguen visibles', async () => {
    resolveByName.and.returnValue(of(null));
    fixture.componentRef.setInput('lockedLocation', {
      country_code: 'CO', state_province: 'La Guajira', city: 'Inexistente',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isLocked()).toBeFalse();
    expect(fixture.debugElement.query(By.css('.locked-location-chip'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('app-selector')).length).toBe(3);
    expect(forward).not.toHaveBeenCalled();
    expect(municipalityCenter).not.toHaveBeenCalled();
  });

  const lockInRiohacha = { country_code: 'CO', state_province: 'La Guajira', city: 'Riohacha' };

  it('lock: dirección legacy sin municipality_code de otra ciudad descarta lat/lng', async () => {
    resolveByName.and.returnValue(of(riohacha));
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'Bogotá', country_code: 'CO',
      latitude: 4.65, longitude: -74.06,
    });
    fixture.componentRef.setInput('lockedLocation', lockInRiohacha);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.form.get('city')!.value).toBe('Riohacha');
    expect(component.form.get('latitude')!.value).toBeNull();
    expect(component.form.get('longitude')!.value).toBeNull();
    expect(component.coordsSignal()).toBeNull();
  });

  it('lock: dirección legacy sin código de la misma ciudad conserva lat/lng', async () => {
    resolveByName.and.returnValue(of(riohacha));
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', city: 'Riohacha', country_code: 'CO',
      latitude: 11.54, longitude: -72.91,
    });
    fixture.componentRef.setInput('lockedLocation', lockInRiohacha);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.form.get('latitude')!.value).toBe(11.54);
    expect(component.form.get('longitude')!.value).toBe(-72.91);
  });

  it('lock: aplicar el lock no geocodifica; teclear en line1 lo hace una vez por el debounce', async () => {
    resolveByName.and.returnValue(of(riohacha));
    jasmine.clock().install();
    jasmine.clock().mockDate();
    try {
      fixture.componentRef.setInput('initialAddress', {
        address_line1: 'Calle 1 # 2-3', country_code: 'CO',
      });
      fixture.componentRef.setInput('lockedLocation', lockInRiohacha);
      fixture.detectChanges();
      jasmine.clock().tick(600);
      await fixture.whenStable();
      expect(component.isLocked()).toBeTrue();
      expect(forward).not.toHaveBeenCalled();

      component.form.markAsDirty();
      component.form.get('address_line1')!.setValue('Calle 5 # 6-7');
      jasmine.clock().tick(600);
      await fixture.whenStable();
    } finally {
      jasmine.clock().uninstall();
    }

    expect(forward).toHaveBeenCalledTimes(1);
  });

  it('teléfono prellenado: chip visible, input oculto; Editar muestra el input', async () => {
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', country_code: 'CO', phone_number: '3001234567',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.phone-chip'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('input[type="tel"]'))).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('3001234567');

    (fixture.debugElement.query(By.css('button[aria-label="Editar teléfono"]'))
      .nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.phoneEditing()).toBeTrue();
    expect(fixture.debugElement.query(By.css('.phone-chip'))).toBeNull();
    expect(fixture.debugElement.query(By.css('input[type="tel"]'))).toBeTruthy();
    expect(component.form.get('phone_number')!.value).toBe('3001234567');
  });

  it('sin teléfono: se muestra el input, no el chip', async () => {
    fixture.componentRef.setInput('initialAddress', {
      address_line1: 'Calle 1 # 2-3', country_code: 'CO',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.phone-chip'))).toBeNull();
    expect(fixture.debugElement.query(By.css('input[type="tel"]'))).toBeTruthy();
  });

  it('sin lockedLocation el comportamiento no cambia', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(resolveByName).not.toHaveBeenCalled();
    expect(component.isLocked()).toBeFalse();
    expect(fixture.debugElement.query(By.css('.locked-location-chip'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('app-selector')).length).toBe(3);
  });

  it('ignora la lista tardía del departamento anterior', async () => {
    const guajiraList = new Subject<typeof riohacha[]>();
    const antioquiaList = new Subject<typeof riohacha[]>();
    listByDepartment.and.callFake((code: string) => code === '44' ? guajiraList : antioquiaList);
    fixture.detectChanges();
    await fixture.whenStable();
    component.onDepartmentChange('44');
    component.onDepartmentChange('05');
    guajiraList.next([riohacha]);
    antioquiaList.next([{
      code: '05001', name: 'Medellín', department_code: '05',
      department_name: 'Antioquia', postal_code: '050001',
    }]);

    expect(component.selectedDepartmentCode()).toBe('05');
    expect(component.municipalityOptions()).toEqual([{ value: '05001', label: 'Medellín' }]);
  });

  it('una selección ciudad dispara el forward-geocode por el debounce existente', async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    try {
      fixture.detectChanges();
      jasmine.clock().tick(600);
      await fixture.whenStable();
      component.form.get('address_line1')!.setValue('Calle 1 # 2-3');
      component.onDepartmentChange('44');
      component.onCityChange('44001');
      jasmine.clock().tick(600);
      await fixture.whenStable();
    } finally {
      jasmine.clock().uninstall();
    }

    expect(forward).toHaveBeenCalledWith(
      'Calle 1 # 2-3, Riohacha, Colombia',
      jasmine.objectContaining({ city: 'Riohacha', state: 'La Guajira' }),
    );
  });
});

/**
 * BUG 2 (E2E roku-shop.vendix.com/checkout, 2026-09-27): un forward-geocode
 * con precisión 'area' (centroide de ciudad/vereda) se estaba tratando como
 * una coordenada resuelta — una dirección sin sentido en Riohacha resolvió al
 * centroide de la ciudad y el checkout cotizó/cobró envío sin que el
 * comprador jamás marcara un punto. Regla nueva: 'area' = NO resuelto para
 * precio. Debe recentrar el mapa cerca de la ciudad (`mapCenterHint`) SIN
 * escribir lat/lng, y seguir el mismo camino que un geocode nulo (warning +
 * CTA "Usar mi ubicación automática" + foco en el mapa).
 */
describe('AddressFormFieldsComponent — geocode precisión "area" no es una ubicación resuelta', () => {
  let fixture: ComponentFixture<AddressFormFieldsComponent>;
  let component: AddressFormFieldsComponent;
  let forward: jasmine.Spy;

  const renderAndFlushInitialCycle = async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    fixture.detectChanges();
    jasmine.clock().tick(600);
    await fixture.whenStable();
  };

  const editAddressAndFlushDebounce = async () => {
    component.form.markAsDirty();
    component.form.get('address_line1')!.setValue('Vereda Xyzqwerty Km 99 Via Inexistente');
    component.onDepartmentChange('44');
    component.onCityChange('44001');
    jasmine.clock().tick(500);
    await fixture.whenStable();
    jasmine.clock().tick(500);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    forward = jasmine.createSpy('forward');
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        {
          provide: DianMunicipalityLookupService,
          useValue: {
            listDepartments: () => of(ADDRESS_TEST_DEPARTMENTS),
            listByDepartment: () => of([ADDRESS_TEST_RIOHACHA]),
            resolveByName: () => of(null), resolveByCode: () => of(null), setBaseUrl: () => {},
          },
        },
        { provide: GeocodingService, useValue: { forward, reverse: () => of(null) } },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'),
            currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0,
            loadCurrency: () => {},
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AddressFormFieldsComponent);
    component = fixture.componentInstance;
  });

  it('area: no fija latitude/longitude, no cuenta como has_location, y centra el mapa por separado', async () => {
    forward.and.returnValue(
      of({ lat: 11.5444, lng: -72.907, precision: 'area', label: 'Riohacha, La Guajira' }),
    );

    let lastEmitted: any = null;
    component.addressChange.subscribe((v) => (lastEmitted = v));

    try {
      await renderAndFlushInitialCycle();
      await editAddressAndFlushDebounce();
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(component.form.get('latitude')!.value).toBeNull();
    expect(component.form.get('longitude')!.value).toBeNull();
    expect(component.coordsSignal()).toBeNull();
    expect(component.precision()).toBeNull();
    expect(component.mapCenterHint()).toEqual({ lat: 11.5444, lng: -72.907 });
    expect(component.addressWarning()).toContain('Marca el punto en el mapa');
    expect(lastEmitted?.has_location).toBeFalse();
    expect(lastEmitted?.latitude).toBeNull();
    expect(lastEmitted?.longitude).toBeNull();
  });

  it('street: sigue aceptándose como resuelto (badge de baja precisión, no bloquea)', async () => {
    forward.and.returnValue(
      of({ lat: 4.601, lng: -74.081, precision: 'street', label: 'Carrera 7, Bogotá' }),
    );

    let lastEmitted: any = null;
    component.addressChange.subscribe((v) => (lastEmitted = v));

    try {
      await renderAndFlushInitialCycle();
      await editAddressAndFlushDebounce();
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(component.form.get('latitude')!.value).toBe(4.601);
    expect(component.form.get('longitude')!.value).toBe(-74.081);
    expect(component.coordsSignal()).toEqual({ lat: 4.601, lng: -74.081 });
    expect(component.precision()).toBe('street');
    expect(lastEmitted?.has_location).toBeTrue();
  });
});

/**
 * Chip de carga (2026-09-27, owner request): mientras el forward-geocode del
 * texto tecleado está en vuelo, debe verse un chip "Ubicando tu dirección en
 * el mapa…" arriba de la sección del mapa; al resolver (next + complete), el
 * chip debe ocultarse — `isLocatingAddress()` es un CONTADOR decrementado en
 * `finalize()`, no un booleano plano, así que este spec usa un `Subject`
 * controlado a mano (no `of(...)`, que emitiría sincrónicamente y nunca
 * dejaría observar el estado "pendiente").
 */
describe('AddressFormFieldsComponent — chip de carga sobre el mapa', () => {
  let fixture: ComponentFixture<AddressFormFieldsComponent>;
  let component: AddressFormFieldsComponent;
  let forward$: Subject<{ lat: number; lng: number; precision: string; label: string } | null>;
  let forward: jasmine.Spy;

  const renderAndFlushInitialCycle = async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    fixture.detectChanges();
    jasmine.clock().tick(600);
    await fixture.whenStable();
  };

  const editAddressAndFlushDebounce = async () => {
    component.form.markAsDirty();
    component.form.get('address_line1')!.setValue('Carrera 7 # 32-16');
    component.onDepartmentChange('44');
    component.onCityChange('44001');
    jasmine.clock().tick(500);
    await fixture.whenStable();
    jasmine.clock().tick(500);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    forward$ = new Subject();
    forward = jasmine.createSpy('forward').and.returnValue(forward$);
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        {
          provide: DianMunicipalityLookupService,
          useValue: {
            listDepartments: () => of(ADDRESS_TEST_DEPARTMENTS),
            listByDepartment: () => of([ADDRESS_TEST_RIOHACHA]),
            resolveByName: () => of(null), resolveByCode: () => of(null), setBaseUrl: () => {},
          },
        },
        { provide: GeocodingService, useValue: { forward, reverse: () => of(null) } },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'),
            currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0,
            loadCurrency: () => {},
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AddressFormFieldsComponent);
    component = fixture.componentInstance;
  });

  it('el chip esta visible mientras el observable esta pendiente y se oculta al emitir', async () => {
    try {
      await renderAndFlushInitialCycle();
      await editAddressAndFlushDebounce();
      fixture.detectChanges();

      // Pendiente: `forward$` todavia no emitio nada.
      expect(component.isLocatingAddress()).toBeTrue();
      expect(
        fixture.debugElement.query(By.css('.address-locating-chip')),
      ).toBeTruthy();

      forward$.next({
        lat: 4.601,
        lng: -74.081,
        precision: 'exact',
        label: 'Carrera 7, Bogotá',
      });
      forward$.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      // Resuelto: `finalize()` bajo el contador vuelve `isLocatingAddress()`
      // a false y el chip desaparece del DOM.
      expect(component.isLocatingAddress()).toBeFalse();
      expect(
        fixture.debugElement.query(By.css('.address-locating-chip')),
      ).toBeFalsy();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});

describe('AddressFormFieldsComponent — mapa tras el debounce (compact vs completo)', () => {
  let fixture: ComponentFixture<AddressFormFieldsComponent>;
  let component: AddressFormFieldsComponent;
  let forward: jasmine.Spy;

  const riohacha = {
    code: '44001', name: 'Riohacha', department_code: '44',
    department_name: 'La Guajira', postal_code: '440001',
  };

  beforeEach(() => {
    forward = jasmine.createSpy('forward').and.returnValue(
      of({ lat: 11.54, lng: -72.91, precision: 'exact' }),
    );
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        {
          provide: DianMunicipalityLookupService,
          useValue: {
            listDepartments: () => of(ADDRESS_TEST_DEPARTMENTS),
            listByDepartment: () => of([riohacha]),
            resolveByName: () => of(null), resolveByCode: () => of(null), setBaseUrl: () => {},
          },
        },
        {
          provide: GeocodingService,
          useValue: {
            forward, reverse: () => of(null),
            municipalityCenter: () => of({ lat: 11.54, lng: -72.91 }),
          },
        },
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'), currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0, loadCurrency: () => {}, format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AddressFormFieldsComponent);
    component = fixture.componentInstance;
  });

  async function typeLine1(text: string, ms: number): Promise<void> {
    component.form.get('address_line1')!.setValue(text);
    jasmine.clock().tick(ms);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('compact sin dirección: sin mapa ni botón "Más detalles"', async () => {
    fixture.componentRef.setInput('compact', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('app-address-map-picker'))).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Más detalles');
    expect(fixture.nativeElement.textContent).not.toContain('Abrir mapa');
  });

  it('compact: el mapa aparece solo tras el debounce, con el pin ubicado', async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    try {
      fixture.componentRef.setInput('compact', true);
      fixture.detectChanges();
      jasmine.clock().tick(600);
      await fixture.whenStable();
      component.onDepartmentChange('44');
      component.onCityChange('44001');
      jasmine.clock().tick(600);
      await fixture.whenStable();
      forward.calls.reset();

      component.form.get('address_line1')!.setValue('Calle 5 # 6-7');
      jasmine.clock().tick(100);
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('app-address-map-picker'))).toBeNull();

      await typeLine1('Calle 5 # 6-7', 600);
      expect(forward).toHaveBeenCalled();
      expect(component.compactMapRevealed()).toBeTrue();
      expect(fixture.debugElement.query(By.css('app-address-map-picker'))).toBeTruthy();
      expect(component.coordsSignal()).toEqual({ lat: 11.54, lng: -72.91 });
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('no compact: conserva el toggle "Abrir mapa" desde el inicio', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Abrir mapa');
    expect(fixture.debugElement.query(By.css('app-address-map-picker'))).toBeNull();
  });
});
