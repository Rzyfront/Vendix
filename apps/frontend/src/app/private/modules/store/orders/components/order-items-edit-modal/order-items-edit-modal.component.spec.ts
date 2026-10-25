import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ToastService } from '../../../../../../shared/components';
import {
  ItemChangesPreview,
  ItemChangesPreviewLine,
  Order,
} from '../../interfaces/order.interface';
import { StoreOrdersService } from '../../services/store-orders.service';
import { ProductsService } from '../../../products/services/products.service';
import { Product } from '../../../products/interfaces/product.interface';
import { OrderItemsEditModalComponent } from './order-items-edit-modal.component';

describe('OrderItemsEditModalComponent (cambios por diferencias)', () => {
  let ordersService: jasmine.SpyObj<StoreOrdersService>;
  let toast: jasmine.SpyObj<ToastService>;

  const totals = (grand: number) => ({
    subtotal: grand,
    discount: 0,
    tax: 0,
    tip: 0,
    shipping: 0,
    grand_total: grand,
  });

  const previewOf = (
    lines: Partial<ItemChangesPreviewLine>[] = [],
    over: Partial<ItemChangesPreview> = {},
  ): ItemChangesPreview => ({
    order_id: 77,
    version: 'v1',
    can_apply: true,
    lines: lines as ItemChangesPreviewLine[],
    totals: { before: totals(100), after: totals(80) },
    warnings: [],
    ...over,
  });

  const buildOrder = (): Order =>
    ({
      id: 77,
      order_number: 'ORD-77',
      order_items: [
        { id: 1, product_id: 10, product_name: 'Camisa', quantity: 2, unit_price: 10000 },
        {
          id: 2,
          product_id: 11,
          product_name: 'Hamburguesa',
          quantity: 1,
          unit_price: 5000,
          inventory_consumed_at_fire: true,
          kitchen_ticket_items: [
            { id: 9, status: 'pending', kitchen_ticket_id: 4, kitchen_ticket: { id: 4, status: 'pending', daily_number: 12 } },
          ],
        },
        {
          id: 3,
          product_id: 12,
          product_name: 'Gaseosa',
          quantity: 1,
          unit_price: 3000,
          delivered_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 4,
          product_id: 13,
          product_name: 'Postre',
          quantity: 1,
          unit_price: 3000,
          cancelled_at: '2026-01-01T00:00:00Z',
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

  /** Deja pasar el debounce y resuelve el preview. */
  const settle = async (fixture: { detectChanges: () => void }) => {
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 480));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    ordersService = jasmine.createSpyObj('StoreOrdersService', [
      'previewItemChanges',
      'applyItemChanges',
      'updateOrderItems',
    ]);
    ordersService.previewItemChanges.and.returnValue(of(previewOf()));
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

  it('only sends the edited line as update; untouched lines do not travel', () => {
    const { component } = create();
    component.increment(component.draft()[0]);
    expect(component.changeSet()).toEqual({ update: [{ order_item_id: 1, quantity: 3 }] });
  });

  it('cancelled lines are read-only and do not block saving', async () => {
    const { fixture, component } = create();
    expect(component.cancelledLines().length).toBe(1);
    expect(component.draft().length).toBe(3);
    component.increment(component.draft()[0]);
    await settle(fixture);
    expect(component.canSave()).toBeTrue();
  });

  it('removing a kitchen line sends remove and shows the ticket-cancel message from the preview', async () => {
    ordersService.previewItemChanges.and.returnValue(
      of(
        previewOf([
          {
            key: 'existing:2',
            kitchen_effect: 'cancel_ticket_item',
            kitchen_ticket_number: 12,
            messages: ['Se cancelará la comanda #12 en cocina'],
          },
        ]),
      ),
    );
    const { fixture, component } = create();
    const line = component.draft()[1];
    expect(line.in_kitchen).toBeTrue();
    expect(line.kitchen_ticket_number).toBe(12);
    component.remove(line);
    await settle(fixture);

    expect(component.changeSet()).toEqual({ remove: [{ order_item_id: 2 }] });
    expect(ordersService.previewItemChanges.calls.mostRecent().args[1]).toEqual({
      remove: [{ order_item_id: 2 }],
    });
    expect(component.previewFor(component.draft()[1])?.messages).toContain(
      'Se cancelará la comanda #12 en cocina',
    );
  });

  it('"+" on a kitchen line creates an add, never an update', () => {
    const { component } = create();
    const line = component.draft()[1];
    component.increment(line);
    component.increment(line);
    expect(component.changeSet()).toEqual({
      add: [{ product_id: 11, quantity: 2 }],
    });
    expect(component.changeSet().update).toBeUndefined();
    expect(component.draft()[1].quantity).toBe(1);
    expect(component.draft()[3].from_locked).toBeTrue();
  });

  it('a delivered line cannot be removed or decreased', () => {
    const { component } = create();
    const line = component.draft()[2];
    expect(line.delivered).toBeTrue();
    component.remove(line);
    component.decrement(line);
    expect(component.changeSet()).toEqual({});
    expect(component.draft()[2].removed).toBeFalse();
  });

  it('save is disabled without a reason when there is a remove, and enabled once valid', async () => {
    const { fixture, component } = create();
    component.remove(component.draft()[0]);
    await settle(fixture);
    expect(component.canSave()).toBeFalse();
    component.reason.set('  ab ');
    expect(component.canSave()).toBeFalse();
    component.reason.set('Cliente se arrepintió');
    expect(component.canSave()).toBeTrue();
  });

  it('requires a cancellation type when the preview asks for it', async () => {
    ordersService.previewItemChanges.and.returnValue(
      of(previewOf([{ key: 'existing:2', requires_cancellation_type: true }])),
    );
    const { fixture, component } = create();
    component.remove(component.draft()[1]);
    component.reason.set('Error de pedido');
    await settle(fixture);
    expect(component.canSave()).toBeFalse();
    component.setCancellationType(component.draft()[1], 'after_fire_reused');
    expect(component.changeSet().remove).toEqual([
      { order_item_id: 2, cancellation_type: 'after_fire_reused' },
    ]);
    await settle(fixture);
    expect(component.canSave()).toBeTrue();
  });

  it('does not allow saving while the preview is pending, failed or not applicable', async () => {
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    fixture.detectChanges();
    expect(component.previewPending()).toBeTrue();
    expect(component.canSave()).toBeFalse();

    ordersService.previewItemChanges.and.returnValue(throwError(() => new Error('boom')));
    component.increment(component.draft()[0]);
    await settle(fixture);
    expect(component.previewError()).toBeTruthy();
    expect(component.canSave()).toBeFalse();

    ordersService.previewItemChanges.and.returnValue(of(previewOf([], { can_apply: false })));
    component.increment(component.draft()[0]);
    await settle(fixture);
    expect(component.canSave()).toBeFalse();
  });

  it('a failing apply shows an error toast, does not emit saved and does not show success', async () => {
    ordersService.applyItemChanges.and.returnValue(throwError(() => new Error('Orden no editable')));
    const { fixture, component } = create();
    const emitted: Order[] = [];
    component.saved.subscribe((o) => emitted.push(o));
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(component.isOpen()).toBeTrue();
    expect(component.saving()).toBeFalse();
  });

  it('a version conflict shows the refresh message and relaunches the preview', async () => {
    const err = Object.assign(new Error('x'), { errorCode: 'ORD_EDIT_INVALID_STATE_001' });
    ordersService.applyItemChanges.and.returnValue(throwError(() => err));
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    const calls = ordersService.previewItemChanges.calls.count();
    component.save();
    fixture.detectChanges();
    expect(toast.error).toHaveBeenCalledWith('La orden cambió mientras editabas; revisa los cambios');
    expect(ordersService.previewItemChanges.calls.count()).toBe(calls + 1);
    expect(component.isOpen()).toBeTrue();
  });

  it('on success sends the diff with expected_version, emits saved and closes', async () => {
    const updated = { id: 77 } as Order;
    ordersService.applyItemChanges.and.returnValue(of({ order: updated, summary: previewOf() }));
    const { fixture, component } = create();
    const emitted: Order[] = [];
    component.saved.subscribe((o) => emitted.push(o));
    component.remove(component.draft()[0]);
    component.reason.set('Motivo válido');
    await settle(fixture);
    component.save();
    expect(ordersService.applyItemChanges).toHaveBeenCalledWith(77, {
      remove: [{ order_item_id: 1 }],
      expected_version: 'v1',
      reason: 'Motivo válido',
    });
    expect(ordersService.updateOrderItems).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Productos de la orden actualizados');
    expect(emitted).toEqual([updated]);
    expect(component.isOpen()).toBeFalse();
  });

  it('adds a searched product as add[] with its variant', () => {
    const { component } = create();
    const product = {
      id: 30,
      name: 'Zapato',
      base_price: 50000,
      product_variants: [{ id: 301, sku: 'ZAP-42', price_override: 65000 }],
    } as unknown as Product;
    component.addProduct(product, null);
    expect(component.changeSet().add).toBeUndefined();
    component.addProduct(product, product.product_variants![0]);
    component.addProduct(product, product.product_variants![0]);
    expect(component.changeSet().add).toEqual([
      { product_id: 30, product_variant_id: 301, quantity: 2 },
    ]);
  });
});
