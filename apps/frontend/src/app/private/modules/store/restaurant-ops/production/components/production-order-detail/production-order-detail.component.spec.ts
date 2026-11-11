import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { DialogService, ToastService } from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { ProductionOrder, ProductionOrderLine } from '../../interfaces';
import { ProductionOrdersService } from '../../services/production-orders.service';
import { ProductionSseService } from '../../services/production-sse.service';
import { ProductionOrderDetailComponent } from './production-order-detail.component';

describe('ProductionOrderDetailComponent — S3 supplies table', () => {
  let fixture: ComponentFixture<ProductionOrderDetailComponent>;
  let getById: jasmine.Spy;
  let complete: jasmine.Spy;

  const line = (extra: Partial<ProductionOrderLine> = {}): ProductionOrderLine => ({
    id: 1,
    component_product_id: 10,
    planned_qty: 4,
    consumed_qty: 3,
    unit_cost: 1500,
    total_cost: 4500,
    component_product: { id: 10, name: 'Harina', sku: null, stock_unit: 'kg' },
    ...extra,
  });

  const orderOf = (extra: Partial<ProductionOrder> = {}): ProductionOrder =>
    ({
      id: 7,
      store_id: 1,
      product_id: 2,
      recipe_id: 3,
      planned_qty: 2,
      status: 'in_progress',
      source: 'order',
      order_number: 'PO-7',
      product: { id: 2, name: 'Pan' },
      lines: [],
      created_at: '2026-11-11T10:00:00Z',
      updated_at: '2026-11-11T10:00:00Z',
      ...extra,
    }) as ProductionOrder;

  const root = () => fixture.nativeElement as HTMLElement;
  const text = () => (root().textContent ?? '').replace(/\s+/g, ' ');
  const headers = () => Array.from(root().querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());

  const render = async (order: ProductionOrder) => {
    getById.and.returnValue(of(order));
    fixture = TestBed.createComponent(ProductionOrderDetailComponent);
    fixture.componentRef.setInput('orderId', 7);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getById = jasmine.createSpy('getById');
    complete = jasmine.createSpy('complete');
    TestBed.configureTestingModule({
      providers: [
        { provide: ProductionOrdersService, useValue: { getById, complete } },
        { provide: ProductionSseService, useValue: { listen: () => undefined } },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined, warning: () => undefined } },
        { provide: DialogService, useValue: { confirm: () => Promise.resolve(true) } },
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined, format: (v: number) => `COP ${v}` },
        },
      ],
    });
  });

  it('renders the planned vs consumed table with cost columns', async () => {
    await render(orderOf({ status: 'completed', lines: [line()] }));

    expect(text()).toContain('Insumos: planificado vs consumido');
    expect(headers()).toEqual(['Insumo', 'Planificado', 'Consumido', 'Costo unit.', 'Costo total']);
    expect(text()).toContain('Harina');
    expect(text()).toContain('COP 1500');
    expect(text()).toContain('COP 4500');
    expect(text()).not.toContain('Sin desglose de consumo');
  });

  it('says "Sin desglose de consumo" when the order has no lines', async () => {
    await render(orderOf({ status: 'completed', lines: [] }));

    expect(text()).toContain('Sin desglose de consumo');
    expect(root().querySelector('table')).toBeNull();
  });

  it('says "Sin desglose de consumo" when the response carries no lines field', async () => {
    await render(orderOf({ lines: undefined }));
    expect(text()).toContain('Sin desglose de consumo');
  });

  it('refetches the order after finishing it so the table updates in place', async () => {
    await render(orderOf({ lines: [line({ consumed_qty: 0, total_cost: null, unit_cost: null })] }));
    expect(getById).toHaveBeenCalledTimes(1);

    complete.and.returnValue(of(orderOf({ status: 'completed' })));
    getById.and.returnValue(
      of(orderOf({ status: 'completed', lines: [line({ consumed_qty: 4, total_cost: 6000 })] })),
    );

    await fixture.componentInstance.complete();
    fixture.detectChanges();

    expect(complete).toHaveBeenCalledWith(7, { produced_qty: 2 });
    expect(getById).toHaveBeenCalledTimes(2);
    expect(text()).toContain('COP 6000');
  });
});
