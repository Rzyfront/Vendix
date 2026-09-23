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
 * Impuesto opcional por tarifa de envío (Paso 9) y edición de zona desde el
 * wizard (Paso 10). Se instancia la clase sin plantilla: lo que importa es el
 * payload que sale y las reglas de la vista previa.
 */
describe('AddRateWizardModalComponent — impuesto del envío', () => {
  const taxOptions: ShippingRateTaxOptions = {
    categories: [
      { id: 11, name: 'INC domicilio', tax_type: 'inc', rate_percent: 8, eligible: true },
      {
        id: 12,
        name: 'IVA general',
        tax_type: 'iva',
        rate_percent: 19,
        eligible: false,
        reason: 'No eres responsable de IVA',
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

  it('la vista previa despeja la base del precio que paga el cliente', () => {
    const c = build();
    c.rate_form.patchValue({ type: 'flat', base_cost: 15000, tax_category_id: 11 });
    expect(c.tax_preview()).toEqual({ cost: 15000, tax: 1111.11, label: 'INC 8%' });
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
      expect(computeShippingTaxPreview(0, 8, 'INC 8%')).toBeNull();
      expect(computeShippingTaxPreview(15000, null, 'INC')).toBeNull();
      expect(computeShippingTaxPreview(11900, 19, 'IVA 19%')).toEqual({
        cost: 11900,
        tax: 1900,
        label: 'IVA 19%',
      });
    });
  });
});
