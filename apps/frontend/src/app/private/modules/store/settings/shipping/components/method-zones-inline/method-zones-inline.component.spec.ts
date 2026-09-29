import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { MethodZonesInlineComponent } from './method-zones-inline.component';
import {
  ShippingRate,
  ShippingZone,
  ZoneWithRates,
} from '../../interfaces/shipping-zones.interface';

/** La tabla de tarifas del dashboard muestra el impuesto de cada tarifa. */
describe('MethodZonesInlineComponent — etiqueta de impuesto', () => {
  const zone: ShippingZone = {
    id: 1,
    name: 'Riohacha',
    countries: ['CO'],
    is_active: true,
    is_system: false,
  };

  function rate(overrides: Partial<ShippingRate>): ShippingRate {
    return {
      id: 1,
      shipping_zone_id: 1,
      shipping_method_id: 1,
      type: 'flat',
      base_cost: 15000,
      is_active: true,
      ...overrides,
    };
  }

  function build(zones: ZoneWithRates[]): MethodZonesInlineComponent {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const component = TestBed.runInInjectionContext(() => new MethodZonesInlineComponent());
    Object.assign(component, { zones: signal(zones) });
    return component;
  }

  it('muestra «INC 8%», «IVA 19%» o «Sin impuesto»', () => {
    const c = build([
      {
        zone,
        rate: rate({
          id: 1,
          tax_category: { id: 11, name: 'INC', tax_type: 'inc', rate_percent: 8 },
        }),
      },
      {
        zone,
        rate: rate({
          id: 2,
          tax_category: { id: 12, name: 'IVA', tax_type: 'iva', rate_percent: 19 },
        }),
      },
      { zone, rate: rate({ id: 3, tax_category: null }) },
    ]);

    expect(c.tableData.map((r) => r.tax_label)).toEqual([
      'INC 8%',
      'IVA 19%',
      'Sin impuesto',
    ]);
    expect(c.columns.some((col) => col.key === 'tax_label')).toBeTrue();
  });
});
