import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { OrdersListComponent } from './orders-list.component';
import { StoreOrdersService } from '../../services/store-orders.service';
import { OrderPrintService } from '../../services/order-print.service';
import { OrdersListSseService } from '../../services/orders-list-sse.service';
import { KitchenTicketsService } from '../../../restaurant-ops/kds/services/kitchen-tickets.service';
import { KitchenTicketPrintService } from '../../../restaurant-ops/kds/services/kitchen-ticket-print.service';
import { TablesService } from '../../../restaurant-ops/tables/services/tables.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DialogService, ToastService, ResponsiveDataViewComponent, TableAction } from '../../../../../../shared/components/index';
import { ItemListComponent } from '../../../../../../shared/components/item-list/item-list.component';
import { TableComponent } from '../../../../../../shared/components/table/table.component';
import { Order, OrderState } from '../../interfaces/order.interface';

describe('OrdersListComponent semantic mobile actions', () => {
  let fixture: ComponentFixture<OrdersListComponent>, component: OrdersListComponent;
  let service: { updateOrderStatus: jasmine.Spy }, print: { printOrder: jasmine.Spy };
  let dialog: { confirm: jasmine.Spy }, toast: { error: jasmine.Spy; success: jasmine.Spy; warning: jasmine.Spy };
  const order = (state: OrderState = 'created', canCancel = true): Order => ({
    id: 12, order_number: 'ORD-12', state, list_state: state,
    cancellation_policy: { can_cancel: canCancel, can_cancel_payment: canCancel, reason_code: null }, net_total: 123456,
  } as Order);
  const extra = (label = 'Cocina'): TableAction => ({
    label: () => label, icon: 'flame', action: jasmine.createSpy(label), show: () => true,
  });

  beforeEach(async () => {
    service = { updateOrderStatus: jasmine.createSpy('updateOrderStatus').and.returnValue(of({})) };
    print = { printOrder: jasmine.createSpy('printOrder').and.returnValue(Promise.resolve()) };
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    toast = { error: jasmine.createSpy('error'), success: jasmine.createSpy('success'), warning: jasmine.createSpy('warning') };
    await TestBed.configureTestingModule({
      imports: [OrdersListComponent], providers: [
        provideZonelessChangeDetection(),
        { provide: StoreOrdersService, useValue: service },
        { provide: OrderPrintService, useValue: print },
        { provide: KitchenTicketsService, useValue: { fireOrderItems: jasmine.createSpy('fireOrderItems').and.returnValue(NEVER) } },
        { provide: KitchenTicketPrintService, useValue: { printAfterFire: jasmine.createSpy('printAfterFire') } },
        { provide: DialogService, useValue: dialog }, { provide: ToastService, useValue: toast },
        { provide: CurrencyFormatService, useValue: { format: (value: number) => `$ ${value}` } },
        { provide: HttpClient, useValue: { get: () => of({ data: [] }) } },
        { provide: TablesService, useValue: { getFloorMap: () => of([]) } },
        { provide: AuthFacade, useValue: { isRestaurant: signal(false) } },
        { provide: ActivatedRoute, useValue: { queryParamMap: NEVER } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        { provide: OrdersListSseService, useValue: {
          lastRelevantEvent: signal(null), lastCreatedEvent: signal(null),
          hydrationEvents: signal([]), recoveredConnection: signal(0), connect() {}, disconnect() {},
        } },
      ],
    }).overrideComponent(OrdersListComponent, {
      set: { imports: [ResponsiveDataViewComponent], schemas: [NO_ERRORS_SCHEMA] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrdersListComponent); component = fixture.componentInstance;
    spyOn(component, 'loadOrders');
  });
  afterEach(() => TestBed.resetTestingModule());

  function core(): TableAction[] { return [component.viewAction, component.printAction, component.cancelAction]; }
  async function render(): Promise<void> { component.orders.set([order()]); await fixture.whenStable(); }

  it('desktop preserves named core order and identity alongside extras', () => {
    const expectedCore = core();
    const desktopCore = component.actions.filter((action) => expectedCore.includes(action));
    expect(desktopCore).toEqual(expectedCore);
    desktopCore.forEach((action, i) => expect(action).toBe(expectedCore[i]));
  });
  it('mobile keeps named core first, preserves every extra and caps direct count', () => {
    const expectedCore = core();
    const extras = component.actions.filter((action) => !expectedCore.includes(action));
    const mobile = component.mobileActions();
    expect(mobile.slice(0, 3)).toEqual(expectedCore);
    expectedCore.forEach((action, i) => expect(mobile[i]).toBe(action));
    expect(mobile.slice(3)).toEqual(extras);
    extras.forEach((action, i) => expect(mobile[i + 3]).toBe(action));
    expect(component.mobileDirectActionsCount()).toBe(Math.min(4, mobile.length));
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
});
