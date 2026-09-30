import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../../shared/components';
import { Table, TableSession } from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { TransferTableModalComponent } from './transfer-table-modal.component';

const table = (id: number, status: Table['status'], active = false): Table => ({
  id, store_id: 1, name: `Mesa ${id}`, zone: null, capacity: 4,
  status, pos_x: null, pos_y: null,
  created_at: '2026-09-23', updated_at: '2026-09-23',
  active_session: active ? { id: 80, order_id: 90, opened_by: 4, waiter: null,
    opened_at: '2026-09-23', closed_at: null, guest_count: 2 } : null,
});

describe('TransferTableModalComponent reassignment mode', () => {
  let fixture: ComponentFixture<TransferTableModalComponent>;
  let api: jasmine.SpyObj<TablesService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj('TablesService', ['reassignOrderToTable', 'transferSession', 'getFloorMap']);
    await TestBed.configureTestingModule({
      imports: [TransferTableModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: TablesService, useValue: api },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    }).overrideComponent(TransferTableModalComponent, {
      set: { template: '', imports: [] },
    }).compileComponents();
    fixture = TestBed.createComponent(TransferTableModalComponent);
    fixture.componentRef.setInput('mode', 'reassign');
    fixture.componentRef.setInput('orderId', 41);
    fixture.componentRef.setInput('table', table(1, 'cleaning'));
    fixture.componentRef.setInput('tables', [
      table(1, 'cleaning'), table(2, 'available'), table(3, 'occupied', true),
      table(4, 'reserved'), table(5, 'cleaning'),
    ]);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('excludes occupied destinations and marks reserved/cleaning as not selectable', () => {
    const component = fixture.componentInstance as any;
    expect(component.visibleTables().map((t: Table) => t.id)).toEqual([1, 2, 4, 5]);
    expect(component.isSelectable(table(2, 'available'))).toBeTrue();
    expect(component.isSelectable(table(3, 'occupied', true))).toBeFalse();
    expect(component.isSelectable(table(4, 'reserved'))).toBeFalse();
    expect(component.isSelectable(table(5, 'cleaning'))).toBeFalse();
    expect(component.destinationHint(table(4, 'reserved'))).toContain('Reservada');
    expect(component.destinationHint(table(5, 'cleaning'))).toContain('limpieza');
  });

  it('posts reassignment and emits new session rather than transferring', () => {
    const session = { id: 77, order_id: 41, table_id: 2 } as TableSession;
    api.reassignOrderToTable.and.returnValue(of(session));
    const emitted = jasmine.createSpy('reassigned');
    (fixture.componentInstance as any).reassigned.subscribe(emitted);
    fixture.componentInstance.select(table(2, 'available'));
    fixture.componentInstance.confirm();
    expect(api.reassignOrderToTable).toHaveBeenCalledOnceWith(41, 2);
    expect(api.transferSession).not.toHaveBeenCalled();
    expect(emitted).toHaveBeenCalledOnceWith(session);
  });
});
