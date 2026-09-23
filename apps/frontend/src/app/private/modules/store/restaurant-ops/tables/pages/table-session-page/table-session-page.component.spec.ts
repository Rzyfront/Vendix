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
    expect(component.deliveringTicketId()).toBeNull();
    response.next(delivered);
    response.complete();
    expect(component.deliveringItemId()).toBeNull();
    expect(component.session()?.order?.order_items.filter((row) => row.delivered_at != null).map((row) => row.id)).toEqual([101]);
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
});
