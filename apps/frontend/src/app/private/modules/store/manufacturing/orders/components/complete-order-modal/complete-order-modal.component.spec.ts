import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ToastService } from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ManufacturingOrder } from '../../../interfaces';
import { ManufacturingOrdersService } from '../../../services';
import { CompleteOrderModalComponent } from './complete-order-modal.component';

/**
 * "Completar orden" (Planta): the helper text shows what is left in es-CO, and
 * the produced quantity still defaults to that amount as a number.
 */
describe('CompleteOrderModalComponent (Planta) — remaining quantity', () => {
  let fixture: ComponentFixture<CompleteOrderModalComponent>;

  const orderOf = (planned_qty: number | string, produced_qty: number | string | null) =>
    ({
      id: 5,
      order_number: 'MO-5',
      status: 'in_progress',
      planned_qty,
      produced_qty,
      product: { id: 2, name: 'Pan' },
    }) as unknown as ManufacturingOrder;

  const open = async (order: ManufacturingOrder) => {
    fixture = TestBed.createComponent(CompleteOrderModalComponent);
    fixture.componentRef.setInput('order', order);
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ManufacturingOrdersService, useValue: { complete: jasmine.createSpy('complete') } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
        // app-input reads the store currency; the modal itself never formats money.
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'),
            currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0,
            loadCurrency: () => undefined,
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
  });

  it('shows the remaining amount in es-CO and defaults the form to it as a number', async () => {
    await open(orderOf('1234.5', 0));

    expect(fixture.componentInstance.remaining()).toBe('1.234,5');
    expect(fixture.componentInstance.form.controls.produced_qty.value).toBe(1234.5);
  });

  it('subtracts what was already produced, rounded to 4 decimals', async () => {
    await open(orderOf(10, '7.3'));

    expect(fixture.componentInstance.remaining()).toBe('2,7');
    expect(fixture.componentInstance.form.controls.produced_qty.value).toBe(2.7);
  });

  it('leaves the quantity empty when nothing is left', async () => {
    await open(orderOf(10, 10));

    expect(fixture.componentInstance.remaining()).toBe('0');
    expect(fixture.componentInstance.form.controls.produced_qty.value).toBeNull();
  });
});
