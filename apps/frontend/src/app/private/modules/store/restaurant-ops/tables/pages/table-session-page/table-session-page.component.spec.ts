import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { TableSessionPageComponent } from './table-session-page.component';
import { TablesService } from '../../services/tables.service';
import { AdminTablesSseService } from '../../services/admin-tables-sse.service';
import { KitchenTicketsService, KdsSseService } from '../../../kds/services';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { DialogService, ToastService } from '../../../../../../../shared/components';
import type { TableSession, TableSessionOrderItem } from '../../interfaces';

describe('TableSessionPageComponent waiter delivery', () => {
  let component: TableSessionPageComponent;
  let api: jasmine.SpyObj<TablesService>;
  let kitchen: jasmine.SpyObj<KitchenTicketsService>;
  let toast: jasmine.SpyObj<ToastService>;

  const item = (id: number, isTakeaway: boolean): TableSessionOrderItem => ({
    id,
    product_id: id,
    product_variant_id: null,
    variant_label: null,
    product_name: `Plato ${id}`,
    quantity: 1,
    unit_price: '10000',
    total_price: '10000',
    inventory_consumed_at_fire: true,
    is_takeaway: isTakeaway,
    delivered_at: null,
    delivered_by_user_id: null,
    cancelled_at: null,
    cancellation_reason: null,
    cancellation_type: null,
    item_type: 'prepared',
    kitchen_ticket_items: [{ id: id + 100, status: 'ready', kitchen_ticket_id: 50 }],
  });

  const session = (items: TableSessionOrderItem[]): TableSession => ({
    id: 7,
    store_id: 1,
    table_id: 2,
    order_id: 30,
    opened_by: 4,
    opened_at: '2026-09-23T12:00:00Z',
    closed_at: null,
    guest_count: 2,
    order: {
      id: 30,
      state: 'pending',
      grand_total: '20000',
      subtotal_amount: '20000',
      tax_amount: '0',
      discount_amount: '0',
      order_items: items,
    },
  });

  beforeEach(async () => {
    api = jasmine.createSpyObj('TablesService', ['markItemDelivered']);
    kitchen = jasmine.createSpyObj('KitchenTicketsService', ['markDelivered']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    await TestBed.configureTestingModule({
      imports: [TableSessionPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TablesService, useValue: api },
        { provide: KitchenTicketsService, useValue: kitchen },
        { provide: KdsSseService, useValue: { tickets: signal([]) } },
        { provide: AdminTablesSseService, useValue: { lastEvent: signal(null) } },
        { provide: StoreSettingsFacade, useValue: { settings: signal(null) } },
        { provide: AuthFacade, useValue: {} },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: {} },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '7' } } } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
    })
      .overrideComponent(TableSessionPageComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
    component = TestBed.createComponent(TableSessionPageComponent).componentInstance;
  });

  it('delivers only the selected takeaway line of a mixed ticket via the order-item seam', () => {
    const takeaway = item(101, true);
    const dineIn = item(102, false);
    const before = session([takeaway, dineIn]);
    const delivered = session([
      { ...takeaway, delivered_at: '2026-09-23T12:05:00Z' },
      dineIn,
    ]);
    const response = new Subject<TableSession>();
    api.markItemDelivered.and.returnValue(response.asObservable());
    component.session.set(before);

    component.markDelivered(takeaway);

    expect(api.markItemDelivered).toHaveBeenCalledOnceWith(7, 101);
    expect(kitchen.markDelivered).not.toHaveBeenCalled();
    expect(component.deliveringItemId()).toBe(101);
    response.next(delivered);
    response.complete();
    expect(component.deliveringItemId()).toBeNull();
    expect(component.session()?.order?.order_items.filter((row) => row.delivered_at != null).map((row) => row.id)).toEqual([101]);
    // The order delivery fact outranks a stale KDS `ready` projection in the
    // returned session; otherwise this row still renders as "Listo".
    expect(component.kitchenStatusFor(delivered.order!.order_items[0])).toBe('delivered');
    expect(component.inKitchenCount()).toBe(1);
    expect(component.deliveredCount()).toBe(1);
    expect(toast.success).toHaveBeenCalledOnceWith('Item marcado como entregado');
  });

  it('uses the same item seam for dine-in without calling the KDS endpoint', () => {
    const dineIn = item(102, false);
    api.markItemDelivered.and.returnValue(of(session([dineIn])));
    component.session.set(session([dineIn]));

    component.markDelivered(dineIn);

    expect(api.markItemDelivered).toHaveBeenCalledOnceWith(7, 102);
    expect(kitchen.markDelivered).not.toHaveBeenCalled();
  });

  it('offers prepared delivery only after kitchen marks the item ready, regardless of takeaway', () => {
    for (const isTakeaway of [true, false]) {
      for (const status of ['pending', 'in_preparation', 'ready', 'delivered', 'cancelled'] as const) {
        const prepared = item(101, isTakeaway);
        prepared.kitchen_ticket_items![0].status = status;
        expect(component.canDeliver(prepared))
          .withContext(`${isTakeaway ? 'takeaway' : 'dine-in'} ${status}`)
          .toBe(status === 'ready');
      }
      expect(component.canDeliver({ ...item(101, isTakeaway), kitchen_ticket_items: [] }))
        .withContext('prepared without a ticket')
        .toBeFalse();
    }
  });

  it('keeps non-kitchen items deliverable but hides delivered or cancelled lines', () => {
    const direct = { ...item(103, true), item_type: 'physical', kitchen_ticket_items: [] };
    expect(component.canDeliver(direct)).toBeTrue();
    expect(component.canDeliver({ ...direct, delivered_at: '2026-09-23T12:05:00Z' })).toBeFalse();
    expect(component.canDeliver({ ...direct, cancelled_at: '2026-09-23T12:05:00Z' })).toBeFalse();
  });

  it('resolves the visible waiter name from the session table projection', () => {
    component.session.set({
      ...session([]),
      table: {
        id: 2, name: 'Mesa 2', zone: null, status: 'occupied',
        waiter: { id: 4, first_name: 'Ana', last_name: 'Rojas' },
      },
    });

    expect(component.waiterName()).toBe('Ana Rojas');
  });

  it('leaves the waiter label empty for a QR session without an opener', () => {
    component.session.set({
      ...session([]), opened_by: null,
      table: { id: 2, name: 'Mesa 2', zone: null, status: 'occupied', waiter: null },
    });

    expect(component.waiterName()).toBeNull();
  });
});
