import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { AddressFormFieldsComponent } from './address-form-fields.component';
import { CountryService } from '../../../core/services/country.service';
import { DianMunicipalityLookupService } from '../../services/dian-municipality-lookup.service';
import { GeocodingService } from '../../../private/modules/ecommerce/services/geocoding.service';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';

/**
 * H7 (regresión en producción): en modo `compact` (el que usa el POS —
 * `pos-shipping-step.component.html` pasa `[compact]="true"`) el selector de
 * municipio DANE quedaba detrás de `showAdvanced() && showMunicipality()`, y
 * `showAdvanced()` en compact es `false` salvo que la dirección precargada ya
 * trajera apto/postal/país≠CO. `resolveMunicipalityFromText()` solo se
 * llamaba desde el reverse-fill del mapa (también oculto en compact), así que
 * una dirección nueva capturada desde el POS se guardaba sin
 * `municipality_code` — el dato que la factura electrónica usa como
 * `city_code` del adquiriente.
 *
 * Zoneless: sin zone.js/testing en este arnés, así que el debounce de 500ms
 * del `merge(...)` del constructor se controla con `jasmine.clock()`, igual
 * que `pos-shipping-step.component.spec.ts`. Dos gotchas de ese archivo
 * (comentario junto a su propio `jasmine.clock().install()`) aplican aquí
 * también:
 *
 * 1. `debounceTime`'s internal "¿de verdad pasaron 500ms?" lee `Date.now()`
 *    vía el scheduler de RxJS, que `jasmine.clock().install()` por sí solo NO
 *    mockea (solo los timers). Sin `mockDate()`, `tick()` dispara el timer
 *    falso pero el operador ve que el reloj real casi no avanzó y
 *    RE-agenda — el callback nunca corre y el spy nunca se llama.
 * 2. El primer render construye el componente y su constructor ya dispara un
 *    ciclo inocuo de ese mismo `merge(...)` (el efecto de precarga de
 *    `initialAddress`, `emitEvent:true`). `debounceTime` guarda un solo
 *    "pending" por suscripción: si ese primer ciclo agenda su espera en el
 *    scheduler real (reloj aún no instalado), reclama el slot en silencio y
 *    la edición real de abajo solo actualiza el valor pendiente sin agendar
 *    un timer NUEVO — un `tick()` posterior no libera nada. Por eso el reloj
 *    se instala ANTES del primer `detectChanges()` y se hace un `tick(600)`
 *    de purga antes de la edición real.
 */
describe('AddressFormFieldsComponent — H7 municipio DANE en modo compact', () => {
  let fixture: ComponentFixture<AddressFormFieldsComponent>;
  let component: AddressFormFieldsComponent;
  let resolveByName: jasmine.Spy;

  /**
   * Instala el reloj falso ANTES del primer render (ver gotcha 2 arriba),
   * dispara ese primer render y purga el ciclo inocuo que dispara el
   * constructor. El reloj queda instalado al retornar — el test debe
   * desinstalarlo en su `finally`.
   */
  const renderAndFlushInitialCycle = async () => {
    jasmine.clock().install();
    jasmine.clock().mockDate();
    fixture.detectChanges();
    jasmine.clock().tick(600);
    await fixture.whenStable();
  };

  /** Edita ciudad/departamento y purga el debounce real de 500ms del `merge()`. */
  const editAddressAndFlushDebounce = async (city: string, department: string) => {
    component.form.markAsDirty();
    component.form.get('address_line1')!.setValue('Carrera 7 # 32-16');
    component.form.get('city')!.setValue(city);
    component.form.get('state_province')!.setValue(department);
    jasmine.clock().tick(600);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    resolveByName = jasmine.createSpy('resolveByName').and.returnValue(of(null));
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        { provide: CountryService, useValue: { getCountries: () => of([{ code: 'CO', name: 'Colombia' }]) } },
        {
          provide: DianMunicipalityLookupService,
          useValue: {
            resolveByName,
            // `app-dian-municipality-select` (dentro del @if de
            // `municipalitySelectVisible`) hidrata su display al recibir un
            // `municipality_code` vía `writeValue` → `resolveByCode`. No es
            // el foco de este spec (solo importa que `resolveByName` haya
            // puesto el código en el form), así que basta con no-matchear.
            resolveByCode: () => of(null),
            setBaseUrl: () => {},
          },
        },
        { provide: GeocodingService, useValue: { forward: jasmine.createSpy('forward').and.returnValue(of(null)), reverse: () => of(null) } },
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

  it('compact + CO + ciudad/departamento válidos: resuelve municipality_code y lo emite', async () => {
    resolveByName.and.returnValue(of({
      code: '76001', name: 'Cali', department_code: '76', department_name: 'Valle del Cauca', postal_code: '760001',
    }));
    fixture.componentRef.setInput('compact', true);

    let lastEmitted: any = null;
    component.addressChange.subscribe((v) => (lastEmitted = v));

    try {
      await renderAndFlushInitialCycle();
      await editAddressAndFlushDebounce('Cali', 'Valle del Cauca');
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(resolveByName).toHaveBeenCalledWith('Cali', 'Valle del Cauca');
    expect(component.form.get('municipality_code')!.value).toBe('76001');
    expect(lastEmitted?.municipality_code).toBe('76001');
  });

  it('compact + no resuelve el catálogo: el selector DANE queda visible para que el cajero elija', async () => {
    resolveByName.and.returnValue(of(null)); // catálogo no encuentra coincidencia
    fixture.componentRef.setInput('compact', true);

    // Antes del fix: showAdvanced() es false en compact sin precarga, así que
    // el bloque completo (incluyendo el <label> y el <app-dian-municipality-select>)
    // ni siquiera se renderizaba.
    try {
      await renderAndFlushInitialCycle();
      await editAddressAndFlushDebounce('Cali', 'Valle del Cauca');
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    expect(resolveByName).toHaveBeenCalledWith('Cali', 'Valle del Cauca');
    expect(component.form.get('municipality_code')!.value).toBeNull();
    expect(component.municipalitySelectVisible()).toBeTrue();
    expect(fixture.debugElement.query(By.css('app-dian-municipality-select'))).toBeTruthy();
  });

  it('no-compact: comportamiento sin cambios — no auto-resuelve y el selector ya estaba siempre visible', async () => {
    // compact() default es false — mismos consumidores existentes
    // (customer-modal, dispatch-note editor, checkout suscripción,
    // organization/store edit).
    try {
      await renderAndFlushInitialCycle();

      expect(component.showAdvanced()).toBeTrue();
      expect(component.municipalitySelectVisible()).toBeTrue();
      expect(fixture.debugElement.query(By.css('app-dian-municipality-select'))).toBeTruthy();

      await editAddressAndFlushDebounce('Cali', 'Valle del Cauca');
    } finally {
      jasmine.clock().uninstall();
    }
    fixture.detectChanges();

    // El H7 fix está gateado a compact(): fuera de compact, resolveByName
    // jamás se invoca desde este watcher (solo desde el reverse-fill del mapa).
    expect(resolveByName).not.toHaveBeenCalled();
    expect(component.form.get('municipality_code')!.value).toBeNull();
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
    component.form.get('city')!.setValue('Riohacha');
    component.form.get('state_province')!.setValue('La Guajira');
    jasmine.clock().tick(600);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    forward = jasmine.createSpy('forward');
    TestBed.configureTestingModule({
      imports: [AddressFormFieldsComponent],
      providers: [
        { provide: CountryService, useValue: { getCountries: () => of([{ code: 'CO', name: 'Colombia' }]) } },
        {
          provide: DianMunicipalityLookupService,
          useValue: { resolveByName: () => of(null), resolveByCode: () => of(null), setBaseUrl: () => {} },
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
