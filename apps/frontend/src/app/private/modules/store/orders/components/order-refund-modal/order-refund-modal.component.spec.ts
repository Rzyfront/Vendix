import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { OrderRefundModalComponent } from './order-refund-modal.component';
import { StoreOrdersService } from '../../services/store-orders.service';
import { InventoryService } from '../../../inventory/services/inventory.service';
import type { Order, RefundRecord } from '../../interfaces/order.interface';

describe('OrderRefundModalComponent — reusar por defecto', () => {
  let fixture: ComponentFixture<OrderRefundModalComponent>;
  let refunds: Subject<RefundRecord[]>;
  let locations: Subject<{ data: { id: number; name: string; code: string; is_default: boolean }[] }>;
  let methods: Subject<{ methods: []; bank_accounts: [] }>;

  beforeEach(async () => {
    refunds = new Subject();
    locations = new Subject();
    methods = new Subject();
    await TestBed.configureTestingModule({
      imports: [OrderRefundModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreOrdersService, useValue: {
          getOrderRefunds: jasmine.createSpy().and.returnValue(refunds),
          getAvailableRefundMethods: jasmine.createSpy().and.returnValue(methods),
        } },
        { provide: InventoryService, useValue: {
          getLocations: jasmine.createSpy().and.returnValue(locations),
        } },
      ],
    }).overrideComponent(OrderRefundModalComponent, {
      set: { template: '', imports: [] },
    }).compileComponents();
    fixture = TestBed.createComponent(OrderRefundModalComponent);
  });

  afterEach(() => fixture.destroy());

  function open(count: number): OrderRefundModalComponent {
    fixture.componentRef.setInput('order', {
      id: 42,
      order_items: Array.from({ length: count }, (_, index) => ({
        id: index + 1, product_name: `Plato ${index + 1}`, quantity: 2,
        unit_price: 10000, total_price: 20000, inventory_consumed_at_fire: true,
        products: { product_type: 'prepared' },
      })),
    } as unknown as Order);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    locations.next({ data: [{ id: 7, name: 'Principal', code: 'MAIN', is_default: true }] });
    refunds.next([]);
    methods.next({ methods: [], bank_accounts: [] });
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('preselecciona reabastecer los insumos de un plato ya disparado', () => {
    const component = open(1);
    expect(component.refundItems()[0].isFiredDish).toBeTrue();
    expect(component.refundItems()[0].inventoryAction).toBe('restock');
    expect(component.refundItems()[0].locationId).toBe(7);
  });

  it('envía reabastecer para todos los platos seleccionados de un reembolso múltiple', () => {
    const component = open(3);
    component.toggleSelectAll();
    const dto = component['buildDto']();
    expect(dto.items).toHaveSize(3);
    expect(dto.items.every((item) => item.inventory_action === 'restock')).toBeTrue();
  });

  it('respeta dar de baja o no devolver cuando el usuario cambia la selección', () => {
    const component = open(2);
    component.toggleSelectAll();
    component.setInventoryAction(1, 'write_off');
    component.setInventoryAction(2, 'no_return');
    component.currentStep.set(1);
    fixture.detectChanges();
    expect(component['buildDto']().items.map((item) => item.inventory_action))
      .toEqual(['write_off', 'no_return']);
  });

  it('reinicia la selección de inventario al abrir otro reembolso', () => {
    const component = open(1);
    component.setInventoryAction(1, 'write_off');
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();
    open(2);
    expect(component.refundItems().map((item) => item.inventoryAction)).toEqual(['restock', 'restock']);
    expect(component.selectedItems()).toHaveSize(0);
  });
});
