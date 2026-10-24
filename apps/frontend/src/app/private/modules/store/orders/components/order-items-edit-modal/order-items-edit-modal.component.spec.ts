import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ToastService } from '../../../../../../shared/components';
import { Order } from '../../interfaces/order.interface';
import { StoreOrdersService } from '../../services/store-orders.service';
import { ProductsService } from '../../../products/services/products.service';
import { Product } from '../../../products/interfaces/product.interface';
import { OrderItemsEditModalComponent } from './order-items-edit-modal.component';

describe('OrderItemsEditModalComponent', () => {
  let ordersService: jasmine.SpyObj<StoreOrdersService>;
  let toast: jasmine.SpyObj<ToastService>;

  const buildOrder = (): Order =>
    ({
      id: 77,
      order_number: 'ORD-77',
      discount_amount: 1500,
      order_items: [
        {
          id: 1,
          product_id: 10,
          product_variant_id: 100,
          product_name: 'Camisa',
          variant_sku: 'CAM-M',
          variant_attributes: '{"talla":"M"}',
          quantity: 2,
          unit_price: 10000,
          final_unit_price: 11900,
          total_price: 20000,
          tax_amount_item: 3800,
          applied_price_tier_id: 5,
          item_type: 'product',
        },
        {
          id: 2,
          product_id: 11,
          product_name: 'Gorra',
          quantity: 1,
          unit_price: 5000,
          total_price: 5000,
        },
      ],
    }) as unknown as Order;

  const create = () => {
    const fixture = TestBed.createComponent(OrderItemsEditModalComponent);
    fixture.componentRef.setInput('order', buildOrder());
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  };

  beforeEach(async () => {
    ordersService = jasmine.createSpyObj('StoreOrdersService', ['updateOrderItems']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    await TestBed.configureTestingModule({
      imports: [OrderItemsEditModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreOrdersService, useValue: ordersService },
        { provide: ToastService, useValue: toast },
        { provide: ProductsService, useValue: { getProducts: () => of({ data: [] }) } },
      ],
    })
      .overrideComponent(OrderItemsEditModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  it('existing line with changed quantity keeps persisted prices, variant and no tax fields', () => {
    const { component } = create();
    component.increment(component.draft()[0]);

    const payload = component.buildPayload();
    expect(payload.items[0]).toEqual({
      item_type: 'product',
      product_id: 10,
      product_variant_id: 100,
      product_name: 'Camisa',
      variant_sku: 'CAM-M',
      variant_attributes: '{"talla":"M"}',
      quantity: 3,
      unit_price: 10000,
      final_unit_price: 11900,
      applied_price_tier_id: 5,
      total_price: 30000,
    });
    expect('tax_amount_item' in payload.items[0]).toBeFalse();
    expect(payload.items[1]['item_type']).toBe('product');
  });

  it("existing line with persisted item_type 'prepared' travels as 'product'", () => {
    const order = buildOrder();
    (order.order_items![0] as any).item_type = 'prepared';
    const fixture = TestBed.createComponent(OrderItemsEditModalComponent);
    fixture.componentRef.setInput('order', order);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.buildPayload().items[0]['item_type']).toBe('product');
  });

  it('new line displays final_price but the payload keeps the base price', () => {
    const { component } = create();
    component.addProduct(
      { id: 20, name: 'Taza', base_price: 8000, final_price: 9520 } as Product,
      null,
    );
    const line = component.draft()[2];
    expect(line.display_price).toBe(9520);
    expect(component.buildPayload().items[2]['unit_price']).toBe(8000);
  });

  it('cannot save when the order has a cancelled line', () => {
    const order = buildOrder();
    (order.order_items![1] as any).cancelled_at = '2026-01-01T00:00:00Z';
    const fixture = TestBed.createComponent(OrderItemsEditModalComponent);
    fixture.componentRef.setInput('order', order);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.increment(component.draft()[0]);
    expect(component.hasCancelledLines()).toBeTrue();
    expect(component.canSave()).toBeFalse();
  });

  it('removed line is not sent', () => {
    const { component } = create();
    component.remove(component.draft()[1]);
    const payload = component.buildPayload();
    expect(payload.items.length).toBe(1);
    expect(payload.items[0]['product_id']).toBe(10);
  });

  it('new line carries the base price and no tax / final price fields', () => {
    const { component } = create();
    component.addProduct(
      { id: 20, name: 'Taza', base_price: 8000, is_on_sale: true, sale_price: 6000 } as Product,
      null,
    );
    component.addProduct(
      { id: 20, name: 'Taza', base_price: 8000, is_on_sale: true, sale_price: 6000 } as Product,
      null,
    );
    const line = component.buildPayload().items[2];
    expect(line).toEqual({
      item_type: 'product',
      product_id: 20,
      product_name: 'Taza',
      quantity: 2,
      unit_price: 6000,
      total_price: 12000,
    });
  });

  it('new variant line uses price_override', () => {
    const { component } = create();
    const product = {
      id: 30,
      name: 'Zapato',
      base_price: 50000,
      product_variants: [{ id: 301, sku: 'ZAP-42', price_override: 65000 }],
    } as unknown as Product;
    component.addProduct(product, product.product_variants![0]);
    const line = component.buildPayload().items[2];
    expect(line['product_variant_id']).toBe(301);
    expect(line['variant_sku']).toBe('ZAP-42');
    expect(line['unit_price']).toBe(65000);
    expect('final_unit_price' in line).toBeFalse();
    expect('tax_amount_item' in line).toBeFalse();
  });

  it('does not add a parent product that has variants without choosing one', () => {
    const { component } = create();
    const product = {
      id: 30,
      name: 'Zapato',
      base_price: 50000,
      product_variants: [{ id: 301, sku: 'ZAP-42' }],
    } as unknown as Product;
    component.addProduct(product, null);
    expect(component.draft().length).toBe(2);
  });

  it('sends the current order discount_amount', () => {
    const { component } = create();
    expect(component.buildPayload().discount_amount).toBe(1500);
  });

  it('disables save with an empty draft or no changes', () => {
    const { component } = create();
    expect(component.canSave()).toBeFalse();
    component.increment(component.draft()[0]);
    expect(component.canSave()).toBeTrue();
    component.remove(component.draft()[0]);
    component.remove(component.draft()[0]);
    expect(component.isEmpty()).toBeTrue();
    expect(component.canSave()).toBeFalse();
  });

  it('keeps the modal open and the draft when the API fails', () => {
    ordersService.updateOrderItems.and.returnValue(
      throwError(() => new Error('Orden no editable')),
    );
    const { component } = create();
    component.increment(component.draft()[0]);
    component.save();
    expect(toast.error).toHaveBeenCalled();
    expect(component.isOpen()).toBeTrue();
    expect(component.draft()[0].quantity).toBe(3);
    expect(component.saving()).toBeFalse();
  });

  it('on success calls the API, emits saved and closes', () => {
    const updated = { id: 77 } as Order;
    ordersService.updateOrderItems.and.returnValue(of(updated));
    const { component } = create();
    const emitted: Order[] = [];
    component.saved.subscribe((o) => emitted.push(o));
    component.increment(component.draft()[0]);
    component.save();
    expect(ordersService.updateOrderItems.calls.mostRecent().args[0]).toBe('77');
    expect(toast.success).toHaveBeenCalledWith('Productos de la orden actualizados');
    expect(emitted).toEqual([updated]);
    expect(component.isOpen()).toBeFalse();
  });
});
