import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { OrdersListComponent } from './orders-list.component';
import { StoreOrdersService } from '../../services/store-orders.service';
import { OrderPrintService } from '../../services/order-print.service';
import { OrdersListSseService } from '../../services/orders-list-sse.service';
import { TablesService } from '../../../restaurant-ops/tables/services/tables.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DialogService, ToastService, ResponsiveDataViewComponent, TableAction } from '../../../../../../shared/components/index';
import { ItemListComponent } from '../../../../../../shared/components/item-list/item-list.component';
import { TableComponent } from '../../../../../../shared/components/table/table.component';
import { KitchenTicketsService } from '../../../restaurant-ops/kds/services/kitchen-tickets.service';
import { KitchenTicketPrintService } from '../../../restaurant-ops/kds/services/kitchen-ticket-print.service';
import { Order, OrderItem, OrderState } from '../../interfaces/order.interface';

describe('OrdersListComponent semantic mobile actions', () => {
  let fixture: ComponentFixture<OrdersListComponent>, component: OrdersListComponent;
  let service: { updateOrderStatus: jasmine.Spy; getOrderById: jasmine.Spy }, print: { printOrder: jasmine.Spy };
  let dialog: { confirm: jasmine.Spy }, toast: { error: jasmine.Spy; success: jasmine.Spy; warning: jasmine.Spy; info: jasmine.Spy };
  let kitchen: { fireOrderItems: jasmine.Spy }, ticketPrint: { printAfterFire: jasmine.Spy };
  let restaurant: ReturnType<typeof signal<boolean>>, moduleVisible: ReturnType<typeof signal<boolean>>;
  let sse: { lastRelevantEvent: ReturnType<typeof signal<any>>; lastCreatedEvent: ReturnType<typeof signal<any>>; hydrationEvents: ReturnType<typeof signal<any[]>>; recoveredConnection: ReturnType<typeof signal<number>>; connect: jasmine.Spy; disconnect: jasmine.Spy };
  let clockInstalled = false;
  const order = (state: OrderState = 'created', canCancel = true): Order => ({
    id: 12, order_number: 'ORD-12', state, list_state: state,
    cancellation_policy: { can_cancel: canCancel, can_cancel_payment: canCancel, reason_code: null }, net_total: 123456,
  } as Order);
  const extra = (label = 'Cocina'): TableAction => ({
    label: () => label, icon: 'flame', action: jasmine.createSpy(label), show: () => true,
  });

  beforeEach(async () => {
    service = { updateOrderStatus: jasmine.createSpy('updateOrderStatus').and.returnValue(of({})), getOrderById: jasmine.createSpy('getOrderById').and.returnValue(NEVER) };
    kitchen = { fireOrderItems: jasmine.createSpy('fireOrderItems').and.returnValue(NEVER) };
    ticketPrint = { printAfterFire: jasmine.createSpy('printAfterFire') };
    restaurant = signal(false); moduleVisible = signal(true);
    sse = { lastRelevantEvent: signal(null), lastCreatedEvent: signal(null), hydrationEvents: signal([]), recoveredConnection: signal(0), connect: jasmine.createSpy('connect'), disconnect: jasmine.createSpy('disconnect') };
    print = { printOrder: jasmine.createSpy('printOrder').and.returnValue(Promise.resolve()) };
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), warning: jasmine.createSpy('warning'), info: jasmine.createSpy('info') };
    await TestBed.configureTestingModule({
      imports: [OrdersListComponent], providers: [
        provideZonelessChangeDetection(),
        { provide: StoreOrdersService, useValue: service },
        { provide: OrderPrintService, useValue: print },
        { provide: KitchenTicketsService, useValue: kitchen },
        { provide: KitchenTicketPrintService, useValue: ticketPrint },
        { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toast },
        { provide: CurrencyFormatService, useValue: { format: (value: number) => `$ ${value}` } },
        { provide: HttpClient, useValue: { get: () => of({ data: [] }) } },
        { provide: TablesService, useValue: { getFloorMap: () => of([]) } },
        { provide: AuthFacade, useValue: { isRestaurant: restaurant, isModuleVisible: () => moduleVisible() } },
        { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: OrdersListSseService, useValue: sse },
      ],
    }).overrideComponent(OrdersListComponent, {
      set: { imports: [ResponsiveDataViewComponent], schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrdersListComponent); component = fixture.componentInstance;
    spyOn(component, 'loadOrders');
  });
  afterEach(() => {
    try { TestBed.resetTestingModule(); } finally { if (clockInstalled) { jasmine.clock().uninstall(); clockInstalled = false; } }
  });

  function core(): TableAction[] { return [component.viewAction, component.printAction, component.cancelAction]; }
  async function render(): Promise<void> { component.orders.set([order()]); await fixture.whenStable(); }

  it('constructor prepends KDS exactly once while preserving desktop core order', () => {
    expect(component.actions).toEqual([component.kitchenAction, ...core()]);
    expect(component.actions.filter((action) => action === component.kitchenAction).length).toBe(1);
    component.actions.slice(1).forEach((action, i) => expect(action).toBe(core()[i]));
  });
  it('mobile places semantic core before KDS with count4', () => {
    expect(component.mobileActions()).toEqual([...core(), component.kitchenAction]); expect(component.mobileDirectActionsCount()).toBe(4);
  });
  it('a prepended kitchen-shaped extra follows core without losing Cancelar', () => {
    const kitchen = extra(); component.actions = [kitchen, ...core()];
    expect(component.mobileActions()).toEqual([...core(), kitchen]);
    expect(component.mobileActions()[2]).toBe(component.cancelAction);
    expect(component.mobileDirectActionsCount()).toBe(4);
    expect(component.actions[0]).toBe(kitchen);
  });
  it('retains every extra while capping direct actions at4', () => {
    const a = extra('A'), b = extra('B'), c = extra('C'); component.actions = [a, ...core(), b, c];
    expect(component.mobileActions()).toEqual([...core(), a, b, c]);
    expect(component.mobileDirectActionsCount()).toBe(4);
  });
  it('selects by object identity even when desktop is reordered and labels/icons collide', () => {
    const kitchen = extra('Cancelar orden'); kitchen.icon = 'x-circle';
    component.viewAction.label = () => 'Traducido'; component.printAction.label = 'Traducido';
    component.cancelAction.label = 'Traducido';
    component.actions = [kitchen, component.cancelAction, component.printAction, component.viewAction];
    expect(component.mobileActions()).toEqual([...core(), kitchen]);
    expect(component.actions[0]).toBe(kitchen);
  });
  it('does not duplicate core objects already present among extras', () => {
    const kitchen = extra(); component.actions = [component.cancelAction, kitchen, ...core()];
    expect(component.mobileActions()).toEqual([...core(), kitchen]);
  });
  for (const state of ['created', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'] as OrderState[]) {
    it(`preserves ${state} print visibility and authoritative cancellation policy`, () => {
      expect(component.printAction.show!(order(state))).toBe(!['cancelled', 'refunded'].includes(state));
      expect(component.cancelAction.show!(order(state, true))).toBeTrue();
      expect(component.cancelAction.show!(order(state, false))).toBeFalse();
    });
  }
  it('missing cancellation policy hides the action and blocks a forced callback', async () => {
    const item = order(); delete item.cancellation_policy;
    expect(component.cancelAction.show!(item)).toBeFalse();
    await component.cancelOrder(item);
    expect(dialog.confirm).not.toHaveBeenCalled(); expect(service.updateOrderStatus).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });
  it('view callback emits once and never changes order status', () => {
    const emitted = jasmine.createSpy('viewOrder'); component.viewOrder.subscribe(emitted);
    component.viewAction.action(order());
    expect(emitted).toHaveBeenCalledOnceWith('12'); expect(service.updateOrderStatus).not.toHaveBeenCalled();
  });
  it('print callback invokes the original printer exactly once', async () => {
    const item = order(); await component.printAction.action(item);
    expect(print.printOrder).toHaveBeenCalledOnceWith(item); expect(service.updateOrderStatus).not.toHaveBeenCalled();
  });
  it('print failure preserves its existing actionable error', async () => {
    print.printOrder.and.returnValue(Promise.reject(Error('offline')));
    await component.printAction.action(order());
    expect(toast.error).toHaveBeenCalledTimes(1); expect(service.updateOrderStatus).not.toHaveBeenCalled();
  });
  it('confirmed mobile cancel uses one status update and one refresh, not a second action path', async () => {
    const refresh = jasmine.createSpy('refresh'); component.refresh.subscribe(refresh);
    await component.cancelAction.action(order());
    expect(dialog.confirm).toHaveBeenCalledTimes(1);
    expect(service.updateOrderStatus).toHaveBeenCalledOnceWith('12', 'cancelled');
    expect(component.loadOrders).toHaveBeenCalledTimes(1); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('dismissed confirmation never issues a status update', async () => {
    dialog.confirm.and.resolveTo(false); await component.cancelAction.action(order());
    expect(service.updateOrderStatus).not.toHaveBeenCalled(); expect(component.loadOrders).not.toHaveBeenCalled();
  });
  it('production template passes desktop order unchanged and semantic mobile count4', async () => {
    const kitchen = extra(); component.actions = [kitchen, ...core()]; await render();
    const table = fixture.debugElement.query(By.directive(TableComponent)).componentInstance as TableComponent;
    const cards = fixture.debugElement.query(By.directive(ItemListComponent)).componentInstance as ItemListComponent;
    expect(table.actions()).toBe(component.actions);
    expect(cards.actions()).toBe(component.mobileActions()); expect(cards.directActionsCount()).toBe(4);
    expect(cards.getDirectActions(order())).toEqual([...core(), kitchen]);
  });
  it('production card cancel click does not also trigger view and preserves single PATCH', async () => {
    const viewed = jasmine.createSpy('viewed'); component.viewOrder.subscribe(viewed); await render();
    const cards = fixture.debugElement.query(By.directive(ItemListComponent));
    const button = cards.queryAll(By.css('.footer-action-btn'))[2];
    button.triggerEventHandler('click', new MouseEvent('click')); await fixture.whenStable();
    expect(service.updateOrderStatus).toHaveBeenCalledOnceWith('12', 'cancelled'); expect(viewed).not.toHaveBeenCalled();
  });

  function preparedOrder(status?: string): Order {
    const item = { id: 101, order_id: 12, product_id: 101, quantity: 2,
      products: { id: 101, product_type: 'prepared', name: 'Plato' },
      inventory_consumed_at_fire: status != null,
      kitchen_ticket_items: status ? [{ id: 1, status, kitchen_ticket_id: 55 }] : [],
    } as OrderItem;
    return { ...order(), order_items: [item] };
  }
  async function enableKitchen(item = preparedOrder()): Promise<Order> {
    restaurant.set(true); fixture.componentRef.setInput('canCreateKitchenFire', true);
    component.orders.set([item]); await fixture.whenStable(); return item;
  }
  function installClock(): void { jasmine.clock().install(); clockInstalled = true; }

  it('KDS visibility requires restaurant, module ceiling and permission without hiding Cancelar', async () => {
    const item = await enableKitchen();
    expect(component.kitchenAction.show!(item)).toBeTrue();
    fixture.componentRef.setInput('canCreateKitchenFire', false); await fixture.whenStable();
    expect(component.kitchenAction.show!(item)).toBeFalse();
    fixture.componentRef.setInput('canCreateKitchenFire', true); moduleVisible.set(false); await fixture.whenStable();
    expect(component.kitchenAction.show!(item)).toBeFalse();
    moduleVisible.set(true); restaurant.set(false); await fixture.whenStable();
    expect(component.kitchenAction.show!(item)).toBeFalse(); expect(component.cancelAction.show!(item)).toBeTrue();
  });
  for (const reason of ['physical', 'skip_kds', 'cancelled_line', 'missing_product']) {
    it(`KDS hides ${reason} lines rather than treating them as prepared`, async () => {
      const item = preparedOrder(), line = item.order_items![0];
      if (reason === 'physical') line.products!.product_type = 'physical';
      if (reason === 'skip_kds') line.skip_kds = true;
      if (reason === 'cancelled_line') line.cancelled_at = '2026-10-07T00:00:00Z';
      if (reason === 'missing_product') line.product_id = null as unknown as number;
      await enableKitchen(item); expect(component.kitchenAction.show!(item)).toBeFalse();
      expect(component.cancelAction.show!(item)).toBeTrue();
    });
  }
  it('KDS double click while pending performs one POST with unique prepared item IDs', async () => {
    const response = new Subject<any>(); kitchen.fireOrderItems.and.returnValue(response);
    const item = await enableKitchen(); component.kitchenAction.action(item); component.kitchenAction.action(item);
    expect(kitchen.fireOrderItems).toHaveBeenCalledOnceWith({ order_id: 12, order_item_ids: [101] });
    expect(component.firingOrderIds().has(12)).toBeTrue();
    response.next({ kitchen_ticket_id: 55 }); response.complete();
    component.kitchenAction.action(item);
    expect(kitchen.fireOrderItems).toHaveBeenCalledTimes(1); expect(ticketPrint.printAfterFire).toHaveBeenCalledTimes(1);
    expect(component.firingOrderIds().has(12)).toBeFalse(); expect(component.firedKitchenOrderIds().has(12)).toBeTrue();
  });
  it('post-success print failure warns once and never fires a second kitchen request', async () => {
    kitchen.fireOrderItems.and.returnValue(of({ kitchen_ticket_ids: [55, 56] }));
    ticketPrint.printAfterFire.and.callFake((_ids, failed) => { failed(); failed(); });
    const item = await enableKitchen(); component.kitchenAction.action(item); component.kitchenAction.action(item);
    expect(ticketPrint.printAfterFire).toHaveBeenCalledOnceWith([55, 56], jasmine.any(Function));
    expect(toast.warning).toHaveBeenCalledTimes(1); expect(kitchen.fireOrderItems).toHaveBeenCalledTimes(1);
  });
  for (const status of ['pending', 'in_preparation', 'ready', 'delivered', 'cancelled']) {
    it(`KDS ${status} fired state stays informational with zero POSTs`, async () => {
      const item = await enableKitchen(preparedOrder(status));
      component.kitchenAction.action(item);
      expect(kitchen.fireOrderItems).not.toHaveBeenCalled();
      const tooltip = component.kitchenAction.tooltip;
      expect(typeof tooltip === 'function' ? tooltip(item) : tooltip).toContain('Solo informativo');
    });
  }
  it('stale KDS click hydrates instead of POSTing and successful hydration clears stale state', async () => {
    const response = new Subject<any>(); service.getOrderById.and.returnValue(response);
    const item = await enableKitchen(); component.staleKitchenOrderIds.set(new Set([12]));
    component.kitchenAction.action(item);
    expect(service.getOrderById).toHaveBeenCalledOnceWith('12'); expect(kitchen.fireOrderItems).not.toHaveBeenCalled();
    response.next(preparedOrder('ready')); response.complete();
    expect(component.staleKitchenOrderIds().has(12)).toBeFalse();
    expect(component.orders()[0].order_items![0].kitchen_ticket_items![0].status).toBe('ready');
  });
  it('newer hydration event wins over a stale in-flight response', async () => {
    const first = new Subject<any>(), second = new Subject<any>();
    service.getOrderById.and.returnValues(first, second);
    await enableKitchen();
    sse.hydrationEvents.set([{ id: 1, type: 'ticket.started', order_id: 12 }]); await fixture.whenStable();
    sse.hydrationEvents.set([{ id: 2, type: 'ticket.ready', order_id: 12 }]); await fixture.whenStable();
    first.next(preparedOrder('in_preparation')); first.complete();
    expect(component.orders()[0].order_items![0].inventory_consumed_at_fire).toBeFalse();
    expect(service.getOrderById).toHaveBeenCalledTimes(2);
    second.next(preparedOrder('ready')); second.complete();
    expect(component.orders()[0].order_items![0].kitchen_ticket_items![0].status).toBe('ready');
  });
  it('hydration retries twice then exposes stale state, with no unbounded timer loop', async () => {
    await enableKitchen(); installClock();
    service.getOrderById.and.returnValue(throwError(() => Error('offline')));
    component.staleKitchenOrderIds.set(new Set([12])); component.kitchenAction.action(component.orders()[0]);
    jasmine.clock().tick(500); jasmine.clock().tick(1000); jasmine.clock().tick(60000);
    expect(service.getOrderById).toHaveBeenCalledTimes(3); expect(component.staleKitchenOrderIds().has(12)).toBeTrue();
    expect(toast.warning).toHaveBeenCalledTimes(1); expect(kitchen.fireOrderItems).not.toHaveBeenCalled();
  });
  it('destroy clears a scheduled hydration retry and disconnects once', async () => {
    await enableKitchen(); installClock();
    service.getOrderById.and.returnValue(throwError(() => Error('offline')));
    component.staleKitchenOrderIds.set(new Set([12])); component.kitchenAction.action(component.orders()[0]);
    fixture.destroy(); jasmine.clock().tick(60000);
    expect(service.getOrderById).toHaveBeenCalledTimes(1); expect(sse.disconnect).toHaveBeenCalledTimes(1);
  });
  it('destroy unsubscribes pending hydration and fire so late results cannot print or update', async () => {
    const get = new Subject<any>(), fire = new Subject<any>();
    service.getOrderById.and.returnValue(get); kitchen.fireOrderItems.and.returnValue(fire);
    const item = await enableKitchen(); component.kitchenAction.action(item);
    sse.hydrationEvents.set([{ id: 1, type: 'ticket.ready', order_id: 12 }]); await fixture.whenStable();
    expect(get.observers.length).toBe(1); expect(fire.observers.length).toBe(1);
    fixture.destroy(); expect(get.observers.length).toBe(0); expect(fire.observers.length).toBe(0);
    fire.next({ kitchen_ticket_id: 55 }); get.next(preparedOrder('ready'));
    expect(ticketPrint.printAfterFire).not.toHaveBeenCalled(); expect(component.orders()[0]).toBe(item);
  });
  it('recovered SSE connection reconciles once without firing or changing action references', async () => {
    await enableKitchen(); const mobile = component.mobileActions();
    sse.recoveredConnection.set(1); await fixture.whenStable(); await fixture.whenStable();
    expect(component.loadOrders).toHaveBeenCalledTimes(1); expect(kitchen.fireOrderItems).not.toHaveBeenCalled();
    expect(component.mobileActions()).toBe(mobile);
  });
  it('production mobile exposes Cancelar and KDS directly with independent single callbacks', async () => {
    const item = await enableKitchen();
    const cards = fixture.debugElement.query(By.directive(ItemListComponent));
    expect(cards.componentInstance.getDirectActions(item)).toEqual([...core(), component.kitchenAction]);
    const buttons = cards.queryAll(By.css('.footer-action-btn'));
    expect(buttons.length).toBe(4);
    buttons[3].triggerEventHandler('click', new MouseEvent('click')); await fixture.whenStable();
    expect(kitchen.fireOrderItems).toHaveBeenCalledTimes(1); expect(service.updateOrderStatus).not.toHaveBeenCalled();
    expect(buttons[3].nativeElement.getAttribute('title')).toBeNull();
    expect(buttons[2].nativeElement.getAttribute('aria-label')).toBe('Cancelar orden: ORD-12');
  });
});
