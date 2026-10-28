import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideMockStore } from '@ngrx/store/testing';

import { PriceTierFormPageComponent } from './price-tier-form-page.component';
import { PriceTiersService, PriceTierCacheService } from '../../services';
import { ToastService } from '../../../../../../shared/components/index';

/**
 * Regla de precio de la tarifa: el formulario manda tipo, valor y alcance.
 * Spec: odd/tasks/price-tier-adjustments-customers.md S1-S3.
 */
describe('PriceTierFormPageComponent — regla de precio', () => {
  let create: jasmine.Spy;
  let toastWarning: jasmine.Spy;

  const setup = () => {
    create = jasmine.createSpy('create').and.returnValue(of({ id: 1 }));
    toastWarning = jasmine.createSpy('warning');
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({}) } },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: PriceTiersService, useValue: { create } },
        { provide: PriceTierCacheService, useValue: { invalidate: () => {} } },
        {
          provide: ToastService,
          useValue: { warning: toastWarning, success: () => {}, error: () => {} },
        },
      ],
    });
    return TestBed.runInInjectionContext(() => new PriceTierFormPageComponent());
  };

  it('un recargo de monto fijo por paquete viaja con su valor y alcance', () => {
    const page = setup();
    page.form.patchValue({
      name: 'Mayorista',
      adjustment_type: 'fixed_amount_surcharge',
      adjustment_value: 500,
      amount_scope: 'per_package',
    });

    page.save();

    expect(create).toHaveBeenCalledWith(
      jasmine.objectContaining({
        adjustment_type: 'fixed_amount_surcharge',
        adjustment_value: 500,
        amount_scope: 'per_package',
        discount_percentage: 0,
      }),
    );
  });

  it('el precio fijo sin valor no se guarda y el campo muestra por qué', () => {
    const page = setup();
    page.form.patchValue({ name: 'Fija', adjustment_type: 'fixed_price' });
    page.form.controls.adjustment_value.markAsTouched();

    page.save();

    expect(create).not.toHaveBeenCalled();
    expect(page.getError('adjustment_value')).toBe('Indica un valor mayor que 0.');
    expect(page.showsAmountScope()).toBeTrue();
  });

  it('la pantalla muestra el campo de valor y el alcance según el tipo', async () => {
    setup();
    const fixture = TestBed.createComponent(PriceTierFormPageComponent);
    fixture.componentInstance.form.patchValue({
      adjustment_type: 'fixed_amount_discount',
    });
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Monto a descontar');
    expect(text).toContain('El monto aplica');
    expect(text).not.toContain('Descuento (%)');
  });

  it('el descuento porcentual sigue guardándose como antes', () => {
    const page = setup();
    page.form.patchValue({ name: 'Minorista', discount_percentage: 15 });

    page.save();

    expect(create).toHaveBeenCalledWith(
      jasmine.objectContaining({
        adjustment_type: 'percent_discount',
        discount_percentage: 15,
        adjustment_value: null,
      }),
    );
  });
});
