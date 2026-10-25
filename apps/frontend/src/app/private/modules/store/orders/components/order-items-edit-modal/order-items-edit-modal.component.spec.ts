import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ToastService } from '../../../../../../shared/components';
import {
  ItemChangesPreview,
  ItemChangesPreviewLine,
  Order,
} from '../../interfaces/order.interface';
import { KitchenTicketPrintService } from '../../../restaurant-ops/kds/services/kitchen-ticket-print.service';
import { StoreOrdersService } from '../../services/store-orders.service';
import { ProductsService } from '../../../products/services/products.service';
import { Product } from '../../../products/interfaces/product.interface';
import { OrderItemsEditModalComponent } from './order-items-edit-modal.component';

describe('OrderItemsEditModalComponent (cambios por diferencias)', () => {
  let ordersService: jasmine.SpyObj<StoreOrdersService>;
  let toast: jasmine.SpyObj<ToastService>;
  let ticketPrint: jasmine.SpyObj<KitchenTicketPrintService>;

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
      'getOrderById',
    ]);
    ordersService.previewItemChanges.and.returnValue(of(previewOf()));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    ticketPrint = jasmine.createSpyObj('KitchenTicketPrintService', ['printAfterFire']);
    await TestBed.configureTestingModule({
      imports: [OrderItemsEditModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreOrdersService, useValue: ordersService },
        { provide: ToastService, useValue: toast },
        { provide: KitchenTicketPrintService, useValue: ticketPrint },
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

  const httpError = (status: number, errorCode?: string) =>
    Object.assign(new Error('x'), { errorCode: errorCode ?? null, cause: { status } });

  /** Orden fresca: la línea añadida ya existe (id 50) y la 1 cambió de cantidad. */
  const freshOrder = (): Order =>
    ({
      id: 77,
      order_number: 'ORD-77',
      order_items: [
        { id: 1, product_id: 10, product_name: 'Camisa', quantity: 3, unit_price: 10000 },
        { id: 50, product_id: 30, product_name: 'Zapato', quantity: 1, unit_price: 50000 },
      ],
    }) as unknown as Order;

  it('a version conflict (409) reloads the order and rebuilds the draft without the added lines', async () => {
    ordersService.applyItemChanges.and.returnValue(
      throwError(() => httpError(409, 'ORD_EDIT_INVALID_STATE_001')),
    );
    ordersService.getOrderById.and.returnValue(of(freshOrder()));
    const { fixture, component } = create();
    const reloaded: Array<Order | null> = [];
    component.orderReloaded.subscribe((o) => reloaded.push(o));
    component.addProduct({ id: 30, name: 'Zapato', base_price: 50000 } as unknown as Product, null);
    await settle(fixture);
    expect(component.changeSet().add).toEqual([{ product_id: 30, quantity: 1 }]);
    component.save();
    fixture.detectChanges();

    expect(ordersService.getOrderById).toHaveBeenCalledWith('77');
    expect(toast.error).toHaveBeenCalledWith(
      'La orden cambió mientras editabas. Se recargó su estado actual; vuelve a aplicar tus cambios.',
    );
    expect(component.draft().map((l) => l.product_name)).toEqual(['Camisa', 'Zapato']);
    expect(component.draft().every((l) => !!l.existing)).toBeTrue();
    expect(component.changeSet()).toEqual({});
    expect(reloaded.length).toBe(1);
    expect(component.isOpen()).toBeTrue();
  });

  it('a 500 reloads the order with the unknown-outcome message', async () => {
    ordersService.applyItemChanges.and.returnValue(throwError(() => httpError(500)));
    ordersService.getOrderById.and.returnValue(of(freshOrder()));
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    fixture.detectChanges();
    expect(ordersService.getOrderById).toHaveBeenCalledWith('77');
    expect(toast.error).toHaveBeenCalledWith(
      'No pudimos confirmar si se guardó. Recargamos la orden para que veas su estado real.',
    );
    expect(component.draft().length).toBe(2);
    expect(component.changeSet()).toEqual({});
  });

  it('a network error (status 0) also reloads the order', async () => {
    ordersService.applyItemChanges.and.returnValue(throwError(() => httpError(0)));
    ordersService.getOrderById.and.returnValue(of(freshOrder()));
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(ordersService.getOrderById).toHaveBeenCalledTimes(1);
  });

  it('if the reload itself fails, saving is blocked to avoid duplicating lines', async () => {
    ordersService.applyItemChanges.and.returnValue(throwError(() => httpError(500)));
    ordersService.getOrderById.and.returnValue(throwError(() => new Error('down')));
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    fixture.detectChanges();
    expect(component.reloadFailed()).toBeTrue();
    expect(component.canSave()).toBeFalse();
  });

  it('a 422 keeps the draft, shows the real error and relaunches the preview', async () => {
    ordersService.applyItemChanges.and.returnValue(
      throwError(() => Object.assign(new Error('Insumos insuficientes'), { errorCode: 'INV_STOCK_INSUFFICIENT_LINES', cause: { status: 422 } })),
    );
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    const calls = ordersService.previewItemChanges.calls.count();
    component.save();
    fixture.detectChanges();
    expect(ordersService.getOrderById).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Insumos insuficientes');
    expect(component.changeSet()).toEqual({ update: [{ order_item_id: 1, quantity: 3 }] });
    expect(ordersService.previewItemChanges.calls.count()).toBe(calls + 1);
    expect(component.isOpen()).toBeTrue();
  });

  it('apply with kitchen_ticket_ids prints the comanda before emitting saved', async () => {
    const updated = { id: 77 } as Order;
    ordersService.applyItemChanges.and.returnValue(
      of({ order: updated, summary: previewOf(), kitchen: { kitchen_ticket_ids: [8, 9] } }),
    );
    const { fixture, component } = create();
    const order: string[] = [];
    ticketPrint.printAfterFire.and.callFake(() => { order.push('print'); });
    component.saved.subscribe(() => order.push('saved'));
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(ticketPrint.printAfterFire).toHaveBeenCalledOnceWith([8, 9], jasmine.any(Function));
    expect(order).toEqual(['print', 'saved']);
  });

  it('a print failure is only a warning, not a save error', async () => {
    ordersService.applyItemChanges.and.returnValue(
      of({ order: { id: 77 } as Order, summary: previewOf(), kitchen: { kitchen_ticket_ids: [8] } }),
    );
    ticketPrint.printAfterFire.and.callFake((_ids, failed) => { failed?.(8); failed?.(8); });
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(component.isOpen()).toBeFalse();
  });

  it('does not print when there are no kitchen tickets', async () => {
    ordersService.applyItemChanges.and.returnValue(
      of({ order: { id: 77 } as Order, summary: previewOf(), kitchen: { kitchen_ticket_ids: [] } }),
    );
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(ticketPrint.printAfterFire).not.toHaveBeenCalled();
  });

  it('stock_warnings (kitchen or top-level) show a warning toast', async () => {
    const warning = [{ kind: 'ingredient', product_name: 'Limón', requested: 3, available: 1 }];
    ordersService.applyItemChanges.and.returnValue(
      of({ order: { id: 77 } as Order, summary: previewOf(), kitchen: { kitchen_ticket_ids: [8], stock_warnings: warning as any } }),
    );
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.warning).toHaveBeenCalledWith(jasmine.stringContaining('Limón (faltan 2)'));
  });

  it('top-level stock_warnings are tolerated', async () => {
    const warning = [{ kind: 'product', product_name: 'Cerveza', requested: 2, available: 1 }];
    ordersService.applyItemChanges.and.returnValue(
      of({ order: { id: 77 } as Order, summary: previewOf(), stock_warnings: warning as any }),
    );
    const { fixture, component } = create();
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.warning).toHaveBeenCalledWith(jasmine.stringContaining('Cerveza (falta 1)'));
  });

  it('a reprice preview entry is informative and does not alter the change-set', async () => {
    ordersService.previewItemChanges.and.returnValue(
      of(
        previewOf([
          { key: 'existing:1', action: 'reprice', quantity_before: 2, quantity_after: 2, messages: ['Descuento $100 → $50'] },
          { key: 'existing:2', action: 'remove', quantity_before: 1, quantity_after: 0, kitchen_effect: 'none', messages: [] },
        ]),
      ),
    );
    const { fixture, component } = create();
    component.remove(component.draft()[1]);
    await settle(fixture);
    expect(component.changeSet()).toEqual({ remove: [{ order_item_id: 2 }] });
    const pl = component.previewFor(component.draft()[0])!;
    expect(component.repriceChip(pl)?.text).toBe('Descuento recalculado');
    expect(pl.messages).toEqual(['Descuento $100 → $50']);
    expect(component.draft()[0].quantity).toBe(2);
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

  it('cannot be closed (X / Escape) while saving', () => {
    const { component } = create();
    expect(component.canCloseModal()).toBeTrue();
    component.saving.set(true);
    expect(component.canCloseModal()).toBeFalse();
    component.close();
    expect(component.isOpen()).toBeTrue();
  });

  it('new lines show the tax-inclusive price, also for variants', () => {
    const { component } = create();
    const product = {
      id: 40,
      name: 'Tenis',
      base_price: 100,
      final_price: 119,
      product_variants: [{ id: 401, sku: 'T-1', price_override: 200 }],
    } as unknown as Product;
    component.addProduct(product, product.product_variants![0]);
    expect(component.draft().at(-1)!.display_price).toBe(238);
    const simple = { id: 41, name: 'Gorra', base_price: 100, final_price: 119 } as unknown as Product;
    component.addProduct(simple, null);
    expect(component.draft().at(-1)!.display_price).toBe(119);
  });

  it('reload_required is a successful save: prints, warns, reloads and emits saved with the fresh order', async () => {
    const warning = [{ kind: 'product', product_name: 'Cerveza', requested: 2, available: 1 }];
    ordersService.applyItemChanges.and.returnValue(
      of({
        order: null,
        reload_required: true,
        summary: previewOf(),
        kitchen: { kitchen_ticket_ids: [8], stock_warnings: warning as any },
      }),
    );
    const fresh = freshOrder();
    ordersService.getOrderById.and.returnValue(of(fresh));
    const { fixture, component } = create();
    const emitted: Order[] = [];
    component.saved.subscribe((o) => emitted.push(o));
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.success).toHaveBeenCalledWith('Productos de la orden actualizados');
    expect(ticketPrint.printAfterFire).toHaveBeenCalledOnceWith([8], jasmine.any(Function));
    expect(toast.warning).toHaveBeenCalledWith(jasmine.stringContaining('Cerveza'));
    expect(ordersService.getOrderById).toHaveBeenCalledWith('77');
    expect(emitted).toEqual([fresh]);
    expect(component.isOpen()).toBeFalse();
    expect(component.saving()).toBeFalse();
  });

  it('reload_required with a failed reload warns, emits orderReloaded and closes', async () => {
    ordersService.applyItemChanges.and.returnValue(
      of({ order: null, reload_required: true, summary: previewOf(), kitchen: { kitchen_ticket_ids: [] } }),
    );
    ordersService.getOrderById.and.returnValue(throwError(() => new Error('down')));
    const { fixture, component } = create();
    const reloaded: Array<Order | null> = [];
    const saved: Order[] = [];
    component.orderReloaded.subscribe((o) => reloaded.push(o));
    component.saved.subscribe((o) => saved.push(o));
    component.increment(component.draft()[0]);
    await settle(fixture);
    component.save();
    expect(toast.success).toHaveBeenCalledWith('Productos de la orden actualizados');
    expect(toast.warning).toHaveBeenCalledWith(
      'Se guardó, pero no pudimos recargar la orden; actualiza la página',
    );
    expect(reloaded).toEqual([null]);
    expect(saved).toEqual([]);
    expect(component.isOpen()).toBeFalse();
  });
});
