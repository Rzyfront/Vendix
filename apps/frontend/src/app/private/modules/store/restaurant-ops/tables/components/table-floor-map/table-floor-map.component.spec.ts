import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Table } from '../../interfaces';
import { AdminTablesSseService } from '../../services/admin-tables-sse.service';
import { TableFloorMapComponent } from './table-floor-map.component';

const table = (id: number, pos_x: number | null, pos_y: number | null): Table => ({
  id,
  store_id: 1,
  name: `Mesa ${id}`,
  zone: null,
  capacity: 4,
  status: 'available',
  pos_x,
  pos_y,
  created_at: '2026-09-23T00:00:00.000Z',
  updated_at: '2026-09-23T00:00:00.000Z',
});

describe('TableFloorMapComponent auto-layout', () => {
  let fixture: ComponentFixture<TableFloorMapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TableFloorMapComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AdminTablesSseService, useValue: { lastEvent: signal(null) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(TableFloorMapComponent);
  });

  afterEach(() => fixture.destroy());

  it('keeps explicit (0,0) and places a null-position table clear of it even when listed first', () => {
    fixture.componentRef.setInput('tables', [table(15, null, null), table(2, 0, 0)]);
    fixture.detectChanges();

    expect(fixture.componentInstance.cells().map(({ table: item, x, y }) => [item.id, x, y]))
      .toEqual([[15, 174, 0], [2, 0, 0]]);

    const [unpositioned, explicit] = fixture.nativeElement.querySelectorAll('.table-cell') as NodeListOf<HTMLElement>;
    const unpositionedRect = unpositioned.getBoundingClientRect();
    const explicitRect = explicit.getBoundingClientRect();
    expect(unpositionedRect.left).toBeGreaterThanOrEqual(explicitRect.right);

    const clicked = jasmine.createSpy('tableClicked');
    fixture.componentInstance.tableClicked.subscribe(clicked);
    unpositioned.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    unpositioned.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    expect(clicked).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 15 }));
  });

  it('places multiple null-position tables in distinct grid slots with a gap', () => {
    fixture.componentRef.setInput('tables', [
      table(2, 0, 0),
      table(15, null, null),
      table(16, null, null),
      table(17, null, null),
      table(18, null, null),
      table(19, null, null),
    ]);
    fixture.detectChanges();

    expect(fixture.componentInstance.cells().map(({ x, y }) => [x, y]))
      .toEqual([[0, 0], [174, 0], [348, 0], [522, 0], [696, 0], [0, 140]]);
  });

  it('respects local drag overrides and irregular explicit positions without changing list order', () => {
    fixture.componentRef.setInput('tables', [
      table(15, null, null),
      table(2, 0, 0),
      table(3, 190, 0),
      table(16, null, null),
    ]);
    fixture.detectChanges();
    fixture.componentInstance.localPositions.set(new Map([[2, { x: 522, y: 0 }]]));

    expect(fixture.componentInstance.cells().map(({ table: item, x, y }) => [item.id, x, y]))
      .toEqual([[15, 0, 0], [2, 522, 0], [3, 190, 0], [16, 696, 0]]);
  });

  it('shows the session opener in the occupied tile and accessible label', () => {
    fixture.componentRef.setInput('tables', [{
      ...table(7, 0, 0),
      status: 'occupied',
      active_session: {
        id: 41, order_id: 90, opened_by: 4,
        waiter: { id: 4, first_name: 'Ana', last_name: 'Rojas' },
        opened_at: '2026-09-23T12:00:00Z', closed_at: null, guest_count: 2,
      },
    }]);
    fixture.detectChanges();

    const tile = fixture.nativeElement.querySelector('.table-cell') as HTMLElement;
    expect(tile.getAttribute('aria-label')).toContain('Mesero: Ana Rojas');
    expect(tile.querySelector('.footer-meta')?.textContent?.trim()).toBe('Ana Rojas');
    expect(tile.textContent).not.toContain('#41');
  });

  it('keeps an anonymous QR session unnamed rather than inventing a waiter', () => {
    fixture.componentRef.setInput('tables', [{
      ...table(8, 0, 0),
      status: 'occupied',
      active_session: {
        id: 42, order_id: 91, opened_by: null, waiter: null,
        opened_at: '2026-09-23T12:00:00Z', closed_at: null, guest_count: 2,
      },
    }]);
    fixture.detectChanges();

    const tile = fixture.nativeElement.querySelector('.table-cell') as HTMLElement;
    expect(tile.getAttribute('aria-label')).not.toContain('Mesero:');
    expect(tile.querySelector('.footer-meta')?.textContent?.trim()).toBe('#42');
  });
});
