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
import type { Table, TableSession, TableSessionOrderItem, TableSessionAddItem } from '../../interfaces';
import type { TablePaymentSubmit } from '../../components/table-payment-modal/table-payment-modal.component';

describe('TableSessionPageComponent waiter delivery', () => {
  let component: TableSessionPageComponent;
  let api: jasmine.SpyObj<TablesService>;
  let kitchen: jasmine.SpyObj<KitchenTicketsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let dialog: jasmine.SpyObj<DialogService>;
  let kdsSse: { tickets: ReturnType<typeof signal<unknown[]>>; refreshSnapshot: jasmine.Spy };
  let router: jasmine.SpyObj<Router>;
  let floorTables: ReturnType<typeof signal<Table[]>>;

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
    table: { id: 2, name: 'Mesa 2', zone: null, status: 'cleaning' },
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
    api = jasmine.createSpyObj('TablesService', ['markItemDelivered', 'updateItemNotes', 'getOrderReassignmentEvidence', 'getSession', 'getFloorMap', 'addItems', 'payTableSession']);
    floorTables = signal<Table[]>([]);
    Object.defineProperty(api, 'floorTables', { value: floorTables });
    api.getFloorMap.and.returnValue(of([]));
    kitchen = jasmine.createSpyObj('KitchenTicketsService', ['markDelivered']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    dialog = jasmine.createSpyObj('DialogService', ['confirm', 'prompt']);
    kdsSse = { tickets: signal([]), refreshSnapshot: jasmine.createSpy().and.resolveTo([]) };
    router = jasmine.createSpyObj('Router', ['navigate']);
    await TestBed.configureTestingModule({
      imports: [TableSessionPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TablesService, useValue: api },
        { provide: KitchenTicketsService, useValue: kitchen },
        { provide: KdsSseService, useValue: kdsSse },
        { provide: AdminTablesSseService, useValue: { lastEvent: signal(null) } },
        { provide: StoreSettingsFacade, useValue: { settings: signal(null) } },
        { provide: AuthFacade, useValue: {} },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: dialog },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '7' } } } },
        { provide: Router, useValue: router },
      ],
    })
      .overrideComponent(TableSessionPageComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
    component = TestBed.createComponent(TableSessionPageComponent).componentInstance;
  });

  it('checks scoped order evidence before exposing a closed-session reassignment action', () => {
    const closed = { ...session([]), closed_at: '2026-09-23T12:10:00Z',
      order: { ...session([]).order!, state: 'draft' } };
    api.getSession.and.returnValue(of(closed));
    api.getOrderReassignmentEvidence.and.returnValue(of({
      id: 30, state: 'draft', total_paid: '0', active_financial_split_id: null,
      payments: [], invoices: [],
    }));

    component.loadSession(7);

    expect(api.getOrderReassignmentEvidence).toHaveBeenCalledOnceWith(30);
    expect(api.getFloorMap).toHaveBeenCalled();
    expect((component as any).canReassignClosedOrder()).toBeTrue();
  });

  it('offers reassignment only for a closed, unpaid draft without financial evidence', () => {
    const closed = { ...session([]), closed_at: '2026-09-23T12:10:00Z', paid_at: null,
      order: { ...session([]).order!, state: 'draft' } };
    component.session.set(closed);
    (component as any).reassignmentEvidence.set({
      id: 30, state: 'draft', total_paid: '0', active_financial_split_id: null,
      payments: [], invoices: [],
    });
    component.reassignmentFloorLoaded.set(true);
    expect((component as any).canReassignClosedOrder()).toBeTrue();
    expect(component.secondaryActions().map((action) => action.id)).toContain('reassign');
    floorTables.set([{ id: 9, store_id: 1, name: 'Mesa 9', zone: null, capacity: 4,
      status: 'occupied', pos_x: null, pos_y: null,
      created_at: '2026-09-23', updated_at: '2026-09-23',
      active_session: { id: 88, order_id: 30, opened_by: 4, waiter: null,
        opened_at: '2026-09-23', closed_at: null, guest_count: 2 },
    }]);
    expect((component as any).canReassignClosedOrder()).toBeFalse();
    floorTables.set([]);
    component.onSecondaryAction('reassign');
    expect(component.tableMoveMode()).toBe('reassign');
    expect(component.isTransferOpen()).toBeTrue();
    component.session.set({ ...closed, closed_at: null });
    expect(component.tableMoveMode()).toBe('reassign');

    component.session.set({ ...closed, paid_at: '2026-09-23T12:11:00Z' });
    expect((component as any).canReassignClosedOrder()).toBeFalse();
    component.session.set(closed);
    (component as any).reassignmentEvidence.set({
      id: 30, state: 'draft', total_paid: '0', active_financial_split_id: null,
      payments: [{ state: 'partially_refunded' }], invoices: [],
    });
    expect((component as any).canReassignClosedOrder()).toBeFalse();
    (component as any).reassignmentEvidence.set({
      id: 30, state: 'draft', total_paid: '0', active_financial_split_id: null,
      payments: [], invoices: [{ status: 'validated' }],
    });
    expect((component as any).canReassignClosedOrder()).toBeFalse();
    expect(component.secondaryActions().map((action) => action.id)).not.toContain('reassign');
  });

  it('switches to the new session and refreshes kitchen snapshot after reassignment', () => {
    const fresh = { ...session([]), id: 88, table_id: 5, closed_at: null };
    api.getSession.and.returnValue(of(fresh));
    component.session.set({ ...session([]), closed_at: '2026-09-23T12:10:00Z' });
    component.isTransferOpen.set(true);

    (component as any).onReassignmentConfirmed(fresh);

    expect(component.session()?.id).toBe(88);
    expect(component.isTransferOpen()).toBeFalse();
    expect(kdsSse.refreshSnapshot).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/restaurant-ops/tables/session', 88]);
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

  describe('openEditItemNote', () => {
    it('prompts the waiter and updates item notes via tablesService.updateItemNotes', async () => {
      const itm = item(101, false);
      component.session.set(session([itm]));
      dialog.prompt.and.returnValue(Promise.resolve('Sin sal y bien cocido'));
      const updatedSession = session([{ ...itm, notes: 'Sin sal y bien cocido' }]);
      api.updateItemNotes.and.returnValue(of(updatedSession));

      component.openEditItemNote(itm);
      // Wait for promise resolution
      await Promise.resolve();

      expect(dialog.prompt).toHaveBeenCalledOnceWith(jasmine.objectContaining({
        title: 'Agregar nota al plato',
        defaultValue: '',
      }));
      expect(api.updateItemNotes).toHaveBeenCalledOnceWith(7, 101, 'Sin sal y bien cocido');
      expect(component.updatingNoteItemId()).toBeNull();
      expect(toast.success).toHaveBeenCalledWith('Nota actualizada');
      expect(component.session()).toEqual(updatedSession);
    });

    it('clears the note when prompt input is empty or whitespace', async () => {
      const itm = { ...item(101, false), notes: 'Nota previa' };
      component.session.set(session([itm]));
      dialog.prompt.and.returnValue(Promise.resolve('   '));
      const updatedSession = session([{ ...itm, notes: null }]);
      api.updateItemNotes.and.returnValue(of(updatedSession));

      component.openEditItemNote(itm);
      await Promise.resolve();

      expect(dialog.prompt).toHaveBeenCalledOnceWith(jasmine.objectContaining({
        title: 'Editar nota del plato',
        defaultValue: 'Nota previa',
      }));
      expect(api.updateItemNotes).toHaveBeenCalledOnceWith(7, 101, null);
      expect(toast.success).toHaveBeenCalledWith('Nota eliminada');
    });

    it('does not call updateItemNotes if prompt is cancelled or note unchanged', async () => {
      const itm = { ...item(101, false), notes: 'Misma nota' };
      component.session.set(session([itm]));

      // Cancelled prompt
      dialog.prompt.and.returnValue(Promise.resolve(undefined));
      component.openEditItemNote(itm);
      await Promise.resolve();
      expect(api.updateItemNotes).not.toHaveBeenCalled();

      // Unchanged note
      dialog.prompt.and.returnValue(Promise.resolve('  Misma nota  '));
      component.openEditItemNote(itm);
      await Promise.resolve();
      expect(api.updateItemNotes).not.toHaveBeenCalled();
    });
  });

  /**
   * Sin sobreventa — `INV_STOCK_INSUFFICIENT_LINES` / `INV_STOCK_002`.
   *
   * `TablesService.handleError` (no editable desde este componente) colapsa
   * HOY todo error a un string plano ya redactado en español por el backend,
   * así que `onAddItems`/`onPay` sólo necesitan seguir mostrándolo tal cual
   * — cero regresión. `describeAddOrPayError` además sabe listar cada
   * faltante si algún día `err` llega como objeto con `details` estructurado
   * (el mismo contrato que `pos-payment.service.ts` ya preserva), así que esa
   * rama forward-compatible también se prueba aquí.
   */
  describe('stock shortage errors (addItems/fire/pay)', () => {
    it('onAddItems muestra el string ya redactado por TablesService.handleError', () => {
      component.session.set(session([]));
      // TablesService.handleError siempre re-lanza un string (ver
      // tables.service.ts): se simula con un observable que emite error.
      const error$ = new Subject<TableSession>();
      api.addItems.and.returnValue(error$.asObservable());

      component.onAddItems([{ product_id: 1, quantity: 1 } as TableSessionAddItem]);
      error$.error('Sin stock suficiente: MODELO (pedido 1, disponible 0). Quítalo de la orden o desactiva «Maneja inventario» en el producto.');

      expect(toast.error).toHaveBeenCalledOnceWith(
        'Sin stock suficiente: MODELO (pedido 1, disponible 0). Quítalo de la orden o desactiva «Maneja inventario» en el producto.',
      );
      expect(component.isAddingItems()).toBeFalse();
    });

    it('onAddItems lista los faltantes cuando el error llega estructurado (forward-compatible)', () => {
      component.session.set(session([]));
      const error$ = new Subject<TableSession>();
      api.addItems.and.returnValue(error$.asObservable());

      component.onAddItems([{ product_id: 1, quantity: 1 } as TableSessionAddItem]);
      error$.error({
        message: 'fallback',
        details: {
          items: [
            {
              product_id: 501,
              product_variant_id: null,
              product_name: 'MODELO',
              kind: 'product',
              requested: 1,
              available: 0,
            },
          ],
        },
      });

      expect(toast.error).toHaveBeenCalledOnceWith(
        'MODELO — pedido 1, disponible 0 Quítalo de la orden o desactiva «Maneja inventario» en el producto.',
      );
    });

    it('onPay muestra el string ya redactado por TablesService.handleError', () => {
      component.session.set(session([]));
      const error$ = new Subject<TableSession>();
      api.payTableSession.and.returnValue(error$.asObservable());

      component.onPay({ store_payment_method_id: 3 } as TablePaymentSubmit);
      error$.error('No se puede entregar: no hay stock suficiente para uno o más productos.');

      expect(toast.error).toHaveBeenCalledOnceWith(
        'No se puede entregar: no hay stock suficiente para uno o más productos.',
      );
      expect(component.isPaying()).toBeFalse();
    });

    it('onKitchenMutationError lista los faltantes cuando details.items llega estructurado', () => {
      (component as any).onKitchenMutationError({
        code: 'INV_STOCK_INSUFFICIENT_LINES',
        message: 'fallback',
        details: {
          items: [
            {
              product_id: 88,
              product_variant_id: null,
              product_name: 'Limón',
              kind: 'ingredient',
              requested: 3,
              available: 1,
              used_by: ['Mojito'],
            },
          ],
        },
      });

      expect(toast.error).toHaveBeenCalledOnceWith(
        'Limón (insumo, usado en Mojito) — requerido 3, disponible 1 Quítalo de la orden o desactiva «Maneja inventario» en el producto.',
      );
    });

    it('onKitchenMutationError mantiene el string plano de siempre (sin cambios)', () => {
      (component as any).onKitchenMutationError('Error de red');

      expect(toast.error).toHaveBeenCalledOnceWith('Error de red');
    });
  });
});
