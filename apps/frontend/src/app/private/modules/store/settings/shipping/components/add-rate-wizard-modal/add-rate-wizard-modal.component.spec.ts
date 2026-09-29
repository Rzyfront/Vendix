import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AddRateWizardModalComponent,
  computeShippingTaxPreview,
  toTaxCategoryId,
} from './add-rate-wizard-modal.component';
import { ShippingMethodsService } from '../../services/shipping-methods.service';
import { ToastService } from '../../../../../../../shared/components/index';
import {
  CreateRateDto,
  ShippingRate,
  ShippingRateTaxOptions,
  ShippingZone,
} from '../../interfaces/shipping-zones.interface';

/**
 * Impuesto opcional por tarifa de envío (Paso 9), edición de zona desde el
 * wizard (Paso 10) y modo incluido/agregado (paso 15a). Se instancia la clase
 * sin plantilla: lo que importa es el payload que sale y las reglas de la
 * vista previa.
 */
describe('AddRateWizardModalComponent — impuesto del envío', () => {
  const taxOptions: ShippingRateTaxOptions = {
    categories: [
      { id: 11, name: 'INC domicilio', tax_type: 'inc', rate_percent: 8, eligible: true, is_inclusive: true },
      {
        id: 12,
        name: 'IVA general',
        tax_type: 'iva',
        rate_percent: 19,
        eligible: false,
        reason: 'No eres responsable de IVA',
        is_inclusive: false,
      },
    ],
    issuer: { vat_responsible: false, inc_responsible: true, is_restaurant: true },
    suggestion: { tax_type: 'inc', category_id: 11, message: 'Los restaurantes suelen cobrar INC 8%' },
    warnings: [],
  };

  const zone: ShippingZone = {
    id: 5,
    name: 'Riohacha',
    countries: ['CO'],
    is_active: true,
    is_system: false,
    source_type: 'system_copy',
    _count: { shipping_rates: 3 },
  };

  let service: jasmine.SpyObj<ShippingMethodsService>;
  let toast: jasmine.SpyObj<ToastService>;

  function build(editRate: ShippingRate | null = null): AddRateWizardModalComponent {
    const real = new ShippingMethodsService(null as never);
    service = jasmine.createSpyObj<ShippingMethodsService>('ShippingMethodsService', [
      'getRateTaxOptions',
      'createRate',
      'updateRate',
      'getStoreZones',
      'getRateTaxLabel',
    ]);
    service.getRateTaxOptions.and.returnValue(of(taxOptions));
    service.createRate.and.returnValue(of({} as ShippingRate));
    service.updateRate.and.returnValue(of({} as ShippingRate));
    service.getStoreZones.and.returnValue(of([zone]));
    service.getRateTaxLabel.and.callFake((t) => real.getRateTaxLabel(t));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['show']);

    TestBed.configureTestingModule({
      providers: [
        { provide: ShippingMethodsService, useValue: service },
        { provide: ToastService, useValue: toast },
      ],
    });

    const component = TestBed.runInInjectionContext(() => new AddRateWizardModalComponent());
    // Los input() de señal no se pueden fijar sin plantilla: se sustituyen por
    // señales equivalentes (solo se leen como funciones).
    Object.assign(component, {
      method_id: signal(7),
      existing_zones: signal([zone]),
      edit_rate: signal(editRate),
    });
    component.ngOnInit();
    component.selected_zone_id.set(zone.id);
    return component;
  }

  function lastCreateDto(): CreateRateDto {
    return service.createRate.calls.mostRecent().args[0];
  }

  it('por defecto no lleva impuesto y manda tax_category_id: null', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 15000 });
    c.onSubmit();
    expect(lastCreateDto().tax_category_id).toBeNull();
  });

  it('no preselecciona la sugerencia', () => {
    const c = build();
    expect(c.tax_suggestion()).toBe('Los restaurantes suelen cobrar INC 8%');
    expect(c.rate_form.controls.tax_category_id.value).toBeNull();
  });

  it('manda el id elegido', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 15000, tax_category_id: 11 });
    c.onSubmit();
    expect(lastCreateDto().tax_category_id).toBe(11);
  });

  it('una tarifa gratis nunca lleva impuesto', () => {
    const c = build();
    c.rate_form.patchValue({ tax_category_id: 11 });
    c.selectRateType('free');
    c.onSubmit();
    expect(lastCreateDto().tax_category_id).toBeNull();
  });

  it('las categorías no elegibles salen deshabilitadas con su motivo', () => {
    const c = build();
    const options = c.tax_selector_options();
    expect(options[0].label).toBe('Sin impuesto');
    expect(options[0].value as unknown).toBeNull();
    const iva = options.find((o) => o.value === 12)!;
    expect(iva.disabled).toBeTrue();
    expect(iva.label).toContain('No eres responsable de IVA');
    expect(options.find((o) => o.value === 11)!.disabled).toBeFalse();
  });

  it('la vista previa incluida despeja la base del precio que paga el cliente', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 15000, tax_category_id: 11 });
    expect(c.is_inclusive_mode()).toBeTrue();
    expect(c.tax_preview()).toEqual({
      cost: 15000,
      base: 13888.89,
      tax: 1111.11,
      gross: 15000,
      label: 'INC 8%',
      type_label: 'INC',
      mode: 'inclusive',
    });
  });

  it('la vista previa agregada suma el impuesto al precio (Cliente paga $11.900)', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 10000, tax_category_id: 12 });
    // La categoría «Adicional» preselecciona Agregado en tarifas nuevas.
    expect(c.is_inclusive_mode()).toBeFalse();
    expect(c.tax_preview()).toEqual({
      cost: 10000,
      base: 10000,
      tax: 1900,
      gross: 11900,
      label: 'IVA 19%',
      type_label: 'IVA',
      mode: 'exclusive',
    });
  });

  it('una tarifa gratis no muestra vista previa aunque tenga categoría', () => {
    const c = build();
    c.rate_form.patchValue({ tax_category_id: 11 });
    c.selectRateType('free');
    expect(c.tax_preview()).toBeNull();
    expect(c.tax_mode_mismatch()).toBeNull();
  });

  it('el modo se preselecciona desde la categoría en tarifas nuevas', () => {
    const c = build();
    expect(c.is_inclusive_mode()).toBeTrue();
    c.rate_form.patchValue({ tax_category_id: 12 });
    expect(c.is_inclusive_mode()).toBeFalse();
    c.rate_form.patchValue({ tax_category_id: 11 });
    expect(c.is_inclusive_mode()).toBeTrue();
  });

  it('el comerciante puede cambiar el modo a mano con selectTaxMode', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 10000, tax_category_id: 12 });
    expect(c.tax_preview()?.gross).toBe(11900);
    c.selectTaxMode(true);
    expect(c.is_inclusive_mode()).toBeTrue();
    expect(c.tax_preview()?.gross).toBe(10000);
    expect(c.tax_preview()?.mode).toBe('inclusive');
  });

  it('avisa cuando la categoría es Adicional pero la tarifa está en Incluido', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 10000, tax_category_id: 12 });
    // Preseleccionó Agregado: sin aviso.
    expect(c.tax_mode_mismatch()).toBeNull();
    c.selectTaxMode(true);
    expect(c.tax_mode_mismatch()).toContain('Adicional');
    c.selectTaxMode(false);
    expect(c.tax_mode_mismatch()).toBeNull();
  });

  it('el DTO lleva el modo incluido por defecto', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 15000 });
    c.onSubmit();
    expect(lastCreateDto().tax_is_inclusive).toBeTrue();
  });

  it('el DTO lleva el modo agregado si se eligió', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 10000, tax_category_id: 12 });
    c.onSubmit();
    expect(lastCreateDto().tax_category_id).toBe(12);
    expect(lastCreateDto().tax_is_inclusive).toBeFalse();
  });

  it('en edición el modo sale de lo guardado y cambiar de categoría no lo toca', () => {
    const rate: ShippingRate = {
      id: 91,
      shipping_zone_id: zone.id,
      shipping_method_id: 7,
      type: 'flat',
      base_cost: 10000,
      is_active: true,
      tax_category_id: 12,
      tax_category: { id: 12, name: 'IVA general', tax_type: 'iva', rate_percent: 19 },
      tax_is_inclusive: false,
    };
    const c = build(rate);
    expect(c.rate_form.controls.tax_is_inclusive.value).toBeFalse();
    expect(c.tax_preview()?.mode).toBe('exclusive');
    // Categoría «Incluida» en edición: el modo guardado manda.
    c.rate_form.patchValue({ tax_category_id: 11 });
    expect(c.rate_form.controls.tax_is_inclusive.value).toBeFalse();

    c.rate_form.patchValue({ tax_category_id: 12 });
    c.onSubmit();
    const [id, dto] = service.updateRate.calls.mostRecent().args;
    expect(id).toBe(91);
    expect(dto.tax_is_inclusive).toBeFalse();
  });

  it('en edición carga el impuesto de la tarifa y permite quitarlo (null)', () => {
    const rate: ShippingRate = {
      id: 90,
      shipping_zone_id: zone.id,
      shipping_method_id: 7,
      type: 'flat',
      base_cost: 15000,
      is_active: true,
      tax_category: { id: 11, name: 'INC domicilio', tax_type: 'inc', rate_percent: 8 },
    };
    const c = build(rate);
    expect(c.rate_form.controls.tax_category_id.value).toBe(11);
    expect(c.fixed_zone()?.id).toBe(zone.id);

    c.rate_form.patchValue({ tax_category_id: null });
    c.onSubmit();
    const [id, dto] = service.updateRate.calls.mostRecent().args;
    expect(id).toBe(90);
    expect(dto.tax_category_id).toBeNull();
    expect(dto.tax_is_inclusive).toBeTrue();
  });

  it('editar zona avisa si es compartida o copia del sistema y recarga conservando la zona', () => {
    const c = build();
    let changed = 0;
    c.zones_changed.subscribe(() => changed++);
    const event = jasmine.createSpyObj<Event>('Event', ['stopPropagation']);

    c.openZoneEdit(zone, event);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(c.editing_zone()).toBe(zone);
    const notices = toast.show.calls.allArgs().map(([t]) => t.description);
    expect(notices).toContain('Esta zona la usan 3 tarifas: los cambios aplican a todas.');
    expect(notices.some((n) => n?.includes('sobrescribirán'))).toBeTrue();

    c.onZoneEdited();
    expect(service.getStoreZones).toHaveBeenCalled();
    expect(c.selected_zone_id()).toBe(zone.id);
    expect(changed).toBe(1);
  });

  describe('helpers', () => {
    it('toTaxCategoryId normaliza a null', () => {
      expect(toTaxCategoryId(null)).toBeNull();
      expect(toTaxCategoryId('')).toBeNull();
      expect(toTaxCategoryId(0)).toBeNull();
      expect(toTaxCategoryId('11')).toBe(11);
    });

    it('computeShippingTaxPreview omite costo cero o sin tarifa', () => {
      expect(computeShippingTaxPreview(0, 8, 'INC 8%', 'INC')).toBeNull();
      expect(computeShippingTaxPreview(15000, null, 'INC', 'INC')).toBeNull();
      expect(computeShippingTaxPreview(15000, 8, null, 'INC')).toBeNull();
      expect(computeShippingTaxPreview(11900, 19, 'IVA 19%', 'IVA')).toEqual({
        cost: 11900,
        base: 10000,
        tax: 1900,
        gross: 11900,
        label: 'IVA 19%',
        type_label: 'IVA',
        mode: 'inclusive',
      });
    });

    it('computeShippingTaxPreview trunca como el backend (10.000 al 19 % ⇒ 1.596,63)', () => {
      // El mismo kernel que `resolveShippingCharge`: truncado DIAN, no
      // redondeo hacia arriba (que daría 1.596,64).
      expect(computeShippingTaxPreview(10000, 19, 'IVA 19%', 'IVA')).toEqual({
        cost: 10000,
        base: 8403.37,
        tax: 1596.63,
        gross: 10000,
        label: 'IVA 19%',
        type_label: 'IVA',
        mode: 'inclusive',
      });
    });

    it('computeShippingTaxPreview agregado suma trunc(base·r) (10.000 al 19 % ⇒ 11.900)', () => {
      // Mismo camino que `resolveShippingCharge` con `tax_is_inclusive:false`.
      expect(computeShippingTaxPreview(10000, 19, 'IVA 19%', 'IVA', false)).toEqual({
        cost: 10000,
        base: 10000,
        tax: 1900,
        gross: 11900,
        label: 'IVA 19%',
        type_label: 'IVA',
        mode: 'exclusive',
      });
    });
  });
});
