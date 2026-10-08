import { Component, NO_ERRORS_SCHEMA, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY, Subject } from 'rxjs';
import { InventoryDashboardComponent } from './inventory-dashboard.component';
import { InventoryService, PurchaseOrdersService, SuppliersService } from './services';
import { ApiResponse, InventoryStats, PurchaseOrder, Supplier } from './interfaces';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../shared/components/toast/toast.service';

// Shallow shared-UI contracts; the dashboard's complete production template,
// native signals, lifecycle and zoneless scheduler remain actual Angular.
@Component({ selector: 'app-stats', standalone: true, template: `
  @if (loading()) { <span class="stats-loading">Cargando estadísticas</span> }
  @else { <span class="stats-value">{{title()}}: {{value()}} {{smallText()}}</span> }
` })
class StatsStub {
  readonly title = input(''); readonly value = input<string | number>(''); readonly smallText = input(''); readonly loading = input(false);
}
@Component({ selector: 'app-table', standalone: true, template: `
  @if (loading()) { <p class="table-loading">Cargando tabla</p> }
  @else if (!data().length) { <p class="table-empty">{{emptyMessage()}}</p> }
  @else { @for (row of data(); track $index) { <p class="table-row">{{label(row)}}</p> } }
` })
class TableStub {
  readonly data = input<readonly unknown[]>([]); readonly columns = input<readonly unknown[]>([]);
  readonly loading = input(false); readonly emptyMessage = input('');
  label(row: unknown): string { const value = row as { order_number?: string; name?: string }; return value.order_number ?? value.name ?? ''; }
}
@Component({ selector: 'app-icon', standalone: true, template: '' })
class IconStub { readonly size = input(0); }

const STATS: InventoryStats = { total_products: 141, total_stock_value: 123456, low_stock_items: 178, out_of_stock_items: 43, pending_orders: 12, incoming_stock: 54321 };
const ORDER: PurchaseOrder = { id: 1, organization_id: 1, supplier_id: 2, location_id: 3, status: 'draft', order_number: 'PO-ASYNC-178' };
const SUPPLIER: Supplier = { id: 2, name: 'Proveedor Async178', code: 'ASYNC', state: 'active' };
const response = <T>(data: T): ApiResponse<T> => ({ success: true, data });

describe('InventoryDashboardComponent real zoneless async rendering', () => {
  let fixture: ComponentFixture<InventoryDashboardComponent>;
  let component: InventoryDashboardComponent;
  let inventory: jasmine.SpyObj<Pick<InventoryService, 'getInventoryStats'>>;
  let orders: jasmine.SpyObj<Pick<PurchaseOrdersService, 'getPurchaseOrders'>>;
  let suppliers: jasmine.SpyObj<Pick<SuppliersService, 'getSuppliers'>>;
  let currency: jasmine.SpyObj<Pick<CurrencyFormatService, 'format' | 'loadCurrency'>>;
  let toast: jasmine.SpyObj<Pick<ToastService, 'error'>>;
  let statsRequests: Subject<ApiResponse<InventoryStats>>[];
  let orderRequests: Subject<ApiResponse<PurchaseOrder[]>>[];
  let supplierRequests: Subject<ApiResponse<Supplier[]>>[];

  beforeEach(async () => {
    statsRequests = []; orderRequests = []; supplierRequests = [];
    inventory = jasmine.createSpyObj('InventoryService', ['getInventoryStats']);
    orders = jasmine.createSpyObj('PurchaseOrdersService', ['getPurchaseOrders']);
    suppliers = jasmine.createSpyObj('SuppliersService', ['getSuppliers']);
    currency = jasmine.createSpyObj('CurrencyFormatService', ['format', 'loadCurrency']);
    currency.format.and.callFake(value => `moneda(${value})`);
    toast = jasmine.createSpyObj('ToastService', ['error']);
    inventory.getInventoryStats.and.callFake(() => { const request = new Subject<ApiResponse<InventoryStats>>(); statsRequests.push(request); return request; });
    orders.getPurchaseOrders.and.callFake(() => { const request = new Subject<ApiResponse<PurchaseOrder[]>>(); orderRequests.push(request); return request; });
    suppliers.getSuppliers.and.callFake(() => { const request = new Subject<ApiResponse<Supplier[]>>(); supplierRequests.push(request); return request; });
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), { provide: InventoryService, useValue: inventory },
      { provide: PurchaseOrdersService, useValue: orders }, { provide: SuppliersService, useValue: suppliers },
      { provide: CurrencyFormatService, useValue: currency }, { provide: ToastService, useValue: toast },
    ] });
    TestBed.overrideComponent(InventoryDashboardComponent, { set: { imports: [StatsStub, TableStub, IconStub], schemas: [NO_ERRORS_SCHEMA] } });
    fixture = TestBed.createComponent(InventoryDashboardComponent); component = fixture.componentInstance;
    fixture.detectChanges(); // Initial render only; NEVER used after an API response.
    await fixture.whenStable();
  });
  afterEach(() => TestBed.resetTestingModule());
  const text = () => fixture.nativeElement.textContent as string;
  const values = () => Array.from(fixture.nativeElement.querySelectorAll('.stats-value') as NodeListOf<HTMLElement>).map(node => node.textContent).join(' ');
  function classStats(): InventoryStats {
    const state: unknown = component.stats;
    return typeof state === 'function' ? (state as () => InventoryStats)() : state as InventoryStats;
  }

  it('renders asynchronous KPIs after whenStable without manual detectChanges', async () => {
    statsRequests[0].next(response(STATS)); await fixture.whenStable();
    expect(classStats().low_stock_items).toBe(178);
    expect(values()).toContain('Stock Bajo: 178');
    expect(values()).toContain('Productos con Stock: 141');
    expect(values()).toContain('43 agotados');
    expect(values()).toContain('Órdenes Pendientes: 12');
    expect(values()).toContain('moneda(123456)'); expect(values()).toContain('moneda(54321)');
    expect(currency.format).toHaveBeenCalledWith(123456, 0);
  });
  it('independently renders recent orders and ends their loading state without a stats response', async () => {
    orderRequests[0].next(response([ORDER])); await fixture.whenStable();
    expect(text()).toContain('PO-ASYNC-178');
    expect(fixture.nativeElement.querySelectorAll('.table-loading').length).toBe(1); // suppliers still pending
    expect(orders.getPurchaseOrders).toHaveBeenCalledWith({ limit: 5 });
  });
  it('independently renders suppliers and ends their loading state without another response', async () => {
    supplierRequests[0].next(response([SUPPLIER])); await fixture.whenStable();
    expect(text()).toContain('Proveedor Async178');
    expect(fixture.nativeElement.querySelectorAll('.table-loading').length).toBe(1); // orders still pending
    expect(suppliers.getSuppliers).toHaveBeenCalledWith({ limit: 5, state: 'active' });
  });
  it('keeps initial loading explicit instead of presenting zero metrics as loaded', () => {
    expect(fixture.nativeElement.querySelectorAll('.stats-loading').length).toBe(4);
    expect(fixture.nativeElement.querySelectorAll('.stats-value').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.table-loading').length).toBe(2);
  });
  it('updates metrics on a later response without any manual render notification', async () => {
    statsRequests[0].next(response(STATS)); await fixture.whenStable();
    statsRequests[0].next(response({ ...STATS, low_stock_items: 7 })); await fixture.whenStable();
    expect(values()).toContain('Stock Bajo: 7'); expect(values()).not.toContain('Stock Bajo: 178');
  });
  it('shows a stats failure rather than fake zero-success cards', async () => {
    statsRequests[0].error(new Error('stats unavailable')); await fixture.whenStable();
    expect(text()).toContain('No se pudo cargar el resumen de inventario');
    expect(fixture.nativeElement.querySelectorAll('.stats-value').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.stats-loading').length).toBe(0);
    expect(toast.error).toHaveBeenCalled();
  });
  it('shows independent order/supplier failures and stops their spinners', async () => {
    orderRequests[0].error(new Error('orders')); supplierRequests[0].error(new Error('suppliers')); await fixture.whenStable();
    expect(text()).toContain('No se pudieron cargar las órdenes recientes');
    expect(text()).toContain('No se pudieron cargar los proveedores');
    expect(fixture.nativeElement.querySelectorAll('.table-loading').length).toBe(0);
  });
  it('renders genuine zero KPIs and empty lists as successful data', async () => {
    statsRequests[0].next(response({ total_products: 0, total_stock_value: 0, low_stock_items: 0, out_of_stock_items: 0, pending_orders: 0, incoming_stock: 0 }));
    orderRequests[0].next(response([])); supplierRequests[0].next(response([])); await fixture.whenStable();
    expect(values()).toContain('Stock Bajo: 0'); expect(values()).toContain('moneda(0)');
    expect(text()).toContain('No hay órdenes recientes'); expect(text()).toContain('No hay proveedores');
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(0);
  });
  it('clears previous rows when a later successful response is empty', async () => {
    orderRequests[0].next(response([ORDER])); supplierRequests[0].next(response([SUPPLIER])); await fixture.whenStable();
    orderRequests[0].next(response([])); supplierRequests[0].next(response([])); await fixture.whenStable();
    expect(text()).not.toContain('PO-ASYNC-178'); expect(text()).not.toContain('Proveedor Async178');
    expect(text()).toContain('No hay órdenes recientes'); expect(text()).toContain('No hay proveedores');
  });
  it('recovers after failures through the existing load callbacks', async () => {
    statsRequests[0].error(new Error('stats')); orderRequests[0].error(new Error('orders')); supplierRequests[0].error(new Error('suppliers')); await fixture.whenStable();
    component.loadStats(); component.loadRecentOrders(); component.loadTopSuppliers(); await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.stats-loading').length).toBe(4);
    statsRequests[1].next(response(STATS)); orderRequests[1].next(response([ORDER])); supplierRequests[1].next(response([SUPPLIER])); await fixture.whenStable();
    expect(values()).toContain('Stock Bajo: 178'); expect(text()).toContain('PO-ASYNC-178'); expect(text()).toContain('Proveedor Async178');
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(0);
  });
  it('treats missing data as unavailable rather than false success', async () => {
    statsRequests[0].next({ success: true } as ApiResponse<InventoryStats>);
    orderRequests[0].next({ success: true } as ApiResponse<PurchaseOrder[]>);
    supplierRequests[0].next({ success: true } as ApiResponse<Supplier[]>); await fixture.whenStable();
    expect(text()).toContain('No se pudo cargar el resumen de inventario');
    expect(text()).toContain('No se pudieron cargar las órdenes recientes'); expect(text()).toContain('No se pudieron cargar los proveedores');
  });
  it('does not leave an EMPTY refresh loading forever', async () => {
    inventory.getInventoryStats.and.returnValue(EMPTY); orders.getPurchaseOrders.and.returnValue(EMPTY); suppliers.getSuppliers.and.returnValue(EMPTY);
    component.loadStats(); component.loadRecentOrders(); component.loadTopSuppliers(); await fixture.whenStable();
    expect(text()).toContain('No se pudo cargar el resumen de inventario');
    expect(fixture.nativeElement.querySelectorAll('.table-loading').length).toBe(0);
  });
  it('does not present data from an explicitly unsuccessful response as loaded success', async () => {
    statsRequests[0].next({ success: false, data: STATS });
    orderRequests[0].next({ success: false, data: [ORDER] });
    supplierRequests[0].next({ success: false, data: [SUPPLIER] }); await fixture.whenStable();
    expect(values()).toBe(''); expect(text()).not.toContain('PO-ASYNC-178'); expect(text()).not.toContain('Proveedor Async178');
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(3);
  });
  it('cancels replaced subscriptions so an old response cannot overwrite a reload', async () => {
    component.loadStats(); component.loadRecentOrders(); component.loadTopSuppliers();
    expect(statsRequests[0].observed).toBeFalse(); expect(orderRequests[0].observed).toBeFalse(); expect(supplierRequests[0].observed).toBeFalse();
    statsRequests[1].next(response({ ...STATS, low_stock_items: 7 })); orderRequests[1].next(response([ORDER])); supplierRequests[1].next(response([SUPPLIER])); await fixture.whenStable();
    statsRequests[0].next(response(STATS)); orderRequests[0].next(response([])); supplierRequests[0].error(new Error('stale')); await fixture.whenStable();
    expect(values()).toContain('Stock Bajo: 7'); expect(text()).toContain('PO-ASYNC-178'); expect(text()).toContain('Proveedor Async178');
  });
  it('cleans all pending subscriptions on fixture destroy', () => {
    fixture.destroy();
    expect(statsRequests[0].observed).toBeFalse(); expect(orderRequests[0].observed).toBeFalse(); expect(supplierRequests[0].observed).toBeFalse();
    statsRequests[0].next(response(STATS)); expect(classStats().low_stock_items).toBe(0);
  });
  it('preserves currency loading, status callback and quick-action route markup', () => {
    expect(currency.loadCurrency).toHaveBeenCalledTimes(1);
    expect(component.getStatusLabel('draft')).toBe('Borrador'); expect(component.getStatusLabel('received')).toBe('Recibida');
    expect(fixture.nativeElement.querySelectorAll('a').length).toBe(6);
    expect(text()).toContain('Nueva Orden'); expect(text()).toContain('Ajustar Stock');
  });
});
